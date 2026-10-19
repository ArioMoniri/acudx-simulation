"""WorkerManager behaviour: launch policy, cloud-init rendering, idle reaper, budget, air-gap."""

from __future__ import annotations

import json

import httpx
import pytest
import respx

from server.config import Settings
from server.providers.gpu_worker import (
    AirgappedRefused,
    BudgetExceeded,
    NoCapacity,
    NotConfigured,
    WorkerManager,
    WorkerPolicy,
    WorkerStore,
    render_cloud_init,
    sslip_domain,
)
from server.providers.lambda_cloud import LAMBDA_API_BASE
from server.tests.conftest import CLOUD_INIT, load_fixture

INSTANCE_ID = "ea19e031f2c7406c821a88f077d96d9b"
IP = "150.136.117.213"
DOMAIN = "150-136-117-213.sslip.io"


class FakeClock:
    def __init__(self, t: float = 1_800_000_000.0):
        self.t = t

    def __call__(self) -> float:
        return self.t

    def advance(self, seconds: float) -> None:
        self.t += seconds


def _settings(tmp_path, **over) -> Settings:
    base = dict(
        airgapped=False, lambda_key="secret_test_key", lambda_ssh_key_name="acudx-claude-mac",
        acudx_db_path=str(tmp_path / "acudx.db"), gpu_idle_minutes=20, gpu_daily_budget_usd=25.0,
        admin_token="adm", _env_file=None,
    )
    base.update(over)
    return Settings(**base)


async def _sleep(_: float) -> None:
    return None


def _manager(tmp_path, clock, **over) -> WorkerManager:
    s = _settings(tmp_path, **over)
    return WorkerManager(s, store=WorkerStore(s.acudx_db_path), clock=clock, sleep=_sleep,
                         template_path=CLOUD_INIT, poll_interval_s=0, boot_timeout_s=60, ready_timeout_s=60)


def _launch_calls():
    return [c for c in respx.calls if c.request.url.path.endswith("/instance-operations/launch")]


def _mock_launch_flow():
    """respx routes for a full launch: types, firewall GET/PUT, launch, poll, healthz."""
    respx.get(f"{LAMBDA_API_BASE}/instance-types").mock(
        return_value=httpx.Response(200, json=load_fixture("instance-types")))
    respx.get(f"{LAMBDA_API_BASE}/firewall-rules").mock(
        return_value=httpx.Response(200, json=load_fixture("firewall-rules")))
    put = respx.put(f"{LAMBDA_API_BASE}/firewall-rules").mock(return_value=httpx.Response(200, json={"data": []}))
    launch = respx.post(f"{LAMBDA_API_BASE}/instance-operations/launch").mock(
        return_value=httpx.Response(200, json={"data": {"instance_ids": [INSTANCE_ID]}}))
    inst = load_fixture("instances")["data"][1]
    booting = {**inst, "status": "booting", "ip": None}
    respx.get(f"{LAMBDA_API_BASE}/instances/{INSTANCE_ID}").mock(side_effect=[
        httpx.Response(200, json={"data": booting}), httpx.Response(200, json={"data": inst})])
    health = respx.get(f"https://{DOMAIN}/healthz").mock(side_effect=[
        httpx.Response(502), httpx.Response(200, text="ok")])
    return put, launch, health


# --- pure helpers ---------------------------------------------------------- #

def test_sslip_domain():
    assert sslip_domain("1.2.3.4") == "1-2-3-4.sslip.io"
    assert sslip_domain(IP) == DOMAIN


def test_render_cloud_init_replaces_every_marker(cloud_init_template):
    out = render_cloud_init(cloud_init_template, token="tok123", llm_model="Qwen/Qwen3-32B-AWQ", domain=DOMAIN)
    assert "__WORKER_TOKEN__" not in out and "__WORKER_LLM_MODEL__" not in out and "__WORKER_DOMAIN__" not in out
    assert "WORKER_TOKEN=tok123" in out
    assert "WORKER_LLM_MODEL=Qwen/Qwen3-32B-AWQ" in out
    assert f"WORKER_DOMAIN={DOMAIN}" in out
    assert out.startswith("#cloud-config")
    assert len(out.encode()) <= 1_000_000


