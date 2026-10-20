"""Telemetry: versioned prices, per-call rows, summary math, OTel spans, gateway hook."""

from __future__ import annotations

import sqlite3

import httpx
import pytest
import respx

from server.config import Settings
from server.model_gateway import GatewayError, ModelGateway
from server.registry.resolve import RegistryResolver
from server.registry.store import ProviderIn, RegistryStore
from server.telemetry import prices
from server.telemetry.events import TelemetryRecorder, call_context, percentile, summarize


# --------------------------------------------------------------------------- #
# prices                                                                      #
# --------------------------------------------------------------------------- #
def test_price_table_is_versioned_and_sourced():
    assert prices.PRICE_TABLE_VERSION.startswith("2026-")
    assert all(row.source_url.startswith("https://") for row in prices.PRICE_TABLE)
    assert all(row.effective_from <= prices.PRICE_TABLE_VERSION for row in prices.PRICE_TABLE)


def test_cost_for_known_hosted_model_uses_cached_discount():
    # DeepInfra DeepSeek-V3.2: $0.26 in ($0.13 cached) / $0.38 out per 1M (docs/research/16 section 2.2).
    cost = prices.cost_usd("deepinfra", "deepseek-ai/DeepSeek-V3.2", tokens_in=1_000_000, tokens_out=1_000_000,
                           cached_tokens=0)
    assert cost == pytest.approx(0.26 + 0.38)
    cached = prices.cost_usd("deepinfra", "deepseek-ai/DeepSeek-V3.2", tokens_in=1_000_000, tokens_out=0,
                             cached_tokens=1_000_000)
    assert cached == pytest.approx(0.13)


def test_cost_for_local_or_unknown_is_zero_and_flagged():
    assert prices.cost_usd("local", "qwen2.5-7b-instruct", 1000, 1000, 0) == 0.0
    assert prices.cost_usd("gpu_worker", "acudx-llm", 1000, 1000, 0) == 0.0
    assert prices.lookup("deepinfra", "no-such-model") is None
    assert prices.lookup("deepinfra", "Qwen/Qwen3-32B").input_per_m == pytest.approx(0.08)
    assert prices.lookup("groq", "openai/gpt-oss-120b").output_per_m == pytest.approx(0.60)


# --------------------------------------------------------------------------- #
# recorder + summary                                                          #
# --------------------------------------------------------------------------- #
def _rec(tmp_path, clock=None) -> TelemetryRecorder:
    return TelemetryRecorder(str(tmp_path / "acudx.db"), clock=clock)


def test_record_writes_one_row_per_call_with_cost(tmp_path):
    r = _rec(tmp_path, clock=lambda: 1_800_000_000.0)
    row = r.record(kind="llm", provider="deepinfra", model="Qwen/Qwen3-32B", tokens_in=1000, tokens_out=500,
                   cached_tokens=0, latency_ms=321.5, route="/v1/grade", tenant="acme", user_hash="u1",
                   encounter_id="enc-1", ok=True)
    assert row.cost_usd == pytest.approx(1000 / 1e6 * 0.08 + 500 / 1e6 * 0.28)
    assert row.price_version == prices.PRICE_TABLE_VERSION
    with sqlite3.connect(r.db_path) as c:
        got = c.execute("SELECT ts, kind, provider, model, tokens_in, tokens_out, cached_tokens, latency_ms, cost_usd, "
                        "route, tenant, user_hash, encounter_id, ok, error FROM model_calls").fetchall()
    assert got == [(1_800_000_000.0, "llm", "deepinfra", "Qwen/Qwen3-32B", 1000, 500, 0, 321.5, row.cost_usd,
                    "/v1/grade", "acme", "u1", "enc-1", 1, None)]


def test_percentile_math():
    assert percentile([], 50) is None
    assert percentile([10.0], 95) == 10.0
    assert percentile([1, 2, 3, 4], 50) == 2.5
    assert percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95) == pytest.approx(9.55)


