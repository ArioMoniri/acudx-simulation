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
from typing import Annotated, Literal
from urllib.parse import urlparse

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

# A list field read from the env as a raw string, so the CSV-or-JSON validator
# below sees it (pydantic-settings would otherwise insist on JSON).
CsvList = Annotated[list[str], NoDecode]


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
        populate_by_name=True,
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
    # --- Anthropic (Claude) route, docs/architecture/20 section 2 ---------------- #
    # ANTHROPIC_KEY (ANTHROPIC_API_KEY accepted as an alias) is read server-side only and
    # never serialised to a client. With a key, Claude is the default route for the case
    # author, judges, repair, narrator, debrief, renderings, grounding, the patient persona
    # and the interview guard; without one every role falls back to the configured next
    # provider (registry, OPENAI_*, GPU worker). ANTHROPIC_ROUTE=false keeps the key but
    # takes Claude off the route. AIRGAPPED refuses api.anthropic.com like any hosted host.
    anthropic_key: str | None = Field(
        default=None, validation_alias=AliasChoices("anthropic_key", "anthropic_api_key"), repr=False,
    )
    anthropic_base_url: str = "https://api.anthropic.com"
    anthropic_route: bool = True
    anthropic_timeout_s: float = 120.0
    # Model per role (exact ids from the Anthropic models table, 2026-10-06).
    anthropic_model_author: str = "claude-opus-5-5"
    anthropic_model_repair: str = "claude-opus-5-5"
    # One model per council judge, in server/orchestration/judges.JUDGES order
    # (clinical_consistency, safety_dosing, pedagogy): three different voices.
    anthropic_judge_models: CsvList = Field(default_factory=lambda: [
        "claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5",
    ])
    anthropic_model_persona: str = "claude-opus-5-5"
    # The persona for a line spoken into a live video call (docs/architecture/18 6.3.9). Opus 5.5 always
    # thinks and took 1.1 to 1.7 s to its first word live (2026-10-21), the largest hop before the voice;
    # Sonnet 5.5 with thinking off answered in 0.8 s. Set it to the typed persona's model to keep one.
    anthropic_model_persona_live: str = "claude-sonnet-5-5"
    anthropic_model_classifier: str = "claude-haiku-5-5"
    anthropic_model_narrator: str = "claude-sonnet-5-5"
    anthropic_model_debrief: str = "claude-opus-5-5"
    anthropic_model_render: str = "claude-sonnet-5-5"
    anthropic_model_grounding: str = "claude-sonnet-5-5"
    anthropic_model_tutor: str = "claude-sonnet-5-5"

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
    local_allowlist: CsvList = Field(default_factory=list)

    # --- HTTP serving ------------------------------------------------------- #
    host: str = "127.0.0.1"
    port: int = 8890
    # Origins allowed by CORS in addition to the localhost/127.0.0.1 regex
    # (e.g. a tunnel domain fronting the web demo).
    cors_origins: CsvList = Field(default_factory=list)

    # --- httpx tuning ------------------------------------------------------- #
    request_timeout_s: float = 60.0
    # Read budget for structured case generation and judges (server/orchestration/llm.py).
    casegen_timeout_s: float = 300.0
    # None = auto (Qwen3 family and the GPU worker's acudx-llm); true/false forces it.
    casegen_disable_thinking: bool | None = None
    # Hourly price of a self-hosted worker used for amortised call cost when no
    # GPU ledger row is available in this process (CASEGEN_GPU_USD_PER_HOUR).
    casegen_gpu_usd_per_hour: float | None = None
    # Wall-clock budget for one case generation; a repair that would not fit is
    # skipped and the case is finalized as degraded (server/orchestration/graph.py).
    casegen_time_budget_s: float = 120.0
    connect_timeout_s: float = 5.0
    probe_timeout_s: float = 2.0
    max_retries: int = 2

    # --- /status introspection ---------------------------------------------- #
    status_disk_path: str = "/data"      # pod data volume; falls back to "/"

    # --- On-demand GPU worker (Lambda Cloud) --------------------------------- #
    # See server/providers/gpu_worker.py. Never always-on: a worker is launched
    # only when a request needs a GPU and reaped after GPU_IDLE_MINUTES.
    # LAMBDA_API_KEY is accepted as an alias of LAMBDA_KEY.
    lambda_key: str | None = Field(
        default=None, validation_alias=AliasChoices("lambda_key", "lambda_api_key"),
    )
    lambda_ssh_key_name: str | None = None       # exactly one key name per launch
    gpu_idle_minutes: int = 20
    # Cold boot of a worker pulls the vLLM image plus ~19 GB of weights; 45 min by default.
    gpu_ready_timeout_s: float = 2700.0
    gpu_file_system_name: str | None = None
    gpu_boot_timeout_s: float = 900.0
    gpu_daily_budget_usd: float | None = None  # None = no cap; set a number to cap daily GPU spend
    gpu_llm_model: str = "Qwen/Qwen3-32B-AWQ"
    gpu_instance_allowlist: CsvList = Field(default_factory=lambda: [
        "gpu_1x_h100_pcie", "gpu_1x_h100_sxm5", "gpu_1x_a100_sxm4", "gpu_1x_a100", "gpu_1x_a10",
    ])
    gpu_region_preference: CsvList = Field(default_factory=list)
    # Most workers the pool runs at once (launched on demand, each reaped when idle).
    gpu_max_workers: int = 3
    # Hard cap on one worker's life (hours), enforced by the reaper whatever the load.
    gpu_max_lifetime_hours: float = 6.0
    # Smallest card (GB per GPU) a worker is launched on. The worker also runs the patient video
    # (MuseTalk runner, FLUX.2 image edits) next to vLLM and the voices; a 24 GB A10 cannot hold
    # them, so the cheapest-card rule picked a worker that never served video (docs/architecture/18 6.7).
    gpu_min_gpu_memory_gb: int = Field(default=40, ge=0, le=1024)
    # Card size (GB per GPU) tried first for workers that serve live video calls: on an 80 GB card the
    # Turkish voice (Chatterbox, two replicas) has room and compute beside the call; a 40 GB card is taken
    # only when no 80 GB card has capacity, and the admin GPU section and the call tile say so
    # (docs/architecture/18 6.3.10).
    gpu_preferred_gpu_memory_gb: int = Field(default=80, ge=0, le=1024)
    # Orphan sweep: only workers this gateway launched (its id is in the instance name and tags)
    # are swept. True also sweeps acudx-worker-* instances that carry no gateway id (launched by a
    # gateway before 2026-10-21); leave False when another gateway shares the Lambda account.
    gpu_sweep_unowned: bool = False
    admin_token: str | None = None               # guards /admin/*; 503 when unset
    # --- Live patient video (server/voice/avatar, docs/architecture/18 section 6) --- #
    # The gateway's internet-reachable origin; Tavus's custom LLM calls back
    # <PUBLIC_BASE_URL>/v1/patient/openai/chat/completions. Unset = Tavus cannot be used.
    public_base_url: str | None = None
    # TURN URLs handed to the browser for the GPU worker's avatar call, replacing the default
    # turn:<worker>:3478 (udp, tcp) pair, e.g. a TLS terminator on 443 or a local tunnel.
    avatar_turn_urls: CsvList = Field(default_factory=list)
    # Live calls one GPU worker accepts at once (the runner also enforces its AVATAR_MAX_SESSIONS;
    # the lower of the two applies). 2 was measured on an H100 PCIe (docs/architecture/18 6.3).
    avatar_max_calls_per_worker: int = Field(default=2, ge=1, le=8)
    # Per-call runner tuning sent with each offer (None = the runner's defaults): MuseTalk batch,
    # frames kept ahead of the sender, whisper right context (20 ms frames), and the video delay
    # against the voice in ms (positive when the lips lead the voice). 160: the setting with the smallest
    # steady-state offset in the live runs (docs/architecture/18 section 6.3.3).
    avatar_batch_size: int | None = Field(default=None, ge=2, le=16)
    avatar_ahead_frames: int | None = Field(default=None, ge=4, le=40)
    avatar_lookahead_frames: int | None = Field(default=None, ge=4, le=10)
    avatar_av_shift_ms: int | None = Field(default=160, ge=-1000, le=1000)
    # Silence streamed into a call right after the offer, before the first patient line, so the
    # runner's speech path and the browser's jitter buffer have settled when the first real line
    # plays (the first two lines swung up to 420 ms either way; docs/architecture/18 6.3.8). 0 = off.
    avatar_preroll_ms: int = Field(default=800, ge=0, le=3000)
    # A live call's English lines take the worker's Kokoro before its Chatterbox (first audio 0.15 to
    # 0.6 s against 2 to 3 s on a shared A100, docs/architecture/18 6.3.9). Turkish always uses Chatterbox.
    avatar_fast_en_tts: bool = True
    # How long a call start waits for the patient's presenting look (image edit + MuseTalk preparation)
    # before it opens on the case portrait and crossfades into the look once it is ready.
    # 10 s since the pictures are registered onto the portrait (a later crossfade shows no double image,
    # docs/architecture/18 6.6.1); live 2026-10-21 the 45 s wait was most of the 98 s to live video.
    # 6 s since the call's portrait goes ahead of the look ladder on the runner (6.8.1): the voice click
    # then reaches a first frame within the 15 s target even when the look is not ready.
    avatar_appearance_wait_s: float = Field(default=6.0, ge=0, le=300)
    # Case start with live video enabled: a case open wakes the on-demand GPU worker in the
    # background and makes the patient's pictures (presenting, worse, critical, improved) as soon
    # as it is up, so a later call opens on the symptoms. The idle reaper still stops the worker
    # (GPU_IDLE_MINUTES) when nobody calls. False: only an explicit call start launches a worker.
    avatar_prewarm_on_case_start: bool = False
    # How long the pictures for a case wait for the worker's image edit server and runner to come
    # up (they start several minutes after the worker's LLM answers).
    avatar_services_wait_s: float = Field(default=1800.0, ge=0, le=7200)
    acudx_db_path: str = "server/data/acudx.db"  # SQLite: worker state + cost ledger + registry + telemetry

    # --- Identity (server/auth, docs/architecture/19) --- #
    # "local": air-gapped default, unverified local profiles (every response carries
    # X-Auth-Mode: local). "oidc": a verified bearer JWT from the registry's identity
    # provider is required. The registry setting `auth_mode` overrides this value.
    auth_mode: Literal["local", "oidc"] = "local"

    # --- One-time credential handoff (server/bootstrap, deploy/one-click.sh) --- #
    # Directory holding credentials.json + code.json (root-only on the host, mounted into
    # the container). Unset = /bootstrap/* answers 404. The page refuses plain HTTP unless
    # BOOTSTRAP_REQUIRE_HTTPS=false (tests and a loopback-only operator check).
    bootstrap_dir: str | None = None
    bootstrap_require_https: bool = True
    # Keycloak as the gateway reaches it on the Docker network, for /bootstrap/operator/reset-accounts.
    bootstrap_keycloak_url: str = "http://keycloak:8080/idp"

    # --- Provider registry + telemetry (server/registry, server/telemetry) --- #
    # Fernet key sealing provider API keys at rest. Unset => keys cannot be stored
    # (the registry refuses, it never falls back to plaintext). Generate with
    # `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`.
    acudx_secret_key: str | None = None
    # When set, every gateway call also emits an OpenTelemetry gen_ai.* span over
    # OTLP/HTTP (optional dependency, see server/requirements-telemetry.txt).
    otel_exporter_otlp_endpoint: str | None = None
    # Background jobs (server/registry/jobs.py). Enabled provider rows are probed
    # every PROBE_INTERVAL_MINUTES (0 disables); model_calls rows older than the
    # console's telemetry.retention_days are purged every RETENTION_PURGE_INTERVAL_MINUTES.
    # Import the env model config (LLM_BASE_URL, EMBED_URL, RERANK_URL) as provider rows on
    # first boot. A production host without a local model stack sets REGISTRY_SEED_ENV=false,
    # so LLM calls go to the registry rows the admin adds, else to the on-demand GPU worker.
    registry_seed_env: bool = True
    probe_interval_minutes: int = Field(default=10, ge=0)
    retention_purge_interval_minutes: int = Field(default=60, ge=0)

    @field_validator(
        "local_allowlist", "cors_origins", "gpu_instance_allowlist", "gpu_region_preference",
        "avatar_turn_urls", "anthropic_judge_models", mode="before",
    )
    @classmethod
    def _split_csv(cls, v: object) -> object:
        """Accept a comma-separated string as well as a JSON list from env."""
        if isinstance(v, str):
            s = v.strip()
            if not s:
                return []
            if s.startswith("["):
                import json  # noqa: PLC0415 — only for the JSON-list env form
                return json.loads(s)
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

    def anthropic_status(self) -> dict[str, object]:
        """Whether the Claude route can be used, and the operator-facing reason when not.

        Never carries the key: only ``configured`` (a key is present) and ``usable``."""
        key = (self.anthropic_key or "").strip()
        if not key:
            return {"configured": False, "usable": False, "reason": "Anthropic key not configured"}
        if not self.anthropic_route:
            return {"configured": True, "usable": False, "reason": "Anthropic route disabled (ANTHROPIC_ROUTE=false)"}
        if self.airgapped and not is_local_endpoint(self.anthropic_base_url, self.local_allowlist):
            return {"configured": True, "usable": False,
                    "reason": f"AIRGAPPED refuses {self.anthropic_base_url}"}
        return {"configured": True, "usable": True, "reason": None}

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
