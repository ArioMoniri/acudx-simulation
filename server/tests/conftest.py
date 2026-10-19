"""Shared fixtures: real Lambda Cloud response bodies captured from GET calls."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

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