def test_summary_counts_cost_latency_error_rate_and_buckets(tmp_path):
    now = 1_800_000_000.0
    t = {"v": now}
    r = _rec(tmp_path, clock=lambda: t["v"])
    # 4 calls over the last 3 hours, one error, two providers, two routes; one call outside the 24h window.
    t["v"] = now - 30 * 3600
    r.record(kind="llm", provider="old", model="m", tokens_in=1, tokens_out=1, latency_ms=5, route="/x", ok=True)
    t["v"] = now - 3 * 3600
    r.record(kind="llm", provider="deepinfra", model="Qwen/Qwen3-32B", tokens_in=1_000_000, tokens_out=0,
             latency_ms=100, route="/v1/patient/turn", ok=True)
    t["v"] = now - 2 * 3600
    r.record(kind="llm", provider="deepinfra", model="Qwen/Qwen3-32B", tokens_in=0, tokens_out=1_000_000,
             latency_ms=300, route="/v1/patient/turn", ok=False, error="GatewayError")
    t["v"] = now - 3600
    r.record(kind="embed", provider="local", model="e", tokens_in=10, tokens_out=0, latency_ms=20, route="/v1/ground",
             ok=True)
    t["v"] = now - 60
    r.record(kind="llm", provider="local", model="qwen", tokens_in=10, tokens_out=10, latency_ms=400, route="/v1/grade",
             ok=True)
    t["v"] = now
    s = summarize(r, "24h", now=now)
    assert s["calls"] == 4 and s["errors"] == 1 and s["error_rate"] == pytest.approx(0.25)
    assert s["cost_usd"] == pytest.approx(0.08 + 0.28)
    assert s["tokens_in"] == 1_000_020 and s["tokens_out"] == 1_000_010
    assert s["latency_ms"]["p50"] == pytest.approx(200.0) and s["latency_ms"]["p95"] == pytest.approx(385.0)
    by_provider = {b["key"]: b for b in s["by_provider"]}
    assert by_provider["deepinfra"]["calls"] == 2 and by_provider["deepinfra"]["cost_usd"] == pytest.approx(0.36)
    assert by_provider["local"]["calls"] == 2 and by_provider["local"]["cost_usd"] == 0.0
    assert {b["key"] for b in s["by_model"]} == {"Qwen/Qwen3-32B", "e", "qwen"}
    by_route = {b["key"]: b for b in s["by_route"]}
    assert by_route["/v1/patient/turn"]["errors"] == 1
    # 24h window -> 24 hourly buckets, oldest first, every bucket present even when empty.
    assert s["bucket_seconds"] == 3600 and len(s["series"]) == 24
    assert sum(b["calls"] for b in s["series"]) == 4
    assert s["series"][-1]["calls"] == 1 and s["series"][-3]["calls"] == 1
    assert s["series"][-4]["cost_usd"] == pytest.approx(0.08)
    assert s["from_ts"] == now - 24 * 3600 and s["to_ts"] == now
    week = summarize(r, "7d", now=now)
    assert week["calls"] == 5 and week["bucket_seconds"] == 86400 and len(week["series"]) == 7
    month = summarize(r, "30d", now=now)
    assert len(month["series"]) == 30
    with pytest.raises(ValueError):
        summarize(r, "1y", now=now)


def test_summary_on_empty_db(tmp_path):
    s = summarize(_rec(tmp_path), "24h")
    assert s["calls"] == 0 and s["cost_usd"] == 0.0 and s["latency_ms"] == {"p50": None, "p95": None}
    assert s["error_rate"] == 0.0 and s["by_provider"] == [] and len(s["series"]) == 24


