"""Live patient video routes.

POST /v1/voice/avatar/session    {encounter_id, photo_id, lang, sex, age, case_state, persona,
                                  case_context, provider?: auto|musetalk|tavus}
     musetalk -> {session_id, provider, transport: "webrtc", ice_servers, ice_transport_policy, avatar}
     tavus    -> {session_id, provider, transport: "tavus", conversation_url}
     503 {error: "avatar_unavailable", state, reasons[], pending_launch?} when no renderer can serve
POST /v1/voice/avatar/offer      {session_id, sdp, type} -> {sdp, type} (SDP proxied to the worker runner)
POST /v1/voice/avatar/speak      {session_id, text} -> gateway TTS (registry or worker Chatterbox) ->
                                 runner audio in; {provider, model, tts_ms, audio_bytes, queued_ms}
POST /v1/voice/avatar/interrupt  {session_id}
POST /v1/voice/avatar/end        {session_id}
POST /v1/patient/openai/chat/completions
     OpenAI-compatible (SSE when ``stream``) wrapper of /v1/patient/turn for Tavus's custom LLM:
     the bearer identifies the call, the call's stored case state and persona feed the same
     guard -> persona -> FactAssertionGate path the typed encounter uses.

Every /v1/voice/avatar route is signed-in only and bound to the caller's hashed subject;
a session id from another learner reads as 404.
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
import struct
import time
from typing import Any, Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from server.auth.deps import Principal, current_user
from server.providers.gpu_worker import WorkerRefused
from server.voice import profiles
from server.voice.avatar import musetalk as mt
from server.voice.avatar import tavus as tv
from server.voice.avatar.sessions import CallSession, SessionStore, token_digest
from server.voice.service import NoVoiceProvider, VoiceService

log = logging.getLogger("acudx.voice.avatar")

router = APIRouter(prefix="/v1/voice/avatar", tags=["voice"])
openai_router = APIRouter(tags=["patient"])

MAX_SPEAK_CHARS = 1200


def _svc(request: Request) -> VoiceService:
    svc = getattr(request.app.state, "voice", None)
    if svc is None:
        raise HTTPException(status_code=503, detail="voice service is not wired")
    return svc


def _store(request: Request) -> SessionStore:
    store = getattr(request.app.state, "avatar_sessions", None)
    if store is None:
        store = SessionStore()
        request.app.state.avatar_sessions = store
    return store


def _unavailable(state: str, reasons: list[str], **extra: Any) -> JSONResponse:
    return JSONResponse(status_code=503, content={"error": "avatar_unavailable", "state": state,
                                                  "reasons": reasons, **extra})


class SessionBody(BaseModel):
    encounter_id: str = Field(min_length=1, max_length=120)
    photo_id: str | None = Field(default=None, max_length=32)
    lang: str = "en"
    sex: str | None = None
    age: float | None = Field(default=None, ge=0, le=120)
    case_state: dict[str, Any] = Field(default_factory=dict)
    persona: dict[str, Any] | None = None
    case_context: dict[str, Any] | None = None
    greeting: str | None = Field(default=None, max_length=400)
    provider: Literal["auto", "musetalk", "tavus"] = "auto"


class SessionRef(BaseModel):
    session_id: str = Field(min_length=8, max_length=64)


class OfferBody(SessionRef):
    sdp: str = Field(min_length=10, max_length=200_000)
    type: Literal["offer"] = "offer"


class SpeakBody(SessionRef):
    text: str = Field(min_length=1, max_length=MAX_SPEAK_CHARS)


def _tavus_config(request: Request, svc: VoiceService) -> tv.TavusConfig | None:
    public = getattr(svc.settings, "public_base_url", None)
    for ep in svc.resolver.endpoints("avatar"):
        cfg = tv.config_from_endpoint(ep, public_base_url=public)
        if cfg is not None:
            return cfg
    return None


def _max_calls(svc: VoiceService) -> int:
    return int(getattr(svc.settings, "avatar_max_calls_per_worker", 2) or 2)


def runner_tuning(settings: Any) -> dict[str, int]:
    """The per-call runner tuning the gateway's settings pin (unset values keep the runner default)."""
    names = {"batch_size": "avatar_batch_size", "ahead_frames": "avatar_ahead_frames",
             "lookahead_frames": "avatar_lookahead_frames", "av_shift_ms": "avatar_av_shift_ms"}
    out: dict[str, int] = {}
    for key, attr in names.items():
        v = getattr(settings, attr, None)
        if isinstance(v, int) and not isinstance(v, bool):
            out[key] = v
    return out


