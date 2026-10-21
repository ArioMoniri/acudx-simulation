"""The GPU worker pool: several workers at once, load balancing, scale up on demand, per-worker reaping."""

from __future__ import annotations

import asyncio

import httpx
import pytest
import respx
from pydantic import ValidationError

from server.config import Settings
from server.providers.gpu_worker import WorkerManager, WorkerPolicy, WorkerStore, gpus_for
from server.providers.lambda_cloud import LAMBDA_API_BASE
from server.tests.conftest import CLOUD_INIT, load_fixture


class FakeClock:
    def __init__(self, t: float = 1_800_000_000.0):
        self.t = t

    def __call__(self) -> float:
        return self.t

    def advance(self, s: float) -> None:
        self.t += s


async def _sleep(_: float) -> None:
    await asyncio.sleep(0)


def _manager(tmp_path, clock, **over) -> WorkerManager:
    base = dict(airgapped=False, lambda_key="k", lambda_ssh_key_name="key", acudx_db_path=str(tmp_path / "a.db"),
                gpu_idle_minutes=20, admin_token="adm", _env_file=None)
    base.update(over)
    s = Settings(**base)
    return WorkerManager(s, store=WorkerStore(s.acudx_db_path), clock=clock, sleep=_sleep, template_path=CLOUD_INIT,
                         poll_interval_s=0, boot_timeout_s=60, ready_timeout_s=60)


def _ready(m: WorkerManager, clock: FakeClock, n: int, *, itype: str = "gpu_1x_h100_sxm5") -> list:
    out = []
    for i in range(n):
        w = m.store.insert_worker(instance_id=f"i-{i}", instance_type=itype, region="us-east-1", token=f"t{i}",
                                  status="ready", price_cents_per_hour=429, launched_at=clock.t, last_used_at=clock.t)
        w = m.store.update_worker(w.id, ip=f"10.0.0.{i + 1}", domain=f"10-0-0-{i + 1}.sslip.io", ready_at=clock.t)
        m.store.open_ledger(w)
        m._healthy_until[w.id] = clock.t + 3600
        out.append(w)
    return out


def test_policy_max_workers_defaults_to_three_and_is_bounded():
    assert WorkerPolicy().max_workers == 3
    assert WorkerPolicy(max_workers=16).max_workers == 16
    with pytest.raises(ValidationError):
        WorkerPolicy(max_workers=0)
    assert WorkerPolicy().daily_budget_usd is None


def test_allowlist_takes_multi_gpu_types_and_refuses_arm_hosts():
    p = WorkerPolicy(allowlist=["gpu_1x_h100_sxm5", "gpu_8x_h100_sxm5", "gpu_8x_b200_sxm6"])
    assert "gpu_8x_b200_sxm6" in p.allowlist
    with pytest.raises(ValidationError):
        WorkerPolicy(allowlist=["gpu_1x_gh200"])  # aarch64: the worker images are amd64 only
    assert gpus_for("gpu_8x_h100_sxm5") == 8 and gpus_for("gpu_1x_a10") == 1 and gpus_for("odd") == 1


def test_llm_endpoint_balances_across_ready_workers_by_load(tmp_path):
    clock = FakeClock()
    m = _manager(tmp_path, clock)
    a, b = _ready(m, clock, 2)
    m.begin(a.domain)
    m.begin(a.domain)
    assert m.llm_endpoint()["base_url"] == f"https://{b.domain}/v1"
    m.begin(b.domain)
    m.begin(b.domain)
    m.begin(b.domain)
    assert m.llm_endpoint()["base_url"] == f"https://{a.domain}/v1"
    m.end(b.domain)
    m.end(b.domain)
    assert m.llm_endpoint()["base_url"] == f"https://{b.domain}/v1"
    assert m.llm_endpoint()["worker_id"] == b.id


def test_live_calls_count_towards_a_workers_load(tmp_path):
    clock = FakeClock()
    m = _manager(tmp_path, clock)
    a, b = _ready(m, clock, 2)
    m.set_calls(f"https://{a.domain}", 2)
    assert m.llm_endpoint()["base_url"] == f"https://{b.domain}/v1"


def test_touch_by_url_only_resets_that_workers_idle_window(tmp_path):
    clock = FakeClock()
    m = _manager(tmp_path, clock)
    a, b = _ready(m, clock, 2)
    clock.advance(600)
    m.touch(f"https://{b.domain}/tts")
    assert m.store.get_worker(b.id).last_used_at == clock.t
    assert m.store.get_worker(a.id).last_used_at == clock.t - 600


