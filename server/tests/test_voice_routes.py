"""/v1/voice/* routes: streaming headers, multipart STT, capabilities, LiveKit room tokens, admin agent config."""

from __future__ import annotations

import time

import httpx
import pytest
from cryptography.fernet import Fernet
from fastapi import FastAPI
from fastapi.testclient import TestClient

from server.auth.deps import AuthService
from server.auth.store import UserRoleStore
from server.config import Settings
from server.registry.store import ProviderIn, RegistryStore
from server.registry.resolve import RegistryResolver
from server.telemetry.events import TelemetryRecorder
from server.tests.test_voice_service import BootingWorkerManager, FakeWorkerManager
from server.tests.voice_double import WORKER_TOKEN, HostRouter, WorkerScenario, build_worker_double, wav_bytes
from server.voice import livekit as lk
from server.voice.routes import admin_router, router
from server.voice.service import VoiceService

KEY = Fernet.generate_key().decode()
HDR = {"X-Admin-Token": "adm-secret"}


def _app(tmp_path, *, scenario: WorkerScenario | None = None, worker: FakeWorkerManager | None = None, **over):
    base = dict(_env_file=None, airgapped=False, admin_token="adm-secret", acudx_db_path=str(tmp_path / "acudx.db"),
                acudx_secret_key=KEY)
    base.update(over)
    s = Settings(**base)
    store = RegistryStore(s.acudx_db_path, secret_key=KEY)
    telemetry = TelemetryRecorder(s.acudx_db_path)
    resolver = RegistryResolver(store, s, worker_manager=worker)
    asgi = {"worker.test": build_worker_double(scenario)} if scenario is not None else {}
    client = httpx.AsyncClient(transport=HostRouter(asgi))
    app = FastAPI()
    app.state.settings = s
    app.state.registry = store
    app.state.telemetry = telemetry
    app.state.voice = VoiceService(s, resolver, telemetry=telemetry, client=client)
    # Local auth mode: /v1/voice/room needs a signed-in principal (X-User-Id header here).
    app.state.auth = AuthService(store, UserRoleStore(s.acudx_db_path), env_mode="local")
    app.include_router(router)
    app.include_router(admin_router)
    return app, store, telemetry


def test_tts_streams_audio_with_provenance_headers(tmp_path):
    sc = WorkerScenario()
    app, store, telemetry = _app(tmp_path, scenario=sc, worker=FakeWorkerManager(ready=True))
    c = TestClient(app)
    r = c.post("/v1/voice/tts", json={"text": "Nefes alamıyorum", "lang": "tr", "sex": "female", "age": 40,
                                      "format": "wav"})
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("audio/wav")
    assert r.headers["x-voice-provider"] == "gpu-worker" and r.headers["x-voice-source"] == "gpu_worker"
    assert r.headers["x-voice-adapter"] == "openai_compatible" and r.headers["x-voice-id"] == "acudx_tr_female"
    assert r.headers["x-audio-duration-ms"] == "500" and r.headers["cache-control"] == "no-store"
    assert "x-voice-ttfb-ms" in r.headers and r.content == wav_bytes(0.5)
    assert telemetry.recent()[0]["kind"] == "tts"


def test_tts_validates_body(tmp_path):
    app, _, _ = _app(tmp_path)
    c = TestClient(app)
    assert c.post("/v1/voice/tts", json={"text": ""}).status_code == 422
    assert c.post("/v1/voice/tts", json={"text": "x", "format": "ogg"}).status_code == 422


def test_tts_and_stt_answer_503_with_reasons_when_airgapped_refuses_everything(tmp_path):
    from server.providers.gpu_worker import AirgappedRefused
    app, store, _ = _app(tmp_path, airgapped=True, worker=FakeWorkerManager(ready=False, refuse=AirgappedRefused("x")))
    store.create_provider(ProviderIn(kind="tts", name="eleven", base_url="https://api.elevenlabs.io", api_key="xi"))
    c = TestClient(app)
    r = c.post("/v1/voice/tts", json={"text": "hello", "lang": "en"})
    assert r.status_code == 503
    body = r.json()
    assert body["error"] == "tts_unavailable" and body["airgapped"] is True
    assert any("eleven" in x for x in body["reasons"]) and any("airgapped" in x for x in body["reasons"])
    r2 = c.post("/v1/voice/stt", files={"file": ("d.webm", b"\x1aE", "audio/webm")}, data={"lang": "tr"})
    assert r2.status_code == 503 and r2.json()["error"] == "stt_unavailable"


def test_stt_multipart_returns_transcript_language_confidence(tmp_path):
    sc = WorkerScenario()
    app, _, telemetry = _app(tmp_path, scenario=sc, worker=FakeWorkerManager(ready=True))
    c = TestClient(app)
    r = c.post("/v1/voice/stt", files={"file": ("dictation.webm", b"\x1aE\xdf\xa3", "audio/webm")}, data={"lang": "tr"})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["text"] == sc.transcript and j["language"] == "tr" and 0.85 < j["confidence"] < 0.95
    assert j["provider"] == "gpu-worker" and j["model"] == "deepdml/faster-whisper-large-v3-turbo-ct2"
    assert sc.stt_calls[0]["language"] == "tr" and sc.stt_calls[0]["filename"] == "dictation.webm"
    assert c.post("/v1/voice/stt", files={"file": ("e.webm", b"", "audio/webm")}).status_code == 400
    assert telemetry.recent()[0]["kind"] == "stt"


