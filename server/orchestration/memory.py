"""Per-learner longitudinal memory on a LangGraph ``BaseStore``.

Namespace ``("learner", <learner_id>)`` holds three documents:

* ``conditions_seen``  {"ids": [...recent first...], "by_system": {system: n}}
* ``errors``           {"items": [{"at": ts, "kind": str, "detail": str, "system": str}], "by_system": {system: n}}
* ``calibration``      {"samples": n, "confidence_sum": float, "correct_sum": float}

The store is the SQLite-backed ``langgraph.store.sqlite.SqliteStore`` in
production (same file as the checkpointer, ``ACUDX_DB_PATH``) and the
``InMemoryStore`` in tests. ``sample_condition`` consults it to avoid repeating
conditions and to steer toward the learner's weakest system.
"""

from __future__ import annotations

import os
import sqlite3
import time
from typing import Any, Optional

from langgraph.store.base import BaseStore
from langgraph.store.memory import InMemoryStore

MAX_SEEN = 64
MAX_ERRORS = 200


def _ns(learner_id: str) -> tuple[str, str]:
    return ("learner", str(learner_id))


class LearnerMemory:
    """Thin, deterministic facade over a ``BaseStore`` for one process."""

    def __init__(self, store: BaseStore) -> None:
        self.store = store

    # -- reads --------------------------------------------------------------- #
    def _get(self, learner_id: str, key: str) -> dict[str, Any]:
        item = self.store.get(_ns(learner_id), key)
        return dict(item.value) if item is not None else {}

    def conditions_seen(self, learner_id: str) -> list[str]:
        return list(self._get(learner_id, "conditions_seen").get("ids") or [])

    def errors(self, learner_id: str) -> list[dict[str, Any]]:
        return list(self._get(learner_id, "errors").get("items") or [])

    def calibration(self, learner_id: str) -> dict[str, Any]:
        c = self._get(learner_id, "calibration")
        n = int(c.get("samples") or 0)
        return {
            "samples": n,
            "mean_confidence": (float(c.get("confidence_sum") or 0.0) / n) if n else None,
            "accuracy": (float(c.get("correct_sum") or 0.0) / n) if n else None,
        }

    def weak_systems(self, learner_id: str) -> list[str]:
        """Systems ordered by error rate (errors per case seen), highest first.

        Only systems with at least one recorded error qualify, so a learner with
        a clean record gets no steering (pure random sampling)."""
        seen = self._get(learner_id, "conditions_seen").get("by_system") or {}
        errs = self._get(learner_id, "errors").get("by_system") or {}
        scored: list[tuple[float, str]] = []
        for system, n_err in errs.items():
            n_err = int(n_err or 0)
            if n_err <= 0:
                continue
            rate = n_err / max(1, int(seen.get(system) or 0))
            scored.append((rate, system))
        scored.sort(key=lambda t: (-t[0], t[1]))
        return [s for _, s in scored]

    def profile(self, learner_id: str) -> dict[str, Any]:
        return {
            "learner_id": learner_id,
            "conditions_seen": self.conditions_seen(learner_id),
            "weak_systems": self.weak_systems(learner_id),
            "error_count": len(self.errors(learner_id)),
            "calibration": self.calibration(learner_id),
        }

    # -- writes -------------------------------------------------------------- #
    def record_case(self, learner_id: str, condition_id: str, system: str) -> None:
        doc = self._get(learner_id, "conditions_seen")
        ids = [i for i in (doc.get("ids") or []) if i != condition_id]
        ids.insert(0, condition_id)
        by_system = dict(doc.get("by_system") or {})
        by_system[system] = int(by_system.get(system) or 0) + 1
        self.store.put(_ns(learner_id), "conditions_seen", {"ids": ids[:MAX_SEEN], "by_system": by_system})

    def record_error(self, learner_id: str, kind: str, detail: str, system: str) -> None:
        doc = self._get(learner_id, "errors")
        items = list(doc.get("items") or [])
        items.insert(0, {"at": time.time(), "kind": kind, "detail": detail, "system": system})
        by_system = dict(doc.get("by_system") or {})
        by_system[system] = int(by_system.get(system) or 0) + 1
        self.store.put(_ns(learner_id), "errors", {"items": items[:MAX_ERRORS], "by_system": by_system})

    def record_calibration(self, learner_id: str, confidence: float, correct: bool) -> None:
        doc = self._get(learner_id, "calibration")
        self.store.put(_ns(learner_id), "calibration", {
            "samples": int(doc.get("samples") or 0) + 1,
            "confidence_sum": float(doc.get("confidence_sum") or 0.0) + max(0.0, min(1.0, confidence)),
            "correct_sum": float(doc.get("correct_sum") or 0.0) + (1.0 if correct else 0.0),
        })


def open_sqlite_store(db_path: str) -> BaseStore:
    """A ``SqliteStore`` on ``db_path`` (directory created, tables set up)."""
    from langgraph.store.sqlite import SqliteStore  # local import: optional extra

    directory = os.path.dirname(os.path.abspath(db_path))
    os.makedirs(directory, exist_ok=True)
    # Autocommit mode: SqliteStore issues its own BEGIN/COMMIT per batch.
    conn = sqlite3.connect(db_path, check_same_thread=False, isolation_level=None)
    store = SqliteStore(conn)
    store.setup()
    return store


def memory_store(db_path: Optional[str]) -> BaseStore:
    """SQLite-backed store when a path is given, in-memory otherwise."""
    return open_sqlite_store(db_path) if db_path else InMemoryStore()
