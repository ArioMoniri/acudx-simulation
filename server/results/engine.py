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

from server.results import ecg as ecg_mod
from server.results import imaging_bank
from server.results import kinetics as k
from server.results.kinetics import Treatment

RANGES_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "reference_ranges.json")
MS_PER_H = 3_600_000.0

# --------------------------------------------------------------------------- #
# Turnaround times (minutes) with sources.                                     #
# --------------------------------------------------------------------------- #
TURNAROUND: dict[str, dict[str, Any]] = {
    "poc": {"minutes": 5, "source": "Point-of-care analysers report within minutes; Hawkins RC, Laboratory turnaround time, Clin Biochem Rev 2007;28:179 (PMC1282400)"},
    "blood_gas": {"minutes": 10, "source": "Hawkins 2007 (PMC1282400): blood gas analysers are the fastest routine analytes"},
    "ecg": {"minutes": 10, "source": "ESC 2023 ACS guideline: 12-lead ECG acquired and interpreted within 10 min of first medical contact, doi 10.1093/eurheartj/ehad191"},
    "chemistry": {"minutes": 45, "source": "Hawkins 2007 (PMC1282400): ED median chemistry turnaround 40 to 60 min"},
    "haematology": {"minutes": 40, "source": "Hawkins 2007 (PMC1282400)"},
    "coagulation": {"minutes": 60, "source": "Hawkins 2007 (PMC1282400)"},
    "cardiac": {"minutes": 60, "source": "Fourth Universal Definition of MI 2018: troponin result within 60 min of blood draw, doi 10.1093/eurheartj/ehy462"},
    "inflammatory": {"minutes": 60, "source": "Hawkins 2007 (PMC1282400), routine immunoassay batch"},
    "toxicology": {"minutes": 90, "source": "Hawkins 2007 (PMC1282400), send-out immunoassay"},
    "endocrine": {"minutes": 120, "source": "Hawkins 2007 (PMC1282400), batch immunoassay"},
    "urine": {"minutes": 30, "source": "Hawkins 2007 (PMC1282400), dipstick plus microscopy"},
    "micro_prelim": {"minutes": 1440, "source": "Lamy B et al., How to optimize the use of blood cultures, Front Microbiol 2016;7:697 (doi 10.3389/fmicb.2016.00697): most positive cultures flag within 24 h"},
    "micro_final": {"minutes": 2880, "source": "MedlinePlus Urine culture (003751): results in 24 to 48 hours; blood culture final at 48 h or later"},
    "xr": {"minutes": 30, "source": "AcuDx convention, docs/00-overview/04 sense of time (web/src/domain/orderCatalog.ts)"},
    "ct": {"minutes": 60, "source": "AcuDx convention, docs/00-overview/04 sense of time"},
    "us": {"minutes": 45, "source": "AcuDx convention, docs/00-overview/04 sense of time"},
    "echo": {"minutes": 60, "source": "AcuDx convention, docs/00-overview/04 sense of time"},
    "mri": {"minutes": 120, "source": "AcuDx convention, docs/00-overview/04 sense of time"},
}

MICRO_CODES: dict[str, str] = {
    "blood-culture": "600-7", "urine-culture": "630-4", "sputum-culture": "sputum", "gram-stain": "gram",
    "resp-viral-panel": "rvp", "csf-studies": "csf", "hepatitis-panel": "hep", "hiv": "hiv", "monospot": "mono",
}


# --------------------------------------------------------------------------- #
# Reference ranges                                                             #
# --------------------------------------------------------------------------- #
@lru_cache(maxsize=1)
def load_ranges(path: str = RANGES_PATH) -> dict[str, Any]:
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    data["_by_loinc"] = {a["loinc"]: a for a in data["analytes"]}
    return data


