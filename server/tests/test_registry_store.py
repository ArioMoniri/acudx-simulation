"""Provider registry store: schema, Fernet encryption at rest, public views, env seed."""

from __future__ import annotations

import sqlite3

import pytest
from cryptography.fernet import Fernet

from server.config import Settings
from server.registry.store import (
    PROVIDER_KINDS,
    ProviderIn,
    RegistryStore,
    SecretKeyMissing,
    secret_key_instructions,
)

KEY = Fernet.generate_key().decode()


def _store(tmp_path, secret: str | None = KEY) -> RegistryStore:
    return RegistryStore(str(tmp_path / "acudx.db"), secret_key=secret)


def test_schema_has_providers_and_settings_tables(tmp_path):
    s = _store(tmp_path)
    with sqlite3.connect(s.db_path) as c:
        names = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"providers", "settings"} <= names


def test_kinds_are_the_nine_documented_kinds():
    assert set(PROVIDER_KINDS) == {"llm", "embed", "rerank", "stt", "tts", "avatar",
                                   "imaging", "identity", "telemetry"}


def test_create_encrypts_key_and_round_trips(tmp_path):
    s = _store(tmp_path)
    rec = s.create_provider(ProviderIn(kind="llm", name="deepinfra", base_url="https://api.deepinfra.com/v1/openai",
                                       model="Qwen/Qwen3-32B", api_key="di-secret-key-1234", priority=5))
    with sqlite3.connect(s.db_path) as c:
        raw = c.execute("SELECT api_key_encrypted FROM providers WHERE id = ?", (rec.id,)).fetchone()[0]
    assert raw and "di-secret-key-1234" not in raw
    assert s.decrypt_key(rec) == "di-secret-key-1234"


def test_public_view_never_contains_key_only_has_key_and_last4(tmp_path):
    s = _store(tmp_path)
    rec = s.create_provider(ProviderIn(kind="tts", name="eleven", base_url="https://api.elevenlabs.io",
                                       api_key="xi-abcdef-9876"))
    pub = rec.public()
    assert pub["has_key"] is True and pub["key_last4"] == "9876"
    assert "api_key" not in pub and "api_key_encrypted" not in pub
    assert "xi-abcdef-9876" not in repr(pub)
    none = s.create_provider(ProviderIn(kind="embed", name="local-embed", base_url="http://127.0.0.1:8003")).public()
    assert none["has_key"] is False and none["key_last4"] is None


def test_refuses_to_store_secret_without_secret_key(tmp_path):
    s = _store(tmp_path, secret=None)
    with pytest.raises(SecretKeyMissing):
        s.create_provider(ProviderIn(kind="llm", name="x", base_url="https://api.groq.com/openai/v1", api_key="k"))
    # Rows without a key are still fine.
    rec = s.create_provider(ProviderIn(kind="llm", name="local", base_url="http://127.0.0.1:3040/v1"))
    assert rec.public()["has_key"] is False
    assert "ACUDX_SECRET_KEY" in secret_key_instructions()


def test_update_keeps_key_unless_replaced_and_can_clear(tmp_path):
    s = _store(tmp_path)
    rec = s.create_provider(ProviderIn(kind="stt", name="deepgram", base_url="https://api.deepgram.com",
                                       api_key="dg-1111"))
    upd = s.update_provider(rec.id, {"name": "deepgram-eu", "enabled": False})
    assert upd.name == "deepgram-eu" and upd.enabled is False and s.decrypt_key(upd) == "dg-1111"
    upd2 = s.update_provider(rec.id, {"api_key": "dg-2222"})
    assert s.decrypt_key(upd2) == "dg-2222" and upd2.public()["key_last4"] == "2222"
    upd3 = s.update_provider(rec.id, {"api_key": ""})
    assert s.decrypt_key(upd3) is None and upd3.public()["has_key"] is False
    assert upd3.updated_at >= rec.updated_at


