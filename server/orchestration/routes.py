"""HTTP surface for on-request case generation (staged, review 06a) and the Clinical Director.

    POST /v2/case/generate/stream      SSE: start, kernel, opening.delta*, opening.ready, then the
                                       same-thread continuation (layer.pending / layer.ready / judge)
                                       and done. Contract: review 06a section 4.6.
    GET  /v2/case/{thread_id}/events   SSE reconnect: replays the thread log after ``?after=<id>``
    POST /v2/case/{thread_id}/layer/{layer}
                                       one layer, generated on first access (or awaited when the
                                       continuation is already writing it)
    GET  /v2/case/{thread_id}          server-authoritative case state (CaseStore)
    GET  /v2/cases/mine                the caller's own history of generated encounters
    POST /v2/case/generate             the same staged run, answered when the core layers are in
    POST /v2/director/step             one Director step, bound to ``thread_id`` (state from CaseStore)
    GET  /v2/learner/{learner_id}      learner memory profile
    POST /v2/case/template             410: templates are never served as learner cases

Owner decision (authoritative): every learner case is generated on request by the model
pipeline and changes in flight. No pre-generated list, seed, curated or published library,
or template is ever served to a learner as a case. Background continuation of deeper layers
of the SAME requested case is allowed; nothing is generated ahead of a request.

Access (review 04 O3): ``GET /v2/learner/{learner_id}`` and every ``/v2/case/{thread_id}``
read need a signed-in caller (``current_user``); a ``learner_id`` in a generate or Director body
needs one too. The caller may only name their own learner id (the principal ``sub``, which is
the local profile id in local mode, or its ``user_hash``) unless they hold ``faculty`` or
above. A thread generated for a learner is readable by that learner and by faculty; for
anyone else it answers the same 404 as a missing thread.

SSE streams are capped at ``SSE_MAX_DURATION_S`` (review 04 O11): the stream then ends with an
``error`` event (``stream_timeout``, 504) and the client reconnects with ``?after=``.

Honesty rule: when the model endpoint is unreachable the generate routes answer
``503 model_unreachable``; when the model answers but not with a valid case,
``502 model_output_invalid``. Nothing else is offered in its place.
"""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Optional

import httpx
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from langgraph.store.base import BaseStore
from pydantic import BaseModel, Field

from server.auth.deps import Principal, current_user, optional_user
from server.config import EgressBlocked, Settings, get_settings
from server.orchestration.director import Action, CaseState, anext_state
from server.orchestration.llm import StructuredLLM, WorkerCostSource
from server.orchestration.memory import LearnerMemory, memory_store
from server.orchestration.staged import (
    StagedRuntime, director_state_from_spec, layers_for_action, refresh_director, valid_layer,
)
from server.orchestration.store import CaseStore
from server.orchestration.trace import summarize
from server.telemetry.events import bind_context, current_context, unbind_context

router = APIRouter(prefix="/v2", tags=["orchestration"])

# Hard server-side cap on one SSE connection (review 04 O11). The opening lands in well
# under a minute; the continuation keeps writing layers after the cap and a client that
# still wants them reconnects with GET /v2/case/{thread_id}/events?after=<last id>.
SSE_MAX_DURATION_S = 600.0

# How long a Director step or a layer read waits for a lazily generated layer.
LAYER_WAIT_S = 60.0


