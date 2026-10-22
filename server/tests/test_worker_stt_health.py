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


async def test_worker_dictation_carries_a_clinical_prompt_in_the_spoken_language(tmp_path):
    """Live 2026-10-22 on the synthetic Turkish clips the worker's Whisper scored 45 % WER without a prompt and
    29 % with a short clinical one (docs/media/live-avatar/stt-guard/); English stayed at 0 either way."""
    from server.voice.adapters.openai_compatible import DEFAULT_STT_PROMPTS

    sc = WorkerScenario()
    store, telemetry, svc = _build(tmp_path, settings=_settings(), worker=FakeWorkerManager(ready=True), scenario=sc)
    await svc.stt(b"\x1aE\xdf\xa3", content_type="audio/webm", lang="tr")
    assert sc.stt_calls[-1]["language"] == "tr" and sc.stt_calls[-1]["prompt"] == DEFAULT_STT_PROMPTS["tr"]
    await svc.stt(b"\x1aE\xdf\xa3", content_type="audio/webm", lang="en")
    assert sc.stt_calls[-1]["prompt"] == DEFAULT_STT_PROMPTS["en"]
    await svc.stt(b"\x1aE\xdf\xa3", content_type="audio/webm")
    assert sc.stt_calls[-1]["prompt"] is None          # no language, no prompt (it would bias detection)


def test_a_row_can_set_or_switch_off_the_prompt():
    from server.registry.resolve import ProviderEndpoint
    from server.voice.adapters.openai_compatible import DEFAULT_STT_PROMPTS, OpenAiCompatibleStt

    def ep(extra, source="registry"):
        return ProviderEndpoint(kind="stt", name="x", base_url="https://stt.example", model="m", api_key="",
                                source=source, extra=extra)

    assert OpenAiCompatibleStt.prompt_for(ep({}), "tr") is None                       # hosted rows: off by default
    assert OpenAiCompatibleStt.prompt_for(ep({}, "gpu_worker"), "tr") == DEFAULT_STT_PROMPTS["tr"]
    assert OpenAiCompatibleStt.prompt_for(ep({"stt_prompt": False}, "gpu_worker"), "tr") is None
    assert OpenAiCompatibleStt.prompt_for(ep({"stt_prompt": "Kardiyoloji"}), "tr") == "Kardiyoloji"
    assert OpenAiCompatibleStt.prompt_for(ep({"stt_prompt": {"en": "Cardiology"}}), "en") == "Cardiology"
    assert OpenAiCompatibleStt.prompt_for(ep({"stt_prompt": {"en": "Cardiology"}}), "tr") is None
