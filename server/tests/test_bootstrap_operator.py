"""SSH-free deploy: /bootstrap/provision (single use), operator routes (auth, lockout), status."""

from __future__ import annotations

import json
import os
import stat
from types import SimpleNamespace

from cryptography.fernet import Fernet
from fastapi import FastAPI
from fastapi.testclient import TestClient

from server.bootstrap import handoff as hmod
from server.bootstrap.handoff import BootstrapHandoff
from server.bootstrap.operator import load_lambda_key
from server.bootstrap.operator import router
from server.bootstrap.routes import router as handoff_router
from server.bootstrap.tokens import operator_secret, provision_secret
from server.config import Settings
from server.registry.store import RegistryStore

HTTPS = {"X-Forwarded-Proto": "https", "X-Forwarded-For": "203.0.113.9"}
TOKEN = "prov-" + "x" * 40
ANT = "sk-ant-test-" + "a" * 30
LAMBDA = "secret_lambda_" + "b" * 30
USERS = [{"username": "acudx-student", "role": "student", "password": "Temp-student-123456789"}]


class Clock:
    def __init__(self, t: float = 1_800_000_000.0):
        self.t = t

    def __call__(self) -> float:
        return self.t


def _app(tmp_path, *, principal=None, clock=None):
    d = tmp_path / "bootstrap"
    d.mkdir(mode=0o700, parents=True)
    (d / "credentials.json").write_text(json.dumps({"login_url": "https://x/signin", "users": USERS}))
    h = BootstrapHandoff(d, clock=clock or Clock())
    s = Settings(_env_file=None, bootstrap_dir=str(d), acudx_db_path=str(tmp_path / "a.db"),
                 acudx_secret_key=Fernet.generate_key().decode(), lambda_key=None, anthropic_key=None)
    reg = RegistryStore(s.acudx_db_path, secret_key=s.acudx_secret_key)
    reg.ensure_anthropic_row(s)

    class Auth:
        async def authenticate(self, request):
            return principal

    app = FastAPI()
    app.state.settings = s
    app.state.bootstrap = h
    app.state.registry = reg
    app.state.auth = Auth()
    app.include_router(router)
    app.include_router(handoff_router)
    return app, h, s, reg


def _arm(h):
    provision_secret(h).store(TOKEN, ttl_hours=24, actor="test")


def test_provision_is_single_use_applies_keys_and_echoes_none(tmp_path):
    app, h, s, reg = _app(tmp_path)
    _arm(h)
    c = TestClient(app)
    r = c.post("/bootstrap/provision", json={"token": TOKEN, "anthropic_key": ANT, "lambda_key": LAMBDA}, headers=HTTPS)
    assert r.status_code == 200
    body = r.json()
    assert body["applied"] == {"anthropic": True, "lambda": True}
    assert ANT not in r.text and LAMBDA not in r.text and TOKEN not in r.text
    assert len(body["operator_token"]) >= 32
    assert reg.decrypt_key(reg.anthropic_row()) == ANT
    assert s.lambda_key == LAMBDA
    kf = h.dir / "lambda.key"
    assert kf.read_text() == LAMBDA and stat.S_IMODE(os.stat(kf).st_mode) == 0o600
    again = c.post("/bootstrap/provision", json={"token": TOKEN, "lambda_key": LAMBDA}, headers=HTTPS)
    assert again.status_code == 410 and again.json()["error"] == "used"
    raw = (h.dir / "audit.log").read_text()
    assert ANT not in raw and LAMBDA not in raw and TOKEN not in raw and body["operator_token"] not in raw
    assert TOKEN not in (h.dir / "provision.json").read_text()


def test_provision_wrong_token_locks_and_https_only(tmp_path):
    app, h, _, _ = _app(tmp_path)
    _arm(h)
    c = TestClient(app)
    assert c.post("/bootstrap/provision", json={"token": TOKEN}).status_code == 403
    for i in range(hmod.LOCK_EVERY):
        ip = {"X-Forwarded-Proto": "https", "X-Forwarded-For": f"198.51.100.{i}"}
        assert c.post("/bootstrap/provision", json={"token": "nope" * 8}, headers=ip).status_code == 401
    locked = c.post("/bootstrap/provision", json={"token": TOKEN}, headers=HTTPS)
    assert locked.status_code == 429 and "retry-after" in locked.headers


def test_provision_expires_after_24h(tmp_path):
    clock = Clock()
    app, h, _, _ = _app(tmp_path, clock=clock)
    _arm(h)
    clock.t += 24 * 3600 + 1
    r = TestClient(app).post("/bootstrap/provision", json={"token": TOKEN}, headers=HTTPS)
    assert r.status_code == 410 and r.json()["error"] == "expired"


def test_provision_rejects_malformed_keys_without_burning(tmp_path):
    app, h, _, _ = _app(tmp_path)
    _arm(h)
    c = TestClient(app)
    r = c.post("/bootstrap/provision", json={"token": TOKEN, "lambda_key": "short"}, headers=HTTPS)
    assert r.status_code == 422 and "short" not in r.text
    assert provision_secret(h).state() == "active"


