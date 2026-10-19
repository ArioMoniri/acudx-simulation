"""Endpoint resolution: priority order, AIRGAPPED refusal, probe-aware skipping, GPU worker fallback."""

from __future__ import annotations

import dataclasses

import pytest
from cryptography.fernet import Fernet

from server.config import Settings
from server.providers.gpu_worker import AirgappedRefused
from server.registry.resolve import ProviderEndpoint, RegistryResolver
from server.registry.store import ProviderIn, RegistryStore

KEY = Fernet.generate_key().decode()


def _settings(**over) -> Settings:
    base = dict(_env_file=None, airgapped=False, admin_token="adm")
    base.update(over)
    return Settings(**base)


def _store(tmp_path) -> RegistryStore:
    return RegistryStore(str(tmp_path / "acudx.db"), secret_key=KEY)


class FakeWorkerManager:
    """Test double for the GPU worker manager (fixtures live under tests/ only)."""

    def __init__(self, endpoint=None, refuse: Exception | None = None):
        self._endpoint = endpoint
        self._refuse = refuse
        self.ensure_calls = 0
        self.touches = 0

    async def ensure_worker(self):
        self.ensure_calls += 1
        if self._refuse:
            raise self._refuse
        return object()

    def llm_endpoint(self):
        return self._endpoint

    def touch(self):
        self.touches += 1


async def test_resolve_picks_lowest_priority_enabled(tmp_path):
    s = _store(tmp_path)
    s.create_provider(ProviderIn(kind="llm", name="slow", base_url="https://b.example/v1", model="m-b", priority=20,
                                 api_key="kb"))
    s.create_provider(ProviderIn(kind="llm", name="fast", base_url="https://a.example/v1", model="m-a", priority=1,
                                 api_key="ka"))
    s.create_provider(ProviderIn(kind="llm", name="off", base_url="https://c.example/v1", priority=0, enabled=False))
    r = RegistryResolver(s, _settings())
    ep = await r.resolve("llm")
    assert isinstance(ep, ProviderEndpoint)
    assert ep.name == "fast" and ep.base_url == "https://a.example/v1" and ep.model == "m-a" and ep.api_key == "ka"
    assert ep.source == "registry"
    assert [c.name for c in r.candidates("llm")] == ["fast", "slow"]


async def test_resolve_returns_none_when_nothing_enabled(tmp_path):
    s = _store(tmp_path)
    assert await RegistryResolver(s, _settings()).resolve("tts") is None


async def test_airgapped_refuses_hosted_and_keeps_local(tmp_path):
    s = _store(tmp_path)
    s.create_provider(ProviderIn(kind="llm", name="hosted", base_url="https://api.groq.com/openai/v1", priority=0,
                                 api_key="k"))
    s.create_provider(ProviderIn(kind="llm", name="local", base_url="http://127.0.0.1:3040/v1", model="qwen",
                                 priority=5))
    r = RegistryResolver(s, _settings(airgapped=True))
    ep = await r.resolve("llm")
    assert ep is not None and ep.name == "local"
    cands = r.candidates("llm")
    assert [c.name for c in cands] == ["local"]
    assert r.refused("llm")[0].name == "hosted"


async def test_airgapped_allowlist_admits_vpc_host(tmp_path):
    s = _store(tmp_path)
    s.create_provider(ProviderIn(kind="embed", name="vpc", base_url="http://10.2.3.4:8003"))
    s.create_provider(ProviderIn(kind="rerank", name="named", base_url="http://gpu-pool.internal:8004"))
    r = RegistryResolver(s, _settings(airgapped=True, local_allowlist=["gpu-pool.internal"]))
    assert (await r.resolve("embed")).name == "vpc"
    assert (await r.resolve("rerank")).name == "named"


async def test_failed_probe_skips_provider_but_unknown_probe_is_fine(tmp_path):
    s = _store(tmp_path)
    a = s.create_provider(ProviderIn(kind="llm", name="a", base_url="https://a.example/v1", priority=0, api_key="k"))
    s.create_provider(ProviderIn(kind="llm", name="b", base_url="https://b.example/v1", priority=1, api_key="k"))
    s.set_probe_result(a.id, ok=False, latency_ms=None, error="ConnectTimeout")
    assert (await RegistryResolver(s, _settings()).resolve("llm")).name == "b"


async def test_env_seeded_row_without_stored_key_uses_env_key(tmp_path):
    s = RegistryStore(str(tmp_path / "acudx.db"), secret_key=None)   # no secret: seed cannot store keys
    cfg = _settings(llm_api_key="sk-env-local")
    s.seed_from_env(cfg)
    ep = await RegistryResolver(s, cfg).resolve("llm")
    assert ep.name == "env-llm" and ep.api_key == "sk-env-local"


async def test_gpu_worker_fallback_when_no_api_provider(tmp_path):
    s = _store(tmp_path)
    wm = FakeWorkerManager(endpoint={"base_url": "https://1-2-3-4.sslip.io/v1", "api_key": "tok", "model": "acudx-llm"})
    r = RegistryResolver(s, _settings(), worker_manager=wm)
    ep = await r.resolve("llm")
    assert ep.source == "gpu_worker" and ep.base_url == "https://1-2-3-4.sslip.io/v1" and ep.api_key == "tok"
    assert wm.ensure_calls == 1
    r.touch(ep)
    assert wm.touches == 1
    # A non-worker endpoint never touches the worker.
    r.touch(ProviderEndpoint(kind="llm", name="x", base_url="http://127.0.0.1:1/v1", model="m", api_key="", source="registry"))
    assert wm.touches == 1


async def test_gpu_worker_not_used_for_non_llm_and_refusal_yields_none(tmp_path):
    s = _store(tmp_path)
    wm = FakeWorkerManager(refuse=AirgappedRefused("no"))
    r = RegistryResolver(s, _settings(), worker_manager=wm)
    assert await r.resolve("llm") is None and wm.ensure_calls == 1
    assert await r.resolve("tts") is None and wm.ensure_calls == 1


async def test_registry_provider_wins_over_gpu_worker(tmp_path):
    s = _store(tmp_path)
    s.create_provider(ProviderIn(kind="llm", name="api", base_url="https://a.example/v1", api_key="k"))
    wm = FakeWorkerManager(endpoint={"base_url": "https://w/v1", "api_key": "t", "model": "acudx-llm"})
    ep = await RegistryResolver(s, _settings(), worker_manager=wm).resolve("llm")
    assert ep.name == "api" and wm.ensure_calls == 0


def test_provider_endpoint_repr_hides_key():
    ep = ProviderEndpoint(kind="llm", name="x", base_url="https://a/v1", model="m", api_key="super-secret", source="registry")
    assert "super-secret" not in repr(ep) and "super-secret" not in str(ep)
    with pytest.raises(dataclasses.FrozenInstanceError):
        ep.api_key = "mutating"  # frozen
