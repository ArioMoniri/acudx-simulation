"""Specimen-specific result generators: CSF, body fluids, blood group, microbiology.

These orderables cannot be produced by sampling a serum reference interval:

* CSF and body fluids depend on what the condition does to that compartment, and a
  pleural, ascitic or synovial fluid result exists only when the patient has that
  fluid to sample (no effusion: "no specimen obtainable", never an invented tap);
* the ABO/Rh group is a fixed property of the synthetic patient (seeded);
* cultures, smears, antigen, serology and NAAT results come from the condition
  profile (organism and probability), with a preliminary report for cultures.

Interpretive thresholds carry their sources: Light RW 1972 (pleural exudate,
doi 10.7326/0003-4819-77-4-507), AASLD 2021 ascites guidance (PMN 250/mm3, SAAG
1.1 g/dL; doi 10.1002/hep.31884), Margaretten 2007 (synovial WBC above 50,000/uL,
doi 10.1001/jama.297.13.1478). The abnormal compartment values below are the
condition profile of the case model, labelled as such (kinetics "specimen_profile").
"""

from __future__ import annotations

import hashlib
from typing import Any, Optional


def _unit(seed: Any, *parts: Any) -> float:
    h = hashlib.sha256("|".join(str(p) for p in (seed, *parts)).encode()).digest()
    return int.from_bytes(h[:8], "big") / 2 ** 64


# --------------------------------------------------------------------------- #
# CSF                                                                          #
# --------------------------------------------------------------------------- #
# Condition -> CSF pattern. Values: WBC /uL, RBC /uL, protein mg/dL, glucose mg/dL,
# Gram stain text, culture text, predominant cell.
CSF_PATTERNS: dict[str, dict[str, Any]] = {
    "bacterial_meningitis": {"wbc": 2400, "rbc": 0, "protein": 210, "glucose": 25, "gram": "Gram-positive diplococci",
                             "culture": "Streptococcus pneumoniae", "cells": "neutrophil predominant", "p": 0.9},
    "meningococcemia": {"wbc": 1800, "rbc": 0, "protein": 180, "glucose": 30, "gram": "Gram-negative diplococci",
                        "culture": "Neisseria meningitidis", "cells": "neutrophil predominant", "p": 0.7},
    "encephalitis": {"wbc": 85, "rbc": 40, "protein": 75, "glucose": 62, "gram": None, "culture": None,
                     "cells": "lymphocyte predominant", "p": 1.0},
    "subarachnoid_hemorrhage": {"wbc": 60, "rbc": 45000, "protein": 90, "glucose": 65, "gram": None, "culture": None,
                                "cells": "red cells in all tubes; xanthochromia", "p": 1.0},
}

# Fluid -> condition -> pattern. A fluid is obtainable only when listed here.
FLUID_PATTERNS: dict[str, dict[str, dict[str, Any]]] = {
    "pleural": {
        "pleural_effusion": {"protein_g_l": 46, "ldh": 320, "glucose": 82, "ph": 7.38, "wbc": 2.4, "kind": "exudate"},
        "pneumonia_cap": {"protein_g_l": 44, "ldh": 410, "glucose": 70, "ph": 7.32, "wbc": 6.8, "kind": "exudate", "requires_effusion": True},
        "heart_failure_acute": {"protein_g_l": 18, "ldh": 95, "glucose": 110, "ph": 7.46, "wbc": 0.6, "kind": "transudate"},
    },
    "ascites": {},
    "synovial": {
        "septic_arthritis": {"wbc": 85.0, "pmn": 92, "crystals": "None seen", "gram": "Gram-positive cocci in clusters",
                             "culture": "Staphylococcus aureus", "kind": "septic"},
        "gout": {"wbc": 18.0, "pmn": 75, "crystals": "Needle-shaped, negatively birefringent monosodium urate crystals",
                 "gram": None, "culture": None, "kind": "crystal"},
    },
}

NO_SPECIMEN = {
    "pleural": "No pleural fluid to sample: the patient has no pleural effusion on examination or imaging.",
    "ascites": "No ascitic fluid to sample: the patient has no ascites on examination or imaging.",
    "synovial": "No joint effusion to aspirate in this patient.",
}

