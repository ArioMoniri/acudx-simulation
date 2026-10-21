"""GPU workers never keep spending: orphan sweep, max lifetime cap, deploy limits, startup policy log."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import subprocess
import sys
from pathlib import Path

import httpx
import pytest
import respx

from server.config import Settings
from server.providers.gpu_worker import WorkerManager, WorkerPolicy, WorkerStore
from server.providers.lambda_cloud import LAMBDA_API_BASE
from server.tests.conftest import CLOUD_INIT, load_fixture

REPO = Path(__file__).resolve().parents[2]


class FakeClock:
    def __init__(self, t: float = 1_800_000_000.0):
        self.t = t

    def __call__(self) -> float:
        return self.t

    def advance(self, s: float) -> None:
        self.t += s


async def _sleep(_: float) -> None:
    return None


def _manager(tmp_path, clock, **over) -> WorkerManager:
    base = dict(airgapped=False, lambda_key="k", lambda_ssh_key_name="key", acudx_db_path=str(tmp_path / "a.db"),
                gpu_idle_minutes=20, admin_token="adm", _env_file=None,
                # These sweep tests use names without a gateway id (as a pre-id gateway launched them);
                # the gateway-id rules are in test_gpu_video_capacity.py.
                gpu_sweep_unowned=True)
    base.update(over)
    s = Settings(**base)
    return WorkerManager(s, store=WorkerStore(s.acudx_db_path), clock=clock, sleep=_sleep, template_path=CLOUD_INIT,
                         poll_interval_s=0, boot_timeout_s=60, ready_timeout_s=60)


def _instance(iid: str, name: str | None, *, status: str = "active", tags: list | None = None) -> dict:
    base = load_fixture("instances")["data"][1]
    return {**base, "id": iid, "name": name, "status": status, "tags": tags or []}


def _ready(m: WorkerManager, clock: FakeClock, iid: str = "i-ready", *, launched_at: float | None = None):
    t = clock.t if launched_at is None else launched_at
    w = m.store.insert_worker(instance_id=iid, instance_type="gpu_1x_a10", region="us-east-1", token="t",
                              status="ready", price_cents_per_hour=129, launched_at=t, last_used_at=clock.t,
                              ip="10.0.0.1", domain="10-0-0-1.sslip.io", ready_at=t)
    m.store.open_ledger(w)
    return w


def _terminated_ids(route) -> list[str]:
    return [i for c in route.calls for i in json.loads(c.request.content)["instance_ids"]]


# --- orphan sweep ---------------------------------------------------------- #

@respx.mock
async def test_orphan_sweep_terminates_only_old_unowned_worker_instances(tmp_path):
    clock = FakeClock()
    m = _manager(tmp_path, clock)
    old = int(clock.t - 11 * 60)
    young = int(clock.t - 5 * 60)
    instances = [
        _instance("i-owned", f"acudx-worker-{old}-aaaa"),          # has an active row
        _instance("i-orphan", f"acudx-worker-{old}-bbbb"),         # no row, 11 min old -> terminated
        _instance("i-young", f"acudx-worker-{young}-cccc"),        # no row, 5 min old -> kept for now
        _instance("i-gone", f"acudx-worker-{old}-dddd", status="terminated"),
        _instance("i-wm", "acudx-wm-a10"),                          # someone else's: never touched
        _instance("i-wm-tagged", "acudx-wm-a10", tags=[{"key": "acudx", "value": "gpu-worker"}]),
        _instance("i-liver", "Liver"),
        _instance("i-other-nameless", None),
    ]
    respx.get(f"{LAMBDA_API_BASE}/instances").mock(return_value=httpx.Response(200, json={"data": instances}))
    term = respx.post(f"{LAMBDA_API_BASE}/instance-operations/terminate").mock(
        return_value=httpx.Response(200, json={"data": {"terminated_instances": []}}))
    try:
        _ready(m, clock, "i-owned")
        assert await m.sweep_orphans() == ["i-orphan"]
        assert _terminated_ids(term) == ["i-orphan"]
        clock.advance(6 * 60)                                     # the young one is now 11 min old
        assert await m.sweep_orphans() == ["i-orphan", "i-young"]
    finally:
        await m.aclose()
    assert not {"i-owned", "i-gone", "i-wm", "i-wm-tagged", "i-liver", "i-other-nameless"} & set(_terminated_ids(term))


@respx.mock
async def test_orphan_sweep_never_touches_instances_that_are_not_ours(tmp_path):
    """Only ``acudx-worker-*`` (or a nameless instance tagged acudx=gpu-worker) is ever terminated,
    however old and however many sweeps see it."""
    clock = FakeClock()
    m = _manager(tmp_path, clock)
    foreign = [_instance("i-wm", "acudx-wm-a10"), _instance("i-liver", "Liver"),
               _instance("i-acudx", "acudx-workers-dev"), _instance("i-prefix", "my-acudx-worker-1"),
               _instance("i-nameless", None, tags=[{"key": "acudx", "value": "other"}])]
    respx.get(f"{LAMBDA_API_BASE}/instances").mock(return_value=httpx.Response(200, json={"data": foreign}))
    term = respx.post(f"{LAMBDA_API_BASE}/instance-operations/terminate").mock(
        return_value=httpx.Response(200, json={"data": {"terminated_instances": []}}))
    try:
        for _ in range(4):
            assert await m.sweep_orphans() == []
            clock.advance(24 * 3600)
    finally:
        await m.aclose()
    assert not term.called


@respx.mock
async def test_an_orphan_without_a_launch_time_needs_two_consecutive_sweeps(tmp_path):
    clock = FakeClock()
    m = _manager(tmp_path, clock)
    tagged = [{"key": "acudx", "value": "gpu-worker"}]
    listing = respx.get(f"{LAMBDA_API_BASE}/instances")
    listing.mock(return_value=httpx.Response(200, json={"data": [
        _instance("i-odd", "acudx-worker-manual"), _instance("i-nameless", None, tags=tagged)]}))
    term = respx.post(f"{LAMBDA_API_BASE}/instance-operations/terminate").mock(
        return_value=httpx.Response(200, json={"data": {"terminated_instances": []}}))
    try:
        assert await m.sweep_orphans() == []
        assert not term.called
        assert await m.sweep_orphans() == ["i-odd", "i-nameless"]
        # Seen once, then owned (or gone) on the next sweep: the count starts over.
        listing.mock(return_value=httpx.Response(200, json={"data": [_instance("i-late", "acudx-worker-x")]}))
        assert await m.sweep_orphans() == []
        listing.mock(return_value=httpx.Response(200, json={"data": []}))
        assert await m.sweep_orphans() == []
        listing.mock(return_value=httpx.Response(200, json={"data": [_instance("i-late", "acudx-worker-x")]}))
        assert await m.sweep_orphans() == []
    finally:
        await m.aclose()


@respx.mock
async def test_orphan_sweep_survives_a_provider_error_and_skips_when_airgapped(tmp_path):
    clock = FakeClock()
    m = _manager(tmp_path, clock)
    respx.get(f"{LAMBDA_API_BASE}/instances").mock(side_effect=httpx.ConnectError("down"))
    try:
        assert await m.sweep_orphans() == []
    finally:
        await m.aclose()
    gapped = _manager(tmp_path / "g", clock, airgapped=True)
    try:
        assert await gapped.sweep_orphans() == []
    finally:
        await gapped.aclose()


@respx.mock
async def test_the_reaper_sweeps_orphans_on_start(tmp_path):
    clock = FakeClock()
    m = _manager(tmp_path, clock)
    old = int(clock.t - 3600)
    respx.get(f"{LAMBDA_API_BASE}/instances").mock(return_value=httpx.Response(200, json={"data": [
        _instance("i-orphan", f"acudx-worker-{old}-beef")]}))
    term = respx.post(f"{LAMBDA_API_BASE}/instance-operations/terminate").mock(
        return_value=httpx.Response(200, json={"data": {"terminated_instances": []}}))
    m.start_reaper(interval_s=0.01)
    try:
        for _ in range(200):
            if term.called:
                break
            await asyncio.sleep(0.01)
    finally:
        await m.aclose()
    assert _terminated_ids(term)[:1] == ["i-orphan"]


# --- max lifetime ----------------------------------------------------------- #

def test_max_lifetime_defaults_to_six_hours_and_comes_from_the_env(tmp_path):
    assert WorkerPolicy().max_lifetime_hours == 6
    m = _manager(tmp_path, FakeClock(), gpu_max_lifetime_hours=2.5)
    assert m.policy.max_lifetime_hours == 2.5
    with pytest.raises(ValueError):
        WorkerPolicy(max_lifetime_hours=0)
    # A policy saved before the field existed loads with the default.
    store = WorkerStore(str(tmp_path / "old.db"))
    with store._conn() as c:
        c.execute("INSERT INTO gpu_policy (id, body, updated_at) VALUES (1, ?, 0)", ('{"idle_minutes": 7}',))
    assert store.get_policy().max_lifetime_hours == 6


async def test_reaper_stops_a_busy_worker_at_its_max_lifetime(tmp_path):
    clock = FakeClock()
    m = _manager(tmp_path, clock, gpu_max_lifetime_hours=6)
    stopped: list[list[str]] = []

    class _Api:
        async def terminate(self, ids):
            stopped.append(list(ids))
            return ids

        async def get_instance(self, _iid):
            raise httpx.ConnectError("offline")

    m._lambda = lambda: _Api()  # type: ignore[method-assign]
    w = _ready(m, clock)
    m.set_calls(w.domain, 1)
    m.begin(w.domain)                                   # in use: never idle
    clock.advance(5.9 * 3600)
    m.touch(w.domain)
    m.set_calls(w.domain, 1)
    assert await m.reap_once() is False
    clock.advance(0.2 * 3600)
    m.touch(w.domain)
    m.set_calls(w.domain, 1)
    assert await m.reap_once() is True
    assert stopped == [[w.instance_id]]
    assert m.store.ledger(limit=1)[0].reason == "max_lifetime"
    await m.aclose()


# --- startup policy log ------------------------------------------------------ #

def test_effective_policy_is_logged_and_says_when_a_saved_policy_overrides_env(tmp_path, caplog):
    clock = FakeClock()
    m = _manager(tmp_path, clock, gpu_idle_minutes=15, gpu_max_workers=2, gpu_max_lifetime_hours=4,
                 gpu_daily_budget_usd=30.0)
    with caplog.at_level(logging.INFO, logger="acudx.gpu_worker"):
        line = m.log_policy()
    assert "from env" in line and "idle_minutes=15" in line and "max_workers=2" in line
    assert "max_lifetime_hours=4" in line and "daily_budget_usd=30" in line
    assert line in caplog.text
    m.set_policy(WorkerPolicy(idle_minutes=9, max_workers=1))
    again = _manager(tmp_path, clock, gpu_idle_minutes=15)
    line = again.log_policy()
    assert "saved in SQLite, overrides env" in line and "idle_minutes=9" in line and "daily_budget_usd=none" in line


async def test_starting_the_reaper_logs_the_policy(tmp_path, caplog):
    m = _manager(tmp_path, FakeClock(), airgapped=True)
    with caplog.at_level(logging.INFO, logger="acudx.gpu_worker"):
        m.start_reaper(interval_s=10)
        await m.aclose()
    assert "gpu policy (from env)" in caplog.text


# --- deploy/one-click.sh keeps the spend limits ----------------------------- #

def _env_writer() -> str:
    script = (REPO / "deploy" / "one-click.sh").read_text(encoding="utf-8")
    m = re.search(r'python3 - "\$ETC/gateway.env" <<\'PY\'\n(.*?)\nPY\n', script, re.S)
    assert m, "the gateway.env writer moved"
    return m.group(1)


def _run_writer(path: Path, **env: str) -> dict[str, str]:
    clean = {k: v for k, v in os.environ.items() if not k.startswith(("GPU_", "LAMBDA_", "ANTHROPIC_"))}
    subprocess.run([sys.executable, "-c", _env_writer(), str(path)], env={**clean, **env}, check=True)
    return dict(line.split("=", 1) for line in path.read_text().splitlines() if "=" in line)


def test_one_click_writes_and_keeps_the_gpu_spend_limits(tmp_path):
    env = tmp_path / "gateway.env"
    env.write_text("ADMIN_TOKEN=x\nGPU_DAILY_BUDGET_USD=12\n")
    out = _run_writer(env, GPU_MAX_WORKERS="2", GPU_MAX_LIFETIME_HOURS="4")
    assert out["GPU_DAILY_BUDGET_USD"] == "12", "a budget already on the host is no longer stripped"
    assert out["GPU_MAX_WORKERS"] == "2" and out["GPU_MAX_LIFETIME_HOURS"] == "4"
    assert out["GPU_IDLE_MINUTES"] == "20" and out["ADMIN_TOKEN"] == "x"
    out = _run_writer(env, GPU_DAILY_BUDGET_USD="40")
    assert out["GPU_DAILY_BUDGET_USD"] == "40" and out["GPU_MAX_WORKERS"] == "2"
    assert list(env.read_text().splitlines()).count("GPU_DAILY_BUDGET_USD=40") == 1
    bare = tmp_path / "bare.env"
    bare.write_text("ADMIN_TOKEN=y\n")
    out = _run_writer(bare)
    assert not {"GPU_DAILY_BUDGET_USD", "GPU_MAX_WORKERS", "GPU_MAX_LIFETIME_HOURS"} & set(out)
