"""Claude provider: key handling, request shape (cache, structured outputs, effort, thinking),
streaming, usage and cost, refusal and outage handling, and the StructuredLLM route."""

from __future__ import annotations

import json

import pytest

from server.orchestration.llm import ModelOutputInvalid, StructuredLLM
from server.providers.anthropic_provider import (
    AnthropicProvider, AnthropicRefusal, AnthropicUnavailable, SchemaNotExpressible, model_for, output_budget,
    restore_optional, split_messages, thinking_for, to_anthropic_schema,
)
from server.telemetry import prices
from server.telemetry.events import TelemetryRecorder
from server.tests.anthropic_double import AnthropicDouble, Scripted
from server.tests.conftest import make_settings

KEY = "sk-ant-test-0000000000000000"


def claude_settings(**kw):
    return make_settings(airgapped=False, anthropic_key=KEY, **kw)


# ----------------------------------------------------------------- settings
def test_key_is_read_from_both_env_names(monkeypatch):
    from server.config import Settings

    monkeypatch.setenv("ANTHROPIC_KEY", "sk-ant-a")
    assert Settings(_env_file=None).anthropic_key == "sk-ant-a"
    monkeypatch.delenv("ANTHROPIC_KEY")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-b")
    assert Settings(_env_file=None).anthropic_key == "sk-ant-b"


def test_key_never_in_repr_or_status():
    s = claude_settings()
    assert KEY not in repr(s)
    st = s.anthropic_status()
    assert st == {"configured": True, "usable": True, "reason": None}
    assert KEY not in repr(AnthropicProvider(s))


def test_status_without_key_says_not_configured():
    st = make_settings(airgapped=False).anthropic_status()
    assert st["configured"] is False and st["usable"] is False
    assert st["reason"] == "Anthropic key not configured"


def test_airgapped_refuses_anthropic():
    st = make_settings(airgapped=True, anthropic_key=KEY).anthropic_status()
    assert st["usable"] is False and "AIRGAPPED" in st["reason"]


# ----------------------------------------------------------------- shaping
def test_schema_reduced_to_supported_subset():
    schema = {"type": "object", "properties": {
        "name": {"type": "string", "minLength": 2, "maxLength": 60},
        "items": {"type": "array", "minItems": 3, "maxItems": 5, "items": {"type": "string", "pattern": "^a"}},
        "topic": {"type": "string"}},
        "required": ["name", "items"]}
    out = to_anthropic_schema(schema)
    assert out["additionalProperties"] is False
    assert out["required"] == ["name", "items", "topic"]
    assert "minLength" not in out["properties"]["name"]
    assert out["properties"]["items"]["minItems"] == 1 and "maxItems" not in out["properties"]["items"]
    assert out["properties"]["topic"] == {"anyOf": [{"type": "string"}, {"type": "null"}]}
    # The original is untouched, and a null optional is removed again after parsing.
    assert schema["properties"]["name"]["minLength"] == 2
    assert restore_optional({"name": "A", "items": [], "topic": None}, schema) == {"name": "A", "items": []}


def test_free_map_is_not_expressible():
    with pytest.raises(SchemaNotExpressible):
        to_anthropic_schema({"type": "object", "additionalProperties": {"type": "number"}})


def test_split_messages_merges_system_and_alternates():
    system, msgs = split_messages([
        {"role": "system", "content": "A"}, {"role": "system", "content": "B"},
        {"role": "assistant", "content": "hello"}, {"role": "user", "content": "q1"}, {"role": "user", "content": "q2"},
    ])
    assert system == "A\n\nB"
    assert [m["role"] for m in msgs] == ["user", "assistant", "user"]
    assert msgs[-1]["content"] == "q1\n\nq2"


def test_thinking_and_budget_per_family():
    assert thinking_for("claude-sonnet-5-5", "low") == {"type": "between_tools"}
    assert thinking_for("claude-haiku-5-5", "low") == {"type": "disabled"}
    assert thinking_for("claude-opus-5-5", "low") is None          # cannot be disabled
    assert thinking_for("claude-sonnet-5-5", "xhigh") is None
    assert output_budget("claude-haiku-5-5", 200, streaming=False) == 200
    assert output_budget("claude-opus-5-5", 200, streaming=False) == 2248   # room for adaptive thinking
    # A structured reply with thinking off gets headroom (a JSON cut at max_tokens is unusable).
    assert output_budget("claude-sonnet-5-5", 500, streaming=False, structured=True) == 750
    assert output_budget("claude-opus-5-5", 200, streaming=False, structured=True) == 2248


