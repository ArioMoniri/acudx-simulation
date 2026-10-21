"""HTTP surface for on-request case generation (staged, review 06a) and the Clinical Director.

    POST /v2/case/generate/stream      SSE: start, kernel, opening.delta*, opening.ready, then the
                                       same-thread continuation (layer.pending / layer.ready / judge)
                                       and done. Contract: review 06a section 4.6.
    GET  /v2/case/{thread_id}/events   SSE reconnect: replays the thread log after ``?after=<id>``;
                                       ``?follow=1`` keeps it open after ``done`` (room members,
                                       Director updates, branch events) until the cap
    POST /v2/case/{thread_id}/room     the owner binds the thread to a team room (join code)
    POST /v2/case/{thread_id}/join     a room member joins the thread with the room's join code
    POST /v2/case/{thread_id}/layer/{layer}/render
                                       a TR rendering of a layer already seen (one call, cached)
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
above. A thread generated for a learner is readable by that learner, by faculty and by the
members of the team room the owner bound it to (``CaseStore`` room membership, joined with
the room's code); for anyone else it answers the same 404 as a missing thread.

SSE streams are capped at ``SSE_MAX_DURATION_S`` (review 04 O11): the stream then ends with an
``error`` event (``stream_timeout``, 504) and the client reconnects with ``?after=``.

Honesty rule: when the model endpoint is unreachable the generate routes answer
``503 model_unreachable``; when the model answers but not with a valid case,
``502 model_output_invalid``. Nothing else is offered in its place.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from dataclasses import dataclass, field
from typing import Literal, Any, AsyncIterator, Optional

import httpx
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from langgraph.store.base import BaseStore
from pydantic import BaseModel, Field

from server.auth.deps import Principal, current_user, optional_user
from server.config import EgressBlocked, Settings, get_settings
from server.orchestration import director as D
from server.orchestration.director import Action, CaseState, anext_state
from server.orchestration.llm import StructuredLLM, WorkerCostSource
from server.orchestration.memory import LearnerMemory, memory_store
from server.orchestration.staged import (
    StagedRuntime, debrief_extra, director_state_from_spec, layers_for_action, refresh_director, renderable,
    source_spec, valid_layer,
)
from server.orchestration.store import CaseStore, DirectorStoreView, set_case_store
from server.orchestration.trace import summarize

log = logging.getLogger("acudx.orchestration.routes")
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
        anthropic_provider: Any = None,
        anthropic_gate: Any = None,
        time_budget_s: float | None = None,
        **_legacy: Any,
    ) -> "OrchestrationRuntime":
        settings = settings or get_settings()
        llm: StructuredLLM | None
        gpu = (WorkerCostSource(worker_manager, getattr(settings, "casegen_gpu_usd_per_hour", None))
               if worker_manager is not None else None)
        try:
            llm = StructuredLLM(settings, transport=transport, telemetry=telemetry, gpu=gpu,
                                anthropic_provider=anthropic_provider, anthropic_gate=anthropic_gate)
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
        # The app's store is the default the Director binds to (director.default_case_store()).
        set_case_store(cases)
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
            gateway = getattr(state, "gateway", None)
            rt = await OrchestrationRuntime.create(
                getattr(state, "settings", None),
                telemetry=getattr(state, "telemetry", None),
                worker_manager=getattr(state, "worker_manager", None),
                # One Claude client and one registry switch for the gateway and the orchestration.
                anthropic_provider=getattr(gateway, "anthropic", None),
                anthropic_gate=getattr(gateway, "anthropic_active", None),
            )
            state.orchestration = rt
    return rt


def owns_learner(user: Principal, learner_id: str) -> bool:
    """The caller's own learner id (sub or its hash), or any id for faculty and above."""
    return learner_id in (user.sub, user.user_hash) or user.has("faculty")


def _signed_in_when_oidc(request: Request, user: Principal | None) -> JSONResponse | None:
    """Under AUTH_MODE=oidc a case start needs a verified user: an anonymous request could
    otherwise launch the on-demand GPU worker (billed by the hour) from the open internet."""
    auth = getattr(request.app.state, "auth", None)
    if user is None and auth is not None and auth.mode == "oidc":
        return _error(401, "unauthenticated", "sign in to start a case")
    return None


