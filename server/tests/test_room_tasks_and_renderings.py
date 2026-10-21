"""Room order and task loop on the thread, the treatment-table gate on administration, and
TR to EN renderings (doc 15 section 12.8). In-process (openai_double); no network."""

from __future__ import annotations

import json

import httpx
import pytest

from server import app as app_module
from server.orchestration import staged as S
from server.orchestration.routes import OrchestrationRuntime
from server.tests.conftest import make_settings
from server.tests.openai_double import Scenario, build_double

ADMIN = "adm-room-tasks"
HOST = {"X-User-Id": "L-host"}
GUEST = {"X-User-Id": "L-guest"}
STRANGER = {"X-User-Id": "L-stranger"}


async def _rt(sc: Scenario, **kw) -> OrchestrationRuntime:
    return await OrchestrationRuntime.create(make_settings(), transport=httpx.ASGITransport(app=build_double(sc)),
                                             in_memory=True, **kw)


def _parse_sse(text: str) -> list[tuple[str, dict]]:
    out: list[tuple[str, dict]] = []
    for block in text.strip().split("\n\n"):
        name, data = None, None
        for line in block.splitlines():
            if line.startswith("event: "):
                name = line[7:]
            elif line.startswith("data: "):
                data = json.loads(line[6:])
        if name:
            out.append((name, data or {}))
    return out


@pytest.fixture
def local_auth(tmp_path):
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
async def client(local_auth, runtime: OrchestrationRuntime):
    app_module.app.state.orchestration = runtime
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app_module.app), base_url="http://test") as c:
        yield c
    app_module.app.state.orchestration = None


async def _room(client: httpx.AsyncClient, tid: str) -> None:
    gen = await client.post("/v2/case/generate", json={"seed": 5, "thread_id": tid, "learner_id": "L-host"},
                            headers=HOST)
    assert gen.status_code == 200, gen.text
    assert (await client.post(f"/v2/case/{tid}/room", json={"room_code": "QX-77A"}, headers=HOST)).status_code == 200
    assert (await client.post(f"/v2/case/{tid}/join", json={"room_code": "QX-77A"}, headers=GUEST)).status_code == 200


MED = {"id": "r1-t1", "code": "161", "kind": "medication", "label_en": "Paracetamol", "label_tr": "Parasetamol",
       "detail_en": "1000 mg IV", "detail_tr": "1000 mg IV", "ordered_by": "doctor", "assigned_role": "nurse"}


# --------------------------------------------------------------------------- #
# 1. The room's order and task loop lives on the thread                        #
# --------------------------------------------------------------------------- #
async def test_doctor_order_and_nurse_administration_travel_on_the_thread(client: httpx.AsyncClient,
                                                                          runtime: OrchestrationRuntime):
    await _room(client, "th-task")
    after = runtime.cases.events("th-task")[-1][0]
    order = await client.post("/v2/case/th-task/task", json={"op": "order", "task": MED, "client_id": "tab-doc"},
                              headers=HOST)
    assert order.status_code == 200, order.text
    assert order.json()["task"]["status"] == "pending"
    # A stranger can neither read nor write the room's tasks.
    assert (await client.post("/v2/case/th-task/task", json={"op": "claim", "task": {"id": "r1-t1"}},
                              headers=STRANGER)).status_code == 404
    claim = await client.post("/v2/case/th-task/task", json={"op": "claim", "task": {"id": "r1-t1"},
                                                             "role": "nurse", "client_id": "tab-nurse"}, headers=GUEST)
    assert claim.status_code == 200 and claim.json()["task"]["status"] == "claimed"
    done = await client.post("/v2/case/th-task/task", json={
        "op": "complete", "task": {"id": "r1-t1"}, "role": "nurse", "client_id": "tab-nurse",
        "mar": {"outcome": "given", "failures": [], "allergy_conflict": False}}, headers=GUEST)
    assert done.status_code == 200, done.text
    assert done.json()["task"]["status"] == "done" and done.json()["task"]["mar"]["outcome"] == "given"
    # A done task never goes back.
    back = await client.post("/v2/case/th-task/task", json={"op": "claim", "task": {"id": "r1-t1"}, "role": "nurse"},
                             headers=GUEST)
    assert back.status_code == 200 and back.json()["task"]["status"] == "done"
    # Every member follows the same task log.
    tail = await client.get(f"/v2/case/th-task/events?after={after}", headers=HOST)
    tasks = [d for n, d in _parse_sse(tail.text) if n == "task"]
    assert [t["op"] for t in tasks] == ["order", "claim", "complete"]
    assert tasks[0]["client_id"] == "tab-doc" and tasks[-1]["task"]["completed_by"] == "nurse"
    assert runtime.cases.get("th-task")["room_tasks"]["r1-t1"]["status"] == "done"


