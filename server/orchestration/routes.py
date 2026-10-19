"""HTTP surface for the case generator v2 and the Clinical Director.

    POST /v2/case/generate          run the graph, return spec + trace summary
    POST /v2/case/generate/stream   SSE: one event per graph node, then ``done``
    POST /v2/case/template          deterministic template, meta.source="template"
    POST /v2/director/step          one Director step for a learner action
    GET  /v2/case/{thread_id}       checkpoint read (spec, status, trace)
    GET  /v2/learner/{learner_id}   learner memory profile

Honesty rule: when the model endpoint is unreachable the generate routes answer
``503 model_unreachable``; when the model answers but not with a valid case,
``502 model_output_invalid``. A template is never returned as a generated case.

The :class:`OrchestrationRuntime` (checkpointer, store, LLM client, compiled
graph) is created lazily on first use and cached on ``app.state`` so that
``server/app.py`` only needs to mount the router. Tests build their own runtime
with an in-process transport and swap it in.
"""

from __future__ import annotations

import json
import os
import uuid
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Optional

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.store.base import BaseStore
from pydantic import BaseModel, Field

from server.config import EgressBlocked, Settings, get_settings
from server.orchestration.director import Action, CaseState, anext_state
from server.orchestration.graph import (
    CaseGenDeps, build_casegen_graph, initial_state, template_spec,
)
from server.orchestration.llm import ModelOutputInvalid, ModelUnreachable, StructuredLLM
from server.orchestration.memory import LearnerMemory, memory_store
from server.orchestration.trace import summarize

router = APIRouter(prefix="/v2", tags=["orchestration"])

# Node order the SSE stream announces up front so a UI can render a progress rail.
PIPELINE_NODES: tuple[str, ...] = (
    "sample_condition", "author", "clinical_consistency", "safety_dosing", "pedagogy",
    "aggregate", "repair", "ground", "finalize",
)


# --------------------------------------------------------------------------- #
# Runtime                                                                      #
# --------------------------------------------------------------------------- #
@dataclass
class OrchestrationRuntime:
    settings: Settings
    llm: Optional[StructuredLLM]
    checkpointer: BaseCheckpointSaver
    store: BaseStore
    memory: LearnerMemory
    graph: Any
    db_path: Optional[str] = None
    _conn: Any = field(default=None, repr=False)

    @classmethod
    async def create(
        cls,
        settings: Settings | None = None,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        db_path: str | None = None,
        max_repairs: int = 2,
        in_memory: bool = False,
    ) -> "OrchestrationRuntime":
        settings = settings or get_settings()
        llm: StructuredLLM | None
        try:
            llm = StructuredLLM(settings, transport=transport)
        except EgressBlocked:
            # AIRGAPPED with a non-local endpoint: nothing may be dialled. The
            # routes report 503 for every model-backed call.
            llm = None
        path = None if in_memory else (db_path or settings.acudx_db_path)
        conn = None
        if path:
            import aiosqlite
            from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

            os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
            conn = await aiosqlite.connect(path)
            checkpointer: BaseCheckpointSaver = AsyncSqliteSaver(conn)
            await checkpointer.setup()
        else:
            checkpointer = InMemorySaver()
        store = memory_store(path)
        memory = LearnerMemory(store)
        deps = CaseGenDeps(llm=llm, memory=memory, max_repairs=max_repairs)
        graph = build_casegen_graph(deps).compile(checkpointer=checkpointer, store=store)
        return cls(settings=settings, llm=llm, checkpointer=checkpointer, store=store,
                   memory=memory, graph=graph, db_path=path, _conn=conn)

    async def aclose(self) -> None:
        if self.llm is not None:
            await self.llm.aclose()
        if self._conn is not None:
            await self._conn.close()
            self._conn = None

    def config(self, thread_id: str) -> dict[str, Any]:
        return {"configurable": {"thread_id": thread_id}}


async def get_runtime(request: Request) -> OrchestrationRuntime:
    rt = getattr(request.app.state, "orchestration", None)
    if rt is None:
        rt = await OrchestrationRuntime.create(getattr(request.app.state, "settings", None))
        request.app.state.orchestration = rt
    return rt


# --------------------------------------------------------------------------- #
# Wire models                                                                  #
# --------------------------------------------------------------------------- #
class GenerateV2Request(BaseModel):
    system: str | None = None
    difficulty: int | None = Field(default=None, ge=1, le=5)
    complaint: str | None = None
    locale: str = "en"
    seed: int | None = None
    learner_id: str | None = None
    session_id: str | None = None
    thread_id: str | None = None


class DirectorStepRequest(BaseModel):
    case_state: dict[str, Any] | None = None
    spec: dict[str, Any] | None = None       # used to build the state when case_state is absent
    action: dict[str, Any]
    learner_id: str | None = None
    use_model: bool = True


def _error(status: int, code: str, detail: str, **extra: Any) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": code, "detail": detail, **extra})


def _unreachable(rt: OrchestrationRuntime, exc: Exception | None) -> JSONResponse:
    ep = rt.llm.endpoint("casegen") if rt.llm is not None else None
    return _error(
        503, "model_unreachable",
        "The case generator model endpoint could not be reached; no case was generated. "
        "A deterministic template is available at POST /v2/case/template (meta.source=template).",
        endpoint=(ep.base_url if ep else None), model=(ep.model if ep else None),
        cause=(f"{type(exc).__name__}: {str(exc)[:200]}" if exc else "AIRGAPPED blocks the configured endpoint"),
    )


