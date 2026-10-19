"""Shared fixtures for the guideline store / verifier / tips tests.

Run from the repository root: ``python -m pytest server/tests -q``.
The ``live`` marker tags the one test that reaches a real NICE page; set
``ACUDX_SKIP_LIVE=1`` to skip it (it also skips itself on a network error).
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from server.guidelines.store import EXPORT_PATH, GuidelineStore


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "live: reaches a real guideline publisher over the network")


@pytest.fixture()
def fresh_store() -> GuidelineStore:
    """An empty in-memory store (no seed, no evidence)."""
    store = GuidelineStore(":memory:")
    yield store
    store.close()


@pytest.fixture()
def seeded_store() -> GuidelineStore:
    """Drafts only: the legacy seed and the open seed migrated, nothing verified."""
    store = GuidelineStore(":memory:")
    store.seed()
    yield store
    store.close()


@pytest.fixture()
def evidence_store() -> GuidelineStore:
    """The committed verification evidence (statements.verified.json) loaded offline."""
    assert Path(EXPORT_PATH).exists(), "server/guidelines/statements.verified.json is missing"
    store = GuidelineStore(":memory:")
    store.import_json(EXPORT_PATH)
    yield store
    store.close()


@pytest.fixture()
def isolated_db(tmp_path, monkeypatch):
    """Point the process-wide store at a temp DB (routes use get_store())."""
    from server.guidelines import store as store_mod

    path = tmp_path / "acudx-test.db"
    monkeypatch.setenv("ACUDX_DB_PATH", str(path))
    store_mod.reset_store()
    yield path
    store_mod.reset_store()


def skip_live() -> bool:
    return os.environ.get("ACUDX_SKIP_LIVE", "") in ("1", "true", "yes")