def test_render_cloud_init_rejects_unknown_marker():
    with pytest.raises(ValueError):
        render_cloud_init("#cloud-config\nX=__WORKER_UNKNOWN__\n", token="t", llm_model="m", domain="d")


# --- policy persistence ---------------------------------------------------- #

def test_policy_defaults_and_persist(tmp_path):
    store = WorkerStore(str(tmp_path / "acudx.db"))
    assert store.get_policy() is None
    store.set_policy(WorkerPolicy(idle_minutes=5, daily_budget_usd=3.5))
    again = WorkerStore(str(tmp_path / "acudx.db")).get_policy()
    assert again.idle_minutes == 5 and again.daily_budget_usd == 3.5
    assert again.llm_model == "Qwen/Qwen3-32B-AWQ"
    assert again.allowlist[0] == "gpu_1x_a100_sxm4"


# --- launch path ----------------------------------------------------------- #

@respx.mock
async def test_ensure_worker_launches_cheapest_and_waits_for_health(tmp_path):
    clock = FakeClock()
    put, launch, health = _mock_launch_flow()
    m = _manager(tmp_path, clock)
    try:
        w = await m.ensure_worker()
    finally:
        await m.aclose()
    assert w.instance_id == INSTANCE_ID
    assert w.instance_type == "gpu_1x_a10" and w.region == "us-east-1"
    assert w.price_cents_per_hour == 129
    assert w.ip == IP and w.domain == DOMAIN
    assert w.status == "ready" and w.ready_at is not None
    assert len(w.token) >= 32
    # Firewall: PUT carried the 11 existing rules plus 80/443.
    sent = json.loads(put.calls.last.request.content)["data"]
    assert len(sent) == 13
    body = json.loads(launch.calls.last.request.content)
    assert body["ssh_key_names"] == ["acudx-claude-mac"]
    assert f"WORKER_TOKEN={w.token}" in body["user_data"]
    # The public IP is unknown before launch: the template resolves the domain at boot.
    assert "WORKER_DOMAIN=auto" in body["user_data"]
    assert body["tags"] == [{"key": "acudx", "value": "gpu-worker"}]
    # Health probe used the bearer token.
    assert health.calls.last.request.headers["authorization"] == f"Bearer {w.token}"
    # Ledger has one open entry.
    ledger = m.store.ledger()
    assert len(ledger) == 1 and ledger[0].ended_at is None and ledger[0].instance_id == INSTANCE_ID
    # Public status never leaks the bearer token.
    st = await m.status()
    assert st["worker"]["domain"] == DOMAIN and "token" not in st["worker"]


@respx.mock
async def test_ensure_worker_reuses_healthy_worker(tmp_path):
    clock = FakeClock()
    _mock_launch_flow()
    m = _manager(tmp_path, clock)
    try:
        first = await m.ensure_worker()
        respx.get(f"https://{DOMAIN}/healthz").mock(return_value=httpx.Response(200, text="ok"))
        clock.advance(60)
        second = await m.ensure_worker()
    finally:
        await m.aclose()
    assert second.instance_id == first.instance_id
    assert second.last_used_at > first.last_used_at
    assert len(_launch_calls()) == 1


@respx.mock
async def test_ensure_worker_skips_firewall_put_when_rules_present(tmp_path):
    clock = FakeClock()
    rules = load_fixture("firewall-rules")
    rules["data"] += [{"protocol": "tcp", "port_range": [80, 80], "source_network": "0.0.0.0/0", "description": "x"},
                      {"protocol": "tcp", "port_range": [443, 443], "source_network": "0.0.0.0/0", "description": "y"}]
    put, _, _ = _mock_launch_flow()
    respx.get(f"{LAMBDA_API_BASE}/firewall-rules").mock(return_value=httpx.Response(200, json=rules))
    m = _manager(tmp_path, clock)
    try:
        await m.ensure_worker()
    finally:
        await m.aclose()
    assert not put.called


@respx.mock
async def test_no_capacity_in_allowlist_refuses(tmp_path):
    clock = FakeClock()
    _mock_launch_flow()
    m = _manager(tmp_path, clock)
    m.set_policy(m.policy.model_copy(update={"allowlist": ["gpu_1x_h100_pcie"]}))
    try:
        with pytest.raises(NoCapacity):
            await m.ensure_worker()
    finally:
        await m.aclose()
    assert _launch_calls() == []


