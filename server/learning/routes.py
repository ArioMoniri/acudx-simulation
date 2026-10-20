"""Event ingestion plus the dean and faculty APIs.

Learner (any authenticated principal)
  POST /v1/events/encounter           store one finished encounter (events + summary), hash-chained per org
  GET  /v1/me/assignments             the caller's open and completed assignments

Dean (dean, admin, super_admin)
  GET  /v1/dean/cohort?org=&window=   competency bands by domain, calibration aggregates, at-risk learners, activity
  GET  /v1/dean/export?org=&window=   de-identified accreditation rows with the chain head
  GET  /v1/dean/chain?org=            recompute and verify the org's hash chain

Faculty (faculty, dean, admin, super_admin)
  GET  /v1/faculty/queue              authored cases awaiting review + learner encounters flagged for review
  POST /v1/faculty/review/{batch_id}  co-signed decision with optional per-domain band overrides
  POST /v1/faculty/cases/submit       submit an authored case for review
  POST /v1/faculty/cases/{id}/decide  approve or return a submitted case
  POST /v1/faculty/assign             assign a case to a roster (explicit subs or every learner)
  GET  /v1/faculty/assignments
  GET  /v1/faculty/roster

``org`` defaults to the caller's org; only admin / super_admin may read another org.
"""

from __future__ import annotations

import time
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from server.auth.deps import Principal, current_user, require_role
from server.learning.store import BANDS, DOMAINS, WINDOWS, LearningStore, aggregate_cohort, export_rows, window_since

router = APIRouter(tags=["learning"])

Window = Literal["7d", "30d", "90d", "all"]
MAX_EVENTS = 5000


def _store(request: Request) -> LearningStore:
    st = getattr(request.app.state, "learning", None)
    if st is None:
        raise HTTPException(status_code=503, detail="learning store not initialised")
    return st


def _org_for(user: Principal, requested: str | None) -> str:
    if requested and requested != user.org:
        if not user.has("admin"):
            raise HTTPException(status_code=403, detail={"reason": "cross_org", "message": "only admins may read another org"})
        return requested
    return user.org


# --------------------------------------------------------------------------- #
# ingestion                                                                   #
# --------------------------------------------------------------------------- #
class EventIn(BaseModel):
    seq: int
    type: str = Field(min_length=1, max_length=32)
    ref: str = Field(max_length=256)
    at: float
    meta: dict[str, Any] | None = None


class DomainScoreIn(BaseModel):
    key: str
    axis: str | None = None
    band: str
    competence: float = Field(ge=0.0, le=1.0)
    confidence: float = Field(ge=0.0, le=1.0)
    scored: bool

    @field_validator("key")
    @classmethod
    def _key(cls, v: str) -> str:
        if v not in DOMAINS:
            raise ValueError(f"unknown domain {v!r}")
        return v

    @field_validator("band")
    @classmethod
    def _band(cls, v: str) -> str:
        if v not in BANDS and v != "withheld":
            raise ValueError(f"unknown band {v!r}")
        return v


class SummaryIn(BaseModel):
    title: dict[str, str] | None = None
    domain_scores: list[DomainScoreIn] = Field(default_factory=list)
    calibration: list[dict[str, Any]] = Field(default_factory=list)
    overall_gap: float | None = None
    brier: float | None = None
    diagnosis_correct: bool
    safety_miss: bool
    expected_intent_count: int | None = None
    metrics: dict[str, Any] | None = None


class EncounterBatchIn(BaseModel):
    encounter_id: str = Field(min_length=1, max_length=128)
    case_id: str = Field(min_length=1, max_length=128)
    started_at: float | None = None
    ended_at: float | None = None
    events: list[EventIn] = Field(default_factory=list, max_length=MAX_EVENTS)
    summary: SummaryIn


@router.post("/v1/events/encounter", status_code=201)
async def ingest_encounter(request: Request, body: EncounterBatchIn, user: Principal = Depends(current_user)) -> dict[str, Any]:
    row, created = _store(request).ingest(
        org=user.org, user_sub=user.sub, user_name=user.name, encounter_id=body.encounter_id, case_id=body.case_id,
        started_at=body.started_at, ended_at=body.ended_at, events=[e.model_dump() for e in body.events],
        summary=body.summary.model_dump(),
    )
    return {"stored": created, "id": row["id"], "org": row["org"], "chain_hash": row["chain_hash"],
            "prev_hash": row["prev_hash"], "body_sha256": row["body_sha256"], "verified_identity": user.verified}


@router.get("/v1/me/assignments")
async def my_assignments(request: Request, user: Principal = Depends(current_user)) -> dict[str, Any]:
    return {"assignments": _store(request).assignments(user.org, assignee_sub=user.sub)}


# --------------------------------------------------------------------------- #
# dean                                                                        #
# --------------------------------------------------------------------------- #
@router.get("/v1/dean/cohort")
async def dean_cohort(request: Request, org: str | None = None, window: Window = "30d",
                      user: Principal = Depends(require_role("dean"))) -> dict[str, Any]:
    st = _store(request)
    target = _org_for(user, org)
    now = time.time()
    batches = st.batches(target, since=window_since(window, now))
    out = aggregate_cohort(batches, now=now, window=window)
    out.update({"org": target, "window": window, "windows": list(WINDOWS), "chain": st.verify_chain(target),
                "generated_at": now, "verified_identity": user.verified})
    return out


