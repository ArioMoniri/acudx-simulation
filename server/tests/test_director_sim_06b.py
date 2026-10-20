"""Regression tests from the reviewers' simulation (06b section 2).

The 06b harness drove the shipped Director minute by minute for 120 minutes.
These tests replay the same scenarios through ``director_sim.run`` and assert
that each defect the review recorded is gone: untreated patients keep
deteriorating, first-line treatment works, wrong treatment harms, and nothing
plateaus or freezes.
"""

from __future__ import annotations

import pytest

from server.tests.director_sim import MARKS, SCENARIOS, run


@pytest.fixture(scope="module")
def sims():
    return {(cid, label): run(cid, plan, label=label) for cid, plans in SCENARIOS.items() for label, plan in plans}


def test_every_scenario_runs_minute_by_minute_to_120(sims):
    for (cid, label), r in sims.items():
        assert sorted(r.minutes) == list(range(0, 121)), (cid, label)
        for m in MARKS:
            v = r.minutes[m]["vitals"]
            assert set(v) == {"hr", "systolic", "diastolic", "rr", "spo2", "tempC"}


def test_untreated_septic_shock_does_not_plateau_and_arrests(sims):
    r = sims[("septic_shock", "none")]
    maps = [r.b(m, "map") for m in (10, 30, 60, 90)]
    assert maps == sorted(maps, reverse=True) and maps[0] > maps[-1]
    assert r.minutes[120]["phase"] == "arrest"


def test_septic_shock_ten_boluses_have_a_ceiling_and_no_bradycardia(sims):
    r = sims[("septic_shock", "10 boluses")]
    assert max(r.v(m, "systolic") for m in r.minutes if r.minutes[m]["phase"] != "arrest") <= 140
    assert min(r.v(m, "hr") for m in r.minutes if r.minutes[m]["phase"] != "arrest") > 60


def test_septic_shock_bundle_is_better_than_untreated_and_links_lactate(sims):
    bundle, none = sims[("septic_shock", "bundle")], sims[("septic_shock", "none")]
    assert bundle.b(120, "map") >= 65 and bundle.minutes[120]["phase"] != "arrest"
    assert bundle.b(120, "lactate") < none.b(120, "lactate")
    assert bundle.b(120, "gcs") > none.b(120, "gcs")


def test_noradrenaline_alone_does_not_stop_septic_shock(sims):
    r = sims[("septic_shock", "noradrenaline only")]
    assert "abx_1h" in r.fired()
    assert r.minutes[120]["severity"] > r.minutes[0]["severity"]


def test_sepsis_paracetamol_lowers_temperature_but_not_the_disease(sims):
    pcm, none = sims[("sepsis_uncomplicated", "paracetamol only")], sims[("sepsis_uncomplicated", "none")]
    assert pcm.v(90, "tempC") <= none.v(90, "tempC") - 0.5
    assert "abx_1h" in pcm.fired()
    abx = sims[("sepsis_uncomplicated", "ceftriaxone")]
    assert "abx_1h" not in abx.fired()


def test_meningitis_ceftriaxone_at_50_is_on_target_and_moves_no_vital(sims):
    cef, none = sims[("bacterial_meningitis", "ceftriaxone at 50min")], sims[("bacterial_meningitis", "none")]
    assert "abx_1h" not in cef.fired()
    for m in (51, 60):
        assert cef.minutes[m]["vitals"] == none.minutes[m]["vitals"]
    assert none.b(0, "gcs") - none.b(60, "gcs") >= 2


def test_untreated_pyelonephritis_stays_febrile_and_tachycardic(sims):
    r = sims[("pyelonephritis", "none")]
    for m in (30, 60, 120):
        assert r.v(m, "hr") >= r.v(0, "hr") and r.v(m, "tempC") >= r.v(0, "tempC")


def test_dka_does_not_desaturate_and_fluids_then_friii_improve(sims):
    none, rx = sims[("dka", "none")], sims[("dka", "fluids then FRIII")]
    assert all(none.v(m, "spo2") == none.v(0, "spo2") for m in MARKS)
    assert none.v(120, "rr") > none.v(0, "rr")
    assert rx.v(120, "systolic") > none.v(120, "systolic") and rx.b(120, "cbg") < none.b(120, "cbg")


def test_dka_insulin_bolus_before_fluids_is_logged_as_harm(sims):
    r = sims[("dka", "insulin bolus first")]
    assert any(e["kind"] == "contraindicated_treatment" for e in r.state.errors)
    assert any(e["kind"] == "harm" and "bolus" in e["reason"].lower() for e in r.events())


def test_stemi_aspirin_only_leaves_reperfusion_open_and_routine_o2_changes_nothing(sims):
    asa = sims[("acs_stemi", "aspirin only")]
    assert "reperfusion" in asa.fired()
    o2, none = sims[("acs_stemi", "routine o2")], sims[("acs_stemi", "none")]
    for m in MARKS:
        if none.minutes[m]["phase"] != "arrest":
            assert o2.minutes[m]["vitals"] == none.minutes[m]["vitals"]
    pci = sims[("acs_stemi", "aspirin+pci")]
    assert pci.b(90, "pain") < none.b(90, "pain")


def test_pe_two_litres_harm_the_right_ventricle(sims):
    fl, none = sims[("pulmonary_embolism", "2 L fluid")], sims[("pulmonary_embolism", "none")]
    assert any(e["kind"] == "fluid_rv" for e in fl.state.errors)
    assert fl.v(60, "systolic") < none.v(60, "systolic")


def test_anaphylaxis_adrenaline_works_and_fluids_alone_do_not(sims):
    adr, none, fl = (sims[("anaphylaxis", k)] for k in ("IM adrenaline", "none", "fluids only"))
    assert adr.v(10, "systolic") - none.v(10, "systolic") >= 15
    assert none.minutes[30]["phase"] == "arrest" and fl.minutes[30]["phase"] == "arrest"
    assert adr.minutes[120]["phase"] != "arrest"


def test_heart_failure_fluid_harms_and_decongestion_helps(sims):
    fl, none, rx = (sims[("heart_failure_acute", k)] for k in ("3 L fluid", "none", "decongestion"))
    assert fl.v(40, "spo2") < none.v(40, "spo2") - 4
    assert sum(1 for e in fl.state.errors if e["kind"] == "fluid_overload") == 6
    assert rx.v(60, "spo2") > none.v(60, "spo2")
