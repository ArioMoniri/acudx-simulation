"""Owner requirement: every case is generated on request and changes in flight.

This file encodes the "on-request" contract for the /v2 surface so that it can
never regress silently (docs/review/06c-tester-on-request-cases.md):

  1. /v2 never serves a stored case to a learner. Every generate call runs the
     model graph and returns a freshly drawn case; a checkpoint is readable only
     by the learner it was generated for (or faculty), never by another learner;
     /v2 has no case listing / catalog route.
  2. /v2/case/template is refused for learner roles, always (owner decision:
     no learner fallback setting exists). Faculty and above may preview it as a
     diagnostic; whatever is served is labelled meta.source == "template" and
     meta.degraded is True.
  3. Director steps change state deterministically for given actions:
     deterioration after a missed deadline, improvement after an indicated
     treatment, and byte-identical output for an identical action sequence.
  4. Repeated generate calls with identical inputs and no seed differ (seed or
     condition), on both the JSON and the SSE route.

Tests that fail on today's code are marked ``xfail(strict=True)`` with a
reference to the doc, so they turn into a hard failure (XPASS) the moment the
implementer fixes the behaviour and must remove the marker.

Settings contract for (2): the owner removed the learner fallback entirely, so
``learner_template_fallback`` and ``ACUDX_LEARNER_TEMPLATE_FALLBACK`` (proposed in
06c) have no effect; a test pins that.

In-process only (openai_double); no network. Education only.
"""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

from server import app as app_module
from server.orchestration.routes import OrchestrationRuntime
from server.tests.openai_double import Scenario

DOC = "docs/review/06c-tester-on-request-cases.md"
ADMIN = "adm-onreq"
LIVE = Path(__file__).parent / "fixtures" / "live"

STUDENT = {"X-User-Id": "L-student", "X-User-Role": "student"}
OTHER_STUDENT = {"X-User-Id": "L-other", "X-User-Role": "student"}
RESIDENT = {"X-User-Id": "L-resident", "X-User-Role": "resident"}
FACULTY = {"X-User-Id": "F-1", "X-User-Role": "faculty", "X-Admin-Token": ADMIN}
LEARNER_HEADERS = [pytest.param(STUDENT, id="student"), pytest.param(RESIDENT, id="resident"),
                   pytest.param({}, id="anonymous")]


@pytest.fixture(autouse=True)
def local_auth(tmp_path):
    """Install a local-mode auth service (the lifespan is not run under ASGITransport)."""
    from server.auth.deps import AuthService
    from server.auth.store import UserRoleStore
    from server.registry.store import RegistryStore

    state = app_module.app.state
    saved = {k: getattr(state, k, None) for k in ("auth", "settings")}
    db = str(tmp_path / "auth.db")
    state.auth = AuthService(RegistryStore(db, secret_key=None), UserRoleStore(db), env_mode="local")
    state.settings = SimpleNamespace(admin_token=ADMIN, learner_template_fallback=False)
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


def _identity(spec: dict) -> tuple:
    """What makes two cases 'the same case': seed and condition."""
    return (spec.get("seed"), (spec.get("meta") or {}).get("condition_id"))


def _live_spec(name: str) -> dict:
    return json.loads((LIVE / f"{name}.json").read_text())["spec"]


# --------------------------------------------------------------------------- #
# 1. /v2 never serves a stored case to a learner                              #
# --------------------------------------------------------------------------- #
async def test_every_generate_call_runs_the_model_graph(client: httpx.AsyncClient, scenario: Scenario):
    """Each call reaches the author model; the result is model-sourced, never a template."""
    for i in range(3):
        before = len(scenario.role_calls("author"))
        r = await client.post("/v2/case/generate", json={"system": "cardiology"}, headers=STUDENT)
        assert r.status_code == 200, r.text
        spec = r.json()["spec"]
        assert spec["meta"]["source"] == "model", f"call {i} served a non-model case"
        assert spec["meta"]["generator"] == "v2"
        assert len(scenario.role_calls("author")) > before, f"call {i} did not reach the author model"


