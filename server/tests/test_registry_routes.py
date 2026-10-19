"""Admin registry API: provider CRUD, probes (respx), settings, aggregate health, telemetry endpoints."""

from __future__ import annotations

import httpx
import pytest
import respx
from cryptography.fernet import Fernet
from fastapi import FastAPI
from fastapi.testclient import TestClient

from server.admin_routes import router as gpu_router
from server.config import Settings
from server.providers.gpu_worker import WorkerManager, WorkerStore
from server.registry.routes import router as registry_router
from server.registry.store import RegistryStore
from server.telemetry.events import TelemetryRecorder
from server.tests.conftest import CLOUD_INIT

KEY = Fernet.generate_key().decode()
HDR = {"X-Admin-Token": "adm-secret"}


def _app(tmp_path, *, secret: str | None = KEY, **over) -> tuple[FastAPI, RegistryStore, TelemetryRecorder]:
    base = dict(airgapped=False, lambda_key=None, admin_token="adm-secret",
                acudx_db_path=str(tmp_path / "acudx.db"), acudx_secret_key=secret, _env_file=None)
    base.update(over)
    s = Settings(**base)
    store = RegistryStore(s.acudx_db_path, secret_key=s.acudx_secret_key)
    telemetry = TelemetryRecorder(s.acudx_db_path)
    wm = WorkerManager(s, store=WorkerStore(s.acudx_db_path), template_path=CLOUD_INIT)
    app = FastAPI()
    app.state.settings = s
    app.state.registry = store
    app.state.telemetry = telemetry
    app.state.worker_manager = wm
    app.include_router(gpu_router)
    app.include_router(registry_router)
    return app, store, telemetry


def test_guard_applies_to_registry_routes(tmp_path):
    app, _, _ = _app(tmp_path)
    c = TestClient(app)
    assert c.get("/admin/providers").status_code == 401
    assert c.get("/admin/settings", headers={"X-Admin-Token": "nope"}).status_code == 401
    app2, _, _ = _app(tmp_path / "b", admin_token=None)
    assert TestClient(app2).get("/admin/providers", headers=HDR).status_code == 503


def test_provider_crud_never_leaks_key(tmp_path):
    app, store, _ = _app(tmp_path)
    c = TestClient(app, headers=HDR)
    body = {"kind": "llm", "name": "deepinfra", "base_url": "https://api.deepinfra.com/v1/openai",
            "model": "Qwen/Qwen3-32B", "api_key": "di-secret-ABCD", "priority": 3, "region": "eu",
            "extra": {"context_window": 32768}}
    r = c.post("/admin/providers", json=body)
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    assert r.json()["has_key"] is True and r.json()["key_last4"] == "ABCD"
    assert "di-secret-ABCD" not in r.text and "api_key" not in r.json()
    lst = c.get("/admin/providers").json()
    assert [p["id"] for p in lst["providers"]] == [pid] and "di-secret-ABCD" not in c.get("/admin/providers").text
    assert c.get("/admin/providers", params={"kind": "tts"}).json()["providers"] == []
    one = c.get(f"/admin/providers/{pid}")
    assert one.status_code == 200 and one.json()["extra"] == {"context_window": 32768}
    upd = c.put(f"/admin/providers/{pid}", json={"enabled": False, "priority": 9})
    assert upd.status_code == 200 and upd.json()["enabled"] is False and upd.json()["priority"] == 9
    assert upd.json()["has_key"] is True            # key kept when not sent
    assert store.decrypt_key(store.get_provider(pid)) == "di-secret-ABCD"
    assert c.put(f"/admin/providers/{pid}", json={"api_key": ""}).json()["has_key"] is False
    assert c.delete(f"/admin/providers/{pid}").status_code == 204
    assert c.get(f"/admin/providers/{pid}").status_code == 404
    assert c.delete(f"/admin/providers/{pid}").status_code == 404


def test_create_with_key_but_no_secret_key_is_409_with_instructions(tmp_path):
    app, _, _ = _app(tmp_path, secret=None)
    c = TestClient(app, headers=HDR)
    r = c.post("/admin/providers", json={"kind": "tts", "name": "e", "base_url": "https://api.elevenlabs.io",
                                         "api_key": "xi"})
    assert r.status_code == 409 and "ACUDX_SECRET_KEY" in r.json()["detail"]["message"]
    ok = c.post("/admin/providers", json={"kind": "tts", "name": "e", "base_url": "https://api.elevenlabs.io"})
    assert ok.status_code == 201
    assert c.get("/admin/providers").json()["secrets_configured"] is False


def test_create_rejects_bad_kind_and_url(tmp_path):
    app, _, _ = _app(tmp_path)
    c = TestClient(app, headers=HDR)
    assert c.post("/admin/providers", json={"kind": "video", "name": "x", "base_url": "https://x"}).status_code == 422
    assert c.post("/admin/providers", json={"kind": "llm", "name": "x", "base_url": "notaurl"}).status_code == 422


