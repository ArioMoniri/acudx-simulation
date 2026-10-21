"""One-time credential handoff: single use, expiry, lockout, HTTPS only, audit."""

from __future__ import annotations

import json
import os
import stat

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from server.bootstrap import handoff as hmod
from server.bootstrap.handoff import BootstrapHandoff, format_code
from server.bootstrap.mint import main as mint_main
from server.bootstrap.routes import router
from server.config import Settings

USERS = [
    {"username": "acudx-student", "role": "student", "password": "T3mp-student-0000000000"},
    {"username": "acudx-super-admin", "role": "super_admin", "password": "T3mp-super-1111111111"},
]
HTTPS = {"X-Forwarded-Proto": "https", "X-Forwarded-For": "203.0.113.7"}


class Clock:
    def __init__(self, t: float = 1_800_000_000.0):
        self.t = t

    def __call__(self) -> float:
        return self.t


def _provision(tmp_path, clock: Clock | None = None) -> BootstrapHandoff:
    d = tmp_path / "bootstrap"
    d.mkdir(mode=0o700, parents=True)
    (d / "credentials.json").write_text(json.dumps({"login_url": "https://x.example/signin", "users": USERS}))
    return BootstrapHandoff(d, clock=clock or Clock())


def _client(h: BootstrapHandoff, *, require_https: bool = True) -> TestClient:
    app = FastAPI()
    app.state.settings = Settings(_env_file=None, bootstrap_dir=str(h.dir), bootstrap_require_https=require_https)
    app.state.bootstrap = h
    app.include_router(router)
    return TestClient(app)


def test_single_use_reveals_once_then_410(tmp_path):
    h = _provision(tmp_path)
    code, _ = h.mint(72)
    c = _client(h)
    assert c.get("/bootstrap/credentials", headers=HTTPS).status_code == 200
    r = c.post("/bootstrap/credentials", data={"code": format_code(code).lower()}, headers=HTTPS)
    assert r.status_code == 200
    assert "acudx-super-admin" in r.text and "T3mp-super-1111111111" in r.text
    assert r.headers["cache-control"].startswith("no-store")
    assert "default-src 'none'" in r.headers["content-security-policy"]
    again = c.post("/bootstrap/credentials", data={"code": code}, headers=HTTPS)
    assert again.status_code == 410 and "T3mp" not in again.text
    assert c.get("/bootstrap/credentials", headers=HTTPS).status_code == 410


def test_code_is_never_stored_in_plaintext(tmp_path):
    h = _provision(tmp_path)
    code, _ = h.mint(72)
    blob = (h.dir / "code.json").read_text()
    assert code not in blob and format_code(code) not in blob
    assert stat.S_IMODE(os.stat(h.dir / "code.json").st_mode) == 0o600
    assert len(code) >= 32


def test_expiry_after_ttl(tmp_path):
    clock = Clock()
    h = _provision(tmp_path, clock)
    code, expires = h.mint(72)
    assert expires == pytest.approx(clock.t + 72 * 3600)
    clock.t = expires + 1
    c = _client(h)
    assert c.get("/bootstrap/credentials", headers=HTTPS).status_code == 410
    r = c.post("/bootstrap/credentials", data={"code": code}, headers=HTTPS)
    assert r.status_code == 410 and "expired" in r.text


def test_global_lockout_after_wrong_codes_blocks_even_the_right_code(tmp_path):
    clock = Clock()
    h = _provision(tmp_path, clock)
    code, _ = h.mint(72)
    c = _client(h)
    for i in range(hmod.LOCK_EVERY):
        ip = {"X-Forwarded-Proto": "https", "X-Forwarded-For": f"198.51.100.{i}"}
        assert c.post("/bootstrap/credentials", data={"code": "WRONG" * 7}, headers=ip).status_code == 401
    locked = c.post("/bootstrap/credentials", data={"code": code}, headers=HTTPS)
    assert locked.status_code == 429 and int(locked.headers["retry-after"]) > 0
    assert "T3mp" not in locked.text
    clock.t += hmod.LOCK_S + 1
    assert c.post("/bootstrap/credentials", data={"code": code}, headers=HTTPS).status_code == 200


