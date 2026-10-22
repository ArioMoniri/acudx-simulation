"""Launch cooldown and the stuck-boot cut (production 2026-10-22, docs/review/09 last section).

Two cold starts landed on the only 80 GB offer (gpu_1x_h100_pcie, us-west-3). Lambda kept both in
``booting`` until the 900 s boot budget ran out, and right after the timeout the gateway picked the same
type and region again. Now:

* a boot that stays in Lambda's ``booting`` with no progress (no IP, no status change) for
  ``boot_stuck_s`` is terminated (reason ``boot_stuck``), well before ``boot_timeout_s``;
* a boot failure or a refused launch puts that (type, region) on a cooldown for
  ``policy.launch_cooldown_minutes``, stored in SQLite (a restart keeps it), shown in the admin status;
* the same launch then tries the next option (another region, another type, the 40 GB fallback).
"""

from __future__ import annotations

import json

import httpx
import respx

from server.config import Settings
from server.providers.gpu_worker import WorkerFailed, WorkerManager, WorkerPolicy, WorkerStore
from server.providers.lambda_cloud import LAMBDA_API_BASE
from server.tests.conftest import CLOUD_INIT, load_fixture

PCIE_ID = "a" * 32
A100_ID = "b" * 32
IP = "150.136.117.213"
DOMAIN = "150-136-117-213.sslip.io"


class Clock:
    def __init__(self, t: float = 1_800_000_000.0):
        self.t = t

    def __call__(self) -> float:
        return self.t


def _offers(pcie_regions=("us-west-3",), a100_regions=("us-east-1",)) -> dict:
    data = load_fixture("instance-types")["data"]
    for k, v in data.items():
        v["regions_with_capacity_available"] = []
    data["gpu_1x_h100_pcie"]["regions_with_capacity_available"] = [{"name": r, "description": r} for r in pcie_regions]
    data["gpu_1x_a100_sxm4"]["regions_with_capacity_available"] = [{"name": r, "description": r} for r in a100_regions]
    return {"data": data}


def _manager(tmp_path, clock: Clock, **over) -> WorkerManager:
    s = Settings(airgapped=False, lambda_key="k", lambda_ssh_key_name="key", acudx_db_path=str(tmp_path / "a.db"),
                 admin_token="adm", _env_file=None, gpu_llm_model="Qwen/Qwen3-32B-AWQ")

    async def sleep(seconds: float) -> None:
        clock.t += max(seconds, 1.0)

    kw = dict(store=WorkerStore(s.acudx_db_path), clock=clock, sleep=sleep, template_path=CLOUD_INIT,
              poll_interval_s=5, boot_timeout_s=900, ready_timeout_s=60, boot_stuck_s=300)
    kw.update(over)
    return WorkerManager(s, **kw)


def _instance(iid: str, status: str, ip: str | None) -> dict:
    inst = load_fixture("instances")["data"][1]
    return {**inst, "id": iid, "status": status, "ip": ip}


