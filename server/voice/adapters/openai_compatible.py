"""OpenAI-compatible audio adapters (the GPU worker, OpenAI itself, any clone).

TTS: ``POST {base}/v1/audio/speech`` JSON ``{model, input, voice, response_format, speed}``
-> encoded audio (https://platform.openai.com/docs/api-reference/audio/createSpeech).
Served by the worker's Chatterbox Multilingual API
(https://github.com/travisvn/chatterbox-tts-api, ``voice`` names a library voice
that carries its language) and by Kokoro FastAPI.

STT: ``POST {base}/v1/audio/transcriptions`` multipart ``file``, ``model``,
``language?``, ``response_format=verbose_json`` -> ``{text, language, duration, segments}``
(https://platform.openai.com/docs/api-reference/audio/createTranscription). Served
by the worker's speaches (faster-whisper large-v3-turbo, https://speaches.ai).

``extra.audio_path`` (default ``/v1/audio``) lets a server mount the audio routes
elsewhere; the worker's Caddy strips ``/tts`` and ``/stt`` prefixes so the default works
with ``base_url = https://<worker>/tts`` and ``https://<worker>/stt``.
"""

from __future__ import annotations

import math
from typing import Any

import httpx

from server.registry.resolve import ProviderEndpoint
from server.voice.base import SttRequest, SttResult, TtsRequest, TtsStream, VoiceError, wav_duration_ms

DEFAULT_TTS_MODEL = "tts-1"
DEFAULT_STT_MODEL = "deepdml/faster-whisper-large-v3-turbo-ct2"
# Whisper's ``prompt`` (initial prompt): the setting and its vocabulary in the spoken language. Live 2026-10-22
# on synthetic Turkish clinical clips the worker's large-v3-turbo scored 45 % WER without it and 29 % with it;
# English stayed at 0 (docs/media/live-avatar/stt-guard/). Sent for the worker by default, for a registry row
# only when its ``extra.stt_prompt`` sets one (a string, or one per language); ``false`` switches it off.
DEFAULT_STT_PROMPTS: dict[str, str] = {
    "tr": "Acil serviste doktor hastaya soruyor: göğüs ağrısı, nefes darlığı, ateş, öksürük, alerji, ilaç, "
          "oksijen, EKG.",
    "en": "In the emergency department the doctor asks the patient: chest pain, shortness of breath, fever, "
          "cough, allergies, medicines, oxygen, ECG.",
}
_CONTENT_TYPES = {"mp3": "audio/mpeg", "wav": "audio/wav", "opus": "audio/ogg", "flac": "audio/flac"}


def _audio_base(ep: ProviderEndpoint) -> str:
    path = str(ep.extra.get("audio_path") or "/v1/audio").strip("/")
    return f"{ep.base_url}/{path}"


class OpenAiCompatibleTts:
    name = "openai_compatible"
    languages = None

    def supports_language(self, lang: str) -> bool:
        allowed = self._declared_languages()
        return True if allowed is None else lang in allowed

    def _declared_languages(self):
        return None

    @staticmethod
    def model_for(ep: ProviderEndpoint) -> str:
        return str(ep.extra.get("tts_model") or ep.model or DEFAULT_TTS_MODEL)

    @staticmethod
    def stream_route(ep: ProviderEndpoint) -> tuple[str, dict[str, Any]]:
        """Path and body fields for incremental audio.

        The GPU worker's Chatterbox API answers ``/speech`` only once the whole utterance is
        synthesised; ``/speech/stream`` sends the WAV header at once and then each text chunk's
        PCM as soon as it is generated (chatterbox-tts-api ``app/api/endpoints/speech.py``,
        ``streaming_chunk_size`` >= 50 characters, ``streaming_strategy`` sentence). Kokoro and
        OpenAI stream ``/speech`` already. ``extra.tts_stream_path`` / ``extra.tts_stream_body``
        override per row.
        """
        path = ep.extra.get("tts_stream_path")
        body = ep.extra.get("tts_stream_body")
        if ep.source == "gpu_worker":
            path = path or "/speech/stream"
            body = body if isinstance(body, dict) else {"streaming_chunk_size": 60, "streaming_strategy": "sentence"}
        return (str(path) if path else "/speech"), (dict(body) if isinstance(body, dict) else {})

    async def synthesize(self, client: httpx.AsyncClient, ep: ProviderEndpoint, req: TtsRequest) -> TtsStream:
        model = req.model or self.model_for(ep)
        fmt = req.output_format if req.output_format in _CONTENT_TYPES else "mp3"
        body: dict[str, Any] = {"model": model, "input": req.text, "voice": req.voice_id, "response_format": fmt}
        if req.speed and req.speed != 1.0:
            body["speed"] = max(0.25, min(4.0, req.speed))
        extra_body = ep.extra.get("tts_body")
        if isinstance(extra_body, dict):
            body.update(extra_body)   # e.g. Chatterbox {"exaggeration": 0.6, "cfg_weight": 0.4}
        path = "/speech"
        if req.stream:
            path, stream_body = self.stream_route(ep)
            body.update(stream_body)
        headers = {"Content-Type": "application/json"}
        if ep.api_key:
            headers["Authorization"] = f"Bearer {ep.api_key}"
        request = client.build_request("POST", f"{_audio_base(ep)}{path}", json=body, headers=headers)
        resp = await client.send(request, stream=True)
        if resp.status_code >= 400:
            await resp.aread()
            await resp.aclose()
            raise VoiceError(self.name, f"HTTP {resp.status_code} {resp.text[:300]}", status=resp.status_code)
        content_type = resp.headers.get("content-type", _CONTENT_TYPES[fmt]).split(";")[0].strip()
        iterator = resp.aiter_bytes()
        first = b""
        duration_ms: int | None = None
        try:
            async for chunk in iterator:
                if chunk:
                    first = chunk
                    break
        except httpx.HTTPError as exc:
            await resp.aclose()
            raise VoiceError(self.name, f"stream failed: {exc}") from exc
        if content_type in ("audio/wav", "audio/x-wav", "audio/wave") or first[:4] == b"RIFF":
            duration_ms = wav_duration_ms(first[:64])
            if content_type.startswith("application/") or content_type == "audio/mpeg":
                content_type = "audio/wav"

        async def chunks():
            try:
                if first:
                    yield first
                async for chunk in iterator:
                    if chunk:
                        yield chunk
            finally:
                await resp.aclose()

        return TtsStream(content_type=content_type, chunks=chunks(), model=model, duration_ms=duration_ms)