GRAM_BY_ORGANISM = {
    "Streptococcus pneumoniae": "Gram-positive diplococci",
    "Staphylococcus aureus": "Gram-positive cocci in clusters",
    "Escherichia coli": "Gram-negative rods",
    "Pseudomonas aeruginosa": "Gram-negative rods",
    "Neisseria meningitidis": "Gram-negative diplococci",
    "Klebsiella pneumoniae": "Gram-negative rods",
}


def gram_for(organism: Optional[str]) -> Optional[str]:
    if not organism:
        return None
    for name, gram in GRAM_BY_ORGANISM.items():
        if name.lower() in organism.lower():
            return gram
    return None


# --------------------------------------------------------------------------- #
# Blood group                                                                  #
# --------------------------------------------------------------------------- #
# US blood type frequencies (Stanford Blood Center, "Blood types",
# https://stanfordbloodcenter.org/donate-blood/blood-donation-facts/blood-types/,
# accessed 2026-10-21), used only to pick a plausible group for a synthetic patient.
_ABO_RH = [("O", "positive", 0.374), ("O", "negative", 0.066), ("A", "positive", 0.357), ("A", "negative", 0.063),
           ("B", "positive", 0.085), ("B", "negative", 0.015), ("AB", "positive", 0.034), ("AB", "negative", 0.006)]


def blood_group(seed: Any) -> str:
    u = _unit(seed, "abo") * sum(p for _g, _r, p in _ABO_RH)
    acc = 0.0
    group, rh = "O", "positive"
    for g, r, p in _ABO_RH:
        acc += p
        if u < acc:
            group, rh = g, r
            break
    return f"Group {group}, Rh(D) {rh}"


# --------------------------------------------------------------------------- #
# Microbiology keys                                                            #
# --------------------------------------------------------------------------- #
# Order code -> micro key (profiles name the key; see engine CONDITION_PROFILES).
MICRO_CODES: dict[str, str] = {
    "blood-culture": "600-7", "urine-culture": "630-4", "sputum-culture": "sputum", "gram-stain": "gram",
    "resp-viral-panel": "rvp", "covid-pcr": "covid", "hepatitis-panel": "hep", "hbv-serology": "hbv", "hiv": "hiv", "monospot": "mono",
    "malaria-film": "malaria", "malaria-rdt": "malaria_rdt", "wound-culture": "wound", "throat-culture": "throat",
    "stool-culture": "stool", "cdiff": "cdiff", "afb-smear": "afb", "strep-a": "strep", "legionella-ag": "legionella",
    "pneumococcal-ag": "pneumo_ag", "igra": "igra", "syphilis": "syphilis",
}

CULTURE_KEYS = {"600-7", "630-4", "sputum", "wound", "throat", "stool"}

# Member analyte a positive profile result lands on, by words in the profile text.
MEMBER_BY_TEXT: dict[str, list[tuple[str, str]]] = {
    "rvp": [("influenza a", "92142-9"), ("influenza b", "92141-1"), ("sars-cov-2", "94500-6"), ("rsv", "92131-2"), ("respiratory syncytial", "92131-2")],
    "covid": [("sars-cov-2", "94500-6")],
    "hep": [("hepatitis a", "13950-1"), ("hepatitis b", "31204-1"), ("hepatitis c", "13955-0")],
    "hbv": [("surface antigen", "5196-1"), ("core", "16933-4"), ("surface antibody", "22322-2")],
    "syphilis": [("rpr", "20507-0"), ("treponem", "47236-5"), ("syphilis", "47236-5")],
}

# Positive values a member reports when the profile's organism text matches it.
POSITIVE_WORD = {"Not detected": "Detected", "Negative": "Positive", "Non-reactive": "Reactive"}


def culture_preliminary(key: str, positive: bool, organism: Optional[str]) -> str:
    if key == "600-7":
        if positive:
            gram = gram_for(organism) or "Organisms seen"
            return f"Positive: aerobic bottle flagged; Gram stain: {gram}. Identification and susceptibilities to follow."
        return "No growth to date at 24 hours; incubation continues to 5 days."
    if positive:
        return "Growth detected; identification and susceptibilities to follow."
    return "No growth to date at 24 hours."
