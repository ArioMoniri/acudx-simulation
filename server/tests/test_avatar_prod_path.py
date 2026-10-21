"""The production path of the patient video (live site findings 2026-10-21: "video call won't work",
"symptoms not shown in video", "video is static").

* the gateway image carries the case portraits the runner is prepared from (the session answered
  400 unknown_photo_id in the container);
* with live video enabled, a case start wakes the worker and the pictures are made once it is up;
* pictures wait for the image edit server, which comes up minutes after the worker's LLM, instead
  of giving up on the case for good;
* the chart's still portrait shows the generated look of the patient as they are now.
"""

from __future__ import annotations

import asyncio
import re
import time
from pathlib import Path

from fastapi.testclient import TestClient

from server.tests.test_avatar_state_sync import THREAD, SyncRunner, _director, _Rt, _spec, _wait
from server.tests.test_voice_avatar import SESSION, USER, _app
from server.tests.test_voice_service import FakeWorkerManager
from server.voice.avatar import appearance as ap
from server.voice.avatar import musetalk as mt
from server.voice.avatar import state_sync

REPO = Path(__file__).resolve().parents[2]


# --- the gateway image ------------------------------------------------------------------------ #

def test_the_gateway_image_carries_the_case_portraits():
    dockerfile = (REPO / "deploy" / "Dockerfile.server").read_text()
    assert "COPY web/public/patients/*.jpg web/public/patients/" in dockerfile
    # WORKDIR /app + server/voice/avatar/musetalk.py -> /app/web/public/patients
    assert "WORKDIR /app" in dockerfile
    assert mt.DEFAULT_PORTRAIT_DIR == REPO / "web" / "public" / "patients"
    assert not re.search(r"^web/public", (REPO / ".dockerignore").read_text(), re.M)


def test_production_compose_turns_on_the_case_start_prewarm():
    compose = (REPO / "docker-compose.prod.yml").read_text()
    assert "AVATAR_PREWARM_ON_CASE_START=${AVATAR_PREWARM_ON_CASE_START:-true}" in compose


# --- case start wakes the worker when the video is enabled ------------------------------------- #

class BootingWorkerManager(FakeWorkerManager):
    """Not ready until ``boot`` is set (a cold Lambda boot)."""

    def __init__(self, **kw):
        super().__init__(ready=False, **kw)
        self.boot: asyncio.Event | None = None

    async def ensure_worker(self):
        self.ensure_calls += 1
        if self.boot is None:
            self.boot = asyncio.Event()
        await self.boot.wait()
        self._ready = True
        return object()


def _case(app):
    app.state.orchestration = _Rt({THREAD: {"source": "model", "owner": "learner-1", "spec": _spec(),
                                            "director": _director()}})


def _prepare(c):
    return c.post("/v1/voice/avatar/prepare", json={"thread_id": THREAD, "photo_id": "p04"}, headers=USER)


def test_with_prewarm_a_case_start_wakes_the_worker_and_makes_the_pictures_once_it_is_up(tmp_path):
    runner = SyncRunner()
    worker = BootingWorkerManager()
    app, _ = _app(tmp_path, runner=runner, worker=worker, avatar_prewarm_on_case_start=True,
                  avatar_appearance_wait_s=3)
    _case(app)
    with TestClient(app) as c:
        r = _prepare(c)
        assert r.status_code == 202
        assert r.json()["state"] == "worker_starting" and r.json()["pending_launch"] is True
        assert _wait(lambda: worker.ensure_calls == 1)
        assert _prepare(c).json()["state"] == "worker_starting"      # one launch, not one per poll
        assert worker.ensure_calls == 1 and runner.edits == []
        c.portal.call(worker.boot.set)
        assert _wait(lambda: len(runner.edits) >= 4, timeout=8)
        assert _wait(lambda: _prepare(c).json()["state"] == "prepared", timeout=8)
        s = c.post("/v1/voice/avatar/session", json={**SESSION, "thread_id": THREAD}, headers=USER).json()
        assert s["avatar_id"].endswith(ap.look_from_case(_spec(), _director()).key)


def test_without_prewarm_a_case_start_still_never_launches(tmp_path):
    worker = BootingWorkerManager()
    app, _ = _app(tmp_path, worker=worker)
    _case(app)
    with TestClient(app) as c:
        assert _prepare(c).json() == {"state": "no_worker", "pending_launch": False}
    assert worker.ensure_calls == 0


def test_prewarm_says_why_when_the_worker_cannot_launch(tmp_path):
    worker = FakeWorkerManager(ready=False, can_launch=False)
    app, _ = _app(tmp_path, worker=worker, avatar_prewarm_on_case_start=True)
    _case(app)
    with TestClient(app) as c:
        r = _prepare(c)
    assert r.json() == {"state": "no_worker", "pending_launch": False}
    assert worker.ensure_calls == 0


# --- pictures wait for the image edit server --------------------------------------------------- #

def test_pictures_wait_for_the_image_edit_server_instead_of_giving_up(tmp_path, monkeypatch):
    monkeypatch.setattr(state_sync, "SERVICES_POLL_S", 0.05)
    runner = SyncRunner(imagegen=False)
    app, _ = _app(tmp_path, runner=runner, worker=FakeWorkerManager(ready=True), avatar_appearance_wait_s=0.2)
    _case(app)
    with TestClient(app) as c:
        s = c.post("/v1/voice/avatar/session", json={**SESSION, "thread_id": THREAD}, headers=USER).json()
        assert s["avatar_id"] == "acudx-p04"                       # opens on the portrait for now
        assert "image edit server" in s["appearance"]["reason"]
        assert c.post("/v1/voice/avatar/offer", json={"session_id": s["session_id"], "sdp": "v=0\r\noffer",
                                                      "type": "offer"}, headers=USER).status_code == 200
        runner.imagegen = True                                      # the edit server came up
        assert _wait(lambda: len(runner.switches) > 0, timeout=8)   # the live call moves to the look
        look = ap.look_from_case(_spec(), _director())
        assert runner.switches[0]["avatar"].endswith(look.key)
        st = c.get("/v1/voice/avatar/appearance", params={"session_id": s["session_id"]}, headers=USER).json()
        assert st["appearance"]["reason"] is None          # the "not ready yet" note goes with the switch


