"""The patient's reply spoken into the live video call while it is written (docs/architecture/18 6.3.9).

Live 2026-10-21 (production): the typed question reached the patient's voice only after the guard, the
whole persona reply, the response to the browser, a second request (/speak) and the TTS ran one after
another. These tests pin the streamed path: the persona starts next to the guard, the first clause goes
to the TTS on its own while the model still writes, every spoken piece passes the reply's gates, nothing
is spoken before the guard, and the browser is told the call already speaks the line.
"""

from __future__ import annotations

import asyncio
import hashlib
import json

import httpx
import pytest

from server import app as app_module
from server.model_gateway import ModelGateway
from server.providers.anthropic_provider import AnthropicProvider
from server.registry.resolve import RegistryResolver
from server.registry.store import RegistryStore
from server.telemetry.events import TelemetryRecorder
from server.tests.anthropic_double import AnthropicDouble, Scripted
from server.tests.conftest import make_settings
from server.tests.test_voice_service import FakeWorkerManager
from server.tests.voice_double import HostRouter, WorkerScenario, build_worker_double
from server.voice.avatar import musetalk as mt
from server.voice.avatar.sessions import SessionStore
from server.voice.avatar.turn_speech import ClauseStream
from server.voice.service import VoiceService

ME = {"X-User-Id": "L-voice"}
ANT = "sk-ant-voiced-test"
KEY = "k" * 43 + "="
REPLY_TR = ("Dün öğleden sonra başladı doktor bey, başımın sağ tarafında. Işığa bakınca gözüm yanıyor ve "
            "midem bulanıyor. Tansiyonum 150/90 çıktı sanırım. Çok korkuyorum, kafam karışık.")


def test_clause_stream_sends_the_first_clause_alone_then_whole_sentences():
    cs = ClauseStream()
    assert cs.feed("Dün öğleden") == []
    # the opening clause is capped at 28 characters on a word boundary (long Turkish words cost TTS time)
    assert cs.feed("Dün öğleden sonra başladı doktor bey,") == ["Dün öğleden sonra başladı"]
    assert cs.feed("Dün öğleden sonra başladı doktor bey, başımın sağ") == []
    text = "Dün öğleden sonra başladı doktor bey, başımın sağ tarafında. Işığa bakınca"
    assert cs.feed(text) == ["doktor bey, başımın sağ tarafında."]
    assert ClauseStream().feed("Evet ağrım var, doktor.") == ["Evet ağrım var,", "doktor."]
    assert cs.finish(text + " gözüm yanıyor") == ["Işığa bakınca gözüm yanıyor"]
    # no punctuation early on: the first six words once a seventh arrives
    cs = ClauseStream()
    words = "bir iki üç dört beş altı yedi sekiz dokuz on onbir"
    assert cs.feed(words) == ["bir iki üç dört beş altı"]
    # a two-word opening with a comma is not a clause of its own
    assert ClauseStream().feed("Evet, doktor bey ağrı var.") == ["Evet, doktor bey ağrı var."]


def responder(calls: list[str], reply: str, *, label: str = "clinical", gate: asyncio.Event | None = None):
    def respond(body: dict) -> Scripted:
        system = "".join(b.get("text", "") for b in body.get("system") or [])
        if "You label one message" in system:
            calls.append("guard")
            return Scripted(text=json.dumps({"label": label, "reason": "in_scope" if label == "clinical" else "small_talk",
                                             "language": "tr", "intent": "none"}), model="claude-haiku-5-5")
        calls.append("persona:" + ("stream" if body.get("stream") else "plain"))
        return Scripted(text=reply)
    return respond


class RunnerSocket:
    """The runner's /avatar/stream as RunnerAudioLink sees it."""

    def __init__(self):
        self.sent: list = []
        self.close_code = None
        self._replies: list[str] = []

    async def send(self, msg):
        self.sent.append(msg)
        if isinstance(msg, str) and json.loads(msg).get("type") == "end":
            self._replies.append(json.dumps({"type": "done", "frames": 10, "first_frame_ms": 0.3, "elapsed_ms": 2.0}))

    async def recv(self):
        return self._replies.pop(0)

    async def close(self):
        self.close_code = 1000


