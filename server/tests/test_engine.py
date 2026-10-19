"""Engine: ground truth first, kinetics over time and treatment, flags against
sourced ranges, imaging with provenance or an honest 'unavailable', determinism."""

from __future__ import annotations

import copy

import pytest

from server.results import engine

H = 3_600_000


def make_case(cond_id: str, icd10: str, label: str, system: str, *, sex="male", age=62, acuity=2, labs=None, imaging=None, hr=96, treatments=None, seed=42):
    return {
        "seed": seed,
        "condition": {"icd10": icd10, "label_en": label, "label_tr": label, "system": system},
        "demographics": {"age": age, "sex": sex, "name_hint": "A"},
        "acuity_esi": acuity,
        "difficulty": 3,
        "labs": labs or [],
        "imaging": imaging or [],
        "triage_vitals": {"hr": hr, "systolic": 120, "diastolic": 76, "rr": 20, "spo2": 95, "tempC": 37.1},
        "vitals_trajectory": [{"atMs": 0, "hr": hr, "systolic": 120, "diastolic": 76, "rr": 20, "spo2": 95, "tempC": 37.1},
                              {"atMs": 2 * H, "hr": hr - 10, "systolic": 118, "diastolic": 74, "rr": 18, "spo2": 96, "tempC": 37.0}],
        "treatments_given": treatments or [],
        "condition_id_hint": cond_id,
    }


NSTEMI = make_case("acs_nstemi", "I21.4", "Non-ST elevation myocardial infarction", "cardiology",
                   labs=[{"code": "67151-1", "label_en": "High-sensitivity troponin", "label_tr": "x", "value": 180, "unit": "ng/L", "ref_low": 0, "ref_high": 14, "flag": "HH", "category": "cardiac"}])


def test_condition_lookup_from_spec_without_id():
    assert engine.condition_id_for(NSTEMI) == "acs_nstemi"
    assert engine.condition_id_for({"condition": {"icd10": "E10.1", "label_en": "Diabetic ketoacidosis"}}) == "dka"
    assert engine.condition_id_for({"condition_id": "sepsis_uncomplicated"}) == "sepsis_uncomplicated"


def test_deterministic_given_seed():
    a = engine.resolve_order(NSTEMI, "6690-2", 0, seed=7)
    b = engine.resolve_order(NSTEMI, "6690-2", 0, seed=7)
    c = engine.resolve_order(NSTEMI, "6690-2", 0, seed=8)
    assert a == b
    assert [o["value"] for o in a["observations"]] != [o["value"] for o in c["observations"]]


def test_ground_truth_troponin_then_kinetics_and_delta():
    first = engine.resolve_order(NSTEMI, "67151-1", 0)
    obs = first["observations"][0]
    assert obs["loinc"] == "67151-1" and obs["value"] == 180 and obs["ground_truth"] is True
    assert obs["flag"] == "HH" and obs["critical"] is True and "rule-in" in obs["interpretation"]
    assert obs["ref_high"] == 16  # male-specific 99th percentile
    assert obs["source"].startswith("https://")
    later = engine.resolve_order(NSTEMI, "67151-1", 1 * H, prior=[first])
    obs2 = later["observations"][0]
    assert obs2["value"] > 180  # still rising toward the ~11 h peak
    assert obs2["delta"]["prior_value"] == 180 and obs2["delta"]["change"] > 0
    assert later["t_since_onset_h"] == pytest.approx(4.0)
    # hs-cTnT peaks about 11 h after onset (sim 8 h here) and then falls slowly
    # (50 percent of peak at roughly 116 h, JALM 2020), so the 72 h draw is below
    # the peak draw but still above the early 4 h draw.
    peak = engine.resolve_order(NSTEMI, "67151-1", 8 * H)["observations"][0]["value"]
    much_later = engine.resolve_order(NSTEMI, "67151-1", 72 * H)["observations"][0]["value"]
    assert much_later < peak and much_later > obs2["value"]
    assert engine.resolve_order(NSTEMI, "67151-1", 240 * H)["observations"][0]["value"] < much_later


def test_unaffected_panel_is_normal_and_sex_specific():
    r = engine.resolve_order(NSTEMI, "6690-2", 0)
    assert r["kind"] == "lab" and r["status"] == "ok" and r["abnormal"] is False
    hb = next(o for o in r["observations"] if o["loinc"] == "718-7")
    assert hb["ref_low"] == 13.5 and hb["ref_high"] == 17.5 and 13.5 <= hb["value"] <= 17.5
    assert all(o["flag"] == "N" for o in r["observations"])
    assert r["turnaround"]["category"] == "haematology" and r["available_at_ms"] == r["turnaround"]["ms"]
    assert r["narrative"] is None and r["meta"]["source"] == "engine"


