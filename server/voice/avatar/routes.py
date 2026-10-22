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
from pathlib import Path
from typing import Any, Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from server.auth.deps import Principal, current_user
from server.providers.gpu_worker import WorkerRefused
from server.voice import profiles
from server.voice.avatar import appearance as ap
from server.voice.avatar import musetalk as mt
from server.voice.avatar import state_sync as sync_mod
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
    # The case thread the call follows: the face, the voice and the patient's answers are derived
    # from its server-side state (checked against the caller), never from a browser-sent state.
    thread_id: str | None = Field(default=None, max_length=120)


class SessionRef(BaseModel):
    session_id: str = Field(min_length=8, max_length=64)


class OfferBody(SessionRef):
    sdp: str = Field(min_length=10, max_length=200_000)
    type: Literal["offer"] = "offer"


class PrepareBody(BaseModel):
    thread_id: str = Field(min_length=1, max_length=120)
    photo_id: str = Field(min_length=1, max_length=32)


MAX_LOOKS = 64


def _looks(request: Request) -> dict[str, Any]:
    looks = getattr(request.app.state, "avatar_looks", None)
    if looks is None:
        looks = {}
        request.app.state.avatar_looks = looks
    return looks


class SpeakBody(SessionRef):
    text: str = Field(min_length=1, max_length=MAX_SPEAK_CHARS)


def _tavus_config(request: Request, svc: VoiceService, *, default_only: bool = False) -> tv.TavusConfig | None:
    """The Tavus row's config. ``default_only``: only a row the owner marked ``extra.default: true``
    (the on-prem runner is the default renderer; Tavus is an optional adapter, owner decision
    2026-10-21)."""
    public = getattr(svc.settings, "public_base_url", None)
    for ep in svc.resolver.endpoints("avatar"):
        if default_only and not ep.extra.get("default"):
            continue
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


def _session_worker(svc: VoiceService, s: CallSession) -> mt.WorkerAvatar | None:
    """The worker this call runs on (a pool may run several; a call never moves)."""
    wm = svc.resolver.worker_manager
    if wm is None:
        return None
    if s.worker_origin and hasattr(wm, "endpoint_by_origin"):
        return mt.worker_from_endpoint(wm.endpoint_by_origin(s.worker_origin))
    w = _worker(svc)
    if w is not None and s.worker_origin and w.origin != s.worker_origin:
        return None
    return w


