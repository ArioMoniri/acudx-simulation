"""The worker's STT capability follows its speaches model, not only /healthz (docs/architecture/18 6.3.12).

Live 2026-10-22: every worker's speaches answered 404 "model not installed" (speaches 0.8 dropped
``PRELOAD_MODELS``, and its ``POST /v1/models`` download failed writing the root-owned shared cache), yet
``/v1/voice/capabilities`` advertised STT through the worker, so dictation failed only when used.
"""

from __future__ import annotations

from server.registry.resolve import WORKER_MODELS
from server.tests.test_voice_service import FakeWorkerManager, _build, _settings
from server.tests.voice_double import WorkerScenario
from server.voice import service as service_mod
from server.voice.service import NoVoiceProvider


async def test_capabilities_fail_worker_stt_when_the_model_is_not_installed(tmp_path):
    sc = WorkerScenario(stt_installed=False)
    store, telemetry, svc = _build(tmp_path, settings=_settings(), worker=FakeWorkerManager(ready=True), scenario=sc)
    caps = await svc.capabilities(probe_worker=True)
    assert caps["stt"]["enabled"] is False
    probe = caps["gpu_worker"]["stt"]
    assert probe["ok"] is False and probe["model"] == WORKER_MODELS["stt"]
    assert probe["detail"].startswith("model not installed")
    assert any(r.startswith("gpu-worker: stt model not installed") for r in caps["stt"]["reasons"])
    # The probe is a real transcription of a short silent clip with the served model.
    assert sc.stt_calls and sc.stt_calls[-1]["model"] == WORKER_MODELS["stt"]
    assert sc.stt_calls[-1]["content_type"] == "audio/wav"


async def test_worker_stt_probe_is_cached_and_recovers_once_the_model_lands(tmp_path, monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(service_mod.time, "monotonic", lambda: clock[0])
    sc = WorkerScenario(stt_installed=False)
    store, telemetry, svc = _build(tmp_path, settings=_settings(), worker=FakeWorkerManager(ready=True), scenario=sc)
    await svc.capabilities(probe_worker=True)
    await svc.capabilities(probe_worker=True)
    assert len(sc.stt_calls) == 1                       # cached within the TTL
    sc.stt_installed = True
    clock[0] += service_mod.WORKER_STT_PROBE_TTL_S + 1
    caps = await svc.capabilities(probe_worker=True)
    assert caps["stt"]["enabled"] is True and caps["stt"]["provider"] == "gpu-worker"
    assert caps["gpu_worker"]["stt"]["ok"] is True


async def test_a_failed_worker_transcription_flips_the_capability_at_once(tmp_path):
    sc = WorkerScenario()
    store, telemetry, svc = _build(tmp_path, settings=_settings(), worker=FakeWorkerManager(ready=True), scenario=sc)
    caps = await svc.capabilities(probe_worker=True)
    assert caps["stt"]["enabled"] is True
    sc.stt_installed = False
    try:
        await svc.stt(b"\x1aE\xdf\xa3", content_type="audio/webm", lang="tr")
    except NoVoiceProvider as exc:
        assert any("not installed" in r for r in exc.reasons)
    else:  # pragma: no cover
        raise AssertionError("expected NoVoiceProvider")
    caps = await svc.capabilities(probe_worker=True)
    assert caps["stt"]["enabled"] is False and caps["gpu_worker"]["stt"]["ok"] is False
