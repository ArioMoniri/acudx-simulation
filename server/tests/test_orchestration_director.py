"""Clinical Director: deterministic bounds, complications, facts, treatment effects."""

from __future__ import annotations

import random

import httpx

from server.case_generator import build_template_spec
from server.condition_catalog import CATALOG
from server.orchestration import director as D
from server.orchestration.judges import VITAL_BOUNDS
from server.orchestration.llm import StructuredLLM
from server.tests.conftest import make_settings
from server.tests.openai_double import Scenario, build_double

COND = {c["id"]: c for c in CATALOG}


def _spec(cond_id: str, acuity: int | None = None) -> dict:
    cond = COND[cond_id]
    spec = build_template_spec(cond, seed=3, locale="en", acuity=acuity or cond["typical_acuity"],
                               difficulty=cond["difficulty"], rng=random.Random(3))
    spec["meta"] = {"condition_id": cond_id}
    return spec


def test_graph_topology():
    g = D.build_director_graph(None).compile()
    nodes = g.get_graph().nodes
    for name in ("perceive", "physiology", "complications", "narrate", "emit"):
        assert name in nodes


def test_from_spec_plans_a_deadline_for_acute_cases():
    state = D.CaseState.from_spec(_spec("acs_stemi"))  # ESI 1
    assert state.acuity_esi == 1
    assert state.pending_complications and state.pending_complications[0].deadline_ms == 10 * 60_000
    assert {"asa_p2y12", "primary_pci"} <= set(state.pending_complications[0].required_any_of)
    calm = D.CaseState.from_spec(_spec("gi_reflux"))
    assert calm.pending_complications == []


def test_spo2_never_exceeds_100_and_hr_stays_in_bounds():
    spec = _spec("asthma_exacerbation")
    spec["triage_vitals"].update({"spo2": 99, "hr": 240})
    spec["vitals_trajectory"] = [{"atMs": 0, **spec["triage_vitals"]}]
    # Four oxygen-like treatments plus a bespoke huge-delta agent.
    spec["treatments"].append({"code": "mega", "label_en": "Mega agent", "label_tr": "", "appropriateness": "neutral",
                               "effects": [{"key": "spo2", "delta": 40, "onsetMs": 1000}, {"key": "hr", "delta": 300, "onsetMs": 1000}]})
    state = D.CaseState.from_spec(spec)
    for code in ("oxygen", "oxygen", "mega", "mega"):
        state, visible, _ = D.next_state(state, D.Action(kind="treatment", ref=code, elapsed_ms=120_000))
        assert visible["vitals"]["spo2"] <= 100
        assert VITAL_BOUNDS["hr"][0] <= visible["vitals"]["hr"] <= VITAL_BOUNDS["hr"][1]
    state, visible, _ = D.next_state(state, D.Action(kind="elapsed", elapsed_ms=3_600_000))
    assert visible["vitals"]["spo2"] == 100 and visible["vitals"]["hr"] == 250
    assert visible["vitals"]["diastolic"] < visible["vitals"]["systolic"]


def test_lower_bounds_hold_under_massive_deterioration():
    spec = _spec("septic_shock")
    spec["triage_vitals"].update({"hr": 25, "systolic": 45, "diastolic": 30, "spo2": 60, "rr": 2})
    spec["vitals_trajectory"] = [{"atMs": 0, **spec["triage_vitals"]}]
    state = D.CaseState.from_spec(spec)
    state, visible, _ = D.next_state(state, D.Action(kind="elapsed", elapsed_ms=2 * 3_600_000))  # deadline missed
    v = visible["vitals"]
    for key, (lo, hi) in VITAL_BOUNDS.items():
        assert lo <= v[key] <= hi, key
    assert visible["affect"]["consciousness"] == "unresponsive"


def test_complication_fires_after_missed_deadline_and_logs_why():
    state = D.CaseState.from_spec(_spec("acs_stemi"))
    before = state.vitals.hr
    state, visible, notes = D.next_state(state, D.Action(kind="question", ref="onset"))
    assert visible["complications_fired"] == []
    state, visible, notes = D.next_state(state, D.Action(kind="elapsed", elapsed_ms=11 * 60_000))
    assert visible["complications_fired"] == ["missed_time_critical_treatment"]
    fired = state.pending_complications[0]
    assert fired.fired_at_ms is not None
    why = [n for n in notes if "fired" in n["note"]]
    assert why and "no indicated treatment" in why[0]["why"]
    assert state.errors and state.errors[-1]["kind"] == "missed_deadline"
    # Deterioration ramps in over time: later vitals are worse than at the deadline.
    state, later, _ = D.next_state(state, D.Action(kind="elapsed", elapsed_ms=10 * 60_000))
    assert later["vitals"]["hr"] > before
    assert "worse" in later["utterance_en"] or later["affect"]["consciousness"] != "alert" or visible["utterance_en"]


def test_timely_indicated_treatment_averts_the_complication():
    state = D.CaseState.from_spec(_spec("acs_stemi"))
    state, _, notes = D.next_state(state, D.Action(kind="treatment", ref="asa_p2y12", elapsed_ms=5 * 60_000))
    assert state.pending_complications[0].cancelled
    assert any("averted" in n["note"] for n in notes)
    state, visible, _ = D.next_state(state, D.Action(kind="elapsed", elapsed_ms=60 * 60_000))
    assert visible["complications_fired"] == []
    assert not state.errors