def reference_range(loinc: str, sex: str = "any", age: int = 45) -> Optional[dict[str, Any]]:
    a = load_ranges()["_by_loinc"].get(loinc)
    if a is None or a.get("qualitative"):
        return None
    rows = a.get("ranges", [])
    pick = None
    for r in rows:
        if r["age_min"] <= age <= r["age_max"] and r["sex"] == sex:
            pick = r
            break
    if pick is None:
        for r in rows:
            if r["age_min"] <= age <= r["age_max"] and r["sex"] == "any":
                pick = r
                break
    if pick is None and rows:
        pick = rows[0]
    if pick is None:
        return None
    low, high = float(pick["low"]), float(pick["high"])
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
    if value < rr["low"]:
        flag = "L"
    elif value > rr["high"]:
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
    rr = reference_range(loinc, sex, age)
    if rr is None:
        return 0.0
    span = rr["high"] - rr["low"]
    u = _unit(seed, "baseline", loinc)
    return rr["low"] + span * (0.2 + 0.6 * u)


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
    "dka": {"onset_h": 12.0, "labs": {"2345-7": ("dka", "glucose"), "53060-9": ("dka", "ketones"), "1963-8": ("dka", "hco3"), "14627-4": ("dka", "hco3"), "1960-4": ("dka", "hco3"), "2744-1": ("dka", "ph"), "2746-6": ("dka", "ph_venous"), "2019-8": ("dka", "pco2"), "2021-4": ("dka", "pco2_venous"), "2823-3": ("dka", "potassium"), "2160-0": ("creatinine",), "2951-2": ("static", 133.0)}, "ua": "ketonuria", "ecg": "sinus_tachycardia"},
    "hhs": {"onset_h": 72.0, "labs": {"2345-7": ("static", 720.0), "2692-2": ("static", 345.0), "2951-2": ("static", 150.0), "2160-0": ("creatinine",), "53060-9": ("static", 0.8)}, "ecg": "sinus_tachycardia"},
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
        t_h = onset_h + float(item.get("at_ms", 0) or 0) / MS_PER_H
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
    traj = sorted((p for p in case_state.get("vitals_trajectory") or [] if isinstance(p, dict)), key=lambda p: p.get("atMs", 0))
    points = [{"atMs": 0, **base}] + [p for p in traj if p.get("atMs", 0) > 0]
    keys = ("hr", "systolic", "diastolic", "rr", "spo2", "tempC")
    out: dict[str, float] = {}
    for key in keys:
        series = [(p["atMs"], float(p[key])) for p in points if key in p and p[key] is not None]
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


class CaseContext:
    def __init__(self, case_state: dict[str, Any], sim_time_ms: int, seed: Optional[int]) -> None:
        self.case = case_state
        self.seed = seed if seed is not None else int(case_state.get("seed", 0) or 0)
        self.condition_id = condition_id_for(case_state)
        self.profile = CONDITION_PROFILES.get(self.condition_id or "", DEFAULT_PROFILE)
        demo = case_state.get("demographics") or {}
        self.sex = str(demo.get("sex", "any")).lower()
        if self.sex not in ("male", "female"):
            self.sex = "any"
        self.age = int(demo.get("age", 45) or 45)
        acuity = int(case_state.get("acuity_esi", 3) or 3)
        sev = (6 - max(1, min(5, acuity))) / 5.0
        cap = self.profile.get("severity_cap")
        self.severity = min(sev, cap) if cap is not None else sev
        self.onset_h = float(case_state.get("onset_h", self.profile.get("onset_h", DEFAULT_PROFILE["onset_h"])))
        self.sim_time_ms = int(sim_time_ms)
        self.t_h = self.onset_h + self.sim_time_ms / MS_PER_H
        self.treatments = map_treatments(case_state, self.onset_h)
        self.vitals = vitals_at(case_state, sim_time_ms)
        self.authored_labs = {str(lab.get("code")): lab for lab in case_state.get("labs") or [] if isinstance(lab, dict) and lab.get("code")}
        self.authored_imaging = [im for im in case_state.get("imaging") or [] if isinstance(im, dict)]
        self.weight_kg = float(demo.get("weight_kg", 70) or 70)


