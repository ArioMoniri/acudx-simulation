"""Background layer concurrency by route (doc 15 section 12.10).

On the GPU worker the aggregate decode rate does not grow with concurrency (doc 15 12.6), so
continuation stays one call at a time. On Claude every call is served independently: the staged
layers took about 109 s one at a time, so a Claude route runs independent layers 3 at a time
while the dependencies stay ordered: history.presenting first (the other history and exam
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


async def test_claude_route_runs_independent_layers_three_at_a_time(monkeypatch, capsys):
    spans, wall, names = await _run(monkeypatch, claude=True)
    assert _max_in_flight(spans) == S.CLAUDE_LAYER_CONCURRENCY == 3
    _assert_dependencies(spans)
    sequential = DELAY * len(names)
    # presenting, then ceil(other history and exam / 3), then treatments and results together.
    waves = 1 + -(-(len(names) - 3) // 3) + 1
    assert wall < sequential * 0.7 and wall < DELAY * (waves + 1.5)
    print(f"claude route: {len(names)} layers, wall {wall:.2f} s vs {sequential:.2f} s sequential, {waves} waves")


async def test_an_explicit_setting_wins_over_the_route(monkeypatch):
    spans, _wall, _names = await _run(monkeypatch, claude=True, env="1")
    assert _max_in_flight(spans) == 1


@pytest.mark.parametrize("claude,env,want", [(False, None, 1), (True, None, 3), (True, "2", 2), (False, "4", 4)])
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
