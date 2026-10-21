"""The live call follows the case thread: the presenting look is generated at call start from the
server's case state, the severity ladder is prepared in the background, a Director step switches the
call's face (crossfaded) and the voice falls silent in arrest. The thread is read from the server
store and only for a caller who may read it."""

from __future__ import annotations

import asyncio
import base64
import json
import threading
import time

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import Response
from fastapi.testclient import TestClient

from server.tests.test_voice_avatar import SESSION, USER, Runner, _app
from server.tests.test_voice_service import FakeWorkerManager
from server.tests.voice_double import WORKER_TOKEN
from server.voice.avatar import appearance as ap
from server.voice.avatar.routes import notify_director

THREAD = "thr-fever-1"


class SyncRunner(Runner):
    """The runner stand-in plus the image edit server and the live switch."""

    def __init__(self, *, imagegen: bool = True, hold: bool = False, fail_next: int = 0, **kw):
        super().__init__(**kw)
        self.imagegen = imagegen
        self.edits: list[dict] = []
        self.switches: list[dict] = []
        # After the first (presenting) picture: fail the next ``fail_next`` edits with a 500, and with
        # ``hold`` keep every later edit waiting until ``gate`` is set.
        self.hold = hold
        self.fail_next = fail_next
        self.gate = threading.Event()

    def mount(self, app: FastAPI) -> None:
        def auth(a: str | None) -> None:
            if a != f"Bearer {WORKER_TOKEN}":
                raise HTTPException(status_code=401)

        @app.get("/imagegen/health")
        async def ig_health(authorization: str | None = Header(default=None)):
            auth(authorization)
            if not self.imagegen:
                raise HTTPException(status_code=503, detail="insufficient_vram")
            return {"ok": True, "loaded": True, "model": "black-forest-labs/FLUX.2-klein-4B", "mode": "offload",
                    "licence": "Apache-2.0"}

        @app.post("/imagegen/edit")
        async def ig_edit(request: Request, authorization: str | None = Header(default=None)):
            auth(authorization)
            body = await request.json()
            if self.edits and self.fail_next > 0:
                self.fail_next -= 1
                raise HTTPException(status_code=500, detail="cuda out of memory")
            while self.edits and self.hold and not self.gate.is_set():
                await asyncio.sleep(0.02)
            self.edits.append({"prompt": body["prompt"], "seed": body["seed"], "image": len(base64.b64decode(body["image_b64"]))})
            return Response(content=b"\xff\xd8edited-" + str(len(self.edits)).encode(), media_type="image/jpeg",
                            headers={"X-Gen-Ms": "812.5", "X-Mode": "offload", "X-Steps": "4", "X-Seed": str(body["seed"])})

        @app.get("/avatar/avatars/{avatar_id}")
        async def geometry(avatar_id: str, authorization: str | None = Header(default=None)):
            auth(authorization)
            if avatar_id not in self.avatars:
                raise HTTPException(status_code=404)
            return {"avatar_id": avatar_id, "face_box": [180, 200, 350, 420], "width": 530, "height": 720,
                    "idle_frames": 75}

        @app.post("/avatar/switch")
        async def switch(request: Request, authorization: str | None = Header(default=None)):
            auth(authorization)
            body = await request.json()
            self.switches.append(body)
            return {"ok": True, "avatar": body["avatar"], "crossfade_ms": body["crossfade_ms"], "switch_ms": 3.1}

        super().mount(app)


def _spec():
    return {
        "demographics": {"age": 58, "sex": "male"}, "chief_complaint_en": "fever and chills", "acuity_esi": 2,
        "triage_note": "Febrile and sweaty.",
        "exam": [{"maneuver": "general", "finding_en": "Flushed, diaphoretic.", "abnormal": True}],
        "hpi": [], "triage_vitals": {"hr": 118, "systolic": 102, "diastolic": 60, "rr": 24, "spo2": 94, "tempC": 39.4},
    }


