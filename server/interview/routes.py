"""``POST /v2/case/{thread_id}/interview``: one typed (or transcribed) student message, one
in-character patient reply grounded in the server-side case.

Pipeline (docs/architecture/20-chat-contract.md):

1. guard: rules plus the classifier model label the message
   (:func:`server.interview.guard.classify_message`);
2. history: a clinical question that maps to a history intent makes sure that history layer
   is written (the staged generator writes it lazily) and marks it seen;
3. persona: the patient model answers from :func:`server.interview.patient.patient_view`
   (the thread's story, the Director's live state, what staff told the patient); a
   self-harm or abuse disclosure gets the crisis-resource reply instead, without a model;
4. gates: the FactAssertionGate strips unsanctioned numbers, and a reply that names the
   diagnosis is scrubbed and flagged;
5. tutor: with ``guidance`` on, up to three suggested actions; with it off, none;
6. the exchange is appended to the thread's interview log (server-held transcript).

With a live patient video call on the thread (``call_session_id``, the caller's own call), the reply
is spoken into the call while it is written (server/voice/avatar/turn_speech.py,
docs/architecture/18 section 6.3.9): the persona call starts speculatively next to the guard (its
prompt from the rules' label; kept only when the guard's label gives the very same prompt, else
restarted), each clause passes the gates below before it is spoken, and nothing is spoken before
the guard has labelled the message. ``meta.voice`` tells the browser the call already speaks it
and ``meta.timings`` gives every hop.

Honesty rule: when no patient model answers, the route returns ``503 model_unreachable``.
It never invents a reply; the client shows its own labelled offline path instead.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import AliasChoices, BaseModel, Field

from server.auth.deps import Principal, optional_user
from server.config import EgressBlocked
from server.interview import tutor as T
from server.interview.guard import GuardDecision, classify_message, rule_classify
from server.interview.patient import forbidden_terms, leaks, patient_view, persona_turn
from server.model_gateway import GatewayError
from server.orchestration.routes import _error, _mark_seen, _thread_for, get_runtime
from server.orchestration.staged import intent_cluster
from server.persona import fact_assertion_gate
from server.scope_guard import crisis_resources

log = logging.getLogger("acudx.interview")

router = APIRouter(prefix="/v2", tags=["interview"])

# How long a question waits for its history layer to be written (the patient then knows it).
HISTORY_WAIT_S = 25.0
TRANSCRIPT_CAP = 80
PERSONA_MAX_TOKENS = 300


class InterviewRequest(BaseModel):
    model_config = {"populate_by_name": True}
    message: str = Field(min_length=1, max_length=2000,
                         validation_alias=AliasChoices("message", "text", "learner_msg", "utterance"))
    locale: Optional[str] = Field(default=None, max_length=8)
    guidance: bool = False
    client_id: Optional[str] = Field(default=None, max_length=64)
    voiced: bool = False
    # The caller's live patient video call on this thread: the reply is spoken into it as it is written.
    call_session_id: Optional[str] = Field(default=None, min_length=8, max_length=64)


def _locale(req: InterviewRequest, st: dict[str, Any], decision: GuardDecision) -> str:
    if decision.language in ("en", "tr"):
        return decision.language
    loc = (req.locale or st.get("locale") or "en").lower()
    return "tr" if loc.startswith("tr") else "en"


def _transcript(st: dict[str, Any]) -> list[dict[str, Any]]:
    return [t for t in (st.get("interview") or []) if isinstance(t, dict)]


async def _ensure_history(rt: Any, thread_id: str, intent: Optional[str]) -> Optional[str]:
    """Write (or await) the history layer of ``intent`` and mark it seen; its name or None."""
    cluster = intent_cluster(intent) if intent else None
    if not cluster:
        return None
    layer = f"history.{cluster}"
    try:
        entry = await asyncio.wait_for(rt.staged.ensure_layer(thread_id, layer, reason="interview"), HISTORY_WAIT_S)
    except (asyncio.TimeoutError, KeyError):
        return None
    except Exception:  # noqa: BLE001 - a failed layer leaves the patient with what is already known
        log.info("history layer %s not available for %s", layer, thread_id, exc_info=True)
        return None
    if entry.get("status") != "ready":
        return None
    _mark_seen(rt, thread_id, [layer])
    return layer


def _live_call(request: Request, body: InterviewRequest, thread_id: str, user: Optional[Principal]) -> Any:
    """The caller's connected live video call on this thread (MuseTalk runner), else None."""
    if not body.call_session_id or user is None:
        return None
    store = getattr(request.app.state, "avatar_sessions", None)
    s = store.get(body.call_session_id, user_hash=user.user_hash) if store is not None else None
    if s is None or s.provider != "musetalk" or not s.worker_session or s.thread_id != thread_id:
        return None
    return s