def test_model_per_role_gives_three_judge_voices():
    s = claude_settings()
    judges = {model_for(s, "judge", f"judge:{n}")[0] for n in ("clinical_consistency", "safety_dosing", "pedagogy")}
    assert len(judges) == 3
    assert model_for(s, "casegen", "s1")[0] == "claude-opus-5-5"
    assert model_for(s, "guard")[0] == "claude-haiku-5-5"
    assert model_for(s, "judge", "narrator")[0] == s.anthropic_model_narrator
    assert model_for(s, "casegen", "render:history.presenting")[0] == s.anthropic_model_render
    assert model_for(s, "casegen", "repair") == (s.anthropic_model_repair, "high")


# ----------------------------------------------------------------- pricing
def test_price_table_has_cache_rates():
    row = prices.lookup("anthropic", "claude-opus-5-5")
    assert (row.input_per_m, row.output_per_m, row.cached_input_per_m, row.cache_write_per_m) == (4.0, 20.0, 0.2, 5.0)
    assert prices.lookup("anthropic", "claude-opus-5").input_per_m == 5.0      # not swallowed by 5-5
    # 1000 uncached + 2000 cache read + 500 cache write in, 100 out on Opus 5.5.
    usd = prices.cost_usd("anthropic", "claude-opus-5-5", 3500, 100, cached_tokens=2000, cache_write_tokens=500)
    assert usd == pytest.approx((1000 * 4 + 2000 * 0.2 + 500 * 5 + 100 * 20) / 1e6)
    assert prices.provider_from_url("https://api.anthropic.com") == "anthropic"


def test_haiku_long_prompt_tier():
    short = prices.cost_usd("anthropic", "claude-haiku-5-5", 1000, 1000)
    long = prices.cost_usd("anthropic", "claude-haiku-5-5", 200_000, 1000)
    assert short == pytest.approx((1000 * 0.10 + 1000 * 0.50) / 1e6)
    assert long == pytest.approx((200_000 * 0.50 + 1000 * 2.50) / 1e6)


# ----------------------------------------------------------------- calls
async def test_structured_call_shape_usage_and_telemetry(tmp_path):
    dbl = AnthropicDouble().push(Scripted(text='{"verdict":"pass","issues":[]}', input_tokens=300,
                                          output_tokens=20, cache_read=1800, cache_write=0))
    tel = TelemetryRecorder(str(tmp_path / "t.db"))
    p = AnthropicProvider(claude_settings(), http_client=dbl.client(), telemetry=tel, max_retries=0)
    schema = {"type": "object", "properties": {"verdict": {"enum": ["pass", "fail"]},
                                               "issues": {"type": "array", "items": {"type": "string",
                                                                                     "maxLength": 200}}}}
    reply = await p.complete([{"role": "system", "content": "SYS"}, {"role": "user", "content": "judge"}],
                             model="claude-sonnet-5-5", max_tokens=150, effort="medium", schema=schema)
    body = dbl.calls[0]
    assert body["model"] == "claude-sonnet-5-5"
    assert body["system"] == [{"type": "text", "text": "SYS", "cache_control": {"type": "ephemeral"}}]
    assert body["output_config"]["effort"] == "medium"
    assert body["output_config"]["format"]["type"] == "json_schema"
    assert "maxLength" not in json.dumps(body["output_config"]["format"]["schema"])
    assert body["thinking"] == {"type": "between_tools"}
    assert "temperature" not in body
    assert body.get("fallbacks") == "default"
    assert dbl.headers[0].get("x-api-key") == KEY
    assert json.loads(reply.text)["verdict"] == "pass" and reply.structured
    assert reply.usage.prompt_total == 2100 and reply.usage.cache_read == 1800
    row = tel.recent(1)[0]
    assert row["provider"] == "anthropic" and row["model"] == "claude-sonnet-5-5"
    assert row["tokens_in"] == 2100 and row["cached_tokens"] == 1800 and row["cache_write_tokens"] == 0
    assert row["cost_usd"] == pytest.approx((300 * 2 + 1800 * 0.2 + 20 * 10) / 1e6)
    await p.aclose()


