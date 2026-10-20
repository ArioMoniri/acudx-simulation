"""Clinical-content regression tests for the deterministic case engine.

Every test here would have caught a CRITICAL or MAJOR finding in
``docs/review/02-clinical-content-review-2026-10.md`` (the October 2026
emergency-physician + nurse-educator review). Each docstring names the finding
and the guideline the fix is anchored to, so the test doubles as the
sign-off record for that item.
"""

from __future__ import annotations

import random
import re
from pathlib import Path

import pytest

from server import case_fixtures as fx
from server import case_generator as cg
from server.condition_catalog import CATALOG

REPO_ROOT = Path(__file__).resolve().parents[2]
BY_ID = {c["id"]: c for c in CATALOG}


def _cond(cid: str) -> dict:
    c = dict(BY_ID[cid])
    c["red_flags"] = [dict(r) for r in c.get("red_flags", [])]
    return c


def _spec(cid: str, seed: int = 7, acuity: int | None = None) -> dict:
    cond = _cond(cid)
    return cg.build_template_spec(
        cond, seed=seed, locale="en",
        acuity=acuity or int(cond["typical_acuity"]), difficulty=int(cond["difficulty"]),
        rng=random.Random(seed),
    )


def _treatments(cid: str) -> dict[str, tuple]:
    return {t[0]: t for t in fx.CONDITION_FIXTURES[cid]["treatments"]}


SEEDS = range(1, 41)


# --------------------------------------------------------------------------- #
# Finding 1 (critical): condition-specific vitals envelopes                    #
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("seed", SEEDS)
def test_complete_heart_block_is_bradycardic(seed: int) -> None:
    """Review 02 #1: AHA 2020 ACLS bradycardia algorithm — symptomatic block is
    HR < 50 (https://www.ahajournals.org/doi/10.1161/CIR.0000000000000916)."""
    v = _spec("complete_heart_block", seed)["triage_vitals"]
    assert v["hr"] < 50


@pytest.mark.parametrize("seed", SEEDS)
def test_hypertensive_emergency_exceeds_180_over_120(seed: int) -> None:
    """Review 02 #1: ACC/AHA 2017 defines hypertensive emergency as BP > 180/120
    with target-organ damage (https://doi.org/10.1161/HYP.0000000000000065)."""
    v = _spec("hypertensive_emergency", seed)["triage_vitals"]
    assert v["systolic"] > 180 and v["diastolic"] > 120


@pytest.mark.parametrize("seed", SEEDS)
def test_thermal_envelopes_and_opioid_bradypnoea(seed: int) -> None:
    """Review 02 #1: hypothermia core < 35C, heat stroke > 40C, opioid toxidrome
    RR below 12 (fixture envelope 4-10)."""
    assert _spec("hypothermia", seed)["triage_vitals"]["tempC"] < 35.0
    assert _spec("heat_stroke", seed)["triage_vitals"]["tempC"] > 40.0
    rr = _spec("opioid_overdose", seed)["triage_vitals"]["rr"]
    assert 4 <= rr <= 10


def test_every_vitals_envelope_is_physiological() -> None:
    """Envelope sanity: lo <= hi, diastolic band below systolic band."""
    for cid, env in fx.CONDITION_VITALS.items():
        assert cid in BY_ID, f"envelope for unknown condition {cid}"
        for key, band in env.items():
            if key == "drift":
                continue
            assert band[0] <= band[1], (cid, key)
        if "systolic" in env and "diastolic" in env:
            assert env["diastolic"][1] < env["systolic"][1], cid


# --------------------------------------------------------------------------- #
# Finding 2 (critical): coherent PMH / medications / allergies                 #
# --------------------------------------------------------------------------- #
def test_background_is_condition_coherent_not_generic() -> None:
    """Review 02 #2: Joint Commission NPSG.03.06.01 (medication reconciliation).
    ESRD must mention dialysis; the anticoagulated ICH patient (INR 2.6) must
    name an anticoagulant; a dialysis patient is not 'generally well'."""
    esrd = _spec("hyperkalemia_esrd")
    assert "dialysis" in esrd["pmh_en"].lower()
    assert "generally well" not in esrd["pmh_en"].lower()
    for seed in SEEDS:
        ich = _spec("intracerebral_hemorrhage", seed)
        assert "warfarin" in ich["meds_en"].lower()
    hpi = {h["intent"]: h["answer_en"] for h in esrd["hpi"]}
    assert hpi["past-medical-history"] == esrd["pmh_en"]
    assert hpi["medications"] == esrd["meds_en"]
    assert hpi["allergies"] == esrd["allergies_en"]


