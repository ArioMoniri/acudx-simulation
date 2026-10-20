"""Case quality fixes from the first live GPU-worker run (Qwen3-14B-AWQ, 2026-10-20).

Each block maps to one defect of the live outputs saved in
``server/tests/fixtures/live/`` (a sepsis case for "fever and rigors" and an
ascending cholangitis case for "fever and cough"):

1. empty treatment codes, 2. effect onsets in seconds, 3. empty labs, imaging and
red flags, 4. complaint adherence, 5. judges vetoing correct content,
6. latency, 7. unpriced self-hosted calls, 8. orchestration calls missing from
the admin telemetry.
"""

from __future__ import annotations

import copy
import json
import random
import re
import time
from pathlib import Path

import httpx
import pytest

from server.case_generator import build_template_spec
from server.condition_catalog import (
    CATALOG, COMPLAINT_INDEX, complaint_keys, conditions_for_complaint, sample_condition,
)
from server.orchestration import graph as G
from server.orchestration import judges as J
from server.orchestration import normalize as N
from server.orchestration.llm import COST_BASIS_GPU, StaticGpuCost, StructuredLLM, amortised_cost_usd
from server.orchestration.routes import OrchestrationRuntime
from server.orchestration.trace import summarize
from server.telemetry.events import TelemetryRecorder, call_context
from server.tests.conftest import make_settings
from server.tests.openai_double import Scenario, build_double

LIVE = Path(__file__).parent / "fixtures" / "live"
COND = {c["id"]: c for c in CATALOG}
ROOT = Path(__file__).resolve().parents[2]


def _live(name: str) -> tuple[dict, dict]:
    """(draft, condition) of a saved live output; the draft is what the model authored."""
    body = json.loads((LIVE / name).read_text(encoding="utf-8"))
    spec = copy.deepcopy(body["spec"])
    cond_id = spec.pop("meta")["condition_id"]
    spec.pop("guideline_anchors", None)
    return spec, copy.deepcopy(COND[cond_id])


RIGORS = "fever-fever_and_rigors.json"
COUGH = "fever-fever_and_cough.json"


def test_live_fixtures_reproduce_the_reported_defects():
    for name in (RIGORS, COUGH):
        draft, _ = _live(name)
        assert all(t["code"] == "" for t in draft["treatments"])
        assert draft["labs"] == [] and draft["imaging"] == [] and draft["red_flags"] == []
    sepsis, _ = _live(RIGORS)
    fluids = next(t for t in sepsis["treatments"] if "fluids" in t["label_en"].lower())
    assert max(e["onsetMs"] for e in fluids["effects"]) <= 2000


# --------------------------------------------------------------------------- #
# 1. Treatment codes                                                           #
# --------------------------------------------------------------------------- #
def test_web_catalog_mirror_matches_treatments_ts():
    ts = (ROOT / "web/src/domain/treatments.ts").read_text(encoding="utf-8")
    pairs = re.findall(r'opt\("([^"]+)", \{ en: "([^"]+)"', ts)
    assert pairs, "TREATMENT_CATALOG entries not found in treatments.ts"
    assert [(c, en) for c, en, _tr, _cls in N.WEB_TREATMENT_CATALOG] == pairs


def test_live_treatments_map_to_catalogue_codes():
    sepsis, cond = _live(RIGORS)
    report = N.normalize_draft(sepsis, cond, seed=1)
    codes = {t["label_en"]: t["code"] for t in sepsis["treatments"]}
    assert codes["IV fluids (normal saline)"] == "iv_fluids"
    assert codes["IV vancomycin"] == "abx"
    assert codes["Oxygen via nasal cannula"] == "7806"
    assert "NPO" not in codes and any("NPO" in n for n in report["notes"])
    assert report["unresolved_codes"] == []

    chol, cond = _live(COUGH)
    N.normalize_draft(chol, cond, seed=1)
    codes = {t["label_en"]: t["code"] for t in chol["treatments"]}
    assert codes["Urgent ERCP for biliary drainage"] == "biliary_drainage"
    assert codes["IV antibiotics (piperacillin-tazobactam)"] == "abx_fluids"
    assert codes["Acetaminophen for pain (paracetamol 1 g)"] == "161"
    # Antibiotics and fluids are one catalogue item for cholangitis: merged, not duplicated.
    assert len([t for t in chol["treatments"] if t["code"] == "abx_fluids"]) == 1
    for t in chol["treatments"]:
        assert N.known_treatment_code(t["code"]) or t["code"] in {v["code"] for v in N.condition_treatments(cond)}


