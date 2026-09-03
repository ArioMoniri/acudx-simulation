"""AcuDx Gateway — FastAPI application (the pod-side chokepoint).

The Phase-0/MVP HTTP surface in front of the local model stack. Every route that
touches a model goes through :class:`~server.model_gateway.ModelGateway`, so the
``AIRGAPPED`` no-egress invariant is enforced in exactly one place.

Endpoints
---------
GET  /health           liveness + resolved provider/model + air-gap state
GET  /status           {disk, ram} + per-endpoint reachability + model names
POST /v1/guard         Scope & Injection Guard (docs/architecture/13 §3)
POST /v1/patient/turn  guard -> route-by-class -> persona + gateway -> FactGate
POST /v1/grade         decomposed, evidence-forced rubric grading -> banded score
POST /v1/ground        delegates to server.grounding.ground() (sibling-owned)

``server.grounding`` is imported **lazily** (per request) so this app still
boots if the grounding module's dependencies differ or it is not yet present.

Run: ``uvicorn server.app:app --host 127.0.0.1 --port 8890`` (see run.sh).
Education only. No real patient-data path.
"""

from __future__ import annotations

import inspect
import os
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import AliasChoices, BaseModel, Field

from server.config import EgressBlocked, get_settings
from server.model_gateway import GatewayError, ModelGateway
from server.persona import build_patient_turn, fact_assertion_gate
from server.rubric import grade_transcript
from server.scope_guard import classify

# Guard-class -> persona directive (docs/architecture/13 §3.1 routing).
_DIRECTIVE_BY_CLASS = {"in-scope": "normal", "off-topic": "off_topic", "answer-seeking": "decline"}

# Deterministic responses for the HARD classes — these never touch the LLM.
_INJECTION_REPLY = (
    "I can only help with the clinical encounter. Let's stay with the patient — "
    "what would you like to ask or examine?"
)
_SAFETY_REPLY = (
    "It sounds like you may be going through something serious. This is a training "
    "simulation and not a substitute for real help. If you are in danger or thinking "
    "of harming yourself, please contact your local emergency number or a crisis "
    "line right now. (In production the Safety Interceptor surfaces locale-specific "
    "resources here.)"
)
_SCRIPTED_DEFLECTION = "…sorry, I— I'm finding it hard to answer just now. Could you ask me again?"


# --------------------------------------------------------------------------- #
# Lifespan: build the gateway once (fails closed on an egressing config).      #
# --------------------------------------------------------------------------- #
@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    gateway = ModelGateway(settings)   # may raise EgressBlocked under AIRGAPPED+api
    await gateway.start()
    app.state.settings = settings
    app.state.gateway = gateway
    try:
        yield
    finally:
        await gateway.aclose()


app = FastAPI(
    title="AcuDx Model Gateway",
    version="0.1.0",
    summary="Air-gapped Phase-0 gateway: scope guard, patient roleplay, grounding.",
    lifespan=lifespan,
)

# CORS — localhost/127.0.0.1 on any port for the (tunnelled) web demo, plus any
# explicitly configured origins. Credentials stay off so a regex origin is safe.
_settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_settings.cors_origins,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------- #
# Request / response models                                                    #
# --------------------------------------------------------------------------- #
class GuardRequest(BaseModel):
    # Accept either `text` or `utterance` as the learner input (the sibling's
    # orchestrator + smoke_test use `utterance`; the web demo uses `text`).
    model_config = {"populate_by_name": True}
    text: str = Field(validation_alias=AliasChoices("text", "utterance"))
    case_context: dict[str, Any] | None = None


class PatientTurnRequest(BaseModel):
    # `utterance` / `message` are accepted aliases for `learner_msg` so the same
    # endpoint serves both the web demo and the orchestrator's wire format.
    model_config = {"populate_by_name": True}
    learner_msg: str = Field(validation_alias=AliasChoices("learner_msg", "utterance", "message"))
    case_state: dict[str, Any] = Field(default_factory=dict)
    persona: dict[str, Any] | None = None
    history: list[dict[str, str]] = Field(default_factory=list)
    case_context: dict[str, Any] | None = None
    max_tokens: int | None = None
    temperature: float | None = None


class PatientTurnResponse(BaseModel):
    utterance: str
    routed_as: str                 # the guard class we acted on
    state_advance: bool            # in-scope only (docs §3.1)
    guard: dict[str, Any]
    flags: list[dict[str, Any]] = Field(default_factory=list)
    meta: dict[str, Any] | None = None