def test_some_cases_carry_a_real_allergy_to_a_catalog_agent() -> None:
    """Review 02 #2 and nurse section 2.3 item 8: the allergy check must be able
    to fail, so some generated cases carry penicillin / aspirin / morphine
    allergies (agents in the client treatment catalogue)."""
    seen = set()
    for seed in range(1, 80):
        a = _spec("pneumonia_cap", seed)["allergies_en"].lower()
        if "penicillin" in a:
            seen.add("penicillin")
        a = _spec("acs_stemi", seed)["allergies_en"].lower()
        if "aspirin" in a:
            seen.add("aspirin")
    assert {"penicillin", "aspirin"} <= seen


def test_long_tail_conditions_get_a_system_background() -> None:
    """Conditions without a specific pool still get a coherent system-level
    background (never the removed 'I do not take any regular medicines')."""
    spec = _spec("gout")
    assert spec["pmh_en"] and spec["meds_en"] and spec["allergies_en"]
    assert "I do not take any regular medicines" not in spec["meds_en"]


# --------------------------------------------------------------------------- #
# Finding 3 (critical): red flags are structured data, never patient speech   #
# --------------------------------------------------------------------------- #
CLINICIAN_TERMS = re.compile(r"\b(ecg|ekg|st elevation|lactate|laktat|troponin|mmol|gcs|gks|hints|qrs|coHb|crepitus|peritonism|murmur|üfürüm)\b", re.I)


@pytest.mark.parametrize("cid", [c["id"] for c in CATALOG])
def test_patient_never_speaks_lab_or_ecg_findings(cid: str) -> None:
    """Review 02 #3: ASPE Standards of Best Practice Domain 3 — the script is in
    the patient's own voice with only information the patient could know
    (https://doi.org/10.1186/s41077-017-0043-4)."""
    spec = _spec(cid)
    for h in spec["hpi"]:
        assert not h["answer_en"].lower().startswith("yes — "), (cid, h["answer_en"])
        if h["intent"] == "red-flags":
            assert not CLINICIAN_TERMS.search(h["answer_en"]), (cid, h["answer_en"])


def test_red_flags_are_structured_with_channels() -> None:
    """Review 02 #3: the catalog's signs travel as ``red_flags`` with channel
    'clinician'; the lay symptom is channel 'patient'."""
    spec = _spec("acs_stemi")
    channels = {rf["channel"] for rf in spec["red_flags"]}
    assert channels == {"clinician", "patient"}
    clinician = [rf["en"] for rf in spec["red_flags"] if rf["channel"] == "clinician"]
    assert any("ST elevation" in t for t in clinician)
    # Schema round-trip keeps the field.
    out = cg.GeneratedCaseSpec.model_validate(spec).model_dump()
    assert len(out["red_flags"]) == len(spec["red_flags"])


# --------------------------------------------------------------------------- #
# Finding 4 (critical): real exam findings, never the diagnosis label          #
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("cid", [c["id"] for c in CATALOG])
def test_exam_never_hands_over_the_diagnosis(cid: str) -> None:
    """Review 02 #4: ASPE Domain 3 principle 3.2 — findings must elicit
    reasoning, not state 'Findings consistent with <dx>'."""
    spec = _spec(cid)
    label = BY_ID[cid]["label_en"].lower()
    for e in spec["exam"]:
        f = e["finding_en"].lower()
        assert "consistent with" not in f, (cid, f)
        assert label not in f, (cid, f)
    assert len(spec["exam"]) >= 3


def test_dissection_exam_carries_interpretable_signs() -> None:
    spec = _spec("aortic_dissection")
    joined = " ".join(e["finding_en"] for e in spec["exam"]).lower()
    assert "pulse deficit" in joined and "diastolic murmur" in joined