def test_contraindicated_treatment_logs_error_and_adverse_effect():
    state = D.CaseState.from_spec(_spec("aortic_dissection"))
    hr0 = state.vitals.hr
    state, visible, notes = D.next_state(state, D.Action(kind="treatment", ref="thrombolysis", elapsed_ms=180_000))
    assert state.errors[-1] == {"at_ms": 180_000, "kind": "contraindicated_treatment", "detail": "thrombolysis"}
    assert any("contraindicated" in n["note"] for n in notes)
    assert visible["vitals"]["hr"] >= hr0  # adverse tachycardia applied (bounded)


def test_questions_and_exams_reveal_sanctioned_facts_once():
    spec = _spec("appendicitis")
    state = D.CaseState.from_spec(spec)
    onset = next(h["answer_en"] for h in spec["hpi"] if h["intent"] == "onset")
    state, visible, _ = D.next_state(state, D.Action(kind="question", ref="onset"))
    assert visible["new_facts"] == [onset] and visible["utterance_en"] == onset
    state, visible, _ = D.next_state(state, D.Action(kind="question", ref="onset"))
    assert visible["new_facts"] == []  # already sanctioned
    maneuver = spec["exam"][0]["maneuver"]
    state, visible, _ = D.next_state(state, D.Action(kind="exam", ref=maneuver))
    assert spec["exam"][0]["finding_en"] in visible["new_facts"]
    state, visible, notes = D.next_state(state, D.Action(kind="order", ref="not-a-real-order"))
    assert visible["new_facts"] == [] and any("unlocks nothing" in n["note"] for n in notes)
    assert state.revealed["question"] == ["onset"] and state.revealed["exam"] == [maneuver]


def test_generic_effect_table_is_gated_on_vitals():
    v = D.Vitals(spo2=99, systolic=120, tempC=37.0, rr=14, hr=80, diastolic=80)
    assert D.generic_effects_for("oxygen", "", v) == []           # not hypoxic
    assert D.generic_effects_for("saline bolus", "", v) == []     # not hypotensive
    low = D.Vitals(spo2=88, systolic=85, tempC=39.1, rr=28, hr=120, diastolic=50)
    assert D.generic_effects_for("oxygen", "", low)[0].key == "spo2"
    assert {e.key for e in D.generic_effects_for("313002", "Normal saline", low)} == {"systolic", "diastolic"}
    assert D.generic_effects_for("paracetamol", "", low)[0].delta < 0
    assert D.generic_effects_for("unknown-agent", "", low) == []


def test_trajectory_interpolation_and_ramp():
    pts = [{"atMs": 0, "hr": 100, "systolic": 120, "diastolic": 80, "rr": 20, "spo2": 95, "tempC": 37.0},
           {"atMs": 600_000, "hr": 120, "systolic": 100, "diastolic": 70, "rr": 28, "spo2": 90, "tempC": 37.4}]
    mid = D.baseline_at(pts, 300_000, D.Vitals())
    assert mid["hr"] == 110 and mid["spo2"] == 92.5
    assert D.baseline_at(pts, 10**9, D.Vitals())["hr"] == 120
    assert D.ramp(-10, 100_000, 50_000) == -5 and D.ramp(-10, 100_000, 10**9) == -10 and D.ramp(5, 0, 1) == 5


async def test_narrator_model_only_changes_wording_and_affect():
    sc = Scenario()
    llm = StructuredLLM(make_settings(), transport=httpx.ASGITransport(app=build_double(sc)))
    try:
        state = D.CaseState.from_spec(_spec("acs_stemi"))
        det_state, det_visible, _ = D.next_state(state, D.Action(kind="question", ref="severity"))
        mod_state, mod_visible, _ = await D.anext_state(state, D.Action(kind="question", ref="severity"), llm)
    finally:
        await llm.aclose()
    assert mod_visible["vitals"] == det_visible["vitals"]
    assert mod_state.sanctioned_facts == det_state.sanctioned_facts
    assert mod_visible["utterance_en"] == "It hurts, doctor, please help."
    assert mod_state.affect.pain == 7 and mod_state.affect.mood_en == "scared"
    narrate = next(e for e in mod_visible["trace"] if e["node"] == "director:narrate")
    assert narrate["model"] == sc.model and narrate["tokens_in"] > 0
    assert len(sc.role_calls("director")) == 1


async def test_narrator_falls_back_when_model_unreachable():
    llm = StructuredLLM(make_settings(llm_base_url="http://127.0.0.1:9/v1"), retries=0)
    try:
        state = D.CaseState.from_spec(_spec("acs_stemi"))
        _, visible, _ = await D.anext_state(state, D.Action(kind="exam", ref="cardiovascular"), llm)
    finally:
        await llm.aclose()
    assert visible["utterance_en"] == "Go ahead, doctor."
    narrate = next(e for e in visible["trace"] if e["node"] == "director:narrate")
    assert narrate["status"] == "fail" and "ModelUnreachable" in narrate["note"]