class GroundRequest(BaseModel):
    # Permissive: grounding.ground() is sibling-owned; forward whatever we get.
    # `text` is accepted as an alias for the module's `query` parameter.
    model_config = {"extra": "allow"}
    query: str | None = None
    text: str | None = None
    country: str | None = None
    locale: str | None = None
    k: int | None = None


class GradeRequest(BaseModel):
    # `transcript` may be a flat string OR a list of turns
    # ({role|speaker, content|text}); `history`/`turns` are accepted aliases so
    # the web app and orchestrator wire shapes both work (see rubric.normalize).
    model_config = {"populate_by_name": True}
    transcript: Any = Field(
        default=None,
        validation_alias=AliasChoices("transcript", "history", "turns"),
    )
    locale: str = "en"
    concurrency: int | None = None


class GradeResponse(BaseModel):
    overall_band: str
    domains: list[dict[str, Any]]
    meta: dict[str, Any] | None = None


def _gateway(app: FastAPI) -> ModelGateway:
    return app.state.gateway


# --------------------------------------------------------------------------- #
# /health                                                                      #
# --------------------------------------------------------------------------- #
@app.get("/health")
async def health() -> dict[str, Any]:
    s = get_settings()
    gw = _gateway(app)
    return {
        "status": "ok",
        "airgapped": s.airgapped,
        "provider": gw.endpoint.provider,
        "model": gw.endpoint.model,
        "llm_base_url": gw.endpoint.base_url,
        "tiers": list(gw.tiers.keys()),
    }


# --------------------------------------------------------------------------- #
# /status  — {disk, ram} + endpoint reachability                              #
# --------------------------------------------------------------------------- #
def _disk(path: str) -> dict[str, Any]:
    target = path if os.path.exists(path) else "/"
    try:
        st = os.statvfs(target)
        total = st.f_blocks * st.f_frsize
        free = st.f_bavail * st.f_frsize
        return {
            "path": target,
            "total_bytes": total,
            "free_bytes": free,
            "used_bytes": total - free,
            "used_pct": round((total - free) / total * 100, 1) if total else None,
        }
    except OSError as exc:
        return {"path": target, "error": type(exc).__name__, "detail": str(exc)}


def _ram() -> dict[str, Any]:
    # Linux pod: read /proc/meminfo (kB). Non-Linux dev boxes have no /proc.
    try:
        with open("/proc/meminfo", "r", encoding="utf-8") as fh:
            info: dict[str, int] = {}
            for line in fh:
                parts = line.split(":")
                if len(parts) == 2:
                    val = parts[1].strip().split()
                    if val and val[0].isdigit():
                        info[parts[0]] = int(val[0]) * 1024  # kB -> bytes
        total = info.get("MemTotal")
        avail = info.get("MemAvailable", info.get("MemFree"))
        out: dict[str, Any] = {"source": "/proc/meminfo"}
        if total is not None:
            out["total_bytes"] = total
        if avail is not None:
            out["available_bytes"] = avail
        if total and avail is not None:
            out["used_bytes"] = total - avail
            out["used_pct"] = round((total - avail) / total * 100, 1)
        return out
    except OSError:
        return {"source": "unavailable", "note": "no /proc/meminfo (non-Linux host)"}


@app.get("/status")
async def status() -> dict[str, Any]:
    s = get_settings()
    gw = _gateway(app)
    endpoints = await gw.reachability()
    return {
        "status": "ok",
        "airgapped": s.airgapped,
        "provider": gw.endpoint.provider,
        "model": gw.endpoint.model,
        "tiers": list(gw.tiers.keys()),
        "disk": _disk(s.status_disk_path),
        "ram": _ram(),
        "endpoints": endpoints,
    }


# --------------------------------------------------------------------------- #
# /v1/guard                                                                    #
# --------------------------------------------------------------------------- #
@app.post("/v1/guard")
async def guard(req: GuardRequest) -> dict[str, Any]:
    return classify(req.text, req.case_context)