def _learner_guard(learner_id: str | None, user: Principal | None) -> JSONResponse | None:
    """None when the request may read or write ``learner_id``'s memory, else the error response."""
    if not learner_id:
        return None
    if user is None:
        return _error(401, "unauthenticated", "sign in to read or write learner memory")
    if not owns_learner(user, learner_id):
        return _error(403, "forbidden_learner", "learner_id must be your own learner id")
    return None


def _owned_thread(rt: OrchestrationRuntime, thread_id: str, user: Principal | None) -> dict[str, Any] | None:
    """The thread state when ``user`` owns it (or is faculty); None otherwise.

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


def _thread_for(rt: OrchestrationRuntime, thread_id: str, user: Principal | None) -> dict[str, Any] | None:
    """The thread state when ``user`` may read it: the owner, faculty, or a member of the team
    room the owner bound the thread to. None for a missing or foreign thread."""
    st = _owned_thread(rt, thread_id, user)
    if st is not None or user is None:
        return st
    st = rt.cases.get(thread_id)
    if st is None or st.get("source") != "model":
        return None
    members = set(((st.get("room") or {}).get("members")) or [])
    return st if (user.sub in members or (user.user_hash and user.user_hash in members)) else None


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
    # The browser tab that sent the step: echoed on the thread's ``director`` event so the
    # sender does not apply its own step twice (room members apply the others').
    client_id: str | None = Field(default=None, max_length=64)
    # Faculty diagnostics only (no thread): step a model-generated spec once, statelessly.
    # A client-sent case_state is never accepted: the state lives in CaseStore.
    spec: dict[str, Any] | None = None
    action: dict[str, Any]
    learner_id: str | None = None
    use_model: bool = True


class LayerRequest(BaseModel):
    reason: str | None = None
    # Debrief on commit: the committed diagnosis (picklist code and display).
    diagnosis: dict[str, str] | None = None


class RoomRequest(BaseModel):
    room_code: str = Field(min_length=3, max_length=32)


class RenderRequest(BaseModel):
    locale: str = "tr"


ROOM_ROLES = ("doctor", "nurse", "paramedic", "pharmacist", "student")
TASK_STATUS_RANK = {"pending": 0, "claimed": 1, "done": 2}


class RoomTaskBody(BaseModel):
    """One order of the room's order and task loop. Only ``id`` is needed after the order."""

    id: str = Field(min_length=1, max_length=96)
    code: str | None = Field(default=None, max_length=64)
    kind: Literal["medication", "diagnostic", "intervention"] | None = None
    label_en: str | None = Field(default=None, max_length=160)
    label_tr: str | None = Field(default=None, max_length=160)
    detail_en: str | None = Field(default=None, max_length=240)
    detail_tr: str | None = Field(default=None, max_length=240)
    ordered_by: Literal[ROOM_ROLES] | None = None  # type: ignore[valid-type]
    assigned_role: Literal[ROOM_ROLES] | None = None  # type: ignore[valid-type]
    ai: bool = False


class MarSummary(BaseModel):
    outcome: Literal["given", "flagged", "blocked"]
    failures: list[str] = Field(default_factory=list, max_length=12)
    allergy_conflict: bool = False


class RoomTaskRequest(BaseModel):
    op: Literal["order", "claim", "complete"]
    task: RoomTaskBody
    role: Literal[ROOM_ROLES] | None = None  # type: ignore[valid-type]
    client_id: str | None = Field(default=None, max_length=64)
    # A medication completion carries the bedside check the executing role ran (five rights,
    # allergy band): "blocked" means withheld, nothing entered the course.
    mar: MarSummary | None = None


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


_WORKER_BOOTS: set[asyncio.Task[Any]] = set()