def _director(phase="deteriorating", **bedside):
    bed = {"skin": "warm", "mottling": 0, "pain": 2, "gcs": 15, "pulse": True, **bedside}
    v = {"hr": 118, "systolic": 102, "diastolic": 60, "rr": 24, "spo2": 94, "tempC": 39.4}
    if phase == "arrest":
        v = {k: 0.0 for k in v} | {"tempC": 38.9}
    return {"vitals": v, "affect": {"pain": 2, "consciousness": "unresponsive" if phase == "arrest" else "alert"},
            "snapshot": {"vitals": v, "bedside": bed, "phase": phase, "severity": 0.5, "findings": []}}


class _Cases:
    def __init__(self, rows: dict):
        self.rows = rows

    def get(self, tid):
        return self.rows.get(tid)


class _Rt:
    def __init__(self, rows):
        self.cases = _Cases(rows)


def _setup(tmp_path, *, owner="learner-1", imagegen=True):
    runner = SyncRunner(imagegen=imagegen)
    app, store = _app(tmp_path, runner=runner, worker=FakeWorkerManager(ready=True), avatar_appearance_wait_s=3)
    row = {"source": "model", "owner": owner, "spec": _spec(), "director": _director()}
    app.state.orchestration = _Rt({THREAD: row})
    return app, runner, row


def _wait(cond, timeout=5.0):
    t = time.time()
    while time.time() - t < timeout:
        if cond():
            return True
        time.sleep(0.02)
    return False


def test_call_opens_on_the_generated_presenting_look_and_prepares_the_ladder(tmp_path):
    app, runner, _row = _setup(tmp_path)
    c = TestClient(app)
    r = c.post("/v1/voice/avatar/session", json={**SESSION, "thread_id": THREAD}, headers=USER)
    assert r.status_code == 200, r.text
    s = r.json()
    look = ap.look_from_case(_spec(), _director())
    assert s["appearance"]["source"] == "generated"
    assert s["appearance"]["live"]["key"] == look.key and s["appearance"]["current_key"] == look.key
    assert s["avatar_id"].startswith("acudx-p04-") and s["avatar_id"].endswith(look.key)
    first = runner.edits[0]["prompt"]
    assert "feverish" in first and "sweat" in first and "same person" in first.lower()
    assert "yellow" not in first and "blue" not in first
    # The rest of the ladder and the plain portrait follow in the background.
    assert _wait(lambda: len(runner.edits) >= 4)
    assert len({e["seed"] for e in runner.edits}) == 1          # one seed per case: one identity
    assert _wait(lambda: "acudx-p04" in runner.avatars)
    ap_state = c.get("/v1/voice/avatar/appearance", params={"session_id": s["session_id"]}, headers=USER).json()
    names = {v["name"] for v in ap_state["appearance"]["variants"]}
    assert {"presenting", "worse", "critical", "improved", "unresponsive"} <= names
    assert ap_state["voice"]["speed"] < 1.0                       # breathless at rr 24
    img = c.get("/v1/voice/avatar/appearance/image", params={"session_id": s["session_id"], "key": look.key},
                headers=USER)
    assert img.status_code == 200 and img.headers["content-type"] == "image/jpeg" and img.content.startswith(b"\xff\xd8")
    assert c.get("/v1/voice/avatar/appearance/image", params={"session_id": s["session_id"], "key": look.key},
                 headers={"X-User-Id": "learner-2"}).status_code == 404


def test_looks_are_prepared_after_the_base_portrait_and_aligned_to_it(tmp_path):
    # Live 2026-10-21: each look had its own framing, so a switch blended two faces. The base portrait
    # is prepared first and every look names it as ``ref`` (the runner registers the look onto it).
    app, runner, _row = _setup(tmp_path)
    c = TestClient(app)
    assert c.post("/v1/voice/avatar/session", json={**SESSION, "thread_id": THREAD}, headers=USER).status_code == 200
    assert _wait(lambda: len(runner.puts) >= 6)
    assert runner.puts[0] == ("acudx-p04", None)
    looks = [p for p in runner.puts if p[0] != "acudx-p04"]
    assert len(looks) >= 5 and all(ref == "acudx-p04" for _, ref in looks)


