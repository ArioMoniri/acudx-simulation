"""One-time credential handoff for a fresh deployment.

At deploy time ``deploy/one-click.sh`` provisions one Keycloak user per AcuDx role with a
random temporary password and writes them, root-only, to ``<BOOTSTRAP_DIR>/credentials.json``.
It then mints a single-use retrieval code (``python -m server.bootstrap.mint``). The code
itself is never stored: ``code.json`` keeps a salted SHA-256 of it, the expiry (72 h by
default), the failure counters and the burn marker.

``GET /bootstrap/credentials`` shows a form. A ``POST`` with the right code, over HTTPS,
inside the validity window and outside a lockout, returns the table of usernames, roles and
temporary passwords exactly once: the code is burned before the page is rendered, and every
later request answers ``410 Gone``. A new code is minted only from the server shell
(``deploy/rotate-bootstrap-code.sh``).

Abuse limits (all persisted, so a restart does not reset them):

* per client IP: ``IP_MAX_FAILURES`` wrong codes per ``IP_WINDOW_S`` -> 429;
* globally: every ``LOCK_EVERY`` wrong codes lock the form for ``LOCK_S`` (429, even for the
  right code);
* ``BURN_AFTER`` wrong codes in total burn the code (410) until an operator rotates it.

Every attempt is appended to ``audit.log`` (JSON lines) without the code or any password.
"""

from __future__ import annotations

import base64
import fcntl
import hashlib
import hmac
import json
import logging
import os
import secrets
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterator

log = logging.getLogger("acudx.bootstrap")

DEFAULT_TTL_HOURS = 72
CODE_BYTES = 20                 # 160 bits, 32 base32 characters
IP_MAX_FAILURES = 5
IP_WINDOW_S = 15 * 60
LOCK_EVERY = 5
LOCK_S = 15 * 60
BURN_AFTER = 20

CODE_FILE = "code.json"
CREDENTIALS_FILE = "credentials.json"
AUDIT_FILE = "audit.log"
LOCK_FILE = ".lock"


def normalize_code(raw: str) -> str:
    """Upper-case, without spaces or dashes (the code is shown in groups of four)."""
    return "".join(ch for ch in (raw or "").upper() if ch.isalnum())


def format_code(code: str) -> str:
    return "-".join(code[i:i + 4] for i in range(0, len(code), 4))


def _digest(salt_hex: str, code: str) -> str:
    return hashlib.sha256(bytes.fromhex(salt_hex) + normalize_code(code).encode("ascii")).hexdigest()


@dataclass(frozen=True)
class Outcome:
    """Result of one redemption attempt. ``status`` is the HTTP status the route answers."""

    status: int
    reason: str
    credentials: dict[str, Any] | None = None
    retry_after_s: int | None = None