def test_capabilities_reports_providers_languages_and_avatar(tmp_path):
    app, store, _ = _app(tmp_path, worker=FakeWorkerManager(ready=False))
    store.create_provider(ProviderIn(kind="stt", name="dg", base_url="https://api.deepgram.com", api_key="k", priority=1))
    c = TestClient(app)
    j = c.get("/v1/voice/capabilities").json()
    assert j["stt"]["provider"] == "dg" and j["stt"]["adapter"] == "deepgram" and j["stt"]["model"] == "nova-3"
    assert j["tts"]["pending_launch"] is True and "tr" in j["tts"]["languages"]
    assert j["avatar"]["enabled"] is False and j["airgapped"] is False


LEARNER = {"X-User-Id": "stu-7", "X-User-Name": "Ayse Student"}


def test_room_token_requires_a_livekit_avatar_row(tmp_path):
    app, store, _ = _app(tmp_path)
    c = TestClient(app)
    assert c.post("/v1/voice/room", json={"encounter_id": "enc-1"}, headers=LEARNER).status_code == 404
    store.create_provider(ProviderIn(kind="avatar", name="lk", base_url="https://lk.example.org", api_key="lk-secret",
                                     extra={"transport": "livekit", "livekit_api_key": "APIabc", "avatar": "anam"}))
    r = c.post("/v1/voice/room", json={"encounter_id": "enc-1", "identity": "tablet", "name": "Learner"}, headers=LEARNER)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["url"] == "wss://lk.example.org" and j["renderer"] == "anam"
    assert j["identity"].startswith("learner-") and j["identity"].endswith("-tablet") and "stu-7" not in j["identity"]
    assert j["room"] == lk.room_name("enc-1") and "enc-1" not in j["room"]
    claims = lk.decode_unverified(j["token"])
    assert claims["iss"] == "APIabc" and claims["sub"] == j["identity"] and claims["video"]["room"] == j["room"]
    assert "lk-secret" not in r.text


def test_room_token_is_signed_in_only_and_identity_is_bound_to_the_caller(tmp_path):
    """Review 04: a room token is a credential. Anonymous callers get 401, the participant
    identity derives from the caller's hashed subject (no impersonation by choosing another
    learner's identity), and the metadata is JSON-encoded (no injection through encounter_id)."""
    app, store, _ = _app(tmp_path)
    store.create_provider(ProviderIn(kind="avatar", name="lk", base_url="https://lk.example.org", api_key="lk-secret",
                                     extra={"transport": "livekit", "livekit_api_key": "APIabc"}))
    c = TestClient(app)
    assert c.post("/v1/voice/room", json={"encounter_id": "enc-1"}).status_code == 401
    a = c.post("/v1/voice/room", json={"encounter_id": "enc-1"}, headers=LEARNER).json()
    b = c.post("/v1/voice/room", json={"encounter_id": "enc-1"}, headers={"X-User-Id": "stu-8"}).json()
    assert a["identity"] != b["identity"] and a["room"] == b["room"]
    spoof = c.post("/v1/voice/room", json={"encounter_id": "enc-1", "identity": b["identity"]}, headers=LEARNER).json()
    assert spoof["identity"] != b["identity"] and spoof["identity"].startswith(a["identity"])
    hostile = 'x","video":{"roomAdmin":true,"room":"*"},"z":"'
    r = c.post("/v1/voice/room", json={"encounter_id": hostile}, headers=LEARNER)
    claims = lk.decode_unverified(r.json()["token"])
    assert claims["video"]["room"] == lk.room_name(hostile) and "roomAdmin" not in claims["video"]
    import json as _json
    meta = _json.loads(claims["metadata"])
    assert meta["encounter_id"] == hostile and meta["verified"] is False and "stu-7" not in claims["metadata"]


def test_airgapped_refuses_hosted_livekit_cloud_but_allows_private(tmp_path):
    app, store, _ = _app(tmp_path, airgapped=True)
    store.create_provider(ProviderIn(kind="avatar", name="cloud", base_url="https://proj.livekit.cloud", api_key="s",
                                     priority=0, extra={"transport": "livekit", "livekit_api_key": "K"}))
    c = TestClient(app)
    r = c.post("/v1/voice/room", json={"encounter_id": "e"}, headers=LEARNER)
    assert r.status_code == 404 and "cloud" in str(r.json()["detail"])
    store.create_provider(ProviderIn(kind="avatar", name="onprem", base_url="http://10.0.0.9:7880", api_key="s",
                                     priority=5, extra={"transport": "livekit", "livekit_api_key": "K", "avatar": "musetalk"}))
    r = c.post("/v1/voice/room", json={"encounter_id": "e"}, headers=LEARNER)
    assert r.status_code == 200 and r.json()["url"] == "ws://10.0.0.9:7880" and r.json()["renderer"] == "musetalk"


