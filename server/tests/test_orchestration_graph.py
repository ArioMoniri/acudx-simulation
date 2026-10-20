"""Case generator v2 graph: topology, council veto, repair bound, grounding, memory."""

from __future__ import annotations

import pytest

from server.condition_catalog import CATALOG
from server.guidelines_seed import all_statements
from server.orchestration import graph as G
from server.orchestration.judges import JUDGES
from server.orchestration.memory import LearnerMemory
from server.orchestration.routes import OrchestrationRuntime
from server.tests.conftest import make_settings
from server.tests.openai_double import Scenario, build_double

import httpx

SEED_IDS = {s["id"] for s in all_statements()}
# Acceptance 2026-10-20 D-11: anchors come from the verified store (which holds
# the seed ids that passed verification plus the open statements).
from server.case_generator import _verified_statements  # noqa: E402

VERIFIED_IDS = set(_verified_statements())


def _compiled(deps: G.CaseGenDeps | None = None):
    return G.build_casegen_graph(deps or G.CaseGenDeps(llm=None)).compile()


def test_graph_topology_compiles():
    app = _compiled()
    nodes = set(app.get_graph().nodes)
    for name in ("sample_condition", "author", "aggregate", "repair", "ground", "finalize", *JUDGES):
        assert name in nodes
    mermaid = app.get_graph().draw_mermaid()
    assert "sample_condition --> author" in mermaid
    assert "ground --> finalize" in mermaid


async def _run(runtime: OrchestrationRuntime, **request):
    state = G.initial_state(request, "t-" + str(abs(hash(frozenset(request.items())))))
    return await runtime.graph.ainvoke(state, runtime.config(state["thread_id"]))


async def test_happy_path_is_model_sourced_and_traced(runtime: OrchestrationRuntime, scenario: Scenario):
    out = await _run(runtime, system="cardiology", seed=11)
    spec = out["spec"]
    assert spec["meta"]["source"] == "model"
    assert spec["meta"]["generator"] == "v2"
    assert spec["meta"]["degraded"] is False
    assert spec["condition"]["system"] == "cardiology"
    nodes = [e["node"] for e in out["trace"]]
    assert nodes[:2] == ["sample_condition", "author"]
    assert {f"judge:{j}" for j in JUDGES} <= set(nodes)
    assert nodes[-3:] == ["aggregate", "ground", "finalize"]
    author = next(e for e in out["trace"] if e["node"] == "author")
    assert author["tokens_in"] == scenario.prompt_tokens and author["tokens_out"] == scenario.completion_tokens
    assert author["cost_usd"] == 0.0  # local model row in the price table
    assert author["attributes"]["temperature"] == 0.7
    author_call = scenario.role_calls("author")[0]
    assert author_call["response_format"] == "json_schema"
    summary = spec["meta"]["trace_summary"]
    assert summary["model_calls"] == 4  # author + 3 judges, no repair
    assert out["council"]["decision"] == "accept" and out["repairs"] == 0


async def test_safety_veto_triggers_one_repair(double_transport, scenario: Scenario):
    scenario.author_unsafe = True
    rt = await OrchestrationRuntime.create(make_settings(), transport=double_transport, in_memory=True)
    try:
        out = await _run(rt, system="cardiology", complaint="chest", seed=3)
    finally:
        await rt.aclose()
    rounds = [v for v in out["votes"] if v["round"] == 0]
    safety = next(v for v in rounds if v["judge"] == "safety_dosing")
    assert safety["verdict"] == "fail" and safety["veto"] is True
    assert safety["model"] is None  # deterministic failure: the model was not asked
    assert out["repairs"] == 1
    assert out["council"]["decision"] == "accept"
    assert out["spec"]["meta"]["degraded"] is False
    assert len(scenario.role_calls("repair")) == 1
    nodes = [e["node"] for e in out["trace"]]
    assert nodes.count("repair") == 1 and nodes.count("aggregate") == 2