@pytest.fixture
def voiced(tmp_path, monkeypatch, runtime):
    from server.auth.deps import AuthService
    from server.auth.store import UserRoleStore

    state = app_module.app.state
    saved = {k: getattr(state, k, None) for k in ("auth", "settings", "gateway", "orchestration", "voice",
                                                   "avatar_sessions")}
    db = str(tmp_path / "acudx.db")
    s = make_settings(airgapped=False, anthropic_key=ANT, acudx_db_path=db, acudx_secret_key=KEY)
    store = RegistryStore(db, secret_key=KEY)
    state.auth = AuthService(store, UserRoleStore(db), env_mode="local")
    state.settings = s
    scenario = WorkerScenario()
    client = httpx.AsyncClient(transport=HostRouter({"worker.test": build_worker_double(scenario)}))
    state.voice = VoiceService(s, RegistryResolver(store, s, worker_manager=FakeWorkerManager(ready=True)),
                               telemetry=TelemetryRecorder(db), client=client)
    state.avatar_sessions = SessionStore()
    state.orchestration = runtime
    sockets: list[RunnerSocket] = []

    async def connect(url, headers, timeout_s):
        ws = RunnerSocket()
        sockets.append(ws)
        return ws

    monkeypatch.setattr(mt, "ws_connect", connect)
    yield state, scenario, sockets
    for k, v in saved.items():
        setattr(state, k, v)


async def _start(state, runtime, calls, reply, **kw):
    dbl = AnthropicDouble(responder=responder(calls, reply, **kw))
    gw = ModelGateway(state.settings, anthropic=AnthropicProvider(state.settings, http_client=dbl.client(), max_retries=0))
    await gw.start()
    state.gateway = gw
    tid = runtime.staged.start({"system": "neurology", "locale": "tr", "learner_id": "L-voice"}, "th-voice")
    await runtime.staged.wait(tid)
    call = state.avatar_sessions.create(provider="musetalk", user_hash=hashlib.sha256(b"L-voice").hexdigest()[:16],
                                        encounter_id="enc-v", lang="tr", sex="female", age=34, photo_id="p02",
                                        case_state={}, persona=None, case_context=None, avatar_id="acudx-p02",
                                        worker_origin=None, thread_id=tid)
    call.worker_session = "lt-9"
    return gw, tid, call, dbl


def _lines(sent: list) -> list[dict]:
    out: list[dict] = []
    for m in sent:
        if isinstance(m, str) and json.loads(m).get("type") == "begin":
            out.append({"begin": json.loads(m), "bytes": 0})
        elif isinstance(m, bytes) and out:
            out[-1]["bytes"] += len(m)
    return out


async def _wait(cond, timeout=5.0):
    for _ in range(int(timeout / 0.02)):
        if cond():
            return True
        await asyncio.sleep(0.02)
    return False


