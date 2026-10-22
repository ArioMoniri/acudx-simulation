"""Workers for live video calls prefer 80 GB cards (owner decision 2026-10-21, docs/architecture/18 6.3.10).

On a 40 GB A100 the worker's Turkish voice (Chatterbox, one replica beside vLLM, the runner and the
image edits) started 5.5 s after the question; an 80 GB card has a second replica and the room. The
cheapest card with capacity still wins inside a tier; a 40 GB card is used only when no 80 GB card
has capacity, and then the admin status and the call capabilities say so."""

from __future__ import annotations

import json

import httpx
import respx

from server.config import Settings
from server.providers.gpu_worker import WorkerManager, WorkerPolicy, WorkerStore, choose_offer, video_tier
from server.providers.lambda_cloud import LAMBDA_API_BASE, InstanceTypeOffer, type_memory_gb
from server.tests.conftest import CLOUD_INIT, load_fixture


class FakeClock:
    def __init__(self, t: float = 1_800_000_000.0):
        self.t = t

    def __call__(self) -> float:
        return self.t


async def _sleep(_: float) -> None:
    return None


def _offers(drop_80: bool = False):
    data = load_fixture("instance-types")["data"]
    out = {k: InstanceTypeOffer.model_validate(v) for k, v in data.items()}
    if drop_80:
        for k, o in out.items():
            if (type_memory_gb(k) or 0) >= 80:
                o.regions_with_capacity_available.clear()
    return out


def _manager(tmp_path, **over) -> WorkerManager:
    base = dict(airgapped=False, lambda_key="k", lambda_ssh_key_name="key", acudx_db_path=str(tmp_path / "a.db"),
                admin_token="adm", _env_file=None, gpu_llm_model="Qwen/Qwen3-32B-AWQ")
    base.update(over)
    s = Settings(**base)
    return WorkerManager(s, store=WorkerStore(s.acudx_db_path), clock=FakeClock(), sleep=_sleep,
                         template_path=CLOUD_INIT, poll_interval_s=0, boot_timeout_s=60, ready_timeout_s=60)


def test_defaults_prefer_80_gb_and_list_the_80_gb_cards():
    p = WorkerPolicy()
    assert p.preferred_gpu_memory_gb == 80 and p.min_gpu_memory_gb == 40
    assert {"gpu_1x_h100_pcie", "gpu_1x_h100_sxm5"} <= set(p.allowlist)
    assert Settings(_env_file=None).gpu_preferred_gpu_memory_gb == 80
    assert Settings(_env_file=None).gpu_instance_allowlist[:3] == ["gpu_2x_h100_sxm5", "gpu_1x_h100_pcie",
                                                                    "gpu_1x_h100_sxm5"]
    assert p.video_preferred_types == ["gpu_2x_h100_sxm5", "gpu_1x_h100_sxm5"]
    # A policy saved before the field existed gets the default.
    assert WorkerPolicy.model_validate({"idle_minutes": 7}).preferred_gpu_memory_gb == 80


def test_type_memory_table():
    assert type_memory_gb("gpu_1x_h100_pcie") == 80 and type_memory_gb("gpu_1x_a100_sxm4") == 40
    assert type_memory_gb("gpu_8x_a100_80gb_sxm4") == 80 and type_memory_gb("gpu_1x_x_96gb") == 96
    assert type_memory_gb("gpu_1x_unknown") is None


def test_the_80_gb_card_wins_over_a_cheaper_40_gb_card():
    pol = WorkerPolicy(allowlist=["gpu_1x_h100_pcie", "gpu_1x_h100_sxm5", "gpu_1x_a100_sxm4"])
    choice, fs = choose_offer(_offers(), pol, [], [])
    assert choice.instance_type_name == "gpu_1x_h100_sxm5" and choice.region_name == "us-southeast-1"
    assert fs == []