def _boot_worker_in_background(wm: Any) -> dict[str, Any] | None:
    """Start the on-demand GPU worker without blocking the request; None when it cannot launch."""
    refusal = wm._refusal() if hasattr(wm, "_refusal") else None
    if refusal is not None:
        return None

    async def boot() -> None:
        try:
            await wm.ensure_worker()
        except Exception as exc:  # noqa: BLE001 - surfaced through /admin/gpu/status and the next preflight
            log.warning("background GPU worker boot failed: %s", type(exc).__name__)

    task = asyncio.get_running_loop().create_task(boot(), name="acudx-gpu-boot")
    _WORKER_BOOTS.add(task)
    task.add_done_callback(_WORKER_BOOTS.discard)
    w = wm.store.active_worker()
    return {"status": w.status if w else "launching", "instance_type": w.instance_type if w else None}


async def _preflight(rt: OrchestrationRuntime, state: Any = None) -> JSONResponse | None:
    if rt.llm is None:
        return _unreachable(rt, None)
    resolver = getattr(getattr(state, "gateway", None), "resolver", None)
    routed = rt.llm.route_via_registry(resolver)
    probe = await rt.llm.probe("casegen")
    if not probe.get("reachable"):
        wm = getattr(state, "worker_manager", None)
        if not routed and wm is not None and not rt.settings.casegen_base_url:
            worker = _boot_worker_in_background(wm)
            if worker is not None:
                return _error(503, "model_warming",
                              "No model is serving yet: the on-demand GPU worker is starting (a cold boot takes "
                              "several minutes). No case was generated; retry when the worker is ready.",
                              worker=worker, retryable=True)
        return _unreachable(rt, None)
    return None


# --------------------------------------------------------------------------- #
# Generation                                                                   #
# --------------------------------------------------------------------------- #
async def _tail_sse(rt: OrchestrationRuntime, thread_id: str, after: int,
                    ctx: dict[str, Any] | None = None, *, follow: bool = False) -> AsyncIterator[str]:
    # The body runs after the request middleware returned, so the telemetry
    # context (route, tenant, user) captured in the handler is bound again here.
    token = bind_context(**(ctx or {"route": "/v2/case/generate/stream"}))
    loop = asyncio.get_running_loop()
    deadline = loop.time() + SSE_MAX_DURATION_S
    last = after
    finished = False
    try:
        async for eid, name, data in rt.staged.tail(thread_id, after, cap_s=SSE_MAX_DURATION_S, follow=follow):
            if not name:
                yield ": keepalive\n\n"
                continue
            last = eid
            yield _sse(name, data, eid)
            if not follow and (name == "done" or (name == "error" and data.get("fatal"))):
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
    denied = _signed_in_when_oidc(request, user) or _learner_guard(req.learner_id, user)
    if denied is not None:
        return denied
    rt = await get_runtime(request)
    blocked = await _preflight(rt, request.app.state)
    if blocked is not None:
        return blocked
    thread_id = rt.staged.start(_gen_request(req, user), _fresh_thread_id(rt, req.thread_id))
    ambient = current_context()
    ctx = {"route": ambient.route or request.url.path, "tenant": ambient.tenant,
           "user_hash": ambient.user_hash, "encounter_id": ambient.encounter_id}
    return _stream_response(_tail_sse(rt, thread_id, 0, ctx))


@router.get("/case/{thread_id}/events")
async def case_events(thread_id: str, request: Request, after: int = 0, follow: bool = False,
                      user: Optional[Principal] = Depends(optional_user)) -> Response:
    rt = await get_runtime(request)
    if _thread_for(rt, thread_id, user) is None:
        return _error(404, "thread_not_found", f"no case thread {thread_id!r}")
    last_id = request.headers.get("last-event-id") or ""
    if last_id.isdigit():
        after = max(after, int(last_id))
    return _stream_response(_tail_sse(rt, thread_id, after, follow=follow))


