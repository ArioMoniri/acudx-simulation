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

from fastapi import APIRouter, Depends, Header, HTTPException, Request

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


@router.post("/gpu/stop", dependencies=[Depends(require_admin)])
async def gpu_stop(request: Request) -> dict[str, Any]:
    m = _manager(request)
    try:
        w = await m.terminate(reason="admin")
    except LambdaCloudError as exc:
        raise HTTPException(status_code=502, detail={"reason": "provider_error", "code": exc.code,
                                                     "message": exc.message}) from exc
    return {"terminated": w.public() if w else None, "spent_today_usd": m.spent_today_usd()}


@router.get("/gpu/ledger", dependencies=[Depends(require_admin)])
async def gpu_ledger(request: Request, limit: int = 100) -> dict[str, Any]:
    m = _manager(request)
    return {"entries": [e.model_dump() for e in m.store.ledger(limit=max(1, min(limit, 1000)))],
            "spent_today_usd": m.spent_today_usd()}


@router.get("/gpu/policy", dependencies=[Depends(require_admin)])
async def gpu_policy_get(request: Request) -> WorkerPolicy:
    return _manager(request).policy


@router.put("/gpu/policy", dependencies=[Depends(require_admin)])
async def gpu_policy_put(request: Request, policy: WorkerPolicy) -> WorkerPolicy:
    return _manager(request).set_policy(policy)
