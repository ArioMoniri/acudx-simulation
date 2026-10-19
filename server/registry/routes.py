"""Admin registry API (``/admin/*``), same ``X-Admin-Token`` guard as ``/admin/gpu/*``.

Routes
------
GET    /admin/providers[?kind=]          list (public view: has_key + last4, never a key)
POST   /admin/providers                  create (api_key is write-only)
GET    /admin/providers/{id}
PUT    /admin/providers/{id}             partial update; api_key "" clears the stored key
DELETE /admin/providers/{id}
POST   /admin/providers/{id}/probe       real health call, 5 s budget, result persisted
GET    /admin/settings                   {settings: {key: json}}
PUT    /admin/settings                   merge-upsert {settings: {...}}
GET    /admin/health                     aggregate: db, providers, gpu, disk
GET    /admin/telemetry/summary?window=  24h | 7d | 30d
GET    /admin/telemetry/gpu              gpu_ledger roll-up
"""

from __future__ import annotations

import os
import time
from typing import Any, Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from server.admin_routes import require_admin
from server.providers.gpu_worker import WorkerManager
from server.registry.probe import probe_provider
from server.registry.store import (
    PROVIDER_KINDS,
    ProviderIn,
    ProviderPatch,
    RegistryStore,
    SecretKeyMissing,
    secret_key_instructions,
)
from server.telemetry.events import TelemetryRecorder, summarize

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])

Window = Literal["24h", "7d", "30d"]


def _store(request: Request) -> RegistryStore:
    return request.app.state.registry


def _telemetry(request: Request) -> TelemetryRecorder:
    return request.app.state.telemetry


def _manager(request: Request) -> WorkerManager | None:
    return getattr(request.app.state, "worker_manager", None)


def _get_or_404(store: RegistryStore, provider_id: int):
    rec = store.get_provider(provider_id)
    if rec is None:
        raise HTTPException(status_code=404, detail="provider not found")
    return rec


def disk_usage(path: str) -> dict[str, Any]:
    """Free/used bytes for the data volume (falls back to ``/``)."""
    target = path if os.path.exists(path) else "/"
    try:
        st = os.statvfs(target)
        total = st.f_blocks * st.f_frsize
        free = st.f_bavail * st.f_frsize
        return {"path": target, "total_bytes": total, "free_bytes": free, "used_bytes": total - free,
                "used_pct": round((total - free) / total * 100, 1) if total else None}
    except OSError as exc:
        return {"path": target, "error": type(exc).__name__, "detail": str(exc)}


# --------------------------------------------------------------------------- #
# providers                                                                   #
# --------------------------------------------------------------------------- #
@router.get("/providers")
async def list_providers(request: Request, kind: str | None = None) -> dict[str, Any]:
    if kind is not None and kind not in PROVIDER_KINDS:
        raise HTTPException(status_code=422, detail=f"unknown kind {kind!r}")
    store = _store(request)
    return {"providers": [p.public() for p in store.list_providers(kind=kind)], "kinds": list(PROVIDER_KINDS),
            "secrets_configured": store.secrets_configured}


@router.post("/providers", status_code=201)
async def create_provider(request: Request, body: ProviderIn) -> dict[str, Any]:
    try:
        return _store(request).create_provider(body).public()
    except SecretKeyMissing:
        raise HTTPException(status_code=409, detail={"reason": "secret_key_missing",
                                                     "message": secret_key_instructions()})


@router.get("/providers/{provider_id}")
async def get_provider(request: Request, provider_id: int) -> dict[str, Any]:
    return _get_or_404(_store(request), provider_id).public()


@router.put("/providers/{provider_id}")
async def update_provider(request: Request, provider_id: int, body: ProviderPatch) -> dict[str, Any]:
    store = _store(request)
    _get_or_404(store, provider_id)
    try:
        return store.update_provider(provider_id, body).public()
    except SecretKeyMissing:
        raise HTTPException(status_code=409, detail={"reason": "secret_key_missing",
                                                     "message": secret_key_instructions()})


@router.delete("/providers/{provider_id}", status_code=204, response_class=Response)
async def delete_provider(request: Request, provider_id: int) -> Response:
    if not _store(request).delete_provider(provider_id):
        raise HTTPException(status_code=404, detail="provider not found")
    return Response(status_code=204)


@router.post("/providers/{provider_id}/probe")
async def probe(request: Request, provider_id: int) -> dict[str, Any]:
    store = _store(request)
    rec = _get_or_404(store, provider_id)
    settings = request.app.state.settings
    gateway = getattr(request.app.state, "gateway", None)
    client: httpx.AsyncClient | None = getattr(gateway, "_client", None) if gateway else None
    key = store.decrypt_key(rec)
    if client is not None:
        return await probe_provider(rec, api_key=key, settings=settings, client=client, store=store)
    async with httpx.AsyncClient() as own:
        return await probe_provider(rec, api_key=key, settings=settings, client=own, store=store)