def test_director_step_switches_the_live_face_and_arrest_silences_the_voice(tmp_path):
    app, runner, row = _setup(tmp_path)
    c = TestClient(app)
    s = c.post("/v1/voice/avatar/session", json={**SESSION, "thread_id": THREAD}, headers=USER).json()
    assert _wait(lambda: sum(1 for v in c.get("/v1/voice/avatar/appearance", params={"session_id": s["session_id"]},
                                               headers=USER).json()["appearance"]["variants"]
                             if v["status"] == "ready") >= 5)
    ans = c.post("/v1/voice/avatar/offer", json={"session_id": s["session_id"], "sdp": "v=0\r\noffer", "type": "offer"},
                 headers=USER)
    assert ans.status_code == 200
    row["director"] = _director(phase="arrest", pulse=False, gcs=3)
    n = asyncio.run(notify_director(app, THREAD))
    assert n == 1
    assert runner.switches, "the Director step switched the call"
    sw = runner.switches[-1]
    assert sw["sessionid"] == "lt-1" and sw["crossfade_ms"] == 900
    arrest_key = ap.look_from_case(_spec(), row["director"]).key
    assert sw["avatar"].endswith(arrest_key)
    spoke = c.post("/v1/voice/avatar/speak", json={"session_id": s["session_id"], "text": "Help me"}, headers=USER)
    assert spoke.status_code == 200 and spoke.json()["silent"] is True
    st = c.get("/v1/voice/avatar/appearance", params={"session_id": s["session_id"]}, headers=USER).json()
    assert st["appearance"]["switches"][-1]["phase"] == "arrest" and st["appearance"]["switches"][-1]["exact"] is True


def test_a_picture_that_becomes_ready_after_the_step_is_switched_to(tmp_path, monkeypatch):
    """Live 2026-10-21: the Director moved the patient to the 'critical' look 30 s before that picture
    was prepared, and nothing switched until the next step. The ladder now switches when it lands; a
    500 from the image edit server (a busy 40 GB card) is retried."""
    from server.voice.avatar import state_sync

    monkeypatch.setattr(state_sync, "GEN_RETRY_S", 0.0)
    runner = SyncRunner(hold=True, fail_next=1)
    app, store = _app(tmp_path, runner=runner, worker=FakeWorkerManager(ready=True), avatar_appearance_wait_s=3)
    row = {"source": "model", "owner": "learner-1", "spec": _spec(), "director": _director()}
    app.state.orchestration = _Rt({THREAD: row})
    with TestClient(app) as c:     # one event loop for the whole call: the ladder runs in the background
        _ladder_case(c, app, runner, row)


def _ladder_case(c, app, runner, row):
    s = c.post("/v1/voice/avatar/session", json={**SESSION, "thread_id": THREAD}, headers=USER).json()
    assert c.post("/v1/voice/avatar/offer", json={"session_id": s["session_id"], "sdp": "v=0\r\noffer", "type": "offer"},
                  headers=USER).status_code == 200
    worse = _director(phase="deteriorating")
    for v in (worse["vitals"], worse["snapshot"]["vitals"]):
        v.update({"rr": 32, "spo2": 86})
    row["director"] = worse
    c.portal.call(notify_director, app, THREAD)
    assert runner.switches == []                    # the picture for this look is not ready yet
    runner.gate.set()
    assert _wait(lambda: len(runner.switches) > 0, timeout=8)
    st = c.get("/v1/voice/avatar/appearance", params={"session_id": s["session_id"]}, headers=USER).json()
    assert st["appearance"]["switches"][0]["reason"] in ("ladder_ready", "director:generated")
    assert st["appearance"]["switches"][0]["to"] == ap.look_from_case(_spec(), worse).key or \
        st["appearance"]["switches"][-1]["to"] == ap.look_from_case(_spec(), worse).key


