"""AcuDx Gateway: results and imaging routes (APIRouter).

POST /v1/results/resolve        case_state + order_code + sim_time_ms -> OrderResult
POST /v1/results/ecg            pattern + rate + seed -> 12-lead samples (500 Hz) and/or SVG
GET  /v1/results/reference-ranges  the sourced LOINC/UCUM table (optionally one analyte)
GET  /v1/imaging/resolve        structured imaging request -> bank match with provenance
GET  /v1/results/catalog        lab and imaging order catalogue (LOINC, sections, turnaround)
GET  /v1/terminology/*          ICD-10-CM FY2027 and ICD-11 MMS search, lookup and relation

No model call happens here: ``narrative`` stays null for the LLM layer. No
network call happens here either; the imaging bank is a local index.
Mounted from server/app.py with ``app.include_router(results_router)``.
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

from server.results import ecg as ecg_mod
from server.results import catalog, engine, imaging_bank
from server.terminology.routes import router as terminology_router

router = APIRouter(tags=["results"])
# ICD-10-CM / ICD-11 search and lookup (server/terminology/routes.py), mounted with the results routes.
router.include_router(terminology_router)


class ResolveRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    case_state: dict[str, Any] = Field(..., description="GeneratedCaseSpec dict, plus optional treatments_given[], onset_h, condition_id")
    order_code: str
    sim_time_ms: int = 0
    prior: Optional[list[dict[str, Any]]] = None
    seed: Optional[int] = None


class Turnaround(BaseModel):
    model_config = ConfigDict(extra="allow")  # basis, preliminary_minutes, preliminary_ms
    category: str
    minutes: int
    ms: int
    source: str


class Observation(BaseModel):
    model_config = ConfigDict(extra="allow")
    loinc: str
    name: str
    short: Optional[str] = None
    value: float | str
    unit: str = ""
    qualitative: bool = False
    ref_low: Optional[float] = None
    ref_high: Optional[float] = None
    flag: str
    critical: bool = False
    interpretation: str
    delta: Optional[dict[str, Any]] = None
    kinetics: Optional[str] = None
    ground_truth: bool = False
    source: str
    reviewed_at: str


class OrderResult(BaseModel):
    model_config = ConfigDict(extra="allow")
    order_code: str
    kind: str
    status: str
    sim_time_ms: int
    t_since_onset_h: float
    condition_id: Optional[str] = None
    severity: float
    turnaround: Turnaround
    available_at_ms: int
    observations: Optional[list[Observation]] = None
    report: Optional[dict[str, Any]] = None
    ecg: Optional[dict[str, Any]] = None
    abnormal: Optional[bool] = None
    critical: Optional[bool] = None
    treatments_applied: list[dict[str, Any]] = []
    narrative: Optional[str] = None
    meta: dict[str, Any]


class EcgRequest(BaseModel):
    pattern: str = "normal"
    rate_bpm: Optional[float] = Field(default=None, ge=20, le=300)
    seed: int = 0
    include_samples: bool = True
    include_svg: bool = False
    px_per_mm: float = Field(default=4.0, ge=1.0, le=12.0)


class EcgResult(BaseModel):
    model_config = ConfigDict(extra="allow")
    fs: int
    duration_s: float
    pattern: str
    seed: int
    measurements: dict[str, Any]
    beats: dict[str, Any]
    calibration: dict[str, Any]
    is_synthetic: bool
    generator: str
    leads: Optional[dict[str, list[float]]] = None
    svg: Optional[str] = None


class ImagingResolveResult(BaseModel):
    model_config = ConfigDict(extra="allow")
    status: str
    entry: Optional[dict[str, Any]] = None
    provenance: Optional[dict[str, Any]] = None
    findings: list[dict[str, Any]] = []
    reason: Optional[str] = None


@router.post("/v1/results/resolve", response_model=OrderResult)
async def results_resolve(req: ResolveRequest) -> Any:
    try:
        return engine.resolve_order(req.case_state, req.order_code, req.sim_time_ms, prior=req.prior, seed=req.seed)
    except KeyError as exc:
        raise HTTPException(status_code=422, detail=f"unknown analyte or code: {exc}") from exc


@router.post("/v1/results/ecg", response_model=EcgResult, response_model_exclude_none=True)
async def results_ecg(req: EcgRequest) -> Any:
    if req.pattern not in ecg_mod.PATTERNS:
        raise HTTPException(status_code=422, detail={"error": "unknown_pattern", "patterns": list(ecg_mod.PATTERNS)})
    strip = ecg_mod.synthesize(req.pattern, rate_bpm=req.rate_bpm, seed=req.seed)
    if req.include_svg:
        strip["svg"] = ecg_mod.render_svg(strip, px_per_mm=req.px_per_mm)
    if not req.include_samples:
        strip.pop("leads", None)
    return strip


@router.get("/v1/results/reference-ranges")
async def results_reference_ranges(loinc: Optional[str] = Query(default=None), sex: str = Query(default="any"), age: int = Query(default=45, ge=0, le=120)) -> Any:
    data = engine.load_ranges()
    if loinc:
        analyte = data["_by_loinc"].get(loinc)
        if analyte is None:
            raise HTTPException(status_code=404, detail="unknown LOINC code")
        return {"analyte": analyte, "resolved_range": engine.reference_range(loinc, sex, age), "sources": {analyte.get("source_key"): data["sources"].get(analyte.get("source_key"))}}
    return {key: value for key, value in data.items() if not key.startswith("_")}


@router.get("/v1/results/catalog")
async def results_catalog() -> Any:
    """The order catalogue (labs with member analytes, imaging procedures) with
    LOINC codes, labels, sections and turnaround, for the order-entry surface."""
    return catalog.public_catalog()


@router.get("/v1/imaging/resolve", response_model=ImagingResolveResult)
async def imaging_resolve(
    modality: Optional[str] = None,
    region: Optional[str] = None,
    finding: str = "normal",
    laterality: Optional[str] = None,
    view: Optional[str] = None,
    order_code: Optional[str] = None,
    condition_id: Optional[str] = None,
) -> Any:
    return imaging_bank.resolve(modality=modality, region=region, finding=finding, laterality=laterality, view=view, order_code=order_code, condition_id=condition_id)
