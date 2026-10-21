"""Anthropic registry rows: native Messages adapter and registry routing of the case generator."""

from __future__ import annotations

import json
from types import SimpleNamespace

import anthropic
import httpx
import pytest

from server.config import Settings
from server.orchestration.llm import StructuredLLM
from server.providers import anthropic_messages as am
from server.registry.resolve import RegistryResolver
from server.registry.store import ProviderIn, RegistryStore
from cryptography.fernet import Fernet


class _Stream:
    def __init__(self, text: str, stop: str = "end_turn"):
        self._text = text
        self._stop = stop

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    @property
    def text_stream(self):
        async def gen():
            for i in range(0, len(self._text), 4):
                yield self._text[i:i + 4]
        return gen()

    async def get_final_message(self):
        return SimpleNamespace(model="claude-opus-5-5", stop_reason=self._stop,
                               content=[SimpleNamespace(type="text", text=self._text)],
                               usage=SimpleNamespace(input_tokens=11, output_tokens=7))


class FakeClient:
    def __init__(self, text: str, *, reject_schema: bool = False, stop: str = "end_turn"):
        self.calls: list[dict] = []
        self._text, self._reject, self._stop = text, reject_schema, stop
        self.messages = SimpleNamespace(stream=self._stream)

    def _stream(self, **params):
        self.calls.append(params)
        if self._reject and "output_config" in params:
            req = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
            raise anthropic.BadRequestError("schema not supported", response=httpx.Response(400, request=req),
                                            body=None)
        return _Stream(self._text, self._stop)


def test_is_anthropic():
    assert am.is_anthropic("https://api.anthropic.com/v1")
    assert not am.is_anthropic("https://1-2-3-4.sslip.io/v1")
    assert not am.is_anthropic("https://api.anthropic.com.evil.example/v1")


async def test_chat_maps_to_openai_shape_with_structured_output():
    c = FakeClient('{"ok": true}')
    seen: list[str] = []
    out = await am.chat(base_url="https://api.anthropic.com/v1", api_key="k", model=None,
                        messages=[{"role": "system", "content": "be terse"}, {"role": "user", "content": "hi"}],
                        max_tokens=100, schema={"type": "object"}, on_text=seen.append, client=c)
    p = c.calls[0]
    assert p["model"] == "claude-opus-5-5" and p["system"] == "be terse"
    assert p["messages"] == [{"role": "user", "content": "hi"}]
    assert p["output_config"] == {"format": {"type": "json_schema", "schema": {"type": "object"}}}
    assert "temperature" not in p
    assert out["choices"][0]["message"]["content"] == '{"ok": true}'
    assert out["usage"] == {"prompt_tokens": 11, "completion_tokens": 7}
    assert seen[-1] == '{"ok": true}'


async def test_schema_rejection_retries_without_output_config():
    c = FakeClient('{"a": 1}', reject_schema=True)
    out = await am.chat(base_url="https://api.anthropic.com", api_key="k", model="claude-opus-5-5",
                        messages=[{"role": "user", "content": "x"}], max_tokens=50, schema={"type": "object"},
                        client=c)
    assert len(c.calls) == 2 and "output_config" not in c.calls[1]
    assert json.loads(out["choices"][0]["message"]["content"]) == {"a": 1}


async def test_refusal_returns_empty_content():
    c = FakeClient("partial", stop="refusal")
    out = await am.chat(base_url="https://api.anthropic.com", api_key="k", model="m",
                        messages=[{"role": "user", "content": "x"}], max_tokens=50, client=c)
    assert out["choices"][0] == {"message": {"role": "assistant", "content": ""}, "finish_reason": "refusal"}


async def test_missing_key_is_refused():
    with pytest.raises(am.AnthropicCallError):
        await am.chat(base_url="https://api.anthropic.com", api_key="", model="m",
                      messages=[{"role": "user", "content": "x"}], max_tokens=5, client=FakeClient("x"))


def test_case_generator_routes_to_the_anthropic_registry_row(tmp_path):
    s = Settings(_env_file=None, airgapped=False, acudx_db_path=str(tmp_path / "a.db"),
                 acudx_secret_key=Fernet.generate_key().decode())
    reg = RegistryStore(s.acudx_db_path, secret_key=s.acudx_secret_key)
    llm = StructuredLLM(s)
    resolver = RegistryResolver(reg, s, worker_manager=None)
    assert llm.route_via_registry(resolver) is False  # nothing in the registry, no worker
    reg.create_provider(ProviderIn(kind="llm", name="anthropic", base_url="https://api.anthropic.com/v1",
                                   model="claude-opus-5-5", api_key="sk-ant-test-key"))
    assert llm.route_via_registry(resolver) is True
    ep = llm.endpoint("casegen")
    assert ep.base_url == "https://api.anthropic.com/v1" and ep.api_key == "sk-ant-test-key"
    assert llm.endpoint("judge").model == "claude-opus-5-5"


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