async def test_repair_loop_is_bounded_and_overrides_apply(double_transport, scenario: Scenario):
    scenario.author_unsafe = True
    scenario.repair_fixes = False
    rt = await OrchestrationRuntime.create(make_settings(), transport=double_transport, in_memory=True, max_repairs=2)
    try:
        out = await _run(rt, system="cardiology", complaint="aortic dissection", seed=5)
    finally:
        await rt.aclose()
    assert out["repairs"] == 2
    assert len(scenario.role_calls("repair")) == 2
    assert out["council"]["decision"] == "repair" and out["council"]["vetoed"] is True
    spec = out["spec"]
    assert spec["meta"]["source"] == "model"          # still the model's case, labelled honestly
    assert spec["meta"]["degraded"] is True
    assert "council_exhausted" in spec["meta"]["note"]
    # The fixture-contraindicated treatments were forced back to contraindicated.
    from server.orchestration.judges import fixture_contraindicated_codes

    contra = fixture_contraindicated_codes(out["condition"]["id"])
    appr = {t["code"]: t["appropriateness"] for t in spec["treatments"]}
    assert contra and all(appr[c] == "contraindicated" for c in contra if c in appr)
    assert any(c in appr for c in contra)
    finalize = next(e for e in out["trace"] if e["node"] == "finalize")
    assert finalize["attributes"]["overrides"]


async def test_consistency_judge_catches_spo2_over_100(double_transport, scenario: Scenario):
    scenario.author_spo2_over_100 = True
    rt = await OrchestrationRuntime.create(make_settings(), transport=double_transport, in_memory=True)
    try:
        out = await _run(rt, system="pulmonology", seed=8)
    finally:
        await rt.aclose()
    first = next(v for v in out["votes"] if v["round"] == 0 and v["judge"] == "clinical_consistency")
    assert first["verdict"] == "fail"
    assert any("spo2" in i for i in first["issues"])
    assert out["spec"]["triage_vitals"]["spo2"] <= 100


async def test_model_phase_majority_without_veto(double_transport, scenario: Scenario):
    # Two judges pass, pedagogy fails at the model phase: majority accepts (no veto).
    scenario.judge_verdicts = {"pedagogy": "fail"}
    rt = await OrchestrationRuntime.create(make_settings(), transport=double_transport, in_memory=True)
    try:
        out = await _run(rt, system="neurology", seed=21)
    finally:
        await rt.aclose()
    assert out["council"]["decision"] == "accept" and out["council"]["passes"] == 2
    assert out["repairs"] == 0


async def test_grounding_attaches_only_existing_ids(runtime: OrchestrationRuntime):
    out = await _run(runtime, system="cardiology", complaint="STEMI", seed=2)
    ground = next(e for e in out["trace"] if e["node"] == "ground")
    assert "gs_does_not_exist" in ground["attributes"]["dropped_ids"]
    anchors = out["spec"]["guideline_anchors"]
    assert anchors, "a STEMI case has seed statements to anchor to"
    for a in anchors:
        assert a["statement_id"] in VERIFIED_IDS
        assert a["citation"].startswith("http")
        assert a["statement_en"]
    assert all(a["statement_id"] != "gs_does_not_exist" for a in anchors)


async def test_author_bad_json_is_retried_once_then_fails(double_transport, scenario: Scenario):
    from server.orchestration.llm import ModelOutputInvalid

    scenario.author_bad_json = 1
    rt = await OrchestrationRuntime.create(make_settings(), transport=double_transport, in_memory=True)
    try:
        out = await _run(rt, seed=9)
        assert out["spec"]["meta"]["source"] == "model"
        assert len(scenario.role_calls("author")) == 2
        scenario.author_bad_json = 2
        with pytest.raises(ModelOutputInvalid):
            await _run(rt, seed=10)
    finally:
        await rt.aclose()


