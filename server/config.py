"""AcuDx Gateway — configuration & the no-egress guard.

Realises the config surface of ``docs/architecture/02-model-gateway-and-routing``
and the **AIRGAPPED** zero-egress invariant of ``docs/architecture/12`` /
``02 §13.1.2``. The gateway is the single chokepoint: when ``AIRGAPPED`` is set
it refuses to *resolve* any model endpoint that is not local — the request is
rejected before a socket is ever opened, so nothing can leave the box.

Everything is env-driven (12-factor) via ``pydantic-settings``; the DEFAULTS
match the GPU pod described in the build brief:

* ``LLM_BASE_URL``  = http://127.0.0.1:3040/v1  (local llama-server, Qwen2.5-7B)
* ``EMBED_URL``     = http://127.0.0.1:8003      (modernbert-tr-embed, dim 768)
* ``RERANK_URL``    = http://127.0.0.1:8004
* ``AIRGAPPED``     = true

An OpenAI-compatible API *fallback* is selectable via ``LLM_PROVIDER=api`` with
``OPENAI_BASE_URL`` / ``OPENAI_API_KEY`` — but it can only be reached with
``AIRGAPPED=false`` (a hosted endpoint is non-local, so the guard blocks it).
"""

from __future__ import annotations

import ipaddress
from dataclasses import dataclass
from functools import lru_cache
from typing import Literal
from urllib.parse import urlparse

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class EgressBlocked(RuntimeError):
    """Raised when ``AIRGAPPED`` is on and a non-local endpoint would be dialled.

    This is the fail-closed backstop of ``02 §13.1.2``: the guard throws at
    *resolution* time (never at network time), so a mis-authored config that
    points at a public host is rejected before a socket opens.
    """


# Loopback / wildcard hostnames that by definition never leave the machine.
_LOCAL_HOSTNAMES = {"localhost", "127.0.0.1", "::1", "0.0.0.0", ""}


def _host_of(url: str) -> str:
    return (urlparse(url).hostname or "").lower()


def is_local_endpoint(url: str, allow_cidrs: list[str] | None = None) -> bool:
    """True if ``url`` targets a loopback / private / allow-listed host.

    Local means: a loopback name, a loopback/private/link-local IP (covers the
    on-prem GPU-pool and in-VPC CIDRs of the air-gapped reference architecture),
    or an explicit entry in ``allow_cidrs`` (host name or CIDR block).
    """
    host = _host_of(url)
    if host in _LOCAL_HOSTNAMES:
        return True

    allow = allow_cidrs or []
    try:
        ip = ipaddress.ip_address(host)
        if ip.is_loopback or ip.is_private or ip.is_link_local:
            return True
        for cidr in allow:
            try:
                if ip in ipaddress.ip_network(cidr, strict=False):
                    return True
            except ValueError:
                continue  # not a CIDR; maybe a hostname entry — ignore for IPs
        return False
    except ValueError:
        # A hostname (not an IP). Only an explicit allow-list entry passes.
        return host in {c.strip().lower() for c in allow}


@dataclass(frozen=True)
class LlmEndpoint:
    """The resolved OpenAI-compatible LLM target for one request/tier."""

    base_url: str      # e.g. http://127.0.0.1:3040/v1  (no trailing slash)
    model: str         # e.g. qwen2.5-7b-instruct
    api_key: str       # sent as Bearer; llama-server ignores it
    provider: str      # "local" | "api"


