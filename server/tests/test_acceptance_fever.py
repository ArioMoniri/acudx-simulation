"""Regression tests for the defects the live acceptance run of 2026-10-20 found
(docs/review/05-acceptance-test-2026-10-20.md).

* D-03: the web chief-complaint families reached the sampler as free text and
  misrouted ("renal-urology" served strokes, "infectious" never served sepsis).
* D-04: febrile presentations without a vitals envelope arrived afebrile.
"""

from __future__ import annotations

import random

import pytest

from server import case_fixtures as fx
from server.condition_catalog import CATALOG, COMPLAINT_FAMILIES, _matches_complaint, sample_condition
from server.orchestration import director as D
from server.orchestration.graph import template_spec

BY_ID = {c["id"]: c for c in CATALOG}

# The ids the web picker sends (web/src/domain/caseGen.ts CHIEF_COMPLAINT_FAMILIES).
WEB_FAMILIES = (
    "chest-pain", "headache", "abdominal-pain", "dyspnea", "cardiology", "respiratory", "gi-surgical",
    "neurology", "infectious", "endocrine", "renal-urology", "vascular", "allergy", "obgyn",
    "rheumatology", "psychiatry",
)


def _pool(family: str) -> set[str]:
    return {c["id"] for c in CATALOG if _matches_complaint(c, family)}


def test_every_web_family_is_mapped_and_non_empty() -> None:
    for fam in WEB_FAMILIES:
        assert fam in COMPLAINT_FAMILIES, fam
        assert _pool(fam), f"family {fam} selects no condition"


def test_renal_urology_no_longer_serves_neurology() -> None:
    pool = _pool("renal-urology")
    assert "pyelonephritis" in pool and "renal_colic" in pool
    assert not pool & {"ischemic_stroke", "subarachnoid_hemorrhage", "migraine", "bacterial_meningitis"}


def test_respiratory_serves_pneumonia_not_opioid_overdose() -> None:
    pool = _pool("respiratory")
    assert {"pneumonia_cap", "asthma_exacerbation", "pulmonary_embolism"} <= pool
    assert "opioid_overdose" not in pool and "poisoning_unknown" not in pool


def test_infectious_includes_sepsis_and_infections_filed_elsewhere() -> None:
    pool = _pool("infectious")
    assert {"sepsis_uncomplicated", "septic_shock", "pneumonia_cap", "pyelonephritis", "bacterial_meningitis"} <= pool
    # Non-infective febrile mimics are not "infectious".
    assert not pool & {"nms", "serotonin_syndrome", "thyroid_storm", "heat_stroke"}


def test_free_text_tokens_match_at_word_start_only() -> None:
    neuro = BY_ID["ischemic_stroke"]
    assert not _matches_complaint(neuro, "urology")
    assert _matches_complaint(BY_ID["pneumonia_cap"], "fever")


@pytest.mark.parametrize("seed", range(8))
def test_sampler_honours_family(seed: int) -> None:
    cond = sample_condition(complaint="renal-urology", rng=random.Random(seed))
    assert cond["id"] in _pool("renal-urology")


FEBRILE = sorted(set(fx.FEBRILE_TEMP) | {k for k, v in fx.CONDITION_VITALS.items() if v.get("tempC", (0, 0))[0] >= 38.0})


@pytest.mark.parametrize("cid", sorted(fx.FEBRILE_TEMP))
def test_febrile_temp_rows_name_real_conditions(cid: str) -> None:
    assert cid in BY_ID
    lo, hi = fx.FEBRILE_TEMP[cid]
    assert 37.5 <= lo < hi <= 41.0


@pytest.mark.parametrize("cid", FEBRILE)
def test_febrile_templates_are_febrile(cid: str) -> None:
    cond = BY_ID[cid]
    for seed in range(1, 7):
        spec = template_spec({"complaint": cond["label_en"], "seed": seed})
        if spec["meta"]["condition_id"] != cid:
            continue  # the label matched a sibling condition; covered by its own row
        assert spec["triage_vitals"]["tempC"] >= 37.8, (cid, seed, spec["triage_vitals"])


def test_template_fever_cases_from_the_infectious_family_are_febrile() -> None:
    seen = 0
    for seed in range(1, 41):
        spec = template_spec({"complaint": "infectious", "seed": seed})
        cid = spec["meta"]["condition_id"]
        if cid in fx.FEBRILE_TEMP or cid in {"sepsis_uncomplicated", "septic_shock", "pneumonia_cap", "meningococcemia"}:
            seen += 1
            assert spec["triage_vitals"]["tempC"] >= 37.8, (cid, seed, spec["triage_vitals"])
    assert seen >= 10


