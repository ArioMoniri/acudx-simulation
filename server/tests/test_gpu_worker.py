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
    # First poll: booting; every later read (launch poll, reaper reconcile): active.
    polls = {"n": 0}

    def _instance(_request: httpx.Request) -> httpx.Response:
        polls["n"] += 1
        return httpx.Response(200, json={"data": booting if polls["n"] == 1 else inst})

    respx.get(f"{LAMBDA_API_BASE}/instances/{INSTANCE_ID}").mock(side_effect=_instance)
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
    assert again.llm_model == "Qwen/Qwen3-14B-AWQ"
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
    # Firewall: PUT carried the 11 existing rules plus 80/443 and TURN 3478 udp/tcp.
    sent = json.loads(put.calls.last.request.content)["data"]
    assert len(sent) == 15
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
                      {"protocol": "tcp", "port_range": [443, 443], "source_network": "0.0.0.0/0", "description": "y"},
                      {"protocol": "udp", "port_range": [3478, 3478], "source_network": "0.0.0.0/0", "description": "z"},
                      {"protocol": "tcp", "port_range": [3478, 3478], "source_network": "0.0.0.0/0", "description": "w"}]
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


async def test_reaper_never_counts_boot_time_as_idle(tmp_path):
    """Live finding 2026-10-19: a cold boot (image + weights pull) ran past the idle
    window and the reaper terminated the worker before it ever became ready."""
    clock = FakeClock()
    m = _manager(tmp_path, clock, gpu_idle_minutes=1)      # boot budget 60 s + ready budget 60 s
    try:
        w = m.store.insert_worker(instance_id="i-boot", instance_type="gpu_1x_a100_sxm4", region="us-east-1",
                                  token="t", status="booting", price_cents_per_hour=199,
                                  launched_at=clock.t, last_used_at=clock.t)
        m.store.open_ledger(w)
        clock.advance(100)                                   # past the 60 s idle window, inside the boot budgets
        assert await m.reap_once() is False
        assert m.store.active_worker() is not None and m.store.active_worker().status == "booting"
    finally:
        await m.aclose()


# --- review 04: reaper covers the daily budget and orphaned boots ---------- #

@respx.mock
async def test_reaper_terminates_a_busy_worker_once_the_daily_budget_is_spent(tmp_path):
    """The launch-time projection alone lets a worker that is touched every minute run past the
    cap; the reaper enforces the daily budget on a running worker."""
    clock = FakeClock()
    _mock_launch_flow()
    term = respx.post(f"{LAMBDA_API_BASE}/instance-operations/terminate").mock(
        return_value=httpx.Response(200, json={"data": {"terminated_instances": []}}))
    m = _manager(tmp_path, clock, gpu_daily_budget_usd=3.0, gpu_idle_minutes=600)
    try:
        await m.ensure_worker()
        clock.advance(1.0 * 3600)
        m.touch()
        assert await m.reap_once() is False          # 1.29 USD spent, under budget, not idle
        clock.advance(1.5 * 3600)
        m.touch()                                    # still busy: 3.2 USD spent >= 3.0 budget
        assert await m.reap_once() is True
        assert term.called and m.store.active_worker() is None
        assert m.store.ledger(limit=1)[0].reason == "budget"
    finally:
        await m.aclose()


@respx.mock
async def test_reaper_terminates_an_orphaned_boot_after_both_budgets(tmp_path):
    """A gateway restart mid-boot leaves a 'booting' row with no in-flight watcher; nothing
    else would ever terminate that instance."""
    clock = FakeClock()
    term = respx.post(f"{LAMBDA_API_BASE}/instance-operations/terminate").mock(
        return_value=httpx.Response(200, json={"data": {"terminated_instances": []}}))
    m = _manager(tmp_path, clock)
    try:
        w = m.store.insert_worker(instance_id=INSTANCE_ID, instance_type="gpu_1x_a10", region="us-east-1",
                                  token="t", status="booting", price_cents_per_hour=75, launched_at=clock.t,
                                  last_used_at=clock.t)
        m.store.open_ledger(w)
        clock.advance(m.boot_timeout_s + m.ready_timeout_s - 1)
        assert await m.reap_once() is False          # inside the boot budgets: hands off
        clock.advance(2)
        assert await m.reap_once() is True
        assert term.called and m.store.active_worker() is None
        assert m.store.ledger(limit=1)[0].reason == "stale_boot"
    finally:
        await m.aclose()