# --------------------------------------------------------------------------- #
# OpenTelemetry (optional dependency)                                         #
# --------------------------------------------------------------------------- #
def test_otel_span_carries_gen_ai_attributes(tmp_path):
    otel_sdk = pytest.importorskip("opentelemetry.sdk.trace")
    from opentelemetry.sdk.trace.export import SimpleSpanProcessor
    from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

    exporter = InMemorySpanExporter()
    provider = otel_sdk.TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    r = TelemetryRecorder(str(tmp_path / "acudx.db"), tracer_provider=provider)
    r.record(kind="llm", provider="deepinfra", model="Qwen/Qwen3-32B", tokens_in=10, tokens_out=5, cached_tokens=2,
             latency_ms=50.0, route="/v1/grade", tenant="t", user_hash="u", encounter_id="e", ok=True,
             requested_model="qwen3-32b")
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    a = dict(spans[0].attributes)
    assert spans[0].name == "gen_ai.chat deepinfra"
    assert a["gen_ai.system"] == "deepinfra" and a["gen_ai.request.model"] == "qwen3-32b"
    assert a["gen_ai.response.model"] == "Qwen/Qwen3-32B"
    assert a["gen_ai.usage.input_tokens"] == 10 and a["gen_ai.usage.output_tokens"] == 5
    assert a["gen_ai.usage.cached_input_tokens"] == 2
    assert a["acudx.cost_usd"] > 0 and a["acudx.route"] == "/v1/grade" and a["acudx.encounter_id"] == "e"
    assert "api_key" not in a


def test_otel_disabled_when_no_endpoint(tmp_path, monkeypatch):
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_ENDPOINT", raising=False)
    r = TelemetryRecorder(str(tmp_path / "acudx.db"))
    assert r.tracer is None
    r.record(kind="llm", provider="local", model="m", tokens_in=1, tokens_out=1, latency_ms=1, route="/x", ok=True)


# --------------------------------------------------------------------------- #
# gateway hook                                                                #
# --------------------------------------------------------------------------- #
def _settings(tmp_path, **over) -> Settings:
    base = dict(_env_file=None, airgapped=False, admin_token="adm", acudx_db_path=str(tmp_path / "acudx.db"),
                llm_base_url="http://127.0.0.1:3040/v1", llm_model="qwen2.5-7b-instruct",
                embed_url="http://127.0.0.1:8003", rerank_url="http://127.0.0.1:8004", max_retries=0)
    base.update(over)
    return Settings(**base)


