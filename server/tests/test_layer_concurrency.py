"""Background layer concurrency by route (doc 15 section 12.10).

On the GPU worker the aggregate decode rate does not grow with concurrency (doc 15 12.6), so
continuation stays one call at a time. On Claude every call is served independently: the staged
layers took about 109 s one at a time, so a Claude route runs independent layers up to 6 at a
time PER THREAD (one learner's case never queues behind another's), while the dependencies stay ordered: history.presenting first (the other history and exam
layers read it in the ALREADY AUTHORED ledger), then the other history and exam layers, then
the treatment table and results (they read history and exam).

The in-process double answers every layer call after ``layer_delay_s``; the wrapper below only
records when each real call starts and ends.
"""

from __future__ import annotations

import time

import httpx
import pytest

from server.orchestration import staged as S
from server.orchestration.routes import OrchestrationRuntime
from server.tests.conftest import make_settings
from server.tests.openai_double import Scenario, build_double

DELAY = 0.2


async def _run(monkeypatch, *, claude: bool, env: str | None = None) -> tuple[list[dict], float, list[str]]:
    if env is None:
        monkeypatch.delenv("CASEGEN_LAYER_CONCURRENCY", raising=False)
    else:
        monkeypatch.setenv("CASEGEN_LAYER_CONCURRENCY", env)
    sc = Scenario(layer_delay_s=DELAY)
    rt = await OrchestrationRuntime.create(make_settings(), transport=httpx.ASGITransport(app=build_double(sc)),
                                           in_memory=True)
    # The route decision only (the double still answers every call): a Claude route without
    # sending traffic to Anthropic.
    monkeypatch.setattr(S.StagedRuntime, "_claude_route", lambda self: claude)
    spans: list[dict] = []
    real = S.StagedRuntime._call

    async def timed(self, thread_id, node, *a, **kw):
        t0 = time.monotonic()
        try:
            return await real(self, thread_id, node, *a, **kw)
        finally:
            if node.startswith("layer:"):
                spans.append({"layer": node[6:], "start": t0, "end": time.monotonic()})

    monkeypatch.setattr(S.StagedRuntime, "_call", timed)
    try:
        tid = rt.staged.start({"system": "infectious", "locale": "en", "learner_id": "L-cc"}, "th-cc")
        await rt.staged.wait(tid)
        st = rt.cases.get(tid)
        names = rt.staged.core_layers(st)
        assert all((st["layers"][n] or {}).get("status") == "ready" for n in names), st["layers"]
        first = min(s["start"] for s in spans)
        last = max(s["end"] for s in spans)
        return spans, last - first, names
    finally:
        await rt.aclose()


def _max_in_flight(spans: list[dict]) -> int:
    edges = sorted([(s["start"], 1) for s in spans] + [(s["end"], -1) for s in spans], key=lambda e: (e[0], e[1]))
    cur = peak = 0
    for _, d in edges:
        cur += d
        peak = max(peak, cur)
    return peak


def _assert_dependencies(spans: list[dict]) -> None:
    by = {s["layer"]: s for s in spans}
    pres = by["history.presenting"]
    clinical = [s for s in spans if S.layer_kind(s["layer"]) in ("history", "exam") and s is not pres]
    late = [s for s in spans if S.layer_kind(s["layer"]) not in ("history", "exam")]
    assert all(s["start"] >= pres["end"] for s in clinical + late)
    assert all(s["start"] >= max(c["end"] for c in clinical) for s in late)


async def test_gpu_route_keeps_one_layer_at_a_time(monkeypatch, capsys):
    spans, wall, names = await _run(monkeypatch, claude=False)
    assert _max_in_flight(spans) == 1
    _assert_dependencies(spans)
    assert wall >= DELAY * len(names) * 0.95
    print(f"gpu route: {len(names)} layers, wall {wall:.2f} s, in flight 1")