@router.post("/case/{thread_id}/room")
async def bind_room(thread_id: str, body: RoomRequest, request: Request,
                    user: Principal = Depends(current_user)) -> JSONResponse:
    """The owner binds the thread to a team room by the room's join code."""
    rt = await get_runtime(request)
    if _owned_thread(rt, thread_id, user) is None:
        return _error(404, "thread_not_found", f"no case thread {thread_id!r}")
    rt.cases.set_room(thread_id, body.room_code)
    return JSONResponse(content={"thread_id": thread_id, "room": True})


@router.post("/case/{thread_id}/join")
async def join_room_thread(thread_id: str, body: RoomRequest, request: Request,
                           user: Principal = Depends(current_user)) -> JSONResponse:
    """A team-room member joins the thread with the room's join code; a wrong code, a thread
    without a room or a missing thread all answer the same 404."""
    rt = await get_runtime(request)
    st = rt.cases.get(thread_id)
    if st is None or st.get("source") != "model" or not rt.cases.add_member(thread_id, user.sub, body.room_code):
        if _owned_thread(rt, thread_id, user) is None:
            return _error(404, "thread_not_found", f"no case thread {thread_id!r}")
    events = rt.cases.events(thread_id)
    return JSONResponse(content={"thread_id": thread_id, "member": True,
                                 "last_event_id": events[-1][0] if events else 0})


def _order_is_treatment(st: dict[str, Any], code: str) -> bool:
    """director.order_is_treatment against the thread's Director state (or its spec before
    the first step)."""
    if not code:
        return False
    try:
        held = st.get("director")
        probe = CaseState.model_validate(held) if isinstance(held, dict) else CaseState.from_spec(st["spec"])
    except Exception:  # noqa: BLE001 - an unreadable state keeps the order an order
        return False
    return D.order_is_treatment(probe, code)


def treatments_locked(st: dict[str, Any]) -> bool:
    """True while the thread has no safe treatment table (being written, or rejected by the
    safety review): nothing is administered until it lands (06b F30)."""
    if not st.get("opening") or "treatments" not in (st.get("layer_order") or []):
        return False        # not a staged thread (faculty-stored spec): its table is in the spec
    entry = (st.get("layers") or {}).get("treatments") or {}
    return entry.get("status") != "ready"


@router.post("/case/{thread_id}/task")
async def room_task(thread_id: str, body: RoomTaskRequest, request: Request,
                    user: Principal = Depends(current_user)) -> JSONResponse:
    """The room's order and task loop on the thread (doc 15 12.8): a member orders, another
    claims and completes. Every transition lands on the thread log as a ``task`` event, so every
    member sees the same queue. A medication given while the treatment table is missing or
    rejected is refused (``treatments_locked``); its effect on the patient is the Director step
    the executing member sends with the same rules as the solo encounter."""
    rt = await get_runtime(request)
    st = _thread_for(rt, thread_id, user)
    if st is None:
        return _error(404, "thread_not_found", f"no case thread {thread_id!r}")
    tid = body.task.id
    known = (st.get("room_tasks") or {}).get(tid)
    if body.op == "order":
        if known is None and (not body.task.code or not body.task.kind or not body.task.assigned_role):
            return _error(422, "invalid_task", "an order needs code, kind and assigned_role")
    elif known is None:
        return _error(409, "unknown_task", f"no order {tid!r} on this thread")
    kind = (known or {}).get("kind") or body.task.kind
    if (body.op == "complete" and kind == "medication" and (body.mar is None or body.mar.outcome != "blocked")
            and treatments_locked(st)):
        return _error(409, "treatments_locked",
                      "no safe treatment table for this patient yet; nothing can be administered until it lands")
    t_ms = int(((st.get("director") or {}).get("t_ms")) or 0)
    out: dict[str, Any] = {}
    changed: list[bool] = []

    def write(s: dict[str, Any]) -> None:
        tasks = dict(s.get("room_tasks") or {})
        cur = dict(tasks.get(tid) or {})
        before = dict(cur)
        if not cur:
            cur = {**body.task.model_dump(exclude_none=True), "status": "pending", "ordered_t_ms": t_ms}
        rank = TASK_STATUS_RANK.get(str(cur.get("status")), 0)
        if body.op == "claim" and rank < 1:
            cur.update(status="claimed", claimed_by=body.role or cur.get("assigned_role"), claimed_ai=body.task.ai)
        elif body.op == "complete" and rank < 2:
            cur.setdefault("claimed_by", body.role or cur.get("assigned_role"))
            cur.update(status="done", completed_by=body.role or cur.get("assigned_role"), completed_ai=body.task.ai,
                       completed_t_ms=t_ms)
            if body.mar is not None:
                cur["mar"] = body.mar.model_dump()
        tasks[tid] = cur
        s["room_tasks"] = dict(list(tasks.items())[-200:])
        out.update(cur)
        if cur != before:
            changed.append(True)

    rt.cases.update(thread_id, write)
    # A transition already applied (a replayed claim, a second Administer) is answered with the
    # stored task and not logged again.
    if changed:
        rt.staged.emit(thread_id, "task", {"thread_id": thread_id, "op": body.op, "task": out,
                                           "client_id": body.client_id})
    return JSONResponse(content={"thread_id": thread_id, "task": out})


