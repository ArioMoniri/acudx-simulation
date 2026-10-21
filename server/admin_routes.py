"""Admin API (``/admin/*``): operator surface for the on-demand GPU worker.

Guard: either the bootstrap ``X-Admin-Token`` header (compared with ``ADMIN_TOKEN``
in constant time) or a verified bearer JWT holding ``admin`` / ``super_admin``
(server/auth). ``503`` when neither ``ADMIN_TOKEN`` nor an identity provider is
configured, ``401`` on a missing or wrong credential. Responses never include the
worker's bearer token.
"""

from __future__ import annotations

import secrets
from typing import Any

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Request
from pydantic import ValidationError

from server.auth.deps import bearer_admin
from server.providers.gpu_worker import WorkerManager, WorkerPolicy, WorkerRefused
from server.providers.lambda_cloud import LambdaCloudError

router = APIRouter(prefix="/admin", tags=["admin"])


async def require_admin(request: Request, x_admin_token: str | None = Header(default=None)) -> None:
    expected = getattr(request.app.state.settings, "admin_token", None)
    if x_admin_token and expected and secrets.compare_digest(x_admin_token.encode(), expected.encode()):
        return
    if await bearer_admin(request) is not None:
        return
    auth = getattr(request.app.state, "auth", None)
    idp_configured = auth is not None and auth.provider() is not None
    if not expected and not idp_configured:
        raise HTTPException(status_code=503, detail="ADMIN_TOKEN is not configured; admin API disabled")
    raise HTTPException(status_code=401, detail="invalid X-Admin-Token or admin bearer token")


def _manager(request: Request) -> WorkerManager:
    return request.app.state.worker_manager


@router.get("/gpu/status", dependencies=[Depends(require_admin)])
async def gpu_status(request: Request) -> dict[str, Any]:
    return await _manager(request).status()


@router.post("/gpu/start", dependencies=[Depends(require_admin)])
async def gpu_start(request: Request) -> dict[str, Any]:
    m = _manager(request)
    try:
        w = await m.ensure_worker()
    except WorkerRefused as exc:
        raise HTTPException(status_code=409, detail={"reason": exc.reason, "message": str(exc)}) from exc
    except LambdaCloudError as exc:
        raise HTTPException(status_code=502, detail={"reason": "provider_error", "code": exc.code,
                                                     "message": exc.message}) from exc
    return {"worker": w.public(), "spent_today_usd": m.spent_today_usd()}


@router.post("/gpu/scale-up", dependencies=[Depends(require_admin)])
async def gpu_scale_up(request: Request) -> dict[str, Any]:
    """Launch one more worker now (up to ``policy.max_workers``), without waiting for its boot."""
    m = _manager(request)
    refusal = m._refusal()
    if refusal is not None:
        raise HTTPException(status_code=409, detail={"reason": refusal.reason, "message": str(refusal)})
    started = await m.maybe_scale_up(force="admin")
    if started is None:
        raise HTTPException(status_code=409, detail={"reason": "max_workers",
                                                     "message": f"the pool already runs {m.policy.max_workers} worker(s) "
                                                                "or a launch is in flight"})
    return {"started": started, **(await m.status())}


@router.post("/gpu/stop", dependencies=[Depends(require_admin)])
async def gpu_stop(request: Request, worker_id: int | None = None) -> dict[str, Any]:
    """Stop one worker (``?worker_id=``) or every worker of the pool."""
    m = _manager(request)
    try:
        w = await m.terminate(reason="admin", worker_id=worker_id)
    except LambdaCloudError as exc:
        raise HTTPException(status_code=502, detail={"reason": "provider_error", "code": exc.code,
                                                     "message": exc.message}) from exc
    return {"terminated": w.public() if w else None, "spent_today_usd": m.spent_today_usd()}


@router.get("/gpu/boot-log", dependencies=[Depends(require_admin)])
async def gpu_boot_log(request: Request, tail: int = 200, worker_id: int | None = None) -> dict[str, Any]:
    """Redacted cloud-init output and docker status.

    ``worker_id`` returns the snapshot the gateway persisted for that worker (it outlives the
    instance, so a ready_timeout termination still leaves evidence). Without it, the active
    worker is read live; when that fails, the latest persisted snapshot is returned instead.
    """
    m = _manager(request)
    if worker_id is not None:
        stored = m.stored_boot_log(worker_id)
        if stored is None:
            raise HTTPException(status_code=404, detail={"reason": "no_boot_log", "worker_id": worker_id})
        return stored
    live = await m.boot_log(tail_lines=max(10, min(tail, 2000)))
    if live.get("available"):
        return live
    stored = m.stored_boot_log()
    return {**stored, "live_error": live.get("error")} if stored else live


@router.get("/gpu/turn-check", dependencies=[Depends(require_admin)])
async def gpu_turn_check(request: Request, worker_id: int | None = None) -> dict[str, Any]:
    """TURN Allocate from inside the ready worker against its public TURN URLs (UDP and TCP on
    3478, TLS on 443 with the certificate and host name verified): proof that a browser behind an
    HTTPS-only proxy has a relay path. 409 when no worker is ready."""
    from server.voice.avatar import musetalk as mt  # noqa: PLC0415 - voice is optional for the GPU admin

    m = _manager(request)
    ep = m.endpoint_for(m.store.get_worker(worker_id)) if worker_id is not None and m.store.get_worker(worker_id) else m.llm_endpoint()
    worker = mt.worker_from_endpoint(ep)
    if worker is None:
        raise HTTPException(status_code=409, detail={"reason": "no_ready_worker"})
    svc = getattr(request.app.state, "voice", None)
    client = svc.client if svc is not None else None
    if client is None:
        raise HTTPException(status_code=503, detail={"reason": "voice service is not wired"})
    try:
        return await mt.turn_check(client, worker)
    except Exception as exc:  # noqa: BLE001 - surfaced to the operator
        raise HTTPException(status_code=502, detail={"reason": "runner_unreachable", "error": type(exc).__name__}) from exc


@router.get("/gpu/ledger", dependencies=[Depends(require_admin)])
async def gpu_ledger(request: Request, limit: int = 100) -> dict[str, Any]:
    m = _manager(request)
    return {"entries": [e.model_dump() for e in m.store.ledger(limit=max(1, min(limit, 1000)))],
            "spent_today_usd": m.spent_today_usd()}


@router.get("/gpu/policy", dependencies=[Depends(require_admin)])
async def gpu_policy_get(request: Request) -> WorkerPolicy:
    return _manager(request).policy


@router.put("/gpu/policy", dependencies=[Depends(require_admin)])
async def gpu_policy_put(request: Request, patch: dict[str, Any] = Body(...)) -> WorkerPolicy:
    """Merge the given fields into the current policy (unknown fields 422).

    A partial body only changes the fields it names; it never resets the others to
    their defaults (live finding 2026-10-20: a one-field PUT reset the budget,
    allowlist and filesystem).
    """
    m = _manager(request)
    unknown = set(patch) - set(WorkerPolicy.model_fields)
    if unknown:
        raise HTTPException(status_code=422, detail={"unknown_fields": sorted(unknown)})
    try:
        merged = WorkerPolicy.model_validate({**m.policy.model_dump(), **patch})
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors(include_url=False)) from exc
    return m.set_policy(merged)