# --------------------------------------------------------------------------- #
# Runtime                                                                      #
# --------------------------------------------------------------------------- #
@dataclass
class OrchestrationRuntime:
    settings: Settings
    llm: Optional[StructuredLLM]
    store: BaseStore
    memory: LearnerMemory
    cases: CaseStore
    staged: StagedRuntime
    db_path: Optional[str] = None
    # The single-call council graph (author, three judges, repair). Not a learner path: kept for
    # the case-quality regression suite and faculty review of whole-case drafts.
    graph: Any = None
    _closed: bool = field(default=False, repr=False)

    @classmethod
    async def create(
        cls,
        settings: Settings | None = None,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        db_path: str | None = None,
        in_memory: bool = False,
        telemetry: Any = None,
        worker_manager: Any = None,
        continuation: bool = True,
        max_repairs: int = 2,
        time_budget_s: float | None = None,
        **_legacy: Any,
    ) -> "OrchestrationRuntime":
        settings = settings or get_settings()
        llm: StructuredLLM | None
        gpu = (WorkerCostSource(worker_manager, getattr(settings, "casegen_gpu_usd_per_hour", None))
               if worker_manager is not None else None)
        try:
            llm = StructuredLLM(settings, transport=transport, telemetry=telemetry, gpu=gpu)
        except EgressBlocked:
            # AIRGAPPED with a non-local endpoint: nothing may be dialled. The
            # routes report 503 for every model-backed call.
            llm = None
        path = None if in_memory else (db_path or settings.acudx_db_path)
        if path == ":memory:":
            path = None
        if path:
            os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        store = memory_store(path)
        memory = LearnerMemory(store)
        cases = CaseStore(path)
        staged = StagedRuntime(llm, cases, memory, continuation=continuation)
        from langgraph.checkpoint.memory import InMemorySaver

        from server.orchestration.graph import CaseGenDeps, build_casegen_graph

        budget = time_budget_s if time_budget_s is not None else float(
            getattr(settings, "casegen_time_budget_s", 120.0) or 120.0)
        graph = build_casegen_graph(CaseGenDeps(llm=llm, memory=memory, max_repairs=max_repairs,
                                                time_budget_s=budget)).compile(checkpointer=InMemorySaver(),
                                                                               store=store)
        return cls(settings=settings, llm=llm, store=store, memory=memory, cases=cases, staged=staged,
                   db_path=path, graph=graph)

    def config(self, thread_id: str) -> dict[str, Any]:
        return {"configurable": {"thread_id": thread_id}}

    async def aclose(self) -> None:
        if self._closed:
            return
        self._closed = True
        if self.llm is not None:
            await self.llm.aclose()


def _runtime_lock(state: Any) -> asyncio.Lock:
    """One creation lock per app and event loop (a lock never crosses loops)."""
    loop = asyncio.get_running_loop()
    held = getattr(state, "orchestration_lock", None)
    if held is None or held[0] is not loop:
        held = (loop, asyncio.Lock())
        state.orchestration_lock = held
    return held[1]


async def get_runtime(request: Request) -> OrchestrationRuntime:
    """The cached runtime; the first concurrent requests create exactly one (review 04 O7)."""
    state = request.app.state
    rt = getattr(state, "orchestration", None)
    if rt is not None:
        return rt
    async with _runtime_lock(state):
        rt = getattr(state, "orchestration", None)
        if rt is None:
            rt = await OrchestrationRuntime.create(
                getattr(state, "settings", None),
                telemetry=getattr(state, "telemetry", None),
                worker_manager=getattr(state, "worker_manager", None),
            )
            state.orchestration = rt
    return rt


def owns_learner(user: Principal, learner_id: str) -> bool:
    """The caller's own learner id (sub or its hash), or any id for faculty and above."""
    return learner_id in (user.sub, user.user_hash) or user.has("faculty")


def _learner_guard(learner_id: str | None, user: Principal | None) -> JSONResponse | None:
    """None when the request may read or write ``learner_id``'s memory, else the error response."""
    if not learner_id:
        return None
    if user is None:
        return _error(401, "unauthenticated", "sign in to read or write learner memory")
    if not owns_learner(user, learner_id):
        return _error(403, "forbidden_learner", "learner_id must be your own learner id")
    return None


def _thread_for(rt: OrchestrationRuntime, thread_id: str, user: Principal | None) -> dict[str, Any] | None:
    """The thread state when ``user`` may read it; None for a missing or foreign thread.

    A thread with an owner is readable by that owner and faculty. A thread generated
    without a learner id is bound to the principal that requested it (``requester``),
    so an anonymous or different caller cannot read another learner's case."""
    st = rt.cases.get(thread_id)
    if st is None or st.get("source") != "model":
        return None
    owner = st.get("owner") or st.get("requester")
    if user is None:
        return None
    if owner:
        return st if owns_learner(user, str(owner)) else None
    # Requested with no identity at all: only faculty may open it (never another learner).
    return st if user.has("faculty") else None