# --------------------------------------------------------------------------- #
# Analyte evaluation                                                           #
# --------------------------------------------------------------------------- #
def _model_value(ctx: CaseContext, loinc: str, spec: Optional[tuple], t_h: float) -> tuple[float, Optional[str]]:
    base = _baseline(loinc, ctx.sex, ctx.age, ctx.seed)
    if spec is None:
        return base, None
    kind = spec[0]
    tr = ctx.treatments
    sev = ctx.severity
    if kind == "troponin":
        assay = spec[1] or load_ranges()["_by_loinc"].get(loinc, {}).get("assay", "hs_ctnt")
        return k.troponin(assay, t_h, sev, tr, ctx.sex), "troponin"
    if kind == "lactate":
        return k.lactate(t_h, sev, tr), "lactate"
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


def _observation(ctx: CaseContext, loinc: str, prior: Optional[list[dict[str, Any]]]) -> dict[str, Any]:
    a = load_ranges()["_by_loinc"].get(loinc)
    if a is None:
        raise KeyError(loinc)
    spec = ctx.profile.get("labs", {}).get(loinc)
    authored = ctx.authored_labs.get(loinc)
    if a.get("qualitative"):
        value: Any = a["normal_value"]
        if authored is not None and isinstance(authored.get("value"), str):
            value = authored["value"]
        return {"loinc": loinc, "name": a["name"], "short": a.get("short"), "value": value, "unit": a.get("unit", ""), "qualitative": True,
                "ref_low": None, "ref_high": None, "flag": "A" if value != a["normal_value"] else "N", "critical": False,
                "interpretation": f"{a['name']}: {value}.", "delta": None, "kinetics": None, "ground_truth": authored is not None,
                "source": a["source"], "reviewed_at": a["reviewed_at"]}
    model_now, kin = _model_value(ctx, loinc, spec, ctx.t_h)
    ground_truth = False
    if authored is not None and isinstance(authored.get("value"), (int, float)):
        ground_truth = True
        authored_value = float(authored["value"])
        if kin is not None:
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
    "ketonuria": {"5797-1": "Large", "5792-7": "Positive (3+)", "5811-5": "1.032"},
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


def _tat_category(loincs: list[str], order_code: str) -> str:
    if order_code in ("poc-glucose", "istat"):
        return "poc"
    cats = {load_ranges()["_by_loinc"][l]["category"] for l in loincs if l in load_ranges()["_by_loinc"]}
    if cats == {"blood_gas"} or order_code in ("vbg", "abg"):
        return "blood_gas"
    for c in ("toxicology", "endocrine", "cardiac", "inflammatory", "coagulation", "urine", "haematology"):
        if c in cats:
            return c
    return "chemistry"


