"""Result resolver: case truth + kinetics + reference ranges + imaging bank.

``resolve_order(case_state, order_code, sim_time_ms)`` turns a learner's order
into a result that is

* condition-correct: a per-condition profile names which analytes move, which
  imaging finding (with laterality) each modality shows and which ECG pattern
  applies; authored ``labs`` / ``imaging`` in the GeneratedCaseSpec take
  precedence over the profile (ground truth first);
* time- and treatment-responsive: every moving analyte is a
  :mod:`server.results.kinetics` function of hours since onset and of the
  treatments given so far;
* physiologically bounded and flagged: values clamp to kinetics bounds and are
  flagged L / H / LL / HH against ``reference_ranges.json`` (sex and age aware);
* deterministic: all sampling is hashed from ``(seed, order_code, analyte)``;
* provenanced: each observation carries the reference source URL, each image
  carries license and attribution, and ``narrative`` is left ``None`` for the
  LLM layer (this module never calls a model).

Education only. Synthetic patients.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
from functools import lru_cache
from typing import Any, Optional

from server.results import catalog
from server.results import ecg as ecg_mod
from server.results import imaging_bank
from server.results import kinetics as k
from server.results import specimens
from server.results.kinetics import Treatment

RANGES_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "reference_ranges.json")
MS_PER_H = 3_600_000.0

# Turnaround classes with sources live in server/results/catalog.py; the micro
# order codes in server/results/specimens.py. Both names stay importable here.
TURNAROUND: dict[str, dict[str, Any]] = catalog.TURNAROUND
MICRO_CODES: dict[str, str] = specimens.MICRO_CODES


# --------------------------------------------------------------------------- #
# Reference ranges                                                             #
# --------------------------------------------------------------------------- #
@lru_cache(maxsize=1)
def load_ranges(path: str = RANGES_PATH) -> dict[str, Any]:
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    data["_by_loinc"] = {a["loinc"]: a for a in data["analytes"]}
    # Codes that never existed in LOINC resolve to their replacement so older
    # case specs keep working (reference_ranges.json "retired_aliases").
    data["_alias"] = {old: rec["replaced_by"] for old, rec in (data.get("retired_aliases") or {}).items()}
    for old, new in data["_alias"].items():
        data["_by_loinc"].setdefault(old, data["_by_loinc"][new])
    # Every catalogue orderable is a panel of its member analytes.
    panels = dict(data["panels"])
    for o in catalog.lab_catalog()["orderables"]:
        if o["generator"] == "analyte":
            panels.setdefault(o["code"], list(o["members"]))
    data["panels"] = panels
    return data


def canonical_loinc(code: str) -> str:
    return load_ranges()["_alias"].get(code, code)


def _pick_range(loinc: str, sex: str, age: int) -> Optional[dict[str, Any]]:
    a = load_ranges()["_by_loinc"].get(loinc)
    if a is None or a.get("qualitative"):
        return None
    rows = a.get("ranges", [])
    for want in (sex, "any"):
        for r in rows:
            if r["age_min"] <= age <= r["age_max"] and r["sex"] == want:
                return r
    return rows[0] if rows else None


def reference_range(loinc: str, sex: str = "any", age: int = 45) -> Optional[dict[str, Any]]:
    """The interval for a sex and age. ``low`` or ``high`` is None when the
    interval is open on that side (HDL at or above 40 mg/dL)."""
    pick = _pick_range(loinc, sex, age)
    if pick is None:
        return None
    low = None if pick.get("low") is None else float(pick["low"])
    high = None if pick.get("high") is None else float(pick["high"])
    if pick.get("age_adjusted_rule") == "age_x10" and age > 50:
        high = float(age * 10)
    return {"low": low, "high": high, "note": pick.get("note")}


def flag_value(loinc: str, value: float, sex: str, age: int) -> tuple[str, bool]:
    """Return (flag, critical). Flags: N, L, H, LL, HH."""
    a = load_ranges()["_by_loinc"].get(loinc)
    rr = reference_range(loinc, sex, age)
    if a is None or rr is None:
        return "N", False
    flag = "N"
    if rr["low"] is not None and value < rr["low"]:
        flag = "L"
    elif rr["high"] is not None and value > rr["high"]:
        flag = "H"
    crit = False
    if a.get("critical_low") is not None and value < float(a["critical_low"]):
        flag, crit = "LL", True
    if a.get("critical_high") is not None and value > float(a["critical_high"]):
        flag, crit = "HH", True
    return flag, crit


# --------------------------------------------------------------------------- #
# Deterministic sampling                                                       #
# --------------------------------------------------------------------------- #
def _unit(seed: Any, *parts: Any) -> float:
    h = hashlib.sha256("|".join(str(p) for p in (seed, *parts)).encode()).digest()
    return int.from_bytes(h[:8], "big") / 2 ** 64


def _baseline(loinc: str, sex: str, age: int, seed: Any) -> float:
    """A seeded healthy value: the middle 60 percent of the interval, or the
    analyte's ``baseline_band`` when the interval is open or very wide."""
    a = load_ranges()["_by_loinc"].get(loinc, {})
    rr = reference_range(loinc, sex, age)
    if rr is None:
        return 0.0
    band = a.get("baseline_band")
    if band:
        lo, hi = float(band[0]), float(band[1])
    else:
        lo = rr["low"] if rr["low"] is not None else (rr["high"] or 0.0) * 0.5
        hi = rr["high"] if rr["high"] is not None else (rr["low"] or 1.0) * 1.6
        span = hi - lo
        lo, hi = lo + 0.2 * span, lo + 0.8 * span
    u = _unit(seed, "baseline", loinc)
    return lo + (hi - lo) * u


def _round(loinc: str, value: float) -> float:
    a = load_ranges()["_by_loinc"].get(loinc, {})
    return round(float(value), int(a.get("decimals", 1)))


# --------------------------------------------------------------------------- #
# Condition profiles                                                           #
# Lab spec forms: ("troponin", assay_or_None) ("lactate",) ("crp",) ("pct", bacterial)
#                 ("creatinine",) ("dka", key) ("potassium", initial) ("hb", loss_ml)
#                 ("oxy", key) ("paracetamol", dose_mg) ("static", value) ("mult", factor)
# Imaging: order-modality key -> (finding, laterality, [findings], impression)
# --------------------------------------------------------------------------- #
_SEPSIS_LABS = {"2524-7": ("lactate",), "1988-5": ("crp",), "33959-8": ("pct", True), "6690-2": ("mult", 1.9), "751-8": ("mult", 2.6), "2160-0": ("creatinine",)}
_PNEUMONIA_IMG = {"xr:chest": ("consolidation", "bilateral", ["patchy consolidation", "no effusion", "no pneumothorax"], "Multifocal consolidation consistent with pneumonia.")}