# --------------------------------------------------------------------------- #
# Wire models                                                                  #
# --------------------------------------------------------------------------- #
class Blueprint(BaseModel):
    """Faculty generation constraints (never a fixed case): condition, difficulty, objectives."""

    condition_id: str | None = None
    difficulty: int | None = Field(default=None, ge=1, le=5)
    objectives: list[str] = Field(default_factory=list)


class GenerateV2Request(BaseModel):
    system: str | None = None
    difficulty: int | None = Field(default=None, ge=1, le=5)
    complaint: str | None = None
    locale: str = "en"
    seed: int | None = None
    learner_id: str | None = None
    session_id: str | None = None
    thread_id: str | None = None
    blueprint: Blueprint | None = None
    purpose: str | None = None     # "encounter" | "room" | "exam" | "authoring" (telemetry only)


class DirectorStepRequest(BaseModel):
    thread_id: str | None = None
    case_state: dict[str, Any] | None = None   # faculty diagnostics only
    spec: dict[str, Any] | None = None         # faculty diagnostics only
    action: dict[str, Any]
    learner_id: str | None = None
    use_model: bool = True


class LayerRequest(BaseModel):
    reason: str | None = None


def _error(status: int, code: str, detail: str, **extra: Any) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": code, "detail": detail, **extra})


def _unreachable(rt: OrchestrationRuntime, exc: Exception | None) -> JSONResponse:
    ep = rt.llm.endpoint("casegen") if rt.llm is not None else None
    return _error(
        503, "model_unreachable",
        "The case generator model endpoint could not be reached; no case was generated. "
        "Every case is generated on request by the model: retry when the model is reachable.",
        endpoint=(ep.base_url if ep else None), model=(ep.model if ep else None),
        cause=(f"{type(exc).__name__}: {str(exc)[:200]}" if exc else "AIRGAPPED blocks the configured endpoint"),
        retryable=True,
    )


def _sse(event: str, data: dict[str, Any], eid: int | None = None) -> str:
    head = f"id: {eid}\n" if eid is not None else ""
    return f"{head}event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _gen_request(req: GenerateV2Request, user: Principal | None) -> dict[str, Any]:
    body = req.model_dump(exclude={"thread_id", "blueprint"})
    if req.blueprint is not None:
        body["blueprint"] = req.blueprint.model_dump()
    body["requester"] = user.sub if user is not None else None
    return body


def _fresh_thread_id(rt: OrchestrationRuntime, wanted: str | None) -> str:
    """A thread names exactly one request. A reused id never replays (or overwrites) the stored
    case: the new request gets a new thread."""
    if wanted and rt.cases.get(wanted) is None:
        return wanted
    return str(uuid.uuid4())


async def _preflight(rt: OrchestrationRuntime) -> JSONResponse | None:
    if rt.llm is None:
        return _unreachable(rt, None)
    probe = await rt.llm.probe("casegen")
    if not probe.get("reachable"):
        return _unreachable(rt, None)
    return None


# --------------------------------------------------------------------------- #
# Generation                                                                   #
# --------------------------------------------------------------------------- #
async def _tail_sse(rt: OrchestrationRuntime, thread_id: str, after: int,
                    ctx: dict[str, Any] | None = None) -> AsyncIterator[str]:
    # The body runs after the request middleware returned, so the telemetry
    # context (route, tenant, user) captured in the handler is bound again here.
    token = bind_context(**(ctx or {"route": "/v2/case/generate/stream"}))
    loop = asyncio.get_running_loop()
    deadline = loop.time() + SSE_MAX_DURATION_S
    last = after
    finished = False
    try:
        async for eid, name, data in rt.staged.tail(thread_id, after, cap_s=SSE_MAX_DURATION_S):
            last = eid
            yield _sse(name, data, eid)
            if name == "done" or (name == "error" and data.get("fatal")):
                finished = True
        if not finished and loop.time() >= deadline - 0.05:
            yield _sse("error", {"stage": "stream", "error": "stream_timeout", "status": 504, "retryable": True,
                                 "thread_id": thread_id, "after": last,
                                 "detail": f"stream exceeded the {SSE_MAX_DURATION_S:.0f} s cap; reconnect with "
                                           f"GET /v2/case/{thread_id}/events?after={last}"})
    finally:
        unbind_context(token)