# --------------------------------------------------------------------------- #
# /v1/patient/turn                                                             #
# --------------------------------------------------------------------------- #
@app.post("/v1/patient/turn")
async def patient_turn(req: PatientTurnRequest) -> PatientTurnResponse:
    # 1. Guard the raw utterance BEFORE any model sees it.
    ctx = req.case_context if req.case_context is not None else req.case_state
    verdict = classify(req.learner_msg, ctx)
    cls = verdict["cls"]

    # 2. Hard classes are handled deterministically — the LLM is never called.
    if cls == "injection":
        return PatientTurnResponse(
            utterance=_INJECTION_REPLY, routed_as=cls, state_advance=False,
            guard=verdict, flags=[{"type": "security_event", "rule": verdict["layers"].get("l0_rule_hit")}],
        )
    if cls == "unsafe":
        return PatientTurnResponse(
            utterance=_SAFETY_REPLY, routed_as=cls, state_advance=False,
            guard=verdict, flags=[{"type": "safety_trigger", "rule": verdict["layers"].get("l0_rule_hit")}],
        )

    # 3. Soft classes -> persona turn via the gateway, with a class directive.
    directive = _DIRECTIVE_BY_CLASS.get(cls, "normal")
    messages = build_patient_turn(req.case_state, req.persona, req.history, req.learner_msg, directive)

    gw = _gateway(app)
    meta: dict[str, Any] = {}
    degrade_flags: list[dict[str, Any]] = []
    try:
        result = await gw.chat(
            messages, task="patient",
            max_tokens=req.max_tokens, temperature=req.temperature,
        )
        raw_utterance = result.text or _SCRIPTED_DEFLECTION
        meta = {
            "model": result.model, "provider": result.provider,
            "latency_ms": round(result.latency_ms, 1),
            "finish_reason": result.finish_reason,
            "had_reasoning": result.had_reasoning,
        }
    except (GatewayError, EgressBlocked) as exc:
        # Degrade to a scripted deflection — the encounter continues in text.
        raw_utterance = _SCRIPTED_DEFLECTION
        degrade_flags.append({"type": "gateway_degraded", "error": type(exc).__name__})

    # 4. Two-tier FactAssertionGate on the persona output (Layer 3).
    gate = fact_assertion_gate(raw_utterance, req.case_state)
    flags = [f.model_dump() for f in gate.flags] + degrade_flags

    return PatientTurnResponse(
        utterance=gate.utterance,
        routed_as=cls,
        state_advance=(cls == "in-scope"),
        guard=verdict,
        flags=flags,
        meta=meta or None,
    )


# --------------------------------------------------------------------------- #
# /v1/grade  — decomposed, evidence-forced rubric grading (docs/architecture/02
# GRADE tier). Each of the fixed rubric's items is graded independently at
# temperature 0 through the gateway's `grade` tier; the model returns
# {met, evidence_span (a forced verbatim quote), confidence} per item, and the
# band is aggregated deterministically code-side. Bands only — never decimals.  #
# --------------------------------------------------------------------------- #
@app.post("/v1/grade", response_model=GradeResponse)
async def grade(req: GradeRequest) -> GradeResponse:
    gw = _gateway(app)
    result = await grade_transcript(
        req.transcript, gw, locale=req.locale, concurrency=req.concurrency,
    )
    return GradeResponse(**result)


# --------------------------------------------------------------------------- #
# /v1/ground  — delegate to the sibling-owned grounding module (lazy import).  #
# --------------------------------------------------------------------------- #
@app.post("/v1/ground")
async def ground(req: GroundRequest) -> Any:
    try:
        from server import grounding  # noqa: PLC0415 — lazy on purpose
    except Exception as exc:  # noqa: BLE001
        return JSONResponse(
            status_code=503,
            content={"error": "grounding_unavailable", "detail": f"{type(exc).__name__}: {exc}"},
        )

    ground_fn = getattr(grounding, "ground", None)
    if ground_fn is None:
        return JSONResponse(
            status_code=503,
            content={"error": "grounding_unavailable", "detail": "server.grounding has no ground()"},
        )

    payload = req.model_dump(exclude_none=True)
    # `text` is our alias for the grounding module's `query` parameter.
    query = payload.pop("query", None) or payload.pop("text", None) or ""
    gw = _gateway(app)

    # Forward only parameters the ground() signature actually declares (so an
    # unknown extra field never raises), map our alias onto `query`, and offer
    # the managed gateway when accepted (docs/05: embed/rerank via the Gateway).
    try:
        params = inspect.signature(ground_fn).parameters
        kwargs: dict[str, Any] = {name: val for name, val in payload.items() if name in params}
        if "query" in params:
            kwargs["query"] = query
        if "gateway" in params:
            kwargs["gateway"] = gw
        result = ground_fn(**kwargs)
    except TypeError:
        # Last-resort: a positional-only ground(query, ...).
        result = ground_fn(query)

    if inspect.isawaitable(result):
        result = await result
    return result