CONDITION_PROFILES: dict[str, dict[str, Any]] = {
    "acs_stemi": {"onset_h": 2.0, "labs": {"67151-1": ("troponin", "hs_ctnt"), "89579-7": ("troponin", "hs_ctni"), "2157-6": ("mult", 3.5)}, "ecg": "stemi_anterior",
                  "imaging": {"xr:chest": ("normal", "none", ["normal heart size", "clear lungs"], "No acute cardiopulmonary abnormality."), "echo:heart": ("normal", "none", ["anterior wall hypokinesis"], "Regional wall motion abnormality; representative normal image shown.")}},
    "acs_nstemi": {"onset_h": 3.0, "labs": {"67151-1": ("troponin", "hs_ctnt"), "89579-7": ("troponin", "hs_ctni")}, "ecg": "nstemi", "severity_cap": 0.55},
    "unstable_angina": {"onset_h": 1.0, "labs": {}, "ecg": "nstemi", "severity_cap": 0.0},
    "stable_angina": {"onset_h": 1.0, "labs": {}, "ecg": "normal", "severity_cap": 0.0},
    "aortic_dissection": {"onset_h": 1.5, "labs": {"48065-7": ("mult", 6.0), "718-7": ("hb", 600.0), "2524-7": ("lactate",)}, "ecg": "sinus_tachycardia",
                          "imaging": {"ct:aorta": ("aortic_dissection", "none", ["intimal flap", "true and false lumen", "ascending aorta involved"], "Stanford type A aortic dissection."), "ct:chest": ("aortic_dissection", "none", ["intimal flap"], "Aortic dissection."), "xr:chest": ("normal", "none", ["widened mediastinum"], "Widened mediastinum; CT angiography advised.")}},
    "heart_failure_acute": {"onset_h": 24.0, "labs": {"30934-4": ("static", 900.0), "33762-6": ("static", 4200.0), "2160-0": ("mult", 1.3)}, "ecg": "sinus_tachycardia",
                            "imaging": {"xr:chest": ("pulmonary_edema", "bilateral", ["interstitial oedema", "Kerley B lines", "cardiomegaly", "small bilateral effusions"], "Pulmonary oedema with cardiomegaly."), "echo:heart": ("normal", "none", ["reduced ejection fraction"], "Reduced systolic function; representative image.")}},
    "afib_rvr": {"onset_h": 6.0, "labs": {}, "ecg": "atrial_fibrillation"},
    "svt": {"onset_h": 1.0, "labs": {}, "ecg": "svt"},
    "vt": {"onset_h": 0.5, "labs": {"2823-3": ("potassium", 3.2), "19123-9": ("static", 1.3)}, "ecg": "vt"},
    "complete_heart_block": {"onset_h": 12.0, "labs": {}, "ecg": "complete_heart_block"},
    "pericarditis": {"onset_h": 24.0, "labs": {"1988-5": ("crp",), "67151-1": ("troponin", "hs_ctnt")}, "ecg": "pericarditis", "severity_cap": 0.25},
    "cardiac_tamponade": {"onset_h": 6.0, "labs": {"2524-7": ("lactate",)}, "ecg": "sinus_tachycardia", "imaging": {"echo:heart": ("pericardial_effusion", "none", ["large circumferential pericardial effusion", "RV diastolic collapse"], "Pericardial effusion with tamponade physiology."), "xr:chest": ("normal", "none", ["globular cardiac silhouette"], "Enlarged globular cardiac silhouette.")}},
    "hypertensive_emergency": {"onset_h": 6.0, "labs": {"2160-0": ("creatinine",), "67151-1": ("troponin", "hs_ctnt")}, "ecg": "normal", "severity_cap": 0.3},
    "myocarditis": {"onset_h": 48.0, "labs": {"67151-1": ("troponin", "hs_ctnt"), "1988-5": ("crp",)}, "ecg": "pericarditis", "severity_cap": 0.5},
    "pulmonary_embolism": {"onset_h": 6.0, "labs": {"48065-7": ("mult", 5.0), "67151-1": ("troponin", "hs_ctnt"), "2524-7": ("lactate",), "2703-7": ("oxy", "pao2"), "2708-6": ("oxy", "spo2")}, "ecg": "pulmonary_embolism", "severity_cap": 0.4,
                           "imaging": {"ct:chest": ("pulmonary_embolism", "bilateral", ["filling defects in both main pulmonary arteries", "RV/LV ratio above 1"], "Bilateral pulmonary emboli with right heart strain."), "us:vascular-leg": ("deep_vein_thrombosis", "right", ["non-compressible right femoral vein"], "Right femoral DVT."), "xr:chest": ("normal", "none", ["clear lungs"], "No acute abnormality; does not exclude PE.")}},
    "pneumonia_cap": {"onset_h": 72.0, "labs": _SEPSIS_LABS, "ecg": "sinus_tachycardia", "imaging": _PNEUMONIA_IMG, "micro": {"600-7": ("Streptococcus pneumoniae", 0.25), "sputum": ("Streptococcus pneumoniae", 0.6)}},
    "aspiration_pneumonitis": {"onset_h": 12.0, "labs": _SEPSIS_LABS, "imaging": _PNEUMONIA_IMG, "ecg": "sinus_tachycardia"},
    "covid19": {"onset_h": 120.0, "labs": {"1988-5": ("crp",), "33959-8": ("pct", False), "731-0": ("mult", 0.5), "48065-7": ("mult", 2.0), "2703-7": ("oxy", "pao2"), "2708-6": ("oxy", "spo2")}, "imaging": {"xr:chest": ("consolidation", "bilateral", ["bilateral peripheral ground-glass opacities"], "Bilateral peripheral opacities consistent with viral pneumonitis.")}, "micro": {"rvp": ("SARS-CoV-2 RNA detected", 0.95)}, "ecg": "sinus_tachycardia"},
    # Acceptance 2026-10-20 (section 5, D-25): malaria had no profile, so it got
    # the default leucocytosis; P. falciparum gives a normal or low white count
    # and thrombocytopenia (WHO Guidelines for malaria,
    # https://www.who.int/publications/i/item/guidelines-for-malaria).
    "malaria": {"onset_h": 120.0, "labs": {"777-3": ("mult", 0.25), "1975-2": ("static", 2.4), "1988-5": ("crp",)},
                "micro": {"malaria": ("Plasmodium falciparum ring forms seen, parasitaemia 2%", 1.0),
                          "malaria_rdt": ("P. falciparum HRP2 antigen detected", 0.95)}, "severity_cap": 0.4},
    # Acute HIV: lymphopenia, mild thrombocytopenia, modest CRP (BHIVA/BASHH 2020).
    "hiv_seroconversion": {"onset_h": 240.0, "labs": {"731-0": ("mult", 0.45), "777-3": ("mult", 0.5), "1742-6": ("mult", 2.0), "1988-5": ("crp",)},
                           "micro": {"hiv": ("HIV-1/2 antigen/antibody reactive (p24 antigen positive)", 0.95)}, "severity_cap": 0.15},
    "influenza": {"onset_h": 48.0, "labs": {"1988-5": ("crp",), "33959-8": ("pct", False)}, "micro": {"rvp": ("Influenza A RNA detected", 0.9)}, "severity_cap": 0.3},
    "asthma_exacerbation": {"onset_h": 6.0, "labs": {"2703-7": ("oxy", "pao2"), "2708-6": ("oxy", "spo2"), "2019-8": ("static", 34.0)}, "imaging": {"xr:chest": ("hyperinflation", "bilateral", ["hyperinflated lungs", "no consolidation", "no pneumothorax"], "Hyperinflation without focal abnormality.")}, "ecg": "sinus_tachycardia"},
    "copd_exacerbation": {"onset_h": 48.0, "labs": {"2703-7": ("oxy", "pao2"), "2708-6": ("oxy", "spo2"), "2019-8": ("static", 58.0), "1963-8": ("static", 31.0), "1988-5": ("crp",)}, "imaging": {"xr:chest": ("hyperinflation", "bilateral", ["hyperinflation", "flattened diaphragms", "no consolidation"], "Changes of COPD without acute consolidation.")}, "ecg": "sinus_tachycardia"},
    "tension_pneumothorax": {"onset_h": 0.5, "labs": {"2703-7": ("oxy", "pao2"), "2708-6": ("oxy", "spo2"), "2524-7": ("lactate",)}, "imaging": {"xr:chest": ("pneumothorax", "left", ["large left pneumothorax", "mediastinal shift to the right", "tracheal deviation"], "Left tension pneumothorax.")}, "ecg": "sinus_tachycardia"},
    "spontaneous_pneumothorax": {"onset_h": 3.0, "labs": {"2703-7": ("oxy", "pao2"), "2708-6": ("oxy", "spo2")}, "imaging": {"xr:chest": ("pneumothorax", "left", ["moderate left pneumothorax", "no mediastinal shift"], "Left pneumothorax without tension.")}, "severity_cap": 0.4},
    "pleural_effusion": {"onset_h": 168.0, "labs": {"1988-5": ("crp",), "1751-7": ("static", 2.9)}, "imaging": {"xr:chest": ("pleural_effusion", "left", ["large left pleural effusion", "meniscus sign"], "Large left pleural effusion.")}, "severity_cap": 0.4},
    "ards": {"onset_h": 24.0, "labs": {**_SEPSIS_LABS, "2703-7": ("oxy", "pao2"), "2708-6": ("oxy", "spo2")}, "imaging": {"xr:chest": ("consolidation", "bilateral", ["bilateral diffuse opacities", "no cardiomegaly"], "Bilateral infiltrates consistent with ARDS.")}, "ecg": "sinus_tachycardia"},
    "sepsis_uncomplicated": {"onset_h": 24.0, "labs": _SEPSIS_LABS, "ecg": "sinus_tachycardia", "micro": {"600-7": ("Escherichia coli", 0.35)}, "severity_cap": 0.5},
    "septic_shock": {"onset_h": 24.0, "labs": {**_SEPSIS_LABS, "2823-3": ("potassium", 4.9), "777-3": ("mult", 0.55)}, "ecg": "sinus_tachycardia", "micro": {"600-7": ("Escherichia coli", 0.5)}},
    "pyelonephritis": {"onset_h": 48.0, "labs": _SEPSIS_LABS, "ua": "infected", "micro": {"630-4": ("Escherichia coli >10^5 CFU/mL", 0.9), "600-7": ("Escherichia coli", 0.3)}, "imaging": {"us:kidney": ("normal", "none", ["no hydronephrosis"], "No obstruction; clinical pyelonephritis."), "ct:abdomen": ("normal", "none", ["perinephric stranding"], "Perinephric stranding without obstruction.")}, "severity_cap": 0.5},
    "uti_lower": {"onset_h": 48.0, "labs": {"1988-5": ("crp",)}, "ua": "infected", "micro": {"630-4": ("Escherichia coli >10^5 CFU/mL", 0.85)}, "severity_cap": 0.2},
    "bacterial_meningitis": {"onset_h": 12.0, "labs": _SEPSIS_LABS, "micro": {"csf": ("Turbid CSF: WBC 2400/uL (neutrophils), protein 2.1 g/L, glucose 1.4 mmol/L; Gram-positive diplococci", 0.9), "600-7": ("Streptococcus pneumoniae", 0.5)}, "imaging": {"ct:head": ("normal", "none", ["no mass effect", "no haemorrhage"], "No contraindication to lumbar puncture.")}, "ecg": "sinus_tachycardia"},
    "meningococcemia": {"onset_h": 8.0, "labs": {**_SEPSIS_LABS, "777-3": ("mult", 0.4), "6301-6": ("static", 1.8)}, "micro": {"600-7": ("Neisseria meningitidis", 0.6)}, "ecg": "sinus_tachycardia"},
    "cellulitis": {"onset_h": 48.0, "labs": {"1988-5": ("crp",), "6690-2": ("mult", 1.4)}, "severity_cap": 0.3, "imaging": {"us:vascular-leg": ("normal", "none", ["compressible veins", "subcutaneous oedema"], "No DVT; subcutaneous oedema consistent with cellulitis.")}},
    "nec_fasciitis": {"onset_h": 24.0, "labs": {**_SEPSIS_LABS, "2157-6": ("mult", 6.0), "2951-2": ("static", 131.0)}, "ecg": "sinus_tachycardia"},
    "septic_arthritis": {"onset_h": 36.0, "labs": {"1988-5": ("crp",), "4537-7": ("static", 68.0), "6690-2": ("mult", 1.5)}, "severity_cap": 0.4},
    "febrile_neutropenia": {"onset_h": 12.0, "labs": {**_SEPSIS_LABS, "6690-2": ("static", 0.9), "751-8": ("static", 0.3)}, "ecg": "sinus_tachycardia", "micro": {"600-7": ("Pseudomonas aeruginosa", 0.3)}},
    "appendicitis": {"onset_h": 24.0, "labs": {"6690-2": ("mult", 1.5), "751-8": ("mult", 2.0), "1988-5": ("crp",)}, "severity_cap": 0.35, "imaging": {"ct:abdomen": ("appendicitis", "right", ["dilated appendix 12 mm", "periappendiceal fat stranding", "no free air"], "Acute uncomplicated appendicitis."), "us:abdomen": ("appendicitis", "right", ["non-compressible blind-ending tubular structure RLQ"], "Sonographic appendicitis.")}},
    "cholecystitis": {"onset_h": 18.0, "labs": {"6690-2": ("mult", 1.5), "1988-5": ("crp",), "6768-6": ("mult", 1.6), "1975-2": ("static", 1.6)}, "severity_cap": 0.4, "imaging": {"us:biliary": ("cholelithiasis", "none", ["gallstones", "gallbladder wall 5 mm", "pericholecystic fluid", "sonographic Murphy sign"], "Acute calculous cholecystitis.")}},
    "biliary_colic": {"onset_h": 3.0, "labs": {}, "severity_cap": 0.1, "imaging": {"us:biliary": ("cholelithiasis", "none", ["gallstones", "thin gallbladder wall", "no pericholecystic fluid"], "Cholelithiasis without cholecystitis.")}},
    "ascending_cholangitis": {"onset_h": 24.0, "labs": {**_SEPSIS_LABS, "1975-2": ("static", 5.8), "6768-6": ("mult", 3.5), "1742-6": ("mult", 4.0)}, "ecg": "sinus_tachycardia", "imaging": {"us:biliary": ("cholelithiasis", "none", ["dilated CBD 11 mm", "gallstones"], "Biliary obstruction with cholangitis."), "mri:biliary": ("normal", "none", ["distal CBD stone 8 mm", "dilated ducts"], "Choledocholithiasis.")}, "micro": {"600-7": ("Escherichia coli", 0.5)}},
    "pancreatitis": {"onset_h": 12.0, "labs": {"3040-3": ("mult", 9.0), "1798-8": ("mult", 5.0), "1988-5": ("crp",), "17861-6": ("static", 8.0), "2524-7": ("lactate",), "2160-0": ("creatinine",)}, "severity_cap": 0.45, "imaging": {"us:biliary": ("cholelithiasis", "none", ["gallstones", "normal CBD"], "Gallstones; likely biliary pancreatitis."), "ct:abdomen": ("normal", "none", ["oedematous pancreas", "peripancreatic fluid"], "Interstitial oedematous pancreatitis.")}},
    "upper_gi_bleed": {"onset_h": 6.0, "labs": {"718-7": ("hb", 1200.0), "3094-0": ("mult", 2.5), "2524-7": ("lactate",), "6301-6": ("static", 1.3)}, "ecg": "sinus_tachycardia"},
    "perforated_ulcer": {"onset_h": 4.0, "labs": {**_SEPSIS_LABS, "1798-8": ("mult", 1.8)}, "ecg": "sinus_tachycardia", "imaging": {"xr:chest": ("pneumoperitoneum", "none", ["free subdiaphragmatic gas"], "Pneumoperitoneum: perforated viscus."), "ct:abdomen": ("normal", "none", ["free intraperitoneal gas", "duodenal wall defect"], "Perforated duodenal ulcer.")}},
    "bowel_obstruction": {"onset_h": 24.0, "labs": {"2823-3": ("potassium", 3.1), "2160-0": ("creatinine",), "2524-7": ("lactate",)}, "severity_cap": 0.45, "imaging": {"xr:abdomen": ("small_bowel_obstruction", "none", ["dilated small bowel loops", "air-fluid levels", "paucity of colonic gas"], "Small bowel obstruction."), "ct:abdomen": ("small_bowel_obstruction", "none", ["dilated small bowel to a transition point", "collapsed distal bowel"], "Mechanical small bowel obstruction.")}},
    "mesenteric_ischemia": {"onset_h": 8.0, "labs": {"2524-7": ("lactate",), "6690-2": ("mult", 1.8), "1798-8": ("mult", 2.0)}, "ecg": "atrial_fibrillation", "imaging": {"ct:abdomen": ("normal", "none", ["SMA filling defect", "bowel wall thickening", "pneumatosis"], "Acute mesenteric ischaemia.")}},
    "diverticulitis": {"onset_h": 48.0, "labs": {"6690-2": ("mult", 1.5), "1988-5": ("crp",)}, "severity_cap": 0.3, "imaging": {"ct:abdomen": ("normal", "none", ["sigmoid wall thickening", "pericolic fat stranding", "no abscess"], "Uncomplicated sigmoid diverticulitis.")}},
    "acute_hepatitis": {"onset_h": 120.0, "labs": {"1742-6": ("mult", 45.0), "1920-8": ("mult", 35.0), "1975-2": ("static", 6.5), "6301-6": ("static", 1.4)}, "severity_cap": 0.4, "micro": {"hep": ("Hepatitis A IgM positive", 0.8)}},
    "ischemic_stroke": {"onset_h": 1.5, "labs": {"2345-7": ("static", 128.0)}, "ecg": "atrial_fibrillation", "imaging": {"ct:head": ("ischemic_infarct", "right", ["loss of grey-white differentiation right MCA territory", "no haemorrhage", "hyperdense right MCA"], "Early right MCA territory infarct; no haemorrhage."), "mri:head": ("ischemic_infarct", "right", ["restricted diffusion right MCA territory"], "Acute right MCA infarct.")}},
    "tia": {"onset_h": 3.0, "labs": {}, "severity_cap": 0.0, "imaging": {"ct:head": ("normal", "none", ["no acute infarct", "no haemorrhage"], "No acute intracranial abnormality."), "mri:head": ("normal", "none", ["no restricted diffusion"], "No infarct.")}},
    "intracerebral_hemorrhage": {"onset_h": 1.0, "labs": {"6301-6": ("static", 1.1)}, "imaging": {"ct:head": ("intracerebral_hemorrhage", "unspecified", ["hyperdense intraparenchymal haematoma", "surrounding oedema", "no midline shift"], "Acute intracerebral haemorrhage.")}},
    "subarachnoid_hemorrhage": {"onset_h": 2.0, "labs": {"67151-1": ("troponin", "hs_ctnt")}, "severity_cap": 0.2, "imaging": {"ct:head": ("subarachnoid_hemorrhage", "none", ["hyperdense blood in basal cisterns", "no hydrocephalus"], "Acute subarachnoid haemorrhage.")}},
    "status_epilepticus": {"onset_h": 0.5, "labs": {"2524-7": ("lactate",), "2345-7": ("static", 160.0), "2157-6": ("mult", 4.0)}, "imaging": {"ct:head": ("normal", "none", ["no acute abnormality"], "No acute intracranial abnormality.")}},
    "first_seizure": {"onset_h": 1.0, "labs": {"2524-7": ("lactate",)}, "severity_cap": 0.3, "imaging": {"ct:head": ("normal", "none", ["no acute abnormality"], "No acute intracranial abnormality.")}},
    "migraine": {"onset_h": 6.0, "labs": {}, "severity_cap": 0.0, "imaging": {"ct:head": ("normal", "none", ["no acute abnormality"], "Normal CT head.")}},
    "spinal_cord_compression": {"onset_h": 48.0, "labs": {"17861-6": ("static", 11.4), "6768-6": ("mult", 2.0)}, "severity_cap": 0.3, "imaging": {"mri:cspine": ("disc_herniation", "none", ["epidural mass compressing the cord", "cord signal change"], "Cord compression; urgent neurosurgical review."), "mri:lspine": ("normal", "none", ["metastatic deposit T12 with epidural extension"], "Metastatic cord compression.")}},
    "cauda_equina": {"onset_h": 24.0, "labs": {}, "severity_cap": 0.1, "imaging": {"mri:lspine": ("normal", "none", ["large central L4/5 disc protrusion compressing the cauda equina"], "Cauda equina compression; representative normal image shown, see findings.")}},
    "dka": {"onset_h": 12.0, "labs": {"2345-7": ("dka", "glucose"), "6873-4": ("dka", "ketones"), "1963-8": ("dka", "hco3"), "14627-4": ("dka", "hco3"), "1960-4": ("dka", "hco3"), "2744-1": ("dka", "ph"), "2746-6": ("dka", "ph_venous"), "2019-8": ("dka", "pco2"), "2021-4": ("dka", "pco2_venous"), "2823-3": ("dka", "potassium"), "2160-0": ("creatinine",), "2951-2": ("static", 133.0)}, "ua": "ketonuria", "ecg": "sinus_tachycardia"},
    "hhs": {"onset_h": 72.0, "labs": {"2345-7": ("static", 720.0), "2692-2": ("static", 345.0), "2951-2": ("static", 150.0), "2160-0": ("creatinine",), "6873-4": ("static", 0.8)}, "ecg": "sinus_tachycardia"},
    "hypoglycemia": {"onset_h": 0.5, "labs": {"2345-7": ("static", 38.0)}, "severity_cap": 0.3},
    "hyperkalemia": {"onset_h": 6.0, "labs": {"2823-3": ("potassium", 7.1), "2160-0": ("creatinine",), "1963-8": ("static", 17.0)}, "ecg": "hyperkalemia"},
    "hyperkalemia_esrd": {"onset_h": 24.0, "labs": {"2823-3": ("potassium", 7.4), "2160-0": ("static", 8.9), "3094-0": ("static", 92.0), "1963-8": ("static", 16.0), "718-7": ("static", 9.8)}, "ecg": "hyperkalemia"},
    "hyponatremia": {"onset_h": 48.0, "labs": {"2951-2": ("static", 116.0), "2692-2": ("static", 246.0)}, "severity_cap": 0.4},
    "hypercalcemia": {"onset_h": 72.0, "labs": {"17861-6": ("static", 13.6), "2160-0": ("creatinine",)}, "severity_cap": 0.3},
    "thyroid_storm": {"onset_h": 24.0, "labs": {"3016-3": ("static", 0.01), "3026-2": ("static", 21.0), "2345-7": ("static", 165.0)}, "ecg": "atrial_fibrillation"},
    "myxedema_coma": {"onset_h": 168.0, "labs": {"3016-3": ("static", 68.0), "3026-2": ("static", 1.9), "2951-2": ("static", 126.0), "2345-7": ("static", 58.0)}, "ecg": "sinus_bradycardia"},
    "adrenal_crisis": {"onset_h": 24.0, "labs": {"2951-2": ("static", 124.0), "2823-3": ("potassium", 5.9), "2345-7": ("static", 52.0), "2143-6": ("static", 1.4)}, "ecg": "sinus_tachycardia"},
    "aki": {"onset_h": 48.0, "labs": {"2160-0": ("creatinine",), "3094-0": ("mult", 3.0), "2823-3": ("potassium", 5.4)}, "imaging": {"us:kidney": ("normal", "none", ["normal-sized kidneys", "no hydronephrosis"], "No obstructive uropathy.")}},
    "renal_colic": {"onset_h": 4.0, "labs": {"2160-0": ("mult", 1.1)}, "ua": "haematuria", "severity_cap": 0.2, "imaging": {"ct:abdomen": ("normal", "none", ["5 mm right distal ureteric calculus", "mild right hydronephrosis"], "Right distal ureteric stone with mild hydronephrosis."), "us:kidney": ("hydronephrosis", "right", ["mild right hydronephrosis"], "Right hydronephrosis.")}},
    "urinary_retention": {"onset_h": 12.0, "labs": {"2160-0": ("creatinine",)}, "severity_cap": 0.3, "imaging": {"us:kidney": ("hydronephrosis", "right", ["distended bladder", "bilateral hydronephrosis"], "Retention with upper tract dilatation.")}},
    "glomerulonephritis": {"onset_h": 168.0, "labs": {"2160-0": ("creatinine",), "1751-7": ("static", 3.1)}, "ua": "haematuria", "severity_cap": 0.4, "imaging": {"us:kidney": ("renal_parenchymal_disease", "left", ["echogenic cortex bilaterally"], "Renal parenchymal disease.")}},
    "rhabdomyolysis": {"onset_h": 24.0, "labs": {"2157-6": ("mult", 180.0), "2823-3": ("potassium", 5.6), "2160-0": ("creatinine",), "2777-1": ("static", 6.2), "17861-6": ("static", 7.6)}, "ua": "myoglobinuria", "ecg": "hyperkalemia"},
    "tumor_lysis": {"onset_h": 48.0, "labs": {"2823-3": ("potassium", 6.4), "3084-1": ("static", 14.2), "2777-1": ("static", 7.1), "17861-6": ("static", 7.2), "2160-0": ("creatinine",)}, "ecg": "hyperkalemia"},
    "dvt": {"onset_h": 48.0, "labs": {"48065-7": ("mult", 4.0)}, "severity_cap": 0.2, "imaging": {"us:vascular-leg": ("deep_vein_thrombosis", "left", ["non-compressible left common femoral vein", "no colour flow"], "Left femoral DVT.")}},
    "anemia_symptomatic": {"onset_h": 240.0, "labs": {"718-7": ("static", 6.4), "4544-3": ("static", 20.0), "787-2": ("static", 68.0), "2276-4": ("static", 6.0)}, "severity_cap": 0.4},
    "dic": {"onset_h": 12.0, "labs": {**_SEPSIS_LABS, "777-3": ("static", 42.0), "6301-6": ("static", 2.1), "3255-7": ("static", 95.0), "48065-7": ("mult", 12.0)}, "ecg": "sinus_tachycardia"},
    "itp": {"onset_h": 168.0, "labs": {"777-3": ("static", 9.0)}, "severity_cap": 0.2},
    "acute_leukemia": {"onset_h": 240.0, "labs": {"6690-2": ("static", 62.0), "718-7": ("static", 7.8), "777-3": ("static", 28.0), "3084-1": ("static", 9.5), "14804-9": ("mult", 4.0)}, "severity_cap": 0.4},
    "pph": {"onset_h": 1.0, "labs": {"718-7": ("hb", 1800.0), "3255-7": ("static", 150.0), "2524-7": ("lactate",)}, "ecg": "sinus_tachycardia"},
    "ectopic_pregnancy": {"onset_h": 6.0, "labs": {"21198-7": ("static", 3200.0), "718-7": ("hb", 800.0)}, "severity_cap": 0.5, "ua": "hcg_positive", "imaging": {"us:pelvis": ("ectopic_pregnancy", "left", ["empty uterus", "left adnexal mass", "free fluid in the pelvis"], "Left tubal ectopic pregnancy with haemoperitoneum.")}},
    "preeclampsia": {"onset_h": 72.0, "labs": {"777-3": ("static", 112.0), "1742-6": ("mult", 2.5), "2160-0": ("mult", 1.4), "3084-1": ("static", 7.4)}, "ua": "proteinuria", "severity_cap": 0.4},
    "ovarian_torsion": {"onset_h": 4.0, "labs": {"6690-2": ("mult", 1.3)}, "severity_cap": 0.2, "imaging": {"us:pelvis": ("ovarian_torsion", "right", ["enlarged right ovary 6 cm", "absent venous flow", "whirlpool sign"], "Right ovarian torsion.")}},
    "paracetamol_od": {"onset_h": 4.0, "labs": {"3298-7": ("paracetamol", 25000.0), "1742-6": ("mult", 1.0), "6301-6": ("static", 1.1)}, "severity_cap": 0.6},
    "salicylate_od": {"onset_h": 3.0, "labs": {"4024-6": ("static", 520.0), "2744-1": ("static", 7.47), "2019-8": ("static", 24.0), "1963-8": ("static", 16.0), "2823-3": ("potassium", 3.3)}, "ecg": "sinus_tachycardia"},
    "opioid_overdose": {"onset_h": 0.5, "labs": {"2744-1": ("static", 7.22), "2019-8": ("static", 68.0), "2703-7": ("oxy", "pao2"), "2708-6": ("oxy", "spo2")}, "ecg": "sinus_bradycardia"},
    "tca_overdose": {"onset_h": 2.0, "labs": {"2744-1": ("static", 7.28), "1963-8": ("static", 18.0)}, "ecg": "vt"},
    "alcohol_withdrawal": {"onset_h": 24.0, "labs": {"5643-2": ("static", 0.0), "19123-9": ("static", 1.2), "2823-3": ("potassium", 3.2), "1920-8": ("mult", 2.2)}, "ecg": "sinus_tachycardia", "severity_cap": 0.4},
    "delirium_tremens": {"onset_h": 72.0, "labs": {"5643-2": ("static", 0.0), "19123-9": ("static", 1.1), "2823-3": ("potassium", 3.0), "2345-7": ("static", 64.0)}, "ecg": "sinus_tachycardia"},
    "anaphylaxis": {"onset_h": 0.5, "labs": {"2524-7": ("lactate",)}, "ecg": "sinus_tachycardia", "severity_cap": 0.6},
    "major_trauma": {"onset_h": 1.0, "labs": {"718-7": ("hb", 1500.0), "2524-7": ("lactate",), "6301-6": ("static", 1.5)}, "ecg": "sinus_tachycardia", "imaging": {"xr:chest": ("pneumothorax", "left", ["left rib fractures", "left pneumothorax"], "Left pneumothorax with rib fractures."), "us:abdomen": ("normal", "none", ["free fluid in Morison pouch"], "Positive FAST (free fluid).")}},
    "hip_fracture": {"onset_h": 3.0, "labs": {"718-7": ("hb", 500.0)}, "severity_cap": 0.3, "imaging": {"xr:extremity": ("distal_radius_fracture", "unspecified", ["displaced right intracapsular femoral neck fracture"], "Right femoral neck fracture; representative fracture image shown, see findings.")}},
    "compartment_syndrome": {"onset_h": 6.0, "labs": {"2157-6": ("mult", 25.0), "2823-3": ("potassium", 5.2)}, "severity_cap": 0.4},
    "gout": {"onset_h": 24.0, "labs": {"3084-1": ("static", 9.8), "1988-5": ("crp",)}, "severity_cap": 0.2},
}