def test_per_ip_rate_limit(tmp_path):
    h = _provision(tmp_path)
    h.mint(72)
    # A per-IP limit below the global lock: lower the global threshold out of the way.
    statuses = []
    for _ in range(hmod.IP_MAX_FAILURES + 1):
        statuses.append(h.redeem("nope" * 8, ip="192.0.2.1").status)
        st = json.loads((h.dir / "code.json").read_text())
        st["locked_until"] = 0.0
        (h.dir / "code.json").write_text(json.dumps(st))
    assert statuses[:hmod.IP_MAX_FAILURES] == [401] * hmod.IP_MAX_FAILURES
    assert statuses[-1] == 429


def test_burned_after_too_many_failures(tmp_path):
    clock = Clock()
    h = _provision(tmp_path, clock)
    code, _ = h.mint(72)
    last = None
    for i in range(hmod.BURN_AFTER):
        clock.t += hmod.LOCK_S + 1
        last = h.redeem("bad" * 11, ip=f"10.0.{i // 250}.{i % 250}")
    assert last is not None and last.status == 410 and last.reason == "too_many_failures"
    assert h.redeem(code, ip="10.9.9.9").status == 410


def test_rotate_mints_a_new_code_and_old_one_stops_working(tmp_path):
    h = _provision(tmp_path)
    old, _ = h.mint(72)
    assert h.redeem(old, ip="1.1.1.1").status == 200
    new, _ = h.mint(72)
    assert h.redeem(old, ip="1.1.1.1").status == 401  # the rotated state no longer knows the old code
    assert h.redeem(new, ip="1.1.1.1").status == 200
    h2 = _provision(tmp_path / "b")
    a, _ = h2.mint(72)
    b, _ = h2.mint(72)
    assert h2.redeem(a, ip="1.1.1.1").status == 401  # superseded, never valid again
    assert h2.redeem(b, ip="1.1.1.1").status == 200
    assert new != old


def test_plain_http_is_refused(tmp_path):
    h = _provision(tmp_path)
    code, _ = h.mint(72)
    c = _client(h)
    assert c.get("/bootstrap/credentials").status_code == 403
    r = c.post("/bootstrap/credentials", data={"code": code}, headers={"X-Forwarded-Proto": "http"})
    assert r.status_code == 403
    # The refused attempt did not burn the code.
    assert c.post("/bootstrap/credentials", data={"code": code}, headers=HTTPS).status_code == 200


def test_audit_log_has_every_attempt_and_no_secret(tmp_path):
    h = _provision(tmp_path)
    code, _ = h.mint(72)
    c = _client(h)
    c.post("/bootstrap/credentials", data={"code": "x" * 32}, headers=HTTPS)
    c.post("/bootstrap/credentials", data={"code": code}, headers=HTTPS)
    entries = h.audit_entries()
    assert [e["event"] for e in entries] == ["minted", "redeem", "redeem"]
    assert [e.get("outcome") for e in entries[1:]] == ["wrong_code", "revealed"]
    assert entries[2]["ip"] == "203.0.113.7"
    raw = (h.dir / "audit.log").read_text()
    assert code not in raw and "T3mp" not in raw


def test_not_provisioned_is_404(tmp_path):
    h = BootstrapHandoff(tmp_path / "empty")
    c = _client(h)
    assert c.get("/bootstrap/credentials", headers=HTTPS).status_code == 404
    assert c.post("/bootstrap/credentials", data={"code": "a" * 32}, headers=HTTPS).status_code == 404


def test_mint_cli_writes_code_file_root_only(tmp_path, capsys):
    import time  # noqa: PLC0415 - the CLI mints with the real clock

    h = _provision(tmp_path, time.time)  # type: ignore[arg-type]
    out = tmp_path / "code.txt"
    assert mint_main(["--dir", str(h.dir), "--ttl-hours", "72", "--code-file", str(out)]) == 0
    code = out.read_text().strip()
    assert stat.S_IMODE(os.stat(out).st_mode) == 0o600
    assert code not in capsys.readouterr().out
    assert h.redeem(code, ip="1.2.3.4").status == 200