async def test_claude_route_runs_each_wave_in_one_round(monkeypatch, capsys):
    spans, wall, names = await _run(monkeypatch, claude=True)
    waves_at_once = S.continuation_waves(names, history_at_once=True)
    widest = max(len(w) for w in waves_at_once)
    assert S.CLAUDE_LAYER_CONCURRENCY == 6
    assert _max_in_flight(spans) == min(S.CLAUDE_LAYER_CONCURRENCY, widest)
    # Every history layer at once (docs/architecture/18 6.3.11), then the exam layers, then treatments and
    # results after all of them.
    by = {s["layer"]: s for s in spans}
    hist = [s for s in spans if S.layer_kind(s["layer"]) == "history"]
    exam = [s for s in spans if S.layer_kind(s["layer"]) == "exam"]
    late = [s for s in spans if S.layer_kind(s["layer"]) not in ("history", "exam")]
    assert max(s["start"] for s in hist) < min(s["end"] for s in hist)          # overlapping
    assert all(e["start"] >= max(h["end"] for h in hist) for e in exam)
    assert all(x["start"] >= max(c["end"] for c in hist + exam) for x in late)
    assert by["history.background"]["start"] < by["history.presenting"]["end"]
    sequential = DELAY * len(names)
    waves = len(waves_at_once)
    assert waves == 3 and wall < sequential * 0.7 and wall < DELAY * (waves + 1.5)
    print(f"claude route: {len(names)} layers, wall {wall:.2f} s vs {sequential:.2f} s sequential, {waves} waves")


async def test_an_explicit_setting_wins_over_the_route(monkeypatch):
    spans, _wall, _names = await _run(monkeypatch, claude=True, env="1")
    assert _max_in_flight(spans) == 1


@pytest.mark.parametrize("claude,env,want", [(False, None, 1), (True, None, 6), (True, "2", 2), (False, "4", 4)])
def test_layer_concurrency_by_route(monkeypatch, claude, env, want):
    if env is None:
        monkeypatch.delenv("CASEGEN_LAYER_CONCURRENCY", raising=False)
    else:
        monkeypatch.setenv("CASEGEN_LAYER_CONCURRENCY", env)

    class _LLM:
        def claude_active(self) -> bool:
            return claude

        def endpoint(self, role):
            raise LookupError(role)

    rt = S.StagedRuntime(_LLM(), store=None, continuation=False)  # type: ignore[arg-type]
    assert rt.layer_concurrency() == want


async def _two_threads(monkeypatch, *, claude: bool) -> list[dict]:
    """Two cases at once with a limit of 1: on Claude each thread has its own limit."""
    monkeypatch.delenv("CASEGEN_LAYER_CONCURRENCY", raising=False)
    monkeypatch.setattr(S, "CLAUDE_LAYER_CONCURRENCY", 1)
    sc = Scenario(layer_delay_s=DELAY)
    rt = await OrchestrationRuntime.create(make_settings(), transport=httpx.ASGITransport(app=build_double(sc)),
                                           in_memory=True)
    monkeypatch.setattr(S.StagedRuntime, "_claude_route", lambda self: claude)
    spans: list[dict] = []
    real = S.StagedRuntime._call

    async def timed(self, thread_id, node, *a, **kw):
        t0 = time.monotonic()
        try:
            return await real(self, thread_id, node, *a, **kw)
        finally:
            if node.startswith("layer:"):
                spans.append({"thread": thread_id, "layer": node[6:], "start": t0, "end": time.monotonic()})

    monkeypatch.setattr(S.StagedRuntime, "_call", timed)
    try:
        a = rt.staged.start({"system": "infectious", "locale": "en", "learner_id": "L-a"}, "th-a")
        b = rt.staged.start({"system": "infectious", "locale": "en", "learner_id": "L-b"}, "th-b")
        await rt.staged.wait(a)
        await rt.staged.wait(b)
        assert not rt.staged._thread_limiters        # dropped when the thread is done
        return spans
    finally:
        await rt.aclose()


async def test_claude_limit_is_per_thread(monkeypatch):
    spans = await _two_threads(monkeypatch, claude=True)
    for tid in ("th-a", "th-b"):
        assert _max_in_flight([s for s in spans if s["thread"] == tid]) == 1
    assert _max_in_flight(spans) == 2