# --- review 04 O1: the bearer token never travels in a plaintext URL -------- #

def _ready_worker(m: WorkerManager, clock: FakeClock, token: str = "tok-abc_123", status: str = "ready"):
    w = m.store.insert_worker(instance_id=INSTANCE_ID, instance_type="gpu_1x_a10", region="us-east-1", token=token,
                              status=status, price_cents_per_hour=129, launched_at=clock.t, last_used_at=clock.t,
                              ip=IP, domain=DOMAIN)
    m.store.open_ledger(w)
    return w


def test_diag_secret_is_an_hmac_of_the_token_and_matches_the_worker_side_openssl_command():
    import hashlib
    import hmac
    import shutil
    import subprocess

    from server.providers.gpu_worker import diag_secret

    token = "tok-abc_123"
    expected = hmac.new(token.encode(), b"acudx-diag-v1", hashlib.sha256).hexdigest()[:32]
    assert diag_secret(token) == expected == "68557a6d26d970bccb1ed2fdf6dddeb1"
    assert token not in diag_secret(token) and len(diag_secret(token)) == 32
    cmd = "printf '%s' acudx-diag-v1 | openssl dgst -sha256 -hmac \"$WORKER_TOKEN\" -r | cut -c1-32"
    assert cmd in CLOUD_INIT.read_text(encoding="utf-8")
    if shutil.which("openssl") and shutil.which("bash"):
        got = subprocess.run(["bash", "-c", cmd], env={"WORKER_TOKEN": token, "PATH": "/usr/bin:/bin"},
                             capture_output=True, text=True, check=True).stdout.strip()
        assert got == expected


@respx.mock
async def test_boot_log_uses_the_derived_secret_and_sends_the_bearer_only_over_tls(tmp_path):
    from server.providers.gpu_worker import diag_secret

    clock = FakeClock()
    m = _manager(tmp_path, clock)
    token = "tok-abc_123"
    secret = diag_secret(token)
    plain = respx.get(url__startswith=f"http://{IP}/").mock(return_value=httpx.Response(200, text="line1\nline2"))
    tls = respx.get(url__startswith=f"https://{DOMAIN}/diag/").mock(return_value=httpx.Response(200, text="snap"))
    try:
        _ready_worker(m, clock, token=token, status="booting")
        booting = await m.boot_log()
        assert booting["available"] and booting["source"] == "port80" and booting["cloud_init"] == "line1\nline2"
        m.store.update_worker(m.store.active_worker().id, status="ready")
        ready = await m.boot_log()
        assert ready["available"] and ready["source"] == "tls" and ready["docker_status"] == "snap"
    finally:
        await m.aclose()
    assert respx.calls
    for call in respx.calls:
        assert token not in str(call.request.url), call.request.url
        assert f"/diag/{secret}/" in str(call.request.url)
    assert plain.calls and all("authorization" not in c.request.headers for c in plain.calls)
    assert tls.calls and all(c.request.headers["authorization"] == f"Bearer {token}" for c in tls.calls)


@respx.mock
async def test_boot_log_falls_back_to_port_80_when_the_tls_snapshot_is_not_there_yet(tmp_path):
    clock = FakeClock()
    m = _manager(tmp_path, clock)
    respx.get(url__startswith=f"https://{DOMAIN}/diag/").mock(return_value=httpx.Response(404))
    respx.get(url__startswith=f"http://{IP}/diag/").mock(return_value=httpx.Response(200, text="boot"))
    try:
        _ready_worker(m, clock)
        out = await m.boot_log()
    finally:
        await m.aclose()
    assert out["available"] and out["source"] == "port80" and out["cloud_init"] == "boot"


def _cloud_init() -> dict:
    import yaml

    return yaml.safe_load(CLOUD_INIT.read_text(encoding="utf-8"))


def _written(path_suffix: str) -> str:
    return next(f["content"] for f in _cloud_init()["write_files"] if f["path"].endswith(path_suffix))