def test_unresolvable_indicated_code_is_a_deterministic_veto():
    draft, cond = _live(RIGORS)
    N.normalize_draft(draft, cond, seed=1)
    draft["treatments"].append({"code": "", "label_en": "Hyperbaric chamber session", "label_tr": "Hiperbarik seans",
                                "appropriateness": "indicated", "effects": []})
    res = J.check_safety_dosing(draft, cond)
    assert not res["ok"]
    assert any("rule:treatment_code" in i and "Hyperbaric" in i for i in res["issues"])


def test_contraindicated_label_never_maps_to_a_drug_code():
    cond = COND["acs_stemi"]
    code = N.resolve_treatment_code({"label_en": "Delay antibiotics", "appropriateness": "contraindicated"},
                                    N.condition_treatments(cond))
    assert code is None


# --------------------------------------------------------------------------- #
# 2. Effect onsets and magnitudes                                              #
# --------------------------------------------------------------------------- #
def test_every_fixture_and_profile_effect_is_plausible():
    for cond in CATALOG:
        for t in N.condition_treatments(cond):
            assert N.effect_problems(t) == [], (cond["id"], t["code"])


def test_class_table_rows_are_sourced():
    for name, row in N.TREATMENT_CLASSES.items():
        assert row["onset"][0] < row["onset"][1], name
        assert "http" in row["source"] or "web/src/domain/treatments.ts" in row["source"], name


def test_safety_judge_flags_second_scale_onsets_and_normaliser_clamps_them():
    draft, cond = _live(RIGORS)
    raw = copy.deepcopy(draft)
    for t in raw["treatments"]:
        t["code"] = {"IV fluids (normal saline)": "iv_fluids", "IV vancomycin": "abx"}.get(t["label_en"], "7806")
    res = J.check_safety_dosing(raw, cond)
    assert any("implausibly fast" in i and "rule:effect_plausibility" in i for i in res["issues"])

    N.normalize_draft(draft, cond, seed=1)
    fluids = next(t for t in draft["treatments"] if t["code"] == "iv_fluids")
    assert {e["key"] for e in fluids["effects"]} == {"hr", "systolic", "diastolic"}   # no SpO2 from saline
    assert all(5 * 60_000 <= e["onsetMs"] <= 30 * 60_000 for e in fluids["effects"])
    abx = next(t for t in draft["treatments"] if t["code"] == "abx")
    assert abx["effects"] == []   # antibiotics move no vital inside a session
    assert all(N.effect_problems(t) == [] for t in draft["treatments"])


# --------------------------------------------------------------------------- #
# 3. Labs, imaging, red flags                                                  #
# --------------------------------------------------------------------------- #
def test_author_schema_requires_objective_sections():
    schema = G.AUTHOR_SCHEMA
    for key in ("labs", "imaging", "red_flags", "treatments", "vitals_trajectory"):
        assert key in schema["required"], key
        assert schema["properties"][key]["minItems"] >= 1, key
    assert schema["properties"]["guideline_anchor_ids"]["maxItems"] == 3
    assert "code" in schema["$defs"]["Treatment"]["required"]
    assert schema["$defs"]["Treatment"]["properties"]["code"]["minLength"] == 1