# --- policy gates ---------------------------------------------------------- #

async def test_airgapped_blocks_launch(tmp_path):
    clock = FakeClock()
    m = _manager(tmp_path, clock, airgapped=True)
    try:
        with pytest.raises(AirgappedRefused) as ei:
            await m.ensure_worker()
        assert "AIRGAPPED" in str(ei.value)
        st = await m.status()
        assert st["airgapped"] is True and st["can_launch"] is False
    finally:
        await m.aclose()


async def test_missing_key_is_not_configured(tmp_path):
    clock = FakeClock()
    m = _manager(tmp_path, clock, lambda_key=None)
    try:
        with pytest.raises(NotConfigured):
            await m.ensure_worker()
        st = await m.status()
        assert st["configured"] is False and st["can_launch"] is False
    finally:
        await m.aclose()


@respx.mock
async def test_budget_cap_blocks_launch(tmp_path):
    clock = FakeClock()
    _mock_launch_flow()
    # Budget 1 USD; the cheapest option costs 1.29 USD/h, so even one projected hour exceeds it.
    m = _manager(tmp_path, clock, gpu_daily_budget_usd=1.0)
    try:
        with pytest.raises(BudgetExceeded):
            await m.ensure_worker()
    finally:
        await m.aclose()
    assert _launch_calls() == []


@respx.mock
async def test_budget_counts_todays_spend(tmp_path):
    clock = FakeClock()
    _mock_launch_flow()
    respx.post(f"{LAMBDA_API_BASE}/instance-operations/terminate").mock(
        return_value=httpx.Response(200, json={"data": {"terminated_instances": []}}))
    # 3 USD budget: a first run of 1.5 h at 1.29 USD/h (= 1.935) fits; a second projected hour does not.
    m = _manager(tmp_path, clock, gpu_daily_budget_usd=3.0)
    try:
        await m.ensure_worker()
        clock.advance(1.5 * 3600)
        await m.terminate(reason="test")
        assert m.spent_today_usd() == pytest.approx(1.935, abs=0.01)
        with pytest.raises(BudgetExceeded):
            await m.ensure_worker()
    finally:
        await m.aclose()
    assert len(_launch_calls()) == 1


# --- idle reaper ----------------------------------------------------------- #

@respx.mock
async def test_idle_reaper_terminates_after_idle_window(tmp_path):
    clock = FakeClock()
    _mock_launch_flow()
    term = respx.post(f"{LAMBDA_API_BASE}/instance-operations/terminate").mock(
        return_value=httpx.Response(200, json={"data": {"terminated_instances": []}}))
    m = _manager(tmp_path, clock)
    try:
        await m.ensure_worker()
        clock.advance(19 * 60)
        assert await m.reap_once() is False
        assert not term.called
        clock.advance(2 * 60)          # 21 min idle > 20
        assert await m.reap_once() is True
        st = await m.status()
    finally:
        await m.aclose()
    assert term.called
    assert st["worker"] is None
    ledger = m.store.ledger()
    assert ledger[0].ended_at is not None and ledger[0].reason == "idle"
    assert ledger[0].cost_usd == pytest.approx(1.29 * 21 / 60, abs=0.001)


@respx.mock
async def test_touch_resets_idle_window(tmp_path):
    clock = FakeClock()
    _mock_launch_flow()
    term = respx.post(f"{LAMBDA_API_BASE}/instance-operations/terminate").mock(
        return_value=httpx.Response(200, json={"data": {"terminated_instances": []}}))
    m = _manager(tmp_path, clock)
    try:
        await m.ensure_worker()
        clock.advance(15 * 60)
        m.touch()
        clock.advance(15 * 60)
        assert await m.reap_once() is False
    finally:
        await m.aclose()
    assert not term.called


async def test_reaper_task_starts_and_stops(tmp_path):
    clock = FakeClock()
    m = _manager(tmp_path, clock)
    m.start_reaper(interval_s=0.01)
    assert m.reaper_running
    await m.stop_reaper()
    assert not m.reaper_running
    await m.aclose()