@router.post("/case/generate")
async def generate(req: GenerateV2Request, request: Request,
                   user: Optional[Principal] = Depends(optional_user)) -> JSONResponse:
    """The staged run, answered when S1 and the core layers are in (authoring, API clients)."""
    denied = _signed_in_when_oidc(request, user) or _learner_guard(req.learner_id, user)
    if denied is not None:
        return denied
    rt = await get_runtime(request)
    if rt.llm is None:
        return _unreachable(rt, None)
    rt.llm.route_via_registry(getattr(getattr(request.app.state, "gateway", None), "resolver", None))
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
    extra = ""
    if layer == "debrief" and body is not None and body.diagnosis:
        # Debrief on commit: the outcome is recorded on the thread and named in the prompt.
        diagnosis = {"code": str(body.diagnosis.get("code") or "")[:32],
                     "display": str(body.diagnosis.get("display") or "")[:120]}
        extra = debrief_extra(diagnosis)
        rt.cases.update(thread_id, lambda s: s.update(outcome={**(s.get("outcome") or {}),
                                                               "diagnosis": diagnosis["code"] or diagnosis["display"],
                                                               "display": diagnosis["display"]}))
    try:
        entry = await asyncio.wait_for(
            rt.staged.ensure_layer(thread_id, layer, reason=(body.reason if body else None) or "access", extra=extra),
            LAYER_WAIT_S)
    except asyncio.TimeoutError:
        return _error(504, "layer_timeout", f"layer {layer} is still being written", retryable=True)
    if entry.get("status") != "ready":
        err = entry.get("error") or "layer_failed"
        return _error(503 if err == "model_unreachable" else 502, err,
                      entry.get("reason") or f"layer {layer} could not be written", retryable=True,
                      reason=entry.get("reason"), issues=entry.get("issues") or [])
    _mark_seen(rt, thread_id, [layer])
    now = rt.cases.get(thread_id) or {}
    return JSONResponse(content={"thread_id": thread_id, "layer": layer, "status": "ready",
                                 "data": entry.get("data"), "spec": now.get("spec")})