def test_author_prompt_carries_reference_labs_codes_and_complaint():
    cond = COND["pneumonia_cap"]
    msgs = G.author_messages(cond, locale="en", acuity=3, difficulty=2, candidates=[], complaint="fever and cough")
    user = msgs[1]["content"]
    assert "22664-7" in user and "mmol/L" in user            # reference lab code and unit
    assert "severity_abx" in user and "delay_abx" in user    # catalogue treatment codes
    assert "fever and cough" in user and "chief_complaint_en" in user
    assert "onsetMs is MILLISECONDS" in user


@pytest.mark.parametrize("name", [RIGORS, COUGH])
def test_gap_fill_from_fixture_is_labelled(name):
    draft, cond = _live(name)
    report = N.normalize_draft(draft, cond, seed=7)
    for field in ("labs", "imaging", "red_flags", "vitals_trajectory", "treatments.contraindicated"):
        assert field in report["gap_filled"], field
    assert draft["labs"] and draft["imaging"] and draft["red_flags"]
    ranges = N._ranges()
    for lab in draft["labs"]:
        a = ranges.get(lab["code"])
        if a and not a.get("qualitative"):
            assert N.unit_matches(lab["unit"], a["unit"]), lab
            assert lab["unit"] == a["unit"]
    assert J.check_clinical_consistency(draft, cond)["ok"]


def test_lab_units_are_converted_or_rejected():
    labs = [{"code": "2345-7", "label_en": "Glucose", "label_tr": "Glukoz", "value": 6.8, "unit": "mmol/L",
             "ref_low": 4.0, "ref_high": 7.8, "flag": "N"}]
    N.normalize_labs(labs, "female", 50)
    assert labs[0]["unit"] == "mg/dL" and 120 <= labs[0]["value"] <= 125
    bad = [{"code": "2524-7", "label_en": "Lactate", "label_tr": "Laktat", "value": 4, "unit": "g/L"}]
    assert any("rule:lab_unit" in p for p in N.lab_unit_problems(bad))


# --------------------------------------------------------------------------- #
# 4. Complaint adherence                                                       #
# --------------------------------------------------------------------------- #
def test_complaint_index_ids_exist_and_cover_catalog_complaints():
    for key, entry in COMPLAINT_INDEX.items():
        assert entry["conditions"] and all(c in COND for c in entry["conditions"]), key
        missing = [c["id"] for c in CATALOG
                   if key in complaint_keys(f"{c['typical_complaint_en']} {c['typical_complaint_tr']}")
                   and c["id"] not in entry["conditions"]]
        assert missing == [], (key, missing)


def test_fever_and_cough_never_samples_cholangitis():
    allowed = set(conditions_for_complaint("fever and cough"))
    assert "pneumonia_cap" in allowed and "ascending_cholangitis" not in allowed
    drawn = {sample_condition(complaint="fever and cough", rng=random.Random(i))["id"] for i in range(200)}
    assert drawn <= allowed
    assert complaint_keys("ateş ve öksürük") == ["fever", "cough"]
    # A recognised complaint wins over a system that cannot present with it.
    assert sample_condition(system="neurology", complaint="cough", rng=1)["id"] in set(COMPLAINT_INDEX["cough"]["conditions"])


def test_pedagogy_rejects_a_chief_complaint_that_ignores_the_request():
    draft, cond = _live(COUGH)
    N.normalize_draft(draft, cond, seed=1)
    cond["requested_complaint"] = "fever and cough"
    res = J.check_pedagogy(draft, cond)
    assert not res["ok"] and any("rule:complaint_adherence" in i for i in res["issues"])
    sepsis, scond = _live(RIGORS)
    N.normalize_draft(sepsis, scond, seed=1)
    scond["requested_complaint"] = "fever and rigors"
    assert J.check_pedagogy(sepsis, scond)["ok"]