async def test_learner_memory_avoids_repeats_and_targets_weak_system(runtime: OrchestrationRuntime, monkeypatch):
    mem: LearnerMemory = runtime.memory
    learner = "learner-1"
    hematology = [c for c in CATALOG if c["system"] == "hematology"]
    # Mark every hematology condition but one as seen; the sampler must pick the remaining one.
    remaining = hematology[-1]["id"]
    for c in hematology[:-1]:
        mem.record_case(learner, c["id"], "hematology")
    out = await _run(runtime, system="hematology", learner_id=learner, seed=77)
    assert out["spec"]["meta"]["condition_id"] == remaining
    assert mem.conditions_seen(learner)[0] == remaining  # finalize recorded it
    # Errors in endocrine make it the weak system; with steering forced on, sampling targets it.
    mem.record_error(learner, "contraindicated_treatment", "x", "endocrine")
    assert mem.weak_systems(learner)[0] == "endocrine"
    monkeypatch.setattr(G, "WEAK_SYSTEM_STEER_P", 1.0)
    out2 = await _run(runtime, learner_id=learner, seed=78)
    assert out2["condition"]["system"] == "endocrine"
    sample = next(e for e in out2["trace"] if e["node"] == "sample_condition")
    assert sample["attributes"]["steered_system"] == "endocrine"


async def test_memory_store_persists_in_sqlite(tmp_path, double_transport):
    db = tmp_path / "acudx.db"
    rt = await OrchestrationRuntime.create(make_settings(), transport=double_transport, db_path=str(db))
    try:
        out = await _run(rt, learner_id="L2", seed=1)
        snap = await rt.graph.aget_state(rt.config(out["thread_id"]))
        assert snap.values["spec"]["meta"]["condition_id"] == out["spec"]["meta"]["condition_id"]
        assert len(snap.values["trace"]) == len(out["trace"])
    finally:
        await rt.aclose()
    rt2 = await OrchestrationRuntime.create(make_settings(), transport=double_transport, db_path=str(db))
    try:
        assert rt2.memory.conditions_seen("L2") == [out["spec"]["meta"]["condition_id"]]
        # Learner case state lives in CaseStore (server/orchestration/store.py), tested in
        # test_orchestration_staged.py; the council graph keeps no learner-facing checkpoint.
    finally:
        await rt2.aclose()


def test_template_is_labelled_template():
    spec = G.template_spec({"system": "cardiology", "seed": 4})
    assert spec["meta"]["source"] == "template"
    assert spec["meta"]["degraded"] is True
    for a in spec["guideline_anchors"]:
        # A condition with no verified statement keeps its fixture summary with
        # no id; an unverified id is never attached (D-11).
        if a.get("statement_id"):
            assert a["statement_id"] in VERIFIED_IDS


def test_price_table_and_cost():
    from server.orchestration.prices import cost_usd, find_price

    assert cost_usd("qwen2.5-7b-instruct", 1000, 1000) == 0.0
    assert cost_usd("openai/gpt-oss-120b", 1_000_000, 1_000_000) == pytest.approx(0.75)
    assert cost_usd("some-unknown-model", 10, 10) is None
    assert find_price(None) is None


async def test_structured_call_disables_qwen3_thinking_and_does_not_retry_read_timeouts():
    """Live findings 2026-10-20 on the GPU worker: Qwen3 spent the budget thinking, and a
    read timeout was retried three times (282 s) before the honest 503."""
    import httpx
    from server.orchestration.llm import StructuredLLM
    from server.tests.conftest import make_settings

    seen: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        import json as _json
        seen.append(_json.loads(request.content))
        raise httpx.ReadTimeout("slow", request=request)

    settings = make_settings(casegen_base_url="http://127.0.0.1:3040/v1", casegen_model="acudx-llm")
    llm = StructuredLLM(settings, transport=httpx.MockTransport(handler), retries=2)
    import pytest
    from server.orchestration.llm import ModelUnreachable
    with pytest.raises(ModelUnreachable) as exc:
        await llm.complete_json([{"role": "user", "content": "x"}], schema={"type": "object"},
                             schema_name="t", role="casegen", temperature=0.1, max_tokens=10)
    assert len(seen) == 1, "a read timeout must not be retried"
    assert seen[0]["chat_template_kwargs"] == {"enable_thinking": False}
    assert "ReadTimeout" in str(exc.value)
    await llm.aclose()