def _compose() -> dict:
    import yaml

    return yaml.safe_load(_written("/docker-compose.yml"))


def test_caddy_checks_the_bearer_before_any_handler_and_serves_the_final_diag_snapshot():
    """Caddy orders a bare `respond` after `handle`, so the old top-level `respond @unauth 401`
    never ran next to the catch-all `handle`: every worker route was open. The check must be
    the first thing inside one ordered `route` block (validated with caddy 2.9.1 adapt)."""
    caddy = _written("/Caddyfile")
    route_at = caddy.index("route {")
    unauth_at = caddy.index('@unauth not header Authorization "Bearer {$WORKER_TOKEN}"')
    respond_at = caddy.index("respond @unauth 401")
    first_handle = min(caddy.index(h) for h in ("handle_path ", "handle /", "handle {"))
    assert route_at < unauth_at < respond_at < first_handle
    assert "handle /diag/{$WORKER_DIAG_SECRET}/* {" in caddy and "file_server" in caddy
    caddy_svc = _compose()["services"]["caddy"]
    assert "/opt/acudx/public/diag:/srv/diag:ro" in caddy_svc["volumes"]
    assert caddy_svc["image"] == "caddy:2.9.1"


def test_diag_server_is_redacted_secret_scoped_and_stops_once_vllm_is_healthy():
    diag = _written("/diag.sh")
    assert 'd="$pub/diag/$WORKER_DIAG_SECRET"' in diag and "$WORKER_TOKEN/" not in diag
    # Only docker ps plus the last 40 lines of vllm and caddy, each through the redaction filter.
    assert 'logs --no-color --tail 40 "$svc" 2>&1 | redact' in diag and "for svc in vllm caddy" in diag
    assert "compose logs --tail" not in diag
    assert 'grep -vF -- "$WORKER_TOKEN"' in diag and 'grep -vF -- "$WORKER_DIAG_SECRET"' in diag
    _assert_redact_behaviour(diag)
    # The cloud-init log is copied through the filter, never symlinked raw.
    assert "ln -s" not in diag and "redact < /var/log/cloud-init-output.log" in diag
    # Self-stop after 300 s of consecutive vLLM /health 200s.
    assert "healthy_for_s=300" in diag and 'kill "$srv"' in diag
    assert "exec -T vllm curl -sf -o /dev/null http://localhost:8000/health" in diag
    runcmd = "\n".join(_cloud_init()["runcmd"])
    assert runcmd.index("WORKER_DIAG_SECRET=$s") < runcmd.index("nohup /opt/acudx/diag.sh")


def test_chatterbox_build_keeps_cuda_torch_and_attaches_the_gpu():
    """Task 24: the Chatterbox container logged "No CUDA GPUs are available"."""
    dockerfile = _written("/chatterbox.Dockerfile")
    assert dockerfile.startswith("FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04")
    assert "ghcr.io/astral-sh/uv:0.8.22" in dockerfile and ":latest" not in dockerfile
    assert "ARG TORCH_INDEX_URL=https://download.pytorch.org/whl/cu124" in dockerfile
    assert "ARG TORCH_VERSION=2.6.0+cu124" in dockerfile and "--constraint /app/torch-constraints.txt" in dockerfile
    assert "chatterbox-multilingual.git@${CHATTERBOX_MULTILINGUAL_REF}" in dockerfile and "@exp" not in dockerfile
    assert "sys.exit(0 if torch.version.cuda else 1)" in dockerfile
    svc = _compose()["services"]["chatterbox"]
    assert svc["build"]["dockerfile"] == "docker/Dockerfile.acudx.gpu" and svc["runtime"] == "nvidia"
    assert svc["image"] == "acudx/chatterbox-tts-api:a5f4661-cu124"
    assert svc["deploy"]["resources"]["reservations"]["devices"][0]["capabilities"] == ["gpu"]
    runcmd = "\n".join(_cloud_init()["runcmd"])
    assert "docker/Dockerfile.acudx.gpu" in runcmd and "torch.cuda.is_available()" in runcmd
    # /healthz is vLLM only: the side-cars never gate worker readiness.
    caddy = _written("/Caddyfile")
    block = caddy[caddy.index("handle /healthz {"):]
    assert block[:block.index("}")].count("reverse_proxy vllm:8000") == 1