async def test_a_voiced_turn_streams_the_reply_into_the_call_clause_by_clause(voiced, runtime):
    state, scenario, sockets = voiced
    calls: list[str] = []
    gw, tid, call, dbl = await _start(state, runtime, calls, REPLY_TR)
    transport = httpx.ASGITransport(app=app_module.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        r = await c.post(f"/v2/case/{tid}/interview", headers=ME, json={
            "message": "Şikayetiniz ne zaman başladı ve nerenizde hissediyorsunuz?", "locale": "tr",
            "call_session_id": call.id})
    assert r.status_code == 200, r.text
    body = r.json()
    # The text reply is unchanged in content and gates (the unsanctioned blood pressure is scrubbed).
    assert "150/90" not in body["reply"] and "kafam karışık" in body["reply"] and "Işığa" in body["reply"]
    assert body["meta"]["voice"] == {"spoken_by": "call", "session_id": call.id}
    # The persona was streamed, started next to the guard and kept (same prompt as after the guard).
    assert "persona:stream" in calls and body["meta"]["speculative"] == "kept"
    # The live-call persona model (Sonnet 5.5 by default: Opus 5.5 always thinks before its first word).
    persona = [b for b in dbl.calls if b.get("stream")]
    assert persona and persona[0]["model"] == state.settings.anthropic_model_persona_live == "claude-sonnet-5-5"
    t = body["meta"]["timings"]
    assert {"guard_ms", "persona_first_text_ms", "persona_done_ms"} <= set(t)
    assert await _wait(lambda: bool(call.metrics.get("voiced_turns")))
    turn = call.metrics["voiced_turns"][-1]
    assert turn["error"] is None, turn
    # First clause alone in the first TTS request, the rest in the next one(s); one runner utterance.
    tts = [x["input"] for x in scenario.tts_calls if x.get("_route") == "stream"]
    # Turkish: the opening clause is capped at 22 characters (Chatterbox waits for the whole clause).
    assert tts[0] == "Dün öğleden sonra" and len(tts) >= 2
    spoken = " ".join(tts)
    assert "150/90" not in spoken and "Işığa bakınca gözüm yanıyor" in spoken and "kafam karışık" in spoken
    lines = _lines(sockets[0].sent)
    assert len(lines) == 1 and lines[0]["begin"]["sessionid"] == "lt-9" and lines[0]["bytes"] > 0
    assert json.loads(sockets[0].sent[-1]) == {"type": "end"}
    assert {"first_clause_ms", "tts_first_chunk_ms", "runner_first_chunk_ms", "runner_done_ms"} <= set(turn["timings"])
    assert turn["timings"]["released_ms"] >= t["guard_ms"]
    await gw.aclose()


async def test_the_tts_connection_is_opened_while_the_guard_runs(voiced, runtime, monkeypatch):
    # Live 2026-10-22: the first clause's TTS request paid a new TLS connection to the worker (the idle one
    # was gone by the next question). It is opened at the start of the turn now, next to the guard.
    state, _scenario, _sockets = voiced
    warmed: list[str] = []

    async def prewarm(lang: str) -> str:
        warmed.append(lang)
        return "gpu-worker"

    monkeypatch.setattr(state.voice, "prewarm_tts", prewarm)
    calls: list[str] = []
    gw, tid, call, _dbl = await _start(state, runtime, calls, REPLY_TR)
    transport = httpx.ASGITransport(app=app_module.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        r = await c.post(f"/v2/case/{tid}/interview", headers=ME, json={
            "message": "Ağrınız nasıl?", "locale": "tr", "call_session_id": call.id})
        r2 = await c.post(f"/v2/case/{tid}/interview", headers=ME, json={"message": "Ateşiniz var mı?", "locale": "tr"})
    assert r.status_code == 200 and r2.status_code == 200
    assert warmed == ["tr"]                     # only a turn with a live call warms the voice
    await gw.aclose()


async def test_nothing_is_spoken_when_the_guard_overrules_the_speculative_prompt(voiced, runtime):
    state, scenario, sockets = voiced
    calls: list[str] = []
    gw, tid, call, _dbl = await _start(state, runtime, calls, "Bilmiyorum doktor bey, futbolu pek izlemem.",
                                       label="off_topic")
    transport = httpx.ASGITransport(app=app_module.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        r = await c.post(f"/v2/case/{tid}/interview", headers=ME, json={
            "message": "Ağrınız ne zaman başladı?", "locale": "tr", "call_session_id": call.id})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["guard"]["label"] == "off_topic" and body["meta"]["speculative"] == "restarted"
    # Spoken from the guard-labelled prompt only (the speculative call was cancelled): the persona reply
    # that reached the call was written under the off-topic directive.
    from server.interview.patient import _DIRECTIVE

    persona = [b for b in _dbl.calls if "role-playing ONE patient" in (b.get("system") or [{}])[0].get("text", "")]
    assert persona and _DIRECTIVE["off_topic"] in persona[-1]["messages"][-1]["content"]
    assert await _wait(lambda: bool(call.metrics.get("voiced_turns")))
    assert len(_lines(sockets[0].sent)) == 1
    await gw.aclose()


async def test_another_learners_call_is_never_spoken_into(voiced, runtime):
    state, scenario, sockets = voiced
    calls: list[str] = []
    gw, tid, call, _dbl = await _start(state, runtime, calls, REPLY_TR)
    transport = httpx.ASGITransport(app=app_module.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        r = await c.post(f"/v2/case/{tid}/interview", headers={"X-User-Id": "L-voice"}, json={
            "message": "Ne zaman başladı?", "locale": "tr", "call_session_id": "x" * 24})
    assert r.status_code == 200 and "voice" not in r.json()["meta"]
    assert sockets == [] and "persona:plain" in calls
    await gw.aclose()


async def test_the_image_edits_wait_while_the_patient_speaks_on_that_gpu():
    """Live 2026-10-21: with the case's pictures being edited on the same A100, Chatterbox's first chunk
    took 3 to 4 s instead of 1.6 to 1.9 s. An edit waits until no line is being spoken on its worker."""
    from server.voice.avatar import turn_speech as ts

    ts.SPEAKING["https://w.test"] = 1

    async def finish():
        await asyncio.sleep(0.3)
        ts.SPEAKING["https://w.test"] = 0

    task = asyncio.get_running_loop().create_task(finish())
    waited = await ts.wait_until_quiet("https://w.test", poll_s=0.05)
    await task
    assert 0.25 <= waited < 2
    assert await ts.wait_until_quiet("https://other.test") < 0.05
    ts.SPEAKING.pop("https://w.test", None)
