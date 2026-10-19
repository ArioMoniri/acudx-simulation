"""Admin API: X-Admin-Token guard and the /admin/gpu surface."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from server.admin_routes import router
from server.config import Settings
from server.providers.gpu_worker import WorkerManager, WorkerStore
from server.tests.conftest import CLOUD_INIT


def _app(tmp_path, **over) -> tuple[FastAPI, WorkerManager]:
    base = dict(airgapped=True, lambda_key=None, admin_token="adm-secret",
                acudx_db_path=str(tmp_path / "acudx.db"), _env_file=None)
    base.update(over)
    s = Settings(**base)
    m = WorkerManager(s, store=WorkerStore(s.acudx_db_path), template_path=CLOUD_INIT)
    app = FastAPI()
    app.state.settings = s
    app.state.worker_manager = m
    app.include_router(router)
    return app, m


def test_admin_503_when_token_unset(tmp_path):
    app, _ = _app(tmp_path, admin_token=None)
    r = TestClient(app).get("/admin/gpu/status", headers={"X-Admin-Token": "anything"})
    assert r.status_code == 503


def test_admin_401_on_missing_or_wrong_token(tmp_path):
    app, _ = _app(tmp_path)
    c = TestClient(app)
    assert c.get("/admin/gpu/status").status_code == 401
    assert c.get("/admin/gpu/status", headers={"X-Admin-Token": "nope"}).status_code == 401


def test_admin_status_and_policy_roundtrip(tmp_path):
    app, _ = _app(tmp_path)
    c = TestClient(app, headers={"X-Admin-Token": "adm-secret"})
    st = c.get("/admin/gpu/status")
    assert st.status_code == 200
    assert st.json()["worker"] is None and st.json()["airgapped"] is True
    pol = c.get("/admin/gpu/policy").json()
    assert pol["idle_minutes"] == 20 and pol["llm_model"] == "Qwen/Qwen3-32B-AWQ"
    upd = c.put("/admin/gpu/policy", json={**pol, "idle_minutes": 7, "region_preference": ["us-east-1"]})
    assert upd.status_code == 200 and upd.json()["idle_minutes"] == 7
    assert c.get("/admin/gpu/policy").json()["region_preference"] == ["us-east-1"]
    bad = c.put("/admin/gpu/policy", json={**pol, "idle_minutes": 0})
    assert bad.status_code == 422
    assert c.get("/admin/gpu/ledger").json() == {"entries": [], "spent_today_usd": 0.0}


def test_admin_start_refused_when_airgapped(tmp_path):
    app, _ = _app(tmp_path, lambda_key="k", lambda_ssh_key_name="s")
    c = TestClient(app, headers={"X-Admin-Token": "adm-secret"})
    r = c.post("/admin/gpu/start")
    assert r.status_code == 409
    assert r.json()["detail"]["reason"] == "airgapped"


def test_admin_stop_without_worker_is_noop(tmp_path):
    app, _ = _app(tmp_path)
    c = TestClient(app, headers={"X-Admin-Token": "adm-secret"})
    r = c.post("/admin/gpu/stop")
    assert r.status_code == 200 and r.json()["terminated"] is None


def test_main_app_mounts_admin_router():
    from server.app import app
    paths = set(app.openapi()["paths"])
    assert {"/admin/gpu/status", "/admin/gpu/start", "/admin/gpu/stop",
            "/admin/gpu/ledger", "/admin/gpu/policy"} <= paths
