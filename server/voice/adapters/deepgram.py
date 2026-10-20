"""Deepgram adapters.

STT (Nova-3, pre-recorded): ``POST {base}/v1/listen?model=nova-3&language=tr&smart_format=true``
with the raw audio as the body and its media type as ``Content-Type``;
``Authorization: Token <key>``. The reply carries
``results.channels[0].alternatives[0].{transcript, confidence}`` and, with
``detect_language``, ``results.channels[0].detected_language``
(https://developers.deepgram.com/reference/speech-to-text/listen-pre-recorded).
Nova-3 lists ``tr`` and ``tr-TR`` (https://developers.deepgram.com/docs/models-languages-overview).

Streaming: the websocket ``/v1/listen`` endpoint is used by the LiveKit agent
worker through ``livekit-plugins-deepgram`` (workers/voice_agent), which owns the
microphone stream; this gateway adapter serves the request/response dictation
path and the assessment re-transcription, where the whole clip is available.

TTS (Aura-2): ``POST {base}/v1/speak?model=aura-2-thalia-en&encoding=mp3`` with
JSON ``{text}`` (https://developers.deepgram.com/reference/text-to-speech/speak-request).
Aura speaks en, es, de, nl, fr, it and ja only
(https://developers.deepgram.com/docs/tts-models), so Turkish raises
:class:`LanguageUnsupported` and the service moves to the next provider.
"""

from __future__ import annotations

from typing import Any

import httpx

from server.registry.resolve import ProviderEndpoint
from server.voice.base import LanguageUnsupported, SttRequest, SttResult, TtsRequest, TtsStream, VoiceError

DEFAULT_STT_MODEL = "nova-3"
DEFAULT_TTS_MODEL = "aura-2-thalia-en"
AURA_LANGUAGES = frozenset({"en", "es", "de", "nl", "fr", "it", "ja"})
NOVA3_LANGUAGES = frozenset(
    "af ar hy as be bn bs bg ca zh hr cs da nl en et fi fr ka de el gu he hi hu id it ja kn kk ko lv lt mk ms mr mn "
    "ne no ps fa pl pt pa ro ru sr sk sl es sv tl ta te th tr uk ur vi multi".split())


def _auth(ep: ProviderEndpoint) -> dict[str, str]:
    return {"Authorization": f"Token {ep.api_key}"} if ep.api_key else {}


class DeepgramStt:
    name = "deepgram"

    @staticmethod
    def model_for(ep: ProviderEndpoint) -> str:
        return str(ep.extra.get("stt_model") or ep.model or DEFAULT_STT_MODEL)

    async def transcribe(self, client: httpx.AsyncClient, ep: ProviderEndpoint, req: SttRequest) -> SttResult:
        model = req.model or self.model_for(ep)
        params: dict[str, Any] = {"model": model, "smart_format": "true"}
        if req.lang and req.lang in NOVA3_LANGUAGES:
            params["language"] = req.lang
        else:
            params["detect_language"] = "true"
        keyterms = ep.extra.get("keyterms")
        if isinstance(keyterms, list) and keyterms:
            params["keyterm"] = [str(k) for k in keyterms[:100]]
        resp = await client.post(f"{ep.base_url}/v1/listen", params=params, content=req.audio,
                                 headers={**_auth(ep), "Content-Type": req.content_type})
        if resp.status_code >= 400:
            raise VoiceError(self.name, f"HTTP {resp.status_code} {resp.text[:300]}", status=resp.status_code)
        j = resp.json()
        try:
            channel = j["results"]["channels"][0]
            alt = channel["alternatives"][0]
        except (KeyError, IndexError, TypeError) as exc:
            raise VoiceError(self.name, f"unexpected transcript shape: {exc}") from exc
        duration = (j.get("metadata") or {}).get("duration")
        detected = channel.get("detected_language") or params.get("language")
        conf = alt.get("confidence")
        return SttResult(text=str(alt.get("transcript") or "").strip(),
                         language=str(detected)[:2] if detected else None,
                         confidence=float(conf) if isinstance(conf, (int, float)) else None, model=model,
                         audio_seconds=float(duration) if isinstance(duration, (int, float)) else None, raw=j)


class DeepgramTts:
    name = "deepgram"
    languages = AURA_LANGUAGES

    def supports_language(self, lang: str) -> bool:
        return lang in AURA_LANGUAGES

    @staticmethod
    def model_for(ep: ProviderEndpoint, voice_id: str | None = None) -> str:
        return voice_id or str(ep.extra.get("model") or ep.model or DEFAULT_TTS_MODEL)

    async def synthesize(self, client: httpx.AsyncClient, ep: ProviderEndpoint, req: TtsRequest) -> TtsStream:
        if not self.supports_language(req.lang):
            raise LanguageUnsupported(self.name, f"Aura-2 does not speak {req.lang!r}")
        # Aura voices are model ids (``aura-2-thalia-en``); the resolved voice id is the model.
        model = self.model_for(ep, req.voice_id if req.voice_id.startswith("aura") else None)
        if not model.endswith(f"-{req.lang}"):
            raise LanguageUnsupported(self.name, f"voice {model} is not a {req.lang} voice")
        encoding, content_type = ("mp3", "audio/mpeg") if req.output_format == "mp3" else ("linear16", "audio/wav")
        params: dict[str, Any] = {"model": model, "encoding": encoding}
        if encoding == "linear16":
            params.update(container="wav", sample_rate=24000)
        request = client.build_request("POST", f"{ep.base_url}/v1/speak", params=params, json={"text": req.text},
                                       headers={**_auth(ep), "Content-Type": "application/json"})
        resp = await client.send(request, stream=True)
        if resp.status_code >= 400:
            await resp.aread()
            await resp.aclose()
            raise VoiceError(self.name, f"HTTP {resp.status_code} {resp.text[:300]}", status=resp.status_code)

        async def chunks():
            try:
                async for chunk in resp.aiter_bytes():
                    if chunk:
                        yield chunk
            finally:
                await resp.aclose()

        return TtsStream(content_type=resp.headers.get("content-type", content_type).split(";")[0], chunks=chunks(),
                         model=model)