# --------------------------------------------------------------------------- #
# 5. Evidence-bound judges                                                     #
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("name", [RIGORS, COUGH])
def test_live_fixtures_pass_every_deterministic_check_after_normalisation(name):
    draft, cond = _live(name)
    N.normalize_draft(draft, cond, seed=3)
    for judge, check in J.DETERMINISTIC.items():
        res = check(draft, cond)
        assert res["ok"], (name, judge, res["issues"])


def test_live_judge_opinions_become_notes_not_vetoes():
    draft, cond = _live(COUGH)
    body = json.loads((LIVE / COUGH).read_text(encoding="utf-8"))
    opinions = [i.split("] ", 1)[1] for i in body["council"]["issues"] if i.startswith("[clinical_consistency]")]
    assert any("Gallstones are not typically associated" in o for o in opinions)
    bound, notes = J.bind_issues(opinions, draft, cond)
    assert bound == [] and len(notes) == len(opinions)


def test_bind_issues_accepts_only_cited_and_quoted_evidence():
    cond = COND["ascending_cholangitis"]
    ev = J.evidence_index(cond)
    assert "fixture.imaging" in ev and "catalog.red_flags[0]" in ev
    good = {"field": "imaging[0]", "evidence": "fixture.imaging", "evidence_value": ev["fixture.imaging"],
            "problem": "imaging shows a normal duct", "fix": "describe the dilated duct"}
    misquoted = dict(good, evidence_value="bile ducts are not dilated in cholangitis")
    unknown = dict(good, evidence="guideline.tokyo")
    rule = dict(good, evidence="rule:vital_bounds")
    bound, notes = J.bind_issues([good, misquoted, unknown, rule, "free text opinion"], {}, cond)
    assert [b["evidence"] for b in bound] == ["fixture.imaging"]
    assert len(notes) == 4


async def _graph_run(scenario: Scenario, cond_id: str, monkeypatch, **request):
    cond = COND[cond_id]
    monkeypatch.setattr(G, "sample_condition", lambda **_kw: copy.deepcopy(cond))
    rt = await OrchestrationRuntime.create(make_settings(), transport=httpx.ASGITransport(app=build_double(scenario)),
                                           in_memory=True, time_budget_s=request.pop("time_budget_s", 120.0))
    try:
        state = G.initial_state(request, f"t-{cond_id}-{time.monotonic_ns()}")
        t0 = time.monotonic()
        out = await rt.graph.ainvoke(state, rt.config(state["thread_id"]))
        return out, time.monotonic() - t0
    finally:
        await rt.aclose()


@pytest.mark.parametrize("name,complaint", [(RIGORS, "fever and rigors"), (COUGH, None)])
async def test_live_drafts_are_accepted_without_repair(name, complaint, monkeypatch):
    draft, cond = _live(name)
    sc = Scenario(live_drafts=[draft], judge_verdicts={j: "fail" for j in J.JUDGES},
                  judge_free_text=set(J.JUDGES))   # the live judges' unbound opinions
    out, _ = await _graph_run(sc, cond["id"], monkeypatch, seed=5, complaint=complaint)
    meta = out["spec"]["meta"]
    assert meta["council"]["decision"] == "accept", meta["council"]
    assert meta["degraded"] is False and meta["council"]["repairs"] == 0
    assert meta["council"]["notes"], "model opinions are kept as notes"
    assert {"labs", "imaging", "red_flags"} <= set(meta["gap_filled"])
    assert all(t["code"] for t in out["spec"]["treatments"])
    assert len(sc.role_calls("repair")) == 0


# --------------------------------------------------------------------------- #
# 6. Latency                                                                   #
# --------------------------------------------------------------------------- #
async def test_judges_run_concurrently(monkeypatch):
    sc = Scenario(judge_delay_s=0.3)
    out, _ = await _graph_run(sc, "pneumonia_cap", monkeypatch, seed=2)
    judge_events = [e for e in out["trace"] if e["node"].startswith("judge:") and e.get("model")]
    assert len(judge_events) == 3
    starts = [e["ts"] - e["latency_ms"] / 1000.0 for e in judge_events]
    ends = [e["ts"] for e in judge_events]
    # Serial judges would need >= 0.9 s; overlapping ones finish in about one delay.
    assert max(ends) - min(starts) < 0.6
    assert max(starts) - min(starts) < 0.15