async def _thread_view(request: Request, thread_id: str | None, user: Principal) -> tuple[dict, dict] | None:
    """The case thread's (spec, Director state) when the caller may read the thread, else None."""
    if not thread_id:
        return None
    try:
        from server.orchestration.routes import _thread_for, get_runtime  # noqa: PLC0415

        rt = await get_runtime(request)
        if _thread_for(rt, thread_id, user) is None:
            return None
    except Exception:  # noqa: BLE001 - no orchestration runtime: the call runs on the portrait
        log.info("avatar session: case thread %s not readable", thread_id[:8])
        return None
    return await sync_mod.case_view(request.app, thread_id)


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

    # On-prem first (owner decision 2026-10-21): the GPU worker's runner is the default renderer.
    # Tavus runs when asked for by name, or when the owner marked its row the default.
    tavus_cfg = (_tavus_config(request, svc) if body.provider == "tavus"
                 else _tavus_config(request, svc, default_only=True) if body.provider == "auto" else None)
    if tavus_cfg is not None:
        return await _start_tavus(request, svc, store, tavus_cfg, body, user, lang)
    if body.provider == "tavus":
        refused = [r.name for r in svc.resolver.refused("avatar")]
        return _unavailable("not_configured", [f"{n}: refused by AIRGAPPED" for n in refused]
                            or ["no tavus avatar row with a key"])

    wm = svc.resolver.worker_manager
    if wm is None or not (wm.endpoints() if hasattr(wm, "endpoints") else wm.llm_endpoint()):
        pending = await _start_worker_in_background(svc)
        refusal = svc.resolver.last_worker_refusal
        reasons.append("gpu-worker: starting" if pending else f"gpu-worker: {refusal or 'not available'}")
        return _unavailable("worker_starting" if pending else "no_worker", reasons, pending_launch=pending)
    photo = mt.portrait_path(body.photo_id or "")
    if photo is None:
        raise HTTPException(status_code=400, detail={"error": "unknown_photo_id", "photo_id": body.photo_id})
    # The ready worker with the most free call slots. Check the limit and take the slot in one step
    # (no await between the pick and the store), so two learners starting at once cannot both pass the
    # check during the slow portrait preparation.
    look_key = f"{body.thread_id}:{body.photo_id}"
    prepared = _looks(request).get(look_key) if body.thread_id else None
    worker, h, cap = await mt.pick_worker(svc.client, wm, gateway_limit=_max_calls(svc), pending=store.pending_on,
                                          prefer=prepared.worker_origin if prepared is not None else None)
    if worker is None:
        if cap:
            launching = await wm.maybe_scale_up() if hasattr(wm, "maybe_scale_up") else None
            reasons.append(f"gpu-worker avatar: {cap['active_calls']} of {cap['max_calls']} live calls in use on "
                           "every worker" + ("; another worker is starting" if launching else ""))
            return _unavailable("worker_full", reasons, pending_launch=bool(launching), **cap)
        reasons.append(f"gpu-worker avatar: {h.get('state')} {h.get('reason') or h.get('detail') or ''}".strip())
        return _unavailable(str(h.get("state") or "unknown"), reasons, worker=h)
    view = await _thread_view(request, body.thread_id, user)
    s = store.create(provider="musetalk", user_hash=user.user_hash, encounter_id=body.encounter_id, lang=lang,
                     sex=body.sex, age=body.age, photo_id=body.photo_id, case_state=body.case_state,
                     persona=body.persona, case_context=body.case_context,
                     avatar_id=mt.avatar_id_for(body.photo_id or ""), worker_origin=worker.origin,
                     thread_id=body.thread_id if view is not None else None)
    t0 = time.monotonic()
    portrait = photo.read_bytes()
    prep: dict[str, Any] = {}
    try:
        if view is not None:
            wait_s = float(getattr(svc.settings, "avatar_appearance_wait_s", 45.0) or 0.0)
            reuse = (prepared if prepared is not None and prepared.worker_origin == worker.origin
                     and prepared.worker_session is None else None)
            gen = await sync_mod.pick_gen_worker(svc.client, wm, worker) if reuse is None else None
            s.appearance, s.avatar_id = await sync_mod.start(
                svc.client, worker, thread_id=str(body.thread_id), photo_id=str(body.photo_id), portrait=portrait,
                spec=view[0], director=view[1], wait_s=wait_s, gen_worker=gen, existing=reuse,
                services_wait_s=_services_wait_s(svc), keepalive=lambda: _touch(svc, worker))
            if reuse is None and body.thread_id:
                _remember_look(request.app, f"{body.thread_id}:{body.photo_id}", s.appearance)
            s.appearance.worker_origin = worker.origin
            s.metrics["appearance_reused"] = reuse is not None
            s.metrics["appearance_ms"] = round((time.monotonic() - t0) * 1000.0, 1)
        if s.avatar_id == mt.avatar_id_for(body.photo_id or ""):
            prep = await mt.ensure_avatar(svc.client, worker, s.avatar_id, portrait, priority="call")
        else:
            prep = await mt.ensure_avatar(svc.client, worker, s.avatar_id, b"")   # prepared: geometry only
            _spawn(mt.ensure_avatar(svc.client, worker, mt.avatar_id_for(body.photo_id or ""), portrait))
    except (mt.AvatarWorkerError, httpx.HTTPError) as exc:
        store.pop(s.id)
        await sync_mod.cancel(s.appearance)
        return _unavailable("prepare_failed", [f"gpu-worker avatar: {getattr(exc, 'detail', None) or exc}"])
    s.metrics["prepare_ms"] = round((time.monotonic() - t0) * 1000.0, 1)
    _touch(svc, worker)
    override = list(getattr(svc.settings, "avatar_turn_urls", None) or [])
    return {**s.public(), "transport": "webrtc", "renderer": mt.RENDERER, "model": mt.MODEL,
            "ice_servers": mt.ice_servers(worker, s.id, override_urls=override or None),
            "ice_transport_policy": "relay", "prepare": prep, "prepare_ms": s.metrics["prepare_ms"],
            "worker": {"infer_fps": h.get("infer_fps"), "sessions": h.get("sessions"),
                       "max_sessions": h.get("max_sessions"), "gpu": h.get("gpu"), "domain": worker.domain,
                       "max_calls": cap["max_calls"], "active_calls": cap["active_calls"] + 1}}


