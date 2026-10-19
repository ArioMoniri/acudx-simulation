"""License-clean imaging bank index and resolver.

The bank (``imaging_bank.json``) is a curated, build-time verified index of real
medical images keyed by (modality, region, finding, laterality, view). Every
entry carries license, attribution, source page and a verification date; no
entry is synthetic. The resolver never touches the network: if nothing in the
bank fits, it returns ``status: "unavailable"`` with the structured findings
only, and the UI shows the report without a picture.

Laterality rule: an image whose side is known is never served for a finding on
the other side, and an image whose side is unknown is never served when the
case specifies a side. A finding without sidedness (``none``) ignores the rule.
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from typing import Any, Optional

BANK_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "imaging_bank.json")

# Order code -> (modality, region, default view). Covers web/src/domain/orderables.ts
# imaging codes and the LOINC-style imaging codes used by server/case_fixtures.py.
ORDER_MODALITY: dict[str, tuple[str, str, Optional[str]]] = {
    "cxr": ("xr", "chest", "PA"), "36643-5": ("xr", "chest", "PA"),
    "axr": ("xr", "abdomen", "AP"),
    "xr-extremity": ("xr", "extremity", None), "43468-8": ("xr", "extremity", None),
    "ct-head-noncon": ("ct", "head", "axial"), "30799-1": ("ct", "head", "axial"),
    "ct-cspine": ("ct", "cspine", "sagittal"),
    "ct-chest": ("ct", "chest", "axial"),
    "ctpa": ("ct", "chest", "axial-cta"), "36953-5": ("ct", "chest", "axial-cta"),
    "cta-chest": ("ct", "chest", "axial-cta"),
    "ct-aorta": ("ct", "aorta", "axial-cta"), "30746-2": ("ct", "aorta", "axial-cta"),
    "ct-abdo-pelvis": ("ct", "abdomen", "axial"), "42272-5": ("ct", "abdomen", "axial"),
    "ct-kub": ("ct", "abdomen", "axial"), "42274-1": ("ct", "abdomen", "axial"),
    "us-abdomen": ("us", "abdomen", None), "24558-9": ("us", "abdomen", None),
    "us-ruq": ("us", "biliary", None),
    "us-pelvis": ("us", "pelvis", None),
    "us-renal": ("us", "kidney", None),
    "us-dvt": ("us", "vascular-leg", None), "39150-9": ("us", "vascular-leg", None),
    "us-fast": ("us", "abdomen", None),
    "echo": ("echo", "heart", None), "34534-8": ("echo", "heart", None),
    "mri-brain": ("mri", "head", None),
    "mri-cspine": ("mri", "cspine", None),
    "mri-lspine": ("mri", "lspine", None), "24725-4": ("mri", "lspine", None),
    "mri-mrcp": ("mri", "biliary", None),
    "11524-6": ("ecg", "chest", "12-lead"),
}

SIDED = ("left", "right")


@lru_cache(maxsize=1)
def load_bank(path: str = BANK_PATH) -> dict[str, Any]:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def entries() -> list[dict[str, Any]]:
    return list(load_bank()["entries"])


def laterality_compatible(requested: Optional[str], entry_side: str) -> bool:
    """True when an entry may be shown for the requested side.

    - requested None/none/unspecified: any entry is acceptable.
    - requested left/right: entry must be the same side, or bilateral/none;
      an entry of the opposite side or of unknown side is refused.
    - requested bilateral: entry must be bilateral or none.
    """
    if requested in (None, "", "none", "unspecified"):
        return True
    if requested in SIDED:
        return entry_side == requested or entry_side in ("bilateral", "none")
    if requested == "bilateral":
        return entry_side in ("bilateral", "none")
    return False


def provenance(entry: dict[str, Any]) -> dict[str, Any]:
    text = f"Image: {entry['attribution']}, {entry['license']}, via Wikimedia Commons ({entry['source_page']})"
    if entry["source_bank"] != "wikimedia_commons":
        text = f"Image: {entry['attribution']}, {entry['license']} ({entry['source_page']})"
    return {
        "source_bank": entry["source_bank"],
        "source_page": entry["source_page"],
        "source_title": entry.get("source_title"),
        "license": entry["license"],
        "license_url": entry.get("license_url", ""),
        "attribution": entry["attribution"],
        "attribution_text": text,
        "verified_at": entry["verified_at"],
        "is_synthetic": bool(entry.get("is_synthetic", False)),
        "modifications": "none",
        "representative": True,
        "note": "Representative teaching image, not an image of the simulated patient.",
    }


def resolve(
    modality: Optional[str] = None,
    region: Optional[str] = None,
    finding: str = "normal",
    laterality: Optional[str] = None,
    view: Optional[str] = None,
    order_code: Optional[str] = None,
    condition_id: Optional[str] = None,
    findings: Optional[list[dict[str, Any]]] = None,
) -> dict[str, Any]:
    """Best bank match for a structured imaging request.

    Returns ``{"status": "ok", "entry": ..., "provenance": ..., "score": ...}``
    or ``{"status": "unavailable", "findings": [...], "reason": ...}``.
    """
    if order_code and order_code in ORDER_MODALITY:
        m, r, v = ORDER_MODALITY[order_code]
        modality = modality or m
        region = region or r
        view = view or v
    best: Optional[tuple[int, str, dict[str, Any]]] = None
    rejected_laterality = 0
    for e in entries():
        if modality and e["modality"] != modality:
            continue
        if finding and e["finding"] != finding:
            continue
        if not laterality_compatible(laterality, e["laterality"]):
            rejected_laterality += 1
            continue
        score = 4
        if order_code and order_code in e["order_codes"]:
            score += 3
        if condition_id and condition_id in e["conditions"]:
            score += 3
        if region and e["region"] == region:
            score += 2
        elif region:
            score -= 2
        if view and e["view"] == view:
            score += 1
        if laterality in SIDED and e["laterality"] == laterality:
            score += 1
        if e.get("local_path"):
            score += 1
        key = (score, e["id"])
        if best is None or key > (best[0], best[1]):
            best = (score, e["id"], e)
    if best is None or (region and best[2]["region"] != region and finding != "normal"):
        return {
            "status": "unavailable",
            "modality": modality, "region": region, "finding": finding, "laterality": laterality,
            "findings": findings or [],
            "reason": "laterality_mismatch" if rejected_laterality and best is None else "no_matching_entry",
        }
    e = best[2]
    return {"status": "ok", "score": best[0], "entry": e, "provenance": provenance(e), "findings": findings or []}


def catalog_coverage() -> dict[str, dict[str, bool]]:
    """For each order code: does the bank hold a normal study for its modality,
    and for its exact region? Used by tests and the architecture doc."""
    out: dict[str, dict[str, bool]] = {}
    for code, (m, r, _v) in ORDER_MODALITY.items():
        mod_normal = any(e["modality"] == m and e["finding"] == "normal" for e in entries())
        region_normal = any(e["modality"] == m and e["region"] == r and e["finding"] == "normal" for e in entries())
        out[code] = {"modality_normal": mod_normal, "region_normal": region_normal}
    return out