def _worker(svc: VoiceService) -> mt.WorkerAvatar | None:
    wm = svc.resolver.worker_manager
    return mt.worker_from_endpoint(wm.llm_endpoint()) if wm is not None else None


async def _start_worker_in_background(svc: VoiceService) -> bool:
    """Ask the manager for a worker without waiting on its boot; True when a launch is possible."""
    wm = svc.resolver.worker_manager
    if wm is None:
        return False
    status = await wm.status()
    if not status.get("can_launch"):
        return False

    async def go() -> None:
        try:
            await wm.ensure_worker()
        except WorkerRefused as exc:
            log.info("avatar worker launch refused: %s", exc.reason)
        except Exception:  # noqa: BLE001 - background launch, logged
            log.exception("avatar worker launch failed")

    asyncio.get_running_loop().create_task(go())
    return True


@router.post("/session")
async def create_session(request: Request, body: SessionBody, user: Principal = Depends(current_user)):
    svc = _svc(request)
    store = _store(request)
    lang = profiles.normalize_lang(body.lang)
    reasons: list[str] = []

    tavus_cfg = _tavus_config(request, svc) if body.provider in ("auto", "tavus") else None
    if tavus_cfg is not None:
        return await _start_tavus(request, svc, store, tavus_cfg, body, user, lang)
    if body.provider == "tavus":
        refused = [r.name for r in svc.resolver.refused("avatar")]
        return _unavailable("not_configured", [f"{n}: refused by AIRGAPPED" for n in refused]
                            or ["no tavus avatar row with a key"])

    worker = _worker(svc)
    if worker is None:
        pending = await _start_worker_in_background(svc)
        refusal = svc.resolver.last_worker_refusal
        reasons.append("gpu-worker: starting" if pending else f"gpu-worker: {refusal or 'not available'}")
        return _unavailable("worker_starting" if pending else "no_worker", reasons, pending_launch=pending)
    h = await mt.health(svc.client, worker)
    if not h.get("ok"):
        reasons.append(f"gpu-worker avatar: {h.get('state')} {h.get('reason') or h.get('detail') or ''}".strip())
        return _unavailable(str(h.get("state") or "unknown"), reasons, worker=h)
    photo = mt.portrait_path(body.photo_id or "")
    if photo is None:
        raise HTTPException(status_code=400, detail={"error": "unknown_photo_id", "photo_id": body.photo_id})
    avatar_id = mt.avatar_id_for(body.photo_id or "")
    # Check the per-worker call limit and take the slot in one step (no await in between), so two
    # learners starting at once cannot both pass the check during the slow portrait preparation.
    cap = mt.call_capacity(h, gateway_limit=_max_calls(svc), gateway_pending=store.pending_on(worker.origin))
    if cap["calls_available"] <= 0:
        reasons.append(f"gpu-worker avatar: {cap['active_calls']} of {cap['max_calls']} live calls in use on this worker")
        return _unavailable("worker_full", reasons, **cap)
    s = store.create(provider="musetalk", user_hash=user.user_hash, encounter_id=body.encounter_id, lang=lang,
                     sex=body.sex, age=body.age, photo_id=body.photo_id, case_state=body.case_state,
                     persona=body.persona, case_context=body.case_context, avatar_id=avatar_id,
                     worker_origin=worker.origin)
    t0 = time.monotonic()
    try:
        prep = await mt.ensure_avatar(svc.client, worker, avatar_id, photo.read_bytes())
    except (mt.AvatarWorkerError, httpx.HTTPError) as exc:
        store.pop(s.id)
        return _unavailable("prepare_failed", [f"gpu-worker avatar: {getattr(exc, 'detail', None) or exc}"])
    s.metrics["prepare_ms"] = round((time.monotonic() - t0) * 1000.0, 1)
    svc.resolver.worker_manager.touch()  # type: ignore[union-attr]
    override = list(getattr(svc.settings, "avatar_turn_urls", None) or [])
    return {**s.public(), "transport": "webrtc", "renderer": mt.RENDERER, "model": mt.MODEL,
            "ice_servers": mt.ice_servers(worker, s.id, override_urls=override or None),
            "ice_transport_policy": "relay", "prepare": prep, "prepare_ms": s.metrics["prepare_ms"],
            "worker": {"infer_fps": h.get("infer_fps"), "sessions": h.get("sessions"),
                       "max_sessions": h.get("max_sessions"), "gpu": h.get("gpu"),
                       "max_calls": cap["max_calls"], "active_calls": cap["active_calls"] + 1}}


