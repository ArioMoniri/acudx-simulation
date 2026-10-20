"""FastAPI routes for the verified guideline store.

Learner surface (verified statements ONLY):
    GET /v1/guidelines/statements?condition=&stage=&locale=
    GET /v1/guidelines/statements/{id}
    GET /v1/guidelines/tips?condition=&stage=&locale=

Admin surface:
    POST /admin/guidelines/verify   body {"ids": [...]?, "all": bool?}
        protected by the X-Admin-Token header compared with env ADMIN_TOKEN using
        secrets.compare_digest; 503 when ADMIN_TOKEN is unset; 401 on mismatch.
        Under AIRGAPPED the verifier must not egress, so the run is refused with 409 unless
        ACUDX_VERIFIER_ALLOW_EGRESS=1 (verification is a clock-3 batch job, not a model call).

Mounted in server/app.py with ``app.include_router(guidelines_router)``.
"""

from __future__ import annotations

import os
import secrets
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from server.guidelines import tips as tips_mod
from server.guidelines.store import GuidelineStore, get_store

router = APIRouter()


def _store(request: Request) -> GuidelineStore:
    store = getattr(request.app.state, "guideline_store", None)
    return store if isinstance(store, GuidelineStore) else get_store()


def _locale(locale: Optional[str]) -> str:
    return "tr" if (locale or "").strip().lower().startswith("tr") else "en"


# --------------------------------------------------------------------------- #
# Learner routes                                                              #
# --------------------------------------------------------------------------- #
@router.get("/v1/guidelines/statements")
async def list_statements(
    request: Request,
    condition: Optional[str] = Query(default=None, description="ICD-10 code, catalog id or label"),
    stage: Optional[str] = Query(default=None, description="triage|history|exam|workup|treatment|disposition"),
    locale: Optional[str] = Query(default="en"),
) -> Dict[str, Any]:
    store = _store(request)
    stmts = store.verified(condition=condition)
    if stage:
        if stage not in tips_mod.STAGES:
            raise HTTPException(status_code=422, detail=f"unknown stage {stage!r}; one of {list(tips_mod.STAGES)}")
        wanted = tips_mod.statement_ids_for_stage(store, stage, condition=condition)
        stmts = [s for s in stmts if s.id in wanted]
    loc = _locale(locale)
    return {"statements": [s.learner_view(loc) for s in stmts], "count": len(stmts),
            "condition": condition, "stage": stage, "locale": loc, "status": "verified"}


@router.get("/v1/guidelines/statements/{statement_id}")
async def get_statement(request: Request, statement_id: str, locale: Optional[str] = Query(default="en")) -> Any:
    stmt = _store(request).get(statement_id)
    if stmt is None:
        raise HTTPException(status_code=404, detail="statement not found")
    if stmt.status != "verified":
        # A learner never sees an unverified statement's text; say why it is unavailable.
        return JSONResponse(status_code=404, content={"detail": "statement not verified", "id": statement_id,
                                                      "status": stmt.status})
    return stmt.learner_view(_locale(locale))


@router.get("/v1/guidelines/tips")
async def list_tips(
    request: Request,
    condition: Optional[str] = Query(default=None),
    stage: Optional[str] = Query(default=None),
    locale: Optional[str] = Query(default="en"),
) -> Dict[str, Any]:
    if stage and stage not in tips_mod.STAGES:
        raise HTTPException(status_code=422, detail=f"unknown stage {stage!r}; one of {list(tips_mod.STAGES)}")
    store = _store(request)
    loc = _locale(locale)
    items = tips_mod.list_tips(store, condition=condition, stage=stage)
    statement_ids = sorted({sid for t in items for sid in t.statement_ids})
    statements = {s.id: s.learner_view(loc) for s in store.list(status="verified", ids=statement_ids)}
    return {"tips": [t.model_dump() for t in items], "statements": statements, "count": len(items),
            "condition": condition, "stage": stage, "locale": loc, "stages": list(tips_mod.STAGES)}


# --------------------------------------------------------------------------- #
# Admin route                                                                 #
# --------------------------------------------------------------------------- #
class VerifyRequest(BaseModel):
    ids: Optional[List[str]] = None
    all: bool = Field(default=False, description="re-verify every row, not only drafts")
    min_score: Optional[float] = None


def _check_admin_token(x_admin_token: Optional[str], settings: Any = None) -> None:
    """Constant-time check against ``ADMIN_TOKEN`` (env first, then the loaded settings)."""
    expected = os.environ.get("ADMIN_TOKEN", "") or str(getattr(settings, "admin_token", None) or "")
    if not expected:
        raise HTTPException(status_code=503, detail="ADMIN_TOKEN is not configured")
    if not x_admin_token or not secrets.compare_digest(x_admin_token.encode("utf-8"), expected.encode("utf-8")):
        raise HTTPException(status_code=401, detail="invalid admin token")


async def require_guidelines_admin(
    request: Request,
    x_admin_token: Optional[str] = Header(default=None, alias="X-Admin-Token"),
) -> None:
    """Same contract as ``server.admin_routes.require_admin``: the bootstrap ``X-Admin-Token``
    or a verified bearer holding admin / super_admin. The env token keeps working for the
    clock-3 batch job that runs this route from a shell."""
    settings = getattr(request.app.state, "settings", None)
    try:
        _check_admin_token(x_admin_token, settings)
        return
    except HTTPException as token_exc:
        from server.auth.deps import bearer_admin  # lazy: keeps the guideline store importable standalone

        if await bearer_admin(request) is not None:
            return
        raise token_exc


@router.post("/admin/guidelines/verify", dependencies=[Depends(require_guidelines_admin)])
async def admin_verify(
    request: Request,
    body: Optional[VerifyRequest] = None,
) -> Dict[str, Any]:
    from server.guidelines import verifier  # lazy: pulls httpx/trafilatura only when used

    settings = getattr(request.app.state, "settings", None)
    airgapped = bool(getattr(settings, "airgapped", True)) if settings is not None else True
    if airgapped and os.environ.get("ACUDX_VERIFIER_ALLOW_EGRESS", "") not in ("1", "true", "yes"):
        raise HTTPException(status_code=409, detail="AIRGAPPED: the verifier would egress to guideline publishers; "
                                                    "set ACUDX_VERIFIER_ALLOW_EGRESS=1 to run it from this box")
    body = body or VerifyRequest()
    store = _store(request)
    gateway = getattr(request.app.state, "gateway", None)
    embed_fn = getattr(gateway, "embed", None) if gateway is not None else None
    summary = await verifier.verify_and_export(
        store, ids=body.ids, only_status=None if body.all else "draft", embed_fn=embed_fn,
        min_score=body.min_score if body.min_score is not None else verifier.MIN_SCORE,
    )
    return summary
