"""VoiceService: registry order, language skipping, AIRGAPPED refusal, GPU worker fallback, telemetry rows."""

from __future__ import annotations

import httpx
import pytest
import respx
from cryptography.fernet import Fernet

from server.config import Settings
from server.providers.gpu_worker import AirgappedRefused, NotConfigured
from server.registry.resolve import RegistryResolver
from server.registry.store import ProviderIn, RegistryStore
from server.telemetry.events import TelemetryRecorder
from server.tests.voice_double import WORKER_TOKEN, HostRouter, WorkerScenario, build_worker_double, wav_bytes
from server.voice.service import NoVoiceProvider, VoiceService

KEY = Fernet.generate_key().decode()


def _settings(**over) -> Settings:
    base = dict(_env_file=None, airgapped=False, admin_token="adm", acudx_db_path=":memory:")
    base.update(over)
    return Settings(**base)


class FakeWorkerManager:
    """Test double for the GPU worker manager (fixtures live under tests/ only)."""

    def __init__(self, *, ready: bool = True, refuse: Exception | None = None, can_launch: bool = True):
        self._ready = ready
        self._refuse = refuse
        self._can_launch = can_launch
        self.ensure_calls = 0
        self.touches = 0

    async def ensure_worker(self):
        self.ensure_calls += 1
        if self._refuse:
            raise self._refuse
        self._ready = True
        return object()

    def llm_endpoint(self):
        if not self._ready:
            return None
        return {"base_url": "http://worker.test/v1", "api_key": WORKER_TOKEN, "model": "acudx-llm"}

    def touch(self):
        self.touches += 1

    async def status(self):
        refusal = None if self._refuse is None else {"reason": self._refuse.reason, "message": str(self._refuse)}
        return {"configured": True, "can_launch": self._can_launch and self._refuse is None, "refusal": refusal,
                "worker": None}


def _build(tmp_path, *, settings: Settings, worker: FakeWorkerManager | None, scenario: WorkerScenario | None = None,
           respx_router: respx.MockRouter | None = None):
    store = RegistryStore(str(tmp_path / "acudx.db"), secret_key=KEY)
    telemetry = TelemetryRecorder(str(tmp_path / "acudx.db"))
    resolver = RegistryResolver(store, settings, worker_manager=worker)
    fallback = respx_router.handler if respx_router is not None else None  # type: ignore[union-attr]
    asgi = {"worker.test": build_worker_double(scenario)} if scenario is not None else {}
    transport = HostRouter(asgi, fallback=httpx.MockTransport(fallback) if fallback else None)
    client = httpx.AsyncClient(transport=transport)
    return store, telemetry, VoiceService(settings, resolver, telemetry=telemetry, client=client)


async def _collect(stream) -> bytes:
    out = b""
    async for c in stream.chunks:
        out += c
    return out


async def test_hosted_tts_in_priority_order_with_telemetry_and_cost(tmp_path):
    router = respx.MockRouter(assert_all_called=False)
    el = router.post("https://api.elevenlabs.io/v1/text-to-speech/ThT5KcBeYPX3keUQqHPh/stream").mock(
        return_value=httpx.Response(200, content=b"\xff\xfb" * 10, headers={"content-type": "audio/mpeg"}))
    store, telemetry, svc = _build(tmp_path, settings=_settings(), worker=None, respx_router=router)
    store.create_provider(ProviderIn(kind="tts", name="elevenlabs-eu", base_url="https://api.elevenlabs.io", priority=1,
                                     api_key="xi", extra={"model_id": "eleven_flash_v2_5"}))
    store.create_provider(ProviderIn(kind="tts", name="deepgram-aura", base_url="https://api.deepgram.com", priority=5,
                                     api_key="dg"))
    out = await svc.tts("Göğsümde ağrı var.", lang="tr", sex="female", age=68)
    audio = await _collect(out.stream)
    assert audio == b"\xff\xfb" * 10 and out.endpoint.name == "elevenlabs-eu" and out.adapter == "elevenlabs"
    assert out.voice_id == "ThT5KcBeYPX3keUQqHPh" and el.called
    rows = telemetry.recent()
    assert len(rows) == 1 and rows[0]["kind"] == "tts" and rows[0]["provider"] == "elevenlabs-eu"
    assert rows[0]["model"] == "eleven_flash_v2_5" and rows[0]["tokens_in"] == len("Göğsümde ağrı var.")
    assert rows[0]["cost_usd"] == pytest.approx(len("Göğsümde ağrı var.") / 1000 * 0.04) and rows[0]["ok"] == 1


