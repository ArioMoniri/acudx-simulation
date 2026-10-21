"""SSH-free deploy and operator actions over HTTPS (server/bootstrap/tokens.py holds the secrets).

GET  /bootstrap/status                   public deploy progress: stage, handoff state, which keys are set
                                         (never a key, a token or a password)
POST /bootstrap/provision                {token, anthropic_key?, lambda_key?}: once, with the PROVISION_TOKEN
                                         from the EC2 user-data. Seals the Anthropic key on the registry's
                                         anthropic row, writes the Lambda key root-only to BOOTSTRAP_DIR and
                                         applies it to the running gateway (no restart), burns the token and
                                         returns a new operator token (shown only in this response).
POST /bootstrap/operator/mint-code       {ttl_hours?}: a new single-use retrieval code (the previous one
                                         stops working). Returns the code.
GET  /bootstrap/operator/gpu             the on-demand GPU worker's status (as /admin/gpu/status)
POST /bootstrap/operator/gpu/stop        terminate the running GPU worker now
POST /bootstrap/operator/reset-accounts  fresh temporary passwords for the 8 role accounts (Keycloak
                                         UPDATE_PASSWORD), written root-only; returns usernames and roles only.

Operator routes accept ``X-Operator-Token`` (the token from /bootstrap/provision) or a verified
super_admin bearer. Every route is HTTPS only, rate limited and audited; no response echoes a key.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

from server.bootstrap.handoff import BootstrapHandoff, format_code
from server.bootstrap.routes import _client_ip, _is_https
from server.bootstrap.tokens import OPERATOR_TTL_H, operator_secret, provision_secret

router = APIRouter(prefix="/bootstrap", tags=["bootstrap"])

STATUS_FILE = "status.json"
LAMBDA_KEY_FILE = "lambda.key"
_NO_STORE = {"Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex"}


def _json(status: int, body: dict[str, Any], headers: dict[str, str] | None = None) -> JSONResponse:
    return JSONResponse(body, status_code=status, headers={**_NO_STORE, **(headers or {})})


def _h(request: Request) -> BootstrapHandoff | None:
    return getattr(request.app.state, "bootstrap", None)


def _ua(request: Request) -> str:
    return hashlib.sha256((request.headers.get("user-agent") or "").encode("utf-8")).hexdigest()[:12]


def _guard(request: Request) -> JSONResponse | None:
    if _h(request) is None:
        return _json(404, {"error": "not_provisioned"})
    if getattr(request.app.state.settings, "bootstrap_require_https", True) and not _is_https(request):
        return _json(403, {"error": "https_required"})
    return None


def _refused(out: Any) -> JSONResponse:
    headers = {"Retry-After": str(out.retry_after_s)} if out.retry_after_s else None
    return _json(out.status, {"error": out.reason}, headers)


def _clean_key(v: Any) -> str | None:
    if v is None:
        return None
    if not isinstance(v, str):
        raise ValueError("keys must be strings")
    v = v.strip()
    if not v:
        return None
    if len(v) < 20 or len(v) > 512 or any(c.isspace() for c in v):
        raise ValueError("a key must be 20 to 512 characters without whitespace")
    return v


def load_lambda_key(settings: Any, directory: str | os.PathLike[str] | None) -> None:
    """At startup: a Lambda key delivered through /bootstrap/provision, unless LAMBDA_KEY is set."""
    if getattr(settings, "lambda_key", None) or not directory:
        return
    try:
        key = (Path(directory) / LAMBDA_KEY_FILE).read_text(encoding="utf-8").strip()
    except OSError:
        return
    if key:
        settings.lambda_key = key


def read_status(h: BootstrapHandoff) -> dict[str, Any]:
    try:
        st = json.loads((h.dir / STATUS_FILE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        st = {}
    return {k: st.get(k) for k in ("stage", "detail", "updated_at", "commit") if k in st}


@router.get("/status")
async def deploy_status(request: Request) -> JSONResponse:
    h = _h(request)
    if h is None:
        return _json(404, {"error": "not_provisioned"})
    settings = request.app.state.settings
    out: dict[str, Any] = {"deploy": read_status(h), "handoff": h.status().get("state"),
                           "provision_token": provision_secret(h).state(),
                           "accounts_provisioned": h.credentials_path.exists(),
                           "keys": {"lambda": bool(getattr(settings, "lambda_key", None))}}
    anthropic = getattr(getattr(request.app.state, "gateway", None), "anthropic", None)
    if anthropic is not None:
        out["keys"]["anthropic"] = bool(anthropic.status().get("configured"))
    return _json(200, out)


@router.post("/provision")
async def provision_keys(request: Request) -> JSONResponse:
    if (g := _guard(request)) is not None:
        return g
    h = _h(request)
    assert h is not None
    try:
        body = json.loads((await request.body())[:8192] or b"{}")
        if not isinstance(body, dict):
            raise ValueError("body must be a JSON object")
        anthropic_key = _clean_key(body.get("anthropic_key"))
        lambda_key = _clean_key(body.get("lambda_key"))
        token = str(body.get("token") or "")
    except ValueError as exc:
        return _json(422, {"error": "invalid_body", "detail": str(exc)})
    registry = getattr(request.app.state, "registry", None)
    if anthropic_key and (registry is None or not registry.secrets_configured):
        return _json(503, {"error": "secret_store_unavailable"})
    out = provision_secret(h).check(token, ip=_client_ip(request), ua=_ua(request))
    if out.status != 200:
        return _refused(out)
    applied = {"anthropic": False, "lambda": False}
    settings = request.app.state.settings
    if anthropic_key:
        row = registry.anthropic_row() or registry.ensure_anthropic_row(settings)
        registry.update_provider(row.id, {"api_key": anthropic_key})
        applied["anthropic"] = True
    if lambda_key:
        fd = os.open(h.dir / LAMBDA_KEY_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(lambda_key)
        settings.lambda_key = lambda_key  # the WorkerManager reads it at its next launch decision
        applied["lambda"] = True
    op_token, expires = operator_secret(h).store(ttl_hours=OPERATOR_TTL_H, actor="provision")
    h.audit("provision_applied", ip=_client_ip(request), anthropic=applied["anthropic"], lambda_=applied["lambda"])
    return _json(200, {"applied": applied, "operator_token": op_token, "operator_token_expires_at": expires})


async def _operator(request: Request) -> JSONResponse | None:
    """None when the caller is the operator (token or verified super_admin bearer)."""
    if (g := _guard(request)) is not None:
        return g
    h = _h(request)
    assert h is not None
    presented = request.headers.get("x-operator-token") or ""
    if presented:
        out = operator_secret(h).check(presented, ip=_client_ip(request), ua=_ua(request))
        return None if out.status == 200 else _refused(out)
    auth = getattr(request.app.state, "auth", None)
    if auth is not None and (request.headers.get("authorization") or "").lower().startswith("bearer "):
        try:
            p = await auth.authenticate(request)
        except Exception:  # noqa: BLE001 - HTTPException from a bad bearer: refused below
            p = None
        if p is not None and p.verified and p.has("super_admin"):
            h.audit("operator_bearer", ip=_client_ip(request), sub_hash=p.user_hash)
            return None
    h.audit("operator_refused", ip=_client_ip(request))
    return _json(401, {"error": "operator_auth_required"})


@router.post("/operator/mint-code")
async def operator_mint_code(request: Request) -> JSONResponse:
    if (denied := await _operator(request)) is not None:
        return denied
    h = _h(request)
    assert h is not None
    try:
        body = json.loads((await request.body())[:1024] or b"{}")
        ttl = float(body.get("ttl_hours", 72)) if isinstance(body, dict) else 72.0
        if not 1 <= ttl <= 24 * 14:
            raise ValueError
    except (ValueError, TypeError):
        return _json(422, {"error": "invalid_ttl", "detail": "ttl_hours must be 1 to 336"})
    if not h.credentials_path.exists():
        return _json(409, {"error": "accounts_not_provisioned"})
    code, expires = h.mint(ttl, actor="operator-endpoint")
    return _json(200, {"code": format_code(code), "expires_at": expires,
                       "url": "/bootstrap/credentials", "single_use": True})


def _reset_accounts(h: BootstrapHandoff, keycloak_url: str, realm: str) -> dict[str, Any]:
    from server.bootstrap.provision import (  # noqa: PLC0415
        SERVICE_CLIENT_FILE, KeycloakAdmin, provision, write_credentials,
    )

    sc = json.loads((h.dir / SERVICE_CLIENT_FILE).read_text(encoding="utf-8"))
    try:
        login_url = json.loads(h.credentials_path.read_text(encoding="utf-8")).get("login_url")
    except (OSError, ValueError):
        login_url = None
    with httpx.Client(timeout=30.0, trust_env=False) as c:
        kc = KeycloakAdmin(keycloak_url, realm, c)
        kc.login_client(sc["client_id"], sc["secret"])
        payload = provision(kc, login_url=login_url or "/signin", realm_admin=False)
    write_credentials(h.dir, payload)
    return {"accounts": [{"username": u["username"], "role": u["role"]} for u in payload["users"]]}


@router.get("/operator/gpu")
async def operator_gpu_status(request: Request) -> JSONResponse:
    """The on-demand GPU worker as the gateway sees it (no bearer token of the worker)."""
    if (denied := await _operator(request)) is not None:
        return denied
    wm = getattr(request.app.state, "worker_manager", None)
    if wm is None:
        return _json(503, {"error": "no_worker_manager"})
    return _json(200, await wm.status())


@router.post("/operator/gpu/stop")
async def operator_gpu_stop(request: Request) -> JSONResponse:
    """Terminate the running GPU worker now (teardown, verification); the idle reaper does it otherwise."""
    if (denied := await _operator(request)) is not None:
        return denied
    wm = getattr(request.app.state, "worker_manager", None)
    if wm is None:
        return _json(503, {"error": "no_worker_manager"})
    try:
        w = await wm.terminate(reason="operator")
    except Exception as exc:  # noqa: BLE001 - provider error, surfaced to the operator
        return _json(502, {"error": "provider_error", "detail": type(exc).__name__})
    h = _h(request)
    if h is not None:
        h.audit("gpu_stop", ip=_client_ip(request), instance=(w.instance_id if w else None))
    return _json(200, {"terminated": w.public() if w else None})


@router.post("/operator/reset-accounts")
async def operator_reset_accounts(request: Request) -> JSONResponse:
    if (denied := await _operator(request)) is not None:
        return denied
    h = _h(request)
    assert h is not None
    from server.bootstrap.provision import SERVICE_CLIENT_FILE, ProvisionError  # noqa: PLC0415

    if not (h.dir / SERVICE_CLIENT_FILE).exists():
        return _json(409, {"error": "service_client_missing",
                           "detail": "run deploy/one-click.sh once on the host (it creates the provisioner client)"})
    settings = request.app.state.settings
    try:
        out = await run_in_threadpool(_reset_accounts, h, settings.bootstrap_keycloak_url, "acudx")
    except (ProvisionError, httpx.HTTPError, KeyError, ValueError) as exc:
        h.audit("reset_accounts_failed", error=type(exc).__name__)
        return _json(502, {"error": "keycloak_failed", "detail": str(exc)[:200]})
    h.audit("reset_accounts", ip=_client_ip(request), accounts=len(out["accounts"]))
    return _json(200, {**out, "temporary": True,
                       "next": "POST /bootstrap/operator/mint-code, then hand over /bootstrap/credentials"})