def test_age_adjusted_d_dimer():
    old = make_case("x", "I26.9", "Pulmonary embolism", "pulmonology", age=74)
    r = engine.resolve_order(old, "48065-7", 0)
    assert r["observations"][0]["ref_high"] == 740


def test_dka_moves_with_insulin_and_fluids():
    dka = make_case("dka", "E10.1", "Diabetic ketoacidosis", "endocrine", acuity=2, hr=118)
    bmp0 = engine.resolve_order(dka, "2160-0", 0)
    glu0 = next(o for o in bmp0["observations"] if o["loinc"] == "2345-7")
    assert glu0["flag"] == "HH" and glu0["value"] > 485
    vbg0 = engine.resolve_order(dka, "vbg", 0)
    ph0 = next(o for o in vbg0["observations"] if o["loinc"] == "2746-6")
    assert ph0["value"] < 7.3 and ph0["flag"] in ("L", "LL")
    treated = copy.deepcopy(dka)
    treated["treatments_given"] = [{"label": "0.9% saline 1 L bolus", "at_ms": 0}, {"label": "Fixed rate insulin infusion 0.1 units/kg/h", "at_ms": 30 * 60_000}]
    bmp4 = engine.resolve_order(treated, "2160-0", 4 * H, prior=[bmp0])
    glu4 = next(o for o in bmp4["observations"] if o["loinc"] == "2345-7")
    assert glu4["value"] < glu0["value"] and glu4["delta"]["change"] < 0
    vbg4 = engine.resolve_order(treated, "vbg", 4 * H)
    ph4 = next(o for o in vbg4["observations"] if o["loinc"] == "2746-6")
    assert ph4["value"] > ph0["value"]
    codes = [t["code"] for t in bmp4["treatments_applied"]]
    assert codes == ["iv_fluids", "insulin_infusion"]


def test_lactate_clears_after_fluids_and_pressors():
    shock = make_case("septic_shock", "R65.21", "Septic shock", "emergency", acuity=1, hr=128)
    before = engine.resolve_order(shock, "2524-7", 0)["observations"][0]
    assert before["flag"] in ("H", "HH") and before["value"] > 2.0
    treated = copy.deepcopy(shock)
    treated["treatments_given"] = [{"label": "Hartmann's 30 mL/kg bolus", "at_ms": 0, "amount": 2.0}, {"label": "Noradrenaline infusion", "at_ms": H}]
    after = engine.resolve_order(treated, "2524-7", 3 * H, prior=[{"observations": [before], "sim_time_ms": 0}])["observations"][0]
    assert after["value"] < before["value"]
    assert "cleared" in after["interpretation"]
    untreated = engine.resolve_order(shock, "2524-7", 3 * H)["observations"][0]
    assert untreated["value"] >= before["value"]


def test_imaging_with_provenance_and_laterality():
    ptx = make_case("tension_pneumothorax", "J93.0", "Tension pneumothorax", "pulmonology", acuity=1)
    r = engine.resolve_order(ptx, "cxr", 0)
    assert r["kind"] == "imaging" and r["status"] == "ok"
    rep = r["report"]
    assert rep["finding"] == "pneumothorax" and rep["laterality"] == "left"
    assert rep["image"]["id"] == "cxr-pneumothorax" and rep["image"]["laterality"] == "left"
    prov = rep["provenance"]
    assert prov["license"].startswith("CC BY") and prov["is_synthetic"] is False and prov["source_page"].startswith("https://commons.wikimedia.org/")
    assert r["turnaround"]["category"] == "xr" and "source" in r["turnaround"]
    stroke = make_case("ischemic_stroke", "I63.9", "Acute ischaemic stroke", "neurology", acuity=1)
    ct = engine.resolve_order(stroke, "ct-head-noncon", 0)
    assert ct["report"]["image"]["id"] == "ct-ischemic-stroke" and ct["report"]["laterality"] == "right"


def test_imaging_unavailable_returns_findings_only():
    tors = make_case("ovarian_torsion", "N83.5", "Ovarian torsion", "obstetrics-gynecology", sex="female", age=28)
    r = engine.resolve_order(tors, "us-pelvis", 0)
    assert r["status"] == "unavailable" and r["report"]["image"] is None
    assert r["report"]["findings"] and r["report"]["findings"][0]["laterality"] == "right"
    assert r["report"]["impression"].startswith("Right ovarian torsion")
    assert r["report"]["image_status"] == "unavailable"