def _scrubber(st: dict[str, Any], view: Any) -> Any:
    """The reply's gates for one spoken piece: FactAssertionGate, then the diagnosis scrub."""
    terms = forbidden_terms(st)

    def scrub(text: str) -> str:
        out = fact_assertion_gate(text, {"sanctioned_facts": view.told}).utterance
        for term in leaks(out, terms):
            out = out.replace(term, "...")
        return out
    return scrub


def _call_speaker(request: Request, call: Any, *, persona: Any, timings: Any, gate: Any) -> Any:
    """A CallSpeaker for ``call`` on its own worker, or None when the call cannot speak now."""
    from server.voice.avatar import state_sync as sync_mod  # noqa: PLC0415 - voice is optional
    from server.voice.avatar.routes import _session_worker  # noqa: PLC0415
    from server.voice.avatar.turn_speech import CallSpeaker  # noqa: PLC0415

    svc = getattr(request.app.state, "voice", None)
    worker = _session_worker(svc, call) if svc is not None else None
    if worker is None:
        return None
    style = sync_mod.voice_for(call.appearance)
    if style["silent"]:
        return None
    return CallSpeaker(svc=svc, session=call, worker=worker, lang=call.lang, sex=call.sex, age=call.age,
                       speed=float(style["speed"]), gate=gate, timings=timings).start(persona)


