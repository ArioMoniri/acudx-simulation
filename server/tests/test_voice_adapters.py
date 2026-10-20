"""Hosted voice adapters against respx with the providers' documented request shapes.

ElevenLabs TTS stream: https://elevenlabs.io/docs/api-reference/text-to-speech/stream
ElevenLabs STT:        https://elevenlabs.io/docs/api-reference/speech-to-text/convert
Deepgram pre-recorded: https://developers.deepgram.com/reference/speech-to-text/listen-pre-recorded
Deepgram speak:        https://developers.deepgram.com/reference/text-to-speech/speak-request
OpenAI audio:          https://platform.openai.com/docs/api-reference/audio
"""

from __future__ import annotations

import json

import httpx
import pytest
import respx

from server.registry.resolve import ProviderEndpoint
from server.tests.voice_double import WorkerScenario, build_worker_double, wav_bytes
from server.voice.adapters import adapter_name_for
from server.voice.adapters.deepgram import DeepgramStt, DeepgramTts
from server.voice.adapters.elevenlabs import ElevenLabsStt, ElevenLabsTts
from server.voice.adapters.openai_compatible import OpenAiCompatibleStt, OpenAiCompatibleTts
from server.voice.base import LanguageUnsupported, SttRequest, TtsRequest, VoiceError, wav_duration_ms


def _ep(kind: str, name: str, base: str, key: str = "k", model: str | None = None, **extra) -> ProviderEndpoint:
    return ProviderEndpoint(kind=kind, name=name, base_url=base, model=model, api_key=key, source="registry", extra=extra)


async def _collect(stream) -> bytes:
    out = b""
    async for c in stream.chunks:
        out += c
    return out


# --------------------------------------------------------------------------- #
# adapter selection                                                           #
# --------------------------------------------------------------------------- #
def test_adapter_is_inferred_from_host_or_declared():
    assert adapter_name_for(_ep("tts", "el", "https://api.elevenlabs.io")) == "elevenlabs"
    assert adapter_name_for(_ep("stt", "dg", "https://api.deepgram.com")) == "deepgram"
    assert adapter_name_for(_ep("tts", "worker", "https://1-2-3-4.sslip.io/tts")) == "openai_compatible"
    assert adapter_name_for(_ep("tts", "x", "https://proxy.example", adapter="elevenlabs")) == "elevenlabs"
    assert adapter_name_for(_ep("tts", "x", "https://proxy.example", adapter="nonsense")) == "openai_compatible"


# --------------------------------------------------------------------------- #
# ElevenLabs                                                                  #
# --------------------------------------------------------------------------- #
@respx.mock
async def test_elevenlabs_tts_stream_request_shape():
    route = respx.post("https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM/stream").mock(
        return_value=httpx.Response(200, content=b"\xff\xfb\x90\x00" * 8, headers={"content-type": "audio/mpeg"}))
    ep = _ep("tts", "elevenlabs", "https://api.elevenlabs.io", key="xi-secret", model_id="eleven_flash_v2_5")
    async with httpx.AsyncClient() as client:
        stream = await ElevenLabsTts().synthesize(client, ep, TtsRequest(text="Merhaba doktor", lang="tr",
                                                                        voice_id="21m00Tcm4TlvDq8ikWAM"))
        audio = await _collect(stream)
    assert audio.startswith(b"\xff\xfb") and stream.content_type == "audio/mpeg" and stream.model == "eleven_flash_v2_5"
    req = route.calls.last.request
    assert req.headers["xi-api-key"] == "xi-secret"
    assert req.url.params["output_format"] == "mp3_44100_128"
    body = json.loads(req.content)
    assert body["text"] == "Merhaba doktor" and body["model_id"] == "eleven_flash_v2_5"
    assert body["language_code"] == "tr" and body["voice_settings"]["stability"] == 0.5


