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
    base = dict(airgapped=False, lambda_key="k", lambda_ssh_key_name="key", acudx_db_path=str(tmp_path / "a.db"), anthropic_key="",
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
    m = _manager(tmp_path, gpu_llm_model="Qwen/Qwen3-32B-AWQ", gpu_preferred_gpu_memory_gb=0)
    try:
        w = await m.ensure_worker()
    finally:
        await m.aclose()
    assert w.instance_type == "gpu_1x_a100_sxm4"                # not the cheaper 24 GB A10
    body = json.loads(launch.calls.last.request.content)
    assert "WORKER_LLM_MODEL=Qwen/Qwen3-14B-AWQ" in body["user_data"]   # 32B does not fit 40 GB next to video


@respx.mock
async def test_a_worker_for_a_claude_deployment_leaves_its_own_llm_off(tmp_path):
    # docs/architecture/18 6.3.13: on an A100 40 GB vLLM held 18 GB that a Claude deployment never used, which
    # pushed the image edits into model offload (15.7 s an edit) beside a live call.
    launch = _mock_launch()
    m = _manager(tmp_path, anthropic_key="sk-test", gpu_preferred_gpu_memory_gb=0)
    try:
        await m.ensure_worker()
    finally:
        await m.aclose()
    assert "WORKER_LLM_MODEL=none" in json.loads(launch.calls.last.request.content)["user_data"]


@respx.mock
async def test_the_worker_llm_policy_keeps_or_drops_the_model(tmp_path):
    from server.providers.gpu_worker import worker_llm_wanted

    on = _manager(tmp_path / "on", anthropic_key="sk-test", gpu_worker_llm="on")
    off = _manager(tmp_path / "off", anthropic_key="", gpu_worker_llm="off")
    auto = _manager(tmp_path / "auto", anthropic_key="")
    try:
        assert worker_llm_wanted(on.policy, on.settings) is True        # the text fallback stays on the worker
        assert worker_llm_wanted(off.policy, off.settings) is False
        assert worker_llm_wanted(auto.policy, auto.settings) is True    # no Claude: the worker serves the text
        routed = _manager(tmp_path / "routed", anthropic_key="sk-test", anthropic_route=False)
        assert worker_llm_wanted(routed.policy, routed.settings) is True  # a key with the route off is no Claude
        await routed.aclose()
    finally:
        for m in (on, off, auto):
            await m.aclose()
    assert "worker_llm" in on.policy.model_dump()


def test_without_a_worker_llm_the_worker_skips_vllm_and_its_image():
    text = CLOUD_INIT.read_text(encoding="utf-8")
    assert 'if [ "${WORKER_LLM_MODEL:-}" = none ]; then\n      mark "vllm: off' in text
    assert '[ "${WORKER_LLM_MODEL:-}" = none ] && vllm_img=""' in text
    # the image edit server does not wait 40 minutes for a vLLM that never starts
    assert 'if [ "${WORKER_LLM_MODEL:-}" = none ]; then\n          $compose exec -T chatterbox' in text
    # the second Chatterbox replica gets vLLM's room on a 40 GB card
    assert '{ [ "${WORKER_LLM_MODEL:-}" = none ] && [ "${total:-0}" -ge 38000 ]; }' in text


def test_a_40_gb_card_streams_the_voice_with_a_shorter_first_window():
    # Bench 2026-10-22 (A100 40 GB, idle): T3 26 ms a token, S3Gen 490 ms a window; first audio 1.16 s with
    # 24 tokens and 10 flow steps, 0.98 s with 20 and 8 flow steps, and the longest pause 2.08 s -> 1.07 s.
    text = CLOUD_INIT.read_text(encoding="utf-8")
    assert "printf 'ACUDX_STREAM_SCHEDULE=20,24,48,64\\nACUDX_STREAM_FLOW_STEPS=8\\n' >> /opt/acudx/.env" in text
    assert text.count("- ACUDX_STREAM_SCHEDULE=${ACUDX_STREAM_SCHEDULE:-24,24,48,64}") == 2   # both replicas
    assert text.count("- ACUDX_STREAM_FLOW_STEPS=${ACUDX_STREAM_FLOW_STEPS:-10}") == 2


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
