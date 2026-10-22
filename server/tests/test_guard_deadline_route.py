"""The interview route with the guard's deadline (docs/architecture/18 6.3.12).

Live 2026-10-22 the classifier model sometimes took 3 to 8 s and the patient's voice waited for it. Now a
confident clinical rules label releases the speculative reply into the call at the deadline; the model's
late label is recorded, and a safety label stops the reply (TTS and the runner's queued audio) and the
patient answers again on that label.
"""

from __future__ import annotations

import json

import httpx
import pytest

from server import app as app_module
from server.interview import guard as Gd
from server.interview.patient import _DIRECTIVE
from server.model_gateway import ModelGateway
from server.providers.anthropic_provider import AnthropicProvider
from server.scope_guard import crisis_resources
from server.tests.anthropic_double import AnthropicDouble, Scripted
from server.tests.test_voiced_interview import ME, REPLY_TR, _lines, _start, _wait, voiced  # noqa: F401
from server.voice.avatar import musetalk as mt

QUESTION = "Ağrınız ne zaman başladı?"


def slow_guard(calls: list[str], *, label: str, reason: str, guard_s: float, persona_s: float = 0.0,
               reply: str = REPLY_TR):
    def respond(body: dict) -> Scripted:
        system = "".join(b.get("text", "") for b in body.get("system") or [])
        if "You label one message" in system:
            calls.append("guard")
            return Scripted(text=json.dumps({"label": label, "reason": reason, "language": "tr", "intent": "onset"}),
                            model="claude-haiku-5-5", delay_s=guard_s)
        directive = next((k for k, v in _DIRECTIVE.items() if v in json.dumps(body, ensure_ascii=False)), "?")
        calls.append(f"persona:{directive}")
        return Scripted(text=reply, delay_s=persona_s)
    return respond


async def _swap(state, calls, **kw):
    dbl = AnthropicDouble(responder=slow_guard(calls, **kw))
    gw = ModelGateway(state.settings, anthropic=AnthropicProvider(state.settings, http_client=dbl.client(), max_retries=0))
    await gw.start()
    await state.gateway.aclose()
    state.gateway = gw
    return gw, dbl


@pytest.fixture
def interrupts(monkeypatch):
    seen: list[str] = []

    async def interrupt(client, worker, worker_session):
        seen.append(worker_session)

    monkeypatch.setattr(mt, "interrupt", interrupt)
    monkeypatch.setattr(Gd, "GUARD_DEADLINE_S", 0.1)
    return seen


async def _ask(tid, call, message=QUESTION, *, with_call=True):
    transport = httpx.ASGITransport(app=app_module.app)
    payload = {"message": message, "locale": "tr"}
    if with_call:
        payload["call_session_id"] = call.id
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        return await c.post(f"/v2/case/{tid}/interview", headers=ME, json=payload)


async def test_a_slow_guard_no_longer_delays_the_patients_voice(voiced, runtime, interrupts):
    state, scenario, sockets = voiced
    calls: list[str] = []
    gw, tid, call, _ = await _start(state, runtime, calls, REPLY_TR)
    gw, _ = await _swap(state, calls, label="clinical", reason="in_scope", guard_s=1.0)
    r = await _ask(tid, call)
    assert r.status_code == 200, r.text
    body = r.json()
    g = body["meta"]["guard"]
    assert g["released"] == "deadline" and g["late_label"] == "clinical" and g["stopped"] is False
    assert body["meta"]["speculative"] == "kept" and body["guard"]["label"] == "clinical"
    # The model's decision is the record (its history intent), the reply is the one released at the deadline.
    assert body["intent"] == "onset" and body["meta"]["guard_source"] == "rules+model"
    assert await _wait(lambda: any(t["spoken_text"] for t in call.metrics.get("voiced_turns") or []))
    turn = next(t for t in call.metrics["voiced_turns"] if t["spoken_text"])
    t = turn["timings"]
    # Spoken from the deadline on, long before the model's label at about 1 s.
    assert t["guard_ms"] < 600 and t["released_ms"] < 900 and t["runner_first_chunk_ms"] < 950
    assert body["meta"]["timings"]["guard_late_ms"] >= 950
    assert interrupts == [] and len(_lines(sockets[0].sent)) == 1
    await gw.aclose()


