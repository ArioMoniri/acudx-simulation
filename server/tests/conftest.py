"""Shared fixtures for the orchestration tests (in-process, no network)."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from server.config import Settings  # noqa: E402
from server.orchestration.routes import OrchestrationRuntime  # noqa: E402
from server.tests.openai_double import Scenario, build_double  # noqa: E402


def make_settings(**overrides) -> Settings:
    """Settings that never read .env: local loopback endpoint, AIRGAPPED on."""
    base = dict(
        airgapped=True, llm_provider="local", llm_base_url="http://127.0.0.1:3040/v1",
        llm_model="qwen2.5-7b-instruct", llm_api_key="sk-local", acudx_db_path=":memory:",
        connect_timeout_s=0.5, request_timeout_s=5.0, probe_timeout_s=0.5, max_retries=0,
    )
    base.update(overrides)
    return Settings(_env_file=None, **base)


@pytest.fixture
def scenario() -> Scenario:
    return Scenario()


@pytest.fixture
def double_transport(scenario: Scenario) -> httpx.AsyncBaseTransport:
    return httpx.ASGITransport(app=build_double(scenario))


@pytest.fixture
async def runtime(scenario: Scenario, double_transport):
    rt = await OrchestrationRuntime.create(make_settings(), transport=double_transport, in_memory=True)
    try:
        yield rt
    finally:
        await rt.aclose()


@pytest.fixture
def unreachable_settings() -> Settings:
    # Port 9 (discard) on loopback: nothing listens, so the connect fails fast.
    return make_settings(llm_base_url="http://127.0.0.1:9/v1")


@pytest.fixture
def live_base_url() -> str | None:
    return os.environ.get("CASEGEN_BASE_URL") or None


# ---- Lambda Cloud fixtures (real response bodies captured from GET calls) ----
import json  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures" / "lambda"
REPO_ROOT = Path(__file__).resolve().parents[2]
CLOUD_INIT = REPO_ROOT / "infra" / "gpu-worker" / "cloud-init.yaml"


def load_fixture(name: str) -> dict:
    return json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))


@pytest.fixture
def instance_types_body() -> dict:
    return load_fixture("instance-types")


@pytest.fixture
def instances_body() -> dict:
    return load_fixture("instances")


@pytest.fixture
def ssh_keys_body() -> dict:
    return load_fixture("ssh-keys")


@pytest.fixture
def firewall_rules_body() -> dict:
    return load_fixture("firewall-rules")


@pytest.fixture
def cloud_init_template() -> str:
    return CLOUD_INIT.read_text(encoding="utf-8")
