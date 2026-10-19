"""/v2 routes: honesty (503), template labelling, SSE event order, checkpoint read, director step."""

from __future__ import annotations

import json

import httpx
import pytest

from server import app as app_module
from server.orchestration.routes import OrchestrationRuntime
from server.tests.conftest import make_settings
from server.tests.openai_double import Scenario, build_double


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
    assert body["spec"]["meta"]["source"] == "model"
    assert body["trace_summary"]["model_calls"] == 4
    assert body["trace_summary"]["price_table_version"]
    assert [e["node"] for e in body["trace"]][:2] == ["sample_condition", "author"]


async def test_generate_503_when_model_unreachable(unreachable_client: httpx.AsyncClient):
    r = await unreachable_client.post("/v2/case/generate", json={"system": "cardiology"})
    assert r.status_code == 503
    body = r.json()
    assert body["error"] == "model_unreachable"
    assert "template" in body["detail"]  # points at the honest alternative
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


async def test_template_route_is_labelled_template(client: httpx.AsyncClient):
    r = await client.post("/v2/case/template", json={"system": "neurology", "seed": 5})
    assert r.status_code == 200
    spec = r.json()["spec"]
    assert spec["meta"]["source"] == "template" and spec["meta"]["degraded"] is True
    assert spec["condition"]["system"] == "neurology"


async def test_stream_event_order(client: httpx.AsyncClient):
    async with client.stream("POST", "/v2/case/generate/stream", json={"system": "pulmonology", "seed": 7, "thread_id": "th-sse"}) as r:
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/event-stream")
        text = "".join([chunk async for chunk in r.aiter_text()])
    events = _parse_sse(text)
    names = [n for n, _ in events]
    assert names[0] == "start" and names[-1] == "done"
    nodes = [d["node"] for n, d in events if n == "node"]
    assert nodes[:2] == ["sample_condition", "author"]
    assert sorted(nodes[2:5]) == ["clinical_consistency", "pedagogy", "safety_dosing"]
    assert nodes[5:] == ["aggregate", "ground", "finalize"]
    start = events[0][1]
    assert start["thread_id"] == "th-sse" and "repair" in start["pipeline"]
    agg = next(d for n, d in events if n == "node" and d["node"] == "aggregate")
    assert agg["council"]["decision"] == "accept"
    done = events[-1][1]
    assert done["spec"]["meta"]["source"] == "model"
    assert done["trace_summary"]["model_calls"] == 4


async def test_checkpoint_read_after_generate(client: httpx.AsyncClient):
    r = await client.post("/v2/case/generate", json={"seed": 3, "thread_id": "th-read"})
    assert r.status_code == 200
    r2 = await client.get("/v2/case/th-read")
    assert r2.status_code == 200
    body = r2.json()
    assert body["status"] == "done"
    assert body["spec"]["seed"] == r.json()["spec"]["seed"]
    assert body["trace_summary"]["nodes"][-1] == "finalize"
    r3 = await client.get("/v2/case/does-not-exist")
    assert r3.status_code == 404 and r3.json()["error"] == "thread_not_found"


async def test_director_step_from_spec_then_from_state(client: httpx.AsyncClient, scenario: Scenario):
    gen = await client.post("/v2/case/generate", json={"system": "cardiology", "complaint": "STEMI", "seed": 1})
    spec = gen.json()["spec"]
    r = await client.post("/v2/director/step", json={
        "spec": spec, "action": {"kind": "question", "ref": "onset"}, "learner_id": "L-route", "use_model": False,
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["patient_visible_changes"]["new_facts"]
    assert body["case_state"]["t_ms"] == 30_000
    state = body["case_state"]
    # Give a contraindicated treatment: the error reaches learner memory.
    contra = next(t["code"] for t in spec["treatments"] if t["appropriateness"] == "contraindicated")
    r2 = await client.post("/v2/director/step", json={
        "case_state": state, "action": {"kind": "treatment", "ref": contra}, "learner_id": "L-route", "use_model": True,
    })
    assert r2.status_code == 200
    body2 = r2.json()
    assert any(n["note"].startswith("contraindicated treatment") for n in body2["director_notes"])
    assert body2["patient_visible_changes"]["utterance_en"] == "It hurts, doctor, please help."
    profile = (await client.get("/v2/learner/L-route")).json()
    assert profile["error_count"] == 1 and profile["weak_systems"] == ["cardiology"]
    assert profile["conditions_seen"] == []  # generation had no learner_id
    bad = await client.post("/v2/director/step", json={"action": {"kind": "question", "ref": "onset"}})
    assert bad.status_code == 422