async def test_tts_skips_providers_that_cannot_speak_the_language_then_fails_over(tmp_path):
    router = respx.MockRouter(assert_all_called=False)
    el_fail = router.post("https://api.elevenlabs.io/v1/text-to-speech/pNInz6obpgDQGcFmaJgB/stream").mock(
        return_value=httpx.Response(500, text="upstream down"))
    router.post("https://api.deepgram.com/v1/speak").mock(
        return_value=httpx.Response(200, content=b"mp3", headers={"content-type": "audio/mpeg"}))
    store, telemetry, svc = _build(tmp_path, settings=_settings(), worker=None, respx_router=router)
    store.create_provider(ProviderIn(kind="tts", name="aura", base_url="https://api.deepgram.com", priority=0, api_key="dg"))
    store.create_provider(ProviderIn(kind="tts", name="eleven", base_url="https://api.elevenlabs.io", priority=1, api_key="xi"))
    # Turkish: Aura cannot speak it (skipped without a call), ElevenLabs fails -> no provider.
    with pytest.raises(NoVoiceProvider) as exc:
        await svc.tts("Merhaba", lang="tr", sex="male", age=60)
    assert any("aura" in r and "tr" in r for r in exc.value.reasons) and el_fail.called
    rows = telemetry.recent()
    assert len(rows) == 1 and rows[0]["ok"] == 0 and rows[0]["error"] == "VoiceError" and rows[0]["provider"] == "eleven"
    # English: Aura serves first (priority 0).
    out = await svc.tts("Hello", lang="en", sex="male", age=60)
    assert out.endpoint.name == "aura" and out.voice_id == "aura-2-zeus-en" and (await _collect(out.stream)) == b"mp3"


async def test_airgapped_refuses_hosted_rows_and_cloud_worker(tmp_path):
    worker = FakeWorkerManager(ready=False, refuse=AirgappedRefused("AIRGAPPED=true"))
    store, telemetry, svc = _build(tmp_path, settings=_settings(airgapped=True), worker=worker)
    store.create_provider(ProviderIn(kind="tts", name="eleven", base_url="https://api.elevenlabs.io", priority=1, api_key="xi"))
    store.create_provider(ProviderIn(kind="stt", name="deepgram", base_url="https://api.deepgram.com", priority=1, api_key="dg"))
    with pytest.raises(NoVoiceProvider) as exc:
        await svc.tts("Merhaba", lang="tr", sex="female", age=30)
    assert exc.value.airgapped is True
    assert any("eleven" in r and "AIRGAPPED" in r for r in exc.value.reasons)
    assert any("gpu-worker: airgapped" in r for r in exc.value.reasons)
    with pytest.raises(NoVoiceProvider):
        await svc.stt(b"audio", content_type="audio/webm", lang="tr")
    assert telemetry.recent() == [] and worker.ensure_calls == 2
    caps = await svc.capabilities(probe_worker=True)
    assert caps["tts"]["enabled"] is False and caps["stt"]["enabled"] is False and caps["airgapped"] is True


async def test_airgapped_allows_a_local_openai_compatible_row(tmp_path):
    sc = WorkerScenario()
    store, telemetry, svc = _build(tmp_path, settings=_settings(airgapped=True, local_allowlist=["worker.test"]),
                                   worker=None, scenario=sc)
    store.create_provider(ProviderIn(kind="tts", name="onprem-chatterbox", base_url="http://worker.test/tts", priority=0,
                                     api_key=WORKER_TOKEN, model="chatterbox-multilingual",
                                     extra={"voice_family": "chatterbox"}))
    out = await svc.tts("Nefes alamıyorum", lang="tr", sex="female", age=40, output_format="wav")
    assert out.endpoint.source == "registry" and (await _collect(out.stream)) == wav_bytes(0.5)
    assert sc.tts_calls[0]["voice"] == "acudx_tr_female" and out.stream.duration_ms == 500