@respx.mock
async def test_elevenlabs_tts_rejects_unlisted_language_and_surfaces_http_errors():
    ep = _ep("tts", "elevenlabs", "https://api.elevenlabs.io", model_id="eleven_flash_v2_5")
    async with httpx.AsyncClient() as client:
        with pytest.raises(LanguageUnsupported):
            await ElevenLabsTts().synthesize(client, ep, TtsRequest(text="x", lang="xx", voice_id="v"))
        respx.post("https://api.elevenlabs.io/v1/text-to-speech/v/stream").mock(
            return_value=httpx.Response(401, json={"detail": {"status": "invalid_api_key"}}))
        with pytest.raises(VoiceError) as exc:
            await ElevenLabsTts().synthesize(client, ep, TtsRequest(text="x", lang="en", voice_id="v"))
        assert exc.value.status == 401


@respx.mock
async def test_elevenlabs_stt_multipart_and_response_parse():
    route = respx.post("https://api.elevenlabs.io/v1/speech-to-text").mock(return_value=httpx.Response(200, json={
        "language_code": "tur", "language_probability": 0.98, "text": "Nefes almakta zorlanıyorum.",
        "words": [{"text": "Nefes", "start": 0.0, "end": 0.4, "type": "word"},
                  {"text": "zorlanıyorum.", "start": 1.1, "end": 2.0, "type": "word"}]}))
    ep = _ep("stt", "elevenlabs", "https://api.elevenlabs.io", key="xi-secret")
    async with httpx.AsyncClient() as client:
        res = await ElevenLabsStt().transcribe(client, ep, SttRequest(audio=b"RIFFdata", content_type="audio/webm",
                                                                      filename="d.webm", lang="tr"))
    assert res.text == "Nefes almakta zorlanıyorum." and res.language == "tu"[:2] or res.language == "tu"
    assert res.confidence == pytest.approx(0.98) and res.audio_seconds == pytest.approx(2.0)
    assert res.model == "scribe_v2"
    req = route.calls.last.request
    assert req.headers["xi-api-key"] == "xi-secret"
    ctype = req.headers["content-type"]
    assert ctype.startswith("multipart/form-data")
    raw = req.content
    assert b'name="model_id"' in raw and b"scribe_v2" in raw
    assert b'name="language_code"' in raw and b'name="file"; filename="d.webm"' in raw


# --------------------------------------------------------------------------- #
# Deepgram                                                                    #
# --------------------------------------------------------------------------- #
@respx.mock
async def test_deepgram_stt_prerecorded_request_and_parse():
    route = respx.post("https://api.deepgram.com/v1/listen").mock(return_value=httpx.Response(200, json={
        "metadata": {"request_id": "r1", "duration": 4.5, "models": ["m"]},
        "results": {"channels": [{"alternatives": [{"transcript": "başım dönüyor", "confidence": 0.91,
                                                     "words": []}]}]}}))
    ep = _ep("stt", "deepgram", "https://api.deepgram.com", key="dg-secret", keyterms=["labetalol"])
    async with httpx.AsyncClient() as client:
        res = await DeepgramStt().transcribe(client, ep, SttRequest(audio=b"\x1aE\xdf\xa3webm", content_type="audio/webm",
                                                                    lang="tr"))
    assert res.text == "başım dönüyor" and res.confidence == pytest.approx(0.91) and res.language == "tr"
    assert res.audio_seconds == pytest.approx(4.5) and res.model == "nova-3"
    req = route.calls.last.request
    assert req.headers["authorization"] == "Token dg-secret"
    assert req.headers["content-type"] == "audio/webm" and req.content == b"\x1aE\xdf\xa3webm"
    assert req.url.params["model"] == "nova-3" and req.url.params["language"] == "tr"
    assert req.url.params["smart_format"] == "true" and req.url.params["keyterm"] == "labetalol"


@respx.mock
async def test_deepgram_stt_detects_language_when_no_hint():
    route = respx.post("https://api.deepgram.com/v1/listen").mock(return_value=httpx.Response(200, json={
        "metadata": {"duration": 1.0},
        "results": {"channels": [{"detected_language": "en", "alternatives": [{"transcript": "hi", "confidence": 0.5}]}]}}))
    async with httpx.AsyncClient() as client:
        res = await DeepgramStt().transcribe(client, _ep("stt", "dg", "https://api.deepgram.com"),
                                             SttRequest(audio=b"x", content_type="audio/wav"))
    assert res.language == "en" and route.calls.last.request.url.params["detect_language"] == "true"


