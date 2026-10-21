"""A worker launched for the patient video can hold it, and a gateway only ever sweeps its own workers.

Production finding (2026-10-21): the cheapest-card rule launched a 24 GB A10, where vLLM with the
32B model, the voices, the MuseTalk runner and the image edit server cannot all fit, so the call
never got live video and the face never showed the case signs. And two gateways on one Lambda
account (a staging gateway next to production) would each have swept the other's workers.
"""

from __future__ import annotations

import json

import httpx
import respx

from server.config import Settings
from server.providers.gpu_worker import (
    WORKER_NAME_PREFIX,
    WorkerManager,
    WorkerPolicy,
    WorkerStore,
    llm_model_for,
)
from server.providers.lambda_cloud import LAMBDA_API_BASE, InstanceTypeOffer, gpu_memory_gb, pick_cheapest
from server.tests.conftest import CLOUD_INIT, load_fixture


class FakeClock:
    def __init__(self, t: float = 1_800_000_000.0):
        self.t = t

    def __call__(self) -> float:
        return self.t


async def _sleep(_: float) -> None:
    return None


def _manager(tmp_path, **over) -> WorkerManager:
    base = dict(airgapped=False, lambda_key="k", lambda_ssh_key_name="key", acudx_db_path=str(tmp_path / "a.db"),
                admin_token="adm", _env_file=None)
    base.update(over)
    s = Settings(**base)
    return WorkerManager(s, store=WorkerStore(s.acudx_db_path), clock=FakeClock(), sleep=_sleep,
                         template_path=CLOUD_INIT, poll_interval_s=0, boot_timeout_s=60, ready_timeout_s=60)


def _offers():
    return {k: InstanceTypeOffer.model_validate(v) for k, v in load_fixture("instance-types")["data"].items()}


# --- the card must hold the video ----------------------------------------------------------- #

def test_gpu_memory_is_read_from_the_offer():
    offers = _offers()
    assert gpu_memory_gb(offers["gpu_1x_a10"].instance_type) == 24
    assert gpu_memory_gb(offers["gpu_1x_a100_sxm4"].instance_type) == 40
    assert gpu_memory_gb(offers["gpu_1x_h100_sxm5"].instance_type) == 80
    assert gpu_memory_gb(offers["cpu_4x_general"].instance_type) is None


def test_pick_cheapest_skips_cards_below_the_minimum():
    offers = _offers()
    allow = ["gpu_1x_a100_sxm4", "gpu_1x_a10", "gpu_1x_a100", "gpu_1x_h100_pcie"]
    assert pick_cheapest(offers, allow).instance_type_name == "gpu_1x_a10"           # no minimum: as before
    choice = pick_cheapest(offers, allow, min_gpu_memory_gb=40)
    assert choice is not None and choice.instance_type_name == "gpu_1x_a100_sxm4"
    assert pick_cheapest(offers, ["gpu_1x_a10"], min_gpu_memory_gb=40) is None


def test_policy_minimum_defaults_to_40_gb_and_old_saved_policies_get_it():
    assert WorkerPolicy().min_gpu_memory_gb == 40
    s = Settings(_env_file=None)
    assert s.gpu_min_gpu_memory_gb == 40
    assert WorkerPolicy.model_validate({"idle_minutes": 7}).min_gpu_memory_gb == 40


def test_the_32b_model_is_swapped_for_14b_on_cards_under_70_gb():
    assert llm_model_for("Qwen/Qwen3-32B-AWQ", 40) == "Qwen/Qwen3-14B-AWQ"
    assert llm_model_for("Qwen/Qwen3-32B-AWQ", 80) == "Qwen/Qwen3-32B-AWQ"
    assert llm_model_for("Qwen/Qwen3-14B-AWQ", 40) == "Qwen/Qwen3-14B-AWQ"
    assert llm_model_for("Qwen/Qwen3-32B-AWQ", None) == "Qwen/Qwen3-32B-AWQ"


def _mock_launch(instance_id: str = "i-new"):
    respx.get(f"{LAMBDA_API_BASE}/instance-types").mock(return_value=httpx.Response(200, json=load_fixture("instance-types")))
    respx.get(f"{LAMBDA_API_BASE}/firewall-rules").mock(return_value=httpx.Response(200, json=load_fixture("firewall-rules")))
    respx.put(f"{LAMBDA_API_BASE}/firewall-rules").mock(return_value=httpx.Response(200, json={"data": []}))
    launch = respx.post(f"{LAMBDA_API_BASE}/instance-operations/launch").mock(
        return_value=httpx.Response(200, json={"data": {"instance_ids": [instance_id]}}))
    inst = {**load_fixture("instances")["data"][1], "id": instance_id}
    respx.get(f"{LAMBDA_API_BASE}/instances/{instance_id}").mock(return_value=httpx.Response(200, json={"data": inst}))
    respx.get(url__regex=r"https://.*\.sslip\.io/healthz").mock(return_value=httpx.Response(200, text="ok"))
    return launch