def test_pictures_made_at_case_start_are_reused_by_the_call(tmp_path):
    runner = SyncRunner()
    app, store = _app(tmp_path, runner=runner, worker=FakeWorkerManager(ready=True), avatar_appearance_wait_s=3)
    app.state.orchestration = _Rt({THREAD: {"source": "model", "owner": "learner-1", "spec": _spec(),
                                            "director": _director()}})
    with TestClient(app) as c:
        r = c.post("/v1/voice/avatar/prepare", json={"thread_id": THREAD, "photo_id": "p04"}, headers=USER)
        assert r.status_code == 202 and r.json()["state"] == "preparing"
        assert _wait(lambda: c.post("/v1/voice/avatar/prepare", json={"thread_id": THREAD, "photo_id": "p04"},
                                    headers=USER).json()["state"] == "prepared")
        edits = len(runner.edits)
        assert edits >= 4
        s = c.post("/v1/voice/avatar/session", json={**SESSION, "thread_id": THREAD}, headers=USER).json()
        look = ap.look_from_case(_spec(), _director())
        assert s["avatar_id"].endswith(look.key) and len(runner.edits) == edits     # nothing made twice
        assert c.post("/v1/voice/avatar/prepare", json={"thread_id": THREAD, "photo_id": "p04"},
                      headers={"X-User-Id": "learner-2"}).status_code == 404


def test_a_thread_the_caller_may_not_read_gives_the_plain_portrait(tmp_path):
    app, runner, _row = _setup(tmp_path, owner="someone-else")
    r = TestClient(app).post("/v1/voice/avatar/session", json={**SESSION, "thread_id": THREAD}, headers=USER)
    assert r.status_code == 200
    assert "appearance" not in r.json() and r.json()["avatar_id"] == "acudx-p04"
    assert runner.edits == []


def test_no_image_edit_server_keeps_the_portrait_and_says_why(tmp_path):
    app, runner, _row = _setup(tmp_path, imagegen=False)
    r = TestClient(app).post("/v1/voice/avatar/session", json={**SESSION, "thread_id": THREAD}, headers=USER)
    assert r.status_code == 200
    a = r.json()["appearance"]
    assert a["source"] == "portrait" and "image edit server" in a["reason"]
    assert r.json()["avatar_id"] == "acudx-p04" and runner.edits == []


def test_patient_turn_with_a_thread_voices_the_live_look(tmp_path, monkeypatch):
    import server.app as app_mod
    from server.voice.avatar import state_sync

    async def view(_app, tid):
        return (_spec(), _director()) if tid == THREAD else None

    monkeypatch.setattr(state_sync, "case_view", view)
    lines = asyncio.run(state_sync.voice_lines_for_thread(app_mod.app, THREAD))
    assert any("short of breath" in ln for ln in lines) and any("hot" in ln for ln in lines)
    assert asyncio.run(state_sync.voice_lines_for_thread(app_mod.app, "nope")) == []
    from server.persona import live_state_lines
    assert any("short of breath" in ln for ln in live_state_lines({"voice": lines}))
    json.dumps(lines)


def test_pictures_are_made_on_the_fastest_image_edit_server_of_the_pool(monkeypatch):
    """A 40 GB card runs the edits layer by layer (154 s per picture, live 2026-10-21); a card with
    room for the whole model takes them, and the call's own worker only prepares them."""
    from server.voice.avatar import musetalk as mt
    from server.voice.avatar import state_sync

    modes = {"https://a.sslip.io": "sequential", "https://b.sslip.io": "gpu", "https://c.sslip.io": None}

    async def health(_client, w, **_k):
        m = modes[w.origin]
        return {"ok": m is not None, "mode": m}

    class Pool:
        def endpoints(self):
            return [{"base_url": f"{o}/v1", "api_key": "k"} for o in modes]

    monkeypatch.setattr(mt, "imagegen_health", health)
    call = mt.WorkerAvatar(origin="https://a.sslip.io", token="k")
    assert asyncio.run(state_sync.pick_gen_worker(None, Pool(), call)).origin == "https://b.sslip.io"
    modes["https://b.sslip.io"] = "sequential"
    assert asyncio.run(state_sync.pick_gen_worker(None, Pool(), call)).origin == "https://a.sslip.io"