# --- review 04 O4: provider-side state is reconciled every reaper pass ------ #

@respx.mock
@pytest.mark.parametrize("provider", ["terminated", "preempted", "missing"])
async def test_reaper_closes_the_ledger_when_the_provider_no_longer_runs_a_ready_worker(tmp_path, provider):
    clock = FakeClock()
    m = _manager(tmp_path, clock)
    inst = load_fixture("instances")["data"][1]
    route = respx.get(f"{LAMBDA_API_BASE}/instances/{INSTANCE_ID}")
    if provider == "missing":
        route.mock(return_value=httpx.Response(404, json={"error": {"code": "global/object-does-not-exist",
                                                                    "message": "not found"}}))
    else:
        route.mock(return_value=httpx.Response(200, json={"data": {**inst, "status": provider}}))
    term = respx.post(f"{LAMBDA_API_BASE}/instance-operations/terminate").mock(
        return_value=httpx.Response(200, json={"data": {"terminated_instances": []}}))
    try:
        _ready_worker(m, clock)
        clock.advance(30 * 60)
        m.touch()                                    # busy, under budget: only the provider state ends it
        assert await m.reap_once() is True
    finally:
        await m.aclose()
    assert not term.called, "an instance the provider already ended is not terminated again"
    assert m.store.active_worker() is None
    entry = m.store.ledger(limit=1)[0]
    assert entry.reason == f"provider:{provider}" and entry.ended_at == clock.t
    assert entry.cost_usd == pytest.approx(1.29 * 0.5, abs=0.001)


@respx.mock
async def test_reaper_keeps_a_ready_worker_when_the_provider_is_only_flaky(tmp_path):
    clock = FakeClock()
    m = _manager(tmp_path, clock)
    respx.get(f"{LAMBDA_API_BASE}/instances/{INSTANCE_ID}").mock(
        return_value=httpx.Response(500, json={"error": {"code": "global/internal-error", "message": "boom"}}))
    try:
        _ready_worker(m, clock)
        assert await m.reap_once() is False
        assert m.store.active_worker().status == "ready"
    finally:
        await m.aclose()


@respx.mock
async def test_ensure_worker_fails_fast_when_a_ready_row_is_gone_on_the_provider(tmp_path):
    from server.providers.gpu_worker import WorkerFailed

    clock = FakeClock()
    m = _manager(tmp_path, clock)
    inst = load_fixture("instances")["data"][1]
    respx.get(f"https://{DOMAIN}/healthz").mock(return_value=httpx.Response(502))
    respx.get(f"{LAMBDA_API_BASE}/instances/{INSTANCE_ID}").mock(
        return_value=httpx.Response(200, json={"data": {**inst, "status": "terminated"}}))
    try:
        _ready_worker(m, clock)
        with pytest.raises(WorkerFailed):
            await m.ensure_worker()
    finally:
        await m.aclose()
    assert m.store.ledger(limit=1)[0].reason == "provider:terminated"


# --- evidence retention: a ready_timeout termination leaves the boot log behind --- #

@respx.mock
async def test_ready_timeout_leaves_the_last_boot_log_snapshot_and_the_probe_outcome(tmp_path, caplog):
    import logging

    clock = FakeClock()
    m = _manager(tmp_path, clock)
    m.boot_log_interval_s = 0                       # capture on every poll in this test
    respx.get(f"https://{DOMAIN}/healthz").mock(side_effect=httpx.ConnectError("Connection reset by peer"))
    respx.get(url__startswith=f"http://{IP}/diag/").mock(
        return_value=httpx.Response(200, text="vllm-1 | RuntimeError: Engine core initialization failed"))
    respx.get(url__startswith=f"https://{DOMAIN}/diag/").mock(side_effect=httpx.ConnectError("reset"))
    respx.post(f"{LAMBDA_API_BASE}/instance-operations/terminate").mock(
        return_value=httpx.Response(200, json={"data": {"terminated_instances": []}}))
    from server.providers.gpu_worker import WorkerFailed

    try:
        w = _ready_worker(m, clock, status="booting")
        with caplog.at_level(logging.WARNING, logger="acudx.gpu_worker"):
            with pytest.raises(WorkerFailed):
                await m._wait_ready(w)
        stored = m.stored_boot_log(w.id)
    finally:
        await m.aclose()
    assert m.store.active_worker() is None and m.store.ledger(limit=1)[0].reason == "ready_timeout"
    assert stored is not None and stored["stored"] is True and stored["worker_id"] == w.id
    assert "Engine core initialization failed" in stored["docker_status"]
    assert stored["last_health_probe"].startswith("ConnectError: Connection reset by peer")
    # The probe outcome is logged once with its exception class, not once per poll.
    probe_lines = [r.getMessage() for r in caplog.records if "/healthz probe" in r.getMessage()]
    assert probe_lines == [f"gpu worker {INSTANCE_ID}: /healthz probe -> ConnectError: Connection reset by peer"]
    assert any("last probe: ConnectError" in r.getMessage() for r in caplog.records)


