"""ARDS ventilatory support counts high-flow nasal oxygen (product owner decision 2026-10-21).

ESICM 2023 ARDS guideline (Grasselli et al., https://doi.org/10.1007/s00134-023-07050-7),
recommendation 3.1, verified as ``gs_esicm2023_hfno_ahrf``: "We recommend that
non-mechanically ventilated patients with AHRF not due to cardiogenic pulmonary edema or
acute exacerbation of COPD receive HFNO as compared to conventional oxygen therapy to reduce
the risk of intubation" (strong recommendation, moderate evidence).

In the engine HFNC or HFNO is its own class (``hfnc``) that is also oxygen. The ARDS
ventilation group is met by ``hfnc``, ``niv`` or ``intubation`` (and the case rows
``lung_protective`` and ``prone``); low-flow oxygen (nasal cannula, face mask, NRB, Venturi)
is conventional oxygen and does not meet it. Because HFNC is still oxygen, the BTS 2017
hypercapnia harm rule keeps applying to it in hypercapnic COPD: the ESICM recommendation
excludes acute exacerbation of COPD and acute hypercapnic respiratory failure.
"""

from __future__ import annotations

import json

import pytest

from server.guidelines.store import EXPORT_PATH
from server.orchestration import director as D
from server.orchestration.normalize import classify_treatment
from server.tests.director_sim import SCENARIOS, run, spec_for

MIN = 60_000
LIVE_T0 = {"hr": 105, "systolic": 120, "diastolic": 80, "rr": 22, "spo2": 94, "tempC": 39}

HFNC_CODES = ("hfnc", "hfnc_60l", "hfno", "hfnot", "high_flow_nasal_oxygen", "high flow nasal cannula 60 L/min",
              "nasal high flow 50 L FiO2 0.6", "yüksek akım nazal oksijen", "yüksek akımlı nazal kanül",
              "yuksek akim nazal", "yüksek akışlı nazal kanül")
LOW_FLOW_CODES = ("nasal_cannula_2l", "nasal_prongs", "nrb", "nrb_15l", "o2_nrb_15l", "non_rebreather_mask",
                  "reservoir_mask_15l", "simple_face_mask", "venturi_28", "oxygen", "o2",
                  "High-flow oxygen 15 L/min via reservoir mask", "high_flow_o2", "Yüksek akım %100 oksijen",
                  "Rezervuarlı maske ile 15 L/dk yüksek akım oksijen", "nazal kanül")
NIV_CODES = ("niv", "cpap", "bipap", "non invasive ventilation")
INTUBATION_CODES = ("intubation", "intubate_and_ventilate", "rsi", "rapid sequence induction",
                    "endotracheal intubation", "mechanical ventilation", "entübasyon")


def _pneumonia(t0: dict) -> D.CaseState:
    sp = spec_for("pneumonia_cap", t0=False)
    sp["triage_vitals"] = dict(t0)
    sp["vitals_trajectory"] = [{"atMs": 0, **t0}]
    return D.CaseState.from_spec(sp)


def _step(st: D.CaseState, kind: str, ref: str = "", elapsed: int | None = None) -> D.CaseState:
    st, _, _ = D.next_state(st, D.Action(kind=kind, ref=ref, elapsed_ms=elapsed))
    return st


def _ards_target(st: D.CaseState) -> str:
    return next(t["status"] for t in st.snapshot["targets"] if t["process"] == "ards" and t["id"] == "ventilation")


def _ards_proc(st: D.CaseState) -> dict:
    return next(p for p in st.snapshot["processes"] if p["id"] == "ards")


def _live_after_ards(extra: str | None) -> D.CaseState:
    """The live EN timeline (doc 15 section 12.9): 4 h untreated, NRB and co-amoxiclav
    ordered, ARDS opens at 6 h; at 6.5 h ``extra`` is added; then 2 h more."""
    st = _step(_pneumonia(LIVE_T0), "elapsed", elapsed=240 * MIN)
    for code in ("o2_nrb_15l", "co_amoxiclav"):
        st = _step(st, "order", code)
    st = _step(st, "elapsed", elapsed=150 * MIN)
    assert "ards" in st.snapshot["active_diagnoses"]
    if extra:
        st = _step(st, "treatment", extra)
    return _step(st, "elapsed", elapsed=120 * MIN)


@pytest.mark.parametrize("code", HFNC_CODES)
def test_hfnc_is_its_own_class_and_still_oxygen(code: str) -> None:
    classes = classify_treatment(code)
    assert "hfnc" in classes and "oxygen" in classes, (code, classes)
    assert "niv" not in classes


@pytest.mark.parametrize("code", LOW_FLOW_CODES)
def test_low_flow_and_mask_oxygen_is_not_hfnc(code: str) -> None:
    classes = D.treatment_classes(code, None)
    assert classes == ["oxygen"], (code, classes)


@pytest.mark.parametrize("code", NIV_CODES)
def test_niv_stays_niv(code: str) -> None:
    assert classify_treatment(code) == ["niv"]


