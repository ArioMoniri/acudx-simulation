"""GPU workers are strictly on demand at the routes: opening a case never launches one, an ended call
gives its slot back, and the voice agent's config only reads a worker that is already up."""

from __future__ import annotations

from fastapi.testclient import TestClient

from server.tests.test_avatar_state_sync import THREAD, _director, _Rt, _spec
from server.tests.test_voice_avatar import SESSION, USER, _app
from server.tests.test_voice_service import FakeWorkerManager


class CountingWorkerManager(FakeWorkerManager):
    def __init__(self, **kw):
        super().__init__(**kw)
        self.ended: list[str] = []

    def call_ended(self, ref):
        self.ended.append(ref)


def test_ending_a_call_drops_it_from_the_workers_live_call_count(tmp_path):
    worker = CountingWorkerManager(ready=True)
    app, _ = _app(tmp_path, worker=worker)
    with TestClient(app) as c:
        r = c.post("/v1/voice/avatar/session", json=SESSION, headers=USER)
        assert r.status_code == 200, r.text
        assert c.post("/v1/voice/avatar/end", json={"session_id": r.json()["session_id"]},
                      headers=USER).status_code == 200
    assert worker.ended == ["http://worker.test"]


def test_preparing_a_case_never_launches_a_worker(tmp_path):
    """Audit: every case open posts /avatar/prepare, and it started a GPU boot when none was up."""
    worker = CountingWorkerManager(ready=False)
    app, _ = _app(tmp_path, worker=worker)
    app.state.orchestration = _Rt({THREAD: {"source": "model", "owner": "learner-1", "spec": _spec(),
                                            "director": _director()}})
    with TestClient(app) as c:
        r = c.post("/v1/voice/avatar/prepare", json={"thread_id": THREAD, "photo_id": "p04"}, headers=USER)
    assert r.status_code == 202
    assert r.json() == {"state": "no_worker", "pending_launch": False}
    assert worker.ensure_calls == 0


def test_a_call_start_still_launches_a_worker(tmp_path):
    worker = CountingWorkerManager(ready=False)
    app, _ = _app(tmp_path, worker=worker)
    with TestClient(app) as c:
        r = c.post("/v1/voice/avatar/session", json=SESSION, headers=USER)
    assert r.status_code == 503 and r.json()["state"] == "worker_starting"
    assert worker.ensure_calls == 1