async def test_reaper_stops_only_the_idle_worker(tmp_path):
    clock = FakeClock()
    m = _manager(tmp_path, clock)
    a, b = _ready(m, clock, 2)
    stopped: list[list[str]] = []

    class _Api:
        async def terminate(self, ids):
            stopped.append(list(ids))
            return ids

        async def get_instance(self, _iid):
            raise httpx.ConnectError("offline")

    m._lambda = lambda: _Api()  # type: ignore[method-assign]
    clock.advance(21 * 60)
    m.touch(f"https://{b.domain}")
    assert await m.reap_once() is True
    assert stopped == [[a.instance_id]]
    assert m.store.get_worker(a.id).status == "terminated"
    assert m.store.get_worker(b.id).status == "ready"


async def test_status_lists_every_worker_with_its_load(tmp_path):
    clock = FakeClock()
    m = _manager(tmp_path, clock)
    a, b = _ready(m, clock, 2)
    m.begin(a.domain)
    m.set_calls(f"https://{b.domain}", 1)
    st = await m.status()
    assert st["policy"]["max_workers"] == 3
    ws = {w["id"]: w for w in st["workers"]}
    assert set(ws) == {a.id, b.id}
    assert ws[a.id]["load"]["inflight"] == 1 and ws[b.id]["load"]["calls"] == 1
    assert ws[a.id]["gpus"] == 1
    assert "token" not in ws[a.id]
    assert st["capacity"]["workers"] == 2 and st["capacity"]["max_workers"] == 3
    assert st["worker"]["id"] in (a.id, b.id)   # the primary, kept for older clients


async def test_terminate_one_worker_or_all(tmp_path):
    clock = FakeClock()
    m = _manager(tmp_path, clock)
    a, b, c = _ready(m, clock, 3)
    stopped: list[str] = []

    class _Api:
        async def terminate(self, ids):
            stopped.extend(ids)
            return ids

    m._lambda = lambda: _Api()  # type: ignore[method-assign]
    one = await m.terminate(reason="admin", worker_id=b.id)
    assert one.id == b.id and stopped == [b.instance_id]
    await m.terminate(reason="admin")
    assert sorted(stopped) == sorted([a.instance_id, b.instance_id, c.instance_id])
    assert m.store.active_workers() == []


def _mock_launch(ids: list[str], *, itype_capacity: dict[str, list[str]] | None = None):
    types = load_fixture("instance-types")
    if itype_capacity is not None:
        for name, entry in types["data"].items():
            entry["regions_with_capacity_available"] = [{"name": r, "description": r}
                                                        for r in itype_capacity.get(name, [])]
    respx.get(f"{LAMBDA_API_BASE}/instance-types").mock(return_value=httpx.Response(200, json=types))
    respx.get(f"{LAMBDA_API_BASE}/firewall-rules").mock(return_value=httpx.Response(200, json=load_fixture("firewall-rules")))
    respx.put(f"{LAMBDA_API_BASE}/firewall-rules").mock(return_value=httpx.Response(200, json={"data": []}))
    seq = iter(ids)
    launch = respx.post(f"{LAMBDA_API_BASE}/instance-operations/launch").mock(
        side_effect=lambda _r: httpx.Response(200, json={"data": {"instance_ids": [next(seq)]}}))
    return launch


@respx.mock
async def test_scale_up_launches_another_worker_when_every_worker_is_saturated(tmp_path):
    clock = FakeClock()
    m = _manager(tmp_path, clock)
    (a,) = _ready(m, clock, 1)
    launch = _mock_launch(["i-new"])
    respx.get(f"{LAMBDA_API_BASE}/instances/i-new").mock(return_value=httpx.Response(200, json={"data": {
        **load_fixture("instances")["data"][1], "id": "i-new", "status": "booting", "ip": None}}))
    assert m.scale_up_needed() is None
    for _ in range(m.policy.llm_queue_per_worker):
        m.begin(a.domain)
    assert m.scale_up_needed() == "llm_queue"
    started = await m.maybe_scale_up()
    assert started == "llm_queue"
    for _ in range(5):
        await asyncio.sleep(0)
    assert launch.call_count == 1
    rows = m.store.active_workers()
    assert len(rows) == 2 and {r.status for r in rows} == {"ready", "booting"}
    # A launch is in flight: no second one for the same pressure.
    assert await m.maybe_scale_up() is None
    await m.aclose()


@respx.mock
async def test_scale_up_never_exceeds_max_workers(tmp_path):
    clock = FakeClock()
    m = _manager(tmp_path, clock)
    m.set_policy(m.policy.model_copy(update={"max_workers": 2}))
    a, b = _ready(m, clock, 2)
    launch = _mock_launch(["i-x"])
    for w in (a, b):
        m.set_calls(f"https://{w.domain}", 99)
    assert m.scale_up_needed() is None
    assert await m.maybe_scale_up() is None
    assert launch.call_count == 0
    await m.aclose()