@respx.mock
async def test_healthy_logs_the_http_status_of_a_failing_worker(tmp_path, caplog):
    import logging

    clock = FakeClock()
    m = _manager(tmp_path, clock)
    respx.get(f"https://{DOMAIN}/healthz").mock(side_effect=[httpx.Response(502), httpx.Response(200)])
    try:
        w = _ready_worker(m, clock)
        with caplog.at_level(logging.INFO, logger="acudx.gpu_worker"):
            assert await m._healthy(w) is False
            assert await m._healthy(w) is True
    finally:
        await m.aclose()
    msgs = [r.getMessage() for r in caplog.records if "/healthz probe" in r.getMessage()]
    assert msgs == [f"gpu worker {INSTANCE_ID}: /healthz probe -> HTTP 502",
                    f"gpu worker {INSTANCE_ID}: /healthz probe -> HTTP 200"]


def _assert_redact_behaviour(diag: str) -> None:
    """Worker 11 (2026-10-20): the filter dropped every line with the word "token", which hid
    the vLLM tokenizer error. Run the real function on sample lines: secrets and auth headers
    go, ordinary error lines (tokenizer, KV cache) stay."""
    import re
    import subprocess
    m = re.search(r"^\s*(redact\(\) \{.*\})\s*$", diag, flags=re.M)
    assert m, "redact() definition not found"
    script = (
        "WORKER_TOKEN=tok_SECRET_123; WORKER_DIAG_SECRET=diag0123456789abcdef\n"
        + m.group(1)
        + "\nprintf '%s\\n' "
        + " ".join(repr(x) for x in [
            "ValueError: tokenizer for Qwen/Qwen3-14B-AWQ failed to load",
            "Available KV cache memory: 13.75 GiB",
            "Authorization: Bearer tok_SECRET_123",
            "url /diag/diag0123456789abcdef/x",
            "env api_key=sk-abcdef",
            "plain bearer tokens mentioned in prose",
        ])
        + " | redact\n"
    )
    out = subprocess.run(["bash", "-c", script], capture_output=True, text=True, check=True).stdout
    assert "tokenizer for Qwen" in out and "KV cache memory" in out and "mentioned in prose" in out
    assert "tok_SECRET_123" not in out and "diag0123456789abcdef" not in out and "sk-abcdef" not in out


async def test_stop_cancels_the_inflight_readiness_wait_so_a_new_launch_is_not_blocked(tmp_path):
    """Live finding 2026-10-20: after /admin/gpu/stop the shielded readiness wait kept polling the
    dead worker for its whole ready budget and every new /admin/gpu/start awaited it."""
    import asyncio
    clock = FakeClock()
    m = _manager(tmp_path, clock)
    try:
        w = m.store.insert_worker(instance_id="i-dead", instance_type="gpu_1x_a100_sxm4", region="us-east-1",
                                  token="t", status="booting", price_cents_per_hour=199,
                                  launched_at=clock.t, last_used_at=clock.t)
        m.store.update_worker(w.id, ip="1.2.3.4", domain="1-2-3-4.sslip.io")
        m.store.open_ledger(w)

        async def never_healthy(_w):
            await asyncio.sleep(0)
            return False

        m._healthy = never_healthy  # type: ignore[method-assign]
        m._inflight = asyncio.create_task(m._wait_ready(m.store.get_worker(w.id)))
        await asyncio.sleep(0)

        class _Api:
            async def terminate(self, ids):
                return ids

        m._lambda = lambda: _Api()  # type: ignore[method-assign]
        await m.terminate(reason="admin")
        assert m._inflight is None
        # A wait that is still running notices the row is no longer active and stops.
        task = asyncio.create_task(m._wait_ready(m.store.get_worker(w.id)))
        with pytest.raises(Exception) as exc:
            await asyncio.wait_for(task, timeout=2)
        assert "terminated" in str(exc.value) or "terminating" in str(exc.value)
    finally:
        await m.aclose()