def test_80_gb_outside_the_filesystem_region_is_taken_without_the_filesystem():
    # The filesystem lives in us-east-1, where only 40 GB cards have capacity: the 80 GB card in another
    # region wins and the filesystem (which attaches only in its own region) is left off.
    pol = WorkerPolicy(allowlist=["gpu_1x_h100_sxm5", "gpu_1x_a100_sxm4"], file_system_name="fs")
    choice, fs = choose_offer(_offers(), pol, ["us-east-1"], ["fs"])
    assert choice.instance_type_name == "gpu_1x_h100_sxm5" and fs == []


def test_no_80_gb_capacity_falls_back_to_40_gb_in_the_filesystem_region():
    pol = WorkerPolicy(allowlist=["gpu_1x_h100_sxm5", "gpu_1x_a100_sxm4", "gpu_1x_a10"], file_system_name="fs")
    choice, fs = choose_offer(_offers(drop_80=True), pol, ["us-east-1"], ["fs"])
    assert choice.instance_type_name == "gpu_1x_a100_sxm4" and choice.region_name == "us-east-1"
    assert fs == ["fs"]


def test_preference_off_is_the_old_cheapest_rule():
    pol = WorkerPolicy(allowlist=["gpu_1x_h100_sxm5", "gpu_1x_a100_sxm4"], preferred_gpu_memory_gb=0)
    choice, _fs = choose_offer(_offers(), pol, [], [])
    assert choice.instance_type_name == "gpu_1x_a100_sxm4"


def test_a_policy_that_asks_for_80_gb_only_still_looks_outside_the_filesystem_region():
    # Live 2026-10-22: min 80 = preferred 80 skipped the preferred tier, so only the filesystem's region
    # (no 80 GB capacity there) was tried while another region had an H100 free.
    pol = WorkerPolicy(allowlist=["gpu_1x_h100_sxm5", "gpu_1x_a100_sxm4"], file_system_name="fs",
                       min_gpu_memory_gb=80)
    choice, fs = choose_offer(_offers(), pol, ["us-east-1"], ["fs"])
    assert choice.instance_type_name == "gpu_1x_h100_sxm5" and fs == []


def test_h100_sxm5_goes_before_a_cheaper_h100_pcie():
    # Live 2026-10-22: two H100 PCIe hosts ran Chatterbox's T3 at 24 to 35 ms a token (SXM5 13 to 16).
    offers = _offers()
    offers["gpu_1x_h100_pcie"].regions_with_capacity_available.extend(
        offers["gpu_1x_h100_sxm5"].regions_with_capacity_available)
    pol = WorkerPolicy(allowlist=["gpu_1x_h100_pcie", "gpu_1x_h100_sxm5", "gpu_1x_a100_sxm4"])
    assert choose_offer(offers, pol, [], [])[0].instance_type_name == "gpu_1x_h100_sxm5"
    offers["gpu_1x_h100_sxm5"].regions_with_capacity_available.clear()
    assert choose_offer(offers, pol, [], [])[0].instance_type_name == "gpu_1x_h100_pcie"   # still 80 GB
    pol2 = WorkerPolicy(allowlist=pol.allowlist, video_preferred_types=[])
    offers = _offers()
    offers["gpu_1x_h100_pcie"].regions_with_capacity_available.extend(
        offers["gpu_1x_h100_sxm5"].regions_with_capacity_available)
    assert choose_offer(offers, pol2, [], [])[0].instance_type_name == "gpu_1x_h100_pcie"  # cheapest again


def test_video_tier_names_the_fallback():
    pol = WorkerPolicy()
    assert video_tier("gpu_1x_h100_pcie", pol) == {"tier": "preferred", "gpu_memory_gb": 80, "notice": None}
    t = video_tier("gpu_1x_a100_sxm4", pol)
    assert t["tier"] == "fallback" and t["gpu_memory_gb"] == 40
    assert "80 GB" in t["notice"] and "Turkish" in t["notice"] and "\u2014" not in t["notice"]


