"""History layers written ahead and the Turkish allergy gate (docs/architecture/18 6.3.11).

Live 2026-10-22: a Turkish case's history.background was rejected on every attempt because its allergy line
said "penisilin", so every question about medicines waited 21 to 23 s for a layer that never came; and a
question right after the call opened waited for presenting, then background, one after the other."""

from __future__ import annotations

import asyncio

import httpx
import pytest

from server.orchestration import staged as S
from server.orchestration.routes import OrchestrationRuntime
from server.tests.conftest import make_settings
from server.tests.openai_double import Scenario, build_double


def _state(allergies):
    return {"condition": {"id": "x", "label_en": "x"}, "kernel": {"allergies": allergies}}


def _bg(allergy_text: str) -> dict:
    return {"items": [{"intent": "allergies", "text": "Evet, penisiline alerjim var.", "red_flag": False}],
            "pmh": "Hipertansiyon", "meds": "Ramipril", "allergies": allergy_text}


@pytest.mark.parametrize("text", ["Penisilin alerjisi (döküntü)", "PENİSİLİN: kaşıntılı döküntü",
                                  "Penicillin (rash)", "amoksisilin ile döküntü", "Augmentin -> rash"])
def test_the_background_gate_accepts_the_allergy_in_either_language(text):
    data, _notes = S.gate_layer("history.background", _bg(text), _state([{"agent_class": "penicillin",
                                                                            "reaction": "rash"}]))
    assert data["allergies"] == text


def test_the_background_gate_still_rejects_a_missing_allergy():
    with pytest.raises(S.LayerRejected) as exc:
        S.gate_layer("history.background", _bg("Bilinen ilaç alerjisi yok"),
                     _state([{"agent_class": "penicillin", "reaction": "rash"}]))
    assert "penicillin" in exc.value.issues[0]


@pytest.mark.parametrize("cls,text", [("nsaid", "Aspirin ile nefes darlığı"), ("opioid", "Morfin: kaşıntı"),
                                      ("contrast", "İyotlu kontrast madde"), ("sulfonamide", "Sülfa ilaçlar"),
                                      ("cephalosporin", "Seftriakson sonrası ürtiker")])
def test_every_allergy_class_has_turkish_names(cls, text):
    assert S.names_allergy(text, cls)
    assert not S.names_allergy("Bilinen alerjisi yok", cls)


def test_history_layers_go_out_together_on_the_claude_route():
    names = ["history.presenting", "history.associated", "history.background", "exam.general", "exam.respiratory",
             "treatments", "results"]
    assert S.continuation_waves(names)[0] == ["history.presenting"]
    waves = S.continuation_waves(names, history_at_once=True)
    assert waves[0] == ["history.presenting", "history.associated", "history.background"]
    assert waves[1] == ["exam.general", "exam.respiratory"] and waves[2] == ["treatments", "results"]


async def _rt(sc: Scenario) -> OrchestrationRuntime:
    return await OrchestrationRuntime.create(make_settings(), transport=httpx.ASGITransport(app=build_double(sc)),
                                             in_memory=True)


async def test_a_layer_asked_for_before_the_kernel_waits_for_it():
    # The learner's first question can come while the kernel is still being written; its layer must be
    # written against the kernel, like the continuation's, not from the opening alone.
    sc = Scenario(author_delay_s=0.05)
    rt = await _rt(sc)
    try:
        tid = rt.staged.start({}, "th-early")
        for _ in range(400):
            st = rt.cases.get(tid) or {}
            if st.get("opening"):
                break
            await asyncio.sleep(0.01)
        assert (rt.cases.get(tid) or {}).get("kernel") is None
        entry = await rt.staged.ensure_layer(tid, "history.background", reason="interview")
        assert entry["status"] == "ready"
        calls = [c for c in sc.calls if c["role"] == "author.layer" and "LAYER: history.background" in c["user"]]
        assert calls and '"kernel":{' in calls[0]["system"] and '"kernel":{}' not in calls[0]["system"]
        await rt.staged.wait(tid)
    finally:
        await rt.aclose()


def test_a_calls_voice_is_resolved_on_the_calls_own_worker():
    # Live 2026-10-22: a call rendered on the two-card worker got its Turkish voice from another worker of the
    # pool (the least-loaded pick), so the voice lost the card of its own and paid a second worker's network.
    from server.registry.resolve import RegistryResolver

    class WM:
        def endpoint_by_origin(self, origin):
            if origin == "https://w2.test":
                return {"base_url": "https://w2.test/v1", "api_key": "t2", "model": "acudx-llm"}
            return None

        def llm_endpoint(self):
            return {"base_url": "https://w1.test/v1", "api_key": "t1", "model": "acudx-llm"}

    r = RegistryResolver.__new__(RegistryResolver)
    r.worker_manager = WM()
    ep = r.worker_at("tts", "https://w2.test")
    assert ep.base_url == "https://w2.test/tts" and ep.api_key == "t2" and ep.source == "gpu_worker"
    assert r.worker_at("tts", "https://gone.test") is None and r.worker_at("tts", None) is None


async def test_the_call_speaker_asks_for_the_voice_on_its_worker():
    from types import SimpleNamespace

    from server.voice.avatar.turn_speech import CallSpeaker, TurnTimings

    seen = {}

    class Svc:
        settings = SimpleNamespace(avatar_fast_en_tts=False)

        def tts(self, text, **kw):
            seen.update(kw)
            return "pending"

    sp = CallSpeaker(svc=Svc(), session=SimpleNamespace(worker_origin="https://w2.test"), worker=None, lang="tr",
                     sex="female", age=40, speed=1.0, gate=lambda t: t, timings=TurnTimings())
    assert sp._tts("Merhaba") == "pending" and seen["origin"] == "https://w2.test"
