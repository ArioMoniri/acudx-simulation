"""/v2 routes: honesty (503), faculty-only template, staged SSE order and reconnect, server-held case
state, director step bound to the thread."""

from __future__ import annotations

import json

import httpx
import pytest

from server import app as app_module
from server.orchestration.routes import OrchestrationRuntime
from server.tests.conftest import make_settings
from server.tests.openai_double import Scenario, build_double

# Local-mode principal whose sub is the learner id the requests name (review 04 O3).
ME = {"X-User-Id": "L-route"}


ADMIN = "adm-orch"


@pytest.fixture(autouse=True)
def local_auth(tmp_path):
    """The lifespan is not run under ASGITransport: install a local-mode auth service."""
    from types import SimpleNamespace

    from server.auth.deps import AuthService
    from server.auth.store import UserRoleStore
    from server.registry.store import RegistryStore

    state = app_module.app.state
    saved = {k: getattr(state, k, None) for k in ("auth", "settings")}
    db = str(tmp_path / "auth.db")
    state.auth = AuthService(RegistryStore(db, secret_key=None), UserRoleStore(db), env_mode="local")
    state.settings = SimpleNamespace(admin_token=ADMIN)
    yield
    for k, v in saved.items():
        setattr(state, k, v)


@pytest.fixture
async def client(runtime: OrchestrationRuntime):
    app_module.app.state.orchestration = runtime
    transport = httpx.ASGITransport(app=app_module.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app_module.app.state.orchestration = None


@pytest.fixture
async def unreachable_client(unreachable_settings):
    rt = await OrchestrationRuntime.create(unreachable_settings, in_memory=True)
    rt.llm._retries = 0
    app_module.app.state.orchestration = rt
    transport = httpx.ASGITransport(app=app_module.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app_module.app.state.orchestration = None
    await rt.aclose()


def _parse_sse(text: str) -> list[tuple[str, dict]]:
    events: list[tuple[str, dict]] = []
    for block in text.strip().split("\n\n"):
        name, data = None, None
        for line in block.splitlines():
            if line.startswith("event: "):
                name = line[7:]
            elif line.startswith("data: "):
                data = json.loads(line[6:])
        if name:
            events.append((name, data or {}))
    return events


async def test_generate_returns_model_spec_and_trace(client: httpx.AsyncClient):
    r = await client.post("/v2/case/generate", json={"system": "cardiology", "seed": 12, "thread_id": "th-1"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["thread_id"] == "th-1"
    meta = body["spec"]["meta"]
    assert meta["source"] == "model" and meta["pipeline"] == "staged" and meta["thread_id"] == "th-1"
    nodes = [e["node"] for e in body["trace"]]
    assert nodes[:2] == ["s1", "kernel"]
    # S1, the kernel and one short call per core layer (3 history clusters, 3 exam systems, treatments, results)
    assert sum(1 for n in nodes if n.startswith("layer:")) == 8
    assert body["trace_summary"]["model_calls"] >= 9
    assert body["trace_summary"]["price_table_version"]
    assert set(body["layers"].values()) == {"ready"}


async def test_generate_503_when_model_unreachable(unreachable_client: httpx.AsyncClient):
    r = await unreachable_client.post("/v2/case/generate", json={"system": "cardiology"})
    assert r.status_code == 503
    body = r.json()
    assert body["error"] == "model_unreachable"
    assert "template" not in body["detail"] and body["retryable"] is True  # Retry, nothing else
    assert "spec" not in body
    r2 = await unreachable_client.post("/v2/case/generate/stream", json={})
    assert r2.status_code == 503 and r2.json()["error"] == "model_unreachable"


async def test_generate_503_when_airgapped_blocks_endpoint():
    settings = make_settings(airgapped=True, llm_provider="api", openai_base_url="https://api.example.com/v1")
    rt = await OrchestrationRuntime.create(settings, in_memory=True)
    assert rt.llm is None
    app_module.app.state.orchestration = rt
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app_module.app), base_url="http://test") as c:
            r = await c.post("/v2/case/generate", json={})
            assert r.status_code == 503 and "AIRGAPPED" in r.json()["cause"]
    finally:
        app_module.app.state.orchestration = None
        await rt.aclose()


FACULTY = {"X-User-Id": "fac", "X-User-Role": "faculty", "X-Admin-Token": ADMIN}


async def test_template_route_is_a_faculty_diagnostic_and_labelled(client: httpx.AsyncClient):
    assert (await client.post("/v2/case/template", json={"system": "neurology"})).status_code == 401
    assert (await client.post("/v2/case/template", json={"system": "neurology"}, headers=ME)).status_code == 403
    r = await client.post("/v2/case/template", json={"system": "neurology", "seed": 5}, headers=FACULTY)
    assert r.status_code == 200
    spec = r.json()["spec"]
    assert spec["meta"]["source"] == "template" and spec["meta"]["degraded"] is True
    assert spec["condition"]["system"] == "neurology"


def _parse_ids(text: str) -> list[int]:
    return [int(line[4:]) for line in text.splitlines() if line.startswith("id: ")]


async def test_stream_event_order(client: httpx.AsyncClient):
    async with client.stream("POST", "/v2/case/generate/stream",
                             json={"system": "pulmonology", "seed": 7, "thread_id": "th-sse"}, headers=ME) as r:
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/event-stream")
        text = "".join([chunk async for chunk in r.aiter_text()])
    events = _parse_sse(text)
    names = [n for n, _ in events]
    assert names[0] == "start" and names[-1] == "done"
    start = events[0][1]
    assert start["thread_id"] == "th-sse" and "s1" in start["stages"] and start["eta_ms"]["s1"] > 0
    first_ready = names.index("opening.ready")
    assert "opening.delta" in names[:first_ready], "the opening streams field by field"
    assert names.index("kernel") > first_ready   # hidden kernel written right after the opening
    assert all(names.index(n) > first_ready for n in ("layer.pending", "layer.ready"))
    deltas = {d["path"]: d["value"] for n, d in events if n == "opening.delta"}
    assert "chief_complaint" in deltas and "triage_vitals.hr" in deltas
    opening = events[first_ready][1]
    assert opening["spec"]["meta"]["source"] == "model" and opening["timings"]["t_opening_ms"] > 0
    assert opening["spec"]["chief_complaint_en"] == deltas["chief_complaint"]
    ready = {d["layer"] for n, d in events if n == "layer.ready"}
    assert {"history.presenting", "history.associated", "history.background", "exam.general", "treatments",
            "results"} <= ready
    assert any(n == "judge" and d.get("layer") == "treatments" and d.get("blocking") for n, d in events)
    done = events[-1][1]
    assert done["spec"]["meta"]["source"] == "model" and done["spec"]["treatments"]
    ids = _parse_ids(text)
    assert ids == sorted(ids) and len(ids) == len(events)


async def test_stream_reconnect_replays_after_the_last_id(client: httpx.AsyncClient):
    r = await client.post("/v2/case/generate/stream", json={"seed": 9, "thread_id": "th-rc"}, headers=ME)
    ids = _parse_ids(r.text)
    mid = ids[len(ids) // 2]
    again = await client.get(f"/v2/case/th-rc/events?after={mid}", headers=ME)
    assert again.status_code == 200
    assert _parse_ids(again.text) == [i for i in ids if i > mid]
    other = await client.get("/v2/case/th-rc/events", headers={"X-User-Id": "L-other"})
    assert other.status_code == 404


async def test_checkpoint_read_after_generate(client: httpx.AsyncClient):
    r = await client.post("/v2/case/generate", json={"seed": 3, "thread_id": "th-read", "learner_id": "L-route"},
                          headers=ME)
    assert r.status_code == 200
    r2 = await client.get("/v2/case/th-read", headers=ME)
    assert r2.status_code == 200
    body = r2.json()
    assert body["status"] == "complete" and body["source"] == "model"
    assert body["spec"]["seed"] == r.json()["spec"]["seed"]
    assert body["trace_summary"]["nodes"][0] == "s1"
    assert body["last_event_id"] > 0
    r3 = await client.get("/v2/case/does-not-exist", headers=ME)
    assert r3.status_code == 404 and r3.json()["error"] == "thread_not_found"


async def test_director_steps_by_thread_with_server_state(client: httpx.AsyncClient):
    gen = await client.post("/v2/case/generate", json={"system": "cardiology", "complaint": "STEMI", "seed": 1,
                                                       "thread_id": "th-dir", "learner_id": "L-route"}, headers=ME)
    assert gen.status_code == 200, gen.text
    r = await client.post("/v2/director/step", json={
        "thread_id": "th-dir", "action": {"kind": "question", "ref": "onset"}, "use_model": False,
        "case_state": {"t_ms": 999_999_999}}, headers=ME)   # a client-held state is ignored
    assert r.status_code == 200, r.text
    assert r.json()["case_state"]["t_ms"] == 30_000
    r2 = await client.post("/v2/director/step", json={
        "thread_id": "th-dir", "action": {"kind": "question", "ref": "onset"}, "use_model": False}, headers=ME)
    assert r2.json()["case_state"]["t_ms"] == 60_000      # the server kept the state
    foreign = await client.post("/v2/director/step", json={
        "thread_id": "th-dir", "action": {"kind": "question", "ref": "onset"}}, headers={"X-User-Id": "L-other"})
    assert foreign.status_code == 404


async def test_director_refuses_a_non_model_spec_without_a_thread(client: httpx.AsyncClient):
    spec = (await client.post("/v2/case/template", json={"seed": 4}, headers=FACULTY)).json()["spec"]
    learner = await client.post("/v2/director/step", json={"spec": spec, "action": {"kind": "question", "ref": "onset"},
                                                           "use_model": False}, headers=ME)
    assert learner.status_code == 422 and learner.json()["error"] == "thread_required"
    fac = await client.post("/v2/director/step", json={"spec": spec, "action": {"kind": "question", "ref": "onset"},
                                                       "use_model": False}, headers=FACULTY)
    assert fac.status_code == 422 and fac.json()["error"] == "not_model_generated"


async def test_director_step_by_thread_records_errors_in_memory(client: httpx.AsyncClient, scenario: Scenario):
    gen = await client.post("/v2/case/generate", json={"system": "cardiology", "complaint": "STEMI", "seed": 1,
                                                       "learner_id": "L-route", "thread_id": "th-mem"}, headers=ME)
    spec = gen.json()["spec"]
    r = await client.post("/v2/director/step", json={
        "thread_id": "th-mem", "action": {"kind": "question", "ref": "onset"}, "learner_id": "L-route",
        "use_model": False}, headers=ME)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["patient_visible_changes"]["new_facts"]
    assert body["case_state"]["t_ms"] == 30_000
    # Give a contraindicated treatment: the error reaches learner memory.
    contra = next(t["code"] for t in spec["treatments"] if t["appropriateness"] == "contraindicated")
    r2 = await client.post("/v2/director/step", json={
        "thread_id": "th-mem", "action": {"kind": "treatment", "ref": contra}, "learner_id": "L-route",
        "use_model": True}, headers=ME)
    assert r2.status_code == 200
    body2 = r2.json()
    assert any("contraindicated" in n["note"] for n in body2["director_notes"])
    profile = (await client.get("/v2/learner/L-route", headers=ME)).json()
    assert profile["error_count"] >= 1 and "cardiology" in profile["weak_systems"]
    bad = await client.post("/v2/director/step", json={"action": {"kind": "question", "ref": "onset"}}, headers=ME)
    assert bad.status_code == 422 and bad.json()["error"] == "thread_required"


# --- review 04 O3: learner memory and checkpoints belong to their learner ---- #

async def test_learner_memory_requires_a_caller_and_only_their_own_id(client: httpx.AsyncClient):
    assert (await client.get("/v2/learner/L-victim")).status_code == 401
    other = await client.get("/v2/learner/L-victim", headers={"X-User-Id": "L-attacker"})
    assert other.status_code == 403 and other.json()["error"] == "forbidden_learner"
    assert (await client.get("/v2/learner/L-victim", headers={"X-User-Id": "L-victim"})).status_code == 200
    # The hashed form of the caller's own id is accepted too.
    from server.auth.deps import Principal

    hashed = Principal(sub="L-victim", email=None, name=None, roles=["student"], org="local", verified=False,
                       mode="local").user_hash
    assert (await client.get(f"/v2/learner/{hashed}", headers={"X-User-Id": "L-victim"})).status_code == 200
    # A spoofed faculty header is capped at resident in local mode (O2), so it cannot read others.
    spoof = await client.get("/v2/learner/L-victim", headers={"X-User-Id": "x", "X-User-Role": "faculty"})
    assert spoof.status_code == 403


async def test_faculty_with_the_admin_token_may_read_any_learner(client: httpx.AsyncClient):
    r = await client.get("/v2/learner/L-victim",
                         headers={"X-User-Id": "fac", "X-User-Role": "faculty", "X-Admin-Token": ADMIN})
    assert r.status_code == 200


async def test_director_step_cannot_write_another_learners_memory(client: httpx.AsyncClient):
    gen = await client.post("/v2/case/generate", json={"system": "cardiology", "complaint": "STEMI", "seed": 1,
                                                       "thread_id": "th-own-dir", "learner_id": "L-route"}, headers=ME)
    body = {"thread_id": "th-own-dir", "action": {"kind": "question", "ref": "onset"}, "use_model": False}
    assert gen.status_code == 200
    assert (await client.post("/v2/director/step", json=body, headers=ME)).status_code == 200
    assert (await client.post("/v2/director/step", json={**body, "learner_id": "L-victim"})).status_code == 401
    poisoned = await client.post("/v2/director/step", json={**body, "learner_id": "L-victim"},
                                 headers={"X-User-Id": "L-attacker"})
    assert poisoned.status_code == 403
    gen_other = await client.post("/v2/case/generate", json={"seed": 2, "learner_id": "L-victim"},
                                  headers={"X-User-Id": "L-attacker"})
    assert gen_other.status_code == 403


async def test_checkpoint_of_a_learner_is_hidden_from_other_callers(client: httpx.AsyncClient):
    r = await client.post("/v2/case/generate", json={"system": "cardiology", "seed": 3, "thread_id": "th-own",
                                                     "learner_id": "L-owner"}, headers={"X-User-Id": "L-owner"})
    assert r.status_code == 200, r.text
    assert (await client.get("/v2/case/th-own")).status_code == 401
    hidden = await client.get("/v2/case/th-own", headers={"X-User-Id": "L-other"})
    assert hidden.status_code == 404 and hidden.json()["error"] == "thread_not_found"
    assert (await client.get("/v2/case/th-own", headers={"X-User-Id": "L-owner"})).status_code == 200


# --- review 04 O7 / O11: one runtime under concurrency, capped SSE ---------- #

async def test_get_runtime_creates_exactly_one_runtime_under_concurrent_first_requests(monkeypatch):
    import asyncio
    from types import SimpleNamespace

    from server.orchestration import routes as orch

    created: list[object] = []

    async def slow_create(settings=None, **_kw):
        await asyncio.sleep(0.01)
        rt = object()
        created.append(rt)
        return rt

    monkeypatch.setattr(orch.OrchestrationRuntime, "create", staticmethod(slow_create))
    state = SimpleNamespace(settings=None)
    request = SimpleNamespace(app=SimpleNamespace(state=state))
    got = await asyncio.gather(*(orch.get_runtime(request) for _ in range(5)))
    assert len(created) == 1 and all(g is created[0] for g in got)


async def test_sse_stream_is_capped_server_side(monkeypatch):
    import asyncio
    from types import SimpleNamespace

    from server.orchestration import routes as orch

    class StuckStaged:
        async def tail(self, thread_id, after, cap_s, **_kw):
            yield 1, "start", {"thread_id": thread_id}
            await asyncio.sleep(cap_s)          # a continuation that never finishes

    rt = SimpleNamespace(staged=StuckStaged())
    monkeypatch.setattr(orch, "SSE_MAX_DURATION_S", 0.2)
    events = []
    async with asyncio.timeout(5):
        async for chunk in orch._tail_sse(rt, "th-stuck", 0):
            events.extend(_parse_sse(chunk))
    assert [e[0] for e in events] == ["start", "error"]
    assert events[-1][1]["error"] == "stream_timeout" and events[-1][1]["status"] == 504
    assert events[-1][1]["after"] == 1      # where the client reconnects