DEFAULT_PROFILE: dict[str, Any] = {"onset_h": 6.0, "labs": {}, "imaging": {}, "ecg": None}

# 11524-6 "EKG study"; 34534-8 "12 lead EKG panel" (case specs use either).
ECG_CODES = ("11524-6", "34534-8")

# Results added with the catalogue expansion (review 2026-10-21): the urine drug
# screen, the newer microbiology tests and the specimen generators read these.
# Each value is (result text, probability that this patient's test is positive).
_PROFILE_EXTRAS: dict[str, dict[str, Any]] = {
    "opioid_overdose": {"tox": {"19295-5": "Positive"}},
    "pneumonia_cap": {"micro": {"pneumo_ag": ("Streptococcus pneumoniae urinary antigen detected", 0.6)}},
    "tb_pulmonary": {"micro": {"afb": ("Acid-fast bacilli seen (2+)", 0.6), "igra": ("Positive", 0.8),
                               "sputum": ("Mycobacterium tuberculosis complex (mycobacterial culture, final at 6 weeks)", 0.5)}},
    "infectious_mononucleosis": {"micro": {"mono": ("Heterophile antibody detected", 0.85)}},
    "infectious_diarrhea": {"micro": {"stool": ("Campylobacter jejuni", 0.4)}},
    "septic_arthritis": {"micro": {"600-7": ("Staphylococcus aureus", 0.3)}},
    "cellulitis": {"micro": {"wound": ("Streptococcus pyogenes", 0.3)}},
}
for _cid, _extra in _PROFILE_EXTRAS.items():
    if _cid in CONDITION_PROFILES or _cid in ("tb_pulmonary", "infectious_mononucleosis", "infectious_diarrhea"):
        _p = dict(CONDITION_PROFILES.get(_cid) or {**DEFAULT_PROFILE, "severity_cap": 0.3})
        _p["micro"] = {**(_p.get("micro") or {}), **(_extra.get("micro") or {})}
        _p["tox"] = {**(_p.get("tox") or {}), **(_extra.get("tox") or {})}
        CONDITION_PROFILES[_cid] = _p