async def _start_tavus(request: Request, svc: VoiceService, store: SessionStore, cfg: tv.TavusConfig,
                       body: SessionBody, user: Principal, lang: str):
    if not cfg.public_base_url:
        return _unavailable("not_configured", ["tavus: PUBLIC_BASE_URL (or extra.public_base_url) is not set, so "
                                               "Tavus cannot reach the gateway's patient LLM endpoint"])
    token = tv.new_llm_token()
    s = store.create(provider="tavus", user_hash=user.user_hash, encounter_id=body.encounter_id, lang=lang,
                     sex=body.sex, age=body.age, photo_id=body.photo_id, case_state=body.case_state,
                     persona=body.persona, case_context=body.case_context, llm_token_digest=token_digest(token))
    tts_eps = svc.resolver.endpoints("tts")
    tts_ep = tts_eps[0] if tts_eps else None
    voice_id = None
    if tts_ep is not None and "elevenlabs.io" in tts_ep.base_url:
        voice_id = profiles.resolve_voice("elevenlabs", profiles.profile_for(body.sex, body.age, lang), tts_ep.extra)
    client = tv.TavusClient(cfg, svc.client)
    t0 = time.monotonic()
    try:
        conv = await client.start_call(
            persona=body.persona, lang=lang, photo_id=body.photo_id,
            llm_base_url=cfg.public_base_url.rstrip("/") + "/v1/patient/openai", llm_token=token,
            tts=tv.tts_layer(tts_ep, voice_id), context="Synthetic patient for medical education; education only.",
            greeting=body.greeting, name=f"acudx-{s.id[:8]}")
    except (tv.TavusError, httpx.HTTPError) as exc:
        store.pop(s.id)
        return _unavailable("tavus_failed", [f"tavus: {getattr(exc, 'detail', None) or type(exc).__name__}"])
    s.conversation_id = str(conv["conversation_id"])
    s.conversation_url = str(conv["conversation_url"])
    s.pal_id = str(conv["pal_id"])
    s.metrics["start_ms"] = round((time.monotonic() - t0) * 1000.0, 1)
    return {**s.public(), "transport": "tavus", "renderer": "tavus", "conversation_id": s.conversation_id,
            "tts": "elevenlabs" if voice_id else "tavus", "start_ms": s.metrics["start_ms"]}


def _session(request: Request, ref: SessionRef, user: Principal) -> CallSession:
    s = _store(request).get(ref.session_id, user_hash=user.user_hash)
    if s is None:
        raise HTTPException(status_code=404, detail={"error": "unknown_session"})
    _store(request).touch(s)
    return s


def _require_worker(svc: VoiceService) -> mt.WorkerAvatar:
    worker = _worker(svc)
    if worker is None:
        raise HTTPException(status_code=503, detail={"error": "avatar_unavailable", "state": "no_worker"})
    return worker