def _stream_response(body: AsyncIterator[str]) -> StreamingResponse:
    return StreamingResponse(body, media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/case/generate/stream")
async def generate_stream(req: GenerateV2Request, request: Request,
                          user: Optional[Principal] = Depends(optional_user)) -> Response:
    denied = _learner_guard(req.learner_id, user)
    if denied is not None:
        return denied
    rt = await get_runtime(request)
    blocked = await _preflight(rt)
    if blocked is not None:
        return blocked
    thread_id = rt.staged.start(_gen_request(req, user), _fresh_thread_id(rt, req.thread_id))
    ambient = current_context()
    ctx = {"route": ambient.route or request.url.path, "tenant": ambient.tenant,
           "user_hash": ambient.user_hash, "encounter_id": ambient.encounter_id}
    return _stream_response(_tail_sse(rt, thread_id, 0, ctx))


@router.get("/case/{thread_id}/events")
async def case_events(thread_id: str, request: Request, after: int = 0,
                      user: Optional[Principal] = Depends(optional_user)) -> Response:
    rt = await get_runtime(request)
    if _thread_for(rt, thread_id, user) is None:
        return _error(404, "thread_not_found", f"no case thread {thread_id!r}")
    last_id = request.headers.get("last-event-id") or ""
    if last_id.isdigit():
        after = max(after, int(last_id))
    return _stream_response(_tail_sse(rt, thread_id, after))


@router.post("/case/generate")
async def generate(req: GenerateV2Request, request: Request,
                   user: Optional[Principal] = Depends(optional_user)) -> JSONResponse:
    """The staged run, answered when S1 and the core layers are in (authoring, API clients)."""
    denied = _learner_guard(req.learner_id, user)
    if denied is not None:
        return denied
    rt = await get_runtime(request)
    if rt.llm is None:
        return _unreachable(rt, None)
    thread_id = rt.staged.start(_gen_request(req, user), _fresh_thread_id(rt, req.thread_id))
    await rt.staged.wait(thread_id)
    st = rt.cases.get(thread_id) or {}
    if st.get("status") == "failed":
        err = (st.get("error") or {}).get("error") or "model_output_invalid"
        if err == "model_unreachable":
            return _unreachable(rt, None)
        return _error(502, err, "the model did not produce a usable case opening", thread_id=thread_id)
    trace = st.get("trace") or []
    return JSONResponse(content={
        "thread_id": thread_id, "spec": st.get("spec"), "trace_summary": summarize(trace), "trace": trace,
        "council": st.get("council"), "layers": _layer_status(st), "timings": st.get("timings"),
    })


def _layer_status(st: dict[str, Any]) -> dict[str, str]:
    return {n: str((st.get("layers") or {}).get(n, {}).get("status")) for n in st.get("layer_order") or []}


@router.post("/case/template")
async def template_diagnostic(req: GenerateV2Request, user: Optional[Principal] = Depends(optional_user)
                              ) -> JSONResponse:
    """Faculty and admin diagnostic only: the deterministic template, labelled as such.

    Owner decision: a template is never served to a learner as a case, so there is no learner
    fallback setting at all; students, residents and anonymous callers are refused."""
    if user is None:
        return _error(401, "unauthenticated", "the template diagnostic is for faculty")
    if not user.has("faculty"):
        return _error(403, "forbidden_role", "templates are never served to learners as cases")
    from server.orchestration.graph import template_spec

    spec = template_spec(req.model_dump(exclude={"thread_id", "blueprint", "purpose"}))
    return JSONResponse(content={"spec": spec, "trace_summary": None, "diagnostic": True})


@router.get("/cases/mine")
async def my_cases(request: Request, limit: int = 50, user: Principal = Depends(current_user)) -> JSONResponse:
    rt = await get_runtime(request)
    rows = rt.cases.list_for_owner(user.sub, limit)
    if user.user_hash and user.user_hash != user.sub:
        seen = {r["thread_id"] for r in rows}
        rows += [r for r in rt.cases.list_for_owner(user.user_hash, limit) if r["thread_id"] not in seen]
    rows.sort(key=lambda r: r.get("created_at") or 0, reverse=True)
    return JSONResponse(content={"cases": rows[:limit]})


@router.get("/case/{thread_id}")
async def read_case(thread_id: str, request: Request, user: Principal = Depends(current_user)) -> JSONResponse:
    rt = await get_runtime(request)
    st = _thread_for(rt, thread_id, user)
    if st is None:
        # Someone else's thread answers exactly like a missing one (no existence oracle).
        return _error(404, "thread_not_found", f"no case thread {thread_id!r}")
    trace = st.get("trace") or []
    events = rt.cases.events(thread_id)
    return JSONResponse(content={
        "thread_id": thread_id, "status": st.get("status"), "source": st.get("source"), "spec": st.get("spec"),
        "opening": st.get("opening"), "layers": _layer_status(st), "council": st.get("council"),
        "timings": st.get("timings"), "condition": st.get("condition"), "trace_summary": summarize(trace),
        "trace": trace, "last_event_id": events[-1][0] if events else 0,
    })


@router.post("/case/{thread_id}/layer/{layer}")
async def read_layer(thread_id: str, layer: str, request: Request, body: LayerRequest | None = None,
                     user: Optional[Principal] = Depends(optional_user)) -> JSONResponse:
    rt = await get_runtime(request)
    st = _thread_for(rt, thread_id, user)
    if st is None:
        return _error(404, "thread_not_found", f"no case thread {thread_id!r}")
    if not valid_layer(layer):
        return _error(422, "invalid_layer", f"unknown layer {layer!r}")
    if not st.get("opening"):
        return _error(409, "opening_not_ready", "the case opening is not ready yet")
    try:
        entry = await asyncio.wait_for(
            rt.staged.ensure_layer(thread_id, layer, reason=(body.reason if body else None) or "access"),
            LAYER_WAIT_S)
    except asyncio.TimeoutError:
        return _error(504, "layer_timeout", f"layer {layer} is still being written", retryable=True)
    if entry.get("status") != "ready":
        err = entry.get("error") or "layer_failed"
        return _error(503 if err == "model_unreachable" else 502, err, f"layer {layer} could not be written",
                      retryable=True)
    _mark_seen(rt, thread_id, [layer])
    now = rt.cases.get(thread_id) or {}
    return JSONResponse(content={"thread_id": thread_id, "layer": layer, "status": "ready",
                                 "data": entry.get("data"), "spec": now.get("spec")})


def _mark_seen(rt: OrchestrationRuntime, thread_id: str, layers: list[str]) -> None:
    if not layers:
        return

    def m(s: dict[str, Any]) -> None:
        for name in layers:
            entry = (s.get("layers") or {}).get(name)
            if entry is not None:
                entry["seen"] = True

    rt.cases.update(thread_id, m)


# --------------------------------------------------------------------------- #
# /v2/director/step                                                            #
# --------------------------------------------------------------------------- #
@router.post("/director/step")
async def director_step(req: DirectorStepRequest, request: Request,
                        user: Optional[Principal] = Depends(optional_user)) -> JSONResponse:
    denied = _learner_guard(req.learner_id, user)
    if denied is not None:
        return denied
    rt = await get_runtime(request)
    try:
        action = Action.model_validate(req.action)
    except Exception as exc:  # pydantic.ValidationError
        return _error(422, "invalid_action", str(exc)[:300])
    llm = rt.llm if (req.use_model and rt.llm is not None) else None
    if not req.thread_id:
        return await _director_diagnostic(rt, req, action, llm, user)

    st = _thread_for(rt, req.thread_id, user)
    if st is None:
        return _error(404, "thread_not_found", f"no case thread {req.thread_id!r}")
    if not st.get("spec"):
        return _error(409, "opening_not_ready", "the case opening is not ready yet")
    # The action reads a layer that is not written yet: write it now (lazy), then step.
    needed = layers_for_action(action.kind, action.ref)
    pending_layers: list[str] = []
    for name in needed:
        entry = (st.get("layers") or {}).get(name) or {}
        if entry.get("status") != "ready":
            try:
                await asyncio.wait_for(rt.staged.ensure_layer(req.thread_id, name, reason="action"), LAYER_WAIT_S)
            except (asyncio.TimeoutError, KeyError):
                pending_layers.append(name)
    st = rt.cases.get(req.thread_id) or st
    current = st.get("director")
    if not isinstance(current, dict):
        current = director_state_from_spec(st["spec"], req.thread_id)
    try:
        state = CaseState.model_validate(current)
    except Exception as exc:  # noqa: BLE001 - the Director model changed shape under a stored state
        return _error(409, "invalid_case_state", str(exc)[:300])
    new_state, visible, notes = await anext_state(state, action, llm)
    dumped = new_state.model_dump()
    fired_now = [c for c in (visible.get("complications_fired") or []) if c]

    def write(s: dict[str, Any]) -> None:
        s["director"] = dumped
        refresh_director(s)
        for name in needed:
            entry = (s.get("layers") or {}).get(name)
            if entry is not None:
                entry["seen"] = True

    rt.cases.update(req.thread_id, write)
    _record_errors(rt, req.learner_id, state, new_state)
    # A branch opened: author its bedside event for THIS thread in the background (S6).
    reasons = {str(getattr(c, "id", "")): str(getattr(c, "reason", "")) for c in
               (getattr(new_state, "pending_complications", None) or [])}
    branch_layers: list[str] = []
    for comp in fired_now:
        cid = str(comp.get("id") if isinstance(comp, dict) else comp)
        layer = "event." + "".join(ch if ch.isalnum() or ch in "_-" else "_" for ch in cid.lower())[:64]
        branch_layers.append(layer)
        rt.staged.spawn(rt.staged.ensure_layer(req.thread_id, layer, reason="branch",
                                               extra=reasons.get(cid) or cid, at_ms=int(new_state.t_ms)))
    return JSONResponse(content={
        "thread_id": req.thread_id,
        "case_state": dumped,
        "patient_visible_changes": visible,
        "director_notes": notes,
        "layers_pending": pending_layers + branch_layers,
    })


def _record_errors(rt: OrchestrationRuntime, learner_id: str | None, before: CaseState, after: CaseState) -> None:
    if not learner_id:
        return
    known = {(e["at_ms"], e["kind"], e["detail"]) for e in before.errors}
    for err in after.errors:
        if (err["at_ms"], err["kind"], err["detail"]) not in known:
            rt.memory.record_error(learner_id, err["kind"], err["detail"], after.system or after.condition_id)


async def _director_diagnostic(rt: OrchestrationRuntime, req: DirectorStepRequest, action: Action,
                               llm: StructuredLLM | None, user: Principal | None) -> JSONResponse:
    """Stateless step of a supplied spec or state; nothing is written to CaseStore.

    The web client always steps by ``thread_id``. This path exists for faculty diagnostics and
    deterministic Director checks. Provenance guard: a spec must be model-generated
    (``meta.source == "model"``); seed, template, offline or published specs are refused
    unless the caller is faculty."""
    faculty = user is not None and user.has("faculty")
    if req.spec is not None and req.case_state is None and not faculty:
        source = str((req.spec.get("meta") or {}).get("source") or "")
        if source != "model":
            return _error(422, "not_model_generated",
                          f"only model-generated cases can be stepped (meta.source={source!r})")
    if req.case_state is not None:
        try:
            state = CaseState.model_validate(req.case_state)
        except Exception as exc:  # pydantic.ValidationError
            return _error(422, "invalid_case_state", str(exc)[:300])
    elif req.spec is not None:
        state = CaseState.from_spec(req.spec)
    else:
        return _error(422, "missing_case_state", "send thread_id (learners) or case_state/spec (faculty)")
    new_state, visible, notes = await anext_state(state, action, llm)
    _record_errors(rt, req.learner_id, state, new_state)
    return JSONResponse(content={"case_state": new_state.model_dump(), "patient_visible_changes": visible,
                                 "director_notes": notes, "diagnostic": True})


@router.get("/learner/{learner_id}", response_model=None)
async def learner_profile(learner_id: str, request: Request,
                          user: Principal = Depends(current_user)) -> dict[str, Any] | JSONResponse:
    denied = _learner_guard(learner_id, user)
    if denied is not None:
        return denied
    rt = await get_runtime(request)
    return rt.memory.profile(learner_id)
