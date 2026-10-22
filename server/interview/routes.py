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

Latency (production 2026-10-22: 12.3 s to the first typed reply on a fever case): the persona call starts
next to the guard on every question (kept only when the guard's label gives the same prompt), a typed
question waits at most ``HISTORY_TYPED_WAIT_S`` for a history layer still being written (the patient then
answers from what is known, unsure of details, and the layer is written to agree with that answer and is
marked seen once ready), and the tutor runs beside the persona.

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
# On a live call, how long the voice waits for a layer still being written before the patient says a short
# stall line; the answer follows in the same breath once the layer is there (docs/architecture/18 6.3.11).
# Live 2026-10-22 such a question waited 2.6 to 23 s in silence.
HISTORY_STALL_AFTER_S = 0.8
# Short and fact-free, in the reply's language; one is picked per question so they vary.
STALL_LINES = {
    "en": ("Hmm, let me think.", "Give me a moment.", "Let me think about that."),
    "tr": ("Hmm, bir düşüneyim.", "Bir saniye, düşüneyim.", "Şöyle bir düşüneyim."),
}


# A typed question waits this long for a history layer that is still being written; after that the patient answers
# from what is already known (the opening, the kernel's allergies, the layers already written). Production
# 2026-10-22: the first typed question, asked as the case opened, waited 12 s for the kernel and the layer.
HISTORY_TYPED_WAIT_S = 1.0
# History layers a typed answer did not wait for: kept referenced until written (they mark themselves seen).
_LATE_LAYERS: set[asyncio.Task[Any]] = set()


def stall_line(locale: str, message: str) -> str:
    lines = STALL_LINES["tr" if str(locale or "").startswith("tr") else "en"]
    return lines[sum(map(ord, message)) % len(lines)]
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


def _layer_ready(st: dict[str, Any], layer: str) -> bool:
    return ((st.get("layers") or {}).get(layer) or {}).get("status") == "ready"


class StalledPersona:
    """A live call's reply while its history layer is still being written: a stall line at once, then the
    persona's answer from the case with that layer once it is there (or without it after HISTORY_WAIT_S, as a
    typed question would get it). Same surface as PersonaStream (``text``, ``done``, ``updated``,
    ``result()``, ``cancel()``) so the CallSpeaker speaks both as one utterance."""

    def __init__(self, stall: str, history: "asyncio.Task[Any]", build: Any, *, timings: Any) -> None:
        self.stall = stall
        self.text = stall
        self.done = False
        self.messages: list[dict[str, str]] = []
        self.updated = asyncio.Event()
        self.updated.set()
        self.timings = timings
        self._history = history
        self._build = build
        self.inner: Any = None
        self.task: asyncio.Task[Any] = asyncio.get_running_loop().create_task(self._run())

    async def _run(self) -> Any:
        try:
            try:
                await asyncio.shield(self._history)
            except Exception:  # noqa: BLE001 - the answer then comes from what is already written
                pass
            if self.timings is not None:
                self.timings.mark("history_ready_ms")
            self.inner = self._build()
            self.messages = self.inner.messages
            while True:
                self.inner.updated.clear()
                body = self.inner.text.strip()
                self.text = f"{self.stall} {body}" if body else self.stall
                self.updated.set()
                if self.inner.done:
                    break
                await self.inner.updated.wait()
            return await self.inner.result()
        finally:
            self.done = True
            self.updated.set()

    async def result(self) -> Any:
        return await self.task

    def cancel(self) -> None:
        self.task.cancel()
        if self.inner is not None:
            self.inner.cancel()


# TTS connection warm-ups in flight (kept referenced until done).
_PREWARMS: set[asyncio.Task[Any]] = set()


def _live_call(request: Request, body: InterviewRequest, thread_id: str, user: Optional[Principal]) -> Any:
    """The caller's connected live video call on this thread (MuseTalk runner), else None."""
    if not body.call_session_id or user is None:
        return None
    store = getattr(request.app.state, "avatar_sessions", None)
    s = store.get(body.call_session_id, user_hash=user.user_hash) if store is not None else None
    if s is None or s.provider != "musetalk" or not s.worker_session or s.thread_id != thread_id:
        return None
    return s


def _scrubber(st: dict[str, Any], view: Any, lang: str | None = None) -> Any:
    """The reply's gates for one spoken piece: FactAssertionGate, then the diagnosis scrub."""
    terms = forbidden_terms(st)

    def scrub(text: str) -> str:
        out = fact_assertion_gate(text, {"sanctioned_facts": view.told}, lang=lang).utterance
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
    svc = getattr(request.app.state, "voice", None)
    if call is not None and svc is not None and hasattr(svc, "prewarm_tts"):
        # Open the TTS connection while the guard and the persona run (about 1 s), so the first clause
        # does not pay a TLS handshake: live 2026-10-22 an idle connection was gone by the next question
        # (0.45 s through the sandbox's proxy; httpx drops idle connections after 5 s anywhere).
        _bg = asyncio.get_running_loop().create_task(svc.prewarm_tts(call.lang, getattr(call, "worker_origin", None)))
        _PREWARMS.add(_bg)
        _bg.add_done_callback(_PREWARMS.discard)
    if gateway is not None:
        # Speculative persona next to the guard: the rules' label and language give the prompt; it is
        # kept only if the guard's decision produces exactly the same prompt (and, on a call, spoken only
        # after it). Typed questions too: the guard (0.7 to 8 s on Claude Haiku) no longer adds to the reply.
        rules = rule_classify(message, {"scope_terms": [complaint]})
        if not (rules.label == "unsafe" and rules.reason in ("self_harm_disclosure", "abuse_disclosure")):
            loc0 = rules.language if rules.language in ("en", "tr") else _locale(body, st, rules)
            msgs0 = persona_turn(patient_view(st, locale=loc0), _transcript(st), message, rules.label)
            speculative = PersonaStream(gateway, msgs0, max_tokens=PERSONA_MAX_TOKENS, timings=timings,
                                        speculative=True, task="patient_live" if call is not None else "patient")
            if call is not None:
                # Its TTS starts too (held back from the call until the guard confirms the prompt).
                spec_speaker = _call_speaker(request, call, persona=speculative, timings=timings,
                                             gate=_scrubber(st, patient_view(st, locale=loc0), loc0))

    decision = await classify_message(gateway, message, case_context={"scope_terms": [complaint]},
                                      chief_complaint=complaint)
    timings.mark("guard_ms")
    locale = _locale(body, st, decision)
    tutor_task: Optional[asyncio.Future[Any]] = None
    if body.guidance and gateway is not None and not (
            decision.label == "unsafe" and decision.reason in ("self_harm_disclosure", "abuse_disclosure")):
        # Beside the history wait and the persona, not after them: it reads the question (the reply adds
        # little to what to do next), so the attending's actions no longer add 2 s to the reply.
        _tr = _transcript(st)
        asked = {t.get("intent") for t in _tr if t.get("intent")}
        if decision.intent:
            asked.add(decision.intent)
        tutor_task = asyncio.ensure_future(T.suggest(gateway, st, patient_view(st, locale=locale), _tr + [
            {"role": "doctor", "text": message}], asked=asked, locale=locale))
    history_task = None
    history_meta: dict[str, Any] = {}
    cluster = intent_cluster(decision.intent) if decision.label == "clinical" and decision.intent else None
    if cluster and not _layer_ready(st, f"history.{cluster}"):
        # A live call does not wait in silence for a layer still being written (see StalledPersona), and a
        # typed question does not wait for it beyond HISTORY_TYPED_WAIT_S.
        history_task = asyncio.ensure_future(_ensure_history(rt, thread_id, decision.intent))
        waits: set[Any] = {history_task}
        if call is None and speculative is not None:
            # A typed reply already written from what is known does not idle for the rest of the budget.
            waits.add(speculative.task)
        await asyncio.wait(waits, timeout=HISTORY_STALL_AFTER_S if call is not None else HISTORY_TYPED_WAIT_S,
                           return_when=asyncio.FIRST_COMPLETED)
        done = history_task.done()
        layer = history_task.result() if done else None
        history_meta = {"layer": f"history.{cluster}", "at_ask": "writing",
                        "outcome": "written_in_time" if done else ("stalled" if call is not None
                                                                   else "answered_before_layer")}
        if done:
            history_task = None
        elif call is None:
            # Answered from what is known; the layer goes on being written (and marks itself seen).
            _LATE_LAYERS.add(history_task)
            history_task.add_done_callback(_LATE_LAYERS.discard)
            history_task = None
    else:
        layer = await _ensure_history(rt, thread_id, decision.intent) if decision.label == "clinical" else None
        if cluster:
            history_meta = {"layer": f"history.{cluster}", "at_ask": "ready" if _layer_ready(st, f"history.{cluster}")
                            else "writing", "outcome": "ready" if layer else "not_written"}
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
        scrub = _scrubber(st, view, locale)

        persona = None
        stall = None
        if history_task is not None and call is not None:
            # The layer is still being written: a stall line now, the answer once the facts exist.
            stall = stall_line(locale, message)
            if speculative is not None:
                speculative.cancel()
            if spec_speaker is not None:
                spec_speaker.cancel()
            speculative = None

            def build_answer() -> Any:
                st2 = rt.cases.get(thread_id) or st
                v2 = patient_view(st2, locale=locale)
                return PersonaStream(gateway, persona_turn(v2, _transcript(st2), message, decision.label),
                                     max_tokens=PERSONA_MAX_TOKENS, timings=timings)

            persona = StalledPersona(stall, history_task, build_answer, timings=timings)
            speaker = _call_speaker(request, call, persona=persona, timings=timings, gate=scrub)
            meta["speculative"] = "stalled"
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
            if tutor_task is not None:
                tutor_task.cancel()
            return _error(503, "model_unreachable",
                          "The patient model could not be reached; no reply was generated.",
                          cause=f"{type(exc).__name__}: {str(exc)[:200]}", retryable=True,
                          guard=decision.wire(locale))
        timings.mark("persona_done_ms")
        reply = (res.text or "").strip()
        if stall is not None:
            # The facts the answer used: the layer now written (or what was there after the wait).
            st = rt.cases.get(thread_id) or st
            view = patient_view(st, locale=locale)
            layer = history_meta["layer"] if _layer_ready(st, history_meta["layer"]) else None
            if layer:
                _mark_seen(rt, thread_id, [layer])
            history_meta["outcome"] = "stalled_then_answered" if layer else "stalled_without_layer"
            reply = f"{stall} {reply}".strip() if reply else ""
        if not reply:
            if speaker is not None:
                speaker.cancel()
            if tutor_task is not None:
                tutor_task.cancel()
            return _error(502, "model_output_invalid", "the patient model returned an empty reply", retryable=True)
        gate = fact_assertion_gate(reply, {"sanctioned_facts": view.told}, lang=locale)
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
    if history_meta:
        meta["history"] = history_meta

    actions: list[dict[str, Any]] = []
    if body.guidance:
        if tutor_task is not None:
            actions, meta["tutor_source"] = await tutor_task
        else:
            # The safety reply (no persona call): the tutor reads the exchange as before.
            asked = {t.get("intent") for t in transcript if t.get("intent")}
            if decision.intent:
                asked.add(decision.intent)
            actions, meta["tutor_source"] = await T.suggest(gateway, st, view, transcript + [
                {"role": "doctor", "text": message}, {"role": "patient", "text": reply}], asked=asked, locale=locale)
        timings.mark("tutor_ms")

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