async def test_streaming_passes_accumulated_text():
    dbl = AnthropicDouble().push(Scripted(text='{"opening":{"chief_complaint":"chest pain"}}', cache_write=900))
    p = AnthropicProvider(claude_settings(), http_client=dbl.client(), max_retries=0)
    seen: list[str] = []
    reply = await p.complete([{"role": "user", "content": "S1"}], model="claude-opus-5-5", max_tokens=380,
                             on_text=seen.append, schema={"type": "object", "properties": {
                                 "opening": {"type": "object", "properties": {"chief_complaint": {"type": "string"}}}}})
    assert dbl.calls[0]["stream"] is True
    assert len(seen) >= 2 and seen[-1] == reply.text
    assert reply.usage.cache_write == 900
    await p.aclose()


async def test_refusal_and_outage_raise():
    dbl = AnthropicDouble().push(Scripted(text="", stop_reason="refusal"), Scripted(text="", status=529))
    p = AnthropicProvider(claude_settings(), http_client=dbl.client(), max_retries=0)
    with pytest.raises(AnthropicRefusal):
        await p.complete([{"role": "user", "content": "x"}], model="claude-opus-5-5", max_tokens=50)
    with pytest.raises(AnthropicUnavailable):
        await p.complete([{"role": "user", "content": "x"}], model="claude-opus-5-5", max_tokens=50)
    await p.aclose()


async def test_no_key_raises_unavailable_without_a_request():
    dbl = AnthropicDouble()
    p = AnthropicProvider(make_settings(airgapped=False), http_client=dbl.client())
    with pytest.raises(AnthropicUnavailable, match="Anthropic key not configured"):
        await p.complete([{"role": "user", "content": "x"}], model="claude-opus-5-5", max_tokens=50)
    assert dbl.calls == []


# ----------------------------------------------------------------- StructuredLLM route
async def test_structured_llm_prefers_claude_with_node_models():
    dbl = AnthropicDouble(responder=lambda body: Scripted(text='{"verdict":"pass","issues":[]}'))
    s = claude_settings()
    llm = StructuredLLM(s, anthropic_provider=AnthropicProvider(s, http_client=dbl.client(), max_retries=0))
    schema = {"type": "object", "properties": {"verdict": {"type": "string"}, "issues": {"type": "array",
                                                                                        "items": {"type": "string"}}}}
    for name in ("clinical_consistency", "safety_dosing", "pedagogy"):
        reply = await llm.complete_json([{"role": "user", "content": "judge"}], schema=schema,
                                        schema_name="judge_verdict", role="judge", temperature=0.0, max_tokens=500,
                                        node=f"judge:{name}")
        assert reply.provider == "anthropic" and reply.extras["cost_basis"] == "token_price"
    assert [c["model"] for c in dbl.calls] == list(s.anthropic_judge_models)
    probe = await llm.probe("casegen")
    assert probe["reachable"] and probe["provider"] == "anthropic"
    await llm.aclose()


async def test_structured_llm_falls_back_to_configured_endpoint_when_claude_down(double_transport, scenario):
    dbl = AnthropicDouble().push(Scripted(text="", status=503))
    s = claude_settings()
    llm = StructuredLLM(s, transport=double_transport,
                        anthropic_provider=AnthropicProvider(s, http_client=dbl.client(), max_retries=0))
    from server.orchestration.judges import JUDGE_SCHEMA

    reply = await llm.complete_json([{"role": "system", "content": "ROLE: judge:pedagogy"},
                                     {"role": "user", "content": "x"}], schema=JUDGE_SCHEMA,
                                    schema_name="judge_verdict", role="judge", temperature=0.0, max_tokens=500)
    assert reply.provider != "anthropic" and llm.claude_fallbacks == 1
    await llm.aclose()


async def test_structured_llm_gate_turns_route_off(double_transport):
    dbl = AnthropicDouble()
    s = claude_settings()
    llm = StructuredLLM(s, transport=double_transport, anthropic_gate=lambda: False,
                        anthropic_provider=AnthropicProvider(s, http_client=dbl.client(), max_retries=0))
    assert llm.claude_active() is False
    await llm.aclose()


async def test_structured_llm_refusal_is_invalid_output_not_fallback():
    dbl = AnthropicDouble().push(Scripted(text="", stop_reason="refusal"))
    s = claude_settings()
    llm = StructuredLLM(s, anthropic_provider=AnthropicProvider(s, http_client=dbl.client(), max_retries=0))
    with pytest.raises(ModelOutputInvalid):
        await llm.complete_json([{"role": "user", "content": "x"}], schema={"type": "object", "properties": {
            "a": {"type": "string"}}}, schema_name="x", role="casegen", temperature=0.0, max_tokens=50)
    await llm.aclose()