# --------------------------------------------------------------------------- #
# Case context                                                                 #
# --------------------------------------------------------------------------- #
@lru_cache(maxsize=1)
def _catalog() -> list[dict[str, Any]]:
    try:
        from server.condition_catalog import CATALOG  # noqa: PLC0415
        return list(CATALOG)
    except Exception:  # noqa: BLE001
        return []


def condition_id_for(case_state: dict[str, Any]) -> Optional[str]:
    cid = case_state.get("condition_id") or (case_state.get("condition") or {}).get("id")
    if cid:
        return str(cid)
    cond = case_state.get("condition") or {}
    icd10, label = str(cond.get("icd10", "")).strip(), str(cond.get("label_en", "")).strip().lower()
    for c in _catalog():
        if label and c["label_en"].lower() == label:
            return c["id"]
    for c in _catalog():
        if icd10 and c["icd10"] == icd10:
            return c["id"]
    return None


_TREATMENT_RULES: list[tuple[str, str]] = [
    (r"insulin.*(dextrose|glucose)|dextrose.*insulin", "insulin_dextrose"),
    (r"dextrose|10 ?% glucose|glucose 10", "dextrose"),
    (r"insulin|friii", "insulin_infusion"),
    (r"prbc|packed red|transfus|blood product|o[- ]neg", "prbc"),
    (r"fluid|saline|crystalloid|bolus|hartmann|ringer|plasma-?lyte|rehydrat", "iv_fluids"),
    (r"oxygen|\bo2\b|non-?rebreather|nasal cannula|high[- ]flow|\bniv\b|cpap|bipap|intubat|ventilat", "oxygen"),
    (r"antibiotic|ceftriax|cefuroxime|pip|tazo|vancomycin|meropenem|amoxi|co-?amox|gentamicin|cipro|levoflox|doxy|azithro|metronidazole|clarithro|flucloxacillin", "antibiotics"),
    (r"noradren|norepinephrine|vasopress|pressor|adrenaline infusion|epinephrine infusion|metaraminol", "vasopressor"),
    (r"\bpci\b|angioplast|cath lab|reperfusion", "reperfusion_pci"),
    (r"lysis|alteplase|tenecteplase|thrombolys|fibrinolys", "thrombolysis"),
    (r"acetylcyst|\bnac\b", "nac"),
    (r"calcium (gluconate|chloride)", "calcium_gluconate"),
    (r"salbutamol|albuterol", "salbutamol"),
    (r"potassium replacement|\bkcl\b|potassium chloride|replace potassium", "potassium_replacement"),
    (r"dialysis|haemofilt|hemofilt|crrt", "dialysis"),
    (r"surgery|laparotomy|drain|decompress|thoracostomy|chest drain|catheter|source control|appendicectomy|appendectomy|cholecystectomy|needle decompression", "source_control"),
]


def _oxygen_amount(text: str) -> tuple[Optional[float], str]:
    t = text.lower()
    if "non-rebreather" in t or "non rebreather" in t or "nrb" in t or "15 l" in t:
        return None, "non_rebreather"
    if "high-flow" in t or "high flow" in t or "hfnc" in t:
        return None, "hfnc"
    if "niv" in t or "cpap" in t or "bipap" in t:
        return None, "niv"
    if "intubat" in t or "ventilat" in t:
        return None, "ventilator"
    m = re.search(r"(\d+(?:\.\d+)?)\s*l", t)
    if m:
        flow = float(m.group(1))
        return min(1.0, 0.21 + 0.04 * flow), "nasal_cannula"
    m = re.search(r"fio2\s*(\d+(?:\.\d+)?)", t)
    if m:
        v = float(m.group(1))
        return (v / 100.0 if v > 1 else v), "set_fio2"
    return None, "simple_mask"


def map_treatments(case_state: dict[str, Any], onset_h: float) -> list[Treatment]:
    """Map ``case_state['treatments_given']`` (code/label, at_ms, amount) to kinetics treatments."""
    out: list[Treatment] = []
    for item in case_state.get("treatments_given") or []:
        if not isinstance(item, dict):
            continue
        text = " ".join(str(item.get(key, "")) for key in ("code", "label", "label_en", "name")).lower()
        t_h = onset_h + num(item.get("at_ms"), 0.0) / MS_PER_H
        amount = item.get("amount")
        amt = float(amount) if isinstance(amount, (int, float)) else None
        code = str(item.get("kinetics_code") or "")
        if code not in k.TREATMENT_CODES:
            code = ""
            for pattern, mapped in _TREATMENT_RULES:
                if re.search(pattern, text):
                    code = mapped
                    break
        if not code:
            continue
        note = str(item.get("note", ""))
        if code == "oxygen":
            fio2, device = _oxygen_amount(text + " " + note)
            out.append(Treatment(code, t_h, amt if amt is not None else fio2, device if fio2 is None else "set_fio2"))
        elif code == "iv_fluids":
            m = re.search(r"(\d+(?:\.\d+)?)\s*(ml|l)\b", text)
            litres = amt
            if litres is None and m:
                litres = float(m.group(1)) / (1000.0 if m.group(2) == "ml" else 1.0)
            out.append(Treatment(code, t_h, litres if litres is not None else 1.0, note))
        elif code == "prbc":
            m = re.search(r"(\d+)\s*unit", text)
            out.append(Treatment(code, t_h, amt if amt is not None else (float(m.group(1)) if m else 1.0), note))
        else:
            out.append(Treatment(code, t_h, amt, note))
    return sorted(out, key=lambda t: t.t_h)


def vitals_at(case_state: dict[str, Any], sim_time_ms: int) -> dict[str, float]:
    base = dict(case_state.get("triage_vitals") or {})
    traj = sorted((p for p in case_state.get("vitals_trajectory") or [] if isinstance(p, dict)), key=lambda p: num(p.get("atMs"), 0.0))
    points = [{"atMs": 0, **base}] + [p for p in traj if num(p.get("atMs"), 0.0) > 0]
    keys = ("hr", "systolic", "diastolic", "rr", "spo2", "tempC")
    out: dict[str, float] = {}
    for key in keys:
        series = [(num(p.get("atMs"), 0.0), num(p[key], float("nan"))) for p in points if key in p and p[key] is not None]
        series = [(t, v) for t, v in series if math.isfinite(v)]
        if not series:
            continue
        if sim_time_ms <= series[0][0]:
            out[key] = series[0][1]
            continue
        val = series[-1][1]
        for (t0, v0), (t1, v1) in zip(series, series[1:]):
            if t0 <= sim_time_ms <= t1:
                frac = (sim_time_ms - t0) / max(1, t1 - t0)
                val = v0 + frac * (v1 - v0)
                break
        out[key] = val
    return out