async def test_non_veto_failures_get_at_most_one_repair(monkeypatch):
    # Two bound model-phase failures, no veto: one repair, then finalize (degraded).
    sc = Scenario(judge_verdicts={"clinical_consistency": "fail", "pedagogy": "fail"})
    out, _ = await _graph_run(sc, "pneumonia_cap", monkeypatch, seed=4)
    assert out["repairs"] == 1 and len(sc.role_calls("repair")) == 1
    assert out["spec"]["meta"]["degraded"] is True and out["council"]["vetoed"] is False


async def test_time_budget_skips_a_repair_that_would_overrun(monkeypatch):
    sc = Scenario(author_unsafe=True, author_delay_s=0.2)
    out, _ = await _graph_run(sc, "aortic_dissection", monkeypatch, seed=4, time_budget_s=0.3)
    assert out["repairs"] == 0 and len(sc.role_calls("repair")) == 0
    assert out["spec"]["meta"]["degraded"] is True
    assert out["spec"]["meta"]["note"].startswith("time_budget_exceeded")


async def test_scaled_live_timing_fits_the_budget(monkeypatch):
    # Live worker timings scaled 1:100 (author 55 s -> 0.55 s, judge 11 s -> 0.11 s).
    # The live sepsis draft now passes on the first round, so the whole case is
    # one author call plus one parallel judge round: about 66 s live, target 120 s.
    draft, cond = _live(RIGORS)
    sc = Scenario(live_drafts=[draft], author_delay_s=0.55, judge_delay_s=0.11)
    out, wall = await _graph_run(sc, cond["id"], monkeypatch, seed=1, complaint="fever and rigors")
    assert out["spec"]["meta"]["council"]["decision"] == "accept"
    assert wall < 1.2, f"scaled wall {wall:.2f}s exceeds the 120 s live target"
    summary = summarize(out["trace"])
    assert summary["model_calls"] == 4 and summary["wall_ms"] < summary["latency_ms"]


# --------------------------------------------------------------------------- #
# 7. Amortised GPU cost and 8. telemetry                                       #
# --------------------------------------------------------------------------- #
def test_amortised_cost_math():
    assert amortised_cost_usd(3.6, 1000.0) == pytest.approx(0.001)
    assert amortised_cost_usd(3.6, 1000.0, concurrency=3) == pytest.approx(0.001 / 3, abs=1e-8)


async def test_self_hosted_calls_are_priced_and_reach_telemetry(tmp_path, monkeypatch):
    sc = Scenario(model="acudx-llm", judge_delay_s=0.05)
    telemetry = TelemetryRecorder(str(tmp_path / "t.db"))
    settings = make_settings(llm_model="acudx-llm")
    cond = COND["pneumonia_cap"]
    monkeypatch.setattr(G, "sample_condition", lambda **_kw: copy.deepcopy(cond))
    rt = await OrchestrationRuntime.create(settings, transport=httpx.ASGITransport(app=build_double(sc)),
                                           in_memory=True, telemetry=telemetry)
    rt.llm.gpu = StaticGpuCost(1.29)   # A10 list price per hour, as in the GPU ledger
    try:
        state = G.initial_state({"seed": 3}, "t-cost")
        with call_context(route="/v2/case/generate", tenant="acme"):
            out = await rt.graph.ainvoke(state, rt.config("t-cost"))
    finally:
        await rt.aclose()
    summary = out["spec"]["meta"]["trace_summary"]
    assert summary["unpriced_models"] == []
    assert summary["cost_usd"] and summary["cost_usd"] > 0
    assert summary["cost_basis"] == [COST_BASIS_GPU]
    judges = [e for e in out["trace"] if e["node"].startswith("judge:") and e.get("model")]
    assert all(e["cost_basis"] == COST_BASIS_GPU for e in judges)
    rows = telemetry.recent(limit=20)
    assert len(rows) == summary["model_calls"]
    for row in rows:
        assert row["kind"] == "llm" and row["provider"] == "gpu-worker" and row["model"] == "acudx-llm"
        assert row["route"] == "/v2/case/generate" and row["tenant"] == "acme"
        assert row["ok"] == 1 and row["cost_usd"] > 0 and row["tokens_in"] > 0