async def test_gpu_worker_fallback_serves_tts_and_stt_with_zero_cost_rows(tmp_path):
    sc = WorkerScenario()
    worker = FakeWorkerManager(ready=False)
    store, telemetry, svc = _build(tmp_path, settings=_settings(), worker=worker, scenario=sc)
    out = await svc.tts("Göğsümde baskı var", lang="tr", sex="male", age=45, output_format="wav")
    assert out.endpoint.source == "gpu_worker" and out.endpoint.base_url == "http://worker.test/tts"
    assert out.adapter == "openai_compatible" and out.voice_id == "acudx_tr_male" and out.stream.duration_ms == 500
    assert (await _collect(out.stream)) == wav_bytes(0.5)
    res = await svc.stt(b"\x1aE\xdf\xa3", content_type="audio/webm", filename="d.webm", lang="tr")
    assert res.endpoint.base_url == "http://worker.test/stt" and res.result.text == sc.transcript
    assert res.result.language == "tr" and res.result.confidence == pytest.approx(0.9, abs=0.01)
    rows = telemetry.recent()
    assert {r["kind"] for r in rows} == {"tts", "stt"} and all(r["cost_usd"] == 0.0 for r in rows)
    assert all(r["provider"] == "gpu-worker" for r in rows)
    stt_row = next(r for r in rows if r["kind"] == "stt")
    assert stt_row["tokens_in"] == 3 and stt_row["model"] == "deepdml/faster-whisper-large-v3-turbo-ct2"
    assert worker.ensure_calls == 2 and worker.touches == 2


async def test_registry_provider_serves_without_launching_the_gpu_worker(tmp_path):
    """Review 04: the worker is a fallback, not a sibling candidate. A hosted row that serves
    the request must never trigger ensure_worker (which launches paid capacity and can block
    the request for the whole boot)."""
    router = respx.MockRouter(assert_all_called=False)
    router.post("https://api.elevenlabs.io/v1/text-to-speech/ThT5KcBeYPX3keUQqHPh/stream").mock(
        return_value=httpx.Response(200, content=b"\xff\xfb" * 4, headers={"content-type": "audio/mpeg"}))
    worker = FakeWorkerManager(ready=False)
    store, telemetry, svc = _build(tmp_path, settings=_settings(), worker=worker, respx_router=router)
    store.create_provider(ProviderIn(kind="tts", name="elevenlabs-eu", base_url="https://api.elevenlabs.io",
                                     api_key="xi", extra={"model_id": "eleven_flash_v2_5"}))
    out = await svc.tts("Göğsümde ağrı var.", lang="tr", sex="female", age=68)
    assert out.endpoint.name == "elevenlabs-eu" and (await _collect(out.stream)) == b"\xff\xfb" * 4
    assert worker.ensure_calls == 0, "a serving registry row must not launch the GPU worker"


async def test_gpu_worker_is_asked_only_after_every_registry_row_failed(tmp_path):
    router = respx.MockRouter(assert_all_called=False)
    router.post("https://api.elevenlabs.io/v1/text-to-speech/ThT5KcBeYPX3keUQqHPh/stream").mock(
        return_value=httpx.Response(500, text="upstream down"))
    sc = WorkerScenario()
    worker = FakeWorkerManager(ready=False)
    store, telemetry, svc = _build(tmp_path, settings=_settings(), worker=worker, scenario=sc, respx_router=router)
    store.create_provider(ProviderIn(kind="tts", name="elevenlabs-eu", base_url="https://api.elevenlabs.io",
                                     api_key="xi"))
    out = await svc.tts("Göğsümde ağrı var.", lang="tr", sex="female", age=68, output_format="wav")
    assert out.endpoint.source == "gpu_worker" and worker.ensure_calls == 1
    rows = telemetry.recent()
    assert [r["ok"] for r in rows] == [0] and rows[0]["provider"] == "elevenlabs-eu"


async def test_worker_not_configured_is_reported_not_raised(tmp_path):
    worker = FakeWorkerManager(ready=False, refuse=NotConfigured("LAMBDA_KEY is not set"), can_launch=False)
    store, telemetry, svc = _build(tmp_path, settings=_settings(), worker=worker)
    with pytest.raises(NoVoiceProvider) as exc:
        await svc.stt(b"x", content_type="audio/webm")
    assert exc.value.reasons == ["gpu-worker: not_configured"]
    caps = await svc.capabilities(probe_worker=True)
    assert caps["stt"]["enabled"] is False and "gpu-worker: not_configured" in caps["stt"]["reasons"]


