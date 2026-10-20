"""Review 06b section 6: the ten acceptance tests for the dynamic case course.

Each test drives the Clinical Director minute by minute through the shared
harness (``server/tests/director_sim.py``) with the 06b section 5 arrival
values. Test 10 (client parity) lives in ``test_course_parity.py`` and
``web/src/domain/clinicalCourseParity.test.ts``.
"""

from __future__ import annotations

from server import case_fixtures as FX
from server.orchestration import director as D
from server.results import engine as E
from server.tests.director_sim import run, spec_for


def _arrested(r, by: int) -> bool:
    return any(r.minutes[m]["phase"] == "arrest" for m in range(0, by + 1))


# 1 ------------------------------------------------------------------------ #
def test_1_anaphylaxis_untreated_arrests_and_im_adrenaline_rescues():
    untreated = run("anaphylaxis", until=30)
    assert untreated.v(20, "systolic") < 60
    assert _arrested(untreated, 30)
    assert untreated.b(30, "pulse") is False
    adr = run("anaphylaxis", [(3, "treatment", "3992-im")], until=60)
    assert adr.v(10, "systolic") >= 90
    assert not _arrested(adr, 60)
    # Assessment and analgesia rows do not count as adrenaline.
    wrong = run("anaphylaxis", [(1, "treatment", "assess"), (2, "treatment", "analgesia")], until=10)
    assert "adrenaline_5min" in wrong.fired()


def test_1b_fluids_alone_do_not_improve_anaphylaxis():
    fluids = run("anaphylaxis", [(3, "treatment", "313002")], until=30)
    assert _arrested(fluids, 30)


# 2 ------------------------------------------------------------------------ #
def test_2_septic_shock_needs_an_antimicrobial_and_has_fluid_limits():
    for plan in ([(5, "treatment", "vasopressor")], [(5, "treatment", "313002")]):
        r = run("septic_shock", plan, until=61)
        assert "abx_1h" in r.fired(), plan
    untreated = run("septic_shock", until=120)
    assert _arrested(untreated, 120)
    boluses = run("septic_shock", [(m, "treatment", "313002") for m in range(2, 40, 4)], until=120)
    assert max(boluses.v(m, "systolic") for m in boluses.minutes) <= 140
    assert any(e["id"] == "fluid_nonresponse" for e in boluses.events())
    assert any(e["kind"] == "fluid_nonresponse" for e in boluses.state.errors)


# 3 ------------------------------------------------------------------------ #
def test_3_fluid_in_acute_heart_failure_is_harmful_and_logged():
    base = run("heart_failure_acute", until=40)
    litre = run("heart_failure_acute", [(5, "treatment", "313002"), (10, "treatment", "313002")], until=40)
    assert base.v(40, "spo2") - litre.v(40, "spo2") >= 4
    assert any(e["kind"] == "fluid_overload" for e in litre.state.errors)


# 4 ------------------------------------------------------------------------ #
def test_4_meningitis_target_gcs_and_no_beta_blocker_effect():
    cef = run("bacterial_meningitis", [(50, "treatment", "2193")], until=120)
    assert "abx_1h" not in cef.fired()
    untreated = run("bacterial_meningitis", until=120)
    for m in (51, 60, 90, 120):
        assert cef.v(m, "hr") >= untreated.v(m, "hr") - 1 and cef.v(m, "systolic") >= untreated.v(m, "systolic") - 1
    assert untreated.b(0, "gcs") - untreated.b(60, "gcs") >= 2
    seizure_at = next((m for m in sorted(untreated.minutes) if "status_epilepticus" in untreated.minutes[m].get("active_diagnoses", [])), 121)
    airway_at = next((m for m in sorted(untreated.minutes) if untreated.b(m, "gcs") <= 8), 121)
    first = min(seizure_at, airway_at)
    assert all(untreated.v(m, "spo2") == untreated.v(0, "spo2") for m in range(0, first))


# 5 ------------------------------------------------------------------------ #
def test_5_untreated_pyelonephritis_does_not_improve():
    r = run("pyelonephritis", until=30)
    assert r.v(30, "hr") >= r.v(0, "hr") and r.v(30, "tempC") >= r.v(0, "tempC")


# 6 ------------------------------------------------------------------------ #
def test_6_dka_hypoglycaemia_and_hypokalaemia_harms():
    # CBG 15 mmol/L at insulin start (moderate DKA; JBDS threshold above 11):
    # at the JBDS 3 mmol/L/h fall the 06b "below 4 within 4 h" holds from this level.
    no_dex = run("dka", [(1, "treatment", "fluids_first"), (5, "treatment", "5856")], until=245,
                 bedside0={"cbg": 15.0, "k": 4.6})
    assert min(no_dex.b(m, "cbg") for m in range(5, 246)) < 4.0
    assert any(e["kind"] == "hypoglycaemia" for e in no_dex.state.errors)
    low_k = run("dka", [(5, "treatment", "5856")], until=60, bedside0={"k": 3.1})
    assert min(low_k.b(m, "k") for m in range(5, 61)) < 3.0
    kinds = {e["kind"] for e in low_k.state.errors}
    assert {"insulin_low_k", "hypokalaemic_arrhythmia_risk"} <= kinds


