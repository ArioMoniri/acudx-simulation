"""The Claude route in the registry, the admin console and the model gateway.

Without ANTHROPIC_KEY the console says "Anthropic key not configured" and calls go to the
next configured provider; with a key, Claude serves the persona and JSON guard calls."""

from __future__ import annotations

import httpx
import pytest
import respx
from cryptography.fernet import Fernet
from fastapi import FastAPI
from fastapi.testclient import TestClient

from server.config import Settings
from server.model_gateway import GatewayError, ModelGateway
from server.providers.anthropic_provider import AnthropicProvider
from server.registry.resolve import RegistryResolver
from server.registry.routes import router as registry_router
from server.registry.store import ProviderIn, RegistryStore, is_anthropic
from server.telemetry.events import TelemetryRecorder
from server.tests.anthropic_double import AnthropicDouble, Scripted

FERNET = Fernet.generate_key().decode()
HDR = {"X-Admin-Token": "adm"}
ANT = "sk-ant-route-test-1234"


def _settings(tmp_path, **kw) -> Settings:
    base = dict(airgapped=False, admin_token="adm", acudx_db_path=str(tmp_path / "a.db"), acudx_secret_key=FERNET,
                llm_base_url="http://127.0.0.1:3040/v1", llm_model="qwen2.5-7b-instruct", max_retries=0,
                _env_file=None)
    base.update(kw)
    return Settings(**base)


def _app(s: Settings) -> tuple[FastAPI, RegistryStore]:
    store = RegistryStore(s.acudx_db_path, secret_key=s.acudx_secret_key)
    store.seed_from_env(s)
    store.ensure_anthropic_row(s)
    app = FastAPI()
    app.state.settings = s
    app.state.registry = store
    app.state.telemetry = TelemetryRecorder(s.acudx_db_path)
    app.include_router(registry_router)
    return app, store


def test_anthropic_row_is_seeded_once_at_priority_zero(tmp_path):
    s = _settings(tmp_path)
    store = RegistryStore(s.acudx_db_path, secret_key=FERNET)
    store.seed_from_env(s)
    a = store.ensure_anthropic_row(s)
    b = store.ensure_anthropic_row(s)
    assert a.id == b.id and is_anthropic(a) and a.priority == 0 and a.api_key_encrypted is None
    assert len([r for r in store.list_providers("llm") if is_anthropic(r)]) == 1


def test_resolver_keeps_anthropic_out_of_openai_candidates_and_respects_switch(tmp_path):
    s = _settings(tmp_path, anthropic_key=ANT)
    store = RegistryStore(s.acudx_db_path, secret_key=FERNET)
    store.seed_from_env(s)
    row = store.ensure_anthropic_row(s)
    r = RegistryResolver(store, s)
    assert all(not is_anthropic(c) for c in r.candidates("llm"))
    assert r.anthropic_enabled() is True
    store.update_provider(row.id, {"enabled": False})
    assert r.anthropic_enabled() is False
    store.update_provider(row.id, {"enabled": True, "priority": 50})
    assert r.anthropic_enabled() is False          # env-llm at priority 0 now outranks Claude
    store.update_provider(row.id, {"priority": 0, "api_key": "sk-ant-sealed-9999"})
    assert r.anthropic_key() == "sk-ant-sealed-9999"


def test_admin_shows_key_not_configured_and_never_the_key(tmp_path):
    app, _ = _app(_settings(tmp_path))
    c = TestClient(app, headers=HDR)
    body = c.get("/admin/providers").json()
    assert body["anthropic"]["configured"] is False
    assert body["anthropic"]["reason"] == "Anthropic key not configured"
    row = next(p for p in body["providers"] if p.get("api") == "anthropic")
    assert row["status_note"] == "Anthropic key not configured" and row["has_key"] is False
    health = c.get("/admin/health").json()
    assert health["anthropic"]["usable"] is False
    # Probing without a key dials nothing and says why.
    pr = c.post(f"/admin/providers/{row['id']}/probe").json()
    assert pr["ok"] is False and pr["error"] == "Anthropic key not configured"


def test_admin_with_env_key(tmp_path):
    app, _ = _app(_settings(tmp_path, anthropic_key=ANT))
    c = TestClient(app, headers=HDR)
    body = c.get("/admin/providers").json()
    assert body["anthropic"] == {**body["anthropic"], "configured": True, "usable": True, "reason": None,
                                 "key_source": "env"}
    assert ANT not in str(body) and ANT not in c.get("/admin/health").text
    row = next(p for p in body["providers"] if p.get("api") == "anthropic")
    with respx.mock(assert_all_called=True) as m:
        route = m.get("https://api.anthropic.com/v1/models").mock(
            return_value=httpx.Response(200, json={"data": [{"id": "claude-opus-5-5"}]}))
        pr = c.post(f"/admin/providers/{row['id']}/probe").json()
    assert pr["ok"] is True and pr["models"] == ["claude-opus-5-5"]
    sent = route.calls[0].request.headers
    assert sent["x-api-key"] == ANT and sent["anthropic-version"] == "2023-06-01"


