"""Staged, on-request generation (review 06a section 4): CaseStore, partial JSON streaming,
S1 gate, lazy layers, same-thread continuation, blocking safety, async judges, branch events,
provenance and per-stage budgets. In-process (openai_double); no network."""

from __future__ import annotations

import asyncio

import httpx
import pytest

from server.orchestration import staged as S
from server.orchestration.partial_json import DeltaTracker, parse_partial
from server.orchestration.routes import OrchestrationRuntime
from server.orchestration.store import CaseSourceError, CaseStore
from server.tests.conftest import make_settings
from server.tests.openai_double import Scenario, build_double


async def _rt(sc: Scenario, **kw) -> OrchestrationRuntime:
    return await OrchestrationRuntime.create(make_settings(), transport=httpx.ASGITransport(app=build_double(sc)),
                                             in_memory=True, **kw)


def _events(rt: OrchestrationRuntime, tid: str) -> list[tuple[str, dict]]:
    return [(n, d) for _i, n, d in rt.cases.events(tid)]


# --------------------------------------------------------------------------- #
# CaseStore                                                                    #
# --------------------------------------------------------------------------- #
def test_case_store_round_trip_events_and_history(tmp_path):
    db = str(tmp_path / "cases.db")
    store = CaseStore(db)
    store.put("t1", {"source": "model", "owner": "L1", "status": "playable", "spec": {"chief_complaint_en": "cough"}})
    assert store.get("t1")["owner"] == "L1"
    store.update("t1", lambda s: s.update(status="complete"))
    a = store.append_event("t1", "start", {"x": 1})
    b = store.append_event("t1", "done", {"x": 2})
    assert a < b and [e[1] for e in store.events("t1", a)] == ["done"]
    # Durable: a second store on the same file (a restart) reads the same thread.
    again = CaseStore(db)
    assert again.get("t1")["status"] == "complete"
    rows = again.list_for_owner("L1")
    assert rows[0]["thread_id"] == "t1" and rows[0]["complaint"] == "cough" and "spec" not in rows[0]
    assert again.list_for_owner("L2") == []


@pytest.mark.parametrize("source", ["template", "seed", "offline", "published", ""])
def test_case_store_refuses_any_case_that_is_not_model_generated(source):
    with pytest.raises(CaseSourceError):
        CaseStore(None).put("t", {"source": source})


# --------------------------------------------------------------------------- #
# Partial JSON (opening.delta)                                                 #
# --------------------------------------------------------------------------- #
def test_partial_json_returns_only_complete_scalars():
    assert parse_partial('{"opening":{"demographics":{"age":5') == {"opening": {"demographics": {}}}
    assert parse_partial('{"opening":{"demographics":{"age":58,"name":"Ay') == {"opening": {"demographics": {"age": 58}}}
    assert parse_partial('{"a":[1,2,{"b":"x"}],"c":tr') == {"a": [1, 2, {"b": "x"}]}
    t = DeltaTracker(root="opening")
    text = '{"opening":{"chief_complaint":"I cannot breathe","triage_vitals":{"hr":120,"spo2":88}}}'
    seen = []
    for i in range(1, len(text) + 1):
        seen += t.feed(text[:i])
    assert seen == [("chief_complaint", "I cannot breathe"), ("triage_vitals.hr", 120), ("triage_vitals.spo2", 88)]


