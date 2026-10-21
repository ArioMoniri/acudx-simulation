"""Ordered oxygen and antibiotics reach the course engine (live pneumonia run, 2026-10-21).

In the live fever case on a GPU worker (docs/review/08 section 7, docs/architecture/18
section 6.6) oxygen and antibiotics were sent to the Director and the case state still read
``o2: false`` while the patient kept getting worse. Root causes:

* an action of kind ``order`` whose code is a treatment (``oxygen``, ``7806``, a case row) was
  handled as a diagnostic order: it never reached the engine as a treatment, so no oxygen
  effect and ``o2`` stayed false;
* oxygen device codes such as ``nrb_15l`` named no known keyword, so they had no class;
* a named antibiotic sent by name (``ceftriaxone``, ``co_amoxiclav``) had the antibiotic class
  but no spectrum, and a group with spectrum needs refused it, so the antimicrobial target
  was never met.
"""

from __future__ import annotations

import pytest

from server.orchestration import director as D
from server.orchestration.normalize import classify_treatment
from server.tests.director_sim import spec_for

MIN = 60_000

# The arrival vitals of the live EN run (docs/media/live-avatar/state-sync/en/metrics.json).
LIVE_T0 = {"hr": 105, "systolic": 120, "diastolic": 80, "rr": 22, "spo2": 94, "tempC": 39}

OXYGEN_CODES = (
    "oxygen", "7806", "o2", "supplemental_o2", "o2_nasal_cannula", "nasal_cannula_2l", "nasal_prongs",
    "nrb", "nrb_15l", "nrbm", "non_rebreather_mask", "reservoir_mask_15l", "o2_15l_nrb",
    "hfnc", "hfnc_60l", "high_flow_nasal_oxygen", "hfno", "venturi_28", "simple_face_mask",
    "oksijen", "nazal_kanul",
)
# Antibiotics a learner or an API client names for community-acquired pneumonia; every one
# covers S. pneumoniae (gram_pos), the spectrum the pneumonia rule needs.
ANTIBIOTIC_CODES = (
    "severity_abx", "2193", "82122", "3640", "ceftriaxone", "co_amoxiclav", "co-amoxiclav", "amoxicillin",
    "amoxicillin_1g_po", "levofloxacin", "moxifloxacin", "doxycycline", "benzylpenicillin", "cefuroxime",
    "piperacillin_tazobactam", "iv_antibiotics",
)


def _state(t0: dict | None = None) -> D.CaseState:
    sp = spec_for("pneumonia_cap", t0=t0 is None)
    if t0 is not None:
        sp["triage_vitals"] = dict(t0)
        sp["vitals_trajectory"] = [{"atMs": 0, **t0}]
    return D.CaseState.from_spec(sp)


def _step(st: D.CaseState, kind: str, ref: str = "", elapsed: int | None = None) -> D.CaseState:
    st, _, _ = D.next_state(st, D.Action(kind=kind, ref=ref, elapsed_ms=elapsed))
    return st


def _target(st: D.CaseState, tid: str) -> str:
    return next(t["status"] for t in st.snapshot["targets"] if t["id"] == tid)


@pytest.mark.parametrize("code", OXYGEN_CODES)
def test_oxygen_codes_are_the_oxygen_class(code: str) -> None:
    assert "oxygen" in D.treatment_classes(code, None), code


@pytest.mark.parametrize("kind", ["treatment", "order"])
@pytest.mark.parametrize("code", OXYGEN_CODES)
def test_ordered_oxygen_sets_o2_and_raises_spo2(kind: str, code: str) -> None:
    base = _step(_state(), "elapsed", elapsed=30 * MIN)
    untreated = _step(base, "elapsed", elapsed=20 * MIN)
    st = _step(_step(base, kind, code, 0), "elapsed", elapsed=20 * MIN)
    assert st.snapshot["bedside"]["o2"] is True, (kind, code)
    assert st.vitals.spo2 > untreated.vitals.spo2, (kind, code, st.vitals.spo2, untreated.vitals.spo2)


@pytest.mark.parametrize("kind", ["treatment", "order"])
@pytest.mark.parametrize("code", ANTIBIOTIC_CODES)
def test_ordered_antibiotic_meets_the_antimicrobial_target(kind: str, code: str) -> None:
    st = _step(_state(), "elapsed", elapsed=60 * MIN)
    st = _step(st, kind, code, 0)
    st = _step(st, "elapsed", elapsed=200 * MIN)
    assert _target(st, "abx_4h") == "met", (kind, code, [n for n in st.snapshot.get("log") or []][-3:])
    assert "antibiotic" in {c for a in st.administered for c in a["classes"]}


def test_a_narrow_agent_by_name_is_still_checked_for_spectrum() -> None:
    """Clarithromycin alone covers atypicals, not S. pneumoniae: not adequate for this rule."""
    st = _step(_state(), "elapsed", elapsed=60 * MIN)
    st = _step(st, "treatment", "clarithromycin", 0)
    st = _step(st, "elapsed", elapsed=200 * MIN)
    assert _target(st, "abx_4h") == "breached"


def test_diagnostic_orders_stay_orders() -> None:
    st = _step(_state(), "order", "cultures", 0)
    assert not st.administered
    st = _step(st, "order", "2708-6", 0)        # a LOINC code: never a treatment
    assert not st.administered and st.snapshot["bedside"]["o2"] is False


def test_live_run_oxygen_and_antibiotics_ordered_turns_the_course() -> None:
    """The live EN timeline: 4 h untreated, then oxygen and antibiotics ordered, then 3 h."""
    st = _step(_state(LIVE_T0), "elapsed", elapsed=240 * MIN)
    worse = st.vitals.spo2
    untreated = _step(st, "elapsed", elapsed=180 * MIN)
    for code in ("o2_nrb_15l", "co_amoxiclav"):
        st = _step(st, "order", code)
    hour = _step(st, "elapsed", elapsed=60 * MIN)
    assert hour.snapshot["bedside"]["o2"] is True
    assert hour.vitals.spo2 > worse and hour.snapshot["phase"] == "improving"
    later = _step(hour, "elapsed", elapsed=120 * MIN)
    # Untreated for the same 3 h the patient arrests; treated late he is alive but has
    # progressed to ARDS (Berlin 2012), which needs ventilatory support on top.
    assert untreated.snapshot["bedside"]["pulse"] is False
    assert later.snapshot["bedside"]["pulse"] is True and later.snapshot["bedside"]["o2"] is True
    assert later.snapshot["severity"] < untreated.snapshot["severity"]


def test_classifier_keeps_niv_separate_from_plain_oxygen() -> None:
    assert classify_treatment("cpap") == ["niv"]
    assert "oxygen" in classify_treatment("nrb 15 l")