async def test_reusing_a_thread_id_does_not_replay_the_stored_case(client: httpx.AsyncClient, scenario: Scenario):
    """A second generate on an existing thread must draw a fresh case, not return the checkpoint."""
    first = await client.post("/v2/case/generate", json={"thread_id": "th-reuse"})
    assert first.status_code == 200, first.text
    authors = len(scenario.role_calls("author"))
    second = await client.post("/v2/case/generate", json={"thread_id": "th-reuse"})
    assert second.status_code == 200, second.text
    assert len(scenario.role_calls("author")) > authors, "second call on the thread did not run the model"
    assert _identity(second.json()["spec"]) != _identity(first.json()["spec"])


async def test_a_checkpoint_is_never_served_to_a_different_learner(client: httpx.AsyncClient):
    """A case generated without learner_id is not a shared stored case another learner can open."""
    r = await client.post("/v2/case/generate", json={"thread_id": "th-unowned"}, headers=STUDENT)
    assert r.status_code == 200, r.text
    leaked = await client.get("/v2/case/th-unowned", headers=OTHER_STUDENT)
    assert leaked.status_code == 404, "another learner opened a stored case by thread id"


async def test_an_owned_checkpoint_is_hidden_from_other_learners(client: httpx.AsyncClient):
    r = await client.post("/v2/case/generate", json={"thread_id": "th-owned", "learner_id": "L-student"},
                          headers=STUDENT)
    assert r.status_code == 200, r.text
    assert (await client.get("/v2/case/th-owned", headers=OTHER_STUDENT)).status_code == 404
    assert (await client.get("/v2/case/th-owned", headers=STUDENT)).status_code == 200


def test_v2_has_no_case_listing_route():
    """No /v2 GET may serve a catalog of cases. A new GET route must be reviewed and added here."""
    # Reviewed 2026-10-20 (staged generation, review 06a 4.6):
    #   /v2/case/{thread_id}/events  SSE reconnect for the caller's OWN thread (owner check, 404 otherwise)
    #   /v2/cases/mine               the caller's own encounter history: summaries, never a case
    #                                (test_my_cases_lists_only_own_summaries_never_a_case)
    # Reviewed 2026-10-21 (docs/architecture/20 section 3):
    #   /v2/case/{thread_id}/interview  the interview transcript of a thread the caller may read
    #                                   (same _thread_for check, 404 otherwise); no case content
    allowed = {"/v2/case/{thread_id}", "/v2/learner/{learner_id}", "/v2/case/{thread_id}/events",
               "/v2/cases/mine", "/v2/case/{thread_id}/interview"}
    # The OpenAPI schema, not app.routes: included routers are not flattened into app.routes.
    paths = app_module.app.openapi()["paths"]
    gets = {p for p, ops in paths.items() if p.startswith("/v2") and "get" in ops}
    assert gets, "the /v2 router is not mounted"
    assert gets <= allowed, f"unreviewed /v2 GET routes (could serve stored cases): {sorted(gets - allowed)}"


# --------------------------------------------------------------------------- #
# 2. /v2/case/template is not a learner path                                  #
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("headers", LEARNER_HEADERS)
async def test_template_is_refused_for_learner_roles_by_default(client: httpx.AsyncClient, headers: dict):
    r = await client.post("/v2/case/template", json={"system": "neurology"}, headers=headers)
    assert r.status_code in (401, 403), f"learner got a template case: {r.status_code}"
    assert "spec" not in r.json()


async def test_template_is_available_to_faculty_and_labelled(client: httpx.AsyncClient):
    r = await client.post("/v2/case/template", json={"system": "neurology"}, headers=FACULTY)
    assert r.status_code == 200, r.text
    meta = r.json()["spec"]["meta"]
    assert meta["source"] == "template" and meta["degraded"] is True