@router.get("/v1/dean/export")
async def dean_export(request: Request, org: str | None = None, window: Window = "90d",
                      user: Principal = Depends(require_role("dean"))) -> dict[str, Any]:
    st = _store(request)
    target = _org_for(user, org)
    now = time.time()
    batches = st.batches(target, since=window_since(window, now))
    return {"org": target, "window": window, "generated_at": now, "deidentified": True, "rows": export_rows(batches),
            "chain": st.verify_chain(target)}


@router.get("/v1/dean/chain")
async def dean_chain(request: Request, org: str | None = None, user: Principal = Depends(require_role("dean"))) -> dict[str, Any]:
    target = _org_for(user, org)
    return {"org": target, **_store(request).verify_chain(target)}


# --------------------------------------------------------------------------- #
# faculty                                                                     #
# --------------------------------------------------------------------------- #
@router.get("/v1/faculty/queue")
async def faculty_queue(request: Request, org: str | None = None, user: Principal = Depends(require_role("faculty"))) -> dict[str, Any]:
    st = _store(request)
    target = _org_for(user, org)
    return {"org": target, "cases": st.submissions(target, status="pending"), "encounters": st.flagged(target),
            "recent_reviews": st.reviews(target, limit=25)}


class ReviewBody(BaseModel):
    decision: Literal["upheld", "overridden"]
    note: str | None = Field(default=None, max_length=2000)
    overrides: dict[str, str] | None = None
    points: int | None = Field(default=None, ge=0, le=100)
    cosigned: bool = False

    @field_validator("overrides")
    @classmethod
    def _ov(cls, v: dict[str, str] | None) -> dict[str, str] | None:
        if v is None:
            return None
        for k, band in v.items():
            if k not in DOMAINS:
                raise ValueError(f"unknown domain {k!r}")
            if band not in BANDS:
                raise ValueError(f"unknown band {band!r}")
        return v


@router.post("/v1/faculty/review/{batch_id}")
async def faculty_review(request: Request, batch_id: int, body: ReviewBody,
                         user: Principal = Depends(require_role("faculty"))) -> dict[str, Any]:
    if not body.cosigned:
        raise HTTPException(status_code=422, detail={"reason": "cosign_required",
                                                     "message": "a review must be co-signed by the reviewing faculty member"})
    if body.decision == "overridden" and not body.overrides and body.points is None:
        raise HTTPException(status_code=422, detail={"reason": "override_empty",
                                                     "message": "an overridden decision needs at least one domain band or a points value"})
    rec = _store(request).review(user.org, batch_id, reviewer_sub=user.sub, reviewer_name=user.name, decision=body.decision,
                                 note=body.note, overrides=body.overrides, points=body.points, cosigned=True)
    if rec is None:
        raise HTTPException(status_code=404, detail="encounter not found in your org")
    return rec


class CaseSubmitBody(BaseModel):
    case_id: str = Field(min_length=1, max_length=128)
    title: str = Field(min_length=1, max_length=240)
    payload: dict[str, Any] = Field(default_factory=dict)


@router.post("/v1/faculty/cases/submit", status_code=201)
async def submit_case(request: Request, body: CaseSubmitBody, user: Principal = Depends(require_role("faculty"))) -> dict[str, Any]:
    return _store(request).submit_case(org=user.org, case_id=body.case_id, title=body.title, author_sub=user.sub,
                                       author_name=user.name, payload=body.payload)


class CaseDecideBody(BaseModel):
    status: Literal["approved", "returned"]
    note: str | None = Field(default=None, max_length=2000)


@router.post("/v1/faculty/cases/{submission_id}/decide")
async def decide_case(request: Request, submission_id: int, body: CaseDecideBody,
                      user: Principal = Depends(require_role("faculty"))) -> dict[str, Any]:
    rec = _store(request).decide_case(user.org, submission_id, status=body.status, reviewer_sub=user.sub, note=body.note)
    if rec is None:
        raise HTTPException(status_code=404, detail="submission not found in your org")
    return rec


class AssignBody(BaseModel):
    case_id: str = Field(min_length=1, max_length=128)
    title: str | None = Field(default=None, max_length=240)
    assignees: list[str] = Field(default_factory=list, max_length=500)
    all_learners: bool = False
    reason: str | None = Field(default=None, max_length=500)
    due_at: float | None = None


@router.post("/v1/faculty/assign", status_code=201)
async def assign(request: Request, body: AssignBody, user: Principal = Depends(require_role("faculty"))) -> dict[str, Any]:
    st = _store(request)
    subs = list(body.assignees)
    if body.all_learners:
        subs.extend(st.learner_subs(user.org))
        users = getattr(request.app.state, "auth", None)
        if users is not None:
            subs.extend(u["sub"] for u in users.users.list(org=user.org))
    subs = [s for s in dict.fromkeys(subs) if s]
    if not subs:
        raise HTTPException(status_code=422, detail={"reason": "no_assignees", "message": "name at least one learner or set all_learners"})
    rows = st.assign(org=user.org, case_id=body.case_id, title=body.title, assigned_by=user.sub, assignees=subs,
                     reason=body.reason, due_at=body.due_at)
    return {"assigned": len(rows), "assignments": rows}


@router.get("/v1/faculty/assignments")
async def faculty_assignments(request: Request, open_only: bool = False,
                              user: Principal = Depends(require_role("faculty"))) -> dict[str, Any]:
    return {"assignments": _store(request).assignments(user.org, open_only=open_only)}


@router.get("/v1/faculty/roster")
async def faculty_roster(request: Request, user: Principal = Depends(require_role("faculty"))) -> dict[str, Any]:
    auth = getattr(request.app.state, "auth", None)
    directory = auth.users.list(org=user.org) if auth is not None else []
    return {"org": user.org, "roster": _store(request).roster(user.org, directory)}