def _spawn(coro: Any) -> None:
    task = asyncio.get_running_loop().create_task(coro)

    def done(t: asyncio.Task[Any]) -> None:
        if not t.cancelled() and t.exception() is not None:
            log.info("avatar background task failed: %s", type(t.exception()).__name__)

    task.add_done_callback(done)


async def _start_tavus(request: Request, svc: VoiceService, store: SessionStore, cfg: tv.TavusConfig,
                       body: SessionBody, user: Principal, lang: str):
    if not cfg.public_base_url:
        return _unavailable("not_configured", ["tavus: PUBLIC_BASE_URL (or extra.public_base_url) is not set, so "
                                               "Tavus cannot reach the gateway's patient LLM endpoint"])
    if body.age is not None and body.age < 18:
        # Tavus Acceptable Use Policy (effective 2026-04-14) section 3.2: no face that depicts or appears
        # to depict anyone under 18. Paediatric cases use the on-prem runner.
        return _unavailable("not_allowed", ["tavus: its acceptable use policy (3.2) bars faces of patients "
                                            "under 18; the on-prem renderer serves paediatric cases"])
    token = tv.new_llm_token()
    view = await _thread_view(request, body.thread_id, user)
    s = store.create(provider="tavus", user_hash=user.user_hash, encounter_id=body.encounter_id, lang=lang,
                     sex=body.sex, age=body.age, photo_id=body.photo_id, case_state=body.case_state,
                     persona=body.persona, case_context=body.case_context, llm_token_digest=token_digest(token),
                     thread_id=body.thread_id if view is not None else None)
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


def _touch(svc: VoiceService, worker: mt.WorkerAvatar) -> None:
    wm = svc.resolver.worker_manager
    if wm is None:
        return
    try:
        wm.touch(worker.origin)
    except TypeError:
        wm.touch()


def _require_worker(svc: VoiceService, s: CallSession) -> mt.WorkerAvatar:
    worker = _session_worker(svc, s)
    if worker is None:
        raise HTTPException(status_code=503, detail={"error": "avatar_unavailable", "state": "no_worker"})
    return worker


@router.post("/offer")
async def offer(request: Request, body: OfferBody, user: Principal = Depends(current_user)):
    svc = _svc(request)
    s = _session(request, body, user)
    if s.provider != "musetalk" or not s.avatar_id:
        raise HTTPException(status_code=409, detail={"error": "not_a_webrtc_session"})
    worker = _require_worker(svc, s)
    # The picture the patient's state calls for now (the ladder may have moved on since the session).
    a = s.appearance
    if a is not None and a.current_key in a.variants and a.variants[a.current_key].status == "ready":
        s.avatar_id = a.variants[a.current_key].avatar_id
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
    s.metrics["av_shift_ms"] = int(runner_tuning(svc.settings).get("av_shift_ms", 0))
    if s.appearance is not None:
        s.appearance.worker_session = s.worker_session
    # Open the audio WebSocket now, while the browser finishes ICE, so the first line does not pay it.
    s.audio_link = mt.RunnerAudioLink(worker=worker, worker_session=s.worker_session)
    preroll_ms = int(getattr(svc.settings, "avatar_preroll_ms", 0) or 0)
    loop = asyncio.get_running_loop()
    loop.create_task(_warm_link(s.audio_link, preroll_ms=preroll_ms, metrics=s.metrics))
    loop.create_task(svc.prewarm_tts(s.lang))
    return {"sdp": ans["sdp"], "type": ans.get("type") or "answer", "answer_ms": s.metrics["answer_ms"]}


PREROLL_RATE = 16000