@pytest.mark.parametrize("headers", [pytest.param(STUDENT, id="student"), pytest.param(RESIDENT, id="resident")])
async def test_template_is_never_a_learner_fallback_even_when_a_setting_asks(
        client: httpx.AsyncClient, headers: dict, monkeypatch):
    """Owner decision (2026-10-20): no learner template fallback exists. The template is a
    faculty and admin diagnostic only, so the setting proposed in 06c has no effect."""
    app_module.app.state.settings.learner_template_fallback = True
    monkeypatch.setenv("ACUDX_LEARNER_TEMPLATE_FALLBACK", "1")
    r = await client.post("/v2/case/template", json={"system": "neurology"}, headers=headers)
    assert r.status_code in (401, 403), f"learner got a template case: {r.status_code}"
    assert "spec" not in r.json()


async def test_my_cases_lists_only_own_summaries_never_a_case(client: httpx.AsyncClient):
    r = await client.post("/v2/case/generate", json={"learner_id": "L-student"}, headers=STUDENT)
    assert r.status_code == 200, r.text
    mine = (await client.get("/v2/cases/mine", headers=STUDENT)).json()["cases"]
    assert [c["thread_id"] for c in mine] == [r.json()["thread_id"]]
    assert all(c["source"] == "model" for c in mine)
    assert not any(k in c for c in mine for k in ("spec", "hpi", "exam", "treatments", "condition"))
    assert (await client.get("/v2/cases/mine", headers=OTHER_STUDENT)).json()["cases"] == []
    assert (await client.get("/v2/cases/mine")).status_code == 401


# --------------------------------------------------------------------------- #
# 3. The Director changes state deterministically                             #
# --------------------------------------------------------------------------- #
async def _step(client: httpx.AsyncClient, state_or_spec: dict, action: dict, *, spec: bool = False) -> dict:
    """One Director step bound to a thread (review 06a 4.5: the server holds the case and the
    Director state; a client-sent case_state is not accepted). ``spec=True`` stores the
    model-generated spec as a fresh thread of the student; later calls name that thread through
    the returned ``case_state["case_id"]`` (the Director's case id is the thread id)."""
    rt = app_module.app.state.orchestration
    if spec:
        thread_id = f"th-dir-{state_or_spec['seed']}"
        rt.cases.put(thread_id, {"source": "model", "owner": "L-student", "spec": state_or_spec,
                                 "director": None, "layers": {}, "layer_order": [], "status": "playable"})
    else:
        thread_id = state_or_spec["case_id"]
    body = {"thread_id": thread_id, "action": action, "use_model": False}
    r = await client.post("/v2/director/step", json=body, headers=STUDENT)
    assert r.status_code == 200, r.text
    return r.json()


async def _run(client: httpx.AsyncClient, spec: dict, actions: list[dict]) -> list[dict]:
    out, state = [], None
    for i, a in enumerate(actions):
        res = await _step(client, spec if i == 0 else state, a, spec=(i == 0))
        state = res["case_state"]
        out.append(res)
    return out


async def test_a_client_held_case_state_is_never_accepted(client: httpx.AsyncClient):
    first = await _step(client, _live_spec("fever-fever_and_rigors"), {"kind": "question", "ref": "onset"}, spec=True)
    forged = {**first["case_state"], "t_ms": 99_000_000}
    r = await client.post("/v2/director/step", json={"case_state": forged, "action": {"kind": "question", "ref": "onset"}},
                          headers=STUDENT)
    assert r.status_code == 422
    nxt = await _step(client, first["case_state"], {"kind": "question", "ref": "onset"})
    assert nxt["case_state"]["t_ms"] == first["case_state"]["t_ms"] + 30_000


async def test_director_is_deterministic_for_identical_actions(client: httpx.AsyncClient):
    spec = _live_spec("fever-fever_and_rigors")
    actions = [{"kind": "question", "ref": "onset"}, {"kind": "exam", "ref": "auscultate_lungs"},
               {"kind": "elapsed", "elapsed_ms": 25 * 60_000}, {"kind": "elapsed", "elapsed_ms": 5 * 60_000}]
    a = await _run(client, spec, actions)
    b = await _run(client, spec, actions)
    strip = lambda r: {**r["patient_visible_changes"], "trace": None}  # noqa: E731 - trace carries timestamps
    assert [x["case_state"] for x in a] == [x["case_state"] for x in b]
    assert [strip(x) for x in a] == [strip(x) for x in b]