def test_airgapped_admin_reason(tmp_path):
    app, _ = _app(_settings(tmp_path, anthropic_key=ANT, airgapped=True))
    body = TestClient(app, headers=HDR).get("/admin/providers").json()
    assert body["anthropic"]["usable"] is False and "AIRGAPPED" in body["anthropic"]["reason"]


# ----------------------------------------------------------------- gateway
def _gateway(tmp_path, *, key: str | None, dbl: AnthropicDouble) -> tuple[ModelGateway, RegistryStore]:
    s = _settings(tmp_path, anthropic_key=key)
    store = RegistryStore(s.acudx_db_path, secret_key=FERNET)
    store.seed_from_env(s)
    store.ensure_anthropic_row(s)
    resolver = RegistryResolver(store, s)
    tel = TelemetryRecorder(s.acudx_db_path)
    prov = AnthropicProvider(s, key_source=resolver.anthropic_key, http_client=dbl.client(), telemetry=tel,
                             max_retries=0)
    return ModelGateway(s, resolver=resolver, telemetry=tel, anthropic=prov), store


async def test_gateway_persona_goes_to_claude_with_cache_tail(tmp_path):
    dbl = AnthropicDouble().push(Scripted(text="It started this morning, doctor.", cache_read=1500))
    gw, _ = _gateway(tmp_path, key=ANT, dbl=dbl)
    await gw.start()
    res = await gw.chat([{"role": "system", "content": "You are the patient."},
                         {"role": "user", "content": "Is it worse?"}, {"role": "assistant", "content": "Yes."},
                         {"role": "user", "content": "When did it start?"}], task="patient")
    await gw.aclose()
    assert res.provider == "anthropic" and res.text == "It started this morning, doctor."
    body = dbl.calls[0]
    assert body["model"] == "claude-opus-5-5"
    # The transcript breakpoint sits on the last stable turn, never on the volatile tail.
    assert "cache_control" not in body
    assert body["messages"][-2]["content"] == [{"type": "text", "text": "Yes.",
                                                "cache_control": {"type": "ephemeral"}}]
    assert body["messages"][-1]["content"] == "When did it start?"
    assert res.usage["cache_read_input_tokens"] == 1500


async def test_gateway_chat_json_structured(tmp_path):
    dbl = AnthropicDouble().push(Scripted(text='{"label":"clinical","intent":null}'))
    gw, _ = _gateway(tmp_path, key=ANT, dbl=dbl)
    await gw.start()
    data, res = await gw.chat_json([{"role": "user", "content": "x"}], schema={"type": "object", "properties": {
        "label": {"type": "string"}, "intent": {"type": "string"}}, "required": ["label"]},
        schema_name="guard", task="guard")
    await gw.aclose()
    assert data == {"label": "clinical"}          # the nullable stand-in for an optional key is removed
    assert dbl.calls[0]["model"] == "claude-haiku-5-5" and res.provider == "anthropic"


@respx.mock
async def test_gateway_without_key_uses_next_provider_never_fake(tmp_path):
    dbl = AnthropicDouble()
    gw, _ = _gateway(tmp_path, key=None, dbl=dbl)
    respx.post("http://127.0.0.1:3040/v1/chat/completions").mock(return_value=httpx.Response(200, json={
        "model": "qwen2.5-7b-instruct", "choices": [{"message": {"content": "Since this morning."},
                                                     "finish_reason": "stop"}]}))
    await gw.start()
    res = await gw.chat([{"role": "user", "content": "When?"}], task="patient")
    assert res.provider == "env-llm" and dbl.calls == []
    assert gw.anthropic_status() == {"configured": False, "usable": False, "reason": "Anthropic key not configured",
                                     "selected": False}
    await gw.aclose()


@respx.mock
async def test_gateway_claude_outage_falls_through_and_records(tmp_path):
    dbl = AnthropicDouble().push(Scripted(text="", status=503))
    gw, _ = _gateway(tmp_path, key=ANT, dbl=dbl)
    respx.post("http://127.0.0.1:3040/v1/chat/completions").mock(return_value=httpx.Response(503))
    await gw.start()
    with pytest.raises(GatewayError):
        await gw.chat([{"role": "user", "content": "When?"}], task="patient")
    await gw.aclose()
    rows = gw.telemetry.recent(5)
    assert {r["provider"] for r in rows} >= {"anthropic", "env-llm"}
    assert all(r["ok"] == 0 for r in rows) and gw.claude_fallbacks == 1