def _mock_launch(instance_id: str, drop_80: bool = False):
    types = load_fixture("instance-types")
    if drop_80:
        for k, v in types["data"].items():
            if (type_memory_gb(k) or 0) >= 80:
                v["regions_with_capacity_available"] = []
    respx.get(f"{LAMBDA_API_BASE}/instance-types").mock(return_value=httpx.Response(200, json=types))
    respx.get(f"{LAMBDA_API_BASE}/firewall-rules").mock(return_value=httpx.Response(200, json=load_fixture("firewall-rules")))
    respx.put(f"{LAMBDA_API_BASE}/firewall-rules").mock(return_value=httpx.Response(200, json={"data": []}))
    respx.get(f"{LAMBDA_API_BASE}/file-systems").mock(return_value=httpx.Response(
        200, json={"data": [{"name": "acudx-wm", "region": {"name": "us-east-1"}}]}))
    launch = respx.post(f"{LAMBDA_API_BASE}/instance-operations/launch").mock(
        return_value=httpx.Response(200, json={"data": {"instance_ids": [instance_id]}}))
    inst = {**load_fixture("instances")["data"][1], "id": instance_id}
    respx.get(f"{LAMBDA_API_BASE}/instances/{instance_id}").mock(return_value=httpx.Response(200, json={"data": inst}))
    respx.get(url__regex=r"https://.*\.sslip\.io/healthz").mock(return_value=httpx.Response(200, text="ok"))
    return launch


@respx.mock
async def test_a_launch_takes_the_80_gb_card_with_the_32b_model_and_no_filesystem(tmp_path):
    launch = _mock_launch("i-80")
    m = _manager(tmp_path, gpu_file_system_name="acudx-wm")
    try:
        w = await m.ensure_worker()
        st = await m.status()
    finally:
        await m.aclose()
    assert w.instance_type == "gpu_2x_h100_sxm5"            # the two-card host first for video
    body = json.loads(launch.calls.last.request.content)
    assert body["region_name"] == "us-southeast-1" and not body.get("file_system_names")
    assert "WORKER_LLM_MODEL=Qwen/Qwen3-32B-AWQ" in body["user_data"]
    assert st["workers"][0]["video_tier"]["tier"] == "preferred"
    assert st["workers"][0]["gpu_memory_gb"] == 80


@respx.mock
async def test_without_80_gb_capacity_the_40_gb_worker_is_marked_fallback(tmp_path):
    launch = _mock_launch("i-40", drop_80=True)
    m = _manager(tmp_path, gpu_file_system_name="acudx-wm")
    try:
        w = await m.ensure_worker()
        st = await m.status()
    finally:
        await m.aclose()
    assert w.instance_type == "gpu_1x_a100_sxm4" and w.region == "us-east-1"
    body = json.loads(launch.calls.last.request.content)
    assert body.get("file_system_names") == ["acudx-wm"]
    tier = st["workers"][0]["video_tier"]
    assert tier["tier"] == "fallback" and "no 80 GB card had capacity" in tier["notice"]


def test_two_card_h100_goes_first_for_video_and_falls_back_to_one_card():
    # Owner decision 2026-10-22: the avatar runner and the edits on a card of their own, vLLM and the voices on
    # the other; one H100 SXM5 card when no 2x host has capacity (docs/architecture/18 6.3.11).
    pol = WorkerPolicy(allowlist=["gpu_2x_h100_sxm5", "gpu_1x_h100_pcie", "gpu_1x_h100_sxm5", "gpu_1x_a100_sxm4"])
    offers = _offers()
    assert choose_offer(offers, pol, [], [])[0].instance_type_name == "gpu_2x_h100_sxm5"   # though 2x the price
    offers["gpu_2x_h100_sxm5"].regions_with_capacity_available.clear()
    assert choose_offer(offers, pol, [], [])[0].instance_type_name == "gpu_1x_h100_sxm5"
    offers["gpu_1x_h100_sxm5"].regions_with_capacity_available.clear()
    assert choose_offer(offers, pol, [], [])[0].instance_type_name == "gpu_1x_a100_sxm4"   # the 40 GB fallback
    # A policy without the 2x type in its allowlist never launches one.
    one = WorkerPolicy(allowlist=["gpu_1x_h100_sxm5", "gpu_1x_a100_sxm4"])
    assert choose_offer(_offers(), one, [], [])[0].instance_type_name == "gpu_1x_h100_sxm5"