async def _silence(ms: int, *, rate: int = PREROLL_RATE, piece_ms: int = 200) -> Any:
    piece = b"\x00\x00" * (rate * piece_ms // 1000)
    left = rate * ms // 1000 * 2
    while left > 0:
        out = piece[:left]
        left -= len(out)
        yield out


async def _warm_link(link: mt.RunnerAudioLink, *, preroll_ms: int = 0, metrics: dict[str, Any] | None = None) -> None:
    """Open the call's audio socket and, when set, play a short silent line through the whole speech
    path (runner queues, delay line, WebRTC audio track) before the first patient line."""
    try:
        await link.ensure()
        if preroll_ms > 0:
            t0 = time.monotonic()
            stats = await link.utterance(_silence(preroll_ms), PREROLL_RATE)
            if metrics is not None:
                metrics["preroll"] = {"ms": preroll_ms, "frames": stats.get("frames"),
                                      "sent_ms": round((time.monotonic() - t0) * 1000.0, 1)}
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
    worker = _require_worker(svc, s)
    # The voice matches the face: the same server-side look sets the pace (breathless, drowsy) and
    # an unresponsive patient (arrest) says nothing.
    style = sync_mod.voice_for(s.appearance)
    if style["silent"]:
        return {"silent": True, "reason": "patient_unresponsive", "voice": style,
                "appearance": s.appearance.public() if s.appearance is not None else None}
    text = ap.speakable(body.text, s.lang) or body.text
    t0 = time.monotonic()
    try:
        out = await svc.tts(text, lang=s.lang, sex=s.sex, age=s.age, output_format="wav", stream=True,
                            speed=float(style["speed"]))
    except NoVoiceProvider as exc:
        return JSONResponse(status_code=503, content={"error": "tts_unavailable", "airgapped": exc.airgapped,
                                                      "reasons": exc.reasons})
    ctype = out.stream.content_type
    if ctype != "audio/mpeg":
        streamed = await _speak_streaming(svc, s, worker, out, t0)
        if streamed is not None:
            return {**streamed, "voice": {"speed": style["speed"]}, "spoken_text": text,
                    "look": s.appearance.live.public() if s.appearance is not None and s.appearance.live else None}
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
    _touch(svc, worker)
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

    rate = float(parser.sample_rate or 24000)
    stall = {"max_ms": 0.0, "t0": None}

    def arrived() -> None:
        # How far behind real time the TTS stream fell: audio played from the first chunk on runs dry
        # whenever a chunk arrives later than the audio already received lasts (a gap in the voice).
        now = time.monotonic()
        if stall["t0"] is None:
            stall["t0"] = now
            return
        behind = (now - stall["t0"]) * 1000.0 - total / 2 / rate * 1000.0
        stall["max_ms"] = max(stall["max_ms"], behind)

    async def pcm():
        nonlocal total
        odd = b""
        for piece in head:
            arrived()
            total += len(piece)
            yield piece
        async for chunk in it:
            data = odd + chunk
            odd = data[len(data) // 2 * 2:]
            data = data[:len(data) // 2 * 2]
            if data:
                arrived()
                total += len(data)
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
    _touch(svc, worker)
    s.metrics["turns"] = int(s.metrics.get("turns", 0)) + 1
    duration_ms = round(total / 2 / float(parser.sample_rate or 24000) * 1000.0)
    return {"provider": out.endpoint.name, "adapter": out.adapter, "model": out.stream.model,
            "voice_id": out.voice_id, "source": out.endpoint.source, "transport": "stream",
            "tts_ms": round(out.ttfb_ms, 1), "first_chunk_ms": marks.get("first_chunk_ms"),
            "stream_ms": round((time.monotonic() - t0) * 1000.0, 1), "queued_ms": 0.0,
            "audio_bytes": total, "audio_duration_ms": duration_ms, "sample_rate": parser.sample_rate,
            "stream_stall_ms": round(stall["max_ms"], 1), "preroll": s.metrics.get("preroll"),
            "link_connect_ms": link.connect_ms, "runner": {k: stats.get(k) for k in
                                                           ("frames", "first_frame_ms", "elapsed_ms")}}


class LipLagBody(SessionRef):
    # The browser's measured audio-to-lip offset of the last line (positive: the mouth moves after the voice).
    lip_lag_ms: float = Field(ge=-2000, le=2000)
    score: float | None = Field(default=None, ge=-1, le=1)


LIP_TOLERANCE_MS = 40
# 0.25 since 2026-10-22: Turkish lines on the worker's Chatterbox score 0.2 to 0.4 (breathy, paused speech),
# so at 0.4 a steady +120 to +240 ms offset was never corrected; the lines that misled the loop before were
# overlapping replies, which are skipped now (lip_overlap).
LIP_MIN_SCORE = 0.25
LIP_GAIN = 0.5


def next_av_shift(current: int, lip_lag_ms: float, *, tolerance_ms: int = LIP_TOLERANCE_MS,
                  gain: float = LIP_GAIN) -> int:
    """The runner's video delay that moves towards cancelling a measured offset: lips late (positive
    lag) need less delay, lips early (negative) more. Half the offset per line (one noisy line must not
    swing the call), in whole 40 ms frames, at least one frame, 0 to 1000 ms; inside the tolerance the
    delay stays (the meter has about 40 ms of noise)."""
    if abs(lip_lag_ms) <= tolerance_ms:
        return current
    step = int(round(gain * lip_lag_ms / 40.0)) or (1 if lip_lag_ms > 0 else -1)
    return max(0, min(1000, (int(round(current / 40.0)) - step) * 40))


@router.post("/lipsync")
async def lipsync(request: Request, body: LipLagBody, user: Principal = Depends(current_user)):
    """Closed-loop lip sync: the tile reports each line's measured offset; when it is outside the tolerance
    (and the correlation is meaningful) the call's runner delay is moved to cancel it for the next line."""
    svc = _svc(request)
    s = _session(request, body, user)
    if s.provider != "musetalk" or not s.worker_session:
        raise HTTPException(status_code=409, detail={"error": "call_not_connected"})
    current = int(s.metrics.get("av_shift_ms", runner_tuning(svc.settings).get("av_shift_ms", 0)))
    lags = s.metrics.setdefault("lip_lags", [])
    overlap = bool(s.metrics.pop("lip_overlap", False))
    lags.append({"lip_lag_ms": body.lip_lag_ms, "score": body.score, "av_shift_ms": current,
                 **({"ignored": "overlap"} if overlap else {})})
    del lags[:-40]
    if overlap:
        # A reply cut by the next one: the measured window holds two lines, its offset is not the runner's.
        return {"av_shift_ms": current, "changed": False, "why": "overlapping_lines"}
    if body.score is not None and body.score < LIP_MIN_SCORE:
        return {"av_shift_ms": current, "changed": False, "why": "weak_correlation"}
    want = next_av_shift(current, body.lip_lag_ms)
    if want == current:
        return {"av_shift_ms": current, "changed": False}
    worker = _require_worker(svc, s)
    try:
        await mt.tune(svc.client, worker, s.worker_session, av_shift_ms=want)
    except (mt.AvatarWorkerError, httpx.HTTPError) as exc:
        return {"av_shift_ms": current, "changed": False, "why": str(getattr(exc, "detail", None) or exc)[:120]}
    s.metrics["av_shift_ms"] = want
    return {"av_shift_ms": want, "changed": True, "previous": current}


@router.get("/metrics")
async def call_metrics(request: Request, session_id: str, user: Principal = Depends(current_user)):
    """The call's measurements: each voiced turn's hop timings, the lip offsets reported, the pre-roll."""
    s = _store(request).get(session_id, user_hash=user.user_hash)
    if s is None:
        raise HTTPException(status_code=404, detail={"error": "unknown_session"})
    return {"session_id": s.id, "worker_session": s.worker_session, "avatar_id": s.avatar_id, "metrics": s.metrics}


@router.post("/interrupt")
async def interrupt(request: Request, body: SessionRef, user: Principal = Depends(current_user)):
    svc = _svc(request)
    s = _session(request, body, user)
    worker = _session_worker(svc, s)
    if s.worker_session and worker is not None:
        await mt.interrupt(svc.client, worker, s.worker_session)
    return {"ok": True}


async def _sync_session(app: Any, svc: VoiceService, s: CallSession, *, reason: str) -> dict[str, Any]:
    """Re-read the call's case thread from the server store and move the face to the live state."""
    if s.appearance is None or not s.thread_id:
        return {"switched": False, "why": "no_case_thread"}
    view = await sync_mod.case_view(app, s.thread_id)
    worker = _session_worker(svc, s)
    if view is None or worker is None:
        return {"switched": False, "why": "case_or_worker_unavailable"}
    photo = mt.portrait_path(s.photo_id or "")
    out = await sync_mod.sync(svc.client, worker, s.appearance, worker_session=s.worker_session, spec=view[0],
                              director=view[1], portrait=photo.read_bytes() if photo else b"", reason=reason)
    if s.appearance.current_key and s.appearance.current_key in s.appearance.variants:
        s.avatar_id = s.appearance.variants[s.appearance.current_key].avatar_id
    return out


async def notify_director(app: Any, thread_id: str) -> int:
    """Called after every Director step on ``thread_id``: every live call on that thread follows the
    new state (face switched, voice re-styled). Returns how many calls were synced."""
    store = getattr(app.state, "avatar_sessions", None)
    svc = getattr(app.state, "voice", None)
    if store is None or svc is None or not thread_id:
        return 0
    calls = [s for s in store.by_thread(thread_id) if s.provider == "musetalk" and s.appearance is not None]
    for s in calls:
        try:
            res = await _sync_session(app, svc, s, reason="director")
            s.metrics.setdefault("syncs", []).append({"at": time.time(), **{k: res.get(k) for k in (
                "switched", "why", "to", "live_key", "exact", "phase")}})
        except Exception:  # noqa: BLE001 - a failed sync never breaks the Director step
            log.exception("avatar state sync for %s failed", s.id[:8])
    return len(calls)


def _services_wait_s(svc: VoiceService) -> float:
    return float(getattr(svc.settings, "avatar_services_wait_s", sync_mod.DEFAULT_SERVICES_WAIT_S))


def _remember_look(app: Any, key: str, a: sync_mod.Appearance) -> None:
    looks = getattr(app.state, "avatar_looks", None)
    if looks is None:
        looks = {}
        app.state.avatar_looks = looks
    if key not in looks and len(looks) >= MAX_LOOKS:
        looks.pop(next(iter(looks)))
    looks[key] = a


def _ready_endpoints(wm: Any) -> list[dict[str, Any]]:
    if wm is None:
        return []
    eps = wm.endpoints() if hasattr(wm, "endpoints") else [wm.llm_endpoint()]
    return [e for e in eps if e]


async def _begin_ladder(app: Any, svc: VoiceService, *, thread_id: str, photo_id: str, spec: dict[str, Any],
                        director: dict[str, Any], photo: Path, store: SessionStore) -> sync_mod.Appearance:
    """Make the case's pictures on a ready worker (the one a call would get) and remember them for
    the call and the chart. The ladder waits for the worker's edit server and runner when they are
    still coming up."""
    wm = svc.resolver.worker_manager
    eps = _ready_endpoints(wm)
    worker, _h, _cap = await mt.pick_worker(svc.client, wm, gateway_limit=_max_calls(svc), pending=store.pending_on)
    worker = worker or mt.worker_from_endpoint(eps[0])
    assert worker is not None
    gen = await sync_mod.pick_gen_worker(svc.client, wm, worker)
    a = sync_mod.new_appearance(thread_id=thread_id, photo_id=photo_id, spec=spec, director=director,
                                worker=worker, gen_worker=gen)
    a.worker_origin = worker.origin
    ig = await mt.imagegen_health(svc.client, a.gen_worker)
    a.gen_mode = ig.get("mode")
    if not ig.get("ok"):
        a.reason = (f"image edit server: {ig.get('reason') or 'not ready'}; the pictures are made when it is up")
    a.first_done = sync_mod.run_ladder(svc.client, worker, a, photo.read_bytes(), services_wait_s=_services_wait_s(svc),
                                       keepalive=lambda: _touch(svc, worker))
    _remember_look(app, f"{thread_id}:{photo_id}", a)
    return a


def _prewarms(app: Any) -> dict[str, asyncio.Task[Any]]:
    tasks = getattr(app.state, "avatar_prewarm", None)
    if tasks is None:
        tasks = {}
        app.state.avatar_prewarm = tasks
    return tasks


async def _prewarm(app: Any, svc: VoiceService, *, thread_id: str, photo_id: str, photo: Path,
                   store: SessionStore) -> None:
    """Case start with live video enabled: bring a worker up, then make the patient's pictures."""
    wm = svc.resolver.worker_manager
    try:
        await wm.ensure_worker()
    except WorkerRefused as exc:
        log.info("avatar prewarm: worker launch refused: %s", exc.reason)
        return
    view = await sync_mod.case_view(app, thread_id)
    if view is None or not _ready_endpoints(wm):
        return
    key = f"{thread_id}:{photo_id}"
    if key in (getattr(app.state, "avatar_looks", None) or {}):
        return   # a call that started meanwhile made them
    await _begin_ladder(app, svc, thread_id=thread_id, photo_id=photo_id, spec=view[0], director=view[1],
                        photo=photo, store=store)


@router.post("/prepare")
async def prepare(request: Request, body: PrepareBody, user: Principal = Depends(current_user)):
    """At case start: make the patient's pictures (presenting, worse, critical, improved...) from the
    case thread on a worker before any call, so the call opens on the patient as they are now. A call
    started later on the same worker reuses them, and the chart's still portrait shows them.

    Launches a worker only when live video is enabled for case starts
    (``AVATAR_PREWARM_ON_CASE_START``): it then answers ``worker_starting`` with ``pending_launch``
    and makes the pictures as soon as the worker is up (the idle reaper still stops it when nobody
    calls). Otherwise only an explicit call start (POST /session) or spoken voice brings a GPU up and
    this answers ``no_worker`` (``worker_starting`` while a boot someone else asked for is in flight)."""
    svc = _svc(request)
    view = await _thread_view(request, body.thread_id, user)
    if view is None:
        raise HTTPException(status_code=404, detail={"error": "thread_not_found"})
    photo = mt.portrait_path(body.photo_id)
    if photo is None:
        raise HTTPException(status_code=400, detail={"error": "unknown_photo_id", "photo_id": body.photo_id})
    wm = svc.resolver.worker_manager
    eps = _ready_endpoints(wm)
    key = f"{body.thread_id}:{body.photo_id}"
    if not eps:
        prewarms = _prewarms(request.app)
        t = prewarms.get(key)
        if t is not None and not t.done():
            return JSONResponse(status_code=202, content={"state": "worker_starting", "pending_launch": True})
        if wm is not None and getattr(svc.settings, "avatar_prewarm_on_case_start", False):
            status = await wm.status()
            if status.get("can_launch"):
                task = asyncio.get_running_loop().create_task(_prewarm(
                    request.app, svc, thread_id=body.thread_id, photo_id=body.photo_id, photo=photo,
                    store=_store(request)))
                prewarms[key] = task
                task.add_done_callback(lambda t, k=key: _prewarm_done(prewarms, k, t))
                return JSONResponse(status_code=202, content={"state": "worker_starting", "pending_launch": True})
        booting = bool(wm is not None and hasattr(wm, "store") and wm.store.active_workers())
        return JSONResponse(status_code=202, content={"state": "worker_starting" if booting else "no_worker",
                                                      "pending_launch": False})
    looks = _looks(request)
    a = looks.get(key)
    origins = {mt.worker_from_endpoint(e).origin for e in eps}  # type: ignore[union-attr]
    if a is not None and a.worker_origin in origins:
        return {"state": "prepared" if a.first_done is not None and a.first_done.is_set() else "preparing",
                "appearance": a.public()}
    a = await _begin_ladder(request.app, svc, thread_id=body.thread_id, photo_id=body.photo_id, spec=view[0],
                            director=view[1], photo=photo, store=_store(request))
    return JSONResponse(status_code=202, content={"state": "preparing", "appearance": a.public()})


def _prewarm_done(tasks: dict[str, asyncio.Task[Any]], key: str, t: asyncio.Task[Any]) -> None:
    if tasks.get(key) is t:
        tasks.pop(key, None)
    if not t.cancelled() and t.exception() is not None:
        log.warning("avatar prewarm for a case failed: %s", type(t.exception()).__name__)


def _chart_variant(a: sync_mod.Appearance, live: ap.Look) -> sync_mod.Variant | None:
    """The generated picture closest to the patient now that shows no sign they no longer have."""
    made = {k: v.look for k, v in a.variants.items() if v.image is not None}
    pick = ap.choose_variant(live, made)
    return a.variants[pick.key] if pick is not None else None


@router.get("/look")
async def look(request: Request, thread_id: str, photo_id: str, user: Principal = Depends(current_user)):
    """The chart's still portrait: the case's generated picture for how the patient is now
    (``state`` none | preparing | ready). The picture itself is at ``/look/image``."""
    view = await _thread_view(request, thread_id, user)
    if view is None:
        raise HTTPException(status_code=404, detail={"error": "thread_not_found"})
    a = _looks(request).get(f"{thread_id}:{photo_id}")
    if a is None:
        return {"state": "none", "has_image": False}
    live = sync_mod.live_look(*view)
    v = _chart_variant(a, live)
    done = a.first_done is not None and a.first_done.is_set()
    out: dict[str, Any] = {"state": "ready" if v is not None else ("failed" if done else "preparing"),
                           "has_image": v is not None, "live_key": live.key, "reason": a.reason,
                           "signs": live.public()["signs"], "phase": live.phase}
    if v is not None:
        out.update({"key": v.look.key, "exact": v.look.key == live.key, "name": v.name})
    return out


@router.get("/look/image")
async def look_image(request: Request, thread_id: str, photo_id: str, key: str,
                     user: Principal = Depends(current_user)):
    view = await _thread_view(request, thread_id, user)
    a = _looks(request).get(f"{thread_id}:{photo_id}") if view is not None else None
    v = a.variants.get(key) if a is not None else None
    if v is None or v.image is None:
        raise HTTPException(status_code=404, detail={"error": "unknown_image"})
    from fastapi.responses import Response  # noqa: PLC0415

    return Response(content=v.image, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600"})


@router.get("/appearance")
async def appearance(request: Request, session_id: str, user: Principal = Depends(current_user)):
    """The call's look: live signs, prepared variants, the picture on screen, the switches so far."""
    s = _store(request).get(session_id, user_hash=user.user_hash)
    if s is None:
        raise HTTPException(status_code=404, detail={"error": "unknown_session"})
    return {"session_id": s.id, "thread_id": s.thread_id, "avatar_id": s.avatar_id,
            "appearance": s.appearance.public() if s.appearance is not None else None,
            "voice": sync_mod.voice_for(s.appearance)}


@router.get("/appearance/image")
async def appearance_image(request: Request, session_id: str, key: str, user: Principal = Depends(current_user)):
    """One generated picture of the call's patient (owner only): what the face was edited into."""
    s = _store(request).get(session_id, user_hash=user.user_hash)
    v = s.appearance.variants.get(key) if s is not None and s.appearance is not None else None
    if v is None or v.image is None:
        raise HTTPException(status_code=404, detail={"error": "unknown_image"})
    from fastapi.responses import Response  # noqa: PLC0415

    return Response(content=v.image, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@router.post("/sync")
async def sync(request: Request, body: SessionRef, user: Principal = Depends(current_user)):
    """Re-read the case thread now (the Director hook does this after every step)."""
    svc = _svc(request)
    s = _session(request, body, user)
    out = await _sync_session(request.app, svc, s, reason="sync")
    return {**out, "appearance": s.appearance.public() if s.appearance is not None else None}


async def end_remote(svc: VoiceService, s: CallSession) -> None:
    await sync_mod.cancel(s.appearance)
    if s.provider == "musetalk" and s.worker_session:
        if s.audio_link is not None:
            await s.audio_link.close()
        worker = _session_worker(svc, s)
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
    wm = svc.resolver.worker_manager
    if s.provider == "musetalk" and s.worker_origin and wm is not None and hasattr(wm, "call_ended"):
        wm.call_ended(s.worker_origin)   # an ended call must not hold the worker against its idle window
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

    # A call bound to a case thread answers from the thread's live state (server store): the persona
    # voices it (breathless, pain, cough) and the Phoenix face gets the matching emotion tag.
    case_state, emotion = s.case_state, None
    if s.thread_id:
        view = await sync_mod.case_view(request.app, s.thread_id)
        if view is not None:
            look = sync_mod.live_look(*view)
            case_state = {**s.case_state, "voice": ap.voice_style(look)["persona_lines"],
                          "affect": (view[1] or {}).get("affect") or s.case_state.get("affect")}
            emotion = tv.emotion_for(look)
    if learner_msg:
        out = await patient_turn(PatientTurnRequest(learner_msg=learner_msg, case_state=case_state,
                                                    persona=s.persona, history=history,
                                                    case_context=s.case_context, locale=s.lang))
        text, routed = ap.speakable(out.utterance, s.lang), out.routed_as
        if emotion and text:
            text = tv.emotion_tag(emotion) + text
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