async def test_failed_orchestration_call_is_recorded(tmp_path, unreachable_settings):
    telemetry = TelemetryRecorder(str(tmp_path / "t.db"))
    llm = StructuredLLM(unreachable_settings, telemetry=telemetry)
    from server.orchestration.llm import ModelUnreachable

    with call_context(route="/v2/director/step"), pytest.raises(ModelUnreachable):
        await llm.complete_json([{"role": "user", "content": "x"}], schema={"type": "object"}, schema_name="x",
                                role="judge", temperature=0.0, max_tokens=8)
    await llm.aclose()
    row = telemetry.recent(limit=1)[0]
    assert row["ok"] == 0 and row["route"] == "/v2/director/step" and row["error"] == "ModelUnreachable"


def test_every_condition_has_a_contraindicated_distractor():
    # Without one no model-authored case can pass the safety judge (live sepsis case).
    for cond in CATALOG:
        spec = build_template_spec(cond, seed=1, locale="en", acuity=cond["typical_acuity"],
                                   difficulty=cond["difficulty"], rng=random.Random(1))
        assert any(t["appropriateness"] == "contraindicated" for t in spec["treatments"]), cond["id"]


@pytest.mark.parametrize("name", [c["id"] for c in CATALOG])
def test_every_template_passes_the_council_after_normalisation(name):
    cond = COND[name]
    spec = build_template_spec(cond, seed=1, locale="en", acuity=cond["typical_acuity"],
                               difficulty=cond["difficulty"], rng=random.Random(1))
    for h in spec["hpi"]:
        if h["intent"] == "red-flags":
            h["red_flag"] = True
    N.normalize_draft(spec, cond, seed=1)
    for judge in ("clinical_consistency", "safety_dosing"):
        res = J.DETERMINISTIC[judge](spec, cond)
        assert res["ok"], (name, judge, res["issues"])


# --------------------------------------------------------------------------- #
# 9. Patient turns on the worker skip Qwen3 thinking                          #
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("model,expect", [("acudx-llm", True), ("Qwen/Qwen3-14B-AWQ", True),
                                          ("qwen2.5-7b-instruct", False)])
async def test_gateway_chat_disables_qwen3_thinking(model, expect):
    import respx

    from server.config import Settings
    from server.model_gateway import ModelGateway

    cfg = Settings(_env_file=None, airgapped=False, llm_base_url="http://127.0.0.1:3040/v1", llm_model=model,
                   max_retries=0)
    gw = ModelGateway(cfg)
    await gw.start()
    try:
        with respx.mock:
            route = respx.post("http://127.0.0.1:3040/v1/chat/completions").mock(return_value=httpx.Response(200, json={
                "model": model, "choices": [{"message": {"content": "It hurts."}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 5, "completion_tokens": 2}}))
            res = await gw.chat([{"role": "user", "content": "where is the pain?"}], task="patient")
        body = json.loads(route.calls.last.request.content)
    finally:
        await gw.aclose()
    assert res.text == "It hurts." and res.had_reasoning is False
    assert ("chat_template_kwargs" in body) is expect
    if expect:
        assert body["chat_template_kwargs"] == {"enable_thinking": False}


def test_orchestration_reuses_the_gateway_thinking_rule():
    from server import model_gateway
    from server.orchestration import llm

    assert llm._wants_no_thinking is model_gateway.wants_no_thinking