# --- live call follow-ups (docs/architecture/18 6.3, 2026-10-20) ------------ #

def test_chatterbox_keeps_pkg_resources_for_the_perth_watermarker():
    """Workers 2 and 3: Chatterbox /health 200 with "'NoneType' object is not callable". resemble-perth
    1.0.1 imports pkg_resources (gone in setuptools 82) and sets PerthImplicitWatermarker = None."""
    dockerfile = _written("/chatterbox.Dockerfile")
    assert '"setuptools==80.9.0"' in dockerfile and 'echo "setuptools==80.9.0" >> /app/torch-constraints.txt' in dockerfile
    pin_at = dockerfile.index('"setuptools==80.9.0"')
    assert pin_at < dockerfile.index("chatterbox-multilingual.git@")
    assert "sys.exit(0 if perth.PerthImplicitWatermarker else 1)" in dockerfile


def test_public_443_is_an_sni_router_for_turn_over_tls_and_caddy():
    edge = _written("/edge.conf")
    assert "ssl_preread on;" in edge and "listen 443;" in edge
    assert "~\\bacme-tls/1\\b 1;" in edge and "~^1: 127.0.0.1:8443;" in edge
    assert "~^0:turn\\. 127.0.0.1:5349;" in edge and "default 127.0.0.1:8443;" in edge
    services = _compose()["services"]
    assert services["edge"]["image"] == "nginx:1.30.6-alpine" and services["edge"]["network_mode"] == "host"
    assert services["caddy"]["ports"] == ["127.0.0.1:8443:8443"]
    caddy = _written("/Caddyfile")
    assert "https_port 8443" in caddy and caddy.count("alt_tlsalpn_port 8443") == 2
    assert "turn.{$WORKER_DOMAIN} {" in caddy
    turn = services["turn"]
    assert "${TURN_TLS_ARGS:---no-tls}" in turn["command"] and "/opt/acudx/turn-tls:/tls:ro" in turn["volumes"]
    # coturn 4.18 exits 255 on the unknown flag --no-dtls (DTLS is off unless --dtls is given).
    assert "--no-dtls" not in turn["command"]
    avatar_sh = _written("/avatar.sh")
    assert 'TURN_TLS_ARGS="--tls-listening-port=5349 --cert=/tls/turn.crt --pkey=/tls/turn.key"' in avatar_sh
    assert avatar_sh.index("TURN_TLS_ARGS=") < avatar_sh.index("$compose up -d turn avatar")
    runcmd = "\n".join(_cloud_init()["runcmd"])
    assert "docker compose up -d edge caddy" in runcmd


def test_avatar_runner_streams_audio_bounds_latency_and_reports_calls():
    runner = _written("/acudx_avatar_server.py")
    for route in ('add_get("/stream", stream_audio)', 'add_get("/turn_check", turn_check)',
                  'add_post("/humanaudio", humanaudio)'):
        assert route in runner
    assert "mt.MuseReal.render = _render" in runner and "sess.asr.feat_queue = _WarmingFeatQueue(sess, maxsize=1)" in runner
    assert "soxr.ResampleStream" in runner and "BORDER_REPLICATE" in runner and "BORDER_REFLECT_101" in runner
    assert "cv2.BORDER_REPLICATE)\n" not in runner.split("def extend_portrait")[0]
    env = _compose()["services"]["avatar"]["environment"]
    assert "AVATAR_BATCH_SIZE=4" in env and "AVATAR_AHEAD_FRAMES=6" in env and "TURN_SECRET=${TURN_SECRET}" in env
    compile(runner, "acudx_avatar_server.py", "exec")
