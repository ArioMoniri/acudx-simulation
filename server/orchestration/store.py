"""Server-authoritative case state, keyed by ``thread_id`` (review 06a, section 4.5).

One learner request creates one thread. Everything the learner can see about that
case (the opening, every layer, the Clinical Director state, the event log the SSE
stream replays) lives here, in SQLite at ``ACUDX_DB_PATH``. Every learner read goes
through :class:`CaseStore`; no route accepts a client-held case as the truth.

Interface (stable, other modules bind to it):

``get(thread_id) -> dict | None``
    The whole state document, or None.
``put(thread_id, state)``
    Replace the state document. ``state["owner"]`` and ``state["source"]`` are
    indexed for the learner's history list.
``update(thread_id, mutator) -> dict | None``
    Atomic read-modify-write: ``mutator(state)`` runs synchronously under the store
    lock and its (mutated) state is written back. Use it from coroutines so two
    tasks that patch the same thread never lose each other's write.
``append_event(thread_id, event, data) -> int``
    Add one SSE event to the thread log; returns its monotonically increasing id.
``events(thread_id, after=0) -> list[(id, event, data)]``
    The log after ``after`` (reconnect: ``GET /v2/case/{thread_id}/events?after=``).
``list_for_owner(owner, limit) -> list[dict]``
    The learner's own generated encounters (Cases page history), newest first.

State document keys written by the staged generator (``staged.py``)::

    thread_id, owner, source ("model"), request, condition, kernel, opening,
    layers {name: {status, data, attempts, seen, error}}, layer_order [...],
    spec (assembled GeneratedCaseSpec shape), director (CaseState dump or None),
    status ("opening" | "playable" | "complete" | "failed"), created_at, updated_at,
    timings {t_first_text_ms, t_opening_ms, ...}

The Clinical Director owns ``state["director"]``: ``director_step`` reads it, steps
it and writes it back with :meth:`update`.

Education only. Synthetic patients.
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from typing import Any, Callable, Optional

_SCHEMA = """
CREATE TABLE IF NOT EXISTS case_threads (
    thread_id  TEXT PRIMARY KEY,
    owner      TEXT,
    source     TEXT NOT NULL,
    status     TEXT,
    state_json TEXT NOT NULL,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS case_threads_owner ON case_threads(owner, created_at);
CREATE TABLE IF NOT EXISTS case_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id  TEXT NOT NULL,
    event      TEXT NOT NULL,
    data_json  TEXT NOT NULL,
    ts         REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS case_events_thread ON case_events(thread_id, id);
"""


class CaseSourceError(ValueError):
    """Raised when a state that did not come from the model pipeline is written."""


class CaseStore:
    """SQLite-backed, thread-safe store of live case threads."""

    def __init__(self, path: Optional[str] = None) -> None:
        self.path = path if path and path != ":memory:" else None
        if self.path:
            os.makedirs(os.path.dirname(os.path.abspath(self.path)) or ".", exist_ok=True)
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(self.path or ":memory:", check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        if self.path:
            self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.executescript(_SCHEMA)

    # ------------------------------------------------------------------ state
    def get(self, thread_id: str) -> Optional[dict[str, Any]]:
        with self._lock:
            row = self._conn.execute(
                "SELECT state_json FROM case_threads WHERE thread_id = ?", (thread_id,)).fetchone()
        return json.loads(row["state_json"]) if row else None

    def put(self, thread_id: str, state: dict[str, Any]) -> None:
        source = str(state.get("source") or "")
        if source != "model":
            # Provenance rule (owner decision): only model-generated cases are stored as learner cases.
            raise CaseSourceError(f"case thread {thread_id!r} has source {source!r}, not 'model'")
        now = time.time()
        state = dict(state)
        state["thread_id"] = thread_id
        state.setdefault("created_at", now)
        state["updated_at"] = now
        blob = json.dumps(state, ensure_ascii=False, separators=(",", ":"))
        with self._lock:
            self._conn.execute(
                "INSERT INTO case_threads(thread_id, owner, source, status, state_json, created_at, updated_at) "
                "VALUES(?,?,?,?,?,?,?) ON CONFLICT(thread_id) DO UPDATE SET owner=excluded.owner, "
                "source=excluded.source, status=excluded.status, state_json=excluded.state_json, "
                "updated_at=excluded.updated_at",
                (thread_id, state.get("owner"), source, state.get("status"), blob,
                 float(state["created_at"]), now),
            )

    def update(self, thread_id: str, mutator: Callable[[dict[str, Any]], Any]) -> Optional[dict[str, Any]]:
        with self._lock:
            state = self.get(thread_id)
            if state is None:
                return None
            out = mutator(state)
            if isinstance(out, dict):
                state = out
            self.put(thread_id, state)
            return state

    def delete(self, thread_id: str) -> None:
        with self._lock:
            self._conn.execute("DELETE FROM case_threads WHERE thread_id = ?", (thread_id,))
            self._conn.execute("DELETE FROM case_events WHERE thread_id = ?", (thread_id,))

    # ----------------------------------------------------------------- events
    def append_event(self, thread_id: str, event: str, data: dict[str, Any]) -> int:
        blob = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        with self._lock:
            cur = self._conn.execute(
                "INSERT INTO case_events(thread_id, event, data_json, ts) VALUES(?,?,?,?)",
                (thread_id, event, blob, time.time()))
            return int(cur.lastrowid or 0)

    def events(self, thread_id: str, after: int = 0) -> list[tuple[int, str, dict[str, Any]]]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT id, event, data_json FROM case_events WHERE thread_id = ? AND id > ? ORDER BY id",
                (thread_id, int(after or 0))).fetchall()
        return [(int(r["id"]), str(r["event"]), json.loads(r["data_json"])) for r in rows]

    # ---------------------------------------------------------------- history
    def list_for_owner(self, owner: str, limit: int = 50) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT state_json FROM case_threads WHERE owner = ? ORDER BY created_at DESC LIMIT ?",
                (owner, max(1, min(int(limit), 200)))).fetchall()
        out: list[dict[str, Any]] = []
        for r in rows:
            s = json.loads(r["state_json"])
            spec = s.get("spec") or {}
            demo = spec.get("demographics") or {}
            out.append({
                "thread_id": s.get("thread_id"),
                "source": s.get("source"),
                "status": s.get("status"),
                "created_at": s.get("created_at"),
                "locale": (s.get("request") or {}).get("locale"),
                "complaint": spec.get("chief_complaint_en") or "",
                "age": demo.get("age"),
                "sex": demo.get("sex"),
                "acuity_esi": spec.get("acuity_esi"),
                "difficulty": spec.get("difficulty"),
                "committed": bool((s.get("outcome") or {}).get("diagnosis")),
            })
        return out

    def close(self) -> None:
        with self._lock:
            self._conn.close()


__all__ = ["CaseSourceError", "CaseStore"]