class BootstrapHandoff:
    def __init__(self, directory: str | os.PathLike[str], *, clock: Callable[[], float] = time.time):
        self.dir = Path(directory)
        self._clock = clock
        self._mutex = threading.Lock()

    # -- files ---------------------------------------------------------------- #
    @property
    def code_path(self) -> Path:
        return self.dir / CODE_FILE

    @property
    def credentials_path(self) -> Path:
        return self.dir / CREDENTIALS_FILE

    @contextmanager
    def _locked(self) -> Iterator[None]:
        """Process mutex plus an flock, so a CLI mint and the server never interleave."""
        with self._mutex:
            self.dir.mkdir(parents=True, exist_ok=True, mode=0o700)
            fd = os.open(self.dir / LOCK_FILE, os.O_RDWR | os.O_CREAT, 0o600)
            try:
                fcntl.flock(fd, fcntl.LOCK_EX)
                yield
            finally:
                fcntl.flock(fd, fcntl.LOCK_UN)
                os.close(fd)

    def _read_state(self) -> dict[str, Any] | None:
        try:
            return json.loads(self.code_path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return None
        except (OSError, ValueError):
            log.error("bootstrap code state is unreadable; treating the code as burned")
            return {"burned_at": self._clock(), "burn_reason": "state_unreadable"}

    def _write_state(self, state: dict[str, Any]) -> None:
        tmp = self.code_path.with_suffix(".tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(state, fh)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, self.code_path)

    def audit(self, event: str, **fields: Any) -> None:
        entry = {"ts": round(self._clock(), 3), "event": event, **fields}
        try:
            self.dir.mkdir(parents=True, exist_ok=True, mode=0o700)
            fd = os.open(self.dir / AUDIT_FILE, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
            with os.fdopen(fd, "a", encoding="utf-8") as fh:
                fh.write(json.dumps(entry, sort_keys=True) + "\n")
        except OSError:
            log.exception("bootstrap audit write failed")
        log.info("bootstrap %s %s", event, {k: v for k, v in fields.items() if k != "ua"})

    def audit_entries(self) -> list[dict[str, Any]]:
        try:
            lines = (self.dir / AUDIT_FILE).read_text(encoding="utf-8").splitlines()
        except FileNotFoundError:
            return []
        return [json.loads(x) for x in lines if x.strip()]

    # -- mint ------------------------------------------------------------------ #
    def mint(self, ttl_hours: float = DEFAULT_TTL_HOURS, *, actor: str = "cli") -> tuple[str, float]:
        """Create a fresh code (any previous one stops working). Returns (code, expires_at)."""
        if ttl_hours <= 0:
            raise ValueError("ttl_hours must be positive")
        code = base64.b32encode(secrets.token_bytes(CODE_BYTES)).decode("ascii").rstrip("=")
        salt = secrets.token_hex(16)
        now = self._clock()
        expires = now + ttl_hours * 3600.0
        with self._locked():
            self._write_state({
                "version": 1, "salt": salt, "code_sha256": _digest(salt, code),
                "created_at": now, "expires_at": expires, "burned_at": None, "burn_reason": None,
                "failed_attempts": 0, "locked_until": 0.0, "ip_failures": {},
            })
        self.audit("minted", actor=actor, expires_at=round(expires, 3))
        return code, expires

    # -- status ---------------------------------------------------------------- #
    def status(self) -> dict[str, Any]:
        """What GET shows: provisioned / active / burned / expired / locked (never the code)."""
        state = self._read_state()
        now = self._clock()
        if state is None:
            return {"state": "not_provisioned"}
        if state.get("burned_at"):
            return {"state": "burned", "reason": state.get("burn_reason")}
        if now >= float(state.get("expires_at") or 0):
            return {"state": "expired"}
        if now < float(state.get("locked_until") or 0):
            return {"state": "locked", "retry_after_s": int(float(state["locked_until"]) - now) + 1,
                    "expires_at": state.get("expires_at")}
        return {"state": "active", "expires_at": state.get("expires_at")}

    # -- redeem ---------------------------------------------------------------- #
    def redeem(self, presented: str, *, ip: str, ua_hash: str = "") -> Outcome:
        now = self._clock()
        with self._locked():
            state = self._read_state()
            if state is None:
                return self._done(Outcome(404, "not_provisioned"), ip, ua_hash)
            if state.get("burned_at"):
                return self._done(Outcome(410, "burned"), ip, ua_hash)
            if now >= float(state.get("expires_at") or 0):
                state["burned_at"], state["burn_reason"] = now, "expired"
                self._write_state(state)
                return self._done(Outcome(410, "expired"), ip, ua_hash)
            locked_until = float(state.get("locked_until") or 0)
            if now < locked_until:
                return self._done(Outcome(429, "locked", retry_after_s=int(locked_until - now) + 1), ip, ua_hash)
            ip_failures = {k: [t for t in v if now - t < IP_WINDOW_S]
                           for k, v in (state.get("ip_failures") or {}).items()}
            ip_failures = {k: v for k, v in ip_failures.items() if v}
            mine = ip_failures.get(ip, [])
            if len(mine) >= IP_MAX_FAILURES:
                retry = int(IP_WINDOW_S - (now - min(mine))) + 1
                state["ip_failures"] = ip_failures
                self._write_state(state)
                return self._done(Outcome(429, "rate_limited", retry_after_s=retry), ip, ua_hash)

            expected = str(state.get("code_sha256") or "")
            given = _digest(str(state.get("salt") or "00"), presented)
            if not (expected and hmac.compare_digest(given.encode("ascii"), expected.encode("ascii"))):
                state["failed_attempts"] = int(state.get("failed_attempts") or 0) + 1
                mine.append(now)
                ip_failures[ip] = mine
                state["ip_failures"] = ip_failures
                if state["failed_attempts"] >= BURN_AFTER:
                    state["burned_at"], state["burn_reason"] = now, "too_many_failures"
                    self._write_state(state)
                    return self._done(Outcome(410, "too_many_failures"), ip, ua_hash)
                if state["failed_attempts"] % LOCK_EVERY == 0:
                    state["locked_until"] = now + LOCK_S
                self._write_state(state)
                return self._done(Outcome(401, "wrong_code"), ip, ua_hash)

            try:
                creds = json.loads(self.credentials_path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                return self._done(Outcome(503, "credentials_missing"), ip, ua_hash)
            # Burn BEFORE the page is rendered: a crash after this line never re-opens the code.
            state["burned_at"], state["burn_reason"] = now, "revealed"
            state["ip_failures"] = {}
            self._write_state(state)
            return self._done(Outcome(200, "revealed", credentials=creds), ip, ua_hash)

    def _done(self, outcome: Outcome, ip: str, ua_hash: str) -> Outcome:
        self.audit("redeem", outcome=outcome.reason, status=outcome.status, ip=ip, ua=ua_hash)
        return outcome