# --------------------------------------------------------------------------- #
# Findings 5, 6, 11, 12, 13 (treatment appropriateness)                         #
# --------------------------------------------------------------------------- #
def test_pulseless_vt_is_defibrillated_not_synchronised() -> None:
    """Review 02 #5: AHA 2020 ACLS — pulseless VT follows the cardiac-arrest
    algorithm (unsynchronised shock); synchronised cardioversion is for VT with
    a pulse (https://www.ahajournals.org/doi/10.1161/CIR.0000000000000916)."""
    t = _treatments("vt")
    assert t["defib_pulseless"][3] == "indicated"
    assert "unsynchronised" in t["defib_pulseless"][1].lower()
    assert t["sync_cardioversion"][3] == "indicated" and "pulse" in t["sync_cardioversion"][1].lower()
    assert t["sync_on_pulseless"][3] == "contraindicated"
    for code, row in t.items():
        if "synchronised" in row[1].lower() and "unsynchronised" not in row[1].lower():
            assert "pulseless" not in row[5].lower() or row[3] == "contraindicated", code


def test_pancreatitis_fluids_follow_waterfall() -> None:
    """Review 02 #6: WATERFALL (NEJM 2022, https://www.nejm.org/doi/full/10.1056/NEJMoa2202884)."""
    t = _treatments("pancreatitis")
    assert t["aggressive_fluids"][3] == "contraindicated"
    assert t["moderate_fluids"][3] == "indicated"
    assert "1.5 mL/kg/h" in t["moderate_fluids"][1]


def test_glucose_is_never_withheld_for_thiamine() -> None:
    """Review 02 #11: Schabelman & Kuo 2012 (https://doi.org/10.1016/j.jemermed.2011.05.076)."""
    t = _treatments("alcohol_withdrawal")
    assert "glucose_before_thiamine" not in t
    assert t["withhold_glucose_for_thiamine"][3] == "contraindicated"
    assert t["thiamine_early"][3] == "indicated"


def test_tamponade_fluids_are_neutral_bridge_only() -> None:
    """Review 02 #12: ESC 2015 pericardial diseases (https://doi.org/10.1093/eurheartj/ehv318)."""
    t = _treatments("cardiac_tamponade")
    assert t["fluid_support"][3] == "neutral" and t["fluid_support"][4] == []
    assert "hypovolaemic" in t["fluid_support"][1].lower()
    assert t["pericardiocentesis"][3] == "indicated"


def test_pe_thrombolysis_is_risk_stratified() -> None:
    """Review 02 #13: ESC 2019 acute PE — class I in high-risk PE, class III in
    intermediate-risk PE without deterioration (https://doi.org/10.1093/eurheartj/ehz405)."""
    t = _treatments("pulmonary_embolism")
    assert t["thrombolysis_high_risk"][3] == "indicated"
    assert t["thrombolysis_intermediate"][3] == "contraindicated"


# --------------------------------------------------------------------------- #
# Findings 14 and 15 (effect realism)                                          #
# --------------------------------------------------------------------------- #
ABX = re.compile(r"antibiotic|ceftriaxone|clindamycin|abx", re.I)


def _all_treatment_rows():
    for cid, f in fx.CONDITION_FIXTURES.items():
        for row in f.get("treatments", []):
            yield f"fixture:{cid}", row
    for sysname, prof in cg._PROFILES.items():
        for row in prof["treatments"]:
            yield f"profile:{sysname}", row


def test_antibiotics_do_not_change_temperature_within_the_session() -> None:
    """Review 02 #14: Halm et al., JAMA 1998 — median time to clinical stability
    in CAP is ~3 days (https://jamanetwork.com/journals/jama/fullarticle/187516)."""
    for where, (code, label, _tr, _appr, effects, *_rest) in _all_treatment_rows():
        if ABX.search(label) or ABX.search(code):
            for key, _delta, onset in effects:
                assert key != "tempC" or onset >= 6 * 3_600_000, (where, code)