async def test_a_late_safety_label_stops_the_reply_and_answers_again(voiced, runtime, interrupts):
    state, scenario, sockets = voiced
    calls: list[str] = []
    gw, tid, call, _ = await _start(state, runtime, calls, REPLY_TR)
    # The model labels it while the reply is still being written (persona 0.6 s, guard 0.3 s).
    gw, _ = await _swap(state, calls, label="meta_injection", reason="role_break", guard_s=0.3, persona_s=0.6,
                        reply="Ne demek istediğinizi anlamadım doktor bey.")
    r = await _ask(tid, call)
    assert r.status_code == 200, r.text
    body = r.json()
    g = body["meta"]["guard"]
    assert g["released"] == "deadline" and g["late_label"] == "meta_injection" and g["stopped"] is True
    assert body["guard"]["label"] == "meta_injection"
    # Answered again under the injection directive after the stop.
    assert calls.count("persona:clinical") >= 1 and calls[-1] == "persona:meta_injection"
    assert await _wait(lambda: any(t.get("stopped") for t in call.metrics.get("voiced_turns") or []))
    stopped = next(t for t in call.metrics["voiced_turns"] if t.get("stopped"))
    assert stopped["stopped"] == "guard_meta_injection"
    assert interrupts == [call.worker_session]
    await gw.aclose()


async def test_a_late_self_harm_label_after_the_reply_gives_the_crisis_resources(voiced, runtime, interrupts):
    state, scenario, sockets = voiced
    calls: list[str] = []
    gw, tid, call, _ = await _start(state, runtime, calls, REPLY_TR)
    gw, _ = await _swap(state, calls, label="unsafe", reason="self_harm_disclosure", guard_s=0.5)
    r = await _ask(tid, call)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["reply"] == crisis_resources("tr") and body["meta"]["source"] == "safety"
    assert body["meta"]["guard"]["stopped"] is True and body["guard"]["label"] == "unsafe"
    assert any(f["type"] == "safety_trigger" for f in body["flags"])
    # The reply had been written (and its short audio sent) before the label: the runner's queue is flushed.
    assert interrupts == [call.worker_session]
    await gw.aclose()


async def test_a_risky_message_still_waits_for_the_model(voiced, runtime, interrupts):
    state, scenario, sockets = voiced
    calls: list[str] = []
    gw, tid, call, _ = await _start(state, runtime, calls, REPLY_TR)
    gw, _ = await _swap(state, calls, label="clinical", reason="in_scope", guard_s=0.4)
    r = await _ask(tid, call, "Kendinize zarar vermeyi düşündüğünüz oldu mu?")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["meta"]["guard"]["released"] == "decided" and body["meta"]["guard"]["waited_ms"] >= 380
    assert "late_label" not in body["meta"]["guard"]
    await gw.aclose()


async def test_a_typed_question_uses_the_deadline_too_and_reports_the_models_label(voiced, runtime, interrupts):
    state, scenario, sockets = voiced
    calls: list[str] = []
    gw, tid, call, _ = await _start(state, runtime, calls, REPLY_TR)
    gw, _ = await _swap(state, calls, label="off_topic", reason="small_talk", guard_s=0.4)
    r = await _ask(tid, call, with_call=False)
    assert r.status_code == 200, r.text
    body = r.json()
    g = body["meta"]["guard"]
    # A late non-safety label does not stop a reply; it is recorded.
    assert g["released"] == "deadline" and g["late_label"] == "off_topic" and g["stopped"] is False
    assert body["guard"]["label"] == "clinical"
    await gw.aclose()