# --------------------------------------------------------------------------- #
# D-09: formulary codes reach the Director                                     #
# --------------------------------------------------------------------------- #
def _meningitis_state() -> D.CaseState:
    spec = template_spec({"complaint": "Bacterial meningitis", "seed": 1})
    assert spec["meta"]["condition_id"] == "bacterial_meningitis"
    spec["triage_vitals"]["tempC"] = 39.2
    spec["vitals_trajectory"] = [{"atMs": 0, **spec["triage_vitals"]}]
    return D.CaseState.from_spec(spec)


def test_formulary_ceftriaxone_counts_as_the_indicated_antibiotic_row() -> None:
    state = _meningitis_state()
    assert state.pending_complications, "ESI 1-3 case plans a deadline"
    state, visible, notes = D.next_state(state, D.Action(kind="treatment", ref="2193", elapsed_ms=60_000))
    text = " ".join(n["note"] for n in notes)
    assert "applied (indicated)" in text, text
    assert "averted" in text, text
    assert not any(c.fired_at_ms for c in state.pending_complications)
    state, visible, _ = D.next_state(state, D.Action(kind="elapsed", elapsed_ms=3_600_000))
    assert visible["complications_fired"] == []


def test_formulary_paracetamol_lowers_a_fever() -> None:
    state = _meningitis_state()
    t0 = state.vitals.tempC
    state, _, notes = D.next_state(state, D.Action(kind="treatment", ref="161", elapsed_ms=60_000))
    assert any("0 effect" not in n["why"] for n in notes if "161" in n["note"]), notes
    # D-18: the case row authors a realistic 45-minute onset for paracetamol.
    state, visible, _ = D.next_state(state, D.Action(kind="elapsed", elapsed_ms=2_700_000))
    assert visible["vitals"]["tempC"] < t0 - 0.3


def test_fluids_alone_do_not_satisfy_an_antibiotics_plus_fluids_row() -> None:
    spec = template_spec({"complaint": "Sepsis", "seed": 1})
    assert spec["meta"]["condition_id"] == "pyelonephritis"  # row "IV antibiotics + fluids"
    state = D.CaseState.from_spec(spec)
    assert D.match_treatment_row(state, "313002") is None
    row = D.match_treatment_row(state, "2193")
    assert row is not None and row.code == "iv_abx_fluids"
    # A contraindicated row is never matched by stems.
    assert D.match_treatment_row(state, "2193").appropriateness != "contraindicated"


def test_sse_stream_cap_covers_an_author_call_plus_a_repair_round() -> None:
    """D-13: at 180 s the cap cut a live generation off mid repair (504)."""
    from server.config import Settings
    from server.orchestration import routes as orch_routes

    assert orch_routes.SSE_MAX_DURATION_S >= 2 * Settings().casegen_timeout_s


# --------------------------------------------------------------------------- #
# Second acceptance pass (docs/review/05, resolution column)                   #
# --------------------------------------------------------------------------- #
import random as _random  # noqa: E402

from server import case_generator as CG  # noqa: E402
from server.results.engine import resolve_order  # noqa: E402

FEBRILE_FAMILY = ("sepsis_uncomplicated", "septic_shock", "pneumonia_cap", "pyelonephritis", "bacterial_meningitis",
                  "cellulitis", "ascending_cholangitis", "septic_arthritis", "malaria", "influenza", "covid19", "pid",
                  "acute_prostatitis", "febrile_neutropenia")
VIRAL = {"influenza", "covid19"}


def _tspec(cid: str, seed: int = 1) -> dict:
    cond = BY_ID[cid]
    return CG.build_template_spec(cond, seed=seed, locale="en", acuity=cond["typical_acuity"],
                                  difficulty=cond["difficulty"], rng=_random.Random(seed))