class Settings(BaseSettings):
    """Process configuration. All fields overridable by env var (same name)."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # --- LLM (OpenAI-compatible chat/completions) --------------------------- #
    llm_provider: Literal["local", "api"] = "local"
    llm_base_url: str = "http://127.0.0.1:3040/v1"
    llm_model: str = "qwen2.5-7b-instruct"
    # llama-server does not check the key, but an OpenAI-compatible server may
    # still want an Authorization header present; a dummy keeps both happy.
    llm_api_key: str = "sk-local"

    # --- API fallback (hosted / frontier, selected by LLM_PROVIDER=api) ----- #
    openai_base_url: str | None = None
    openai_api_key: str | None = None
    openai_model: str | None = None

    # --- Case generator v2 + judge council (server/orchestration) ---------- #
    # Both default to the active LLM endpoint above; override the model (and
    # optionally the base URL / key) to run authoring and judging on different
    # models. The AIRGAPPED guard applies to every resolved URL.
    casegen_base_url: str | None = None
    casegen_model: str | None = None
    casegen_api_key: str | None = None
    judge_base_url: str | None = None
    judge_model: str | None = None
    judge_api_key: str | None = None
    # SQLite file for LangGraph checkpoints + the per-learner memory store.
    acudx_db_path: str = "server/data/acudx.db"

    # --- Retrieval side-cars (already running on the pod; adapters are thin
    #     and defensive — see model_gateway.embed()/rerank()). --------------- #
    embed_url: str = "http://127.0.0.1:8003"
    embed_dim: int = 768                 # ytu-ce-cosmos/modernbert-tr-embed
    embed_model: str = "ytu-ce-cosmos/modernbert-tr-embed"
    rerank_url: str = "http://127.0.0.1:8004"
    rerank_model: str = "ytu-ce-cosmos/modernbert-tr-reranker"

    # --- Air-gap ------------------------------------------------------------ #
    airgapped: bool = True
    # Extra hosts / CIDRs treated as "local" (e.g. in-VPC GPU-pool subnets).
    local_allowlist: list[str] = Field(default_factory=list)

    # --- HTTP serving ------------------------------------------------------- #
    host: str = "127.0.0.1"
    port: int = 8890
    # Origins allowed by CORS in addition to the localhost/127.0.0.1 regex
    # (e.g. a tunnel domain fronting the web demo).
    cors_origins: list[str] = Field(default_factory=list)

    # --- httpx tuning ------------------------------------------------------- #
    request_timeout_s: float = 60.0
    connect_timeout_s: float = 5.0
    probe_timeout_s: float = 2.0
    max_retries: int = 2

    # --- /status introspection ---------------------------------------------- #
    status_disk_path: str = "/data"      # pod data volume; falls back to "/"

    @field_validator("local_allowlist", "cors_origins", mode="before")
    @classmethod
    def _split_csv(cls, v: object) -> object:
        """Accept a comma-separated string as well as a JSON list from env."""
        if isinstance(v, str):
            s = v.strip()
            if not s:
                return []
            if s.startswith("["):
                return v  # defer to pydantic's JSON list parsing
            return [p.strip() for p in s.split(",") if p.strip()]
        return v

    # --- Resolution + guard ------------------------------------------------- #
    def guard_egress(self, url: str) -> None:
        """Raise :class:`EgressBlocked` if ``AIRGAPPED`` and ``url`` is non-local.

        Called at endpoint resolution *and* again per request (belt & suspenders,
        mirroring the unregister + no-egress-guard layering of ``02 §13.1.2``).
        """
        if self.airgapped and not is_local_endpoint(url, self.local_allowlist):
            raise EgressBlocked(
                f"AIRGAPPED refuses non-local endpoint {url!r}. "
                "Point it at a loopback/VPC host, add it to LOCAL_ALLOWLIST, "
                "or set AIRGAPPED=false to permit egress."
            )

    def resolve_llm(self) -> LlmEndpoint:
        """Resolve the active LLM endpoint from provider selection, guarded."""
        if self.llm_provider == "api":
            base = self.openai_base_url or self.llm_base_url
            key = self.openai_api_key or self.llm_api_key
            model = self.openai_model or self.llm_model
        else:
            base, key, model = self.llm_base_url, self.llm_api_key, self.llm_model
        self.guard_egress(base)
        return LlmEndpoint(
            base_url=base.rstrip("/"), model=model, api_key=key,
            provider=self.llm_provider,
        )

    def _derived(self, base_url: str | None, model: str | None, api_key: str | None) -> LlmEndpoint:
        """An endpoint that inherits from the active LLM unless overridden."""
        default = self.resolve_llm()
        url = (base_url or default.base_url).rstrip("/")
        self.guard_egress(url)
        provider = "local" if is_local_endpoint(url, self.local_allowlist) else "api"
        return LlmEndpoint(
            base_url=url, model=model or default.model,
            api_key=api_key or default.api_key, provider=provider,
        )

    def resolve_casegen(self) -> LlmEndpoint:
        """Endpoint for the case *author* and *repair* nodes (CASEGEN_*)."""
        return self._derived(self.casegen_base_url, self.casegen_model, self.casegen_api_key)

    def resolve_judge(self) -> LlmEndpoint:
        """Endpoint for the judge council and the Director narrator (JUDGE_*)."""
        return self._derived(self.judge_base_url, self.judge_model, self.judge_api_key)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Process-wide singleton Settings (env is read once)."""
    return Settings()