def test_prepare_on_a_worker_without_an_edit_server_yet_waits_too(tmp_path, monkeypatch):
    monkeypatch.setattr(state_sync, "SERVICES_POLL_S", 0.05)
    runner = SyncRunner(imagegen=False)
    worker = FakeWorkerManager(ready=True)
    app, _ = _app(tmp_path, runner=runner, worker=worker)
    _case(app)
    with TestClient(app) as c:
        r = _prepare(c)
        assert r.status_code == 202 and r.json()["state"] == "preparing"
        # While the pictures wait for the edit server, the worker counts as in use (idle reaper).
        before = worker.touches
        assert _wait(lambda: worker.touches >= before + 2)
        runner.imagegen = True
        assert _wait(lambda: _prepare(c).json()["state"] == "prepared", timeout=8)


def test_services_wait_gives_up_after_its_budget_and_says_so():
    class Client:
        pass

    a = state_sync.Appearance(thread_id=THREAD, photo_id="p04", base_avatar_id="acudx-p04")

    async def never(*_a, **_k):
        return {"ok": False, "reason": "loading"}

    async def run():
        orig = mt.imagegen_health
        mt.imagegen_health = never
        try:
            t = time.monotonic()
            ok = await state_sync.await_services(Client(), mt.WorkerAvatar("http://worker.test", "t"), a,
                                                 wait_s=0.2, poll_s=0.05)
            return ok, time.monotonic() - t
        finally:
            mt.imagegen_health = orig

    ok, took = asyncio.run(run())
    assert ok is False and took < 2
    assert "image edit server" in (a.reason or "") and "loading" in (a.reason or "")


# --- the chart portrait shows the generated look ----------------------------------------------- #

def test_the_chart_portrait_is_the_generated_look_once_ready(tmp_path):
    runner = SyncRunner()
    app, _ = _app(tmp_path, runner=runner, worker=FakeWorkerManager(ready=True))
    _case(app)
    q = {"thread_id": THREAD, "photo_id": "p04"}
    with TestClient(app) as c:
        assert c.get("/v1/voice/avatar/look", params=q, headers=USER).json()["state"] == "none"
        _prepare(c)
        assert _wait(lambda: c.get("/v1/voice/avatar/look", params=q, headers=USER).json().get("has_image"))
        look = c.get("/v1/voice/avatar/look", params=q, headers=USER).json()
        live = ap.look_from_case(_spec(), _director())
        assert look["key"] == live.key and look["live_key"] == live.key and look["exact"] is True
        img = c.get("/v1/voice/avatar/look/image", params={**q, "key": look["key"]}, headers=USER)
        assert img.status_code == 200 and img.headers["content-type"] == "image/jpeg"
        assert img.content.startswith(b"\xff\xd8edited-")
        # Another learner cannot read this case's pictures.
        other = {"X-User-Id": "learner-2"}
        assert c.get("/v1/voice/avatar/look", params=q, headers=other).status_code == 404
        assert c.get("/v1/voice/avatar/look/image", params={**q, "key": look["key"]}, headers=other).status_code == 404


# --- the warming state the call tile shows ------------------------------------------------------ #

class PoolStatus(FakeWorkerManager):
    def __init__(self, workers: list[dict], **kw):
        super().__init__(**kw)
        self.workers = workers

    async def status(self):
        return {**(await super().status()), "workers": self.workers, "capacity": {"launching": 0}}


def _caps(tmp_path, worker, runner=None):
    from server.tests.test_voice_avatar import Runner

    app, _ = _app(tmp_path, runner=runner or Runner(), worker=worker)
    with TestClient(app) as c:
        return c.portal.call(lambda: app.state.voice.capabilities(probe_worker=True))["avatar"]["wake"]


def test_the_video_wake_says_which_stage_the_launch_is_in(tmp_path):
    from server.tests.test_voice_avatar import Runner

    t = time.time()
    booting = PoolStatus([{"status": "booting", "launched_at": t - 120}], ready=False)
    w = _caps(tmp_path / "a", booting)
    assert w["stage"] == "machine" and 110 <= w["elapsed_s"] <= 200 and 0 < w["progress"] < 0.95
    loading = PoolStatus([{"status": "ready", "launched_at": t - 600}], ready=True)
    w = _caps(tmp_path / "b", loading, runner=Runner(healthy=False, status={"state": "building"}))
    assert w["stage"] == "video_services" and w["runner"] == "building" and w["progress"] > 0.4
    disabled = PoolStatus([{"status": "ready", "launched_at": t - 900}], ready=True)
    w = _caps(tmp_path / "c", disabled, runner=Runner(healthy=False))
    assert w["stage"] == "failed" and "insufficient_vram" in w["detail"]
    up = PoolStatus([{"status": "ready", "launched_at": t - 900}], ready=True)
    assert _caps(tmp_path / "d", up)["stage"] == "ready"
    assert _caps(tmp_path / "e", PoolStatus([], ready=False))["stage"] == "idle"