def _turnaround(category: str) -> dict[str, Any]:
    t = TURNAROUND[category]
    return {"category": category, "minutes": t["minutes"], "ms": t["minutes"] * 60_000, "source": t["source"]}


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
    tat_key = {"xr": "xr", "ct": "ct", "us": "us", "echo": "echo", "mri": "mri", "ecg": "ecg"}[modality]
    return {
        "kind": "imaging", "status": "ok" if image else "unavailable",
        "report": {"modality": modality, "region": region, "finding": finding, "laterality": lat, "findings": structured,
                   "impression": impression, "ground_truth": authored is not None,
                   "image": image, "provenance": hit.get("provenance"), "image_status": hit["status"], "image_reason": hit.get("reason")},
        "turnaround": _turnaround(tat_key),
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


def _resolve_micro(ctx: CaseContext, order_code: str) -> dict[str, Any]:
    key = MICRO_CODES[order_code]
    micro = ctx.profile.get("micro", {})
    organism, p = micro.get(key, (None, 0.0))
    abx_before = any(t.code == "antibiotics" and t.t_h <= ctx.t_h for t in ctx.treatments)
    if abx_before and organism:
        p *= 0.5  # cultures drawn after antibiotics lose sensitivity (Lamy 2016)
    positive = organism is not None and _unit(ctx.seed, "micro", order_code) < p
    if key in ("rvp", "csf", "hep", "hiv", "mono", "gram"):
        result = organism if positive else ("Not detected" if key in ("rvp", "hiv", "hep", "mono") else "No organisms seen" if key == "gram" else "Clear CSF: WBC 2/uL, protein 0.35 g/L, glucose 3.6 mmol/L")
        tat = "urine" if key in ("gram", "csf") else "inflammatory"
    else:
        result = f"Growth: {organism}" if positive else ("No growth at 48 h" if key in ("600-7", "sputum") else "No significant growth")
        tat = "micro_final"
    loinc = key if key in ("600-7", "630-4") else None
    a = load_ranges()["_by_loinc"].get(loinc or "", {})
    return {
        "kind": "micro", "status": "ok",
        "observations": [{"loinc": loinc or order_code, "name": a.get("name", order_code), "short": a.get("short", order_code), "value": result, "unit": "", "qualitative": True,
                          "ref_low": None, "ref_high": None, "flag": "A" if positive else "N", "critical": bool(positive and key == "600-7"),
                          "interpretation": ("Positive culture; correlate with clinical picture and sensitivities." if positive else "No pathogen identified."),
                          "delta": None, "kinetics": None, "ground_truth": False,
                          "source": a.get("source", "https://doi.org/10.3389/fmicb.2016.00697"), "reviewed_at": a.get("reviewed_at", "2026-10-19"),
                          "note": "Drawn after antibiotics: sensitivity reduced." if abx_before and organism else None}],
        "turnaround": _turnaround(tat),
    }


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
    base: dict[str, Any] = {
        "order_code": order_code, "sim_time_ms": ctx.sim_time_ms, "t_since_onset_h": round(ctx.t_h, 2),
        "condition_id": ctx.condition_id, "severity": round(ctx.severity, 2),
        "treatments_applied": [{"code": t.code, "t_h": round(t.t_h, 2), "amount": t.amount, "note": t.note} for t in ctx.treatments],
        "narrative": None,
        "meta": {"source": "engine", "seed": ctx.seed, "reference_ranges_version": ranges["generated_at"], "degraded": False, "is_synthetic_patient": True},
    }
    if order_code == "11524-6":
        body = _resolve_ecg(ctx)
    elif order_code in imaging_bank.ORDER_MODALITY:
        body = _resolve_imaging(ctx, order_code)
    elif order_code in MICRO_CODES:
        body = _resolve_micro(ctx, order_code)
    elif order_code in ranges["panels"] or order_code in ranges["_by_loinc"]:
        loincs = ranges["panels"].get(order_code) or [order_code]
        observations = [_observation(ctx, l, prior) for l in loincs]
        if order_code == "ua":
            _apply_ua_pattern(ctx, observations)
        body = {"kind": "lab", "status": "ok", "observations": observations,
                "abnormal": any(o["flag"] != "N" for o in observations), "critical": any(o["critical"] for o in observations),
                "turnaround": _turnaround(_tat_category(loincs, order_code))}
    else:
        body = {"kind": "unknown", "status": "unavailable", "reason": "order_code_not_in_catalog", "turnaround": _turnaround("chemistry")}
    base.update(body)
    base["available_at_ms"] = ctx.sim_time_ms + base["turnaround"]["ms"]
    return base


def supported_order_codes() -> dict[str, list[str]]:
    r = load_ranges()
    return {
        "lab": sorted(r["panels"].keys()),
        "imaging": sorted(c for c in imaging_bank.ORDER_MODALITY if c != "11524-6"),
        "ecg": ["11524-6"],
        "micro": sorted(MICRO_CODES.keys()),
    }