# --------------------------------------------------------------------------- #
# /v2/case/generate                                                            #
# --------------------------------------------------------------------------- #
@router.post("/case/generate")
async def generate(req: GenerateV2Request, request: Request) -> JSONResponse:
    rt = await get_runtime(request)
    if rt.llm is None:
        return _unreachable(rt, None)
    thread_id = req.thread_id or str(uuid.uuid4())
    state = initial_state(req.model_dump(exclude={"thread_id"}), thread_id)
    try:
        out = await rt.graph.ainvoke(state, rt.config(thread_id))
    except ModelUnreachable as exc:
        return _unreachable(rt, exc)
    except ModelOutputInvalid as exc:
        return _error(502, "model_output_invalid", str(exc)[:300], thread_id=thread_id)
    trace = out.get("trace") or []
    return JSONResponse(content={
        "thread_id": thread_id,
        "spec": out["spec"],
        "trace_summary": summarize(trace),
        "trace": trace,
        "council": out.get("council"),
    })


def _sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


async def _stream_events(rt: OrchestrationRuntime, req: GenerateV2Request) -> AsyncIterator[str]:
    thread_id = req.thread_id or str(uuid.uuid4())
    yield _sse("start", {"thread_id": thread_id, "pipeline": list(PIPELINE_NODES)})
    state = initial_state(req.model_dump(exclude={"thread_id"}), thread_id)
    final: dict[str, Any] | None = None
    trace: list[dict[str, Any]] = []
    try:
        async for update in rt.graph.astream(state, rt.config(thread_id), stream_mode="updates"):
            for node, payload in (update or {}).items():
                if not isinstance(payload, dict):
                    continue
                events = payload.get("trace") or []
                trace.extend(events)
                data: dict[str, Any] = {"node": node, "status": payload.get("status"), "trace": events}
                if node == "aggregate":
                    data["council"] = payload.get("council")
                if node == "finalize":
                    final = payload.get("spec")
                yield _sse("node", data)
    except ModelUnreachable as exc:
        yield _sse("error", {"error": "model_unreachable", "status": 503, "detail": str(exc)[:300], "thread_id": thread_id})
        return
    except ModelOutputInvalid as exc:
        yield _sse("error", {"error": "model_output_invalid", "status": 502, "detail": str(exc)[:300], "thread_id": thread_id})
        return
    yield _sse("done", {"thread_id": thread_id, "spec": final, "trace_summary": summarize(trace)})


@router.post("/case/generate/stream")
async def generate_stream(req: GenerateV2Request, request: Request) -> Response:
    rt = await get_runtime(request)
    if rt.llm is None:
        return _unreachable(rt, None)
    probe = await rt.llm.probe("casegen")
    if not probe.get("reachable"):
        return _unreachable(rt, None)
    return StreamingResponse(
        _stream_events(rt, req), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/case/template")
async def template(req: GenerateV2Request) -> JSONResponse:
    spec = template_spec(req.model_dump(exclude={"thread_id"}))
    return JSONResponse(content={"spec": spec, "trace_summary": None})


@router.get("/case/{thread_id}")
async def read_case(thread_id: str, request: Request) -> JSONResponse:
    rt = await get_runtime(request)
    snapshot = await rt.graph.aget_state(rt.config(thread_id))
    values = snapshot.values if snapshot is not None else {}
    if not values:
        return _error(404, "thread_not_found", f"no checkpoint for thread {thread_id!r}")
    trace = values.get("trace") or []
    return JSONResponse(content={
        "thread_id": thread_id,
        "status": values.get("status"),
        "spec": values.get("spec"),
        "council": values.get("council"),
        "condition": values.get("condition"),
        "trace_summary": summarize(trace),
        "trace": trace,
        "next": list(snapshot.next or ()) if snapshot is not None else [],
    })


# --------------------------------------------------------------------------- #
# /v2/director/step                                                            #
# --------------------------------------------------------------------------- #
@router.post("/director/step")
async def director_step(req: DirectorStepRequest, request: Request) -> JSONResponse:
    rt = await get_runtime(request)
    if req.case_state is not None:
        try:
            state = CaseState.model_validate(req.case_state)
        except Exception as exc:  # pydantic.ValidationError
            return _error(422, "invalid_case_state", str(exc)[:300])
    elif req.spec is not None:
        state = CaseState.from_spec(req.spec)
    else:
        return _error(422, "missing_case_state", "send case_state (from a previous step) or spec")
    try:
        action = Action.model_validate(req.action)
    except Exception as exc:  # pydantic.ValidationError
        return _error(422, "invalid_action", str(exc)[:300])
    llm = rt.llm if (req.use_model and rt.llm is not None) else None
    new_state, visible, notes = await anext_state(state, action, llm)
    if req.learner_id:
        known = {(e["at_ms"], e["kind"], e["detail"]) for e in state.errors}
        for err in new_state.errors:
            if (err["at_ms"], err["kind"], err["detail"]) not in known:
                rt.memory.record_error(req.learner_id, err["kind"], err["detail"], new_state.system or new_state.condition_id)
    return JSONResponse(content={
        "case_state": new_state.model_dump(),
        "patient_visible_changes": visible,
        "director_notes": notes,
    })


@router.get("/learner/{learner_id}")
async def learner_profile(learner_id: str, request: Request) -> dict[str, Any]:
    rt = await get_runtime(request)
    return rt.memory.profile(learner_id)