def _routes(offers: dict, *, launch_side_effect=None, pcie_status=lambda n: ("booting", None)):
    respx.get(f"{LAMBDA_API_BASE}/instance-types").mock(return_value=httpx.Response(200, json=offers))
    respx.get(f"{LAMBDA_API_BASE}/firewall-rules").mock(
        return_value=httpx.Response(200, json=load_fixture("firewall-rules")))
    respx.put(f"{LAMBDA_API_BASE}/firewall-rules").mock(return_value=httpx.Response(200, json={"data": []}))

    def _launch(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        iid = PCIE_ID if body["instance_type_name"] == "gpu_1x_h100_pcie" else A100_ID
        return httpx.Response(200, json={"data": {"instance_ids": [iid]}})

    launch = respx.post(f"{LAMBDA_API_BASE}/instance-operations/launch").mock(side_effect=launch_side_effect or _launch)
    polls = {"n": 0}

    def _pcie(_r: httpx.Request) -> httpx.Response:
        polls["n"] += 1
        status, ip = pcie_status(polls["n"])
        return httpx.Response(200, json={"data": _instance(PCIE_ID, status, ip)})

    respx.get(f"{LAMBDA_API_BASE}/instances/{PCIE_ID}").mock(side_effect=_pcie)
    respx.get(f"{LAMBDA_API_BASE}/instances/{A100_ID}").mock(
        return_value=httpx.Response(200, json={"data": _instance(A100_ID, "active", IP)}))
    term = respx.post(f"{LAMBDA_API_BASE}/instance-operations/terminate").mock(
        return_value=httpx.Response(200, json={"data": {"terminated_instances": []}}))
    respx.get(f"https://{DOMAIN}/healthz").mock(return_value=httpx.Response(200, text="ok"))
    return launch, term, polls


def _launched(launch) -> list[tuple[str, str]]:
    return [(json.loads(c.request.content)["instance_type_name"], json.loads(c.request.content)["region_name"])
            for c in launch.calls]


@respx.mock
async def test_a_boot_stuck_in_booting_is_cut_early_cooled_down_and_the_next_option_is_launched(tmp_path):
    clock = Clock()
    launch, term, _ = _routes(_offers())
    m = _manager(tmp_path, clock)
    t0 = clock.t
    try:
        w = await m.ensure_worker()
    finally:
        await m.aclose()
    # The stuck PCIe boot was given up after about boot_stuck_s, not the 900 s boot budget.
    assert _launched(launch) == [("gpu_1x_h100_pcie", "us-west-3"), ("gpu_1x_a100_sxm4", "us-east-1")]
    assert json.loads(term.calls[0].request.content) == {"instance_ids": [PCIE_ID]}
    assert w.instance_id == A100_ID and w.status == "ready"
    assert clock.t - t0 < 900
    reasons = {e.instance_id: e.reason for e in m.store.ledger()}
    assert reasons[PCIE_ID] == "boot_stuck"
    cds = m.store.active_cooldowns(clock.t)
    assert [(c["instance_type"], c["region"], c["reason"]) for c in cds] == [
        ("gpu_1x_h100_pcie", "us-west-3", "boot_stuck")]
    assert cds[0]["until"] >= clock.t + 59 * 60


@respx.mock
async def test_the_cooldown_survives_a_restart_and_shows_in_the_admin_status(tmp_path):
    clock = Clock()
    launch, _, _ = _routes(_offers())
    m = _manager(tmp_path, clock)
    m.store.add_cooldown("gpu_1x_h100_pcie", "us-west-3", until=clock.t + 3600, reason="boot_timeout", at=clock.t)
    m2 = _manager(tmp_path, clock)   # a gateway restart: same database
    try:
        st = await m2.status()
        assert [(c["instance_type"], c["region"], c["reason"]) for c in st["cooldowns"]] == [
            ("gpu_1x_h100_pcie", "us-west-3", "boot_timeout")]
        assert st["cooldowns"][0]["remaining_s"] == 3600
        w = await m2.ensure_worker()
    finally:
        await m.aclose()
        await m2.aclose()
    # The cooled-down 80 GB offer was skipped straight away: the 40 GB fallback was launched.
    assert _launched(launch) == [("gpu_1x_a100_sxm4", "us-east-1")]
    assert w.instance_id == A100_ID


@respx.mock
async def test_another_region_of_the_same_type_is_tried_before_the_fallback(tmp_path):
    clock = Clock()
    launch, _, _ = _routes(_offers(pcie_regions=("us-west-3", "us-east-3")))
    m = _manager(tmp_path, clock)
    m.store.add_cooldown("gpu_1x_h100_pcie", "us-west-3", until=clock.t + 3600, reason="boot_timeout", at=clock.t)

    def _launch(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": {"instance_ids": [A100_ID]}})

    launch.side_effect = _launch
    try:
        await m.ensure_worker()
    finally:
        await m.aclose()
    assert _launched(launch) == [("gpu_1x_h100_pcie", "us-east-3")]


@respx.mock
async def test_an_expired_cooldown_no_longer_skips_the_offer(tmp_path):
    clock = Clock()
    launch, _, _ = _routes(_offers(), pcie_status=lambda n: ("active", IP))
    m = _manager(tmp_path, clock)
    m.store.add_cooldown("gpu_1x_h100_pcie", "us-west-3", until=clock.t - 1, reason="boot_timeout", at=clock.t - 3601)
    try:
        assert (await m.status())["cooldowns"] == []
        await m.ensure_worker()
    finally:
        await m.aclose()
    assert _launched(launch) == [("gpu_1x_h100_pcie", "us-west-3")]


@respx.mock
async def test_a_refused_launch_cools_the_offer_down_and_the_next_option_is_launched(tmp_path):
    clock = Clock()

    def _launch(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        if body["instance_type_name"] == "gpu_1x_h100_pcie":
            return httpx.Response(400, json={"error": {"code": "instance-operations/launch/insufficient-capacity",
                                                       "message": "Not enough capacity"}})
        return httpx.Response(200, json={"data": {"instance_ids": [A100_ID]}})

    launch, _, _ = _routes(_offers(), launch_side_effect=_launch)
    m = _manager(tmp_path, clock)
    try:
        w = await m.ensure_worker()
    finally:
        await m.aclose()
    assert _launched(launch) == [("gpu_1x_h100_pcie", "us-west-3"), ("gpu_1x_a100_sxm4", "us-east-1")]
    assert w.instance_id == A100_ID
    assert [(c["instance_type"], c["reason"]) for c in m.store.active_cooldowns(clock.t)] == [
        ("gpu_1x_h100_pcie", "launch_failed")]


@respx.mock
async def test_a_booting_instance_that_shows_progress_gets_the_full_boot_budget(tmp_path):
    clock = Clock()
    # An IP appears at poll 50 (about 250 s), active at poll 100 (about 500 s, past boot_stuck_s from the
    # launch but not from the last progress): no cut.
    _routes(_offers(), pcie_status=lambda n: ("active", IP) if n >= 100 else ("booting", IP if n >= 50 else None))
    m = _manager(tmp_path, clock)
    try:
        w = await m.ensure_worker()
    finally:
        await m.aclose()
    assert w.instance_id == PCIE_ID and w.status == "ready"
    assert m.store.active_cooldowns(clock.t) == []


@respx.mock
async def test_the_whole_boot_budget_still_ends_in_a_boot_timeout_with_a_cooldown(tmp_path):
    clock = Clock()
    # Progress keeps coming (the IP flips) but the instance never turns active.
    launch, _, _ = _routes(_offers(a100_regions=()), pcie_status=lambda n: ("booting", IP if n % 2 else None))
    m = _manager(tmp_path, clock)
    try:
        try:
            await m.ensure_worker()
            raise AssertionError("expected WorkerFailed")
        except WorkerFailed:
            pass
    finally:
        await m.aclose()
    assert _launched(launch) == [("gpu_1x_h100_pcie", "us-west-3")]   # nothing else had capacity
    assert [c["reason"] for c in m.store.active_cooldowns(clock.t)] == ["boot_timeout"]


@respx.mock
async def test_cooldown_zero_turns_the_cooldown_off(tmp_path):
    clock = Clock()
    launch, _, _ = _routes(_offers())
    m = _manager(tmp_path, clock)
    m.set_policy(WorkerPolicy(launch_cooldown_minutes=0))
    try:
        await m.ensure_worker()
    finally:
        await m.aclose()
    assert m.store.active_cooldowns(clock.t) == []
    # The launch itself still moved on from the offer that failed.
    assert _launched(launch) == [("gpu_1x_h100_pcie", "us-west-3"), ("gpu_1x_a100_sxm4", "us-east-1")]


def test_policy_and_settings_defaults():
    assert WorkerPolicy().launch_cooldown_minutes == 60
    assert WorkerPolicy.model_validate({"idle_minutes": 7}).launch_cooldown_minutes == 60
    s = Settings(_env_file=None)
    assert s.gpu_launch_cooldown_minutes == 60
    assert s.gpu_boot_stuck_s < s.gpu_boot_timeout_s