async def test_task_payload_is_validated(client: httpx.AsyncClient):
    await _room(client, "th-task-v")
    bad_op = await client.post("/v2/case/th-task-v/task", json={"op": "delete", "task": MED}, headers=HOST)
    assert bad_op.status_code == 422
    bad_kind = await client.post("/v2/case/th-task-v/task", json={"op": "order", "task": {**MED, "kind": "x"}},
                                 headers=HOST)
    assert bad_kind.status_code == 422
    unknown = await client.post("/v2/case/th-task-v/task", json={"op": "claim", "task": {"id": "nope"}},
                                headers=GUEST)
    assert unknown.status_code == 409 and unknown.json()["error"] == "unknown_task"


async def test_administration_is_refused_while_the_treatment_table_is_missing(client: httpx.AsyncClient,
                                                                              runtime: OrchestrationRuntime,
                                                                              scenario: Scenario):
    await _room(client, "th-lock")
    # From now on the safety review rejects every treatment table (the rewrite included).
    scenario.judge_verdicts["safety_dosing"] = "fail"

    def veto(s: dict) -> None:
        s["layers"]["treatments"].update(status="failed", error="safety_veto")

    runtime.cases.update("th-lock", veto)
    await client.post("/v2/case/th-lock/task", json={"op": "order", "task": MED}, headers=HOST)
    give = await client.post("/v2/case/th-lock/task", json={
        "op": "complete", "task": {"id": "r1-t1"}, "role": "nurse",
        "mar": {"outcome": "given", "failures": [], "allergy_conflict": False}}, headers=GUEST)
    assert give.status_code == 409 and give.json()["error"] == "treatments_locked"
    assert runtime.cases.get("th-lock")["room_tasks"]["r1-t1"]["status"] == "pending"
    # A withheld dose (allergy band, five rights) is still recorded: nothing entered the course.
    held = await client.post("/v2/case/th-lock/task", json={
        "op": "complete", "task": {"id": "r1-t1"}, "role": "nurse",
        "mar": {"outcome": "blocked", "failures": ["allergy"], "allergy_conflict": True}}, headers=GUEST)
    assert held.status_code == 200 and held.json()["task"]["mar"]["outcome"] == "blocked"
    # The Director refuses a treatment step on the thread too (the same rule as the solo encounter).
    step = await client.post("/v2/director/step", json={"thread_id": "th-lock", "use_model": False,
                                                        "action": {"kind": "treatment", "ref": "161"}}, headers=GUEST)
    assert step.status_code == 409 and step.json()["error"] == "treatments_locked"


# --------------------------------------------------------------------------- #
# 2. TR to EN renderings                                                       #
# --------------------------------------------------------------------------- #
async def test_tr_case_renders_to_en_and_keeps_the_tr_source_authoritative():
    sc = Scenario()
    rt = await _rt(sc, continuation=False)
    try:
        tid = rt.staged.start({"locale": "tr"}, "th-tr-en")
        await rt.staged.wait(tid)
        await rt.staged.ensure_layer(tid, "history.presenting")
        src = rt.cases.get(tid)["spec"]
        out = await rt.staged.render_layer(tid, "history.presenting", "en")
        assert out["status"] == "ready"
        renders = [c for c in sc.calls if c["role"] == "author.render"]
        assert len(renders) == 1 and "TARGET: English" in renders[0]["user"]
        again = await rt.staged.render_layer(tid, "history.presenting", "en")
        assert again["data"] == out["data"] and len([c for c in sc.calls if c["role"] == "author.render"]) == 1
        spec = rt.cases.get(tid)["spec"]
        hp = [h for h in spec["hpi"] if h["layer"] == "history.presenting"]
        assert hp and all(h["answer_en"].startswith("[EN] ") for h in hp)
        # The TR source stays in the TR slot.
        assert [h["answer_tr"] for h in hp] == [h["answer_tr"] for h in src["hpi"] if h["layer"] == "history.presenting"]
        assert spec["meta"]["locale"] == "tr" and spec["meta"]["renderings"] == {"en": ["history.presenting"]}
        # The Director and the judges read the source, never the rendering.
        source = S.source_spec(rt.cases.get(tid))
        assert not any(h["answer_en"].startswith("[EN] ") for h in source["hpi"])
        op = await rt.staged.render_layer(tid, "opening", "en")
        assert op["status"] == "ready" and rt.cases.get(tid)["spec"]["chief_complaint_en"].startswith("[EN] ")
        with pytest.raises(ValueError):
            await rt.staged.render_layer(tid, "opening", "tr")      # the source locale
    finally:
        await rt.aclose()


async def test_render_route_accepts_en_for_a_tr_case(client: httpx.AsyncClient):
    gen = await client.post("/v2/case/generate", json={"seed": 3, "thread_id": "th-rr-en", "learner_id": "L-host",
                                                       "locale": "tr"}, headers=HOST)
    assert gen.status_code == 200, gen.text
    r = await client.post("/v2/case/th-rr-en/layer/history.presenting/render", json={"locale": "en"}, headers=HOST)
    assert r.status_code == 200, r.text
    assert r.json()["locale"] == "en" and r.json()["spec"]["meta"]["renderings"]["en"] == ["history.presenting"]
    same = await client.post("/v2/case/th-rr-en/layer/opening/render", json={"locale": "tr"}, headers=HOST)
    assert same.status_code == 422