@respx.mock
async def test_a_launch_picks_a_card_that_holds_the_video_and_a_model_that_fits_it(tmp_path):
    launch = _mock_launch()
    m = _manager(tmp_path, gpu_llm_model="Qwen/Qwen3-32B-AWQ")
    try:
        w = await m.ensure_worker()
    finally:
        await m.aclose()
    assert w.instance_type == "gpu_1x_a100_sxm4"                # not the cheaper 24 GB A10
    body = json.loads(launch.calls.last.request.content)
    assert "WORKER_LLM_MODEL=Qwen/Qwen3-14B-AWQ" in body["user_data"]   # 32B does not fit 40 GB next to video


# --- every gateway sweeps only its own workers ------------------------------------------------ #

def test_the_gateway_id_is_stable_per_database(tmp_path):
    a = WorkerStore(str(tmp_path / "x.db")).gateway_id()
    assert a == WorkerStore(str(tmp_path / "x.db")).gateway_id()
    assert len(a) == 8 and all(c in "0123456789abcdef" for c in a)
    assert WorkerStore(str(tmp_path / "y.db")).gateway_id() != a


@respx.mock
async def test_a_launch_names_and_tags_the_worker_with_the_gateway_id(tmp_path):
    launch = _mock_launch()
    m = _manager(tmp_path)
    gid = m.store.gateway_id()
    try:
        await m.ensure_worker()
    finally:
        await m.aclose()
    body = json.loads(launch.calls.last.request.content)
    assert body["name"].startswith(WORKER_NAME_PREFIX) and f"-g{gid}-" in body["name"]
    assert {"key": "acudx-gateway", "value": gid} in body["tags"]
    assert {"key": "acudx", "value": "gpu-worker"} in body["tags"]


def _instance(iid: str, name: str | None, tags: list | None = None) -> dict:
    return {**load_fixture("instances")["data"][1], "id": iid, "name": name, "status": "active", "tags": tags or []}


@respx.mock
async def test_the_sweep_never_touches_another_gateways_or_an_untagged_worker(tmp_path):
    m = _manager(tmp_path)
    gid = m.store.gateway_id()
    old = int(m._clock() - 3600)
    instances = [
        _instance("i-mine", f"acudx-worker-{old}-g{gid}-aaaa"),
        _instance("i-mine-tag", None, tags=[{"key": "acudx", "value": "gpu-worker"},
                                            {"key": "acudx-gateway", "value": gid}]),
        _instance("i-other-gw", f"acudx-worker-{old}-g0badc0de-bbbb"),
        _instance("i-legacy", f"acudx-worker-{old}-cccc"),       # a gateway before ids existed (production)
        _instance("i-other-tag", None, tags=[{"key": "acudx", "value": "gpu-worker"},
                                             {"key": "acudx-gateway", "value": "0badc0de"}]),
    ]
    respx.get(f"{LAMBDA_API_BASE}/instances").mock(return_value=httpx.Response(200, json={"data": instances}))
    term = respx.post(f"{LAMBDA_API_BASE}/instance-operations/terminate").mock(
        return_value=httpx.Response(200, json={"data": {"terminated_instances": []}}))
    try:
        first = await m.sweep_orphans()
        second = await m.sweep_orphans()
    finally:
        await m.aclose()
    killed = {i for c in term.calls for i in json.loads(c.request.content)["instance_ids"]}
    assert set(first) | set(second) == {"i-mine", "i-mine-tag"}
    assert killed == {"i-mine", "i-mine-tag"}


@respx.mock
async def test_sweep_unowned_opts_in_to_legacy_workers_only(tmp_path):
    m = _manager(tmp_path, gpu_sweep_unowned=True)
    old = int(m._clock() - 3600)
    instances = [_instance("i-legacy", f"acudx-worker-{old}-cccc"),
                 _instance("i-other-gw", f"acudx-worker-{old}-g0badc0de-bbbb")]
    respx.get(f"{LAMBDA_API_BASE}/instances").mock(return_value=httpx.Response(200, json={"data": instances}))
    respx.post(f"{LAMBDA_API_BASE}/instance-operations/terminate").mock(
        return_value=httpx.Response(200, json={"data": {"terminated_instances": []}}))
    try:
        assert await m.sweep_orphans() == ["i-legacy"]
    finally:
        await m.aclose()