# 7 ------------------------------------------------------------------------ #
def test_7_stemi_reperfusion_gtn_harm_and_routine_oxygen():
    asa = run("acs_stemi", [(5, "treatment", "asa_p2y12")], until=40)
    assert "reperfusion" in asa.fired() and "antiplatelet" not in asa.fired()
    rv = run("acs_stemi", [(5, "treatment", "4917")], until=15, flags=["rv_infarct"])
    assert rv.v(4, "systolic") - min(rv.v(m, "systolic") for m in range(5, 16)) >= 30
    base = run("acs_stemi", until=30)
    o2 = run("acs_stemi", [(3, "treatment", "7806")], until=30)
    for m in (5, 10, 30):
        assert o2.minutes[m]["vitals"] == base.minutes[m]["vitals"]


# 8 ------------------------------------------------------------------------ #
def test_8_penicillin_anaphylaxis_allergy_exposure():
    spec = spec_for("sepsis_uncomplicated")
    spec["allergies_en"] = FX.ALLERGY_PENICILLIN[0]
    tazo = run("sepsis_uncomplicated", [(5, "treatment", "pip-tazo")], until=16, spec=spec)
    opened = [m for m in tazo.minutes if "anaphylaxis_iatrogenic" in tazo.minutes[m].get("active_diagnoses", [])]
    assert opened and min(opened) <= 15
    cef = run("sepsis_uncomplicated", [(5, "treatment", "2193")], until=30, spec=spec_for("sepsis_uncomplicated") | {
        "allergies_en": FX.ALLERGY_PENICILLIN[0]})
    assert not any("anaphylaxis_iatrogenic" in cef.minutes[m].get("active_diagnoses", []) for m in cef.minutes)


# 9 ------------------------------------------------------------------------ #
def test_9_pneumonia_branches_to_septic_shock_with_new_findings_results_and_narrative():
    r = run("pneumonia_cap", until=120, seed=4, curb65=3)
    opened = [m for m in r.minutes if "septic_shock" in r.minutes[m].get("active_diagnoses", [])]
    assert opened and min(opened) <= 120
    branch = next(e for e in r.events() if e["kind"] == "branch" and e["id"] == "septic_shock")
    assert "CURB-65" in branch["reason"] and branch["say_en"]
    state = r.state
    state, visible, _ = D.next_state(state, D.Action(kind="exam", ref="general-inspection"))
    assert any("Mottling" in f for f in visible["new_facts"])
    view = visible["results"]
    assert view["condition_id"] == "septic_shock"
    obs = E.resolve_order({**spec_for("pneumonia_cap", 4), "director": view}, "2524-7", state.t_ms, seed=4)
    lactate = next(o for o in obs["observations"] if o["loinc"] == "2524-7")
    assert lactate["value"] > 4.0
    msgs = D._narrate_messages(state, D.Action(kind="question", ref="pain"), [], [branch])
    assert "septic_shock" in msgs[1]["content"]


# Extra harm rules of 06b section 4.2 ------------------------------------- #
def test_lp_before_ct_with_red_flags_opens_herniation():
    r = run("bacterial_meningitis", [(5, "order", "lumbar_puncture")], until=60, bedside0={"gcs": 12})
    assert any(e["kind"] == "lp_before_ct" for e in r.state.errors)
    assert any("herniation" in r.minutes[m].get("active_diagnoses", []) for m in r.minutes)
    safe = run("bacterial_meningitis", [(2, "order", "ct head"), (5, "order", "lumbar_puncture")], until=60,
               bedside0={"gcs": 12})
    assert not any(e["kind"] == "lp_before_ct" for e in safe.state.errors)


def test_omission_rows_are_not_administered():
    r = run("sepsis_uncomplicated", [(2, "treatment", "delay_abx")], until=5)
    assert any("omission" in n["note"] for n in r.notes)
    assert not r.state.events


def test_fluid_bolus_harms_a_heart_failure_patient_with_another_diagnosis():
    spec = spec_for("sepsis_uncomplicated")
    spec["pmh_en"] = "Chronic heart failure (EF 30 %)."
    r = run("sepsis_uncomplicated", [(5, "treatment", "313002")], until=30, spec=spec)
    assert any(e["kind"] == "fluid_overload" for e in r.state.errors)