@router.post("/offer")
async def offer(request: Request, body: OfferBody, user: Principal = Depends(current_user)):
    svc = _svc(request)
    s = _session(request, body, user)
    if s.provider != "musetalk" or not s.avatar_id:
        raise HTTPException(status_code=409, detail={"error": "not_a_webrtc_session"})
    worker = _require_worker(svc)
    t0 = time.monotonic()
    try:
        ans = await mt.offer(svc.client, worker, sdp=body.sdp, sdp_type=body.type, avatar_id=s.avatar_id,
                             tuning=runner_tuning(svc.settings) or None)
    except (mt.AvatarWorkerError, httpx.HTTPError) as exc:
        return _unavailable("offer_failed", [f"gpu-worker avatar: {getattr(exc, 'detail', None) or exc}"])
    if s.worker_session:
        await mt.close(svc.client, worker, s.worker_session)
    if s.audio_link is not None:
        await s.audio_link.close()
    s.worker_session = str(ans["sessionid"])
    s.metrics["answer_ms"] = round((time.monotonic() - t0) * 1000.0, 1)
    # Open the audio WebSocket now, while the browser finishes ICE, so the first line does not pay it.
    s.audio_link = mt.RunnerAudioLink(worker=worker, worker_session=s.worker_session)
    asyncio.get_running_loop().create_task(_warm_link(s.audio_link))
    return {"sdp": ans["sdp"], "type": ans.get("type") or "answer", "answer_ms": s.metrics["answer_ms"]}


async def _warm_link(link: mt.RunnerAudioLink) -> None:
    try:
        await link.ensure()
    except Exception as exc:  # noqa: BLE001 - the first speak connects again and reports the error
        log.info("avatar audio link warm-up failed: %s", type(exc).__name__)


def pcm_to_wav(pcm: bytes, *, sample_rate: int = 24000, channels: int = 1, bits: int = 16) -> bytes:
    """Raw little-endian PCM (ElevenLabs ``pcm_24000``) -> a WAV container the runner can decode."""
    block = channels * bits // 8
    header = b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVEfmt " + struct.pack(
        "<IHHIIHH", 16, 1, channels, sample_rate, sample_rate * block, block, bits) + b"data" + struct.pack("<I", len(pcm))
    return header + pcm


@router.post("/speak")
async def speak(request: Request, body: SpeakBody, user: Principal = Depends(current_user)):
    svc = _svc(request)
    s = _session(request, body, user)
    if s.provider != "musetalk" or not s.worker_session:
        raise HTTPException(status_code=409, detail={"error": "call_not_connected"})
    worker = _require_worker(svc)
    t0 = time.monotonic()
    try:
        out = await svc.tts(body.text, lang=s.lang, sex=s.sex, age=s.age, output_format="wav", stream=True)
    except NoVoiceProvider as exc:
        return JSONResponse(status_code=503, content={"error": "tts_unavailable", "airgapped": exc.airgapped,
                                                      "reasons": exc.reasons})
    ctype = out.stream.content_type
    if ctype != "audio/mpeg":
        streamed = await _speak_streaming(svc, s, worker, out, t0)
        if streamed is not None:
            return streamed
        return _unavailable("speak_failed", [f"gpu-worker avatar: {s.metrics.get('last_stream_error')}"])
    buf = io.BytesIO()
    async for chunk in out.stream.chunks:
        buf.write(chunk)
    audio = buf.getvalue()
    tts_ms = (time.monotonic() - t0) * 1000.0
    ctype = out.stream.content_type
    if ctype == "audio/pcm":
        audio, ctype = pcm_to_wav(audio), "audio/wav"
    ext = "mp3" if "mpeg" in ctype else "wav"
    t1 = time.monotonic()
    try:
        await mt.speak(svc.client, worker, worker_session=s.worker_session, audio=audio, filename=f"turn.{ext}",
                       content_type=ctype)
    except (mt.AvatarWorkerError, httpx.HTTPError) as exc:
        return _unavailable("speak_failed", [f"gpu-worker avatar: {getattr(exc, 'detail', None) or exc}"])
    svc.resolver.worker_manager.touch()  # type: ignore[union-attr]
    s.metrics["turns"] = int(s.metrics.get("turns", 0)) + 1
    return {"provider": out.endpoint.name, "adapter": out.adapter, "model": out.stream.model,
            "voice_id": out.voice_id, "source": out.endpoint.source, "tts_ms": round(tts_ms, 1),
            "queued_ms": round((time.monotonic() - t1) * 1000.0, 1), "audio_bytes": len(audio),
            "audio_duration_ms": out.stream.duration_ms}


