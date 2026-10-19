"""Guideline anchors by id only (the ``ground`` node).

A generated case may carry guideline anchors only when each one is a
``GuidelineStatement`` record that exists in ``server.guidelines_seed``,
referenced by its ``id``. Free-text anchors from the author are discarded; the
author may *propose* ids from the candidate list it was shown, and this module
keeps the ones that resolve and adds deterministic matches for the condition.
"""

from __future__ import annotations

import re
from functools import lru_cache
from typing import Any

from server.guidelines_seed import all_statements, has_citation

# Catalog system -> seed domains worth searching (sepsis and toxicology are
# cross-cutting domains in the seed corpus).
_DOMAIN_AFFINITY: dict[str, tuple[str, ...]] = {
    "emergency": ("emergency", "sepsis", "cardiology", "neurology", "pulmonology", "toxicology"),
    "cardiology": ("cardiology",),
    "pulmonology": ("pulmonology",),
    "gastroenterology": ("gastroenterology",),
    "neurology": ("neurology",),
    "infectious": ("infectious", "sepsis", "neurology"),
    "endocrine": ("endocrine",),
    "renal": ("renal", "endocrine"),
    "psychiatry": ("psychiatry", "toxicology"),
    "hematology": ("hematology",),
    "obstetrics-gynecology": ("obstetrics-gynecology",),
    "musculoskeletal": ("toxicology", "infectious"),
}

# Explicit condition -> topic hints where token overlap alone is too weak.
_TOPIC_HINTS: dict[str, tuple[str, ...]] = {
    "acs_stemi": ("acs_stemi_reperfusion", "acs_dual_antiplatelet", "acs_oxygen_threshold", "acs_chest_pain_ecg_timing"),
    "acs_nstemi": ("nstemi_hs_troponin_pathway", "acs_dual_antiplatelet", "acs_chest_pain_ecg_timing"),
    "unstable_angina": ("nstemi_hs_troponin_pathway", "acs_chest_pain_ecg_timing"),
    "undiff_chest_pain": ("acs_chest_pain_ecg_timing", "nstemi_hs_troponin_pathway"),
    "septic_shock": ("sepsis_antibiotics_timing", "sepsis_fluid_resuscitation", "sepsis_lactate_guided_resuscitation"),
    "sepsis_uncomplicated": ("sepsis_antibiotics_timing", "sepsis_early_recognition_tr"),
    "febrile_neutropenia": ("neutropenic_sepsis_management", "sepsis_antibiotics_timing"),
    "heart_failure_acute": ("acute_heart_failure_management",),
    "afib_rvr": ("atrial_fibrillation_acute",),
    "undiff_headache": ("headache_red_flags", "subarachnoid_haemorrhage_ct_timing"),
    "subarachnoid_hemorrhage": ("subarachnoid_haemorrhage_ct_timing", "subarachnoid_haemorrhage_lp_timing", "headache_red_flags"),
    "intracerebral_hemorrhage": ("intracerebral_haemorrhage_management",),
    "ischemic_stroke": ("ischaemic_stroke_reperfusion", "acute_stroke_recognition_tr"),
    "tia": ("acute_stroke_recognition_tr",),
    "pneumonia_cap": ("pneumonia_severity_assessment",),
    "tension_pneumothorax": ("pneumothorax_management",),
    "spontaneous_pneumothorax": ("pneumothorax_management",),
    "copd_exacerbation": ("copd_exacerbation_management",),
    "asthma_exacerbation": ("acute_asthma_management",),
    "upper_gi_bleed": ("upper_gi_bleed_management",),
    "ascending_cholangitis": ("ascending_cholangitis_management",),
    "pancreatitis": ("acute_pancreatitis_management",),
    "appendicitis": ("acute_abdomen_initial_management",),
    "perforated_ulcer": ("acute_abdomen_initial_management",),
    "bowel_obstruction": ("acute_abdomen_initial_management",),
    "undiff_abdo_pain": ("acute_abdomen_initial_management",),
    "hyperkalemia": ("hyperkalaemia_emergency",),
    "hyperkalemia_esrd": ("hyperkalaemia_emergency",),
    "aki": ("acute_kidney_injury_management",),
    "paracetamol_od": ("paracetamol_overdose_management",),
    "opioid_overdose": ("opioid_overdose_management",),
    "suicidal_ideation": ("self_harm_risk_assessment",),
    "delirium_tremens": ("alcohol_withdrawal_management",),
    "sickle_crisis": ("sickle_cell_crisis_management",),
    "eclampsia": ("preeclampsia_eclampsia_management",),
    "anaphylaxis": ("anaphylaxis_management",),
    "cardiac_tamponade": ("cardiac_tamponade_management",),
}

_SPLIT = re.compile(r"[^a-z0-9]+")


def _tokens(text: str) -> set[str]:
    norm = text.lower().replace("haem", "hem").replace("oe", "e").replace("ae", "e")
    return {t for t in _SPLIT.split(norm) if len(t) > 2 and t not in ("acute", "management", "the", "and", "with", "undiff")}


@lru_cache(maxsize=1)
def statement_index() -> dict[str, dict[str, Any]]:
    """All seed statements by id (only those passing the citation gate)."""
    return {s["id"]: s for s in all_statements() if has_citation(s)}


def candidate_ids(cond: dict[str, Any], limit: int = 8) -> list[str]:
    """Statement ids plausibly relevant to a condition, best first."""
    index = statement_index()
    domains = set(_DOMAIN_AFFINITY.get(str(cond.get("system") or ""), ()))
    hints = _TOPIC_HINTS.get(str(cond.get("id") or ""), ())
    cond_tokens = _tokens(f"{cond.get('id', '')} {cond.get('label_en', '')}")
    scored: list[tuple[float, str]] = []
    for sid, st in index.items():
        score = 0.0
        if st.get("topic") in hints:
            score += 10.0 - hints.index(st["topic"]) * 0.1
        if st.get("domain") in domains:
            score += 1.0
        overlap = cond_tokens & _tokens(str(st.get("topic") or ""))
        score += 2.0 * len(overlap)
        if score > 1.0:  # a bare domain match is not enough on its own
            scored.append((score, sid))
    scored.sort(key=lambda t: (-t[0], t[1]))
    return [sid for _, sid in scored[:limit]]


def anchor_from_statement(st: dict[str, Any]) -> dict[str, Any]:
    body = st.get("statement") or {}
    cite = st.get("citation") or {}
    return {
        "statement_id": st["id"],
        "statement_en": body.get("en", "") if isinstance(body, dict) else str(body),
        "statement_tr": body.get("tr", "") if isinstance(body, dict) else str(body),
        "source": str(st.get("council") or cite.get("body") or ""),
        "citation": str(cite.get("url") or st.get("url") or ""),
        "title": str(cite.get("title") or ""),
        "reference": str(cite.get("reference") or ""),
    }


def resolve_anchors(proposed_ids: list[Any], cond: dict[str, Any], *, limit: int = 3) -> tuple[list[dict[str, Any]], list[str]]:
    """Keep proposed ids that exist, then top deterministic candidates.

    Returns ``(anchors, dropped_ids)``. Never fabricates an anchor."""
    index = statement_index()
    kept: list[str] = []
    dropped: list[str] = []
    for pid in proposed_ids or []:
        sid = str(pid).strip()
        if sid in index and sid not in kept:
            kept.append(sid)
        elif sid:
            dropped.append(sid)
    for sid in candidate_ids(cond):
        if len(kept) >= limit:
            break
        if sid not in kept:
            kept.append(sid)
    return [anchor_from_statement(index[sid]) for sid in kept[:limit]], dropped