def test_operator_routes_need_the_operator_token_or_a_super_admin(tmp_path):
    app, h, _, _ = _app(tmp_path)
    c = TestClient(app)
    assert c.post("/bootstrap/operator/mint-code", headers=HTTPS).status_code == 401
    op, _ = operator_secret(h).store(ttl_hours=24, actor="test")
    assert c.post("/bootstrap/operator/mint-code", headers={**HTTPS, "X-Operator-Token": "w" * 40}).status_code == 401
    r = c.post("/bootstrap/operator/mint-code", json={"ttl_hours": 72}, headers={**HTTPS, "X-Operator-Token": op})
    assert r.status_code == 200 and r.json()["single_use"] is True
    code = r.json()["code"]
    # The minted code opens the handoff exactly once.
    assert c.post("/bootstrap/credentials", data={"code": code}, headers=HTTPS).status_code == 200
    assert c.post("/bootstrap/credentials", data={"code": code}, headers=HTTPS).status_code == 410
    # The operator token is reusable (not single use) until it expires.
    assert c.post("/bootstrap/operator/mint-code", headers={**HTTPS, "X-Operator-Token": op}).status_code == 200


def test_super_admin_bearer_is_accepted_and_admin_is_not(tmp_path):
    sa = SimpleNamespace(verified=True, has=lambda r: r in ("super_admin", "admin"), user_hash="h")
    app, _, _, _ = _app(tmp_path, principal=sa)
    hdr = {**HTTPS, "Authorization": "Bearer jwt"}
    assert TestClient(app).post("/bootstrap/operator/mint-code", headers=hdr).status_code == 200
    adm = SimpleNamespace(verified=True, has=lambda r: r == "admin", user_hash="h")
    app2, _, _, _ = _app(tmp_path / "b", principal=adm)
    assert TestClient(app2).post("/bootstrap/operator/mint-code", headers=hdr).status_code == 401


def test_operator_token_lockout(tmp_path):
    app, h, _, _ = _app(tmp_path)
    op, _ = operator_secret(h).store(ttl_hours=24, actor="test")
    c = TestClient(app)
    for i in range(hmod.LOCK_EVERY):
        ip = {"X-Forwarded-Proto": "https", "X-Forwarded-For": f"192.0.2.{i}", "X-Operator-Token": "z" * 40}
        c.post("/bootstrap/operator/mint-code", headers=ip)
    assert c.post("/bootstrap/operator/mint-code", headers={**HTTPS, "X-Operator-Token": op}).status_code == 429


def test_reset_accounts_needs_the_service_client(tmp_path):
    app, h, _, _ = _app(tmp_path)
    op, _ = operator_secret(h).store(ttl_hours=24, actor="test")
    r = TestClient(app).post("/bootstrap/operator/reset-accounts", headers={**HTTPS, "X-Operator-Token": op})
    assert r.status_code == 409 and r.json()["error"] == "service_client_missing"


def test_status_is_public_and_carries_no_secret(tmp_path):
    app, h, s, _ = _app(tmp_path)
    _arm(h)
    (h.dir / "status.json").write_text(json.dumps({"stage": "ready", "updated_at": 1, "detail": "stack up"}))
    r = TestClient(app).get("/bootstrap/status")
    assert r.status_code == 200
    b = r.json()
    assert b["deploy"]["stage"] == "ready" and b["provision_token"] == "active" and b["accounts_provisioned"] is True
    assert TOKEN not in r.text


def test_lambda_key_file_is_loaded_at_startup_unless_env_set(tmp_path):
    (tmp_path / "lambda.key").write_text(LAMBDA)
    s = Settings(_env_file=None, lambda_key=None)
    load_lambda_key(s, tmp_path)
    assert s.lambda_key == LAMBDA
    s2 = Settings(_env_file=None, lambda_key="from-env-" + "c" * 20)
    load_lambda_key(s2, tmp_path)
    assert s2.lambda_key.startswith("from-env-")


def test_gpu_stop_needs_the_operator(tmp_path):
    app, h, _, _ = _app(tmp_path)
    stopped = []

    class WM:
        async def terminate(self, reason):
            stopped.append(reason)
            return None

        async def status(self):
            return {"worker": None}

    app.state.worker_manager = WM()
    c = TestClient(app)
    assert c.post("/bootstrap/operator/gpu/stop", headers=HTTPS).status_code == 401 and not stopped
    op, _ = operator_secret(h).store(ttl_hours=24, actor="test")
    hdr = {**HTTPS, "X-Operator-Token": op}
    assert c.get("/bootstrap/operator/gpu", headers=hdr).json() == {"worker": None}
    assert c.post("/bootstrap/operator/gpu/stop", headers=hdr).json() == {"terminated": None}
    assert stopped == ["operator"]
