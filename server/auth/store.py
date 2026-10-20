"""``user_roles`` table: server-side role grants and the last-seen directory.

Lives in the same SQLite file as the provider registry (``ACUDX_DB_PATH``). A row
is keyed by the IdP ``sub`` and carries the roles an admin granted, the org, and
the email / name last seen in a verified token (so faculty rosters can show a
person, never a bare sub). Claim roles and granted roles are unioned by
:func:`server.auth.deps.current_user`.
"""

from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from typing import Any

from server.auth.roles import normalize_roles


class UserRoleStore:
    def __init__(self, db_path: str):
        self.db_path = db_path
        self._mem: sqlite3.Connection | None = None
        if db_path == ":memory:":
            self._mem = sqlite3.connect(":memory:", isolation_level=None, check_same_thread=False)
            self._mem.row_factory = sqlite3.Row
        else:
            Path(db_path).expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)
        self._conn().executescript(
            """
            CREATE TABLE IF NOT EXISTS user_roles (
                sub TEXT PRIMARY KEY,
                org TEXT,
                roles TEXT NOT NULL DEFAULT '[]',
                email TEXT,
                name TEXT,
                granted_by TEXT,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL,
                last_seen_at REAL
            );
            CREATE INDEX IF NOT EXISTS user_roles_org ON user_roles (org);
            """
        )

    def _conn(self) -> sqlite3.Connection:
        if self._mem is not None:
            return self._mem
        c = sqlite3.connect(self.db_path, isolation_level=None)
        c.row_factory = sqlite3.Row
        return c

    @staticmethod
    def _row(r: sqlite3.Row) -> dict[str, Any]:
        d = dict(r)
        d["roles"] = json.loads(d.get("roles") or "[]")
        return d

    def get(self, sub: str) -> dict[str, Any] | None:
        row = self._conn().execute("SELECT * FROM user_roles WHERE sub = ?", (sub,)).fetchone()
        return self._row(row) if row else None

    def granted_roles(self, sub: str) -> list[str]:
        rec = self.get(sub)
        return rec["roles"] if rec else []

    def set_roles(self, sub: str, roles: list[str], *, org: str | None = None,
                  granted_by: str | None = None) -> dict[str, Any]:
        clean = normalize_roles(roles)
        now = time.time()
        self._conn().execute(
            "INSERT INTO user_roles (sub, org, roles, granted_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(sub) DO UPDATE SET roles = excluded.roles, granted_by = excluded.granted_by, "
            "updated_at = excluded.updated_at, org = COALESCE(excluded.org, user_roles.org)",
            (sub, org, json.dumps(clean), granted_by, now, now),
        )
        rec = self.get(sub)
        assert rec is not None
        return rec

    def touch(self, sub: str, *, org: str | None, email: str | None, name: str | None) -> None:
        """Record the identity last seen in a verified token (directory for rosters)."""
        now = time.time()
        self._conn().execute(
            "INSERT INTO user_roles (sub, org, roles, email, name, created_at, updated_at, last_seen_at) "
            "VALUES (?, ?, '[]', ?, ?, ?, ?, ?) "
            "ON CONFLICT(sub) DO UPDATE SET email = COALESCE(excluded.email, user_roles.email), "
            "name = COALESCE(excluded.name, user_roles.name), org = COALESCE(excluded.org, user_roles.org), "
            "last_seen_at = excluded.last_seen_at",
            (sub, org, email, name, now, now, now),
        )

    def list(self, org: str | None = None) -> list[dict[str, Any]]:
        c = self._conn()
        if org:
            rows = c.execute("SELECT * FROM user_roles WHERE org = ? ORDER BY name, sub", (org,)).fetchall()
        else:
            rows = c.execute("SELECT * FROM user_roles ORDER BY org, name, sub").fetchall()
        return [self._row(r) for r in rows]

    def delete(self, sub: str) -> bool:
        return self._conn().execute("DELETE FROM user_roles WHERE sub = ?", (sub,)).rowcount > 0