async def test_reaper_reattaches_a_scale_up_boot_after_a_gateway_restart(tmp_path):
    """Live 2026-10-21: the gateway restarted while a second worker booted; the pool still had a ready
    worker, so no request waited on the boot and the row would have stayed 'booting' for good."""
    clock = FakeClock()
    m = _manager(tmp_path, clock)
    _ready(m, clock, 1)
    b = m.store.insert_worker(instance_id="i-boot", instance_type="gpu_4x_h100_sxm5", region="us-south-3", token="tb",
                              status="booting", price_cents_per_hour=1636, launched_at=clock.t, last_used_at=clock.t)
    m.store.update_worker(b.id, ip="10.0.0.9", domain="10-0-0-9.sslip.io")
    seen = []

    async def healthy(w):
        seen.append(w.id)
        return True

    async def capture(_w):
        return True

    m._healthy = healthy  # type: ignore[method-assign]
    m.capture_boot_log = capture  # type: ignore[method-assign]

    class _Api:
        async def get_instance(self, _iid):
            raise httpx.ConnectError("offline")

    m._lambda = lambda: _Api()  # type: ignore[method-assign]
    assert await m.reap_once() is False
    for _ in range(10):
        await asyncio.sleep(0)
    assert m.store.get_worker(b.id).status == "ready" and b.id in seen
    await m.aclose()


def test_calls_pressure_asks_for_a_worker(tmp_path):
    clock = FakeClock()
    m = _manager(tmp_path, clock)
    (a,) = _ready(m, clock, 1)
    m.note_call_refused()
    assert m.scale_up_needed() == "calls"


@respx.mock
async def test_launch_may_pick_an_eight_gpu_host_when_it_is_the_only_capacity(tmp_path):
    clock = FakeClock()
    m = _manager(tmp_path, clock)
    m.set_policy(m.policy.model_copy(update={"allowlist": ["gpu_1x_h100_sxm5", "gpu_8x_h100_sxm5"]}))
    types = load_fixture("instance-types")
    if "gpu_8x_h100_sxm5" not in types["data"]:
        pytest.skip("fixture has no 8x type")
    launch = _mock_launch(["i-8"], itype_capacity={"gpu_8x_h100_sxm5": ["us-east-1"]})
    respx.get(f"{LAMBDA_API_BASE}/instances/i-8").mock(return_value=httpx.Response(200, json={"data": {
        **load_fixture("instances")["data"][1], "id": "i-8", "status": "booting", "ip": None}}))
    await m.maybe_scale_up(force="admin")
    for _ in range(5):
        await asyncio.sleep(0)
    body = launch.calls[0].request.content.decode()
    assert "gpu_8x_h100_sxm5" in body
    w = m.store.active_workers()[0]
    assert w.instance_type == "gpu_8x_h100_sxm5"
    await m.aclose()


# --- the worker image on multi-GPU hosts --------------------------------------- #
def _cloud_init() -> str:
    return open(CLOUD_INIT, encoding="utf-8").read()


def test_nvswitch_hosts_start_the_fabric_manager_before_cuda_is_used():
    """Live 2026-10-21 on gpu_4x_h100_sxm5: CUDA error 802 in vLLM, the runner and the image edits."""
    ci = _cloud_init()
    fm = ci.index("systemctl enable --now nvidia-fabricmanager")
    assert fm < ci.index("nohup /opt/acudx/avatar.sh") < ci.index("docker compose up -d --wait vllm")
    assert "Completed" in ci[fm:fm + 600]


def test_multi_gpu_hosts_give_the_runner_and_the_image_edits_their_own_cards():
    ci = _cloud_init()
    assert 'device_ids: ["${AVATAR_GPU:-0}"]' in ci and 'device_ids: ["${IMAGEGEN_GPU:-0}"]' in ci
    assert "AVATAR_DEDICATED_GPU=1" in ci and "AVATAR_MAX_SESSIONS=4" in ci
    assert "--gpu-memory-utilization ${VLLM_GPU_UTIL:-0.60}" in ci and "VLLM_GPU_UTIL=0.50" in ci
    assert "handle_path /imagegen/*" in ci and "reverse_proxy imagegen:8020" in ci


def test_image_edit_server_is_apache_licensed_and_pinned():
    ci = _cloud_init()
    assert "black-forest-labs/FLUX.2-klein-4B" in ci and "e7b7dc27f91deacad38e78976d1f2b499d76a294" in ci
    assert '"diffusers==0.40.0"' in ci and "--exclude-newer 2026-09-01" in ci
    assert 'mode = "sequential"' in ci and 'mode = "offload"' in ci and 'mode = "gpu"' in ci


def test_runner_switches_a_live_call_with_a_crossfade():
    ci = _cloud_init()
    assert 'app.router.add_post("/switch", switch)' in ci
    assert "frame_count_mismatch" in ci and "_install_crossfade(sess)" in ci
