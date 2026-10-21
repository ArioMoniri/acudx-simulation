"""Production model routing: the Claude key sources, the OpenAI-compatible registry route, and the
on-demand GPU worker path (503 model_warming, sign-in required under OIDC)."""

from __future__ import annotations

import json
from types import SimpleNamespace

from cryptography.fernet import Fernet

from server.config import Settings
from server.orchestration.llm import StructuredLLM
from server.providers.anthropic_provider import AnthropicProvider
from server.registry.resolve import RegistryResolver
from server.registry.store import ProviderIn, RegistryStore

FERNET = Fernet.generate_key().decode()


def _store(tmp_path, s: Settings) -> RegistryStore:
    return RegistryStore(s.acudx_db_path, secret_key=FERNET)


def test_env_key_wins_over_the_admin_panel_key(tmp_path):
    s = Settings(_env_file=None, airgapped=False, acudx_db_path=str(tmp_path / "a.db"), acudx_secret_key=FERNET,
                 anthropic_key="sk-ant-env-0000000000")
    store = _store(tmp_path, s)
    row = store.ensure_anthropic_row(s)
    store.update_provider(row.id, {"api_key": "sk-ant-panel-1111111111"})
    resolver = RegistryResolver(store, s)
    assert AnthropicProvider(s, key_source=resolver.anthropic_key)._key() == "sk-ant-env-0000000000"


def test_admin_panel_key_feeds_the_provider_without_env(tmp_path):
    s = Settings(_env_file=None, airgapped=False, acudx_db_path=str(tmp_path / "a.db"), acudx_secret_key=FERNET,
                 anthropic_key=None)
    store = _store(tmp_path, s)
    row = store.ensure_anthropic_row(s)
    resolver = RegistryResolver(store, s)
    prov = AnthropicProvider(s, key_source=resolver.anthropic_key)
    assert prov.status()["configured"] is False
    store.update_provider(row.id, {"api_key": "sk-ant-panel-1111111111"})
    assert prov._key() == "sk-ant-panel-1111111111" and prov.usable()


def test_case_generator_routes_to_an_openai_compatible_row_never_the_anthropic_row(tmp_path):
    s = Settings(_env_file=None, airgapped=False, acudx_db_path=str(tmp_path / "a.db"), acudx_secret_key=FERNET,
                 anthropic_key=None)
    reg = _store(tmp_path, s)
    reg.ensure_anthropic_row(s)  # priority 0, but served by the Claude provider only
    llm = StructuredLLM(s)
    resolver = RegistryResolver(reg, s, worker_manager=None)
    assert llm.route_via_registry(resolver) is False  # only the anthropic row, no worker
    reg.create_provider(ProviderIn(kind="llm", name="vllm-pool", base_url="https://pool.example/v1",
                                   model="qwen3-32b", api_key="tok", priority=5))
    assert llm.route_via_registry(resolver) is True
    ep = llm.endpoint("casegen")
    assert ep.base_url == "https://pool.example/v1" and ep.api_key == "tok"
    assert llm.endpoint("judge").model == "qwen3-32b"


def test_case_generator_routes_to_a_ready_gpu_worker(tmp_path):
    s = Settings(_env_file=None, airgapped=False, acudx_db_path=str(tmp_path / "a.db"))
    reg = RegistryStore(s.acudx_db_path, secret_key=None)

    class WM:
        def llm_endpoint(self):
            return {"base_url": "https://9-9-9-9.sslip.io/v1", "api_key": "tok", "model": "acudx-llm"}

    llm = StructuredLLM(s)
    assert llm.route_via_registry(RegistryResolver(reg, s, worker_manager=WM())) is True
    assert llm.endpoint("casegen").base_url == "https://9-9-9-9.sslip.io/v1"


async def test_preflight_starts_the_gpu_worker_in_the_background_and_answers_model_warming():
    import asyncio  # noqa: PLC0415

    from server.orchestration import routes as R  # noqa: PLC0415

    started = asyncio.Event()

    class LLM:
        def route_via_registry(self, resolver):
            return False

        async def probe(self, role="casegen"):
            return {"reachable": False}

        def endpoint(self, role):
            return SimpleNamespace(base_url="http://127.0.0.1:3040/v1", model="m")

    class WM:
        store = SimpleNamespace(active_worker=lambda: None)

        def _refusal(self):
            return None

        async def ensure_worker(self):
            started.set()

    rt = SimpleNamespace(llm=LLM(), settings=Settings(_env_file=None))
    resp = await R._preflight(rt, SimpleNamespace(worker_manager=WM(), gateway=None))
    assert resp.status_code == 503
    body = json.loads(resp.body)
    assert body["error"] == "model_warming" and body["retryable"] is True
    await asyncio.wait_for(started.wait(), 1.0)


def test_case_start_needs_a_signed_in_user_under_oidc():
    from fastapi import FastAPI  # noqa: PLC0415
    from fastapi.testclient import TestClient  # noqa: PLC0415

    from server.orchestration.routes import router  # noqa: PLC0415

    class Auth:
        mode = "oidc"

        async def authenticate(self, request):
            return None

    app = FastAPI()
    app.state.auth = Auth()
    app.include_router(router)
    c = TestClient(app)
    for path in ("/v2/case/generate/stream", "/v2/case/generate"):
        r = c.post(path, json={"complaint": "fever"})
        assert r.status_code == 401 and r.json()["error"] == "unauthenticated"


def test_voice_tts_and_stt_need_a_signed_in_user_under_oidc():
    from fastapi import FastAPI  # noqa: PLC0415
    from fastapi.testclient import TestClient  # noqa: PLC0415

    from server.voice.routes import router  # noqa: PLC0415

    class Auth:
        mode = "oidc"

        async def authenticate(self, request):
            return None

    app = FastAPI()
    app.state.auth = Auth()
    app.include_router(router)
    c = TestClient(app)
    r = c.post("/v1/voice/tts", json={"text": "hello"})
    assert r.status_code == 401
    r = c.post("/v1/voice/stt", files={"file": ("a.webm", b"x", "audio/webm")})
    assert r.status_code == 401
