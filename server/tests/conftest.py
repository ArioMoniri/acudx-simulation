"""
pytest fixtures for the AcuDx gateway.

The app is exercised through FastAPI's TestClient against the REAL `server.app`
module (lifespan included). No model endpoint is needed for /health, /status
or /v1/guard: `ModelGateway.start()` only opens an httpx client, and the scope
guard is deterministic and pure. Specs that need a model reply mock the
upstream HTTP call with `respx`, never the app.
"""

from __future__ import annotations

import os
import sys
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Make `import server.app` work no matter where pytest is launched from.
REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

# Deterministic settings for the whole session: air-gapped, local provider, no
# status disk probe outside the sandbox. Set before `server.config` is imported.
os.environ.setdefault("AIRGAPPED", "1")
os.environ.setdefault("STATUS_DISK_PATH", "/")


@pytest.fixture(scope="session")
def client() -> Iterator[TestClient]:
    from server.app import app  # noqa: PLC0415 — after env is set

    with TestClient(app) as c:
        yield c