async def _speak_streaming(svc: VoiceService, s: CallSession, worker: mt.WorkerAvatar, out: Any,
                           t0: float) -> dict[str, Any] | None:
    """Forward the TTS stream to the runner chunk by chunk (the WAV header is parsed off the front);
    lip sync starts on the first chunk. None when the stream failed (reason in the metrics)."""
    parser = mt.PcmStream(out.stream.content_type, sample_rate=out.stream.sample_rate)
    marks: dict[str, float] = {}
    total = 0
    head: list[bytes] = []
    it = out.stream.chunks.__aiter__()
    try:
        # Read until the header gives the sample rate (raw PCM knows it already).
        while not parser.ready:
            chunk = await it.__anext__()
            pcm = parser.feed(chunk)
            if pcm:
                head.append(pcm)
        if not parser.supported:
            raise ValueError(f"unsupported PCM ({parser.bits} bit, {parser.channels} channels)")
    except (StopAsyncIteration, ValueError) as exc:
        s.metrics["last_stream_error"] = f"tts stream: {type(exc).__name__} {exc}"[:200]
        return None

    async def pcm():
        nonlocal total
        odd = b""
        for piece in head:
            total += len(piece)
            yield piece
        async for chunk in it:
            data = odd + chunk
            odd = data[len(data) // 2 * 2:]
            data = data[:len(data) // 2 * 2]
            total += len(data)
            if data:
                yield data

    def first() -> None:
        marks["first_chunk_ms"] = round((time.monotonic() - t0) * 1000.0, 1)

    link = s.audio_link or mt.RunnerAudioLink(worker=worker, worker_session=str(s.worker_session))
    s.audio_link = link
    try:
        stats = await link.utterance(pcm(), int(parser.sample_rate or 24000), on_first_chunk=first)
    except mt.AvatarWorkerError as exc:
        s.metrics["last_stream_error"] = exc.detail
        return None
    except Exception as exc:  # noqa: BLE001 - the TTS stream broke mid-line; the socket is mid-utterance
        await link.close()
        s.metrics["last_stream_error"] = f"tts stream: {type(exc).__name__}"
        log.warning("avatar speak stream for %s failed: %s", s.id[:8], type(exc).__name__)
        return None
    svc.resolver.worker_manager.touch()  # type: ignore[union-attr]
    s.metrics["turns"] = int(s.metrics.get("turns", 0)) + 1
    duration_ms = round(total / 2 / float(parser.sample_rate or 24000) * 1000.0)
    return {"provider": out.endpoint.name, "adapter": out.adapter, "model": out.stream.model,
            "voice_id": out.voice_id, "source": out.endpoint.source, "transport": "stream",
            "tts_ms": round(out.ttfb_ms, 1), "first_chunk_ms": marks.get("first_chunk_ms"),
            "stream_ms": round((time.monotonic() - t0) * 1000.0, 1), "queued_ms": 0.0,
            "audio_bytes": total, "audio_duration_ms": duration_ms, "sample_rate": parser.sample_rate,
            "link_connect_ms": link.connect_ms, "runner": {k: stats.get(k) for k in
                                                           ("frames", "first_frame_ms", "elapsed_ms")}}


@router.post("/interrupt")
async def interrupt(request: Request, body: SessionRef, user: Principal = Depends(current_user)):
    svc = _svc(request)
    s = _session(request, body, user)
    worker = _worker(svc)
    if s.worker_session and worker is not None:
        await mt.interrupt(svc.client, worker, s.worker_session)
    return {"ok": True}


async def end_remote(svc: VoiceService, s: CallSession) -> None:
    if s.provider == "musetalk" and s.worker_session:
        if s.audio_link is not None:
            await s.audio_link.close()
        worker = _worker(svc)
        if worker is not None:
            await mt.close(svc.client, worker, s.worker_session)
    elif s.provider == "tavus":
        cfg = None
        for ep in svc.resolver.endpoints("avatar"):
            cfg = tv.config_from_endpoint(ep)
            if cfg is not None:
                break
        if cfg is not None:
            try:
                await tv.TavusClient(cfg, svc.client).end_call(s.conversation_id, s.pal_id)
            except (tv.TavusError, httpx.HTTPError) as exc:
                log.warning("tavus cleanup for %s failed: %s", s.id[:8], exc)


@router.post("/end")
async def end(request: Request, body: SessionRef, user: Principal = Depends(current_user)):
    svc = _svc(request)
    s = _session(request, body, user)
    _store(request).pop(s.id)
    await end_remote(svc, s)
    return {"ok": True, "metrics": s.metrics}


# --------------------------------------------------------------------------- #
# OpenAI-compatible patient endpoint (Tavus custom LLM)                         #
# --------------------------------------------------------------------------- #
def _text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(str(p.get("text") or "") for p in content if isinstance(p, dict)).strip()
    return ""


def split_messages(messages: list[dict[str, Any]]) -> tuple[str, list[dict[str, str]]]:
    """OpenAI messages -> (last learner line, prior user/assistant turns). System messages are dropped:
    the persona prompt is rebuilt server-side, and Tavus perception tags never reach the patient."""
    convo = [{"role": m.get("role"), "content": _text(m.get("content"))} for m in messages
             if isinstance(m, dict) and m.get("role") in ("user", "assistant")]
    convo = [m for m in convo if m["content"]]
    last_user = next((i for i in range(len(convo) - 1, -1, -1) if convo[i]["role"] == "user"), None)
    if last_user is None:
        return "", convo[-8:]
    return convo[last_user]["content"], convo[:last_user][-8:]


def _sse(obj: dict[str, Any]) -> bytes:
    return f"data: {json.dumps(obj, ensure_ascii=False, separators=(',', ':'))}\n\n".encode("utf-8")


@openai_router.post("/v1/patient/openai/chat/completions")
async def patient_chat_completions(request: Request):
    auth = request.headers.get("authorization") or ""
    token = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
    s = _store(request).by_llm_token(token)
    if s is None:
        return JSONResponse(status_code=401, content={"error": {"message": "unknown or expired call token",
                                                                "type": "invalid_request_error"}})
    _store(request).touch(s)
    try:
        body = await request.json()
    except ValueError:
        return JSONResponse(status_code=400, content={"error": {"message": "body is not JSON"}})
    messages = body.get("messages") if isinstance(body, dict) else None
    if not isinstance(messages, list):
        return JSONResponse(status_code=400, content={"error": {"message": "messages[] is required"}})
    learner_msg, history = split_messages(messages)
    from server.app import PatientTurnRequest, patient_turn  # noqa: PLC0415 - avoids an import cycle

    if learner_msg:
        out = await patient_turn(PatientTurnRequest(learner_msg=learner_msg, case_state=s.case_state,
                                                    persona=s.persona, history=history,
                                                    case_context=s.case_context, locale=s.lang))
        text, routed = out.utterance, out.routed_as
    else:
        text, routed = "", "empty"
    s.metrics["llm_turns"] = int(s.metrics.get("llm_turns", 0)) + 1
    cid = f"chatcmpl-{s.id[:12]}-{s.metrics['llm_turns']}"
    created = int(time.time())
    model = str(body.get("model") or tv.LLM_MODEL_NAME)
    headers = {"X-AcuDx-Routed-As": routed}
    if not body.get("stream"):
        return JSONResponse(headers=headers, content={
            "id": cid, "object": "chat.completion", "created": created, "model": model,
            "choices": [{"index": 0, "message": {"role": "assistant", "content": text}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}})

    async def stream():
        base = {"id": cid, "object": "chat.completion.chunk", "created": created, "model": model}
        yield _sse({**base, "choices": [{"index": 0, "delta": {"role": "assistant"}, "finish_reason": None}]})
        for piece in _pieces(text):
            yield _sse({**base, "choices": [{"index": 0, "delta": {"content": piece}, "finish_reason": None}]})
        yield _sse({**base, "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]})
        yield b"data: [DONE]\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-store", **headers})


def _pieces(text: str) -> list[str]:
    """Sentence-sized deltas so the TTS can start on the first sentence."""
    out: list[str] = []
    cur = ""
    for ch in text:
        cur += ch
        if ch in ".!?" and len(cur) > 12:
            out.append(cur)
            cur = ""
    if cur:
        out.append(cur)
    return out