def test_agent_config_is_admin_only_and_carries_resolved_keys(tmp_path):
    app, store, _ = _app(tmp_path, worker=FakeWorkerManager(ready=True))
    store.create_provider(ProviderIn(kind="stt", name="dg", base_url="https://api.deepgram.com", api_key="dg-secret"))
    store.create_provider(ProviderIn(kind="avatar", name="lk", base_url="https://lk.example.org", api_key="lk-secret",
                                     extra={"transport": "livekit", "livekit_api_key": "APIabc", "avatar": "simli",
                                            "renderer_api_key": "simli-key", "face_id": "face-1",
                                            "webhook_secret": "parked-avatar-secret"}))
    store.create_provider(ProviderIn(kind="tts", name="el", base_url="https://api.elevenlabs.io", api_key="xi",
                                     extra={"voices": {"tr": {"female": "v1"}}, "model_id": "eleven_v3",
                                            "api_secret": "parked-tts-secret", "seeded_from": "env"}))
    c = TestClient(app)
    assert c.get("/admin/voice/agent-config").status_code == 401
    r = c.get("/admin/voice/agent-config", headers=HDR)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["stt"] == {"provider": "dg", "adapter": "deepgram", "base_url": "https://api.deepgram.com",
                        "api_key": "dg-secret", "model": "nova-3", "source": "registry", "extra": {}}
    # Only the allow-listed extra keys reach the agent (review 04 O8).
    assert j["tts"]["provider"] == "el" and j["tts"]["extra"] == {"voices": {"tr": {"female": "v1"}}}
    assert "parked-tts-secret" not in r.text and "parked-avatar-secret" not in r.text
    assert j["livekit"] == {"url": "wss://lk.example.org", "api_key": "APIabc", "api_secret": "lk-secret"}
    assert j["avatar"] == {"renderer": "simli", "provider": "lk", "api_key": "simli-key", "options": {"face_id": "face-1"}}
    assert j["gateway"]["patient_turn_path"] == "/v1/patient/turn"


def test_main_app_mounts_voice_routes():
    from server.app import app as main_app
    paths = set(main_app.openapi()["paths"])
    assert {"/v1/voice/tts", "/v1/voice/stt", "/v1/voice/capabilities", "/v1/voice/room",
            "/admin/voice/agent-config"} <= paths


def test_agent_config_falls_back_to_the_gpu_worker_with_its_bearer(tmp_path):
    app, store, _ = _app(tmp_path, worker=FakeWorkerManager(ready=True))
    j = TestClient(app).get("/admin/voice/agent-config", headers=HDR).json()
    assert j["tts"]["source"] == "gpu_worker" and j["tts"]["base_url"] == "http://worker.test/tts"
    assert j["tts"]["api_key"] == WORKER_TOKEN and j["tts"]["extra"] == {}


def test_tts_answers_a_fast_503_pending_launch_while_the_worker_boots(tmp_path):
    """No ready worker: /tts starts the launch in the background and answers at once (the browser
    gives up after 30 s; a cold boot takes minutes), flagged pending so the client retries later."""
    worker = BootingWorkerManager()
    app, _, _ = _app(tmp_path, worker=worker)
    c = TestClient(app)
    t0 = time.monotonic()
    r = c.post("/v1/voice/tts", json={"text": "hello", "lang": "en", "sex": "male", "age": 50})
    assert time.monotonic() - t0 < 5.0
    assert r.status_code == 503
    body = r.json()
    assert body["pending_launch"] is True and body["airgapped"] is False and worker.ensure_calls == 1


def test_tts_503_without_a_launch_is_not_pending(tmp_path):
    from server.providers.gpu_worker import NotConfigured
    app, _, _ = _app(tmp_path, worker=FakeWorkerManager(ready=False, refuse=NotConfigured("x"), can_launch=False))
    r = TestClient(app).post("/v1/voice/tts", json={"text": "hello", "lang": "en"})
    assert r.status_code == 503 and r.json()["pending_launch"] is False


def test_warm_is_signed_in_only_and_wakes_the_worker_without_waiting(tmp_path):
    worker = BootingWorkerManager()
    app, _, _ = _app(tmp_path, worker=worker)
    c = TestClient(app)
    assert c.post("/v1/voice/warm").status_code == 401
    r = c.post("/v1/voice/warm", headers=LEARNER)
    assert r.status_code == 200 and r.json() == {"ready": False, "pending_launch": True, "refusal": None}
    for sub, wm, key, want in (("ready", FakeWorkerManager(ready=True), "ready", True),
                               ("refused", FakeWorkerManager(ready=False, can_launch=False), "pending_launch", False)):
        (tmp_path / sub).mkdir()
        other, _, _ = _app(tmp_path / sub, worker=wm)
        assert TestClient(other).post("/v1/voice/warm", headers=LEARNER).json()[key] is want
