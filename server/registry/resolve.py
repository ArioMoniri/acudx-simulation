"""Endpoint resolution over the provider registry.

``RegistryResolver.resolve(kind)`` returns the best :class:`ProviderEndpoint` for a
kind, or ``None``:

1. enabled rows of that kind, ordered by ``priority`` (lower wins), then id;
2. under ``AIRGAPPED`` every non-local ``base_url`` is refused (same check as
   :func:`server.config.is_local_endpoint`, so the invariant lives in one place);
3. rows whose last probe failed are skipped (an unknown probe state is fine);
4. for ``kind == "llm"`` only, when nothing is left and a worker manager is
   wired, the on-demand GPU worker is brought up (``ensure_worker``) and its
   endpoint returned. ``touch()`` resets the worker's idle window on each use.
   Voice kinds (``tts``, ``stt``) ask for the same worker explicitly through
   :meth:`RegistryResolver.resolve_worker`, which maps them onto the worker's
   ``/tts`` and ``/stt`` routes behind the same bearer token.

The resolver keeps decrypted keys in memory only for the lifetime of the
returned endpoint; ``ProviderEndpoint.__repr__`` hides the key.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Protocol

from server.config import Settings, is_local_endpoint
from server.providers.gpu_worker import WorkerRefused
from server.registry.store import ProviderRecord, RegistryStore, is_anthropic

log = logging.getLogger("acudx.registry.resolve")

# Worker route prefix per kind (infra/gpu-worker/cloud-init.yaml Caddyfile).
WORKER_PATHS: dict[str, str] = {"llm": "/v1", "tts": "/tts", "stt": "/stt"}
# What the worker serves on each route (served model names are fixed by the image).
WORKER_MODELS: dict[str, str] = {"tts": "chatterbox-multilingual", "stt": "deepdml/faster-whisper-large-v3-turbo-ct2"}
# Consecutive failed probes before a keyed Claude row leaves the route (see anthropic_enabled).
ANTHROPIC_PROBE_FAILURES_TO_DISABLE = 3


class WorkerManagerLike(Protocol):
    async def ensure_worker(self) -> Any: ...
    def llm_endpoint(self) -> dict[str, str] | None: ...
    def touch(self, ref: str | None = None) -> None: ...


@dataclass(frozen=True, repr=False)
class ProviderEndpoint:
    kind: str
    name: str
    base_url: str
    model: str | None
    api_key: str
    source: str                     # "registry" | "gpu_worker" | "env"
    provider_id: int | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    def __repr__(self) -> str:
        return (f"ProviderEndpoint(kind={self.kind!r}, name={self.name!r}, base_url={self.base_url!r}, "
                f"model={self.model!r}, source={self.source!r}, has_key={bool(self.api_key)})")

    __str__ = __repr__


class RegistryResolver:
    def __init__(self, store: RegistryStore, settings: Settings,
                 worker_manager: WorkerManagerLike | None = None):
        self.store = store
        self.settings = settings
        self.worker_manager = worker_manager
        self.last_worker_refusal: str | None = None

    # -- filtering (sync, cheap) --------------------------------------------- #
    def _allowed(self, rec: ProviderRecord) -> bool:
        if not self.settings.airgapped:
            return True
        return is_local_endpoint(rec.base_url, self.settings.local_allowlist)

    def candidates(self, kind: str) -> list[ProviderRecord]:
        """Enabled, egress-permitted, not-known-dead rows in priority order."""
        out = []
        for rec in self.store.list_providers(kind=kind):
            if not rec.enabled or not self._allowed(rec) or rec.last_probe_ok is False:
                continue
            if is_anthropic(rec):
                continue   # served by the Claude provider (anthropic_* below), not /chat/completions
            out.append(rec)
        return out

    # -- Claude route (docs/architecture/20 section 2) ------------------------ #
    def anthropic_row(self) -> ProviderRecord | None:
        return self.store.anthropic_row()

    def anthropic_key(self) -> str | None:
        """A key sealed on the anthropic row (admin panel), else None. ANTHROPIC_KEY, when set,
        wins over it (server/providers/anthropic_provider.py ``_key``)."""
        rec = self.anthropic_row()
        return self.store.decrypt_key(rec) if rec is not None else None

    def anthropic_enabled(self) -> bool:
        """The Claude route is selected: its row is enabled, not known dead, and no other
        enabled LLM row has a lower priority. No row at all (scripts, tests) means enabled.

        With a key configured (env or sealed), one failed probe is a hiccup, not a dead route: the
        row stays selected until ``ANTHROPIC_PROBE_FAILURES_TO_DISABLE`` probes in a row failed.
        Taking Claude off the route sends every call to the GPU worker, which launches one."""
        rec = self.anthropic_row()
        if rec is None:
            return True
        if not rec.enabled or not self._allowed(rec):
            return False
        if rec.last_probe_ok is False:
            keyed = bool((self.settings.anthropic_key or "").strip() or rec.api_key_encrypted)
            if not keyed or rec.probe_failures >= ANTHROPIC_PROBE_FAILURES_TO_DISABLE:
                return False
        others = self.candidates("llm")
        return not others or rec.priority <= min(o.priority for o in others)

    def refused(self, kind: str) -> list[ProviderRecord]:
        """Enabled rows the air-gap guard refuses (for the admin health view)."""
        return [r for r in self.store.list_providers(kind=kind) if r.enabled and not self._allowed(r)]

    def _key_for(self, rec: ProviderRecord) -> str:
        key = self.store.decrypt_key(rec)
        if key:
            return key
        if rec.extra.get("seeded_from") == "env":
            # Seeded before ACUDX_SECRET_KEY existed: the env still owns the key.
            if rec.extra.get("env") == "OPENAI_BASE_URL":
                return self.settings.openai_api_key or self.settings.llm_api_key
            return self.settings.llm_api_key
        return ""

    def _endpoint(self, rec: ProviderRecord) -> ProviderEndpoint:
        return ProviderEndpoint(kind=rec.kind, name=rec.name, base_url=rec.base_url.rstrip("/"), model=rec.model,
                                api_key=self._key_for(rec), source="registry", provider_id=rec.id, extra=rec.extra)

    def endpoints(self, kind: str) -> list[ProviderEndpoint]:
        """Every eligible registry endpoint for ``kind`` in priority order (keys decrypted)."""
        return [self._endpoint(rec) for rec in self.candidates(kind)]

    # -- resolution ----------------------------------------------------------- #
    async def resolve(self, kind: str, *, launch: bool = True) -> ProviderEndpoint | None:
        """``launch=False`` falls back only to a GPU worker that is already ready (never boots one)."""
        cands = self.candidates(kind)
        if cands:
            return self._endpoint(cands[0])
        if kind == "llm" and self.worker_manager is not None:
            return await self._gpu_endpoint(launch=launch)
        return None

    async def _gpu_endpoint(self, *, launch: bool = True) -> ProviderEndpoint | None:
        return await self.resolve_worker("llm", launch=launch)

    def worker_at(self, kind: str, origin: str | None) -> ProviderEndpoint | None:
        """The ready worker at ``origin`` (``https://<domain>``) as an endpoint for ``kind``, else None. A live
        call's voice is synthesised on the worker that renders the call: on a two-card worker its voices have
        a card without the runner, and the least-loaded pick sent a call's Turkish lines to another worker
        (live 2026-10-22)."""
        wm = self.worker_manager
        if not origin or wm is None or kind not in WORKER_PATHS or not hasattr(wm, "endpoint_by_origin"):
            return None
        ep = wm.endpoint_by_origin(origin)
        if not ep:
            return None
        base = ep["base_url"].rstrip("/")
        base = base[: -len("/v1")] if base.endswith("/v1") else base
        model = ep["model"] if kind == "llm" else WORKER_MODELS[kind]
        return ProviderEndpoint(kind=kind, name="gpu-worker", base_url=base + WORKER_PATHS[kind], model=model,
                                api_key=ep["api_key"], source="gpu_worker")

    async def resolve_worker(self, kind: str, *, launch: bool = True) -> ProviderEndpoint | None:
        """The on-demand GPU worker's endpoint for ``kind`` (llm | tts | stt), or None when refused.

        ``ensure_worker`` launches or reuses the worker; a :class:`WorkerRefused`
        (air-gapped, not configured, budget, capacity) yields ``None`` with the
        reason logged, so callers answer "unavailable" instead of egressing.
        ``launch=False`` only reads a worker that is already ready (None otherwise).
        """
        if self.worker_manager is None or kind not in WORKER_PATHS:
            return None
        if launch:
            try:
                await self.worker_manager.ensure_worker()
            except WorkerRefused as exc:
                log.info("gpu worker unavailable for %s resolution: %s", kind, exc.reason)
                self.last_worker_refusal = exc.reason
                return None
            self.last_worker_refusal = None
        ep = self.worker_manager.llm_endpoint()
        if not ep:
            return None
        origin = ep["base_url"].rstrip("/")
        if origin.endswith("/v1"):
            origin = origin[: -len("/v1")]
        model = ep["model"] if kind == "llm" else WORKER_MODELS[kind]
        return ProviderEndpoint(kind=kind, name="gpu-worker", base_url=origin + WORKER_PATHS[kind], model=model,
                                api_key=ep["api_key"], source="gpu_worker")

    def _worker_ep(self, endpoint: ProviderEndpoint | None) -> bool:
        return endpoint is not None and endpoint.source == "gpu_worker" and self.worker_manager is not None

    def touch(self, endpoint: ProviderEndpoint | None) -> None:
        """Reset the idle window of the GPU worker that served ``endpoint`` (the pool reaps each
        worker on its own window, so only that one is touched)."""
        if self._worker_ep(endpoint):
            try:
                self.worker_manager.touch(endpoint.base_url)  # type: ignore[union-attr]
            except TypeError:   # a manager without per-worker touch
                self.worker_manager.touch()  # type: ignore[union-attr]

    def begin(self, endpoint: ProviderEndpoint | None) -> None:
        """A request started on a GPU worker endpoint (pool load balancing and scale-up)."""
        if self._worker_ep(endpoint) and hasattr(self.worker_manager, "begin"):
            self.worker_manager.begin(endpoint.base_url)  # type: ignore[union-attr]

    def end(self, endpoint: ProviderEndpoint | None) -> None:
        if self._worker_ep(endpoint) and hasattr(self.worker_manager, "end"):
            self.worker_manager.end(endpoint.base_url)  # type: ignore[union-attr]