async def test_director_deteriorates_after_a_missed_deadline(client: httpx.AsyncClient):
    # Review 06b F06: the deadline is the guideline target (sepsis antimicrobial
    # within 1 h, NICE NG253), not an ESI clock; the course keeps worsening.
    spec = _live_spec("fever-fever_and_rigors")
    base = spec["triage_vitals"]
    steps = await _run(client, spec, [{"kind": "elapsed", "elapsed_ms": 65 * 60_000},
                                      {"kind": "elapsed", "elapsed_ms": 5 * 60_000}])
    assert "abx_1h" in steps[0]["patient_visible_changes"]["complications_fired"]
    assert any("abx_1h" in n["note"] and "NG253" in n["why"] for n in steps[0]["director_notes"])
    v = steps[-1]["patient_visible_changes"]["vitals"]
    assert v["hr"] > base["hr"] and v["systolic"] < base["systolic"] and v["spo2"] <= base["spo2"]
    assert any(e["kind"] == "missed_target" for e in steps[-1]["case_state"]["errors"])


async def test_director_improves_after_indicated_treatment(client: httpx.AsyncClient):
    spec = _live_spec("fever-fever_and_rigors")
    base = spec["triage_vitals"]
    indicated = next(t["label_en"] for t in spec["treatments"] if t["appropriateness"] == "indicated")
    first = await _step(client, spec, {"kind": "question", "ref": "onset"}, spec=True)
    # The live spec carries empty treatment codes; the Director keys rows by label then.
    code = next(t["code"] for t in first["case_state"]["treatments"] if t["label_en"] == indicated)
    tx = await _step(client, first["case_state"], {"kind": "treatment", "ref": code})
    later = await _step(client, tx["case_state"], {"kind": "elapsed", "elapsed_ms": 25 * 60_000})
    v = later["patient_visible_changes"]["vitals"]
    assert v["hr"] < base["hr"] and v["systolic"] > base["systolic"] and v["spo2"] >= base["spo2"]
    assert "missed_time_critical_treatment" not in later["patient_visible_changes"]["complications_fired"]
    pending = later["case_state"]["pending_complications"]
    assert all(c["cancelled"] for c in pending if c["id"] == "missed_time_critical_treatment")


# --------------------------------------------------------------------------- #
# 4. Identical inputs, no seed: different cases                               #
# --------------------------------------------------------------------------- #
async def test_repeated_generate_without_seed_differs(client: httpx.AsyncClient):
    req = {"system": "cardiology", "difficulty": 3, "locale": "en"}
    specs = []
    for _ in range(4):
        r = await client.post("/v2/case/generate", json=req, headers=STUDENT)
        assert r.status_code == 200, r.text
        specs.append(r.json()["spec"])
    ids = [_identity(s) for s in specs]
    assert len(set(ids)) == len(ids), f"identical requests produced a repeated case: {ids}"
    assert len({s["seed"] for s in specs}) == len(specs)


async def test_repeated_stream_without_seed_differs(client: httpx.AsyncClient):
    seen = []
    for _ in range(2):
        r = await client.post("/v2/case/generate/stream", json={"system": "cardiology"}, headers=STUDENT)
        assert r.status_code == 200, r.text
        done = [d for e, d in _parse_sse(r.text) if e == "done"]
        assert done and done[0]["spec"], "stream ended without a case"
        assert done[0]["spec"]["meta"]["source"] == "model"
        seen.append(_identity(done[0]["spec"]))
    assert seen[0] != seen[1], f"two identical stream requests gave the same case: {seen}"


async def test_an_explicit_seed_still_reproduces(client: httpx.AsyncClient):
    """The control: a caller-pinned seed is the one way to get the same draw twice."""
    a = await client.post("/v2/case/generate", json={"system": "cardiology", "seed": 77})
    b = await client.post("/v2/case/generate", json={"system": "cardiology", "seed": 77})
    assert a.status_code == b.status_code == 200
    assert _identity(a.json()["spec"]) == _identity(b.json()["spec"])