_NUM = re.compile(r"-?\d+(?:\.\d+)?")


def num(value: Any, default: float) -> float:
    """A number from a model-written field: 45, "45", "45 years", None -> default.

    Review 2026-10-21: a live case whose spec carried ``age: "45 years"`` made
    the engine raise, the client fell back to the offline synthetic normal and the
    learner saw "Offline synthetic normal" in a live encounter."""
    if isinstance(value, bool):
        return default
    if isinstance(value, (int, float)):
        return float(value) if math.isfinite(float(value)) else default
    if isinstance(value, str):
        m = _NUM.search(value)
        if m:
            return float(m.group(0))
    return default


class CaseContext:
    def __init__(self, case_state: dict[str, Any], sim_time_ms: int, seed: Optional[int]) -> None:
        self.case = case_state = case_state if isinstance(case_state, dict) else {}
        self.seed = seed if seed is not None else int(num(case_state.get("seed"), 0))
        self.condition_id = condition_id_for(case_state)
        self.profile = CONDITION_PROFILES.get(self.condition_id or "", DEFAULT_PROFILE)
        demo = case_state.get("demographics") if isinstance(case_state.get("demographics"), dict) else {}
        sex = str(demo.get("sex", "any")).strip().lower()
        self.sex = {"m": "male", "f": "female", "man": "male", "woman": "female"}.get(sex, sex)
        if self.sex not in ("male", "female"):
            self.sex = "any"
        self.age = int(max(0, min(120, num(demo.get("age"), 45))))
        acuity = int(num(case_state.get("acuity_esi"), 3))
        sev = (6 - max(1, min(5, acuity))) / 5.0
        cap = self.profile.get("severity_cap")
        self.severity = min(sev, cap) if cap is not None else sev
        self.onset_h = num(case_state.get("onset_h"), float(self.profile.get("onset_h", DEFAULT_PROFILE["onset_h"])))
        self.sim_time_ms = max(0, int(sim_time_ms))
        self.t_h = self.onset_h + self.sim_time_ms / MS_PER_H
        self.treatments = map_treatments(case_state, self.onset_h)
        self.vitals = vitals_at(case_state, sim_time_ms)
        # Acceptance 2026-10-20: lactate 5.5 to 8.2 mmol/L appeared in patients
        # with a normal blood pressure. Septic shock is hypotension needing
        # vasopressors for a MAP of 65 mmHg with lactate above 2 after fluids
        # (Sepsis-3, Singer et al. JAMA 2016;315:801, doi 10.1001/jama.2016.0287);
        # without hypotension the hyperlactataemia of sepsis is usually 2 to 4.
        sbp = float(self.vitals.get("systolic", 120) or 120)
        dbp = float(self.vitals.get("diastolic", 70) or 70)
        self.hypotensive = sbp < 90 or (sbp + 2 * dbp) / 3 < 65
        # Review 06b F19: when the Clinical Director is live, its state wins over
        # the ESI-derived severity and the authored trajectory: severity, MAP and
        # shock come from the course engine, lactate from perfusion (F20), CBG and
        # potassium from insulin, dextrose and replacement (F18), and an opened
        # branch (pneumonia to septic shock) switches the lab profile.
        live = case_state.get("director")
        self.live: Optional[dict[str, Any]] = live if isinstance(live, dict) and live.get("vitals") is not None else None
        if self.live is not None:
            branch = str(self.live.get("condition_id") or "")
            if branch and branch != self.condition_id and branch in CONDITION_PROFILES:
                merged = dict(self.profile)
                merged["labs"] = {**(self.profile.get("labs") or {}), **(CONDITION_PROFILES[branch].get("labs") or {})}
                self.profile = merged
            try:
                self.severity = max(0.0, min(1.0, float(self.live.get("severity") or 0.0)))
            except (TypeError, ValueError):
                pass
            lv = self.live.get("vitals") if isinstance(self.live.get("vitals"), dict) else {}
            self.vitals = {k: num(lv[k], 0.0) for k in ("hr", "systolic", "diastolic", "rr", "spo2", "tempC") if k in lv}
            mp = self.live.get("map")
            self.hypotensive = bool(self.live.get("shock")) or (mp is not None and num(mp, 90.0) < 65)
        self.authored_labs = {canonical_loinc(str(lab.get("code"))): lab for lab in case_state.get("labs") or [] if isinstance(lab, dict) and lab.get("code")}
        self.authored_imaging = [im for im in case_state.get("imaging") or [] if isinstance(im, dict)]
        self.weight_kg = num(demo.get("weight_kg"), 70.0) or 70.0
        self.medications = " ".join(str(m.get("name") or m.get("drug") or m.get("label_en") or "") if isinstance(m, dict) else str(m)
                                    for m in (case_state.get("medications") or []) if m).lower()


# --------------------------------------------------------------------------- #
# Analyte evaluation                                                           #
# --------------------------------------------------------------------------- #
NORMOTENSIVE_LACTATE_SEVERITY = 0.25


def _model_value(ctx: CaseContext, loinc: str, spec: Optional[tuple], t_h: float) -> tuple[float, Optional[str]]:
    base = _baseline(loinc, ctx.sex, ctx.age, ctx.seed)
    if spec is None and ctx.live is not None and loinc in ("2345-7", "2339-0") and ctx.live.get("metabolic") in ("dka", "hypo") \
            and ctx.live.get("cbg") is not None:
        return num(ctx.live["cbg"], 5.5) * 18.0, "director"
    if spec is None:
        return base, None
    kind = spec[0]
    tr = ctx.treatments
    sev = ctx.severity
    live = ctx.live
    if live is not None:
        if kind == "lactate" and live.get("lactate") is not None:
            return num(live["lactate"], 1.0), "director"
        metabolic = live.get("metabolic")
        if kind == "dka" and spec[1] == "glucose" and live.get("cbg") is not None:
            return num(live["cbg"], 5.5) * 18.0, "director"
        if (kind == "potassium" or (kind == "dka" and spec[1] == "potassium")) and live.get("k") is not None \
                and metabolic in ("dka", "hyperk"):
            return num(live["k"], 4.2), "director"
        if loinc in ("2345-7", "2339-0") and metabolic in ("dka", "hypo") and live.get("cbg") is not None:
            return num(live["cbg"], 5.5) * 18.0, "director"
    if kind == "troponin":
        assay = spec[1] or load_ranges()["_by_loinc"].get(loinc, {}).get("assay", "hs_ctnt")
        return k.troponin(assay, t_h, sev, tr, ctx.sex), "troponin"
    if kind == "lactate":
        # A normotensive patient's plateau stays at or below 1 + 9 * 0.25 = 3.25.
        return k.lactate(t_h, sev if ctx.hypotensive else min(sev, NORMOTENSIVE_LACTATE_SEVERITY), tr), "lactate"
    if kind == "crp":
        return k.crp(t_h, sev, tr), "crp"
    if kind == "pct":
        return k.procalcitonin(t_h, sev, tr, bacterial=bool(spec[1])), "procalcitonin"
    if kind == "creatinine":
        return k.creatinine_aki(t_h, base, sev, tr), "creatinine_aki"
    if kind == "dka":
        s = k.dka_state(t_h, sev, tr)
        key = spec[1]
        if key == "glucose":
            return s["glucose_mmol_L"] * 18.0, "dka"
        if key == "ph_venous":
            return k.venous_from_arterial(s["ph"], s["pco2_mmHg"], s["hco3_mmol_L"], 90.0)["ph"], "dka"
        if key == "pco2_venous":
            return k.venous_from_arterial(s["ph"], s["pco2_mmHg"], s["hco3_mmol_L"], 90.0)["pco2_mmHg"], "dka"
        mapping = {"ketones": "ketones_mmol_L", "hco3": "hco3_mmol_L", "ph": "ph", "pco2": "pco2_mmHg", "potassium": "potassium_mmol_L"}
        return s[mapping[key]], "dka"
    if kind == "potassium":
        return k.potassium(t_h - ctx.onset_h, float(spec[1]), tr, ongoing_release=0.0), "potassium"
    if kind == "hb":
        return k.hemoglobin_hemorrhage(t_h, base, float(spec[1]) * max(sev, 0.3), tr, weight_kg=ctx.weight_kg), "hemoglobin_hemorrhage"
    if kind == "oxy":
        o = k.oxygenation(sev, tr, t_h=t_h)
        return (o["pao2_mmHg"] if spec[1] == "pao2" else o["spo2_pct"]), "oxygenation"
    if kind == "paracetamol":
        r = k.paracetamol_level(t_h, float(spec[1]) * max(sev, 0.3), weight_kg=ctx.weight_kg, treatments=tr)
        return float(r["level_mg_L"]), "paracetamol"
    if kind == "static":
        return float(spec[1]), None
    if kind == "mult":
        return base * float(spec[1]), None
    return base, None


def _interpret(loinc: str, value: float, flag: str, kinetics_key: Optional[str], ctx: CaseContext, prior_value: Optional[float]) -> str:
    a = load_ranges()["_by_loinc"].get(loinc, {})
    name = a.get("short", loinc)
    if kinetics_key == "troponin":
        assay = a.get("assay", "hs_ctnt")
        rule = k.troponin_rule(assay, value) if prior_value is None else k.troponin_rule(assay, prior_value, value)
        return {"rule_in": f"{name} above the ESC rule-in threshold: myocardial injury.", "rule_out": f"{name} below the ESC very-low threshold: MI unlikely at this draw.", "observe": f"{name} in the observe zone: repeat per the ESC 0 h/1 h algorithm."}[rule]
    if kinetics_key == "lactate":
        if prior_value is not None and prior_value > 0:
            pct = 100.0 * (prior_value - value) / prior_value
            return f"Lactate {'cleared' if pct > 0 else 'rose'} {abs(pct):.0f} percent since the last draw (target over 10 percent clearance)."
        return "Lactate above 2 mmol/L indicates hypoperfusion; repeat after resuscitation." if value > 2.0 else "Lactate within range."
    if kinetics_key == "creatinine_aki":
        stage = k.kdigo_stage(_baseline(loinc, ctx.sex, ctx.age, ctx.seed), value)
        return f"KDIGO stage {stage} acute kidney injury." if stage else "Creatinine at baseline."
    if kinetics_key == "paracetamol":
        r = k.paracetamol_nomogram_line(ctx.t_h)
        if r is None:
            return "Level not interpretable on the nomogram (outside 4 to 24 h post-ingestion)."
        return f"Level {'above' if value >= r else 'below'} the treatment line ({r:.0f} mg/L at {ctx.t_h:.1f} h)."
    if flag == "N":
        return f"{name} within the reference interval."
    direction = "below" if flag in ("L", "LL") else "above"
    crit = " Critical value; notify the clinician." if flag in ("LL", "HH") else ""
    return f"{name} {direction} the reference interval.{crit}"


def _prior_observation(prior: Optional[list[dict[str, Any]]], loinc: str) -> Optional[dict[str, Any]]:
    if not prior:
        return None
    for res in reversed(prior):
        for obs in res.get("observations", []) or []:
            if obs.get("loinc") == loinc and isinstance(obs.get("value"), (int, float)):
                return {"value": float(obs["value"]), "sim_time_ms": res.get("sim_time_ms")}
    return None