def test_aspirin_has_no_analgesic_effect_and_pci_relief_is_delayed() -> None:
    """Review 02 #15: ESC 2023 ACS — aspirin is antiplatelet, reperfusion pain
    relief follows balloon inflation (90-120 min) (https://doi.org/10.1093/eurheartj/ehad191)."""
    for where, (code, label, _tr, _appr, effects, *_rest) in _all_treatment_rows():
        if re.search(r"aspirin|asa\b", label, re.I) and not re.search(r"nitrate|gtn|opioid", label, re.I):
            assert all(k != "pain" for k, _d, _o in effects), (where, code)
    pci = _treatments("acs_stemi")["primary_pci"]
    pain = [e for e in pci[4] if e[0] == "pain"]
    assert pain and pain[0][2] >= 60 * 60_000


# --------------------------------------------------------------------------- #
# Finding 16 (ESI), 17/18/29/34 (coding)                                         #
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("cid", [
    "upper_gi_bleed", "perforated_ulcer", "mesenteric_ischemia", "ascending_cholangitis",
    "ischemic_stroke", "bacterial_meningitis", "encephalitis", "hyperkalemia",
    "hyperkalemia_esrd", "testicular_torsion", "serotonin_syndrome", "nms",
    "febrile_neutropenia", "tumor_lysis", "dic", "cauda_equina",
])
def test_esi_1_is_reserved_for_immediate_lifesaving_intervention(cid: str) -> None:
    """Review 02 #16: ESI handbook — level 1 only when an immediate life-saving
    intervention is required (https://www.ena.org/enau/education/esi)."""
    assert BY_ID[cid]["typical_acuity"] == 2


def test_icd_codes_are_valid_leaves_and_icd11_matches_who() -> None:
    """Review 02 #17 (E05.91), #29 (ICD-11 BB23 tamponade, BB40 endocarditis),
    #34 (ICD-10-CM leaf codes)."""
    assert BY_ID["thyroid_storm"]["icd10"] == "E05.91"
    assert BY_ID["cardiac_tamponade"]["icd11"] == "BB23"
    assert BY_ID["infective_endocarditis"]["icd11"] == "BB40"
    assert BY_ID["myocarditis"]["icd11"] == "BC42"
    assert BY_ID["complete_heart_block"]["icd11"] == "BC63"
    assert BY_ID["aortic_dissection"]["icd10"] == "I71.01"
    assert BY_ID["hypertensive_emergency"]["icd10"] == "I16.1"
    assert BY_ID["pancreatitis"]["icd10"] == "K85.90"
    assert BY_ID["ascending_cholangitis"]["icd10"] == "K83.09"


def _ts_rows() -> dict[str, str]:
    """ICD-10 -> ICD-11 from web/src/domain/diagnosisCatalog.ts (single source check)."""
    src = (REPO_ROOT / "web/src/domain/diagnosisCatalog.ts").read_text(encoding="utf-8")
    rows = re.findall(r'\b[dp]\("([^"]+)",\s*"([^"]+)"', src)
    return {icd10: icd11 for icd10, icd11 in rows}


def test_diagnosis_catalog_ts_agrees_with_server_catalog() -> None:
    """Review 02 #17, #18, #29: both tables must carry the same codes (a generated
    case is scored against the client table)."""
    ts = _ts_rows()
    assert "E05.91" in ts and "E05.5X1" not in ts
    assert "T65.91XA" in ts and "T78.40XA" not in ts
    for cid in ("cardiac_tamponade", "infective_endocarditis", "myocarditis", "complete_heart_block",
                "thyroid_storm", "pancreatitis", "hypertensive_emergency", "ascending_cholangitis",
                "aortic_dissection", "pericarditis", "acs_stemi", "acs_nstemi", "ischemic_stroke"):
        row = BY_ID[cid]
        assert row["icd10"] in ts, (cid, row["icd10"])
        assert ts[row["icd10"]] == row["icd11"], (cid, ts[row["icd10"]], row["icd11"])


