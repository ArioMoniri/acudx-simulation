"""ElevenLabs adapters.

TTS: ``POST {base}/v1/text-to-speech/{voice_id}/stream?output_format=...`` with
``xi-api-key``; JSON body ``{text, model_id, language_code?, voice_settings?}``;
the response is a chunked audio stream
(https://elevenlabs.io/docs/api-reference/text-to-speech/stream). The default
model is ``eleven_flash_v2_5`` (32 languages including ``tr``, about 75 ms,
$0.04 per 1k chars); ``extra.model_id`` switches to ``eleven_v4_turbo`` (90+
languages) or ``eleven_multilingual_v2`` (https://elevenlabs.io/docs/overview/models).

STT (Scribe): ``POST {base}/v1/speech-to-text`` multipart ``model_id`` (required),
``file``, ``language_code?`` -> ``{text, language_code, language_probability, words}``
(https://elevenlabs.io/docs/api-reference/speech-to-text/convert). Default model
``scribe_v2`` (Turkish in the "Excellent" tier per the research doc), overridable
with ``extra.stt_model_id``.
"""

from __future__ import annotations

from typing import Any

import httpx

from server.registry.resolve import ProviderEndpoint
from server.voice.base import LanguageUnsupported, SttRequest, SttResult, TtsRequest, TtsStream, VoiceError

DEFAULT_TTS_MODEL = "eleven_flash_v2_5"
DEFAULT_STT_MODEL = "scribe_v2"

# Languages of eleven_multilingual_v2 / flash_v2_5 (https://elevenlabs.io/docs/overview/models).
FLASH_LANGUAGES = frozenset(
    "en ja zh de hi fr ko pt it es id nl tr fil pl sv bg ro ar cs el fi hr ms sk da ta uk ru hu no vi".split())

_OUTPUT_FORMATS = {"mp3": ("mp3_44100_128", "audio/mpeg"), "wav": ("pcm_24000", "audio/pcm")}


def _check(resp: httpx.Response, provider: str) -> None:
    if resp.status_code >= 400:
        body = resp.text[:300] if hasattr(resp, "text") else ""
        raise VoiceError(provider, f"HTTP {resp.status_code} {body}", status=resp.status_code)


class ElevenLabsTts:
    name = "elevenlabs"
    languages = None    # v4 family covers 90+ languages; flash is checked per model below

    def supports_language(self, lang: str) -> bool:
        return True

    @staticmethod
    def model_for(ep: ProviderEndpoint) -> str:
        return str(ep.extra.get("model_id") or ep.model or DEFAULT_TTS_MODEL)

    async def synthesize(self, client: httpx.AsyncClient, ep: ProviderEndpoint, req: TtsRequest) -> TtsStream:
        model = req.model or self.model_for(ep)
        if model in ("eleven_flash_v2_5", "eleven_turbo_v2_5", "eleven_multilingual_v2") and req.lang not in FLASH_LANGUAGES:
            raise LanguageUnsupported(self.name, f"{model} does not list language {req.lang!r}")
        if model in ("eleven_flash_v2", "eleven_turbo_v2") and req.lang != "en":
            raise LanguageUnsupported(self.name, f"{model} is English only")
        fmt, content_type = _OUTPUT_FORMATS.get(req.output_format, _OUTPUT_FORMATS["mp3"])
        settings: dict[str, Any] = {"stability": 0.5, "similarity_boost": 0.75}
        if isinstance(ep.extra.get("voice_settings"), dict):
            settings.update(ep.extra["voice_settings"])
        if req.speed and req.speed != 1.0:
            settings["speed"] = max(0.7, min(1.2, req.speed))
        body: dict[str, Any] = {"text": req.text, "model_id": model, "voice_settings": settings}
        # language_code is ignored by multilingual_v2 and honoured by flash / v4 models.
        if model != "eleven_multilingual_v2":
            body["language_code"] = req.lang
        url = f"{ep.base_url}/v1/text-to-speech/{req.voice_id}/stream"
        request = client.build_request("POST", url, params={"output_format": fmt}, json=body,
                                       headers={"xi-api-key": ep.api_key, "Accept": content_type})
        resp = await client.send(request, stream=True)
        if resp.status_code >= 400:
            await resp.aread()
            await resp.aclose()
            _check(resp, self.name)

        async def chunks():
            try:
                async for chunk in resp.aiter_bytes():
                    if chunk:
                        yield chunk
            finally:
                await resp.aclose()

        return TtsStream(content_type=resp.headers.get("content-type", content_type).split(";")[0], chunks=chunks(),
                         model=model, sample_rate=24000 if fmt == "pcm_24000" else None)


class ElevenLabsStt:
    name = "elevenlabs"

    @staticmethod
    def model_for(ep: ProviderEndpoint) -> str:
        return str(ep.extra.get("stt_model_id") or ep.model or DEFAULT_STT_MODEL)

    async def transcribe(self, client: httpx.AsyncClient, ep: ProviderEndpoint, req: SttRequest) -> SttResult:
        model = req.model or self.model_for(ep)
        data: dict[str, str] = {"model_id": model}
        if req.lang:
            data["language_code"] = req.lang
        resp = await client.post(f"{ep.base_url}/v1/speech-to-text", data=data,
                                 files={"file": (req.filename, req.audio, req.content_type)},
                                 headers={"xi-api-key": ep.api_key})
        _check(resp, self.name)
        try:
            j = resp.json()
        except ValueError as exc:
            raise VoiceError(self.name, f"non-JSON transcript: {exc}") from exc
        text = str(j.get("text") or "").strip()
        lang = j.get("language_code")
        words = j.get("words") or []
        audio_s = j.get("audio_duration_secs")
        if audio_s is None and words:
            last = words[-1]
            if isinstance(last, dict) and isinstance(last.get("end"), (int, float)):
                audio_s = float(last["end"])
        conf = j.get("language_probability")
        return SttResult(text=text, language=str(lang)[:2] if isinstance(lang, str) and lang else None,
                         confidence=float(conf) if isinstance(conf, (int, float)) else None, model=model,
                         audio_seconds=float(audio_s) if isinstance(audio_s, (int, float)) else None, raw=j)