@respx.mock
async def test_deepgram_aura_tts_english_shape_and_turkish_refusal():
    route = respx.post("https://api.deepgram.com/v1/speak").mock(
        return_value=httpx.Response(200, content=b"\xff\xfb" * 4, headers={"content-type": "audio/mpeg"}))
    ep = _ep("tts", "deepgram", "https://api.deepgram.com", key="dg")
    async with httpx.AsyncClient() as client:
        stream = await DeepgramTts().synthesize(client, ep, TtsRequest(text="I feel dizzy", lang="en",
                                                                       voice_id="aura-2-apollo-en"))
        await _collect(stream)
        with pytest.raises(LanguageUnsupported):
            await DeepgramTts().synthesize(client, ep, TtsRequest(text="x", lang="tr", voice_id="aura-2-apollo-en"))
    req = route.calls.last.request
    assert req.url.params["model"] == "aura-2-apollo-en" and req.url.params["encoding"] == "mp3"
    assert json.loads(req.content) == {"text": "I feel dizzy"} and req.headers["authorization"] == "Token dg"


# --------------------------------------------------------------------------- #
# OpenAI-compatible (GPU worker double)                                       #
# --------------------------------------------------------------------------- #
def test_wav_duration_from_header():
    assert wav_duration_ms(wav_bytes(0.5)[:44]) == 500
    assert wav_duration_ms(b"ID3" + b"\x00" * 60) is None
    streaming_header = wav_bytes(0.5)[:40] + b"\xff\xff\xff\xff"
    assert wav_duration_ms(streaming_header) is None


async def test_openai_compatible_tts_against_worker_double():
    sc = WorkerScenario()
    transport = httpx.ASGITransport(app=build_worker_double(sc))
    ep = ProviderEndpoint(kind="tts", name="gpu-worker", base_url="http://worker.test/tts", model="chatterbox-multilingual",
                          api_key="worker-token-123", source="gpu_worker", extra={"tts_body": {"exaggeration": 0.6}})
    async with httpx.AsyncClient(transport=transport) as client:
        stream = await OpenAiCompatibleTts().synthesize(client, ep, TtsRequest(text="Nefes alamıyorum", lang="tr",
                                                                               voice_id="acudx_tr_female",
                                                                               output_format="wav"))
        audio = await _collect(stream)
    assert stream.content_type == "audio/wav" and stream.duration_ms == 500 and audio == wav_bytes(0.5)
    assert sc.tts_calls == [{"model": "chatterbox-multilingual", "input": "Nefes alamıyorum", "voice": "acudx_tr_female",
                             "response_format": "wav", "exaggeration": 0.6}]


async def test_openai_compatible_tts_rejects_bad_token():
    sc = WorkerScenario()
    ep = ProviderEndpoint(kind="tts", name="gpu-worker", base_url="http://worker.test/tts", model="m", api_key="wrong",
                          source="gpu_worker")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=build_worker_double(sc))) as client:
        with pytest.raises(VoiceError) as exc:
            await OpenAiCompatibleTts().synthesize(client, ep, TtsRequest(text="x", lang="en", voice_id="v"))
    assert exc.value.status == 401


async def test_openai_compatible_stt_verbose_json_against_worker_double():
    sc = WorkerScenario()
    ep = ProviderEndpoint(kind="stt", name="gpu-worker", base_url="http://worker.test/stt",
                          model="deepdml/faster-whisper-large-v3-turbo-ct2", api_key="worker-token-123", source="gpu_worker")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=build_worker_double(sc))) as client:
        res = await OpenAiCompatibleStt().transcribe(client, ep, SttRequest(audio=b"\x1aE\xdf\xa3", content_type="audio/webm",
                                                                            filename="dictation.webm", lang="tr"))
    assert res.text == sc.transcript and res.language == "tr" and res.audio_seconds == pytest.approx(3.2)
    assert res.confidence == pytest.approx(0.9, abs=0.01)   # exp(-0.1054)
    assert sc.stt_calls == [{"model": "deepdml/faster-whisper-large-v3-turbo-ct2", "language": "tr",
                             "response_format": "verbose_json", "filename": "dictation.webm", "content_type": "audio/webm",
                             "size": 4}]