# --------------------------------------------------------------------------- #
# Findings 19 and 20 (disposition + demographics)                              #
# --------------------------------------------------------------------------- #
def test_disposition_is_condition_specific() -> None:
    """Review 02 #19: WSES Jerusalem 2020 — appendicectomy is the treatment of
    choice (https://doi.org/10.1186/s13017-020-00306-3); torsion and ectopic go
    to theatre, stroke to a stroke unit, not 'every ESI 1 is ICU'."""
    assert _spec("appendicitis")["disposition"] == "operating-room"
    assert _spec("testicular_torsion")["disposition"] == "operating-room"
    assert _spec("ectopic_pregnancy")["disposition"] == "operating-room"
    assert _spec("perforated_ulcer")["disposition"] == "operating-room"
    assert _spec("ischemic_stroke")["disposition"] == "refer-specialty"
    assert _spec("ischemic_stroke")["disposition"] != "admit-icu"


@pytest.mark.parametrize("seed", SEEDS)
def test_demographics_respect_condition_constraints(seed: int) -> None:
    """Review 02 #20: AAP bronchiolitis guideline applies to 1-23 months
    (https://doi.org/10.1542/peds.2014-2742); priapism / prostatitis are male;
    hip fracture is an older adult; myocarditis a young patient."""
    assert _spec("priapism", seed)["demographics"]["sex"] == "male"
    assert _spec("acute_prostatitis", seed)["demographics"]["sex"] == "male"
    assert _spec("epididymo_orchitis", seed)["demographics"]["sex"] == "male"
    assert _spec("bronchiolitis", seed)["demographics"]["age"] <= 2
    assert _spec("hip_fracture", seed)["demographics"]["age"] >= 65
    assert _spec("myocarditis", seed)["demographics"]["age"] <= 40


def test_bronchiolitis_has_paediatric_vitals() -> None:
    v = _spec("bronchiolitis")["triage_vitals"]
    assert v["hr"] >= 150 and v["rr"] >= 54


# --------------------------------------------------------------------------- #
# Finding 21 (sex-specific Hb/Hct) and 22 (LOINC / units)                       #
# --------------------------------------------------------------------------- #
def test_haemoglobin_reference_is_sex_specific() -> None:
    """Review 02 #21: MedlinePlus — men ~13.5-17.5 g/dL, women ~12.0-15.5
    (https://medlineplus.gov/ency/article/003645.htm). A man with Hb 12.6 is
    anaemic; the same value in a woman is normal."""
    prof = {"labs": [("718-7", "Haemoglobin", "Hemoglobin", 12.6, "g/dL", 12.0, 16.0, "N", "haematology")]}
    male = cg._labs(prof, random.Random(1), "male")[0]
    female = cg._labs(prof, random.Random(1), "female")[0]
    assert male["ref_low"] == 13.5 and male["flag"] == "L"
    assert female["ref_low"] == 12.0 and female["flag"] == "N"


def test_loinc_codes_match_analyte_and_unit() -> None:
    """Review 02 #22: urea mmol/L is 22664-7 (3094-0 is BUN mg/dL); CK is 2157-6
    (2532-0 is discouraged LDH); LDH is 14804-9; fibrinogen one unit project-wide."""
    for cid, f in fx.CONDITION_FIXTURES.items():
        for row in f.get("labs", []):
            code, en, _tr, _val, unit = row[:5]
            assert code != "2532-0", (cid, en)
            if code == "3094-0":
                assert unit == "mg/dL", (cid, en)
            if en.lower().startswith("urea"):
                assert code == "22664-7" and unit == "mmol/L", (cid, en)
            if "creatine kinase" in en.lower():
                assert code == "2157-6", (cid, en)
            if "lactate dehydrogenase" in en.lower():
                assert code == "14804-9", (cid, en)
            if code == "3255-7":
                assert unit == "mg/dL", (cid, en)
            if code == "2345-7":
                assert unit == "mmol/L", (cid, en)
    for prof in cg._PROFILES.values():
        for row in prof["labs"]:
            assert row[0] != "2532-0"
            if row[1].lower().startswith("urea"):
                assert row[0] == "22664-7"


