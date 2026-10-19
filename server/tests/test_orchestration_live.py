"""Live smoke test against a real OpenAI-compatible endpoint.

Runs only when ``CASEGEN_BASE_URL`` is set, for example::

    CASEGEN_BASE_URL=http://127.0.0.1:3040/v1 CASEGEN_MODEL=qwen2.5-7b-instruct \
        .venv/bin/python -m pytest server/tests -q -m live
"""

from __future__ import annotations

import os

import pytest

from server.orchestration.graph import initial_state
from server.orchestration.routes import OrchestrationRuntime
from server.tests.conftest import make_settings

pytestmark = pytest.mark.live


@pytest.mark.skipif(not os.environ.get("CASEGEN_BASE_URL"), reason="CASEGEN_BASE_URL not set")
async def test_live_generation_is_model_sourced(live_base_url: str):
    settings = make_settings(
        airgapped=os.environ.get("AIRGAPPED", "true").lower() != "false",
        llm_base_url=live_base_url,
        llm_model=os.environ.get("CASEGEN_MODEL", "qwen2.5-7b-instruct"),
        llm_api_key=os.environ.get("CASEGEN_API_KEY", "sk-local"),
        judge_model=os.environ.get("JUDGE_MODEL"),
        request_timeout_s=float(os.environ.get("CASEGEN_TIMEOUT_S", "240")),
        connect_timeout_s=5.0,
    )
    rt = await OrchestrationRuntime.create(settings, in_memory=True)
    try:
        assert rt.llm is not None
        state = initial_state({"system": "cardiology", "seed": 101}, "live-1")
        out = await rt.graph.ainvoke(state, rt.config("live-1"))
    finally:
        await rt.aclose()
    spec = out["spec"]
    assert spec["meta"]["source"] == "model"
    assert spec["condition"]["system"] == "cardiology"
    assert spec["hpi"] and spec["exam"] and spec["treatments"]
    assert all(a.get("statement_id") for a in spec["guideline_anchors"])
    assert spec["meta"]["trace_summary"]["model_calls"] >= 4
