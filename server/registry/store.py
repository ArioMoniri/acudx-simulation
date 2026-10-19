"""Provider registry store (SQLite, ``ACUDX_DB_PATH``).

Tables
------
``providers``  one row per configured external dependency. ``api_key_encrypted``
               holds a Fernet token (``cryptography``) sealed with
               ``ACUDX_SECRET_KEY``; ``key_last4`` is the only plaintext trace of
               a secret and exists so the admin UI can show "ends in 1234".
``settings``   free-form ``key -> JSON value`` operator settings (budgets,
               locale, retention, ...).

Invariants
----------
* A secret is never stored unencrypted. Without ``ACUDX_SECRET_KEY`` the store
  refuses to persist a key (:class:`SecretKeyMissing`) rather than fall back to
  plaintext.
* :meth:`ProviderRecord.public` is the ONLY shape that leaves the process: it
  carries ``has_key`` and ``key_last4`` and never the key or its ciphertext.
* The env-based configuration (``LLM_*`` / ``OPENAI_*`` / ``EMBED_URL`` /
  ``RERANK_URL``) is imported once as seed rows (:meth:`RegistryStore.seed_from_env`)
  so an existing deployment keeps working with an empty admin panel.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import time
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlparse

from cryptography.fernet import Fernet, InvalidToken
from pydantic import BaseModel, Field, field_validator

from server.config import Settings

log = logging.getLogger("acudx.registry")

ProviderKind = Literal["llm", "embed", "rerank", "stt", "tts", "avatar", "imaging", "identity", "telemetry"]
PROVIDER_KINDS: tuple[str, ...] = ("llm", "embed", "rerank", "stt", "tts", "avatar", "imaging", "identity", "telemetry")

_ALLOWED_SCHEMES = {"http", "https"}


class SecretKeyMissing(RuntimeError):
    """``ACUDX_SECRET_KEY`` is unset, so a provider secret cannot be sealed."""


def secret_key_instructions() -> str:
    """Operator-facing text explaining how to enable secret storage."""
    return (
        "ACUDX_SECRET_KEY is not set, so provider API keys cannot be stored. Generate one with "
        "`python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\"`, "
        "put it in the server environment as ACUDX_SECRET_KEY (keep it out of git), and restart the gateway. "
        "Providers without a key (local llama-server, in-VPC side-cars) can be saved without it."
    )


def _validate_base_url(url: str) -> str:
    u = url.strip()
    parsed = urlparse(u)
    if parsed.scheme not in _ALLOWED_SCHEMES or not parsed.netloc:
        raise ValueError("base_url must be an http(s) URL with a host")
    return u.rstrip("/")


class ProviderIn(BaseModel):
    """Create payload. ``api_key`` is write-only: it is sealed and never echoed."""

    kind: ProviderKind
    name: str = Field(min_length=1, max_length=120)
    base_url: str
    model: str | None = None
    api_key: str | None = None
    region: str | None = None
    enabled: bool = True
    priority: int = Field(default=100, ge=0, le=10_000)
    extra: dict[str, Any] = Field(default_factory=dict)

    @field_validator("base_url")
    @classmethod
    def _url(cls, v: str) -> str:
        return _validate_base_url(v)


class ProviderPatch(BaseModel):
    """Update payload: every field optional. ``api_key=""`` clears the stored key."""

    name: str | None = Field(default=None, min_length=1, max_length=120)
    base_url: str | None = None
    model: str | None = None
    api_key: str | None = None
    region: str | None = None
    enabled: bool | None = None
    priority: int | None = Field(default=None, ge=0, le=10_000)
    extra: dict[str, Any] | None = None

    @field_validator("base_url")
    @classmethod
    def _url(cls, v: str | None) -> str | None:
        return _validate_base_url(v) if v is not None else None


class ProviderRecord(BaseModel):
    id: int
    kind: str
    name: str
    base_url: str
    model: str | None = None
    api_key_encrypted: str | None = None
    key_last4: str | None = None
    region: str | None = None
    enabled: bool = True
    priority: int = 100
    extra: dict[str, Any] = Field(default_factory=dict)
    created_at: float
    updated_at: float
    last_probe_at: float | None = None
    last_probe_ok: bool | None = None
    last_probe_latency_ms: float | None = None
    last_probe_error: str | None = None

    def public(self) -> dict[str, Any]:
        """Wire shape for the admin API: never the key, never the ciphertext."""
        d = self.model_dump(exclude={"api_key_encrypted", "key_last4"})
        d["has_key"] = bool(self.api_key_encrypted)
        d["key_last4"] = self.key_last4 if self.api_key_encrypted else None
        return d

    def __repr__(self) -> str:  # keep ciphertext out of logs and tracebacks
        return f"ProviderRecord(id={self.id}, kind={self.kind!r}, name={self.name!r}, enabled={self.enabled})"


def _row_to_record(row: sqlite3.Row) -> ProviderRecord:
    d = dict(row)
    d["extra"] = json.loads(d.get("extra") or "{}")
    d["enabled"] = bool(d["enabled"])
    if d.get("last_probe_ok") is not None:
        d["last_probe_ok"] = bool(d["last_probe_ok"])
    return ProviderRecord.model_validate(d)


class RegistryStore:
    """SQLite-backed provider registry + settings. Safe to construct many times."""

    def __init__(self, db_path: str, *, secret_key: str | None):
        self.db_path = db_path
        Path(db_path).expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)
        self._fernet: Fernet | None = None
        if secret_key:
            self._fernet = Fernet(secret_key.encode() if isinstance(secret_key, str) else secret_key)
        with self._conn() as c:
            c.executescript(
                """
                CREATE TABLE IF NOT EXISTS providers (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    kind TEXT NOT NULL CHECK (kind IN ('llm','embed','rerank','stt','tts','avatar','imaging',
                                                       'identity','telemetry')),
                    name TEXT NOT NULL,
                    base_url TEXT NOT NULL,
                    model TEXT,
                    api_key_encrypted TEXT,
                    key_last4 TEXT,
                    region TEXT,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    priority INTEGER NOT NULL DEFAULT 100,
                    extra TEXT NOT NULL DEFAULT '{}',
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL,
                    last_probe_at REAL,
                    last_probe_ok INTEGER,
                    last_probe_latency_ms REAL,
                    last_probe_error TEXT
                );
                CREATE INDEX IF NOT EXISTS providers_kind_priority ON providers (kind, enabled, priority);
                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at REAL NOT NULL
                );
                """
            )

    # -- plumbing ------------------------------------------------------------ #
    def _conn(self) -> sqlite3.Connection:
        c = sqlite3.connect(self.db_path, isolation_level=None)
        c.row_factory = sqlite3.Row
        return c

    @property
    def secrets_configured(self) -> bool:
        return self._fernet is not None

    def _seal(self, api_key: str) -> tuple[str, str]:
        if self._fernet is None:
            raise SecretKeyMissing(secret_key_instructions())
        return self._fernet.encrypt(api_key.encode("utf-8")).decode("ascii"), api_key[-4:]

    def decrypt_key(self, rec: ProviderRecord | None) -> str | None:
        """Internal consumers only (the gateway). Returns None when absent or unsealable."""
        if rec is None or not rec.api_key_encrypted or self._fernet is None:
            return None
        try:
            return self._fernet.decrypt(rec.api_key_encrypted.encode("ascii")).decode("utf-8")
        except InvalidToken:
            log.warning("provider %s: stored key cannot be decrypted with the current ACUDX_SECRET_KEY", rec.id)
            return None

    # -- providers ------------------------------------------------------------ #
    def list_providers(self, kind: str | None = None) -> list[ProviderRecord]:
        with self._conn() as c:
            if kind:
                rows = c.execute("SELECT * FROM providers WHERE kind = ? ORDER BY priority, id", (kind,)).fetchall()
            else:
                rows = c.execute("SELECT * FROM providers ORDER BY kind, priority, id").fetchall()
        return [_row_to_record(r) for r in rows]

    def get_provider(self, provider_id: int) -> ProviderRecord | None:
        with self._conn() as c:
            row = c.execute("SELECT * FROM providers WHERE id = ?", (provider_id,)).fetchone()
        return _row_to_record(row) if row else None

    def create_provider(self, data: ProviderIn) -> ProviderRecord:
        enc, last4 = (None, None)
        if data.api_key:
            enc, last4 = self._seal(data.api_key)
        now = time.time()
        with self._conn() as c:
            cur = c.execute(
                "INSERT INTO providers (kind, name, base_url, model, api_key_encrypted, key_last4, region, enabled, "
                "priority, extra, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (data.kind, data.name, data.base_url, data.model, enc, last4, data.region, int(data.enabled),
                 data.priority, json.dumps(data.extra), now, now),
            )
            row = c.execute("SELECT * FROM providers WHERE id = ?", (cur.lastrowid,)).fetchone()
        return _row_to_record(row)

    def update_provider(self, provider_id: int, patch: dict[str, Any] | ProviderPatch) -> ProviderRecord:
        p = patch if isinstance(patch, ProviderPatch) else ProviderPatch.model_validate(patch)
        fields: dict[str, Any] = {}
        for name in ("name", "base_url", "model", "region", "priority"):
            val = getattr(p, name)
            if val is not None:
                fields[name] = val
        if p.enabled is not None:
            fields["enabled"] = int(p.enabled)
        if p.extra is not None:
            fields["extra"] = json.dumps(p.extra)
        if p.api_key is not None:
            if p.api_key == "":
                fields["api_key_encrypted"], fields["key_last4"] = None, None
            else:
                fields["api_key_encrypted"], fields["key_last4"] = self._seal(p.api_key)
        fields["updated_at"] = time.time()
        sets = ", ".join(f"{k} = ?" for k in fields)
        with self._conn() as c:
            c.execute(f"UPDATE providers SET {sets} WHERE id = ?", (*fields.values(), provider_id))
            row = c.execute("SELECT * FROM providers WHERE id = ?", (provider_id,)).fetchone()
        if row is None:
            raise KeyError(provider_id)
        return _row_to_record(row)

    def delete_provider(self, provider_id: int) -> bool:
        with self._conn() as c:
            cur = c.execute("DELETE FROM providers WHERE id = ?", (provider_id,))
        return cur.rowcount > 0

    def set_probe_result(self, provider_id: int, *, ok: bool, latency_ms: float | None,
                         error: str | None = None, at: float | None = None) -> None:
        with self._conn() as c:
            c.execute(
                "UPDATE providers SET last_probe_at = ?, last_probe_ok = ?, last_probe_latency_ms = ?, "
                "last_probe_error = ? WHERE id = ?",
                (at if at is not None else time.time(), int(ok), latency_ms, error, provider_id),
            )

    # -- settings ------------------------------------------------------------ #
    def get_setting(self, key: str, default: Any = None) -> Any:
        with self._conn() as c:
            row = c.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
        return json.loads(row["value"]) if row else default

    def set_setting(self, key: str, value: Any) -> None:
        with self._conn() as c:
            c.execute(
                "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                (key, json.dumps(value), time.time()),
            )

    def all_settings(self) -> dict[str, Any]:
        with self._conn() as c:
            rows = c.execute("SELECT key, value FROM settings ORDER BY key").fetchall()
        return {r["key"]: json.loads(r["value"]) for r in rows}

    # -- env seed ------------------------------------------------------------ #
    def seed_from_env(self, settings: Settings) -> int:
        """Import the env-based model config as provider rows, once (empty table only).

        Rows are tagged ``extra.seeded_from = "env"``; a seeded row without a sealed
        key (no ``ACUDX_SECRET_KEY`` yet) resolves its key from the env at call time
        (see :mod:`server.registry.resolve`), so first boot needs no admin action.
        Returns the number of rows created.
        """
        if self.list_providers():
            return 0
        api_first = settings.llm_provider == "api"
        rows: list[ProviderIn] = [
            ProviderIn(kind="llm", name="env-llm", base_url=settings.llm_base_url, model=settings.llm_model,
                       api_key=self._seedable(settings.llm_api_key), priority=10 if api_first else 0,
                       extra={"seeded_from": "env", "env": "LLM_BASE_URL"}),
        ]
        if settings.openai_base_url:
            rows.append(ProviderIn(kind="llm", name="env-openai", base_url=settings.openai_base_url,
                                   model=settings.openai_model or settings.llm_model,
                                   api_key=self._seedable(settings.openai_api_key), priority=0 if api_first else 10,
                                   extra={"seeded_from": "env", "env": "OPENAI_BASE_URL"}))
        rows.append(ProviderIn(kind="embed", name="env-embed", base_url=settings.embed_url, model=settings.embed_model,
                               priority=0, extra={"seeded_from": "env", "env": "EMBED_URL", "dim": settings.embed_dim}))
        rows.append(ProviderIn(kind="rerank", name="env-rerank", base_url=settings.rerank_url,
                               model=settings.rerank_model, priority=0,
                               extra={"seeded_from": "env", "env": "RERANK_URL"}))
        for r in rows:
            self.create_provider(r)
        log.info("registry seeded from env: %d provider row(s)", len(rows))
        return len(rows)

    def _seedable(self, key: str | None) -> str | None:
        """Only seal a real key, and only when sealing is possible; otherwise leave it to env resolution."""
        if not key or key == "sk-local" or self._fernet is None:
            return None
        return key