class OpenAiCompatibleStt:
    name = "openai_compatible"

    @staticmethod
    def model_for(ep: ProviderEndpoint) -> str:
        return str(ep.extra.get("stt_model") or ep.model or DEFAULT_STT_MODEL)

    @staticmethod
    def prompt_for(ep: ProviderEndpoint, lang: str | None) -> str | None:
        """The initial prompt for ``lang`` (see DEFAULT_STT_PROMPTS); None without a language."""
        if not lang:
            return None
        cfg = ep.extra.get("stt_prompt")
        if cfg is False:
            return None
        if isinstance(cfg, str):
            return cfg.strip() or None
        if isinstance(cfg, dict):
            val = cfg.get(lang)
            return (str(val).strip() or None) if val else None
        return DEFAULT_STT_PROMPTS.get(lang) if ep.source == "gpu_worker" else None

    async def transcribe(self, client: httpx.AsyncClient, ep: ProviderEndpoint, req: SttRequest) -> SttResult:
        model = req.model or self.model_for(ep)
        data: dict[str, str] = {"model": model, "response_format": "verbose_json"}
        if req.lang:
            data["language"] = req.lang
        prompt = self.prompt_for(ep, req.lang)
        if prompt:
            data["prompt"] = prompt
        headers = {"Authorization": f"Bearer {ep.api_key}"} if ep.api_key else {}
        resp = await client.post(f"{_audio_base(ep)}/transcriptions", data=data,
                                 files={"file": (req.filename, req.audio, req.content_type)}, headers=headers)
        if resp.status_code >= 400:
            raise VoiceError(self.name, f"HTTP {resp.status_code} {resp.text[:300]}", status=resp.status_code)
        try:
            j = resp.json()
        except ValueError as exc:
            raise VoiceError(self.name, f"non-JSON transcript: {exc}") from exc
        text = str(j.get("text") or "").strip()
        # Whisper-style servers report avg_logprob per segment; exp() of the mean is a usable confidence.
        conf: float | None = None
        segs = j.get("segments")
        if isinstance(segs, list) and segs:
            lps = [s.get("avg_logprob") for s in segs if isinstance(s, dict) and isinstance(s.get("avg_logprob"), (int, float))]
            if lps:
                conf = max(0.0, min(1.0, math.exp(sum(lps) / len(lps))))
        duration = j.get("duration")
        lang = j.get("language")
        return SttResult(text=text, language=_iso(lang), confidence=conf, model=model,
                         audio_seconds=float(duration) if isinstance(duration, (int, float)) else None, raw=j)


_NAMES = {"english": "en", "turkish": "tr", "german": "de", "french": "fr", "spanish": "es", "arabic": "ar"}


def _iso(lang: Any) -> str | None:
    if not isinstance(lang, str) or not lang:
        return None
    low = lang.strip().lower()
    return _NAMES.get(low, low[:2])