@pytest.mark.parametrize("code", INTUBATION_CODES)
def test_intubation_is_a_class(code: str) -> None:
    assert classify_treatment(code) == ["intubation"], code


def test_the_ards_group_names_the_support_classes_not_oxygen() -> None:
    from server.orchestration.course import expand_rule
    g = next(x for x in expand_rule("ards")["groups"] if x["id"] == "ventilation")
    assert set(g["classes"]) == {"hfnc", "niv", "intubation"}
    assert "oxygen" not in g["classes"]
    assert set(g["codes"]) == {"lung_protective", "prone"}


def test_live_ards_timeline_hfnc_turns_the_course_where_nrb_alone_does_not() -> None:
    nrb_only = _live_after_ards(None)
    hfnc = _live_after_ards("hfnc_60l")
    assert _ards_target(nrb_only) == "breached"
    assert _ards_target(hfnc) == "met"
    assert _ards_proc(hfnc)["s"] < _ards_proc(nrb_only)["s"]
    assert hfnc.snapshot["phase"] == "improving" and nrb_only.snapshot["phase"] == "peri_arrest"
    assert hfnc.vitals.spo2 > nrb_only.vitals.spo2
    assert hfnc.snapshot["bedside"]["o2"] is True


@pytest.mark.parametrize("code", ("cpap", "niv", "lung_protective", "intubation", "prone"))
def test_live_ards_timeline_niv_and_intubation_still_satisfy(code: str) -> None:
    nrb_only = _live_after_ards(None)
    st = _live_after_ards(code)
    assert _ards_target(st) == "met", code
    assert _ards_proc(st)["s"] < _ards_proc(nrb_only)["s"], code


@pytest.mark.parametrize("code", ("nasal_cannula_2l", "nrb_15l", "simple_face_mask", "venturi_28", "high_flow_o2"))
def test_live_ards_timeline_low_flow_oxygen_does_not_satisfy(code: str) -> None:
    st = _live_after_ards(code)
    assert _ards_target(st) == "breached", code
    assert st.snapshot["phase"] == "peri_arrest", code


def test_hfnc_already_running_counts_when_ards_opens() -> None:
    """HFNC started at 4 h stays on: when ARDS opens at 6 h the support is already there."""
    def course(o2: str) -> D.CaseState:
        st = _step(_pneumonia(LIVE_T0), "elapsed", elapsed=240 * MIN)
        for code in (o2, "co_amoxiclav"):
            st = _step(st, "order", code)
        return _step(st, "elapsed", elapsed=240 * MIN)

    hfnc, nrb = course("hfnc_60l"), course("o2_nrb_15l")
    assert _ards_target(hfnc) == "met" and _ards_target(nrb) == "breached"
    assert _ards_proc(hfnc)["s"] < _ards_proc(nrb)["s"]


def test_ards_scenarios_hfnc_niv_intubation_better_than_nrb_alone() -> None:
    runs = {label: run("ards", plan, label=label) for label, plan in SCENARIOS["ards"]}
    nrb = runs["nrb"].minutes[120]
    assert nrb["phase"] == "peri_arrest"
    for label in ("hfnc", "niv", "intubation"):
        m = runs[label].minutes[120]
        assert m["severity"] < nrb["severity"], label
        assert m["phase"] == "improving", label
        assert m["vitals"]["spo2"] > nrb["vitals"]["spo2"], label


def test_hfnc_in_hypercapnic_copd_keeps_the_oxygen_harm_rule() -> None:
    """ESICM 2023 rec. 3.1 excludes AECOPD and hypercapnic failure; BTS 2017 targets 88 to 92 %
    whatever the device, so HFNC to SpO2 above 92 % still opens type 2 respiratory failure."""
    t0 = {"hr": 110, "systolic": 140, "diastolic": 85, "rr": 28, "spo2": 88, "tempC": 37.2}
    sp = spec_for("copd_exacerbation", t0=False)
    sp["triage_vitals"] = dict(t0)
    sp["vitals_trajectory"] = [{"atMs": 0, **t0}]
    st = _step(D.CaseState.from_spec(sp), "treatment", "hfnc_60l", 0)
    st = _step(st, "elapsed", elapsed=40 * MIN)
    assert any(h["id"] == "o2_hypercapnia" and h["src"] == "hfnc_60l" for h in st.snapshot["harms"])
    assert "type2_respiratory_failure" in st.snapshot["active_diagnoses"]


def test_the_esicm_statement_is_verified_in_the_store() -> None:
    data = json.loads(EXPORT_PATH.read_text(encoding="utf-8"))
    s = next(x for x in data["statements"] if x["id"] == "gs_esicm2023_hfno_ahrf")
    assert s["status"] == "verified"
    assert s["doi"] == "10.1007/s00134-023-07050-7"
    assert "receive HFNO as compared to conventional oxygen therapy to reduce the risk of intubation" in s["verification_quote"]