@pytest.mark.parametrize("cid", FEBRILE_FAMILY)
def test_d18_every_febrile_condition_has_a_full_treatment_table(cid: str) -> None:
    rows = {t["code"]: t for t in _tspec(cid)["treatments"]}
    labels = " | ".join(t["label_en"].lower() for t in rows.values())
    indicated = [t for t in rows.values() if t["appropriateness"] == "indicated"]
    assert any(t["appropriateness"] == "contraindicated" for t in rows.values()), cid
    assert "paracetamol" in labels, cid
    assert "antipyretic" in rows and rows["antipyretic"]["effects"][0]["onsetMs"] >= 30 * 60_000
    for t in rows.values():
        for e in t["effects"]:
            assert e["onsetMs"] >= 5 * 60_000, (cid, t["code"], e)
    if cid in VIRAL:
        # NICE NG191: no antibiotics when a virus is the likely cause.
        abx = [t for t in rows.values() if "antibiotic" in t["label_en"].lower()]
        assert abx and all(t["appropriateness"] == "contraindicated" for t in abx), cid
    else:
        assert any(("antibiotic" in t["label_en"].lower() or "artesunate" in t["label_en"].lower()
                    or t["code"] in {"severity_abx", "abx_cellulitis", "abx_joint", "abx_pid", "abx_prostatitis"})
                   for t in indicated), cid
    if cid not in VIRAL | {"malaria", "cellulitis", "pid"}:
        assert "culture" in labels, cid


def test_d18_septic_shock_fluids_are_30_ml_per_kg_and_prostatitis_is_not_hyperkalaemia() -> None:
    shock = {t["code"]: t for t in _tspec("septic_shock")["treatments"]}
    assert "30 ml/kg" in shock["iv_fluids"]["label_en"].lower()
    assert "vasopressor" in shock and shock["starch"]["appropriateness"] == "contraindicated"
    pros = {lab["code"] for lab in _tspec("acute_prostatitis")["labs"]}
    assert "2823-3" not in pros and "5799-2" in pros


def _sepsis_state(seed: int = 2) -> D.CaseState:
    spec = template_spec({"complaint": "Sepsis", "seed": seed})
    assert spec["meta"]["condition_id"] == "sepsis_uncomplicated"
    return D.CaseState.from_spec(spec)


def test_d18_paracetamol_does_not_avert_the_sepsis_deadline_but_an_antibiotic_does() -> None:
    state = _sepsis_state()
    comp = state.pending_complications[0]
    assert "antipyretic" not in comp.required_any_of and "cultures" not in comp.required_any_of
    state, _, notes = D.next_state(state, D.Action(kind="treatment", ref="161", elapsed_ms=60_000))
    assert not any("averted" in n["note"] for n in notes)
    state, _, notes = D.next_state(state, D.Action(kind="treatment", ref="11124", elapsed_ms=60_000))
    assert any("averted" in n["note"] for n in notes), notes


@pytest.mark.parametrize("code", ["11124", "82122", "4413", "29561", "pip-tazo", "2193"])
def test_d17_every_formulary_antibiotic_matches_the_antibiotic_row_not_the_cultures_row(code: str) -> None:
    row = D.match_treatment_row(_sepsis_state(), code)
    assert row is not None and row.code == "abx", (code, row)


def test_d17_allergy_draw_is_prevalence_weighted_with_nkda_the_majority() -> None:
    draws = [_tspec("sepsis_uncomplicated", seed)["allergies_en"] for seed in range(1, 201)]
    nkda = sum(1 for a in draws if a == fx.NKDA[0])
    anaphylaxis = sum(1 for a in draws if "anaphylaxis" in a.lower())
    assert nkda > 100, nkda
    assert anaphylaxis < 20, anaphylaxis
    assert len(set(draws)) >= 4


@pytest.mark.parametrize("cid", FEBRILE_FAMILY)
def test_d12_febrile_templates_answer_every_fever_topic_and_examine_every_system(cid: str) -> None:
    spec = _tspec(cid)
    topics = {h.get("topic") for h in spec["hpi"]}
    assert set(fx.FEVER_TOPICS) <= topics, cid
    maneuvers = {e["maneuver"] for e in spec["exam"]}
    assert {"respiratory", "abdominal", "neurological", "skin", "musculoskeletal", "cardiovascular"} <= maneuvers, cid
    # The schema keeps the topic (pydantic ignores unknown fields otherwise).
    assert all(h.topic for h in CG.GeneratedCaseSpec.model_validate(spec).hpi if h.intent == "social-history"
               and h.answer_en in {x["answer_en"] for x in fx.fever_hpi(cid)})


def test_d12_condition_positives_reach_the_patient() -> None:
    men = {h["topic"]: h["answer_en"] for h in _tspec("bacterial_meningitis")["hpi"] if h.get("topic")}
    assert "stiff" in men["neck"].lower()
    mal = {h["topic"]: h["answer_en"] for h in _tspec("malaria")["hpi"] if h.get("topic")}
    assert "nigeria" in mal["travel"].lower()
    men_exam = " ".join(e["finding_en"] for e in _tspec("bacterial_meningitis")["exam"] if e["maneuver"] == "neurological")
    assert "kernig" in men_exam.lower()


