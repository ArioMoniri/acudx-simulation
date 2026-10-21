"""Hashed bearer secrets for the SSH-free deploy path (server/bootstrap/operator.py).

Two secrets live next to the handoff state in ``BOOTSTRAP_DIR`` (root-only on the host):

* ``provision.json``: the one-time PROVISION_TOKEN the operator put in the EC2 user-data. It
  is accepted ONCE by ``POST /bootstrap/provision`` (which takes the API keys over HTTPS) and
  burned; it expires after 24 h if never used.
* ``operator.json``: the operator token minted by that same call and returned only in its
  response. It authenticates ``/bootstrap/operator/*`` (mint a retrieval code, reset the
  accounts) for 30 days; a super_admin's verified OIDC bearer is accepted as well.

Only a salted SHA-256 is stored. Comparison is constant time. Wrong attempts are rate limited
per client IP (5 per 15 min), every 5 wrong attempts lock the secret for 15 min, and 20 burn it.
Every attempt is appended to ``audit.log`` without the secret.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
from typing import Any, Callable

from server.bootstrap.handoff import (
    BURN_AFTER, IP_MAX_FAILURES, IP_WINDOW_S, LOCK_EVERY, LOCK_S, BootstrapHandoff, Outcome,
)

PROVISION_FILE = "provision.json"
OPERATOR_FILE = "operator.json"
PROVISION_TTL_H = 24.0
OPERATOR_TTL_H = 24.0 * 30


def _digest(salt_hex: str, secret: str) -> str:
    return hashlib.sha256(bytes.fromhex(salt_hex) + (secret or "").strip().encode("utf-8")).hexdigest()


class HashedSecret:
    """One salted-hash secret with lockout, expiry and (optionally) single use."""

    def __init__(self, handoff: BootstrapHandoff, filename: str, *, single_use: bool,
                 clock: Callable[[], float] | None = None):
        self.h = handoff
        self.path = handoff.dir / filename
        self.name = filename.split(".")[0]
        self.single_use = single_use
        self._clock = clock or handoff._clock

    # -- state ---------------------------------------------------------------- #
    def _read(self) -> dict[str, Any] | None:
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return None
        except (OSError, ValueError):
            return {"burned_at": self._clock(), "burn_reason": "state_unreadable"}

    def _write(self, state: dict[str, Any]) -> None:
        import os  # noqa: PLC0415

        tmp = self.path.with_suffix(".tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(state, fh)
        os.replace(tmp, self.path)

    def store(self, secret: str | None = None, *, ttl_hours: float, actor: str) -> tuple[str, float]:
        """Store the hash of ``secret`` (a new random one when None). Returns (secret, expires_at)."""
        secret = (secret or secrets.token_urlsafe(32)).strip()
        if len(secret) < 24:
            raise ValueError("secret too short")
        salt = secrets.token_hex(16)
        now = self._clock()
        expires = now + ttl_hours * 3600.0
        with self.h._locked():
            self._write({"version": 1, "salt": salt, "sha256": _digest(salt, secret), "created_at": now,
                         "expires_at": expires, "burned_at": None, "burn_reason": None, "failed_attempts": 0,
                         "locked_until": 0.0, "ip_failures": {}})
        self.h.audit(f"{self.name}_stored", actor=actor, expires_at=round(expires, 3))
        return secret, expires

    def state(self) -> str:
        st = self._read()
        if st is None:
            return "absent"
        if st.get("burned_at"):
            return "used" if st.get("burn_reason") == "used" else "burned"
        if self._clock() >= float(st.get("expires_at") or 0):
            return "expired"
        return "active"

    # -- check ---------------------------------------------------------------- #
    def check(self, presented: str, *, ip: str, ua: str = "", burn_on_success: bool | None = None) -> Outcome:
        """200 ok (burned first when single use), 401 wrong, 429 limited/locked, 410 used/expired, 404 absent."""
        burn = self.single_use if burn_on_success is None else burn_on_success
        now = self._clock()
        with self.h._locked():
            st = self._read()
            if st is None:
                return self._done(Outcome(404, "absent"), ip, ua)
            if st.get("burned_at"):
                return self._done(Outcome(410, str(st.get("burn_reason") or "burned")), ip, ua)
            if now >= float(st.get("expires_at") or 0):
                st["burned_at"], st["burn_reason"] = now, "expired"
                self._write(st)
                return self._done(Outcome(410, "expired"), ip, ua)
            locked = float(st.get("locked_until") or 0)
            if now < locked:
                return self._done(Outcome(429, "locked", retry_after_s=int(locked - now) + 1), ip, ua)
            fails = {k: [t for t in v if now - t < IP_WINDOW_S] for k, v in (st.get("ip_failures") or {}).items()}
            fails = {k: v for k, v in fails.items() if v}
            mine = fails.get(ip, [])
            if len(mine) >= IP_MAX_FAILURES:
                st["ip_failures"] = fails
                self._write(st)
                return self._done(Outcome(429, "rate_limited", retry_after_s=int(IP_WINDOW_S - (now - min(mine))) + 1),
                                  ip, ua)
            given = _digest(str(st.get("salt") or "00"), presented)
            if not hmac.compare_digest(given.encode("ascii"), str(st.get("sha256") or "").encode("ascii")):
                st["failed_attempts"] = int(st.get("failed_attempts") or 0) + 1
                mine.append(now)
                fails[ip] = mine
                st["ip_failures"] = fails
                if st["failed_attempts"] >= BURN_AFTER:
                    st["burned_at"], st["burn_reason"] = now, "too_many_failures"
                    self._write(st)
                    return self._done(Outcome(410, "too_many_failures"), ip, ua)
                if st["failed_attempts"] % LOCK_EVERY == 0:
                    st["locked_until"] = now + LOCK_S
                self._write(st)
                return self._done(Outcome(401, "wrong_token"), ip, ua)
            if burn:
                st["burned_at"], st["burn_reason"] = now, "used"
            st["ip_failures"] = {}
            self._write(st)
            return self._done(Outcome(200, "ok"), ip, ua)

    def _done(self, out: Outcome, ip: str, ua: str) -> Outcome:
        self.h.audit(f"{self.name}_check", outcome=out.reason, status=out.status, ip=ip, ua=ua)
        return out


def provision_secret(h: BootstrapHandoff) -> HashedSecret:
    return HashedSecret(h, PROVISION_FILE, single_use=True)


def operator_secret(h: BootstrapHandoff) -> HashedSecret:
    return HashedSecret(h, OPERATOR_FILE, single_use=False)