@respx.mock
async def test_gateway_chat_resolves_via_registry_and_records_telemetry(tmp_path):
    cfg = _settings(tmp_path)
    store = RegistryStore(cfg.acudx_db_path, secret_key=None)
    store.seed_from_env(cfg)
    env_llm = next(p for p in store.list_providers(kind="llm") if p.name == "env-llm")
    store.update_provider(env_llm.id, {"priority": 50})
    store.create_provider(ProviderIn(kind="llm", name="deepinfra", base_url="https://api.deepinfra.com/v1/openai",
                                     model="Qwen/Qwen3-32B", priority=0, extra={"seeded_from": "env"}))
    telemetry = TelemetryRecorder(cfg.acudx_db_path)
    gw = ModelGateway(cfg, resolver=RegistryResolver(store, cfg), telemetry=telemetry)
    await gw.start()
    route = respx.post("https://api.deepinfra.com/v1/openai/chat/completions").mock(return_value=httpx.Response(200, json={
        "model": "Qwen/Qwen3-32B", "choices": [{"message": {"content": "<think>hm</think>Hello"}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 12, "completion_tokens": 3, "prompt_tokens_details": {"cached_tokens": 4}},
    }))
    with call_context(route="/v1/patient/turn", tenant="acme", user_hash="h1", encounter_id="enc-9"):
        res = await gw.chat([{"role": "user", "content": "hi"}], task="patient")
    assert res.text == "Hello" and res.provider == "deepinfra" and route.called
    rows = telemetry.recent(limit=5)
    assert len(rows) == 1
    row = rows[0]
    assert row["provider"] == "deepinfra" and row["model"] == "Qwen/Qwen3-32B" and row["kind"] == "llm"
    assert row["tokens_in"] == 12 and row["tokens_out"] == 3 and row["cached_tokens"] == 4
    assert row["route"] == "/v1/patient/turn" and row["tenant"] == "acme" and row["user_hash"] == "h1"
    assert row["encounter_id"] == "enc-9" and row["ok"] == 1 and row["cost_usd"] > 0
    await gw.aclose()


@respx.mock
async def test_gateway_records_failure_rows(tmp_path):
    cfg = _settings(tmp_path)
    store = RegistryStore(cfg.acudx_db_path, secret_key=None)
    store.seed_from_env(cfg)
    telemetry = TelemetryRecorder(cfg.acudx_db_path)
    gw = ModelGateway(cfg, resolver=RegistryResolver(store, cfg), telemetry=telemetry)
    await gw.start()
    respx.post("http://127.0.0.1:3040/v1/chat/completions").mock(return_value=httpx.Response(500, text="boom"))
    with pytest.raises(GatewayError):
        await gw.chat([{"role": "user", "content": "hi"}])
    rows = telemetry.recent(limit=5)
    assert len(rows) == 1 and rows[0]["ok"] == 0 and rows[0]["error"] == "GatewayError"
    assert rows[0]["route"] is None
    await gw.aclose()


@respx.mock
async def test_gateway_embed_and_rerank_resolve_and_record(tmp_path):
    cfg = _settings(tmp_path)
    store = RegistryStore(cfg.acudx_db_path, secret_key=None)
    store.seed_from_env(cfg)
    telemetry = TelemetryRecorder(cfg.acudx_db_path)
    gw = ModelGateway(cfg, resolver=RegistryResolver(store, cfg), telemetry=telemetry)
    await gw.start()
    respx.post("http://127.0.0.1:8003/v1/embeddings").mock(return_value=httpx.Response(200, json={
        "data": [{"embedding": [0.1, 0.2]}, {"embedding": [0.3, 0.4]}], "usage": {"prompt_tokens": 7}}))
    respx.post("http://127.0.0.1:8004/v1/rerank").mock(return_value=httpx.Response(200, json={
        "results": [{"index": 1, "relevance_score": 0.9}, {"index": 0, "relevance_score": 0.1}]}))
    vecs = await gw.embed(["a", "b"])
    scores = await gw.rerank("q", ["d0", "d1"])
    assert vecs == [[0.1, 0.2], [0.3, 0.4]] and scores == [0.1, 0.9]
    kinds = sorted(r["kind"] for r in telemetry.recent(limit=5))
    assert kinds == ["embed", "rerank"]
    assert {r["provider"] for r in telemetry.recent(limit=5)} == {"env-embed", "env-rerank"}
    await gw.aclose()


async def test_gateway_without_resolver_keeps_env_behaviour(tmp_path):
    cfg = _settings(tmp_path)
    gw = ModelGateway(cfg)
    ep = await gw.resolve_endpoint("llm")
    assert ep.base_url == "http://127.0.0.1:3040/v1" and ep.model == "qwen2.5-7b-instruct"


async def test_gateway_raises_when_registry_has_no_llm(tmp_path):
    cfg = _settings(tmp_path)
    store = RegistryStore(cfg.acudx_db_path, secret_key=None)   # not seeded: empty registry
    gw = ModelGateway(cfg, resolver=RegistryResolver(store, cfg))
    await gw.start()
    with pytest.raises(GatewayError):
        await gw.chat([{"role": "user", "content": "hi"}])
    await gw.aclose()


async def test_gateway_records_a_row_when_no_provider_resolves(tmp_path):
    """Acceptance 2026-10-20 (docs/review/05, D-07): a call refused in resolution
    (probe-failed local model, GPU worker refused) must still be visible in
    telemetry, otherwise the console reports 0 calls and 0 errors."""
    cfg = _settings(tmp_path)
    store = RegistryStore(cfg.acudx_db_path, secret_key=None)   # not seeded: nothing resolves
    telemetry = TelemetryRecorder(cfg.acudx_db_path)
    gw = ModelGateway(cfg, resolver=RegistryResolver(store, cfg), telemetry=telemetry)
    await gw.start()
    with call_context(route="/v1/patient/turn"):
        with pytest.raises(GatewayError):
            await gw.chat([{"role": "user", "content": "hi"}])
    with pytest.raises(GatewayError):
        await gw.embed(["a"])
    rows = telemetry.recent(limit=5)
    assert sorted(r["kind"] for r in rows) == ["embed", "llm"]
    assert all(r["ok"] == 0 and r["error"] == "no_provider" and r["provider"] == "unresolved" for r in rows)
    assert any(r["route"] == "/v1/patient/turn" for r in rows)
    assert all((r["cost_usd"] or 0) == 0 for r in rows)
    await gw.aclose()