def test_wrong_secret_key_cannot_decrypt(tmp_path):
    s = _store(tmp_path)
    rec = s.create_provider(ProviderIn(kind="llm", name="a", base_url="https://x.example/v1", api_key="k-1"))
    other = RegistryStore(s.db_path, secret_key=Fernet.generate_key().decode())
    assert other.decrypt_key(other.get_provider(rec.id)) is None


def test_list_filter_delete_and_probe_result(tmp_path):
    s = _store(tmp_path)
    a = s.create_provider(ProviderIn(kind="llm", name="a", base_url="http://127.0.0.1:3040/v1", priority=1))
    b = s.create_provider(ProviderIn(kind="embed", name="b", base_url="http://127.0.0.1:8003"))
    assert [p.id for p in s.list_providers(kind="llm")] == [a.id]
    assert len(s.list_providers()) == 2
    s.set_probe_result(a.id, ok=True, latency_ms=12.5)
    got = s.get_provider(a.id)
    assert got.last_probe_ok is True and got.last_probe_latency_ms == 12.5 and got.last_probe_at is not None
    s.set_probe_result(a.id, ok=False, latency_ms=None, error="ConnectError")
    assert s.get_provider(a.id).last_probe_error == "ConnectError"
    assert s.delete_provider(b.id) is True and s.delete_provider(b.id) is False
    assert s.get_provider(b.id) is None


def test_invalid_kind_or_url_rejected():
    with pytest.raises(ValueError):
        ProviderIn(kind="video", name="x", base_url="https://x")
    with pytest.raises(ValueError):
        ProviderIn(kind="llm", name="x", base_url="ftp://x")


def test_settings_json_round_trip(tmp_path):
    s = _store(tmp_path)
    assert s.get_setting("budget") is None
    s.set_setting("budget", {"llm_daily_usd": 10.5, "alerts": ["email"]})
    assert s.get_setting("budget") == {"llm_daily_usd": 10.5, "alerts": ["email"]}
    s.set_setting("budget", {"llm_daily_usd": 3})
    assert s.all_settings() == {"budget": {"llm_daily_usd": 3}}


def test_seed_from_env_is_idempotent_and_orders_by_llm_provider(tmp_path):
    s = _store(tmp_path)
    cfg = Settings(_env_file=None, llm_provider="api", openai_base_url="https://api.deepinfra.com/v1/openai",
                   openai_api_key="di-key-0001", openai_model="Qwen/Qwen3-32B", airgapped=False)
    created = s.seed_from_env(cfg)
    assert created == 4   # local llm, api llm, embed, rerank
    assert s.seed_from_env(cfg) == 0
    llms = s.list_providers(kind="llm")
    by_name = {p.name: p for p in llms}
    assert by_name["env-openai"].priority < by_name["env-llm"].priority
    assert s.decrypt_key(by_name["env-openai"]) == "di-key-0001"
    assert by_name["env-llm"].extra.get("seeded_from") == "env"
    assert {p.kind for p in s.list_providers()} == {"llm", "embed", "rerank"}


def test_new_key_url_or_model_clears_a_stale_probe_result(tmp_path):
    # Production: the boot probe ran before /bootstrap/provision sent the Anthropic key and
    # recorded "key not configured"; the stale failure kept Claude off until the next probe run.
    s = _store(tmp_path)
    rec = s.create_provider(ProviderIn(kind="llm", name="anthropic", base_url="https://api.anthropic.com",
                                       model="claude-opus-5-5"))
    s.set_probe_result(rec.id, ok=False, latency_ms=None, error="Anthropic key not configured")
    s.update_provider(rec.id, {"enabled": True, "priority": 0, "base_url": "https://api.anthropic.com"})
    assert s.get_provider(rec.id).last_probe_ok is False  # nothing that changes the probe's answer
    after = s.update_provider(rec.id, {"api_key": "sk-ant-new-key-1234"})
    assert after.last_probe_ok is None and after.last_probe_error is None and after.last_probe_at is None
    s.set_probe_result(rec.id, ok=False, latency_ms=None, error="404")
    assert s.update_provider(rec.id, {"model": "claude-sonnet-5-5"}).last_probe_ok is None