def _qualitative(a: dict[str, Any], value: Any, ground_truth: bool, interpretation: Optional[str] = None,
                 kinetics: Optional[str] = None) -> dict[str, Any]:
    abnormal = str(value) != str(a.get("normal_value", value))
    return {"loinc": a["loinc"], "name": a["name"], "short": a.get("short"), "value": value, "unit": a.get("unit", ""), "qualitative": True,
            "ref_low": None, "ref_high": None, "reference_text": a.get("normal_value") or a.get("reference_text"), "flag": "A" if abnormal else "N", "critical": False,
            "interpretation": interpretation or f"{a['name']}: {value}.", "delta": None, "kinetics": kinetics, "ground_truth": ground_truth,
            "source": a["source"], "reviewed_at": a["reviewed_at"]}


def _exposed(ctx: CaseContext, a: dict[str, Any]) -> bool:
    """True when the case medication list names the drug of an absent-unless-exposed analyte."""
    words = [w for w in re.findall(r"[a-z]+", a["name"].lower()) if len(w) > 4 and w not in ("level", "total", "screen", "urine")]
    return any(w in ctx.medications for w in words)


def _observation(ctx: CaseContext, loinc: str, prior: Optional[list[dict[str, Any]]]) -> dict[str, Any]:
    loinc = canonical_loinc(loinc)
    a = load_ranges()["_by_loinc"].get(loinc)
    if a is None:
        raise KeyError(loinc)
    spec = ctx.profile.get("labs", {}).get(loinc)
    authored = ctx.authored_labs.get(loinc)
    tox = (ctx.profile.get("tox") or {}).get(loinc)
    if a.get("qualitative"):
        value: Any = a["normal_value"]
        if authored is not None and isinstance(authored.get("value"), str):
            value = authored["value"]
        elif tox is not None:
            value = tox
        return _qualitative(a, value, authored is not None, kinetics="condition_profile" if tox is not None and authored is None else None)
    if a.get("absent_unless_exposed") and spec is None and authored is None and tox is None and not _exposed(ctx, a):
        # A drug the patient does not take is not detected; it is never sampled
        # from its therapeutic range (that range applies to treated patients only).
        out = _qualitative(a, "Not detected", False,
                           f"{a['name']}: not detected. The patient is not known to take it; the therapeutic range applies to treated patients.")
        out["flag"] = "N"
        rr = reference_range(loinc, ctx.sex, ctx.age) or {"low": None, "high": None}
        out["ref_low"], out["ref_high"] = rr["low"], rr["high"]
        return out
    model_now, kin = _model_value(ctx, loinc, spec, ctx.t_h)
    ground_truth = False
    if authored is not None and isinstance(authored.get("value"), (int, float)):
        ground_truth = True
        authored_value = float(authored["value"])
        if kin == "director":
            value_num = model_now
        elif kin is not None:
            model_arrival, _ = _model_value(ctx, loinc, spec, ctx.onset_h)
            value_num = authored_value if ctx.sim_time_ms == 0 else (model_now * (authored_value / model_arrival) if model_arrival > 0 else model_now)
        else:
            value_num = authored_value
    else:
        value_num = model_now
    value_num = _round(loinc, value_num)
    rr = reference_range(loinc, ctx.sex, ctx.age) or {"low": None, "high": None}
    flag, crit = flag_value(loinc, value_num, ctx.sex, ctx.age)
    prev = _prior_observation(prior, loinc)
    delta = None
    if prev is not None:
        change = value_num - prev["value"]
        delta = {"prior_value": prev["value"], "prior_sim_time_ms": prev["sim_time_ms"], "change": round(change, int(a.get("decimals", 1))),
                 "pct": round(100.0 * change / prev["value"], 1) if prev["value"] else None}
    return {"loinc": loinc, "name": a["name"], "short": a.get("short"), "value": value_num, "unit": a.get("unit", ""), "qualitative": False,
            "ref_low": rr["low"], "ref_high": rr["high"], "flag": flag, "critical": crit,
            "interpretation": _interpret(loinc, value_num, flag, kin, ctx, prev["value"] if prev else None),
            "delta": delta, "kinetics": kin, "ground_truth": ground_truth, "source": a["source"], "reviewed_at": a["reviewed_at"]}


_UA_PATTERNS: dict[str, dict[str, str]] = {
    "infected": {"5802-4": "Positive", "5799-2": "Positive", "5821-4": "Many", "25145-4": "Many", "5794-3": "Trace"},
    "ketonuria": {"5797-6": "Large", "5792-7": "Positive (3+)", "5811-5": "1.032"},
    "haematuria": {"5794-3": "Positive (moderate)", "13945-1": "Many"},
    "myoglobinuria": {"5794-3": "Positive (large)", "13945-1": "None seen"},
    "proteinuria": {"5804-0": "Positive (2+)"},
    "hcg_positive": {},
}


def _apply_ua_pattern(ctx: CaseContext, observations: list[dict[str, Any]]) -> None:
    pattern = _UA_PATTERNS.get(ctx.profile.get("ua", ""), {})
    for obs in observations:
        override = pattern.get(obs["loinc"])
        if override is None or obs["ground_truth"]:
            continue
        obs["value"] = override
        obs["flag"] = "A"
        obs["interpretation"] = f"{obs['name']}: {override} (consistent with the clinical picture)."


def _reconcile_differential(ctx: CaseContext, observations: list[dict[str, Any]]) -> None:
    """Make the absolute neutrophil and lymphocyte counts fit inside the total.

    Acceptance 2026-10-20 D-23: a malaria CBC reported WBC 16.8 with neutrophils
    3.9 and lymphocytes 2.2 (6.1 of 16.8). The white count is the sum of the
    differential, so neutrophils + lymphocytes are scaled to the total minus the
    other cells (monocytes, eosinophils and basophils, about 8 percent of the
    count, 0.2 to 1.0 x 10^9/L; MedlinePlus Blood differential test,
    https://medlineplus.gov/ency/article/003657.htm). Authored (case) values are
    never rescaled; the free analyte absorbs the difference."""
    by = {o["loinc"]: o for o in observations if not o.get("qualitative")}
    wbc, anc, alc = by.get("6690-2"), by.get("751-8"), by.get("731-0")
    if not (wbc and anc and alc):
        return
    total = float(wbc["value"])
    other = min(1.0, max(0.2, 0.08 * total)) if total >= 2.5 else 0.08 * total
    room = max(0.0, total - other)
    n, ly = float(anc["value"]), float(alc["value"])
    if anc["ground_truth"] and alc["ground_truth"]:
        return
    if anc["ground_truth"]:
        ly = max(0.0, room - n)
    elif alc["ground_truth"]:
        n = max(0.0, room - ly)
    elif n + ly > room or ly >= room:
        scale = room / (n + ly) if n + ly > 0 else 0.0
        n, ly = n * scale, ly * scale
    else:
        # A raised total is a neutrophilia unless the case authored otherwise.
        n = room - ly
    hb, hct = by.get("718-7"), by.get("4544-3")
    if hb and hct and hb["ground_truth"] and not hct["ground_truth"]:
        # Haematocrit is about three times the haemoglobin in g/dL (MedlinePlus 003646).
        hct["value"] = _round("4544-3", 3.0 * float(hb["value"]))
        hct["flag"], hct["critical"] = flag_value("4544-3", hct["value"], ctx.sex, ctx.age)
        hct["interpretation"] = _interpret("4544-3", hct["value"], hct["flag"], None, ctx, None)
    for obs, val in ((anc, n), (alc, ly)):
        if obs["ground_truth"]:
            continue
        obs["value"] = _round(obs["loinc"], val)
        obs["flag"], obs["critical"] = flag_value(obs["loinc"], obs["value"], ctx.sex, ctx.age)
        obs["interpretation"] = _interpret(obs["loinc"], obs["value"], obs["flag"], obs.get("kinetics"), ctx, None)


def _tat_category(loincs: list[str], order_code: str) -> str:
    o = catalog.lab_orderable(order_code)
    if o is not None:
        return o["turnaround"]
    if order_code in ("poc-glucose", "istat"):
        return "poc"
    cats = {load_ranges()["_by_loinc"][l]["category"] for l in loincs if l in load_ranges()["_by_loinc"]}
    if cats == {"blood_gas"} or order_code in ("vbg", "abg"):
        return "blood_gas"
    for c in ("toxicology", "endocrine", "cardiac", "inflammatory", "coagulation", "urine", "haematology"):
        if c in cats:
            return c
    return "chemistry"


def _turnaround(category: str, *, positive: Optional[bool] = None) -> dict[str, Any]:
    return catalog.turnaround(category, positive=positive)


def _fixed(ctx: CaseContext, loinc: str) -> bool:
    """True when the case or the condition sets this analyte (do not reconcile it)."""
    return loinc in ctx.authored_labs or loinc in (ctx.profile.get("labs") or {})


def _set_value(ctx: CaseContext, obs: dict[str, Any], value: float, kinetics: Optional[str] = None, note: Optional[str] = None) -> None:
    obs["value"] = _round(obs["loinc"], value)
    obs["flag"], obs["critical"] = flag_value(obs["loinc"], obs["value"], ctx.sex, ctx.age)
    if kinetics:
        obs["kinetics"] = kinetics
    obs["interpretation"] = _interpret(obs["loinc"], obs["value"], obs["flag"], None, ctx, None) + (f" {note}" if note else "")


def _reconcile_chemistry(ctx: CaseContext, observations: list[dict[str, Any]]) -> None:
    """Keep a healthy patient's electrolytes, proteins and red cell indices
    internally consistent.

    Independent seeded draws can produce an anion gap of 20 or a globulin of
    0.5 g/dL in a well patient. When the case and the condition leave these
    analytes alone, chloride follows sodium and bicarbonate (gap 6 to 10 mmol/L,
    inside the Kraut 2007 interval), total protein follows albumin (globulin
    2.4 to 3.4 g/dL, NBME 2.3 to 3.5), and haematocrit, red cell count, MCH and
    MCHC follow haemoglobin and MCV (Hct about 3 x Hb, MedlinePlus 003646;
    MCV = Hct/RBC, MCH = Hb/RBC, MCHC = Hb/Hct, MedlinePlus RBC indices 003648)."""
    by = {o["loinc"]: o for o in observations if not o.get("qualitative")}
    na, cl, hco3 = by.get("2951-2"), by.get("2075-0"), by.get("1963-8")
    if na and cl and hco3 and not any(_fixed(ctx, c) for c in ("2951-2", "2075-0", "1963-8")) and not cl["ground_truth"]:
        gap = 6.0 + 4.0 * _unit(ctx.seed, "anion_gap")
        rr = reference_range("2075-0", ctx.sex, ctx.age) or {"low": 95.0, "high": 105.0}
        target = float(na["value"]) - float(hco3["value"]) - gap
        _set_value(ctx, cl, min(max(target, float(rr["low"])), float(rr["high"])))
        if abs(float(na["value"]) - float(cl["value"]) - float(hco3["value"]) - gap) > 1.0:
            # Chloride hit its limit: let bicarbonate absorb the rest, within its interval.
            rb = reference_range("1963-8", ctx.sex, ctx.age) or {"low": 22.0, "high": 28.0}
            target = float(na["value"]) - float(cl["value"]) - gap
            _set_value(ctx, hco3, min(max(target, float(rb["low"])), float(rb["high"])))
    tp, alb = by.get("2885-2"), by.get("1751-7")
    if tp and alb and not _fixed(ctx, "2885-2"):
        rr = reference_range("2885-2", ctx.sex, ctx.age) or {"low": 6.0, "high": 7.8}
        target = float(alb["value"]) + 2.4 + 1.0 * _unit(ctx.seed, "globulin")
        _set_value(ctx, tp, min(max(target, float(rr["low"])), float(rr["high"])))
    hb, hct, mcv = by.get("718-7"), by.get("4544-3"), by.get("787-2")
    if hb and hct and not hct["ground_truth"] and "4544-3" not in (ctx.profile.get("labs") or {}):
        _set_value(ctx, hct, 3.0 * float(hb["value"]) + (_unit(ctx.seed, "hct") - 0.5))
    if hb and hct and mcv and float(mcv["value"]) > 0:
        rbc, mch, mchc = by.get("789-8"), by.get("785-6"), by.get("786-4")
        if rbc and not rbc["ground_truth"]:
            _set_value(ctx, rbc, 10.0 * float(hct["value"]) / float(mcv["value"]))
        if rbc and mch and not mch["ground_truth"] and float(rbc["value"]) > 0:
            _set_value(ctx, mch, 10.0 * float(hb["value"]) / float(rbc["value"]))
        if mchc and not mchc["ground_truth"] and float(hct["value"]) > 0:
            _set_value(ctx, mchc, 100.0 * float(hb["value"]) / float(hct["value"]))