def test_d11_condition_statements_are_verified_and_reach_the_anchors() -> None:
    verified = CG._verified_statements()
    for cid, rows in fx.CONDITION_STATEMENTS.items():
        for sid, _codes in rows:
            assert sid in verified, (cid, sid)
    for cid in FEBRILE_FAMILY:
        anchors = template_spec({"complaint": BY_ID[cid]["label_en"], "seed": 1})["guideline_anchors"]
        assert anchors
        for a in anchors:
            if a.get("statement_id"):
                assert a["statement_id"] in verified


def test_d11_unverified_seed_ids_are_never_attached() -> None:
    from server.orchestration.anchors import resolve_anchors

    anchors, dropped = resolve_anchors(["gs_nice_pyelonephritis"], BY_ID["pyelonephritis"])
    assert "gs_nice_pyelonephritis" in dropped
    assert anchors[0]["statement_id"] == "gs_nice_ng111_msu"
    assert anchors[0]["codes"] and anchors[0]["citation"].startswith("http")


def test_lactate_stays_below_shock_range_in_a_normotensive_patient() -> None:
    spec = _tspec("febrile_neutropenia")
    spec["labs"] = [lab for lab in spec["labs"] if lab["code"] != "2524-7"]  # model value, no anchor
    spec["triage_vitals"].update(systolic=118, diastolic=72)
    spec["vitals_trajectory"] = [{"atMs": 0, **spec["triage_vitals"]}]
    lac = resolve_order(spec, "2524-7", 3_600_000, seed=1)["observations"][0]["value"]
    assert lac <= 3.5, lac
    spec["triage_vitals"].update(systolic=78, diastolic=40)
    spec["vitals_trajectory"] = [{"atMs": 0, **spec["triage_vitals"]}]
    assert resolve_order(spec, "2524-7", 3_600_000, seed=1)["observations"][0]["value"] > 4.0


@pytest.mark.parametrize("cid", ["malaria", "sepsis_uncomplicated", "febrile_neutropenia", "hiv_seroconversion"])
def test_d23_cbc_differential_fits_inside_the_white_count(cid: str) -> None:
    obs = {o["loinc"]: o["value"] for o in resolve_order(_tspec(cid), "6690-2", 0, seed=1)["observations"]}
    assert obs["751-8"] + obs["731-0"] <= obs["6690-2"] + 0.05, obs


def test_malaria_and_hiv_counts_are_plausible() -> None:
    mal = {lab["code"]: lab["value"] for lab in _tspec("malaria")["labs"]}
    assert 4.0 <= mal["6690-2"] <= 11.0 and mal["777-3"] < 150
    hiv = {lab["code"]: lab["value"] for lab in _tspec("hiv_seroconversion")["labs"]}
    assert hiv["6690-2"] < 11.0 and hiv["1988-5"] < 50


def test_d20_client_matcher_mirrors_the_director_stem_table() -> None:
    """web/src/domain/treatmentMatch.ts must carry the same codes and stems."""
    import re
    from pathlib import Path

    ts = (Path(__file__).resolve().parents[2] / "web/src/domain/treatmentMatch.ts").read_text(encoding="utf-8")
    abx = set(re.findall(r'"([\w-]+)"', ts[ts.index("ANTIBIOTIC_CODES"):ts.index("]);")]))
    assert abx == set(D.ANTIBIOTIC_CODES)
    for code, stems in D.FORMULARY_ROW_STEMS.items():
        assert f'"{code}"' in ts or f"{code}:" in ts, code
        for st in stems:
            assert f'"{st}"' in ts, (code, st)
    for st in D.DIAGNOSTIC_ROW_STEMS:
        assert f'"{st}"' in ts, st


@pytest.mark.parametrize("rel", ["web/src/domain/conditionCitations.ts", "web/src/domain/formulary.ts",
                                 "web/src/state/progressStore.ts"])
def test_d11_every_client_citation_id_is_verified(rel: str) -> None:
    """Feedback rows and allergy alternatives cite only verified statements."""
    import re
    from pathlib import Path

    ts = (Path(__file__).resolve().parents[2] / rel).read_text(encoding="utf-8")
    ids = set(re.findall(r'"(gs_[a-z0-9_]+)"', ts))
    assert ids or rel.endswith("progressStore.ts")
    verified = CG._verified_statements()
    assert sorted(i for i in ids if i not in verified) == []