# --------------------------------------------------------------------------- #
# settings                                                                    #
# --------------------------------------------------------------------------- #
class SettingsBody(BaseModel):
    settings: dict[str, Any]


@router.get("/settings")
async def get_settings_(request: Request) -> dict[str, Any]:
    return {"settings": _store(request).all_settings()}


@router.put("/settings")
async def put_settings(request: Request, body: SettingsBody) -> dict[str, Any]:
    store = _store(request)
    for key, value in body.settings.items():
        store.set_setting(key, value)
    return {"settings": store.all_settings()}


# --------------------------------------------------------------------------- #
# health                                                                      #
# --------------------------------------------------------------------------- #
@router.get("/health")
async def health(request: Request) -> dict[str, Any]:
    store = _store(request)
    settings = request.app.state.settings
    t0 = time.monotonic()
    providers = store.list_providers()
    db = {"ok": True, "path": store.db_path, "latency_ms": round((time.monotonic() - t0) * 1000.0, 2)}
    try:
        db["size_bytes"] = os.path.getsize(store.db_path)
    except OSError as exc:
        db = {"ok": False, "path": store.db_path, "error": type(exc).__name__}
    by_kind: dict[str, dict[str, int]] = {k: {"total": 0, "enabled": 0, "probe_ok": 0, "probe_failed": 0}
                                          for k in PROVIDER_KINDS}
    for p in providers:
        b = by_kind[p.kind]
        b["total"] += 1
        b["enabled"] += int(p.enabled)
        if p.last_probe_ok is True:
            b["probe_ok"] += 1
        elif p.last_probe_ok is False:
            b["probe_failed"] += 1
    enabled = sum(1 for p in providers if p.enabled)
    failed = sum(1 for p in providers if p.enabled and p.last_probe_ok is False)
    m = _manager(request)
    gpu = await m.status() if m is not None else {"configured": False, "worker": None, "spent_today_usd": 0.0}
    disk = disk_usage(settings.status_disk_path)
    degraded = failed > 0 or not db["ok"] or by_kind["llm"]["enabled"] == 0
    return {
        "status": "degraded" if degraded else "ok",
        "airgapped": settings.airgapped,
        "secrets_configured": store.secrets_configured,
        "db": db,
        "providers": {"total": len(providers), "enabled": enabled, "probe_failed": failed, "by_kind": by_kind},
        "gpu": gpu,
        "disk": disk,
        "ts": time.time(),
    }


# --------------------------------------------------------------------------- #
# telemetry                                                                   #
# --------------------------------------------------------------------------- #
@router.get("/telemetry/summary")
async def telemetry_summary(request: Request, window: Window = "24h") -> dict[str, Any]:
    return summarize(_telemetry(request), window)


@router.get("/telemetry/gpu")
async def telemetry_gpu(request: Request, limit: int = 200) -> dict[str, Any]:
    m = _manager(request)
    if m is None:
        return {"entries": [], "spent_today_usd": 0.0, "spent_7d_usd": 0.0, "by_instance_type": [], "worker": None}
    now = time.time()
    entries = [e.model_dump() for e in m.store.ledger(limit=max(1, min(limit, 1000)))]
    by_type: dict[str, dict[str, float]] = {}
    for e in entries:
        b = by_type.setdefault(e["instance_type"], {"sessions": 0, "hours": 0.0, "cost_usd": 0.0})
        end = e["ended_at"] if e["ended_at"] is not None else now
        hours = max(0.0, end - e["started_at"]) / 3600.0
        b["sessions"] += 1
        b["hours"] += hours
        b["cost_usd"] += e["cost_usd"] if e["cost_usd"] is not None else hours * e["price_cents_per_hour"] / 100.0
    status = await m.status()
    return {
        "entries": entries,
        "spent_today_usd": m.spent_today_usd(),
        "spent_7d_usd": m.store.spent_usd(now - 7 * 86400, now),
        "spent_30d_usd": m.store.spent_usd(now - 30 * 86400, now),
        "by_instance_type": [{"key": k, "sessions": int(v["sessions"]), "hours": round(v["hours"], 3),
                              "cost_usd": round(v["cost_usd"], 4)} for k, v in sorted(by_type.items())],
        "worker": status["worker"],
        "policy": status["policy"],
        "budget_remaining_usd": status["budget_remaining_usd"],
    }