def egfr_ckd_epi_2021(creatinine_mg_dl: float, age: int, sex: str) -> float:
    """CKD-EPI 2021 race-free creatinine equation (Inker LA et al., N Engl J Med
    2021;385:1737-1749, doi 10.1056/NEJMoa2102953):
    142 x min(Scr/k, 1)^a x max(Scr/k, 1)^-1.200 x 0.9938^age [x 1.012 if female],
    k 0.7 (female) or 0.9 (male), a -0.241 (female) or -0.302 (male)."""
    female = sex == "female"
    kappa, alpha = (0.7, -0.241) if female else (0.9, -0.302)
    ratio = max(0.05, float(creatinine_mg_dl)) / kappa
    v = 142.0 * min(ratio, 1.0) ** alpha * max(ratio, 1.0) ** -1.200 * 0.9938 ** max(18, age)
    return v * (1.012 if female else 1.0)


def _apply_derived(ctx: CaseContext, observations: list[dict[str, Any]], prior: Optional[list[dict[str, Any]]]) -> None:
    """Compute calculated analytes from the other analytes of the same draw."""
    ranges = load_ranges()["_by_loinc"]
    by = {o["loinc"]: o for o in observations if not o.get("qualitative")}

    def val(code: str) -> float:
        o = by.get(code) or _observation(ctx, code, prior)
        return float(o["value"])

    for o in observations:
        rule = ranges.get(o["loinc"], {}).get("derived")
        if not rule or o["ground_truth"]:
            continue
        if rule == "anion_gap":
            v, note = val("2951-2") - (val("2075-0") + val("1963-8")), "Calculated: Na - (Cl + HCO3)."
        elif rule == "egfr_ckdepi2021":
            v, note = egfr_ckd_epi_2021(val("2160-0"), ctx.age, ctx.sex), "Calculated: CKD-EPI 2021 creatinine equation."
        elif rule == "globulin":
            v, note = 10.0 * (val("2885-2") - val("1751-7")), "Calculated: total protein - albumin."
        elif rule == "ldl_friedewald":
            v, note = val("2093-3") - val("2085-9") - val("2571-8") / 5.0, "Calculated (Friedewald): TC - HDL - TG/5."
        else:
            continue
        _set_value(ctx, o, v, "derived", note)


def _lab_body(ctx: CaseContext, order_code: str, loincs: list[str], prior: Optional[list[dict[str, Any]]]) -> dict[str, Any]:
    observations = [_observation(ctx, l, prior) for l in loincs]
    if any(o["loinc"] in ("6690-2", "751-8") for o in observations):
        _reconcile_differential(ctx, observations)
    _reconcile_chemistry(ctx, observations)
    _apply_derived(ctx, observations, prior)
    if order_code == "ua":
        _apply_ua_pattern(ctx, observations)
    return {"kind": "lab", "status": "ok", "observations": observations,
            "abnormal": any(o["flag"] != "N" for o in observations), "critical": any(o["critical"] for o in observations),
            "turnaround": _turnaround(_tat_category(loincs, order_code))}


# --------------------------------------------------------------------------- #
# Imaging / ECG / micro                                                        #
# --------------------------------------------------------------------------- #
def _imaging_request(ctx: CaseContext, order_code: str) -> tuple[str, str, list[str], str, str, str]:
    """Return (finding, laterality, findings, impression, modality, region) for the order."""
    m = imaging_bank.ORDER_MODALITY.get(order_code)
    modality, region = (m[0], m[1]) if m else ("xr", "chest")
    key = f"{modality}:{region}"
    prof = ctx.profile.get("imaging", {})
    if key in prof:
        finding, lat, findings, impression = prof[key]
        return finding, lat, list(findings), impression, modality, region
    if modality == "echo" and "echo:heart" in prof:
        finding, lat, findings, impression = prof["echo:heart"]
        return finding, lat, list(findings), impression, modality, region
    return "normal", "none", ["no acute abnormality"], "No acute abnormality.", modality, region


def _authored_imaging(ctx: CaseContext, order_code: str, modality: str) -> Optional[dict[str, Any]]:
    aliases = {code for code, (m, _r, _v) in imaging_bank.ORDER_MODALITY.items() if m == modality}
    for im in ctx.authored_imaging:
        if str(im.get("code")) == order_code or str(im.get("code")) in aliases:
            return im
    return None


def _imaging_tat_key(order_code: str, modality: str) -> str:
    proc = catalog.imaging_procedure(order_code)
    if proc is not None:
        return proc["turnaround"]
    return {"xr": "xr", "ct": "ct", "us": "us", "echo": "echo", "mri": "mri", "ecg": "ecg"}[modality]


def _resolve_imaging(ctx: CaseContext, order_code: str) -> dict[str, Any]:
    finding, lat, findings, impression, modality, region = _imaging_request(ctx, order_code)
    authored = _authored_imaging(ctx, order_code, modality)
    if authored is not None and authored.get("findings_en"):
        impression = str(authored["findings_en"])
        findings = [impression]
    structured = [{"finding": finding, "laterality": lat, "text": f} for f in findings]
    hit = imaging_bank.resolve(order_code=order_code, finding=finding, laterality=lat, condition_id=ctx.condition_id, findings=structured)
    image = None
    if hit["status"] == "ok":
        e = hit["entry"]
        image = {"id": e["id"], "url": e["url"], "local_path": e.get("local_path"), "caption_en": e["caption_en"], "view": e["view"],
                 "modality": e["modality"], "region": e["region"], "finding": e["finding"], "laterality": e["laterality"]}
    proc = catalog.imaging_procedure(order_code)
    return {
        "kind": "imaging", "status": "ok" if image else "unavailable",
        "procedure": None if proc is None else {"code": proc["code"], "loinc": proc.get("loinc"), "label_en": proc["label_en"],
                                                "label_tr": proc["label_tr"], "playbook": proc["playbook"]},
        "report": {"modality": modality, "region": region, "finding": finding, "laterality": lat, "findings": structured,
                   "impression": impression, "ground_truth": authored is not None,
                   "image": image, "provenance": hit.get("provenance"), "image_status": hit["status"], "image_reason": hit.get("reason")},
        "turnaround": _turnaround(_imaging_tat_key(order_code, modality)),
    }


def ecg_pattern_for(ctx: CaseContext) -> tuple[str, float]:
    hr = float(ctx.vitals.get("hr", 80) or 80)
    pattern = ctx.profile.get("ecg")
    if not pattern:
        pattern = "sinus_tachycardia" if hr > 100 else "sinus_bradycardia" if hr < 50 else "normal"
    if pattern in ("normal", "sinus_tachycardia", "sinus_bradycardia"):
        pattern = "sinus_tachycardia" if hr > 100 else "sinus_bradycardia" if hr < 50 else "normal"
    return pattern, hr


def _resolve_ecg(ctx: CaseContext) -> dict[str, Any]:
    pattern, hr = ecg_pattern_for(ctx)
    rate = hr if pattern in ("normal", "sinus_tachycardia", "sinus_bradycardia", "atrial_fibrillation", "pulmonary_embolism", "pericarditis", "stemi_anterior", "stemi_inferior", "stemi_lateral", "stemi_posterior", "nstemi", "hyperkalemia", "long_qt", "wpw") else None
    strip = ecg_mod.synthesize(pattern, rate_bpm=rate, seed=ctx.seed)
    hit = imaging_bank.resolve(order_code="11524-6", finding=pattern, condition_id=ctx.condition_id)
    return {
        "kind": "ecg", "status": "ok",
        "ecg": {"pattern": pattern, "rate_bpm": strip["measurements"]["rate_bpm"], "measurements": strip["measurements"],
                "request": {"pattern": pattern, "rate_bpm": rate, "seed": ctx.seed},
                "reference_image": None if hit["status"] != "ok" else {"url": hit["entry"]["url"], "local_path": hit["entry"].get("local_path"), "caption_en": hit["entry"]["caption_en"], "provenance": hit["provenance"]},
                "is_synthetic": True},
        "turnaround": _turnaround("ecg"),
    }


def _micro_member_obs(a: dict[str, Any], value: str, positive: bool, interpretation: str, note: Optional[str], critical: bool = False) -> dict[str, Any]:
    out = _qualitative(a, value, False, interpretation, "condition_profile" if positive else None)
    out["flag"] = "A" if positive else "N"
    out["critical"] = critical
    out["note"] = note
    return out


def _resolve_micro(ctx: CaseContext, order_code: str) -> dict[str, Any]:
    """Cultures, smears, antigen, serology and NAAT from the condition profile."""
    key = MICRO_CODES[order_code]
    micro = ctx.profile.get("micro", {})
    if key == "covid" and "covid" not in micro and "rvp" in micro and "sars-cov-2" in str(micro["rvp"][0]).lower():
        micro = {**micro, "covid": micro["rvp"]}
    organism, p = micro.get(key, (None, 0.0))
    abx_before = any(t.code == "antibiotics" and t.t_h <= ctx.t_h for t in ctx.treatments)
    culture = key in specimens.CULTURE_KEYS
    if abx_before and organism and culture:
        p *= 0.5  # cultures drawn after antibiotics lose sensitivity (Lamy 2016)
    positive = organism is not None and _unit(ctx.seed, "micro", order_code) < p
    note = "Drawn after antibiotics: sensitivity reduced." if abx_before and organism and culture else None
    orderable = catalog.lab_orderable(order_code) or {"members": [], "turnaround": "micro_culture"}
    by = load_ranges()["_by_loinc"]
    members = [m for m in orderable["members"] if m in by]
    observations: list[dict[str, Any]] = []
    preliminary: Optional[dict[str, Any]] = None
    if culture:
        a = by[members[0]] if members else {"loinc": order_code, "name": order_code, "short": order_code, "normal_value": "No growth",
                                            "unit": "", "source": "https://doi.org/10.3389/fmicb.2016.00697", "reviewed_at": "2026-10-19"}
        text = f"Growth: {organism}" if positive else ("No growth at 5 days" if key == "600-7" else a["normal_value"])
        interp = ("Positive culture; correlate with the clinical picture; susceptibilities to follow." if positive else "No pathogen isolated.")
        observations.append(_micro_member_obs(a, text, positive, interp, note, critical=bool(positive and key == "600-7")))
        preliminary = {"text": specimens.culture_preliminary(key, positive, organism)}
        tat = _turnaround(orderable["turnaround"], positive=positive)
    else:
        lookup = specimens.MEMBER_BY_TEXT.get(key, [])
        hit_member = None
        if positive and organism:
            low = organism.lower()
            hit_member = next((code for words, code in lookup if words in low), members[0] if members else None)
        for m in members:
            a = by[m]
            if positive and m == hit_member:
                value = organism if key in ("malaria", "malaria_rdt", "gram", "afb") else specimens.POSITIVE_WORD.get(a["normal_value"], "Positive")
                observations.append(_micro_member_obs(a, value, True, f"{a['name']}: {value}. {organism}." if value != organism else f"{a['name']}: {value}.", note))
            else:
                normal = a["normal_value"]
                if key == "malaria" and not positive:
                    normal = "No malaria parasites seen on thick and thin films; repeat in 12 to 24 h if still suspected"
                observations.append(_micro_member_obs(a, normal, False, f"{a['name']}: {normal}.", None))
        tat = _turnaround(orderable["turnaround"])
    body: dict[str, Any] = {"kind": "micro", "status": "ok", "observations": observations,
                            "abnormal": any(o["flag"] != "N" for o in observations), "critical": any(o["critical"] for o in observations),
                            "turnaround": tat}
    if preliminary is not None and tat.get("preliminary_ms"):
        preliminary["available_at_ms"] = ctx.sim_time_ms + tat["preliminary_ms"]
        body["preliminary"] = preliminary
    return body