# --------------------------------------------------------------------------- #
# Findings 38 and 39 (lab shape)                                               #
# --------------------------------------------------------------------------- #
def test_qualitative_results_are_qualitative() -> None:
    """Review 02 #39: dipstick / xanthochromia carry a word, not '1.0 positive'."""
    for cid in ("hypertensive_emergency", "subarachnoid_hemorrhage", "pyelonephritis", "renal_colic", "preeclampsia"):
        labs = _spec(cid)["labs"]
        qual = [l for l in labs if l.get("qualitative")]
        assert qual, cid
        for l in qual:
            assert isinstance(l["value"], str) and l["unit"] == ""
            assert l["ref_low"] is None and l["ref_high"] is None
    out = cg.GeneratedCaseSpec.model_validate(_spec("renal_colic")).model_dump()
    assert any(l["qualitative"] == "positive" for l in out["labs"])


def test_paracetamol_level_is_timed() -> None:
    """Review 02 #38: the nomogram needs hours since ingestion (MHRA guidance)."""
    labs = _spec("paracetamol_od")["labs"]
    level = next(l for l in labs if l["code"] == "3298-4")
    assert level["hours_post_ingestion"] == 4.0
    out = cg.GeneratedCaseSpec.model_validate(_spec("paracetamol_od")).model_dump()
    assert next(l for l in out["labs"] if l["code"] == "3298-4")["hours_post_ingestion"] == 4.0


# --------------------------------------------------------------------------- #
# Finding 30 (trajectory shapes) and minor items 31, 32, 33, 37, 40, 42, 43     #
# --------------------------------------------------------------------------- #
def test_trajectories_are_condition_shaped() -> None:
    """Review 02 #30: a tension pneumothorax, an anaphylaxis and a GI bleed must
    not deteriorate identically; a septic patient's temperature must move."""
    def delta(cid: str, key: str) -> float:
        traj = _spec(cid)["vitals_trajectory"]
        return traj[-1][key] - traj[0][key]

    assert delta("septic_shock", "tempC") > 0
    assert delta("hypothermia", "tempC") < 0
    assert delta("tension_pneumothorax", "spo2") <= -5
    assert delta("upper_gi_bleed", "spo2") == 0 and delta("upper_gi_bleed", "systolic") <= -10
    assert delta("subarachnoid_hemorrhage", "systolic") > 0 and delta("subarachnoid_hemorrhage", "hr") < 0
    assert delta("panic_disorder", "hr") < 0


def test_minor_treatment_items_present() -> None:
    """Review 02 #31 (DKA potassium gate, ADA/EASD 2024), #37 (stroke BP gate,
    AHA/ASA 2019), #40 (routine antibiotics are a stewardship error, NICE NG114),
    #42 (thyroid storm beta-blocker caveat, ATA 2016), #43 (hyperkalaemia
    dialysis + recheck, UKKA 2023), #32 (sickle oxygen only when SpO2 <= 95%)."""
    assert _treatments("dka")["insulin_low_k"][3] == "contraindicated"
    assert _treatments("ischemic_stroke")["bp_gate_lysis"][3] == "indicated"
    assert "185/110" in _treatments("ischemic_stroke")["bp_gate_lysis"][1]
    routine = {t[0]: t for t in cg._PROFILES["pulmonology"]["treatments"]}["routine_abx"]
    assert routine[3] == "contraindicated"
    assert _treatments("thyroid_storm")["unmonitored_bb_hf"][3] == "contraindicated"
    assert "esmolol" in _treatments("thyroid_storm")["beta_blocker"][1].lower()
    assert _treatments("hyperkalemia")["dialysis_referral"][3] == "indicated"
    assert _treatments("hyperkalemia")["recheck_1h"][3] == "indicated"
    assert "95%" in _treatments("sickle_crisis")["fluids_oxygen"][1]


def test_bppv_red_flag_does_not_misapply_hints() -> None:
    """Review 02 #33: HINTS is validated for acute vestibular syndrome only
    (Kattah et al., Stroke 2009 https://doi.org/10.1161/STROKEAHA.109.551234)."""
    flags = " ".join(r["en"] for r in BY_ID["vertigo_bppv"]["red_flags"])
    assert "HINTS" not in flags


def test_seeded_generation_stays_reproducible_with_fixtures() -> None:
    a = _spec("hyperkalemia_esrd", 99)
    b = _spec("hyperkalemia_esrd", 99)
    assert a == b
