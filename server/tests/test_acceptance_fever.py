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
    state, visible, _ = D.next_state(state, D.Action(kind="elapsed", elapsed_ms=600_000))
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