def _resolve_csf(ctx: CaseContext, order_code: str, prior: Optional[list[dict[str, Any]]]) -> dict[str, Any]:
    """CSF cell count, protein, glucose, Gram stain and culture."""
    by = load_ranges()["_by_loinc"]
    pattern = specimens.CSF_PATTERNS.get(ctx.condition_id or "")
    if pattern is not None and _unit(ctx.seed, "csf") >= float(pattern.get("p", 1.0)):
        pattern = None  # a minority of early meningitis taps are unremarkable
    observations = []
    orderable = catalog.lab_orderable(order_code) or {"members": []}
    for code in orderable["members"]:
        a = by[code]
        if a.get("qualitative"):
            if code == "664-3":
                text = (pattern or {}).get("gram") or a["normal_value"]
            else:
                text = (pattern or {}).get("culture") or a["normal_value"]
                text = f"Growth: {text}" if (pattern or {}).get("culture") else text
            observations.append(_micro_member_obs(a, text, text != a["normal_value"], f"{a['name']}: {text}.", None))
            continue
        obs = _observation(ctx, code, prior)
        if pattern is not None:
            field = {"26465-5": "wbc", "26454-9": "rbc", "2880-3": "protein", "2342-4": "glucose"}[code]
            _set_value(ctx, obs, float(pattern[field]), "specimen_profile")
        elif code in ("26465-5", "26454-9"):
            _set_value(ctx, obs, 0.0 if code == "26454-9" else round(4.0 * _unit(ctx.seed, "csf_wbc")))
        observations.append(obs)
    if pattern is not None:
        observations[0]["interpretation"] += f" Differential: {pattern['cells']}."
    serum_glucose = _observation(ctx, "2345-7", prior)["value"]
    glu = next((o for o in observations if o["loinc"] == "2342-4"), None)
    if glu is not None and pattern is None and isinstance(serum_glucose, (int, float)):
        # CSF glucose is normally more than two thirds of blood glucose (MedlinePlus 003633).
        _set_value(ctx, glu, max(float(glu["value"]), 0.66 * float(serum_glucose)))
    tat = _turnaround("csf")
    return {"kind": "lab", "status": "ok", "observations": observations,
            "abnormal": any(o["flag"] != "N" for o in observations), "critical": any(o["critical"] for o in observations),
            "turnaround": tat, "culture_final_at_ms": ctx.sim_time_ms + int(catalog.TURNAROUND["csf"]["culture_final_minutes"]) * 60_000}


def _resolve_fluid(ctx: CaseContext, order_code: str, prior: Optional[list[dict[str, Any]]]) -> dict[str, Any]:
    """Pleural, ascitic or synovial fluid: only when the patient has that fluid."""
    orderable = catalog.lab_orderable(order_code) or {}
    fluid = orderable.get("fluid", "")
    pattern = specimens.FLUID_PATTERNS.get(fluid, {}).get(ctx.condition_id or "")
    if pattern is not None and pattern.get("requires_effusion"):
        prof_img = ctx.profile.get("imaging", {})
        if not any("effusion" in " ".join(v[2]).lower() and "no effusion" not in " ".join(v[2]).lower() for v in prof_img.values()):
            pattern = None
    if pattern is None:
        return {"kind": "lab", "status": "unavailable", "reason": "no_specimen", "message": specimens.NO_SPECIMEN.get(fluid, "No specimen obtainable."),
                "observations": [], "turnaround": _turnaround("body_fluid")}
    by = load_ranges()["_by_loinc"]
    observations = []
    for code in orderable["members"]:
        a = by[code]
        if a.get("qualitative"):
            if code == "664-3":
                text = pattern.get("gram") or a["normal_value"]
            elif code == "5781-0":
                text = pattern.get("crystals") or a["normal_value"]
            else:
                text = f"Growth: {pattern['culture']}" if pattern.get("culture") else a["normal_value"]
            observations.append(_micro_member_obs(a, text, text != a["normal_value"], f"{a['name']}: {text}.", None))
            continue
        field = {"2882-9": "protein_g_l", "60022-1": "ldh", "2346-5": "glucose", "2748-2": "ph", "26467-1": "wbc",
                 "26469-7": "wbc", "17836-8": "pmn"}.get(code)
        value = float(pattern.get(field, 0.0)) if field else 0.0
        obs = {"loinc": code, "name": a["name"], "short": a.get("short"), "value": _round(code, value), "unit": a.get("unit", ""),
               "qualitative": False, "ref_low": None, "ref_high": None, "reference_text": a.get("reference_text"), "flag": "N",
               "critical": False, "interpretation": f"{a['name']}: {_round(code, value)} {a.get('unit', '')}.", "delta": None,
               "kinetics": "specimen_profile", "ground_truth": False, "source": a["source"], "reviewed_at": a["reviewed_at"]}
        observations.append(obs)
    summary = _fluid_interpretation(ctx, fluid, pattern, prior)
    if observations:
        observations[0]["interpretation"] += f" {summary}"
        for o in observations:
            if o["loinc"] in _FLUID_DRIVERS.get(pattern.get("kind", ""), ()):
                o["flag"] = "A"
    return {"kind": "lab", "status": "ok", "observations": observations, "interpretation": summary,
            "abnormal": any(o["flag"] != "N" for o in observations), "critical": False, "turnaround": _turnaround("body_fluid")}


# The fluid analytes that make a pattern abnormal (flagged "A"); the others are reported unflagged.
_FLUID_DRIVERS: dict[str, tuple[str, ...]] = {
    "exudate": ("2882-9", "60022-1"),
    "septic": ("26469-7", "17836-8"),
    "crystal": ("26469-7", "17836-8"),
}


def _fluid_interpretation(ctx: CaseContext, fluid: str, pattern: dict[str, Any], prior: Optional[list[dict[str, Any]]]) -> str:
    if fluid == "pleural":
        tp = float(_observation(ctx, "2885-2", prior)["value"]) * 10.0  # g/dL -> g/L
        ldh_uln = float((reference_range("14804-9", ctx.sex, ctx.age) or {"high": 200.0})["high"] or 200.0)
        ratio = pattern["protein_g_l"] / tp if tp else 0.0
        exudate = ratio > 0.5 or pattern["ldh"] > (2.0 / 3.0) * ldh_uln
        return (f"{'Exudate' if exudate else 'Transudate'} by Light's criteria (fluid/serum protein {ratio:.2f}; "
                f"fluid LDH {pattern['ldh']:.0f} U/L against two thirds of the serum upper limit {2 * ldh_uln / 3:.0f} U/L).")
    if fluid == "synovial":
        septic = pattern["wbc"] > 50.0
        return ("Synovial white count above 50,000/uL: septic arthritis likely until proven otherwise (Margaretten 2007)."
                if septic else "Inflammatory synovial fluid; crystals as reported.")
    return ""


# --------------------------------------------------------------------------- #
# Public API                                                                   #
# --------------------------------------------------------------------------- #
def resolve_order(
    case_state: dict[str, Any],
    order_code: str,
    sim_time_ms: int,
    *,
    prior: Optional[list[dict[str, Any]]] = None,
    seed: Optional[int] = None,
) -> dict[str, Any]:
    """Resolve one order into a fully provenanced result. Deterministic given ``seed``."""
    ctx = CaseContext(case_state, sim_time_ms, seed)
    ranges = load_ranges()
    order_code = str(order_code or "")
    base: dict[str, Any] = {
        "order_code": order_code, "sim_time_ms": ctx.sim_time_ms, "t_since_onset_h": round(ctx.t_h, 2),
        "condition_id": ctx.condition_id, "severity": round(ctx.severity, 2),
        "treatments_applied": [{"code": t.code, "t_h": round(t.t_h, 2), "amount": t.amount, "note": t.note} for t in ctx.treatments],
        "narrative": None,
        "meta": {"source": "engine", "seed": ctx.seed, "reference_ranges_version": ranges["generated_at"], "degraded": False, "is_synthetic_patient": True},
    }
    orderable = catalog.lab_orderable(order_code)
    if orderable is not None:
        base["orderable"] = {"code": orderable["code"], "loinc": orderable.get("loinc"), "label_en": orderable["label_en"],
                             "label_tr": orderable["label_tr"], "section": orderable["section"], "specimen": orderable["specimen"]}
    generator = orderable["generator"] if orderable else None
    if order_code in ECG_CODES:
        body = _resolve_ecg(ctx)
    elif generator == "csf":
        body = _resolve_csf(ctx, order_code, prior)
    elif generator == "body_fluid":
        body = _resolve_fluid(ctx, order_code, prior)
    elif order_code in MICRO_CODES:
        body = _resolve_micro(ctx, order_code)
    elif order_code in imaging_bank.ORDER_MODALITY:
        body = _resolve_imaging(ctx, order_code)
    elif order_code in ranges["panels"] or order_code in ranges["_by_loinc"]:
        loincs = ranges["panels"].get(order_code) or [canonical_loinc(order_code)]
        body = _lab_body(ctx, order_code, loincs, prior)
        if "882-1" in loincs:
            grp = next(o for o in body["observations"] if o["loinc"] == "882-1")
            grp["value"] = specimens.blood_group(ctx.seed)
            grp["flag"], grp["kinetics"] = "N", "seeded_patient_property"
            grp["interpretation"] = f"ABO and Rh group: {grp['value']}."
    else:
        body = {"kind": "unknown", "status": "unavailable", "reason": "order_code_not_in_catalog", "turnaround": _turnaround("chemistry")}
    base.update(body)
    base["available_at_ms"] = ctx.sim_time_ms + base["turnaround"]["ms"]
    if base["turnaround"].get("preliminary_ms") and "preliminary" not in base and base["kind"] == "imaging":
        base["preliminary"] = {"available_at_ms": ctx.sim_time_ms + base["turnaround"]["preliminary_ms"],
                               "text": "Preliminary read by the on-call radiologist; final report to follow."}
    return base


def supported_order_codes() -> dict[str, list[str]]:
    r = load_ranges()
    return {
        "lab": sorted(r["panels"].keys()),
        "imaging": sorted(c for c in imaging_bank.ORDER_MODALITY if c != "11524-6"),
        "ecg": ["11524-6"],
        "micro": sorted(MICRO_CODES.keys()),
        "specimen": sorted(o["code"] for o in catalog.lab_catalog()["orderables"] if o["generator"] in ("csf", "body_fluid")),
    }


def resolvable(code: str) -> bool:
    """True when the engine has a result path for an order code (no orphan orders)."""
    c = supported_order_codes()
    return any(code in v for v in c.values()) or code in load_ranges()["_by_loinc"]