async def test_capabilities_describe_hosted_rows_pending_worker_and_avatar(tmp_path):
    worker = FakeWorkerManager(ready=False)
    store, telemetry, svc = _build(tmp_path, settings=_settings(), worker=worker)
    store.create_provider(ProviderIn(kind="tts", name="eleven", base_url="https://api.elevenlabs.io", priority=1, api_key="xi",
                                     extra={"model_id": "eleven_v4_turbo", "languages": ["en", "tr", "ar"]}))
    store.create_provider(ProviderIn(kind="avatar", name="lk", base_url="https://lk.example", priority=1, api_key="secret",
                                     extra={"transport": "livekit", "livekit_api_key": "APIxyz", "avatar": "simli",
                                            "default": True}))
    caps = await svc.capabilities(probe_worker=True)
    assert caps["tts"] == {"enabled": True, "provider": "eleven", "source": "registry", "adapter": "elevenlabs",
                           "model": "eleven_v4_turbo", "languages": ["en", "tr", "ar"], "reasons": []}
    assert caps["stt"]["enabled"] is True and caps["stt"]["pending_launch"] is True and "tr" in caps["stt"]["languages"]
    assert caps["avatar"] == {"enabled": True, "provider": "lk", "transport": "livekit", "renderer": "simli",
                              "source": "registry", "live_video": True, "reasons": []}
    assert worker.ensure_calls == 0   # capabilities never launch a worker


async def test_capabilities_probe_the_worker_tts_route_not_just_healthz(tmp_path):
    """Task 24: /healthz is vLLM only and Chatterbox builds after vLLM is up, so a ready worker
    must not advertise TTS until the side-car itself answers /tts/health."""
    sc = WorkerScenario(tts_health_status=503)
    worker = FakeWorkerManager(ready=True)
    store, telemetry, svc = _build(tmp_path, settings=_settings(), worker=worker, scenario=sc)
    caps = await svc.capabilities(probe_worker=True)
    assert caps["tts"]["enabled"] is False and "gpu-worker: /tts/health HTTP 503" in caps["tts"]["reasons"]
    assert caps["gpu_worker"]["tts"] == {"path": "/tts/health", "ok": False, "detail": "HTTP 503"}
    assert caps["stt"]["enabled"] is True and caps["stt"]["source"] == "gpu_worker"
    sc.tts_health_status = 200
    caps = await svc.capabilities(probe_worker=True)
    assert caps["tts"]["enabled"] is True and caps["tts"]["provider"] == "gpu-worker"
    assert caps["gpu_worker"]["tts"]["ok"] is True
    assert worker.ensure_calls == 0


async def test_streamed_worker_tts_uses_the_chatterbox_stream_route(tmp_path):
    """The live call forwards audio while it is generated: the worker's Chatterbox answers /speech only
    after the whole line, /speech/stream right after the first sentence."""
    sc = WorkerScenario()
    store, telemetry, svc = _build(tmp_path, settings=_settings(), worker=FakeWorkerManager(ready=True), scenario=sc)
    out = await svc.tts("Göğsümde baskı var. Sabahtan beri.", lang="tr", sex="male", age=45, output_format="wav",
                        stream=True)
    audio = await _collect(out.stream)
    assert audio[:4] == b"RIFF" and len(audio) == 44 + 24000
    call = sc.tts_calls[-1]
    assert call["_route"] == "stream" and call["voice"] == "acudx_tr_male"
    assert call["streaming_chunk_size"] == 60 and call["streaming_strategy"] == "sentence"
    plain = await svc.tts("Merhaba", lang="tr", sex="male", age=45, output_format="wav")
    await _collect(plain.stream)
    assert "_route" not in sc.tts_calls[-1]


async def test_a_row_declaring_its_languages_is_skipped_for_others(tmp_path):
    """A Kokoro row (English voices) declares ["en"]: a Turkish line goes on to the worker's Chatterbox."""
    sc = WorkerScenario()
    router = respx.MockRouter(assert_all_called=False)
    kokoro = router.post("https://kokoro.example/v1/audio/speech").mock(
        return_value=httpx.Response(200, content=b"RIFF", headers={"content-type": "audio/wav"}))
    store, telemetry, svc = _build(tmp_path, settings=_settings(), worker=FakeWorkerManager(ready=True), scenario=sc,
                                   respx_router=router)
    store.create_provider(ProviderIn(kind="tts", name="worker-kokoro", base_url="https://kokoro.example", priority=0,
                                     extra={"languages": ["en"], "voice_family": "kokoro"}))
    tr = await svc.tts("Nefes alamıyorum.", lang="tr", sex="female", age=70, output_format="wav")
    assert tr.endpoint.source == "gpu_worker" and not kokoro.called
    en = await svc.tts("I cannot breathe.", lang="en", sex="female", age=70, output_format="wav")
    assert en.endpoint.name == "worker-kokoro" and kokoro.called
