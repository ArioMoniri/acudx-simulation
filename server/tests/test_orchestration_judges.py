"""Deterministic judge checks and the majority-with-veto aggregator."""

from __future__ import annotations

import random

from server.case_generator import build_template_spec
from server.condition_catalog import CATALOG
from server.orchestration import judges as J

COND = {c["id"]: c for c in CATALOG}


def _draft(cond_id: str) -> dict:
    cond = COND[cond_id]
    spec = build_template_spec(cond, seed=1, locale="en", acuity=cond["typical_acuity"],
                               difficulty=cond["difficulty"], rng=random.Random(1))
    for h in spec["hpi"]:
        if h["intent"] == "red-flags":
            h["red_flag"] = True
    return spec


def test_template_drafts_pass_all_deterministic_checks():
    # The graph normalises every draft before the council (SI glucose to the
    # reference table's mg/dL, for example), so the template does too here.
    from server.orchestration.normalize import normalize_draft

    for cond_id in ("acs_stemi", "septic_shock", "dka", "pneumonia_cap", "subarachnoid_hemorrhage"):
        d = _draft(cond_id)
        normalize_draft(d, COND[cond_id], seed=1)
        for name, check in J.DETERMINISTIC.items():
            res = check(d, COND[cond_id])
            assert res["ok"], f"{name} failed on {cond_id}: {res['issues']}"


def test_consistency_flags_impossible_vitals():
    d = _draft("acs_nstemi")
    d["triage_vitals"]["spo2"] = 101
    d["triage_vitals"]["diastolic"] = d["triage_vitals"]["systolic"] + 5
    d["vitals_trajectory"][1]["atMs"] = 0
    res = J.check_clinical_consistency(d, COND["acs_nstemi"])
    assert not res["ok"]
    joined = " ".join(res["issues"])
    assert "spo2=101" in joined and "diastolic >= systolic" in joined and "atMs not increasing" in joined


def test_consistency_flags_lab_flag_mismatch():
    d = _draft("acs_stemi")
    d["labs"][0]["flag"] = "N"  # troponin 5200 with normal flag
    res = J.check_clinical_consistency(d, COND["acs_stemi"])
    assert any("flagged N" in i for i in res["issues"])


def test_safety_vetoes_contraindicated_marked_indicated():
    d = _draft("aortic_dissection")
    for t in d["treatments"]:
        if t["code"] == "thrombolysis":
            t["appropriateness"] = "indicated"
    res = J.check_safety_dosing(d, COND["aortic_dissection"])
    assert not res["ok"]
    assert any("thrombolysis" in i and "contraindicated" in i for i in res["issues"])


def test_safety_caps_effect_deltas_and_unknown_keys():
    d = _draft("acs_stemi")
    d["treatments"][0]["effects"] = [{"key": "hr", "delta": -90, "onsetMs": 1000}, {"key": "glucose", "delta": 1, "onsetMs": 0}]
    res = J.check_safety_dosing(d, COND["acs_stemi"])
    joined = " ".join(res["issues"])
    assert "exceeds cap" in joined and "unknown effect key" in joined


def test_pedagogy_requires_red_flag_and_onset():
    d = _draft("acs_stemi")
    for h in d["hpi"]:
        h["red_flag"] = False
    d["hpi"] = [h for h in d["hpi"] if h["intent"] != "onset"]
    d["acuity_esi"] = 5  # typical is 1: too far
    res = J.check_pedagogy(d, COND["acs_stemi"])
    joined = " ".join(res["issues"])
    assert "red_flag" in joined and "onset" in joined and "acuity_esi" in joined


def _vote(judge: str, verdict: str, round_no: int = 0) -> dict:
    return {"judge": judge, "round": round_no, "verdict": verdict,
            "veto": judge == "safety_dosing" and verdict == "fail", "issues": [f"{judge} issue"] if verdict == "fail" else [],
            "repair_hints": []}


def test_aggregate_majority_and_veto():
    ok = J.aggregate_votes([_vote("clinical_consistency", "pass"), _vote("safety_dosing", "pass"), _vote("pedagogy", "fail")], 0)
    assert ok["decision"] == "accept" and ok["passes"] == 2 and not ok["vetoed"]
    veto = J.aggregate_votes([_vote("clinical_consistency", "pass"), _vote("safety_dosing", "fail"), _vote("pedagogy", "pass")], 0)
    assert veto["decision"] == "repair" and veto["vetoed"] and veto["passes"] == 2
    minority = J.aggregate_votes([_vote("clinical_consistency", "fail"), _vote("safety_dosing", "pass"), _vote("pedagogy", "fail")], 0)
    assert minority["decision"] == "repair" and not minority["vetoed"]


def test_aggregate_counts_only_current_round():
    votes = [_vote("clinical_consistency", "fail", 0), _vote("safety_dosing", "fail", 0), _vote("pedagogy", "fail", 0),
             _vote("clinical_consistency", "pass", 1), _vote("safety_dosing", "pass", 1), _vote("pedagogy", "pass", 1)]
    assert J.aggregate_votes(votes, 1)["decision"] == "accept"
    assert J.aggregate_votes(votes, 0)["decision"] == "repair"


def test_judge_reply_has_room_for_a_whole_verdict():
    assert J.JUDGE_MAX_TOKENS >= 900
