"""Voice HTTP surface.

POST /v1/voice/tts            {text, lang, sex, age, voice_id?, format?} -> chunked audio/mpeg or audio/wav
                               headers: X-Voice-Provider, X-Voice-Adapter, X-Voice-Model, X-Voice-Source,
                               X-Voice-Id, X-Audio-Duration-Ms (when known), X-Voice-TTFB-Ms
POST /v1/voice/stt            multipart file (+ lang) -> {text, language, confidence, provider, model, audio_seconds}
GET  /v1/voice/capabilities   what is enabled now (provider, adapter, languages) for tts / stt / avatar
POST /v1/voice/warm           signed in: the learner started the call; launch the on-demand GPU worker in
                               the background and answer at once {ready, pending_launch, refusal}
POST /v1/voice/room           {encounter_id, identity?, name?} -> {url, token, room, renderer} when a LiveKit
                               avatar row is configured, else 404. Signed in only (401 when anonymous): the
                               token is a room credential, so the participant identity is derived from the
                               caller's hashed subject and the metadata is JSON-encoded, never string-built
GET  /admin/voice/agent-config resolved stt / tts / avatar / livekit config for the agent worker (admin token)

503 ``{error: "<kind>_unavailable", airgapped, reasons[], pending_launch}`` when no provider can serve
(every hosted row refused under AIRGAPPED and the GPU worker refused or absent). ``pending_launch``
is true while the GPU worker boots (TTS answers this at once instead of waiting on the boot): retry.
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from server.admin_routes import require_admin
from server.auth.deps import Principal, current_user, optional_user
from server.voice import livekit as lk
from server.voice.adapters import STT_ADAPTERS, TTS_ADAPTERS, adapter_name_for
from server.voice.service import NoVoiceProvider, VoiceService

router = APIRouter(prefix="/v1/voice", tags=["voice"])
admin_router = APIRouter(prefix="/admin/voice", tags=["admin"], dependencies=[Depends(require_admin)])

MAX_TTS_CHARS = 1200
MAX_STT_BYTES = 25 * 1024 * 1024


def _service(request: Request) -> VoiceService:
    svc = getattr(request.app.state, "voice", None)
    if svc is None:
        raise HTTPException(status_code=503, detail="voice service is not wired")
    return svc


class TtsBody(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TTS_CHARS)
    lang: str = "en"
    sex: str | None = None
    age: float | None = Field(default=None, ge=0, le=120)
    voice_id: str | None = None
    format: str = Field(default="mp3", pattern="^(mp3|wav)$")
    speed: float = Field(default=1.0, ge=0.5, le=2.0)


async def signed_in_when_oidc(request: Request, user: Principal | None = Depends(optional_user)) -> None:
    """Under AUTH_MODE=oidc speech needs a verified user: an anonymous TTS or STT call could
    otherwise wake the on-demand GPU worker (billed by the hour) from the open internet."""
    auth = getattr(request.app.state, "auth", None)
    if user is None and auth is not None and getattr(auth, "mode", None) == "oidc":
        raise HTTPException(status_code=401, detail={"reason": "unauthenticated", "message": "sign in to use voice"},
                            headers={"WWW-Authenticate": "Bearer"})


def _unavailable(exc: NoVoiceProvider) -> JSONResponse:
    return JSONResponse(status_code=503, content={"error": f"{exc.kind}_unavailable", "airgapped": exc.airgapped,
                                                  "reasons": exc.reasons, "pending_launch": exc.pending_launch})


@router.post("/tts", dependencies=[Depends(signed_in_when_oidc)])
async def tts(request: Request, body: TtsBody):
    svc = _service(request)
    try:
        out = await svc.tts(body.text, lang=body.lang, sex=body.sex, age=body.age, voice_id=body.voice_id,
                            output_format=body.format, speed=body.speed)
    except NoVoiceProvider as exc:
        return _unavailable(exc)
    headers = {
        "Cache-Control": "no-store",
        "X-Voice-Provider": out.endpoint.name,
        "X-Voice-Adapter": out.adapter,
        "X-Voice-Model": out.stream.model,
        "X-Voice-Source": out.endpoint.source,
        "X-Voice-Id": out.voice_id,
        "X-Voice-TTFB-Ms": str(int(round(out.ttfb_ms))),
    }
    if out.stream.duration_ms is not None:
        headers["X-Audio-Duration-Ms"] = str(int(out.stream.duration_ms))
    return StreamingResponse(out.stream.chunks, media_type=out.stream.content_type, headers=headers)


@router.post("/stt", dependencies=[Depends(signed_in_when_oidc)])
async def stt(request: Request, file: UploadFile = File(...), lang: str | None = Form(default=None)):
    svc = _service(request)
    audio = await file.read()
    if not audio:
        raise HTTPException(status_code=400, detail="empty audio")
    if len(audio) > MAX_STT_BYTES:
        raise HTTPException(status_code=413, detail="audio larger than 25 MB")
    try:
        out = await svc.stt(audio, content_type=file.content_type or "application/octet-stream",
                            filename=file.filename or "audio.webm", lang=lang)
    except NoVoiceProvider as exc:
        return _unavailable(exc)
    r = out.result
    return {"text": r.text, "language": r.language, "confidence": r.confidence, "provider": out.endpoint.name,
            "adapter": out.adapter, "model": r.model, "source": out.endpoint.source, "audio_seconds": r.audio_seconds,
            "latency_ms": round(out.latency_ms, 1)}


@router.get("/capabilities")
async def capabilities(request: Request) -> dict[str, Any]:
    return await _service(request).capabilities(probe_worker=True)


@router.post("/warm")
async def warm(request: Request, user: Principal = Depends(current_user)) -> dict[str, Any]:
    """The learner started the patient call: wake the on-demand GPU worker (voice, live video)
    and return at once. Never waits on the boot; the call polls /capabilities for readiness."""
    svc = _service(request)
    wm = svc.resolver.worker_manager
    if wm is None:
        return {"ready": False, "pending_launch": False, "refusal": None}
    if wm.llm_endpoint():
        # A learner waiting for the live video is using the worker: its runner and image edits come up
        # minutes after the LLM, and the idle reaper must not stop it meanwhile (live 2026-10-21).
        wm.touch()
        return {"ready": True, "pending_launch": False, "refusal": None}
    status = await wm.status()
    if not status.get("can_launch"):
        return {"ready": False, "pending_launch": False, "refusal": status.get("refusal")}
    svc.wake_worker()
    return {"ready": False, "pending_launch": True, "refusal": None}


class RoomBody(BaseModel):
    encounter_id: str = Field(min_length=1, max_length=120)
    identity: str | None = Field(default=None, max_length=120)
    name: str | None = Field(default=None, max_length=120)


@router.post("/room")
async def room(request: Request, body: RoomBody, user: Principal = Depends(current_user)) -> dict[str, Any]:
    svc = _service(request)
    cfg = None
    for ep in svc.resolver.endpoints("avatar"):
        cfg = lk.config_from_endpoint(ep)
        if cfg is not None:
            break
    if cfg is None:
        refused = [r.name for r in svc.resolver.refused("avatar")]
        raise HTTPException(status_code=404, detail={"error": "avatar_unavailable",
                                                     "reasons": [f"{n}: refused by AIRGAPPED" for n in refused]})
    room_id = lk.room_name(body.encounter_id)
    # The participant identity is bound to the caller's hashed subject (no raw sub or
    # name in LiveKit logs); a client-chosen identity only disambiguates the caller's
    # own devices, it can never impersonate another learner.
    identity = f"learner-{user.user_hash}" + (f"-{body.identity}" if body.identity else "")
    metadata = json.dumps({"encounter_id": body.encounter_id, "user_hash": user.user_hash,
                           "verified": user.verified}, separators=(",", ":"))
    token = lk.issue_token(cfg, room=room_id, identity=identity, name=body.name or user.name, metadata=metadata)
    return {"url": cfg.url, "token": token, "room": room_id, "identity": identity, "renderer": cfg.renderer,
            "ttl_s": lk.DEFAULT_TTL_S}


# --------------------------------------------------------------------------- #
# agent worker configuration (server to server, admin token)                   #
# --------------------------------------------------------------------------- #
# Review 04 O8: the agent worker gets an allow-list of ``extra`` keys, never the whole dict,
# so a secret an operator parks in ``extra`` does not ship. These are exactly the keys
# workers/voice_agent/selection.py reads.
AGENT_ENGINE_EXTRA_KEYS = ("voices",)
AGENT_AVATAR_OPTION_KEYS = ("face_id", "emotion_id", "avatar_id", "persona_name", "runner_identity")


def _agent_block(ep, adapters: dict[str, Any]) -> dict[str, Any] | None:
    if ep is None:
        return None
    name = adapter_name_for(ep)
    adapter = adapters[name]
    return {"provider": ep.name, "adapter": name, "base_url": ep.base_url, "api_key": ep.api_key,
            "model": adapter.model_for(ep) if hasattr(adapter, "model_for") else ep.model, "source": ep.source,
            "extra": {k: ep.extra[k] for k in AGENT_ENGINE_EXTRA_KEYS if k in ep.extra}}


@admin_router.get("/agent-config")
async def agent_config(request: Request) -> dict[str, Any]:
    """Everything ``workers/voice_agent`` needs to build its session: keys included, never cached client-side.
    Reads a GPU worker only when one is already ready: fetching config never launches one."""
    svc = _service(request)
    out: dict[str, Any] = {"airgapped": svc.settings.airgapped, "gateway": {"patient_turn_path": "/v1/patient/turn"}}
    for kind, adapters in (("tts", TTS_ADAPTERS), ("stt", STT_ADAPTERS)):
        eps = svc.resolver.endpoints(kind)
        ep = eps[0] if eps else await svc.resolver.resolve_worker(kind, launch=False)
        out[kind] = _agent_block(ep, adapters)
    avatar: dict[str, Any] | None = None
    livekit: dict[str, Any] | None = None
    for ep in svc.resolver.endpoints("avatar"):
        cfg = lk.config_from_endpoint(ep)
        if cfg is not None and livekit is None:
            livekit = {"url": cfg.url, "api_key": cfg.api_key, "api_secret": cfg.api_secret}
            avatar = {"renderer": cfg.renderer, "provider": ep.name,
                      "api_key": str(ep.extra.get("renderer_api_key") or ""),
                      "options": {k: ep.extra[k] for k in AGENT_AVATAR_OPTION_KEYS if k in ep.extra}}
    out["avatar"] = avatar
    out["livekit"] = livekit
    return out