@respx.mock
def test_probe_llm_models_success_stores_result(tmp_path):
    app, store, _ = _app(tmp_path)
    c = TestClient(app, headers=HDR)
    pid = c.post("/admin/providers", json={"kind": "llm", "name": "a", "base_url": "https://a.example/v1",
                                           "api_key": "k-123"}).json()["id"]
    route = respx.get("https://a.example/v1/models").mock(return_value=httpx.Response(200, json={"data": [
        {"id": "m1"}, {"id": "m2"}]}))
    r = c.post(f"/admin/providers/{pid}/probe")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True and body["status"] == 200 and body["models"] == ["m1", "m2"]
    assert isinstance(body["latency_ms"], (int, float))
    assert route.calls.last.request.headers["authorization"] == "Bearer k-123"
    rec = store.get_provider(pid)
    assert rec.last_probe_ok is True and rec.last_probe_at is not None and rec.last_probe_latency_ms is not None
    assert c.get(f"/admin/providers/{pid}").json()["last_probe_ok"] is True


@respx.mock
def test_probe_failure_is_stored_and_reported(tmp_path):
    app, store, _ = _app(tmp_path)
    c = TestClient(app, headers=HDR)
    pid = c.post("/admin/providers", json={"kind": "stt", "name": "dg", "base_url": "https://api.deepgram.com",
                                           "api_key": "dg"}).json()["id"]
    respx.get("https://api.deepgram.com/v1/projects").mock(side_effect=httpx.ConnectTimeout("slow"))
    r = c.post(f"/admin/providers/{pid}/probe")
    assert r.status_code == 200
    assert r.json()["ok"] is False and r.json()["error"] == "ConnectTimeout"
    rec = store.get_provider(pid)
    assert rec.last_probe_ok is False and rec.last_probe_error == "ConnectTimeout"


@respx.mock
def test_probe_non_2xx_is_not_ok(tmp_path):
    app, _, _ = _app(tmp_path)
    c = TestClient(app, headers=HDR)
    pid = c.post("/admin/providers", json={"kind": "embed", "name": "e", "base_url": "https://e.example"}).json()["id"]
    respx.get("https://e.example/v1/models").mock(return_value=httpx.Response(401))
    body = c.post(f"/admin/providers/{pid}/probe").json()
    assert body["ok"] is False and body["status"] == 401


def test_probe_refused_under_airgap_for_hosted(tmp_path):
    app, store, _ = _app(tmp_path, airgapped=True)
    c = TestClient(app, headers=HDR)
    pid = c.post("/admin/providers", json={"kind": "llm", "name": "a", "base_url": "https://a.example/v1"}).json()["id"]
    r = c.post(f"/admin/providers/{pid}/probe")
    assert r.status_code == 200 and r.json()["ok"] is False and r.json()["error"] == "EgressBlocked"
    assert store.get_provider(pid).last_probe_ok is False
    assert c.post("/admin/providers/9999/probe").status_code == 404


def test_settings_get_put(tmp_path):
    app, _, _ = _app(tmp_path)
    c = TestClient(app, headers=HDR)
    assert c.get("/admin/settings").json() == {"settings": {}}
    r = c.put("/admin/settings", json={"settings": {"budgets": {"llm_daily_usd": 12}, "locale": "tr"}})
    assert r.status_code == 200 and r.json()["settings"]["budgets"] == {"llm_daily_usd": 12}
    r2 = c.put("/admin/settings", json={"settings": {"locale": "en"}})
    assert r2.json()["settings"] == {"budgets": {"llm_daily_usd": 12}, "locale": "en"}
    assert c.put("/admin/settings", json={"settings": "nope"}).status_code == 422


def test_health_aggregate(tmp_path):
    app, _, _ = _app(tmp_path)
    c = TestClient(app, headers=HDR)
    c.post("/admin/providers", json={"kind": "llm", "name": "a", "base_url": "http://127.0.0.1:3040/v1"})
    c.post("/admin/providers", json={"kind": "tts", "name": "b", "base_url": "http://127.0.0.1:8880", "enabled": False})
    h = c.get("/admin/health")
    assert h.status_code == 200
    body = h.json()
    assert body["status"] in {"ok", "degraded"}
    assert body["db"]["ok"] is True and body["db"]["path"].endswith("acudx.db")
    assert body["providers"]["total"] == 2 and body["providers"]["enabled"] == 1
    assert body["providers"]["by_kind"]["llm"]["enabled"] == 1
    assert body["gpu"]["worker"] is None and "spent_today_usd" in body["gpu"]
    assert "free_bytes" in body["disk"] or "error" in body["disk"]
    assert body["secrets_configured"] is True


def test_telemetry_endpoints_wired(tmp_path):
    app, _, telemetry = _app(tmp_path)
    c = TestClient(app, headers=HDR)
    telemetry.record(kind="llm", provider="local", model="qwen", tokens_in=100, tokens_out=50, latency_ms=120.0,
                     route="/v1/patient/turn", ok=True)
    s = c.get("/admin/telemetry/summary", params={"window": "24h"})
    assert s.status_code == 200 and s.json()["calls"] == 1 and s.json()["window"] == "24h"
    assert c.get("/admin/telemetry/summary", params={"window": "1y"}).status_code == 422
    g = c.get("/admin/telemetry/gpu")
    assert g.status_code == 200 and g.json()["entries"] == [] and g.json()["spent_today_usd"] == 0.0


def test_main_app_mounts_registry_routes_and_keeps_gpu():
    from server.app import app
    paths = set(app.openapi()["paths"])
    assert {"/admin/providers", "/admin/providers/{provider_id}", "/admin/providers/{provider_id}/probe",
            "/admin/settings", "/admin/health", "/admin/telemetry/summary", "/admin/telemetry/gpu"} <= paths
    assert {"/admin/gpu/status", "/admin/gpu/start", "/admin/gpu/stop", "/admin/gpu/ledger",
            "/admin/gpu/policy"} <= paths
