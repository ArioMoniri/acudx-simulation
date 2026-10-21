"""In-memory live-call sessions.

A session binds one learner's call to the case the patient answers from: the case
state and persona the browser sent at call start (the same shapes as
``POST /v1/patient/turn``), the renderer side (the GPU worker's LiveTalking session
id, or the Tavus conversation and PAL ids) and, for Tavus, the per-call bearer the
PAL's custom LLM presents back to ``/v1/patient/openai/chat/completions``.

Only a SHA-256 of that bearer is kept. Sessions expire (``ttl_s``) and the store is
bounded, so an abandoned call never pins memory; nothing here is persisted (a
gateway restart ends every call, which the tile reports and falls back from).
"""

from __future__ import annotations

import hashlib
import secrets
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable

DEFAULT_TTL_S = 45 * 60
MAX_SESSIONS = 256


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


@dataclass
class CallSession:
    id: str
    provider: str                       # "musetalk" | "tavus"
    user_hash: str
    encounter_id: str
    lang: str = "en"
    sex: str | None = None
    age: float | None = None
    photo_id: str | None = None
    case_state: dict[str, Any] = field(default_factory=dict)
    persona: dict[str, Any] | None = None
    case_context: dict[str, Any] | None = None
    created_at: float = 0.0
    expires_at: float = 0.0
    # self-hosted renderer
    avatar_id: str | None = None
    worker_session: str | None = None
    worker_origin: str | None = None      # the worker this call runs on (per-worker call limit)
    audio_link: Any = None                # RunnerAudioLink: the call's audio WebSocket to the runner
    # Tavus
    conversation_id: str | None = None
    conversation_url: str | None = None
    pal_id: str | None = None
    llm_token_digest: str | None = None
    metrics: dict[str, Any] = field(default_factory=dict)
    # The case thread the call follows (validated against the caller at session start); the face and
    # the voice are re-derived from its server-side Director state (state_sync.Appearance).
    thread_id: str | None = None
    appearance: Any = None

    def public(self) -> dict[str, Any]:
        out = {"session_id": self.id, "provider": self.provider, "lang": self.lang, "avatar_id": self.avatar_id,
               "conversation_url": self.conversation_url, "expires_at": self.expires_at}
        if self.appearance is not None:
            out["appearance"] = self.appearance.public()
        return out


class SessionStore:
    def __init__(self, *, ttl_s: float = DEFAULT_TTL_S, max_sessions: int = MAX_SESSIONS,
                 clock: Callable[[], float] = time.time):
        self.ttl_s = ttl_s
        self.max_sessions = max_sessions
        self._clock = clock
        self._lock = threading.Lock()
        self._by_id: dict[str, CallSession] = {}

    def _sweep(self, now: float) -> list[CallSession]:
        dead = [s for s in self._by_id.values() if s.expires_at <= now]
        for s in dead:
            self._by_id.pop(s.id, None)
        return dead

    def create(self, **fields: Any) -> CallSession:
        now = self._clock()
        with self._lock:
            self._sweep(now)
            if len(self._by_id) >= self.max_sessions:
                oldest = min(self._by_id.values(), key=lambda s: s.created_at)
                self._by_id.pop(oldest.id, None)
            s = CallSession(id=secrets.token_urlsafe(18), created_at=now, expires_at=now + self.ttl_s, **fields)
            self._by_id[s.id] = s
            return s

    def get(self, session_id: str, *, user_hash: str | None = None) -> CallSession | None:
        """The live session, or None (expired, unknown, or owned by another learner)."""
        now = self._clock()
        with self._lock:
            self._sweep(now)
            s = self._by_id.get(session_id)
        if s is None or (user_hash is not None and s.user_hash != user_hash):
            return None
        return s

    def by_llm_token(self, token: str) -> CallSession | None:
        if not token:
            return None
        digest = token_digest(token)
        now = self._clock()
        with self._lock:
            self._sweep(now)
            for s in self._by_id.values():
                if s.llm_token_digest and secrets.compare_digest(s.llm_token_digest, digest):
                    return s
        return None

    def touch(self, s: CallSession) -> None:
        s.expires_at = self._clock() + self.ttl_s

    def pop(self, session_id: str) -> CallSession | None:
        with self._lock:
            return self._by_id.pop(session_id, None)

    def expired(self) -> list[CallSession]:
        """Remove and return expired sessions (the caller ends their remote side)."""
        with self._lock:
            return self._sweep(self._clock())

    def pending_on(self, worker_origin: str, *, max_age_s: float = 120.0, provider: str = "musetalk") -> int:
        """Calls on one worker that hold a slot the runner cannot see yet: created in the last
        ``max_age_s`` and not offered (the portrait is being prepared or the browser is still on
        ICE). Connected calls are counted by the runner itself, which drops a call as soon as its
        peer connection closes, so a learner who closed the tab does not hold a slot for the
        session's 45-minute TTL (live finding 2026-10-20)."""
        now = self._clock()
        with self._lock:
            self._sweep(now)
            return sum(1 for s in self._by_id.values()
                       if s.provider == provider and s.worker_origin == worker_origin and not s.worker_session
                       and now - s.created_at <= max_age_s)

    def by_thread(self, thread_id: str) -> list[CallSession]:
        """Live calls that follow one case thread (every room member's call on a shared case)."""
        now = self._clock()
        with self._lock:
            self._sweep(now)
            return [s for s in self._by_id.values() if s.thread_id and s.thread_id == thread_id]

    def __len__(self) -> int:
        return len(self._by_id)