async def test_gpu_limit_is_shared_by_threads(monkeypatch):
    spans = await _two_threads(monkeypatch, claude=False)
    assert _max_in_flight(spans) == 1


async def test_a_learner_access_lets_a_queued_layer_go_first(monkeypatch):
    """GPU route, one call at a time: the learner asks for an exam layer the continuation has
    queued behind other history layers; it starts at once instead of waiting its turn."""
    import asyncio

    monkeypatch.delenv("CASEGEN_LAYER_CONCURRENCY", raising=False)
    sc = Scenario(layer_delay_s=DELAY)
    rt = await OrchestrationRuntime.create(make_settings(), transport=httpx.ASGITransport(app=build_double(sc)),
                                           in_memory=True)
    monkeypatch.setattr(S.StagedRuntime, "_claude_route", lambda self: False)
    spans: list[dict] = []
    real = S.StagedRuntime._call

    async def timed(self, thread_id, node, *a, **kw):
        t0 = time.monotonic()
        try:
            return await real(self, thread_id, node, *a, **kw)
        finally:
            if node.startswith("layer:"):
                spans.append({"layer": node[6:], "start": t0, "end": time.monotonic()})

    monkeypatch.setattr(S.StagedRuntime, "_call", timed)
    try:
        tid = rt.staged.start({"system": "infectious", "locale": "en", "learner_id": "L-q"}, "th-q")
        key = (tid, "exam.general")
        for _ in range(400):
            if key in rt.staged._layer_tasks and any(s["layer"] == "history.presenting" for s in spans):
                break
            await asyncio.sleep(0.01)
        assert key in rt.staged._layer_tasks
        entry = await rt.staged.ensure_layer(tid, "exam.general", reason="interview")
        assert entry.get("status") == "ready"
        await rt.staged.wait(tid)
        by = {s["layer"]: s for s in spans}
        # history.associated was in flight; history.background was queued ahead of exam.general.
        assert by["exam.general"]["start"] < by["history.background"]["start"]
        assert by["exam.general"]["start"] < by["history.associated"]["end"]
        assert not rt.staged._urgent
    finally:
        await rt.aclose()


async def test_judge_patches_of_different_layers_run_together(monkeypatch):
    """After the async judges, each unseen layer they flag is rewritten; the rewrites are
    independent, so on Claude they run at the same time instead of one after another."""
    from server.orchestration import judges as J

    monkeypatch.delenv("CASEGEN_LAYER_CONCURRENCY", raising=False)
    sc = Scenario(layer_delay_s=DELAY)
    rt = await OrchestrationRuntime.create(make_settings(), transport=httpx.ASGITransport(app=build_double(sc)),
                                           in_memory=True)
    monkeypatch.setattr(S.StagedRuntime, "_claude_route", lambda self: True)
    monkeypatch.setattr(J, "check_course_rules", lambda spec, cond: {"issues": ["review issue"]})
    flagged = ("history.associated", "exam.general", "results")
    monkeypatch.setattr(S.StagedRuntime, "_issues_by_layer",
                        staticmethod(lambda state, issues: {n: ["fix this"] for n in flagged}))
    spans: list[dict] = []
    real = S.StagedRuntime._call

    async def timed(self, thread_id, node, *a, **kw):
        t0 = time.monotonic()
        try:
            return await real(self, thread_id, node, *a, **kw)
        finally:
            if node.startswith("layer:"):
                spans.append({"layer": node[6:], "start": t0, "end": time.monotonic()})

    monkeypatch.setattr(S.StagedRuntime, "_call", timed)
    try:
        tid = rt.staged.start({"system": "infectious", "locale": "en", "learner_id": "L-p"}, "th-p")
        await rt.staged.wait(tid)
        st = rt.cases.get(tid)
        names = rt.staged.core_layers(st)
        patches = spans[len(names):]
        assert sorted(s["layer"] for s in patches) == sorted(flagged)
        assert _max_in_flight(patches) == len(flagged)
        assert any(e[1] == "done" for e in rt.cases.events(tid))
    finally:
        await rt.aclose()