@router.post("/case/{thread_id}/layer/{layer}/render")
async def render_layer(thread_id: str, layer: str, body: RenderRequest, request: Request,
                       user: Optional[Principal] = Depends(optional_user)) -> JSONResponse:
    """A rendering of a layer already seen in another UI language (TR for an EN case): one call
    per layer, cached on the thread. The source text stays authoritative."""
    rt = await get_runtime(request)
    if _thread_for(rt, thread_id, user) is None:
        return _error(404, "thread_not_found", f"no case thread {thread_id!r}")
    if not renderable(layer):
        return _error(422, "invalid_layer", f"unknown layer {layer!r}")
    try:
        entry = await asyncio.wait_for(rt.staged.render_layer(thread_id, layer, body.locale), LAYER_WAIT_S)
    except ValueError:
        return _error(422, "unsupported_locale", f"no {body.locale!r} rendering for this case (its source locale, "
                                                 "or a locale without renderings)")
    except LookupError:
        return _error(409, "layer_not_ready", f"layer {layer} is not written yet")
    except asyncio.TimeoutError:
        return _error(504, "render_timeout", f"the rendering of {layer} is still being written", retryable=True)
    if entry.get("status") != "ready":
        err = entry.get("error") or "rendering_failed"
        return _error(503 if err == "model_unreachable" else 502, err, f"layer {layer} could not be rendered",
                      retryable=True, issues=entry.get("issues") or [])
    now = rt.cases.get(thread_id) or {}
    return JSONResponse(content={"thread_id": thread_id, "layer": layer, "locale": body.locale, "status": "ready",
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
    # An ordered treatment (oxygen, an antibiotic) is a treatment step: it reads the treatment
    # layer and is refused while the table is locked, like an administered one.
    if action.kind == "order" and _order_is_treatment(st, action.ref):
        action = action.model_copy(update={"kind": "treatment"})
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
    # The same rule as the solo encounter (06b F30): no Director treatment step while the
    # thread has no safe treatment table.
    if action.kind == "treatment" and treatments_locked(st):
        return _error(409, "treatments_locked",
                      "no safe treatment table for this patient yet; nothing can be administered until it lands")
    before = st.get("director")
    try:
        prev_state = CaseState.model_validate(before) if isinstance(before, dict) else None
    except Exception as exc:  # noqa: BLE001 - the Director model changed shape under a stored state
        return _error(409, "invalid_case_state", str(exc)[:300])
    # director.director_step reads and writes the record's "director" key; the view merges
    # only that key, so a layer landing during the narrator call is never overwritten.
    view = DirectorStoreView(rt.cases)
    try:
        # A first step builds the Director from the source text, never from a rendering.
        first = source_spec(st) if not isinstance(before, dict) and st.get("opening") and st.get("condition") else None
        new_state, visible, notes = await D.director_step(view, req.thread_id, action, spec=first, llm=llm)
    except LookupError as exc:
        return _error(409, "opening_not_ready", str(exc)[:200])
    fired_now = [c for c in (visible.get("complications_fired") or []) if c]

    def write(s: dict[str, Any]) -> None:
        refresh_director(s)
        for name in needed:
            entry = (s.get("layers") or {}).get(name)
            if entry is not None:
                entry["seen"] = True

    rt.cases.update(req.thread_id, write)
    # Every member of the room follows the same Director: the step lands on the thread log.
    rt.staged.emit(req.thread_id, "director", {
        "thread_id": req.thread_id, "client_id": req.client_id, "action": action.model_dump(mode="json"),
        "case_state": new_state.model_dump(mode="json"), "patient_visible_changes": visible,
        "director_notes": notes,
    })
    _record_errors(rt, req.learner_id, prev_state or CaseState.from_spec(st["spec"], case_id=req.thread_id),
                   new_state)
    # Live video calls on this thread follow the new state (face crossfaded, voice re-styled), in the
    # background so the step answers at once (docs/architecture/18 section 6.6).
    if getattr(request.app.state, "avatar_sessions", None) is not None:
        from server.voice.avatar.routes import notify_director  # noqa: PLC0415 - voice is optional here

        rt.staged.spawn(notify_director(request.app, req.thread_id))
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
        "case_state": new_state.model_dump(),
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
    """Faculty diagnostic: one stateless step of a supplied model-generated spec; nothing is
    written to CaseStore. Learners always step by ``thread_id`` (the state is server-held), and
    a client-sent ``case_state`` is never accepted."""
    if user is None or not user.has("faculty"):
        return _error(422, "thread_required",
                      "send the thread_id of a case generated on request; the case state is held by the server")
    if req.spec is None:
        return _error(422, "missing_spec", "send thread_id, or (faculty diagnostics) a model-generated spec")
    source = str((req.spec.get("meta") or {}).get("source") or "")
    if source != "model":
        return _error(422, "not_model_generated", f"only model-generated cases can be stepped (meta.source={source!r})")
    state = CaseState.from_spec(req.spec)
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
