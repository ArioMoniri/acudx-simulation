"""A Claude hiccup never boots a GPU worker: a configured Claude row survives a failed probe, a failed
Claude call falls back only to a provider or a worker that is already up, and the voice agent's config
reads a worker without launching one."""

from __future__ import annotations

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from server.model_gateway import GatewayError, ModelGateway
from server.providers.anthropic_provider import AnthropicProvider
from server.registry.resolve import ANTHROPIC_PROBE_FAILURES_TO_DISABLE, RegistryResolver
from server.registry.store import RegistryStore
from server.telemetry.events import TelemetryRecorder
from server.tests.anthropic_double import AnthropicDouble, Scripted
from server.tests.test_anthropic_route import ANT, FERNET, _settings
from server.tests.test_voice_routes import HDR
from server.tests.test_voice_routes import _app as _voice_app
from server.tests.test_voice_service import FakeWorkerManager


def _store_with_claude_only(tmp_path, **kw):
    """The production shape: the Claude row and nothing else for LLM (the GPU worker is the fallback)."""
    s = _settings(tmp_path, **kw)
    store = RegistryStore(s.acudx_db_path, secret_key=FERNET)
    row = store.ensure_anthropic_row(s)
    return s, store, row


def _gateway(tmp_path, *, dbl: AnthropicDouble, worker: FakeWorkerManager, key: str | None = ANT):
    s, store, row = _store_with_claude_only(tmp_path, anthropic_key=key)
    resolver = RegistryResolver(store, s, worker_manager=worker)
    tel = TelemetryRecorder(s.acudx_db_path)
    prov = AnthropicProvider(s, key_source=resolver.anthropic_key, http_client=dbl.client(), telemetry=tel,
                             max_retries=0)
    return ModelGateway(s, resolver=resolver, telemetry=tel, anthropic=prov), store, row


# --- a single failed probe does not take a keyed Claude row off the route ---- #

def test_one_failed_probe_keeps_a_keyed_claude_row_selected(tmp_path):
    s, store, row = _store_with_claude_only(tmp_path, anthropic_key=ANT)
    r = RegistryResolver(store, s)
    for n in range(1, ANTHROPIC_PROBE_FAILURES_TO_DISABLE):
        store.set_probe_result(row.id, ok=False, latency_ms=None, error="HTTP 529")
        assert store.get_provider(row.id).probe_failures == n
        assert r.anthropic_enabled() is True, f"{n} failed probe(s) is a hiccup"
    store.set_probe_result(row.id, ok=False, latency_ms=None, error="HTTP 529")
    assert r.anthropic_enabled() is False, "three in a row: the route is down"
    store.set_probe_result(row.id, ok=True, latency_ms=120.0)
    assert store.get_provider(row.id).probe_failures == 0 and r.anthropic_enabled() is True


def test_a_sealed_key_counts_as_configured_too(tmp_path):
    s, store, row = _store_with_claude_only(tmp_path)
    store.update_provider(row.id, {"api_key": "sk-ant-sealed-0001"})
    store.set_probe_result(row.id, ok=False, latency_ms=None, error="timeout")
    assert RegistryResolver(store, s).anthropic_enabled() is True


def test_without_a_key_a_failed_probe_still_disables_and_a_new_key_clears_it(tmp_path):
    # The 88e2f03 fix stays: "key not configured" from the boot probe is cleared by a new key.
    s, store, row = _store_with_claude_only(tmp_path)
    r = RegistryResolver(store, s)
    store.set_probe_result(row.id, ok=False, latency_ms=None, error="Anthropic key not configured")
    assert r.anthropic_enabled() is False
    after = store.update_provider(row.id, {"api_key": "sk-ant-new-key-1234"})
    assert after.last_probe_ok is None and after.probe_failures == 0
    assert r.anthropic_enabled() is True


