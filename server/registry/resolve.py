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
from server.registry.store import ProviderRecord, RegistryStore

log = logging.getLogger("acudx.registry.resolve")

# Worker route prefix per kind (infra/gpu-worker/cloud-init.yaml Caddyfile).
WORKER_PATHS: dict[str, str] = {"llm": "/v1", "tts": "/tts", "stt": "/stt"}
# What the worker serves on each route (served model names are fixed by the image).
WORKER_MODELS: dict[str, str] = {"tts": "chatterbox-multilingual", "stt": "deepdml/faster-whisper-large-v3-turbo-ct2"}


class WorkerManagerLike(Protocol):
    async def ensure_worker(self) -> Any: ...
    def llm_endpoint(self) -> dict[str, str] | None: ...
    def touch(self) -> None: ...


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
            out.append(rec)
        return out

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
    async def resolve(self, kind: str) -> ProviderEndpoint | None:
        cands = self.candidates(kind)
        if cands:
            return self._endpoint(cands[0])
        if kind == "llm" and self.worker_manager is not None:
            return await self._gpu_endpoint()
        return None

    async def _gpu_endpoint(self) -> ProviderEndpoint | None:
        return await self.resolve_worker("llm")

    async def resolve_worker(self, kind: str) -> ProviderEndpoint | None:
        """The on-demand GPU worker's endpoint for ``kind`` (llm | tts | stt), or None when refused.

        ``ensure_worker`` launches or reuses the worker; a :class:`WorkerRefused`
        (air-gapped, not configured, budget, capacity) yields ``None`` with the
        reason logged, so callers answer "unavailable" instead of egressing.
        """
        if self.worker_manager is None or kind not in WORKER_PATHS:
            return None
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

    def touch(self, endpoint: ProviderEndpoint | None) -> None:
        """Reset the GPU worker idle window after a request that used it."""
        if endpoint is not None and endpoint.source == "gpu_worker" and self.worker_manager is not None:
            self.worker_manager.touch()
