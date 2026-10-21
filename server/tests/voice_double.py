"""In-process double of the GPU worker's voice routes (tests only, protocol section 2).

Mirrors ``infra/gpu-worker/cloud-init.yaml``: every route needs ``Authorization:
Bearer <token>``; ``/tts/v1/audio/speech`` answers like Chatterbox TTS API /
Kokoro FastAPI (OpenAI ``createSpeech`` shape, WAV body); ``/stt/v1/audio/transcriptions``
answers like speaches (OpenAI ``createTranscription`` ``verbose_json``).
"""

from __future__ import annotations

import struct
from dataclasses import dataclass, field
from typing import Any

import httpx
from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import Response, StreamingResponse

WORKER_TOKEN = "worker-token-123"


def wav_bytes(seconds: float = 0.5, rate: int = 24000) -> bytes:
    """A silent 16-bit mono PCM WAV with a correct header."""
    n = int(seconds * rate)
    data = b"\x00\x00" * n
    header = b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVE"
    header += b"fmt " + struct.pack("<IHHIIHH", 16, 1, 1, rate, rate * 2, 2, 16)
    header += b"data" + struct.pack("<I", len(data))
    return header + data


@dataclass
class WorkerScenario:
    tts_calls: list[dict[str, Any]] = field(default_factory=list)
    stt_calls: list[dict[str, Any]] = field(default_factory=list)
    transcript: str = "Göğsümde baskı hissediyorum."
    language: str = "tr"
    duration_s: float = 3.2
    tts_status: int = 200
    stt_status: int = 200
    tts_health_status: int = 200     # Chatterbox GET /health behind Caddy's /tts prefix
    tts_health_hits: int = 0


def build_worker_double(sc: WorkerScenario) -> FastAPI:
    app = FastAPI()

    def _auth(authorization: str | None) -> None:
        if authorization != f"Bearer {WORKER_TOKEN}":
            raise HTTPException(status_code=401, detail="unauthorized")

    @app.get("/healthz")
    async def healthz(authorization: str | None = Header(default=None)) -> Response:
        _auth(authorization)
        return Response("ok", media_type="text/plain")

    @app.get("/tts/health")
    async def tts_health(authorization: str | None = Header(default=None)) -> Response:
        _auth(authorization)
        sc.tts_health_hits += 1
        return Response("ok" if sc.tts_health_status == 200 else "building", status_code=sc.tts_health_status)

    @app.post("/tts/v1/audio/speech")
    async def speech(request: Request, authorization: str | None = Header(default=None)):
        _auth(authorization)
        body = await request.json()
        sc.tts_calls.append(body)
        if sc.tts_status != 200:
            raise HTTPException(status_code=sc.tts_status, detail="tts failed")
        audio = wav_bytes()

        async def gen():
            yield audio[:44]
            yield audio[44:]

        return StreamingResponse(gen(), media_type="audio/wav")

    @app.post("/tts-en/v1/audio/speech")
    async def kokoro_speech(request: Request, authorization: str | None = Header(default=None)):
        """The worker's Kokoro (English voices) behind Caddy's /tts-en prefix."""
        _auth(authorization)
        body = await request.json()
        sc.tts_calls.append({**body, "_route": "kokoro"})
        return Response(wav_bytes(), media_type="audio/wav")

    @app.post("/tts/v1/audio/speech/stream")
    async def speech_stream(request: Request, authorization: str | None = Header(default=None)):
        """Chatterbox ``/speech/stream``: a WAV header with an unknown size, then PCM per text chunk."""
        _auth(authorization)
        body = await request.json()
        sc.tts_calls.append({**body, "_route": "stream"})
        if sc.tts_status != 200:
            raise HTTPException(status_code=sc.tts_status, detail="tts failed")
        audio = wav_bytes()
        header = bytearray(audio[:44])
        header[4:8] = (0xFFFFFFFF).to_bytes(4, "little")
        header[40:44] = (0xFFFFFFFF).to_bytes(4, "little")
        pcm = audio[44:]

        async def gen():
            yield bytes(header[:30])          # a header split across chunks
            yield bytes(header[30:]) + pcm[:1001]
            yield pcm[1001:]

        return StreamingResponse(gen(), media_type="audio/wav")

    @app.post("/stt/v1/audio/transcriptions")
    async def transcriptions(file: UploadFile = File(...), model: str = Form(...),
                             language: str | None = Form(default=None),
                             response_format: str = Form(default="json"),
                             authorization: str | None = Header(default=None)) -> dict[str, Any]:
        _auth(authorization)
        data = await file.read()
        sc.stt_calls.append({"model": model, "language": language, "response_format": response_format,
                             "filename": file.filename, "content_type": file.content_type, "size": len(data)})
        if sc.stt_status != 200:
            raise HTTPException(status_code=sc.stt_status, detail="stt failed")
        return {"task": "transcribe", "language": sc.language, "duration": sc.duration_s, "text": sc.transcript,
                "segments": [{"id": 0, "start": 0.0, "end": sc.duration_s, "text": sc.transcript,
                              "avg_logprob": -0.1054, "no_speech_prob": 0.01}]}

    return app


class HostRouter(httpx.AsyncBaseTransport):
    """Dispatch by host: the worker double over ASGI, everything else to the fallback transport (respx)."""

    def __init__(self, asgi_hosts: dict[str, FastAPI], fallback: httpx.AsyncBaseTransport | None = None):
        self._asgi = {host: httpx.ASGITransport(app=app) for host, app in asgi_hosts.items()}
        self._fallback = fallback or httpx.AsyncHTTPTransport()

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        t = self._asgi.get(request.url.host)
        if t is not None:
            return await t.handle_async_request(request)
        return await self._fallback.handle_async_request(request)