def test_probe_failures_column_is_added_to_an_existing_database(tmp_path):
    import sqlite3

    db = tmp_path / "old.db"
    with sqlite3.connect(db) as c:
        c.execute("CREATE TABLE providers (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, name TEXT NOT NULL, "
                  "base_url TEXT NOT NULL, model TEXT, api_key_encrypted TEXT, key_last4 TEXT, region TEXT, "
                  "enabled INTEGER NOT NULL DEFAULT 1, priority INTEGER NOT NULL DEFAULT 100, "
                  "extra TEXT NOT NULL DEFAULT '{}', created_at REAL NOT NULL, updated_at REAL NOT NULL, "
                  "last_probe_at REAL, last_probe_ok INTEGER, last_probe_latency_ms REAL, last_probe_error TEXT)")
        c.execute("INSERT INTO providers (kind, name, base_url, created_at, updated_at) "
                  "VALUES ('llm', 'x', 'http://127.0.0.1:1/v1', 0, 0)")
    store = RegistryStore(str(db), secret_key=FERNET)
    assert store.list_providers()[0].probe_failures == 0


# --- a failed Claude call never launches a worker -------------------------- #

async def test_claude_outage_without_a_ready_worker_surfaces_the_error_and_launches_nothing(tmp_path):
    worker = FakeWorkerManager(ready=False)
    dbl = AnthropicDouble().push(Scripted(text="", status=529)).push(Scripted(text="", status=529))
    gw, _, _ = _gateway(tmp_path, dbl=dbl, worker=worker)
    await gw.start()
    try:
        with pytest.raises(GatewayError, match="Claude did not answer"):
            await gw.chat([{"role": "user", "content": "When?"}], task="patient")
        with pytest.raises(GatewayError, match="never launches a GPU worker"):
            await gw.chat_json([{"role": "user", "content": "x"}], schema={"type": "object"}, schema_name="g",
                               task="guard")
    finally:
        await gw.aclose()
    assert worker.ensure_calls == 0
    assert gw.claude_fallbacks == 2


@respx.mock
async def test_claude_outage_uses_a_worker_that_is_already_ready(tmp_path):
    worker = FakeWorkerManager(ready=True)
    gw, _, _ = _gateway(tmp_path, dbl=AnthropicDouble().push(Scripted(text="", status=503)), worker=worker)
    respx.post("http://worker.test/v1/chat/completions").mock(return_value=httpx.Response(200, json={
        "model": "acudx-llm", "choices": [{"message": {"content": "Since this morning."}, "finish_reason": "stop"}]}))
    await gw.start()
    try:
        res = await gw.chat([{"role": "user", "content": "When?"}], task="patient")
    finally:
        await gw.aclose()
    assert res.text == "Since this morning." and worker.ensure_calls == 0


@respx.mock
async def test_without_claude_the_worker_is_still_launched_on_demand(tmp_path):
    worker = FakeWorkerManager(ready=False)
    gw, _, _ = _gateway(tmp_path, dbl=AnthropicDouble(), worker=worker, key=None)
    respx.post("http://worker.test/v1/chat/completions").mock(return_value=httpx.Response(200, json={
        "model": "acudx-llm", "choices": [{"message": {"content": "Yes."}, "finish_reason": "stop"}]}))
    await gw.start()
    try:
        res = await gw.chat([{"role": "user", "content": "Hurts?"}], task="patient")
    finally:
        await gw.aclose()
    assert res.text == "Yes." and worker.ensure_calls == 1


# --- GET /admin/voice/agent-config never launches -------------------------- #

def test_agent_config_never_launches_a_worker(tmp_path):
    worker = FakeWorkerManager(ready=False)
    app, _, _ = _voice_app(tmp_path, worker=worker)
    r = TestClient(app).get("/admin/voice/agent-config", headers=HDR)
    assert r.status_code == 200
    assert r.json()["tts"] is None and r.json()["stt"] is None
    assert worker.ensure_calls == 0