@router.post("/case/{thread_id}/interview")
async def interview(thread_id: str, body: InterviewRequest, request: Request,
                    user: Optional[Principal] = Depends(optional_user)) -> JSONResponse:
    rt = await get_runtime(request)
    st = _thread_for(rt, thread_id, user)
    if st is None:
        return _error(404, "thread_not_found", f"no case thread {thread_id!r}")
    if not st.get("opening"):
        return _error(409, "opening_not_ready", "the case opening is not ready yet")
    gateway = getattr(request.app.state, "gateway", None)
    t0 = time.monotonic()
    message = body.message.strip()
    complaint = str((st.get("opening") or {}).get("chief_complaint") or "")
    call = _live_call(request, body, thread_id, user)
    from server.voice.avatar.turn_speech import PersonaStream, TurnTimings  # noqa: PLC0415

    timings = TurnTimings(t0=t0)
    speculative = None
    spec_speaker = None
    if call is not None and gateway is not None:
        # Speculative persona next to the guard: the rules' label and language give the prompt; it is
        # kept only if the guard's decision produces exactly the same prompt (and spoken only after it).
        rules = rule_classify(message, {"scope_terms": [complaint]})
        if not (rules.label == "unsafe" and rules.reason in ("self_harm_disclosure", "abuse_disclosure")):
            loc0 = rules.language if rules.language in ("en", "tr") else _locale(body, st, rules)
            msgs0 = persona_turn(patient_view(st, locale=loc0), _transcript(st), message, rules.label)
            speculative = PersonaStream(gateway, msgs0, max_tokens=PERSONA_MAX_TOKENS, timings=timings,
                                        speculative=True)
            # Its TTS starts too (held back from the call until the guard confirms the prompt).
            spec_speaker = _call_speaker(request, call, persona=speculative, timings=timings,
                                         gate=_scrubber(st, patient_view(st, locale=loc0)))

    decision = await classify_message(gateway, message, case_context={"scope_terms": [complaint]},
                                      chief_complaint=complaint)
    timings.mark("guard_ms")
    locale = _locale(body, st, decision)
    layer = await _ensure_history(rt, thread_id, decision.intent) if decision.label == "clinical" else None
    timings.mark("history_ms")
    st = rt.cases.get(thread_id) or st
    view = patient_view(st, locale=locale)
    transcript = _transcript(st)

    flags: list[dict[str, Any]] = []
    meta: dict[str, Any] = {"guard_source": decision.source, "guard_model": decision.model,
                            "guard_rule": decision.rule}
    speaker = None
    if decision.label == "unsafe" and decision.reason in ("self_harm_disclosure", "abuse_disclosure"):
        # The Safety Interceptor breaks character with real support resources; no model call.
        if speculative is not None:
            speculative.cancel()
        if spec_speaker is not None:
            spec_speaker.cancel()
        reply = crisis_resources(locale)
        flags.append({"type": "safety_trigger", "reason": decision.reason, "locale": locale})
        meta.update(source="safety")
    else:
        if gateway is None:
            return _error(503, "model_unreachable", "no patient model is configured", retryable=True)
        msgs = persona_turn(view, transcript, message, decision.label)
        terms = forbidden_terms(st)
        scrub = _scrubber(st, view)

        persona = None
        if speculative is not None:
            if speculative.messages == msgs:
                persona, speaker = speculative, spec_speaker
                meta["speculative"] = "kept"
            else:
                speculative.cancel()
                if spec_speaker is not None:
                    spec_speaker.cancel()
                meta["speculative"] = "restarted"
        if call is not None:
            if persona is None:
                persona = PersonaStream(gateway, msgs, max_tokens=PERSONA_MAX_TOKENS, timings=timings)
                speaker = _call_speaker(request, call, persona=persona, timings=timings, gate=scrub)
            if speaker is not None:
                speaker.release()
        try:
            res = await persona.result() if persona is not None else await gateway.chat(
                msgs, task="patient", max_tokens=PERSONA_MAX_TOKENS)
        except (GatewayError, EgressBlocked) as exc:
            if speaker is not None:
                speaker.cancel()
            return _error(503, "model_unreachable",
                          "The patient model could not be reached; no reply was generated.",
                          cause=f"{type(exc).__name__}: {str(exc)[:200]}", retryable=True,
                          guard=decision.wire(locale))
        timings.mark("persona_done_ms")
        reply = (res.text or "").strip()
        if not reply:
            if speaker is not None:
                speaker.cancel()
            return _error(502, "model_output_invalid", "the patient model returned an empty reply", retryable=True)
        gate = fact_assertion_gate(reply, {"sanctioned_facts": view.told})
        reply = gate.utterance
        flags += [f.model_dump() for f in gate.flags]
        leaked = leaks(reply, terms)
        if leaked:
            for term in leaked:
                reply = reply.replace(term, "...")
            flags.append({"type": "diagnosis_leak", "span": leaked[0][:60]})
        meta.update(source="model", model=res.model, provider=res.provider, latency_ms=round(res.latency_ms, 1),
                    usage=res.usage)
    if speaker is not None:
        meta["voice"] = {"spoken_by": "call", "session_id": call.id}

    actions: list[dict[str, Any]] = []
    if body.guidance:
        asked = {t.get("intent") for t in transcript if t.get("intent")}
        if decision.intent:
            asked.add(decision.intent)
        actions, meta["tutor_source"] = await T.suggest(gateway, st, view, transcript + [
            {"role": "doctor", "text": message}, {"role": "patient", "text": reply}], asked=asked, locale=locale)

    now = time.time()

    def log_turn(s: dict[str, Any]) -> None:
        log_ = list(s.get("interview") or [])
        log_.append({"role": "doctor", "text": message[:2000], "ts": now, "label": decision.label,
                     "intent": decision.intent, "voiced": body.voiced})
        log_.append({"role": "patient", "text": reply[:2000], "ts": now, "source": meta.get("source")})
        s["interview"] = log_[-TRANSCRIPT_CAP:]

    rt.cases.update(thread_id, log_turn)
    meta["total_ms"] = round((time.monotonic() - t0) * 1000.0, 1)
    meta["timings"] = timings.public()
    return JSONResponse(content={
        "thread_id": thread_id,
        "reply": reply,
        "guard": decision.wire(locale),
        "actions": actions,
        "intent": decision.intent,
        "layer": layer,
        "state_advance": decision.label == "clinical",
        "flags": flags,
        "meta": meta,
    })


@router.get("/case/{thread_id}/interview")
async def interview_log(thread_id: str, request: Request,
                        user: Optional[Principal] = Depends(optional_user)) -> JSONResponse:
    """The server-held interview transcript of a thread (reload, room members)."""
    rt = await get_runtime(request)
    st = _thread_for(rt, thread_id, user)
    if st is None:
        return _error(404, "thread_not_found", f"no case thread {thread_id!r}")
    turns = [{k: t.get(k) for k in ("role", "text", "ts", "label", "intent")} for t in _transcript(st)]
    return JSONResponse(content={"thread_id": thread_id, "turns": turns})


__all__ = ["router"]
