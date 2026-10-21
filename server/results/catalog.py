"""Order catalogues (labs and imaging) and report turnaround, with sources.

* ``lab_catalog.json``: every orderable lab test with its LOINC order code, member
  analytes (each with a sourced interval in ``reference_ranges.json``), specimen,
  turnaround class and result generator.
* ``imaging_catalog.json``: imaging procedures with LOINC radiology codes and the
  LOINC/RSNA Radiology Playbook attributes (modality, body part, contrast), mapped
  to the imaging bank by modality and region.
* ``TURNAROUND``: minutes from order to report per class. ``basis`` says whether a
  figure is a measured median from a cited study, a guideline target, or an AcuDx
  teaching convention (named as such, never presented as measured).

Every LOINC code here is checked against LOINC 2.82 by
``scripts/terminology/build_terminology.py loinc`` (server/terminology/data/loinc-verified.json).
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from typing import Any, Optional

HERE = os.path.dirname(os.path.abspath(__file__))
LAB_PATH = os.path.join(HERE, "lab_catalog.json")
IMAGING_PATH = os.path.join(HERE, "imaging_catalog.json")

_LAB_TAT = "BMC Emerg Med 2022 retrospective cohort of 23,718 ED visits (doi 10.1186/s12873-022-00763-w): median ED laboratory turnaround 51.1 min (IQR 41.1 to 65.0) for a standard panel"
_CONVENTION = "AcuDx teaching convention (not a measured figure); laboratory practice varies"

TURNAROUND: dict[str, dict[str, Any]] = {
    # Point of care and bedside
    "poc": {"minutes": 5, "basis": "convention", "source": "Hawkins RC. Laboratory turnaround time. Clin Biochem Rev 2007;28:179-194 (PMC2282400): point-of-care testing removes transport and queueing; " + _CONVENTION},
    "blood_gas": {"minutes": 10, "basis": "convention", "source": "Hawkins 2007 (PMC2282400): blood gas analysers are near-patient; " + _CONVENTION},
    "ecg": {"minutes": 10, "basis": "guideline", "source": "ESC 2023 ACS guideline: 12-lead ECG acquired and interpreted within 10 min of first medical contact, doi 10.1093/eurheartj/ehad191"},
    # Core laboratory (stat)
    "chemistry": {"minutes": 50, "basis": "measured", "source": _LAB_TAT},
    "haematology": {"minutes": 45, "basis": "measured", "source": _LAB_TAT},
    "coagulation": {"minutes": 55, "basis": "measured", "source": _LAB_TAT},
    "inflammatory": {"minutes": 55, "basis": "measured", "source": _LAB_TAT},
    "urine": {"minutes": 45, "basis": "measured", "source": _LAB_TAT},
    "cardiac": {"minutes": 60, "basis": "guideline", "source": "Fourth Universal Definition of MI 2018: troponin result within 60 min of blood draw, doi 10.1093/eurheartj/ehy462"},
    "toxicology": {"minutes": 60, "basis": "convention", "source": _CONVENTION},
    "endocrine": {"minutes": 120, "basis": "convention", "source": "Same-day immunoassay batch; " + _CONVENTION},
    "blood_bank": {"minutes": 60, "basis": "convention", "source": "Type and screen with antibody screen; " + _CONVENTION},
    "send_out": {"minutes": 2880, "basis": "convention", "source": "Reference-laboratory test, reported in 1 to 3 days; " + _CONVENTION},
    "serology": {"minutes": 120, "basis": "convention", "source": "In-house automated immunoassay; " + _CONVENTION},
    "molecular": {"minutes": 120, "basis": "convention", "source": "Rapid multiplex NAAT run in the core laboratory; " + _CONVENTION},
    "antigen_rapid": {"minutes": 20, "basis": "convention", "source": "Lateral-flow antigen test read at 15 min; " + _CONVENTION},
    "antigen_lab": {"minutes": 120, "basis": "convention", "source": _CONVENTION},
    "gram": {"minutes": 60, "basis": "convention", "source": _CONVENTION},
    "afb": {"minutes": 1440, "basis": "convention", "source": "Auramine or Ziehl-Neelsen smear batch; " + _CONVENTION},
    "csf": {"minutes": 60, "preliminary_minutes": None, "basis": "convention",
            "source": "Cell count, protein, glucose and Gram stain on a stat CSF; culture final at 48 h (MedlinePlus CSF culture 003769); " + _CONVENTION,
            "culture_final_minutes": 2880},
    "body_fluid": {"minutes": 60, "basis": "convention", "source": "Fluid chemistry and cell count; culture final at 48 h; " + _CONVENTION, "culture_final_minutes": 2880},
    # Microbiology with preliminary reports
    "micro_culture": {"minutes": 2880, "preliminary_minutes": 1440, "basis": "measured",
                      "source": "MedlinePlus Urine culture (003751): results in 24 to 48 hours; preliminary growth report at 24 h"},
    "blood_culture": {"minutes": 7200, "preliminary_minutes": 1440, "positive_final_minutes": 2880, "basis": "measured",
                      "source": ("Lamy B et al., Front Microbiol 2016;7:697 (doi 10.3389/fmicb.2016.00697): most positive cultures flag within 24 h; "
                                 "standard incubation 5 days before a culture is reported negative (Eur J Clin Microbiol Infect Dis 2021, doi 10.1007/s10096-021-04248-9)")},
    # Imaging report (order to report)
    "xr": {"minutes": 60, "basis": "measured", "source": "Emerg Radiol 2021 (doi 10.1007/s10140-020-01803-3): median ED radiology department turnaround 70 min before and 36 min after a Lean intervention"},
    "xr_portable": {"minutes": 45, "basis": "convention", "source": "Bedside portable film, no transport; " + _CONVENTION},
    "ct_head": {"minutes": 85, "basis": "measured", "source": "Emerg Radiol 2024 (doi 10.1007/s10140-024-02273-7): non-contrast CT head order to final report 1.41 h"},
    "ct": {"minutes": 250, "preliminary_minutes": 125, "basis": "measured",
           "source": ("AMIA Annu Symp Proc 2018 (PMC6371246): ED CT order to final report median 4.2 h; CJEM 2015 (doi 10.2310/8000.2013.131235): "
                      "preliminary report median 2.05 to 2.40 h for CT or ultrasound of the abdomen and pelvis")},
    "cta": {"minutes": 230, "preliminary_minutes": 125, "basis": "measured",
            "source": "Emerg Radiol 2024 (doi 10.1007/s10140-024-02273-7): CTA head and neck order to final report 3.86 h; preliminary per CJEM 2015"},
    "us": {"minutes": 165, "preliminary_minutes": 125, "basis": "measured",
           "source": "CJEM 2015 (doi 10.2310/8000.2013.131235): ED ultrasound or CT preliminary report median 2.05 h, final 2.75 h"},
    "us_routine": {"minutes": 1440, "basis": "convention", "source": "Non-urgent outpatient-style study booked for the next list; " + _CONVENTION},
    "pocus": {"minutes": 10, "basis": "convention", "source": "Bedside point-of-care ultrasound read by the treating clinician on completion; " + _CONVENTION},
    "echo": {"minutes": 240, "basis": "convention", "source": "Formal transthoracic echocardiogram, same day; " + _CONVENTION},
    "mri": {"minutes": 370, "basis": "measured", "source": "Emerg Radiol 2024 (doi 10.1007/s10140-024-02273-7): conventional MRI order to final report 6.14 h"},
}


def turnaround(key: str, *, positive: Optional[bool] = None) -> dict[str, Any]:
    """Turnaround block for a class: final minutes/ms, optional preliminary, source, basis."""
    t = TURNAROUND[key]
    minutes = int(t["minutes"])
    if positive and t.get("positive_final_minutes"):
        minutes = int(t["positive_final_minutes"])
    out: dict[str, Any] = {"category": key, "minutes": minutes, "ms": minutes * 60_000, "source": t["source"], "basis": t["basis"]}
    pre = t.get("preliminary_minutes")
    if pre:
        out["preliminary_minutes"] = int(pre)
        out["preliminary_ms"] = int(pre) * 60_000
    return out


@lru_cache(maxsize=1)
def lab_catalog() -> dict[str, Any]:
    with open(LAB_PATH, encoding="utf-8") as fh:
        data = json.load(fh)
    data["_by_code"] = {o["code"]: o for o in data["orderables"]}
    return data


@lru_cache(maxsize=1)
def imaging_catalog() -> dict[str, Any]:
    with open(IMAGING_PATH, encoding="utf-8") as fh:
        data = json.load(fh)
    by_code: dict[str, dict[str, Any]] = {}
    for p in data["procedures"]:
        by_code[p["code"]] = p
    aliases: dict[str, str] = {}
    for p in data["procedures"]:
        for c in [p.get("loinc"), *p.get("legacy_codes", [])]:
            if c and c not in by_code and c not in aliases:
                aliases[c] = p["code"]
    data["_by_code"] = by_code
    data["_aliases"] = aliases
    return data


def lab_orderable(code: str) -> Optional[dict[str, Any]]:
    return lab_catalog()["_by_code"].get(code)


def imaging_procedure(code: str) -> Optional[dict[str, Any]]:
    cat = imaging_catalog()
    return cat["_by_code"].get(code) or cat["_by_code"].get(cat["_aliases"].get(code, ""))


def order_modality_map() -> dict[str, tuple[str, str, Optional[str]]]:
    """Order code (catalogue code, LOINC and legacy codes) -> (modality, region, view)."""
    cat = imaging_catalog()
    out: dict[str, tuple[str, str, Optional[str]]] = {}
    for p in cat["procedures"]:
        out[p["code"]] = (p["modality"], p["region"], p.get("view"))
    for alias, code in cat["_aliases"].items():
        p = cat["_by_code"][code]
        out[alias] = (p["modality"], p["region"], p.get("view"))
    return out


def public_catalog() -> dict[str, Any]:
    """The catalogue as the web order-entry surface needs it (no private keys)."""
    lab = lab_catalog()
    img = imaging_catalog()
    labs = [{k: o[k] for k in ("code", "loinc", "label_en", "label_tr", "section", "specimen", "members", "turnaround", "generator", "synonyms")}
            | {"turnaround_minutes": TURNAROUND[o["turnaround"]]["minutes"],
               "preliminary_minutes": TURNAROUND[o["turnaround"]].get("preliminary_minutes")} for o in lab["orderables"]]
    imaging = [{k: p[k] for k in ("code", "loinc", "label_en", "label_tr", "modality", "region", "playbook", "laterality_required", "turnaround", "synonyms")}
               | {"turnaround_minutes": TURNAROUND[p["turnaround"]]["minutes"],
                  "preliminary_minutes": TURNAROUND[p["turnaround"]].get("preliminary_minutes")} for p in img["procedures"]]
    return {"schema_version": 1, "reviewed_at": lab["reviewed_at"], "sections": lab["sections"], "labs": labs, "imaging": imaging,
            "turnaround": {k: {kk: v for kk, v in t.items()} for k, t in TURNAROUND.items()}}