# --------------------------------------------------------------------------- #
# S1 and the continuation                                                      #
# --------------------------------------------------------------------------- #
async def test_opening_streams_first_then_layers_continue_on_the_same_thread():
    sc = Scenario(stream_chunk=12)
    rt = await _rt(sc)
    try:
        tid = rt.staged.start({"system": "infectious", "locale": "en", "learner_id": "L9"}, "th-s1")
        await rt.staged.wait(tid)
        ev = _events(rt, tid)
        names = [n for n, _ in ev]
        assert names[0] == "start" and names[-1] == "done"
        ready_at = names.index("opening.ready")
        assert names.index("opening.delta") < ready_at
        st = rt.cases.get(tid)
        assert st["timings"]["t_first_text_ms"] <= st["timings"]["t_opening_ms"]
        # Exactly one S1 call, streamed, within its cap; every layer call is short and not streamed.
        s1 = [c for c in sc.calls if c["role"] == "author"]
        assert len(s1) == 1 and s1[0]["stream"] is True and s1[0]["max_tokens"] == S.S1_MAX_TOKENS
        layers = [c for c in sc.calls if c["role"] == "author.layer"]
        assert len(layers) == len(rt.staged.core_layers(st)) >= 6
        assert all(c["max_tokens"] <= max(S.MAX_TOKENS.values()) for c in layers)
        assert all(not c["stream"] for c in layers)
        # Prefix caching: every layer call of the thread shares one byte-identical system block.
        assert len({c["system"] for c in layers}) == 1
        spec = st["spec"]
        assert spec["meta"]["source"] == "model" and spec["meta"]["thread_id"] == tid
        assert spec["meta"]["gap_filled"] == []
        assert {h["layer"] for h in spec["hpi"]} >= {"opening", "history.presenting", "history.background"}
        assert spec["treatments"] and spec["labs"] and spec["exam"]
        assert len({h["uid"] for h in spec["hpi"]}) == len(spec["hpi"])
        assert st["owner"] == "L9" and rt.memory.conditions_seen("L9") == [st["condition"]["id"]]
        S.validate_spec(spec)
    finally:
        await rt.aclose()


async def test_one_locale_per_call_and_turkish_on_request():
    sc = Scenario()
    rt = await _rt(sc, continuation=False)
    try:
        tid = rt.staged.start({"locale": "tr"}, "th-tr")
        await rt.staged.wait(tid)
        await rt.staged.ensure_layer(tid, "history.presenting")
        assert all("in Turkish only" in (c["user"] + c["system"]) for c in sc.calls if c["role"].startswith("author"))
        assert rt.cases.get(tid)["spec"]["locale"] == "tr"
    finally:
        await rt.aclose()


async def test_s1_gate_rejects_a_dose_in_the_opening_and_retries_once():
    sc = Scenario(s1_drug_dose=True)
    rt = await _rt(sc, continuation=False)
    try:
        tid = rt.staged.start({}, "th-dose")
        await rt.staged.wait(tid)
        # Both attempts carried the dose: no opening is served, the error is honest and retryable.
        assert len([c for c in sc.calls if c["role"] == "author"]) == 2
        err = next(d for n, d in _events(rt, tid) if n == "error")
        assert err["stage"] == "s1" and err["retryable"] and err["fatal"]
        assert rt.cases.get(tid)["status"] == "failed"
    finally:
        await rt.aclose()


async def test_s1_gate_retry_recovers_from_one_bad_reply():
    sc = Scenario(s1_bad=1)
    rt = await _rt(sc, continuation=False)
    try:
        tid = rt.staged.start({}, "th-bad")
        await rt.staged.wait(tid)
        assert "FIX: chief_complaint is empty" in [c for c in sc.calls if c["role"] == "author"][1]["user"]
        assert rt.cases.get(tid)["status"] == "playable"
    finally:
        await rt.aclose()


async def test_layers_are_lazy_without_continuation_and_shared_by_concurrent_readers():
    sc = Scenario(layer_delay_s=0.05)
    rt = await _rt(sc, continuation=False)
    try:
        tid = rt.staged.start({}, "th-lazy")
        await rt.staged.wait(tid)
        assert [c for c in sc.calls if c["role"] == "author.layer"] == []   # nothing before access
        a, b = await asyncio.gather(rt.staged.ensure_layer(tid, "exam.respiratory"),
                                    rt.staged.ensure_layer(tid, "exam.respiratory"))
        assert a["status"] == b["status"] == "ready"
        assert len([c for c in sc.calls if c["role"] == "author.layer"]) == 1
        with pytest.raises(KeyError):
            await rt.staged.ensure_layer(tid, "exam.spleen")
    finally:
        await rt.aclose()


async def test_a_failed_layer_is_reported_and_never_filled_from_a_fixture():
    sc = Scenario(layer_fail={"results"})
    rt = await _rt(sc)
    try:
        tid = rt.staged.start({}, "th-fail")
        await rt.staged.wait(tid)
        st = rt.cases.get(tid)
        assert st["layers"]["results"]["status"] == "failed"
        assert st["spec"]["labs"] == [] and st["spec"]["meta"]["gap_filled"] == []
        err = [d for n, d in _events(rt, tid) if n == "error"]
        assert err and err[0]["stage"] == "results" and err[0]["retryable"] and not err[0].get("fatal")
        assert _events(rt, tid)[-1][0] == "done"
        sc.layer_fail.clear()
        entry = await rt.staged.ensure_layer(tid, "results")     # Retry for the failed layer only
        assert entry["status"] == "ready" and rt.cases.get(tid)["spec"]["labs"]
    finally:
        await rt.aclose()