def test_authored_imaging_overrides_impression():
    case = make_case("pneumonia_cap", "J18.9", "Community-acquired pneumonia", "pulmonology",
                     imaging=[{"code": "36643-5", "modality_en": "Chest X-ray", "modality_tr": "x", "findings_en": "Right lower lobe consolidation with a small effusion.", "findings_tr": "x"}])
    r = engine.resolve_order(case, "cxr", 0)
    assert r["report"]["impression"] == "Right lower lobe consolidation with a small effusion."
    assert r["report"]["ground_truth"] is True


def test_ecg_pattern_and_rate_follow_condition_and_vitals():
    stemi = make_case("acs_stemi", "I21.0", "ST-elevation myocardial infarction", "cardiology", acuity=1, hr=88)
    r = engine.resolve_order(stemi, "11524-6", 0)
    assert r["kind"] == "ecg" and r["ecg"]["pattern"] == "stemi_anterior"
    assert r["ecg"]["measurements"]["st_deviation_mv"]["V2"] > 0.1
    assert r["ecg"]["is_synthetic"] is True and r["ecg"]["request"]["pattern"] == "stemi_anterior"
    assert r["ecg"]["reference_image"]["provenance"]["license"].startswith("CC BY")
    af = make_case("afib_rvr", "I48.91", "Atrial fibrillation with rapid response", "cardiology", hr=142)
    r2 = engine.resolve_order(af, "11524-6", 0)
    assert r2["ecg"]["pattern"] == "atrial_fibrillation" and r2["ecg"]["rate_bpm"] > 120
    plain = make_case("gout", "M10.9", "Acute gout", "musculoskeletal", hr=112, acuity=4)
    assert engine.resolve_order(plain, "11524-6", 0)["ecg"]["pattern"] == "sinus_tachycardia"


def test_micro_turnaround_and_antibiotic_effect():
    pyelo = make_case("pyelonephritis", "N10", "Acute pyelonephritis", "infectious", sex="female", age=31, acuity=3)
    r = engine.resolve_order(pyelo, "urine-culture", 0)
    assert r["kind"] == "micro" and r["turnaround"]["minutes"] == 2880
    assert "Escherichia coli" in r["observations"][0]["value"]
    assert r == engine.resolve_order(pyelo, "urine-culture", 0)
    ua = engine.resolve_order(pyelo, "ua", 0)
    nitrite = next(o for o in ua["observations"] if o["loinc"] == "5802-4")
    assert nitrite["value"] == "Positive" and nitrite["flag"] == "A"


def test_unknown_code_and_every_observation_sourced():
    r = engine.resolve_order(NSTEMI, "not-a-test", 0)
    assert r["status"] == "unavailable" and r["kind"] == "unknown"
    for code in ("cmp", "lft", "coag-inr", "abg", "istat", "ua", "acetaminophen", "salicylate", "ethanol", "tsh", "bnp", "48065-7"):
        res = engine.resolve_order(NSTEMI, code, 0)
        assert res["status"] == "ok", code
        for o in res["observations"]:
            assert o["source"].startswith("https://") and o["reviewed_at"], (code, o["loinc"])


def test_paracetamol_level_interpreted_on_nomogram():
    od = make_case("paracetamol_od", "T39.1", "Paracetamol overdose", "musculoskeletal", acuity=2)
    r = engine.resolve_order(od, "acetaminophen", 0)
    o = r["observations"][0]
    assert o["value"] > 100 and o["flag"] == "HH" and "treatment line" in o["interpretation"]


def test_treatment_mapping():
    case = make_case("x", "J45.901", "Acute asthma exacerbation", "pulmonology", treatments=[
        {"label": "Oxygen 15 L non-rebreather", "at_ms": 0},
        {"label": "IV fluids 500 mL", "at_ms": H},
        {"label": "Ceftriaxone 2 g IV", "at_ms": 2 * H},
        {"label": "Insulin-dextrose 10 units", "at_ms": 3 * H},
        {"label": "Reassurance", "at_ms": 4 * H},
    ])
    tx = engine.map_treatments(case, 6.0)
    assert [t.code for t in tx] == ["oxygen", "iv_fluids", "antibiotics", "insulin_dextrose"]
    assert tx[0].note == "non_rebreather" and tx[1].amount == 0.5 and tx[2].t_h == 8.0


def test_supported_codes_cover_catalog():
    codes = engine.supported_order_codes()
    assert {"6690-2", "2160-0", "cmp", "lft", "coag-inr", "vbg", "abg", "ua", "poc-glucose", "istat"} <= set(codes["lab"])
    assert {"cxr", "ct-head-noncon", "ctpa", "us-dvt", "echo", "mri-brain"} <= set(codes["imaging"])
    assert codes["ecg"] == ["11524-6"] and "blood-culture" in codes["micro"]
