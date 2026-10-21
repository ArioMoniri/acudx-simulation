"""Terminology routes: ICD-10-CM FY2027 and ICD-11 MMS 2026-01.

GET /v1/terminology/status                     releases, counts, licences, citation
GET /v1/terminology/icd10cm/search?q=&limit=   code prefix or words (index-term synonyms)
GET /v1/terminology/icd10cm/{code}             one code with its ancestor categories
GET /v1/terminology/icd11/search?q=&limit=     code prefix or title words, with the WHO URI
GET /v1/terminology/icd10cm/relate?committed=&target=   debrief scoring relation

Local index only (server/terminology/data, built by
scripts/terminology/build_terminology.py). When the ICD-11 file is absent the
search answers ``available: false`` with the WHO browser link instead.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query

from server.terminology import icd

router = APIRouter(tags=["terminology"])


@router.get("/v1/terminology/status")
async def terminology_status() -> Any:
    return icd.status()


@router.get("/v1/terminology/icd10cm/search")
async def icd10cm_search(q: str = Query(..., min_length=1, max_length=120), limit: int = Query(default=25, ge=1, le=100),
                         billable_only: bool = Query(default=False)) -> Any:
    idx = icd.icd10cm()
    if idx is None:
        return {"available": False, "results": [], "release": None}
    return {"available": True, "release": idx.meta.get("release"), "query": q,
            "results": idx.search(q, limit=limit, billable_only=billable_only)}


@router.get("/v1/terminology/icd10cm/relate")
async def icd10cm_relate(committed: str = Query(..., min_length=1, max_length=12), target: str = Query(..., min_length=1, max_length=12)) -> Any:
    return icd.relate_icd10(committed, target)


@router.get("/v1/terminology/icd10cm/{code}")
async def icd10cm_lookup(code: str) -> Any:
    idx = icd.icd10cm()
    hit = idx.lookup(code) if idx else None
    if hit is None:
        raise HTTPException(status_code=404, detail="code not in ICD-10-CM FY2027")
    hit["ancestors"] = [a for a in (idx.lookup(c) for c in icd.ancestors_icd10(code)) if a]
    return hit


@router.get("/v1/terminology/icd11/search")
async def icd11_search(q: str = Query(..., min_length=1, max_length=120), limit: int = Query(default=25, ge=1, le=100)) -> Any:
    idx = icd.icd11()
    if idx is None:
        return {"available": False, "results": [], "browser": "https://icd.who.int/browse/2026-01/mms/en"}
    return {"available": True, "release": idx.meta.get("release"), "citation": idx.meta.get("citation"), "query": q,
            "results": idx.search(q, limit=limit)}