async def test_safety_judge_blocks_an_unsafe_treatment_table_until_it_is_rewritten(monkeypatch):
    sc = Scenario(treatments_unsafe_first=True)
    rt = await _rt(sc)
    try:
        from server.condition_catalog import CATALOG

        cond = next(c for c in CATALOG if c["id"] == "acs_stemi")
        monkeypatch.setattr(S, "sample_condition", lambda **_kw: dict(cond))
        tid = rt.staged.start({}, "th-safe")
        await rt.staged.wait(tid)
        ev = _events(rt, tid)
        tx_ready = [i for i, (n, d) in enumerate(ev) if n == "layer.ready" and d["layer"] == "treatments"]
        assert len(tx_ready) == 1, "the treatment table appears once, after the safety gate"
        assert len([c for c in sc.calls if c["role"] == "author.layer" and "LAYER: treatments" in c["user"]]) == 2
        from server.orchestration.judges import fixture_contraindicated_codes

        contra = fixture_contraindicated_codes("acs_stemi")
        served = rt.cases.get(tid)["spec"]["treatments"]
        assert not any(t["code"] in contra and t["appropriateness"] == "indicated" for t in served)
    finally:
        await rt.aclose()


def test_drug_bearing_detects_drug_names_and_doses():
    assert S.drug_bearing("Given 300 mg aspirin")
    assert not S.drug_bearing("The patient is more breathless and clammy.")


async def test_director_refreshes_when_a_layer_lands_and_branch_events_are_authored(monkeypatch):
    sc = Scenario()
    rt = await _rt(sc, continuation=False)
    try:
        from server.condition_catalog import CATALOG

        cond = next(c for c in CATALOG if c["id"] == "sepsis_uncomplicated")
        monkeypatch.setattr(S, "sample_condition", lambda **_kw: dict(cond))
        tid = rt.staged.start({}, "th-br")
        await rt.staged.wait(tid)
        st = rt.cases.get(tid)
        st["director"] = S.director_state_from_spec(st["spec"], tid)
        rt.cases.put(tid, st)
        assert "question:allergies" not in st["director"]["facts_by_trigger"]
        await rt.staged.ensure_layer(tid, "history.background")
        assert "question:allergies" in rt.cases.get(tid)["director"]["facts_by_trigger"]
        entry = await rt.staged.ensure_layer(tid, "event.missed_time_critical_treatment", reason="branch",
                                             extra="no antibiotic within 20 min", at_ms=1_500_000)
        assert entry["status"] == "ready" and entry["at_ms"] == 1_500_000
        spec = rt.cases.get(tid)["spec"]
        assert spec["events"][0]["nurse_call"]
        assert any(e["layer"] == "event.missed_time_critical_treatment" and e["abnormal"] for e in spec["exam"])
    finally:
        await rt.aclose()


async def test_provenance_guard_every_learner_facing_spec_is_model_generated():
    """CI guard (owner decision): every case a learner can receive carries source "model" and
    its thread id, on every event of the stream."""
    sc = Scenario()
    rt = await _rt(sc)
    try:
        tid = rt.staged.start({"complaint": "fever"}, "th-prov")
        await rt.staged.wait(tid)
        specs = [d["spec"] for _n, d in _events(rt, tid) if isinstance(d.get("spec"), dict)]
        assert len(specs) >= 3
        for spec in specs:
            assert spec["meta"]["source"] == "model" and spec["meta"]["thread_id"] == tid
    finally:
        await rt.aclose()


def test_layers_for_action_map_learner_actions_to_layers():
    assert S.layers_for_action("question", "onset") == ["history.presenting"]
    assert S.layers_for_action("question", "allergies") == ["history.background"]
    assert S.layers_for_action("exam", "respiratory") == ["exam.respiratory"]
    assert S.layers_for_action("order", "lab-cbc") == ["results"]
    assert S.layers_for_action("treatment", "abx") == ["treatments"]
    assert S.layers_for_action("elapsed", "") == []
