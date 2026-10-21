"""On-demand Lambda Cloud GPU worker manager (never always-on).

Policy (docs/process/AGENT-PROTOCOL.md §2.4):

* launch only when a request needs a GPU and no healthy worker exists;
* terminate after ``idle_minutes`` without a request (idle reaper task), and after
  ``max_lifetime_hours`` whatever the load;
* a failed stop is retried every reaper pass, and ``acudx-worker-*`` instances that no
  active row owns are swept (on start, then every 5 minutes);
* optional daily budget cap in USD (None, the default, means no cap; the idle reaper
  still stops every worker that is not in use);
* cheapest allow-listed instance type that has capacity wins;
* a pool of at most ``max_workers`` workers (default 3; 0 disables launches);
* ``AIRGAPPED=true`` refuses to launch — fail closed, with a reason;
* worker state and a cost ledger persist in SQLite (``ACUDX_DB_PATH``).

The worker image is ``infra/gpu-worker/cloud-init.yaml``: Caddy terminates
TLS for ``<ip-with-dashes>.sslip.io`` and every route needs
``Authorization: Bearer <token>``. The public IP exists only after launch, so
the manager renders ``WORKER_DOMAIN=auto`` and the template derives the same
domain at boot; the manager derives it from the API-reported IP for probes.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import secrets
import re
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable

import httpx
from pydantic import BaseModel, Field, field_validator

from server.config import Settings
from server.providers.lambda_cloud import (
    WORKER_FIREWALL_RULES,
    Instance,
    LambdaCloudClient,
    LambdaCloudError,
    gpu_memory_gb,
    merge_firewall_rules,
    pick_cheapest,
)

log = logging.getLogger("acudx.gpu_worker")

DEFAULT_ALLOWLIST = ["gpu_1x_a100_sxm4", "gpu_1x_a10", "gpu_1x_a100", "gpu_1x_h100_pcie"]
DEFAULT_TEMPLATE = Path(__file__).resolve().parents[2] / "infra" / "gpu-worker" / "cloud-init.yaml"
SERVED_MODEL_NAME = "acudx-llm"   # --served-model-name in the worker's vLLM

# Review 04 O1: the boot-diagnostics path carries a value DERIVED from the worker token, never
# the token itself (the bearer must not travel in a plaintext URL on port 80). The worker
# computes the same value with openssl in infra/gpu-worker/cloud-init.yaml.
DIAG_SECRET_LABEL = b"acudx-diag-v1"
PROVIDER_GONE_STATUSES = ("terminated", "terminating", "preempted")

# The cloud-init template targets Lambda Stack 24.04 (docker compose plugin, NVIDIA toolkit). Two
# us-south-2 workers launched without an image on 2026-10-21 came up on lambda-stack-22-04 and never
# served a route (no diagnostics on 80, no TLS on 443); the us-southeast-1 one on 24.04 did. Pinning
# the family takes the region default out of the launch.
WORKER_IMAGE_FAMILY = "lambda-stack-24-04"

_MARKERS = {"__WORKER_TOKEN__": "token", "__WORKER_LLM_MODEL__": "llm_model", "__WORKER_DOMAIN__": "domain"}
ACTIVE_STATUSES = ("launching", "booting", "ready")
# Every worker is launched as ``acudx-worker-<epoch>-<hex>`` with this tag; the orphan sweep only
# ever considers instances that carry the name (or, when nameless, the tag).
WORKER_NAME_PREFIX = "acudx-worker-"
WORKER_TAG = {"key": "acudx", "value": "gpu-worker"}
# The launching gateway's id (WorkerStore.gateway_id), also in the name as ``-g<id>-``.
GATEWAY_TAG_KEY = "acudx-gateway"


# --------------------------------------------------------------------------- #
# Errors                                                                       #
# --------------------------------------------------------------------------- #
class WorkerRefused(RuntimeError):
    """The manager declined to provide a worker. ``reason`` is machine-readable."""

    reason = "refused"


class AirgappedRefused(WorkerRefused):
    reason = "airgapped"


class NotConfigured(WorkerRefused):
    reason = "not_configured"


class BudgetExceeded(WorkerRefused):
    reason = "budget_exceeded"


class NoCapacity(WorkerRefused):
    reason = "no_capacity"


class LaunchDisabled(WorkerRefused):
    reason = "launch_disabled"


class WorkerFailed(WorkerRefused):
    reason = "worker_failed"


# --------------------------------------------------------------------------- #
# Models                                                                       #
# --------------------------------------------------------------------------- #
# Lambda's Grace Hopper hosts are aarch64; every worker image (vLLM, Chatterbox, the avatar runner) is
# built for amd64, so such a host would boot and never serve a route.
ARM_TYPE_MARKERS = ("gh200",)


def gpus_for(instance_type: str) -> int:
    """``gpu_8x_h100_sxm5`` -> 8; anything without a ``<n>x`` part counts as one GPU."""
    m = re.match(r"^gpu_(\d+)x_", instance_type or "")
    return max(1, int(m.group(1))) if m else 1


class WorkerPolicy(BaseModel):
    idle_minutes: int = Field(default=20, ge=1, le=24 * 60)
    # None = no spend cap (owner decision 2026-10-20). A number re-enables the cap.
    daily_budget_usd: float | None = Field(default=None, ge=0)
    allowlist: list[str] = Field(default_factory=lambda: list(DEFAULT_ALLOWLIST), min_length=1)
    llm_model: str = Field(default="Qwen/Qwen3-14B-AWQ", min_length=1)
    region_preference: list[str] = Field(default_factory=list)
    # Optional Lambda filesystem (same region) mounted on the worker; the cloud-init keeps the
    # HF cache there so later boots skip the model download.
    file_system_name: str | None = None
    # The pool: at most this many workers run at once. Another one is launched when every ready
    # worker is saturated (a live call was refused for lack of a slot, or LLM and generation
    # requests in flight reached ``llm_queue_per_worker`` per GPU) and each worker is reaped on its
    # own idle window, so the pool shrinks back to nothing when the load goes.
    max_workers: int = Field(default=3, ge=0, le=64)
    llm_queue_per_worker: int = Field(default=6, ge=1, le=256)
    # Hard cap on one worker's life, enforced by the reaper whatever its load: a worker kept busy (or
    # pinned by a bug in the load accounting) is still stopped. A later request launches a fresh one.
    max_lifetime_hours: float = Field(default=6.0, gt=0, le=7 * 24)
    # Smallest card (GB per GPU) a worker is launched on: the worker also runs the patient video
    # (MuseTalk runner and FLUX.2 image edits) beside vLLM and the voices, which a 24 GB card cannot
    # hold (production 2026-10-21: the cheapest rule picked an A10 and the call never got video).
    min_gpu_memory_gb: int = Field(default=40, ge=0, le=1024)

    @field_validator("allowlist")
    @classmethod
    def _amd64_only(cls, v: list[str]) -> list[str]:
        arm = [t for t in v if any(mark in t for mark in ARM_TYPE_MARKERS)]
        if arm:
            raise ValueError(f"{arm} are aarch64 hosts; the worker images are amd64 only")
        return v


class WorkerRecord(BaseModel):
    id: int
    instance_id: str
    instance_type: str
    region: str
    ip: str | None = None
    domain: str | None = None
    token: str
    status: str
    price_cents_per_hour: int
    launched_at: float
    ready_at: float | None = None
    last_used_at: float
    terminated_at: float | None = None

    def public(self) -> dict[str, Any]:
        """Status view without the bearer token."""
        d = self.model_dump(exclude={"token"})
        d["gpus"] = gpus_for(self.instance_type)
        if self.domain:
            d["endpoints"] = {
                "healthz": f"https://{self.domain}/healthz",
                "llm_base_url": f"https://{self.domain}/v1",
                "tts_url": f"https://{self.domain}/tts/v1/audio/speech",
                "stt_url": f"https://{self.domain}/stt/v1/audio/transcriptions",
                "served_model_name": SERVED_MODEL_NAME,
            }
        return d


class LedgerEntry(BaseModel):
    id: int
    instance_id: str
    instance_type: str
    region: str
    price_cents_per_hour: int
    started_at: float
    ended_at: float | None = None
    cost_usd: float | None = None
    reason: str | None = None


# --------------------------------------------------------------------------- #
# Pure helpers                                                                 #
# --------------------------------------------------------------------------- #
# vLLM models that need a large card next to the voices and the video, and what runs instead on a
# smaller one (Qwen3-32B-AWQ left too little KV cache on a 40 GB card; cloud-init header).
SMALL_CARD_MODEL = {"Qwen/Qwen3-32B-AWQ": "Qwen/Qwen3-14B-AWQ"}
LARGE_CARD_GB = 70


def llm_model_for(model: str, gpu_gb: int | None) -> str:
    """The worker's LLM for a card with ``gpu_gb`` per GPU (unknown memory keeps the model)."""
    if gpu_gb is not None and gpu_gb < LARGE_CARD_GB:
        return SMALL_CARD_MODEL.get(model, model)
    return model


def sslip_domain(ip: str) -> str:
    """``1.2.3.4`` -> ``1-2-3-4.sslip.io`` (resolves to the IP; Caddy gets a LE cert)."""
    return ip.strip().replace(".", "-") + ".sslip.io"


def render_cloud_init(template: str, *, token: str, llm_model: str, domain: str) -> str:
    """Fill the template markers; refuse to ship an unfilled ``__WORKER_*__`` marker."""
    values = {"token": token, "llm_model": llm_model, "domain": domain}
    out = template
    for marker, key in _MARKERS.items():
        out = out.replace(marker, values[key])
    if "__WORKER_" in out:
        start = out.index("__WORKER_")
        raise ValueError(f"unfilled cloud-init marker near {out[start:start + 40]!r}")
    return out


def diag_secret(token: str) -> str:
    """HMAC-SHA256(key=token, message="acudx-diag-v1"), hex, first 32 characters.

    Shell equivalent on the worker:
    ``printf '%s' acudx-diag-v1 | openssl dgst -sha256 -hmac "$WORKER_TOKEN" -r | cut -c1-32``.
    Knowing it opens the redacted boot diagnostics only, never the LLM, TTS or STT routes.
    """
    return hmac.new(token.encode("utf-8"), DIAG_SECRET_LABEL, hashlib.sha256).hexdigest()[:32]


def _day_start(ts: float) -> float:
    d = datetime.fromtimestamp(ts, tz=timezone.utc)
    return d.replace(hour=0, minute=0, second=0, microsecond=0).timestamp()


# --------------------------------------------------------------------------- #
# SQLite store                                                                 #
# --------------------------------------------------------------------------- #
class WorkerStore:
    """Worker state, policy override and cost ledger in one SQLite file."""

    def __init__(self, db_path: str):
        self.db_path = db_path
        Path(db_path).expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)
        with self._conn() as c:
            c.executescript(
                """
                CREATE TABLE IF NOT EXISTS gpu_policy (
                    id INTEGER PRIMARY KEY CHECK (id = 1), body TEXT NOT NULL, updated_at REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS gpu_workers (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, instance_id TEXT NOT NULL UNIQUE,
                    instance_type TEXT NOT NULL, region TEXT NOT NULL, ip TEXT, domain TEXT,
                    token TEXT NOT NULL, status TEXT NOT NULL, price_cents_per_hour INTEGER NOT NULL,
                    launched_at REAL NOT NULL, ready_at REAL, last_used_at REAL NOT NULL, terminated_at REAL);
                CREATE TABLE IF NOT EXISTS gpu_ledger (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, instance_id TEXT NOT NULL,
                    instance_type TEXT NOT NULL, region TEXT NOT NULL, price_cents_per_hour INTEGER NOT NULL,
                    started_at REAL NOT NULL, ended_at REAL, cost_usd REAL, reason TEXT);
                CREATE TABLE IF NOT EXISTS gpu_boot_logs (
                    worker_id INTEGER PRIMARY KEY, instance_id TEXT NOT NULL,
                    captured_at REAL NOT NULL, body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS gpu_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                """
            )

    def gateway_id(self) -> str:
        """This gateway's id (8 hex), made once per database. It goes into every worker's name and
        tags, so the orphan sweep of one gateway never terminates another gateway's workers on a
        shared Lambda account."""
        with self._conn() as c:
            c.execute("INSERT OR IGNORE INTO gpu_meta (key, value) VALUES ('gateway_id', ?)", (secrets.token_hex(4),))
            return str(c.execute("SELECT value FROM gpu_meta WHERE key = 'gateway_id'").fetchone()["value"])

    def _conn(self) -> sqlite3.Connection:
        c = sqlite3.connect(self.db_path, isolation_level=None)
        c.row_factory = sqlite3.Row
        return c

    # -- policy -------------------------------------------------------------- #
    def get_policy(self) -> WorkerPolicy | None:
        with self._conn() as c:
            row = c.execute("SELECT body FROM gpu_policy WHERE id = 1").fetchone()
        return WorkerPolicy.model_validate(json.loads(row["body"])) if row else None

    def set_policy(self, policy: WorkerPolicy) -> None:
        with self._conn() as c:
            c.execute("INSERT INTO gpu_policy (id, body, updated_at) VALUES (1, ?, ?) "
                      "ON CONFLICT(id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at",
                      (policy.model_dump_json(), time.time()))

    # -- workers ------------------------------------------------------------- #
    def active_worker(self) -> WorkerRecord | None:
        q = ",".join("?" for _ in ACTIVE_STATUSES)
        with self._conn() as c:
            row = c.execute(f"SELECT * FROM gpu_workers WHERE status IN ({q}) ORDER BY id DESC LIMIT 1",
                            ACTIVE_STATUSES).fetchone()
        return WorkerRecord.model_validate(dict(row)) if row else None

    def active_workers(self) -> list[WorkerRecord]:
        """Every launching, booting or ready worker, oldest first."""
        q = ",".join("?" for _ in ACTIVE_STATUSES)
        with self._conn() as c:
            rows = c.execute(f"SELECT * FROM gpu_workers WHERE status IN ({q}) ORDER BY id", ACTIVE_STATUSES).fetchall()
        return [WorkerRecord.model_validate(dict(r)) for r in rows]

    def workers_in(self, *statuses: str) -> list[WorkerRecord]:
        q = ",".join("?" for _ in statuses)
        with self._conn() as c:
            rows = c.execute(f"SELECT * FROM gpu_workers WHERE status IN ({q}) ORDER BY id", statuses).fetchall()
        return [WorkerRecord.model_validate(dict(r)) for r in rows]

    def insert_worker(self, **fields: Any) -> WorkerRecord:
        cols = ", ".join(fields)
        marks = ", ".join("?" for _ in fields)
        with self._conn() as c:
            cur = c.execute(f"INSERT INTO gpu_workers ({cols}) VALUES ({marks})", tuple(fields.values()))
            row = c.execute("SELECT * FROM gpu_workers WHERE id = ?", (cur.lastrowid,)).fetchone()
        return WorkerRecord.model_validate(dict(row))

    def update_worker(self, worker_id: int, **fields: Any) -> WorkerRecord:
        sets = ", ".join(f"{k} = ?" for k in fields)
        with self._conn() as c:
            c.execute(f"UPDATE gpu_workers SET {sets} WHERE id = ?", (*fields.values(), worker_id))
            row = c.execute("SELECT * FROM gpu_workers WHERE id = ?", (worker_id,)).fetchone()
        return WorkerRecord.model_validate(dict(row))

    def get_worker(self, worker_id: int) -> WorkerRecord | None:
        with self._conn() as c:
            row = c.execute("SELECT * FROM gpu_workers WHERE id = ?", (worker_id,)).fetchone()
        return WorkerRecord.model_validate(dict(row)) if row else None

    def latest_worker(self) -> WorkerRecord | None:
        with self._conn() as c:
            row = c.execute("SELECT * FROM gpu_workers ORDER BY id DESC LIMIT 1").fetchone()
        return WorkerRecord.model_validate(dict(row)) if row else None

    # -- boot-log evidence ----------------------------------------------------- #
    def save_boot_log(self, worker_id: int, instance_id: str, captured_at: float, body: dict[str, Any]) -> None:
        """Keep the last successful diagnostics snapshot per worker (outlives the instance)."""
        with self._conn() as c:
            c.execute("INSERT INTO gpu_boot_logs (worker_id, instance_id, captured_at, body) VALUES (?, ?, ?, ?) "
                      "ON CONFLICT(worker_id) DO UPDATE SET instance_id = excluded.instance_id, "
                      "captured_at = excluded.captured_at, body = excluded.body",
                      (worker_id, instance_id, captured_at, json.dumps(body)))

    def get_boot_log(self, worker_id: int) -> dict[str, Any] | None:
        with self._conn() as c:
            row = c.execute("SELECT * FROM gpu_boot_logs WHERE worker_id = ?", (worker_id,)).fetchone()
        if row is None:
            return None
        return {**json.loads(row["body"]), "worker_id": row["worker_id"], "instance_id": row["instance_id"],
                "captured_at": row["captured_at"], "stored": True}

    # -- ledger -------------------------------------------------------------- #
    def open_ledger(self, w: WorkerRecord) -> int:
        with self._conn() as c:
            cur = c.execute(
                "INSERT INTO gpu_ledger (instance_id, instance_type, region, price_cents_per_hour, started_at) "
                "VALUES (?, ?, ?, ?, ?)", (w.instance_id, w.instance_type, w.region, w.price_cents_per_hour,
                                            w.launched_at))
            return int(cur.lastrowid)

    def close_ledger(self, instance_id: str, ended_at: float, reason: str) -> None:
        with self._conn() as c:
            for row in c.execute("SELECT id, price_cents_per_hour, started_at FROM gpu_ledger "
                                 "WHERE instance_id = ? AND ended_at IS NULL", (instance_id,)).fetchall():
                hours = max(0.0, ended_at - row["started_at"]) / 3600.0
                cost = round(hours * row["price_cents_per_hour"] / 100.0, 6)
                c.execute("UPDATE gpu_ledger SET ended_at = ?, cost_usd = ?, reason = ? WHERE id = ?",
                          (ended_at, cost, reason, row["id"]))

    def ledger(self, limit: int = 100) -> list[LedgerEntry]:
        with self._conn() as c:
            rows = c.execute("SELECT * FROM gpu_ledger ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        return [LedgerEntry.model_validate(dict(r)) for r in rows]

    def spent_usd(self, since: float, now: float) -> float:
        """Cost accrued inside [since, now], including still-running entries."""
        total = 0.0
        with self._conn() as c:
            rows = c.execute("SELECT price_cents_per_hour, started_at, ended_at FROM gpu_ledger "
                             "WHERE started_at <= ? AND (ended_at IS NULL OR ended_at >= ?)",
                             (now, since)).fetchall()
        for r in rows:
            end = min(r["ended_at"] if r["ended_at"] is not None else now, now)
            start = max(r["started_at"], since)
            total += max(0.0, end - start) / 3600.0 * r["price_cents_per_hour"] / 100.0
        return round(total, 6)


# --------------------------------------------------------------------------- #
# Manager                                                                      #
# --------------------------------------------------------------------------- #
class WorkerManager:
    """A pool of on-demand workers (``policy.max_workers``, default 3).

    * ``ensure_worker`` returns the least-loaded healthy ready worker, launching the first one
      when the pool is empty;
    * ``llm_endpoint`` balances LLM, TTS and STT traffic across ready workers by load (requests in
      flight from ``begin``/``end`` plus live calls from ``set_calls``, per GPU);
    * ``maybe_scale_up`` launches one more worker in the background when every ready worker is
      saturated (a live call refused for lack of a slot, or requests in flight at
      ``llm_queue_per_worker`` per GPU) and the pool is below ``max_workers``;
    * the reaper stops each worker on its own idle window, so the pool falls back to nothing.
    """

    def __init__(self, settings: Settings, *, store: WorkerStore | None = None,
                 client: LambdaCloudClient | None = None, http_client: httpx.AsyncClient | None = None,
                 template_path: Path | str = DEFAULT_TEMPLATE,
                 clock: Callable[[], float] = time.time,
                 sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
                 poll_interval_s: float = 5.0, boot_timeout_s: float = 900.0,
                 ready_timeout_s: float = 1500.0, boot_log_interval_s: float = 60.0,
                 health_ttl_s: float = 30.0, call_refusal_window_s: float = 120.0,
                 calls_ttl_s: float = 120.0):
        self.settings = settings
        self.store = store or WorkerStore(settings.acudx_db_path)
        self._client = client
        self._http = http_client
        self.template_path = Path(template_path)
        self._clock = clock
        self._sleep = sleep
        self.poll_interval_s = poll_interval_s
        self.boot_timeout_s = boot_timeout_s
        self.ready_timeout_s = ready_timeout_s
        self.boot_log_interval_s = boot_log_interval_s
        self._last_probe: dict[int, str] = {}
        # A ready worker that answered /healthz (or served a request) is trusted for this long without
        # another probe. Every TTS, STT and LLM resolution used to pay one bearer /healthz round trip
        # before the real request (about 0.5 s on the patient's speak path through an egress proxy).
        self.health_ttl_s = health_ttl_s
        self._healthy_until: dict[int, float] = {}
        self._lock = asyncio.Lock()
        # Readiness waits and launches, per worker row; ``_inflight`` is the most recent one.
        self._tasks: dict[int, asyncio.Task[WorkerRecord]] = {}
        self._inflight: asyncio.Task[WorkerRecord] | None = None
        self._launching = 0                      # launches that have not inserted their row yet
        self._reaper_watches: set[int] = set()   # boots the reaper re-attached to (after a restart)
        self._reaper: asyncio.Task[None] | None = None
        # Load per worker domain: requests in flight, live calls the runner reports.
        self._requests: dict[str, int] = {}
        self._calls: dict[str, int] = {}
        # When each live-call count was reported. The runner's count arrives only when a call starts
        # (pick_worker), so a count older than ``calls_ttl_s`` reads as 0: a stale report must never
        # pin a worker against the idle reaper (a live call keeps touching the idle window anyway).
        self._calls_at: dict[str, float] = {}
        self.calls_ttl_s = calls_ttl_s
        self._rr = 0
        self.call_refusal_window_s = call_refusal_window_s
        self._call_refused_at: float | None = None
        self.last_scale_up: dict[str, Any] | None = None
        # Instances named like ours that no active row owns (orphan sweep): instance id -> sweeps seen.
        self.orphan_sweep_interval_s = 300.0
        self.orphan_min_age_s = 600.0
        self._orphan_seen: dict[str, int] = {}
        self._last_sweep: float | None = None
        saved = self.store.get_policy()
        # A policy saved from the admin panel (SQLite) wins over the env; log_policy says which applies.
        self.policy_source = "saved" if saved is not None else "env"
        self._policy = saved or WorkerPolicy(
            idle_minutes=settings.gpu_idle_minutes, daily_budget_usd=settings.gpu_daily_budget_usd,
            allowlist=settings.gpu_instance_allowlist or DEFAULT_ALLOWLIST, llm_model=settings.gpu_llm_model,
            region_preference=settings.gpu_region_preference,
            file_system_name=settings.gpu_file_system_name or None,
            max_workers=int(getattr(settings, "gpu_max_workers", 3)),
            max_lifetime_hours=float(getattr(settings, "gpu_max_lifetime_hours", 6.0)),
            min_gpu_memory_gb=int(getattr(settings, "gpu_min_gpu_memory_gb", 40)),
        )

    # -- policy -------------------------------------------------------------- #
    @property
    def policy(self) -> WorkerPolicy:
        return self._policy

    def set_policy(self, policy: WorkerPolicy) -> WorkerPolicy:
        self.store.set_policy(policy)
        self._policy = policy
        self.policy_source = "saved"
        return policy

    def log_policy(self) -> str:
        """Log the policy in effect (a saved policy overrides GPU_* env values, so the env alone
        does not tell an operator what the reaper enforces). Returns the logged line."""
        p = self.policy
        line = (f"gpu policy ({'saved in SQLite, overrides env' if self.policy_source == 'saved' else 'from env'}): "
                f"idle_minutes={p.idle_minutes} max_workers={p.max_workers} "
                f"max_lifetime_hours={p.max_lifetime_hours:g} daily_budget_usd="
                f"{'none' if p.daily_budget_usd is None else f'{p.daily_budget_usd:g}'}")
        log.info(line)
        return line

    # -- configuration gates ------------------------------------------------- #
    @property
    def configured(self) -> bool:
        return bool(self.settings.lambda_key and self.settings.lambda_ssh_key_name)

    def _refusal(self) -> WorkerRefused | None:
        if self.settings.airgapped:
            return AirgappedRefused("AIRGAPPED=true: the gateway refuses to launch cloud GPU capacity "
                                    "(fail closed). Set AIRGAPPED=false to allow Lambda Cloud egress.")
        if not self.settings.lambda_key:
            return NotConfigured("LAMBDA_KEY (or LAMBDA_API_KEY) is not set")
        if not self.settings.lambda_ssh_key_name:
            return NotConfigured("LAMBDA_SSH_KEY_NAME is not set (launch needs exactly one ssh key name)")
        return None

    def _lambda(self) -> LambdaCloudClient:
        if self._client is None:
            self._client = LambdaCloudClient(self.settings.lambda_key or "")
        return self._client

    def _probe_client(self) -> httpx.AsyncClient:
        if self._http is None:
            self._http = httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=5.0))
        return self._http

    async def aclose(self) -> None:
        await self.stop_reaper()
        for t in list(self._tasks.values()):
            if not t.done():
                t.cancel()
        self._tasks.clear()
        if self._client is not None:
            await self._client.aclose()
            self._client = None
        if self._http is not None:
            await self._http.aclose()
            self._http = None

    # -- cost ---------------------------------------------------------------- #
    def spent_today_usd(self) -> float:
        now = self._clock()
        return self.store.spent_usd(_day_start(now), now)

    def _check_budget(self, price_cents_per_hour: int) -> None:
        if self.policy.daily_budget_usd is None:
            return
        spent = self.spent_today_usd()
        projected = spent + price_cents_per_hour / 100.0
        if projected > self.policy.daily_budget_usd:
            raise BudgetExceeded(
                f"daily budget {self.policy.daily_budget_usd:.2f} USD would be exceeded: "
                f"spent {spent:.2f} USD today, next hour costs {price_cents_per_hour / 100:.2f} USD")

    # -- load ------------------------------------------------------------------ #
    @staticmethod
    def _domain_of(ref: str | None) -> str:
        """A domain, an origin or any worker URL -> the worker domain."""
        ref = (ref or "").strip()
        if "://" in ref:
            ref = ref.split("://", 1)[1]
        return ref.split("/", 1)[0]

    def _by_domain(self, ref: str | None) -> WorkerRecord | None:
        d = self._domain_of(ref)
        if not d:
            return None
        return next((w for w in self.store.active_workers() if w.domain == d), None)

    def begin(self, ref: str | None) -> None:
        """A request (LLM, TTS, STT, image generation) started on the worker at ``ref``."""
        d = self._domain_of(ref)
        if d:
            self._requests[d] = self._requests.get(d, 0) + 1

    def end(self, ref: str | None) -> None:
        d = self._domain_of(ref)
        if d and self._requests.get(d):
            self._requests[d] -= 1

    def set_calls(self, ref: str | None, calls: int) -> None:
        """Live avatar calls on the worker at ``ref`` (from the runner's /health and the gateway)."""
        d = self._domain_of(ref)
        if d:
            self._calls[d] = max(0, int(calls))
            self._calls_at[d] = self._clock()

    def call_ended(self, ref: str | None) -> None:
        """A live call on the worker at ``ref`` ended (POST /avatar/end): drop it from the count."""
        d = self._domain_of(ref)
        if d and self._calls.get(d):
            self._calls[d] -= 1

    def _live_calls(self, d: str) -> int:
        at = self._calls_at.get(d)
        if at is None or self._clock() - at > self.calls_ttl_s:
            return 0
        return self._calls.get(d, 0)

    def note_call_refused(self) -> None:
        """A live call found no free slot on any ready worker: the pool needs another one."""
        self._call_refused_at = self._clock()

    def load_of(self, w: WorkerRecord) -> dict[str, Any]:
        d = w.domain or ""
        inflight, calls = self._requests.get(d, 0), self._live_calls(d)
        gpus = gpus_for(w.instance_type)
        # A live call holds a GPU stream for minutes; count it like a few queued requests.
        return {"inflight": inflight, "calls": calls, "gpus": gpus,
                "score": round((inflight + 3 * calls) / gpus, 3)}

    def ready_workers(self) -> list[WorkerRecord]:
        return [w for w in self.store.active_workers() if w.status == "ready" and w.domain]

    def _pick(self, ready: list[WorkerRecord]) -> WorkerRecord | None:
        if not ready:
            return None
        self._rr += 1
        n = len(ready)
        # Least load first; ties go round robin so idle workers share new traffic.
        order = sorted(range(n), key=lambda i: (self.load_of(ready[i])["score"], (i - self._rr) % n))
        return ready[order[0]]

    def scale_up_needed(self) -> str | None:
        """Why the pool should grow now (``calls`` | ``llm_queue``), or None."""
        active = self.store.active_workers()
        if len(active) + self._launching >= self.policy.max_workers:
            return None
        if any(w.status != "ready" for w in active) or self._launching:
            return None   # one launch at a time; it absorbs the pressure that asked for it
        ready = [w for w in active if w.status == "ready"]
        if not ready:
            return None   # an empty pool launches through ensure_worker
        now = self._clock()
        if self._call_refused_at is not None and now - self._call_refused_at <= self.call_refusal_window_s:
            return "calls"
        cap = self.policy.llm_queue_per_worker
        if all(self.load_of(w)["inflight"] >= cap * gpus_for(w.instance_type) for w in ready):
            return "llm_queue"
        return None

    async def maybe_scale_up(self, *, force: str | None = None) -> str | None:
        """Launch one more worker in the background when the pool is saturated (or ``force``).
        Returns the reason a launch started, else None. Never waits for the boot."""
        async with self._lock:
            if self._refusal() is not None:
                return None
            reason = force or self.scale_up_needed()
            if reason is None:
                return None
            if len(self.store.active_workers()) + self._launching >= self.policy.max_workers:
                return None
            self._launching += 1
            task = asyncio.create_task(self._launch())
            self._inflight = task
            self.last_scale_up = {"reason": reason, "at": self._clock()}
            if reason == "calls":
                self._call_refused_at = None
        log.info("gpu pool: launching another worker (%s)", reason)

        def done(t: asyncio.Task[WorkerRecord]) -> None:
            if not t.cancelled() and t.exception() is not None:
                log.warning("gpu pool: scale-up launch failed: %s", t.exception())
                if self.last_scale_up is not None:   # shown in /admin/gpu/status capacity.last_scale_up
                    self.last_scale_up["error"] = str(t.exception())[:300]

        task.add_done_callback(done)
        return reason

    # -- public API ---------------------------------------------------------- #
    def touch(self, ref: str | None = None) -> None:
        """Record a request that used a worker (resets its idle window). ``ref`` is the worker's
        domain or any of its URLs; without it the most recently used ready worker is touched."""
        w = self._by_domain(ref) if ref else None
        if w is None and not ref:
            ready = self.ready_workers()
            w = max(ready, key=lambda r: r.last_used_at) if ready else self.store.active_worker()
        if w is not None:
            now = self._clock()
            self.store.update_worker(w.id, last_used_at=now)
            if w.status == "ready":
                self._healthy_until[w.id] = now + self.health_ttl_s

    def endpoint_for(self, w: WorkerRecord) -> dict[str, Any]:
        return {"base_url": f"https://{w.domain}/v1", "api_key": w.token, "model": SERVED_MODEL_NAME,
                "worker_id": w.id, "domain": w.domain, "instance_type": w.instance_type,
                "gpus": gpus_for(w.instance_type)}

    def llm_endpoint(self) -> dict[str, Any] | None:
        """Internal consumers only: carries the bearer token. The least-loaded ready worker."""
        w = self._pick(self.ready_workers())
        return self.endpoint_for(w) if w is not None else None

    def endpoints(self) -> list[dict[str, Any]]:
        """Every ready worker's endpoint, least loaded first (internal: carries the bearer)."""
        ready = self.ready_workers()
        ready.sort(key=lambda w: self.load_of(w)["score"])
        return [self.endpoint_for(w) for w in ready]

    def endpoint_by_origin(self, origin: str | None) -> dict[str, Any] | None:
        w = self._by_domain(origin)
        return self.endpoint_for(w) if w is not None and w.status == "ready" else None

    async def status(self) -> dict[str, Any]:
        refusal = self._refusal()
        active = self.store.active_workers()
        primary = self.store.active_worker()
        spent = self.spent_today_usd()
        workers = []
        for w in active:
            d = w.public()
            d["load"] = self.load_of(w)
            workers.append(d)
        return {
            "configured": self.configured,
            "airgapped": self.settings.airgapped,
            "can_launch": refusal is None,
            "refusal": None if refusal is None else {"reason": refusal.reason, "message": str(refusal)},
            "policy": self.policy.model_dump(),
            "worker": primary.public() if primary else None,
            "workers": workers,
            "capacity": {"workers": len(active), "ready": sum(1 for w in active if w.status == "ready"),
                         "launching": self._launching, "max_workers": self.policy.max_workers,
                         "gpus": sum(gpus_for(w.instance_type) for w in active),
                         "scale_up_needed": self.scale_up_needed(), "last_scale_up": self.last_scale_up},
            "spent_today_usd": spent,
            "budget_remaining_usd": (None if self.policy.daily_budget_usd is None
                                     else round(max(0.0, self.policy.daily_budget_usd - spent), 6)),
            "reaper_running": self.reaper_running,
        }

    def _watch(self, w: WorkerRecord) -> asyncio.Task[WorkerRecord]:
        t = self._tasks.get(w.id)
        if t is None or t.done():
            t = asyncio.create_task(self._wait_ready(w))
            self._tasks[w.id] = t
            self._inflight = t
        return t

    async def ensure_worker(self) -> WorkerRecord:
        """Return a healthy worker (the least loaded), launching one if the pool is empty. Raises
        :class:`WorkerRefused`.

        The lock only guards the decision; a launch or readiness wait runs as a shared task that
        every concurrent caller awaits (shielded, so a caller that disconnects never cancels the boot
        or triggers an early termination).
        """
        async with self._lock:
            refusal = self._refusal()
            if refusal is not None:
                raise refusal
            now = self._clock()
            ready = self.ready_workers()
            while ready:
                w = self._pick(ready)
                assert w is not None
                if now < self._healthy_until.get(w.id, 0.0) or await self._healthy(w):
                    self._healthy_until[w.id] = max(self._healthy_until.get(w.id, 0.0), now + self.health_ttl_s)
                    picked = self.store.update_worker(w.id, last_used_at=now)
                    break
                self._healthy_until.pop(w.id, None)
                ready = [r for r in ready if r.id != w.id]
            else:
                picked = None
            if picked is not None:
                task = None
            else:
                pending = [w for w in self.store.active_workers() if w.status != "ready"]
                stale_ready = [w for w in self.store.active_workers() if w.status == "ready"]
                waits = [self._watch(w) for w in pending + stale_ready]
                if not waits and self.policy.max_workers < 1:
                    raise LaunchDisabled("GPU worker launches are disabled (policy max_workers=0)")
                if not waits:
                    launching = self._launching > 0 and self._inflight is not None and not self._inflight.done()
                    if not launching:
                        self._launching += 1
                        self._inflight = asyncio.create_task(self._launch())
                    waits = [self._inflight]
                task = waits[0] if len(waits) == 1 else asyncio.ensure_future(self._first_ready(waits))
        if task is None:
            assert picked is not None
            asyncio.get_running_loop().create_task(self._scale_quietly())
            return picked
        return await asyncio.shield(task)

    async def _first_ready(self, tasks: list[asyncio.Task[WorkerRecord]]) -> WorkerRecord:
        last: BaseException | None = None
        pending = set(tasks)
        while pending:
            done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
            for t in done:
                if t.cancelled():
                    continue
                if t.exception() is None:
                    return t.result()
                last = t.exception()
        raise last if last is not None else WorkerFailed("no worker became ready")

    async def _scale_quietly(self) -> None:
        try:
            await self.maybe_scale_up()
        except Exception:  # noqa: BLE001 - scaling is best effort; the request already has a worker
            log.exception("gpu pool: scale-up check failed")

    async def terminate(self, reason: str = "admin", *, worker_id: int | None = None) -> WorkerRecord | None:
        """Stop one worker (``worker_id``) or every active worker. Returns the (last) stopped row."""
        targets = self.store.active_workers()
        if worker_id is not None:
            targets = [w for w in targets if w.id == worker_id]
        current = asyncio.current_task()
        for w in targets:
            t = self._tasks.pop(w.id, None)
            if t is not None and not t.done() and t is not current:
                t.cancel()
        if worker_id is None:
            inflight = self._inflight
            if inflight is not None and not inflight.done() and inflight is not current:
                inflight.cancel()
            self._inflight = None
        elif self._inflight is not None and self._inflight.done():
            self._inflight = None
        last: WorkerRecord | None = None
        for w in targets:
            last = await self._terminate_one(w, reason)
        return last

    async def _terminate_one(self, w: WorkerRecord, reason: str) -> WorkerRecord:
        now = self._clock()
        self.store.update_worker(w.id, status="terminating")
        try:
            await self._lambda().terminate([w.instance_id])
        except (LambdaCloudError, httpx.HTTPError) as exc:
            # Already gone on the provider side is fine; anything else must surface. The row stays
            # ``terminating`` (it no longer takes traffic, its ledger stays open) and every reaper
            # pass retries the stop until Lambda confirms it.
            if not (isinstance(exc, LambdaCloudError) and exc.not_found):
                log.warning("gpu worker %s: terminate failed (%s); the reaper retries", w.instance_id,
                            exc if isinstance(exc, LambdaCloudError) else type(exc).__name__)
                raise
        self.store.close_ledger(w.instance_id, now, reason)
        self._healthy_until.pop(w.id, None)
        if w.domain:
            self._requests.pop(w.domain, None)
            self._calls.pop(w.domain, None)
            self._calls_at.pop(w.domain, None)
        log.info("gpu worker %s terminated (%s) after %.0fs", w.instance_id, reason, now - w.launched_at)
        return self.store.update_worker(w.id, status="terminated", terminated_at=now)

    # -- idle reaper --------------------------------------------------------- #
    async def reap_once(self) -> bool:
        """One reaper pass over every worker. Each one is terminated when it is idle past the policy
        window, when it has run for ``max_lifetime_hours`` (whatever its load), when today's spend has
        reached the daily budget (the launch-time check alone lets a worker that is kept busy run past
        the cap), or when a boot has been orphaned (the gateway restarted mid-boot and no request
        re-attached) for longer than both boot budgets. Rows left ``terminating`` by a failed stop are
        retried first. Returns True when any worker was stopped."""
        stopped = False
        for w in self.store.workers_in("terminating"):
            # A stop that failed earlier (provider or network error): retry until Lambda confirms it.
            try:
                await self._terminate_one(w, "terminate_retry")
                stopped = True
            except (LambdaCloudError, httpx.HTTPError):
                pass   # logged by _terminate_one; next pass retries
        for w in self.store.active_workers():
            try:
                stopped = await self._reap(w) or stopped
            except (LambdaCloudError, httpx.HTTPError) as exc:
                log.warning("gpu worker %s: reaper stop failed: %s", w.instance_id,
                            exc if isinstance(exc, LambdaCloudError) else type(exc).__name__)
        return stopped

    async def _reap(self, w: WorkerRecord) -> bool:
        now = self._clock()
        lifetime_s = self.policy.max_lifetime_hours * 3600
        if now - w.launched_at >= lifetime_s:
            # Regardless of load: the last line of defence against a worker that never goes idle.
            t = self._tasks.get(w.id)
            if t is not None and not t.done() and t is not asyncio.current_task():
                t.cancel()
            log.warning("gpu worker %s: running %.1f h >= max lifetime %g h; terminating", w.instance_id,
                        (now - w.launched_at) / 3600, self.policy.max_lifetime_hours)
            await self._terminate_one(w, "max_lifetime")
            return True
        if w.status in ("booting", "launching"):
            # Boot time is never idle time; a boot that an in-flight task is still watching is
            # bounded by ready_timeout_s. Without a watcher (process restart) nothing else would
            # ever terminate it, so the reaper does once both budgets have elapsed.
            t = self._tasks.get(w.id)
            watched = (t is not None and not t.done()) or (self._inflight is not None and not self._inflight.done())
            within = now - w.launched_at < self.boot_timeout_s + self.ready_timeout_s
            if watched and (within or w.id not in self._reaper_watches):
                return False
            if within:
                # A boot nobody waits for (the gateway restarted while a scale-up worker booted, and the
                # pool already had a ready worker, so no request re-attached): watch it, or it would
                # never turn ready and never take traffic.
                self._watch(w)
                self._reaper_watches.add(w.id)
                return False
            if t is not None and not t.done():
                t.cancel()
            log.warning("gpu worker %s: orphaned boot older than %.0fs; terminating", w.instance_id,
                        self.boot_timeout_s + self.ready_timeout_s)
            await self._terminate_one(w, "stale_boot")
            return True
        if w.status == "ready" and await self.reconcile(w):
            return True
        spent = self.spent_today_usd()
        if self.policy.daily_budget_usd is not None and spent >= self.policy.daily_budget_usd:
            log.warning("gpu worker %s: spent %.2f USD today >= budget %.2f USD; terminating", w.instance_id,
                        spent, self.policy.daily_budget_usd)
            await self._terminate_one(w, "budget")
            return True
        load = self.load_of(w)
        if load["calls"] or load["inflight"]:
            return False
        idle_s = now - w.last_used_at
        if idle_s < self.policy.idle_minutes * 60:
            return False
        log.info("gpu worker %s idle for %.0fs > %d min; terminating", w.instance_id, idle_s,
                 self.policy.idle_minutes)
        await self._terminate_one(w, "idle")
        return True

    async def reconcile(self, w: WorkerRecord) -> bool:
        """Review 04 O4: compare the row with the provider. When Lambda reports the instance
        terminated, terminating or preempted, or no longer knows it (404), close the ledger and
        mark the row failed at once, instead of booking cost until the idle window and blocking
        ``ensure_worker`` in a 25 minute readiness wait. Returns True when the row was closed.

        Lambda's instance object carries no termination timestamp, so the ledger closes at the
        time the gateway observed the provider state (at most one reaper interval late, which
        errs on the side of the budget). A provider error other than not-found changes nothing.
        """
        try:
            inst = await self._lambda().get_instance(w.instance_id)
            gone = inst.status if inst.status in PROVIDER_GONE_STATUSES else None
        except LambdaCloudError as exc:
            if not exc.not_found:
                log.warning("gpu worker %s: provider reconcile failed: %s", w.instance_id, exc)
                return False
            gone = "missing"
        except httpx.HTTPError as exc:
            log.warning("gpu worker %s: provider reconcile unreachable: %s", w.instance_id, type(exc).__name__)
            return False
        if gone is None:
            return False
        now = self._clock()
        log.warning("gpu worker %s: provider reports %s; closing the ledger", w.instance_id, gone)
        self.store.close_ledger(w.instance_id, now, f"provider:{gone}")
        self.store.update_worker(w.id, status="failed", terminated_at=now)
        return True

    # -- orphan sweep ---------------------------------------------------------- #
    @staticmethod
    def is_worker_instance(inst: Instance) -> bool:
        """An AcuDx worker: named ``acudx-worker-*``, or nameless and tagged ``acudx=gpu-worker``.
        Anything else on the account (``acudx-wm-*``, hand-made boxes) is never a worker."""
        if inst.name:
            return inst.name.startswith(WORKER_NAME_PREFIX)
        return any(t.key == WORKER_TAG["key"] and t.value == WORKER_TAG["value"] for t in inst.tags)

    @staticmethod
    def owner_of(inst: Instance) -> str | None:
        """The id of the gateway that launched a worker (its tag, else ``-g<id>-`` in its name)."""
        for t in inst.tags:
            if t.key == GATEWAY_TAG_KEY:
                return t.value
        m = re.match(rf"^{re.escape(WORKER_NAME_PREFIX)}\d{{9,}}-g([0-9a-f]{{8}})-", inst.name or "")
        return m.group(1) if m else None

    def is_own_worker(self, inst: Instance) -> bool:
        """A worker this gateway launched. One without any gateway id (launched before ids existed)
        counts only with ``GPU_SWEEP_UNOWNED=true``: another gateway on the same account (production
        beside a staging gateway) may own it."""
        if not self.is_worker_instance(inst):
            return False
        owner = self.owner_of(inst)
        if owner is None:
            return bool(getattr(self.settings, "gpu_sweep_unowned", False))
        return owner == self.store.gateway_id()

    @staticmethod
    def _launched_at(inst: Instance) -> float | None:
        """Launch time from the name ``acudx-worker-<epoch>-<hex>`` (Lambda reports none), else None."""
        m = re.match(rf"^{re.escape(WORKER_NAME_PREFIX)}(\d{{9,}})-", inst.name or "")
        return float(m.group(1)) if m else None

    async def sweep_orphans(self) -> list[str]:
        """Terminate worker instances that Lambda runs but no active row owns (a launch whose row was
        lost, a restore from an old database, a stop that never reached Lambda before the row was
        closed). Only :meth:`is_worker_instance` matches are considered, and only when older than
        ``orphan_min_age_s`` by the launch time in their name; one without a readable launch time must
        be seen orphaned on two consecutive sweeps. Returns the terminated instance ids."""
        if self.settings.airgapped or not self.settings.lambda_key:
            return []
        self._last_sweep = self._clock()
        try:
            instances = await self._lambda().list_instances()
        except (LambdaCloudError, httpx.HTTPError) as exc:
            log.warning("gpu orphan sweep: listing instances failed: %s",
                        exc if isinstance(exc, LambdaCloudError) else type(exc).__name__)
            return []
        owned = {w.instance_id for w in self.store.workers_in(*ACTIVE_STATUSES, "terminating")}
        now = self._clock()
        seen: dict[str, int] = {}
        doomed: list[Instance] = []
        for inst in instances:
            if not self.is_own_worker(inst) or inst.id in owned or inst.status in PROVIDER_GONE_STATUSES:
                continue
            launched = self._launched_at(inst)
            if launched is not None:
                if now - launched >= self.orphan_min_age_s:
                    doomed.append(inst)
                continue
            if self._launching:
                continue   # a launch in flight may own it before its row exists
            seen[inst.id] = self._orphan_seen.get(inst.id, 0) + 1
            if seen[inst.id] >= 2:
                doomed.append(inst)
        self._orphan_seen = seen
        stopped: list[str] = []
        for inst in doomed:
            try:
                await self._lambda().terminate([inst.id])
            except (LambdaCloudError, httpx.HTTPError) as exc:
                if not (isinstance(exc, LambdaCloudError) and exc.not_found):
                    log.warning("gpu orphan sweep: terminate %s failed: %s", inst.id,
                                exc if isinstance(exc, LambdaCloudError) else type(exc).__name__)
                    continue
            self._orphan_seen.pop(inst.id, None)
            self.store.close_ledger(inst.id, now, "orphan")
            log.warning("gpu orphan sweep: terminated %s (%s, no active row)", inst.id, inst.name or "unnamed")
            stopped.append(inst.id)
        return stopped

    @property
    def reaper_running(self) -> bool:
        return self._reaper is not None and not self._reaper.done()

    def start_reaper(self, interval_s: float = 60.0) -> None:
        if self.reaper_running:
            return
        self.log_policy()

        async def loop() -> None:
            while True:
                try:
                    await self.reap_once()
                    if self._last_sweep is None or self._clock() - self._last_sweep >= self.orphan_sweep_interval_s:
                        await self.sweep_orphans()   # on start, then every orphan_sweep_interval_s
                    await self.maybe_scale_up()
                except Exception:  # noqa: BLE001 - the reaper must survive provider hiccups
                    log.exception("gpu worker reaper iteration failed")
                await asyncio.sleep(interval_s)

        self._reaper = asyncio.get_running_loop().create_task(loop(), name="acudx-gpu-reaper")

    async def stop_reaper(self) -> None:
        if self._reaper is None:
            return
        self._reaper.cancel()
        try:
            await self._reaper
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass
        self._reaper = None

    # -- launch pipeline ----------------------------------------------------- #
    async def _ensure_firewall(self) -> None:
        api = self._lambda()
        existing = await api.get_firewall_rules()
        merged, changed = merge_firewall_rules(existing, WORKER_FIREWALL_RULES)
        if changed:
            await api.put_firewall_rules(merged)
            log.info("firewall: appended %d rule(s), kept %d", len(merged) - len(existing), len(existing))

    async def _launch(self) -> WorkerRecord:
        """Launch one worker and wait for it. The caller counted it in ``_launching``; the count is
        released once the row exists (it then counts as an active worker) or the launch fails."""
        released = False

        def release() -> None:
            nonlocal released
            if not released:
                released = True
                self._launching = max(0, self._launching - 1)

        try:
            return await self._launch_inner(release)
        finally:
            release()

    async def _launch_inner(self, row_created: Callable[[], None]) -> WorkerRecord:
        api = self._lambda()
        offers = await api.list_instance_types()
        region_pref = list(self.policy.region_preference)
        fs_names: list[str] = []
        if self.policy.file_system_name:
            for fs in await api.list_file_systems():
                if fs.get("name") == self.policy.file_system_name:
                    fs_region = (fs.get("region") or {}).get("name")
                    if fs_region:
                        region_pref = [fs_region]
                        fs_names = [self.policy.file_system_name]
                    break
        min_gb = self.policy.min_gpu_memory_gb
        choice = pick_cheapest(offers, self.policy.allowlist, region_pref, min_gpu_memory_gb=min_gb)
        if choice is None:
            raise NoCapacity(f"no capacity for any allow-listed type {self.policy.allowlist}"
                             + (f" with {min_gb} GB or more per GPU" if min_gb else "")
                             + (f" in regions {self.policy.region_preference}" if self.policy.region_preference else ""))
        offer = offers.get(choice.instance_type_name)
        llm_model = llm_model_for(self.policy.llm_model, gpu_memory_gb(offer.instance_type) if offer else None)
        self._check_budget(choice.price_cents_per_hour)
        await self._ensure_firewall()

        token = secrets.token_urlsafe(32)
        user_data = render_cloud_init(self.template_path.read_text(encoding="utf-8"),
                                      token=token, llm_model=llm_model, domain="auto")
        now = self._clock()
        gid = self.store.gateway_id()
        ids = await api.launch(
            region_name=choice.region_name, instance_type_name=choice.instance_type_name,
            ssh_key_name=self.settings.lambda_ssh_key_name or "",
            name=f"{WORKER_NAME_PREFIX}{int(now)}-g{gid}-{secrets.token_hex(2)}",
            user_data=user_data, tags=[dict(WORKER_TAG), {"key": GATEWAY_TAG_KEY, "value": gid}],
            file_system_names=fs_names or None, image_family=WORKER_IMAGE_FAMILY,
        )
        if not ids:
            raise WorkerFailed("launch returned no instance id")
        w = self.store.insert_worker(
            instance_id=ids[0], instance_type=choice.instance_type_name, region=choice.region_name,
            token=token, status="booting", price_cents_per_hour=choice.price_cents_per_hour,
            launched_at=now, last_used_at=now,
        )
        self.store.open_ledger(w)
        row_created()
        current = asyncio.current_task()
        if current is not None:
            self._tasks[w.id] = current  # type: ignore[assignment]
        log.info("launched %s (%s @ %s, %d c/h)", w.instance_id, w.instance_type, w.region,
                 w.price_cents_per_hour)
        return await self._wait_ready(w)

    def _attempts(self, timeout_s: float) -> int:
        return max(1, int(timeout_s / max(self.poll_interval_s, 1.0)))

    async def _wait_ready(self, w: WorkerRecord) -> WorkerRecord:
        api = self._lambda()
        t0 = self._clock()
        log.info("gpu worker %s: waiting for readiness (boot budget %.0fs, ready budget %.0fs, poll %.0fs)",
                 w.instance_id, self.boot_timeout_s, self.ready_timeout_s, self.poll_interval_s)
        if w.ip and w.status == "ready" and await self.reconcile(w):
            # Re-attaching to a ready row whose instance is gone: fail now, not after ready_timeout_s.
            raise WorkerFailed(f"instance {w.instance_id} is no longer running on the provider side")
        if not w.ip:
            for _ in range(self._attempts(self.boot_timeout_s)):
                inst = await api.get_instance(w.instance_id)
                if inst.status in PROVIDER_GONE_STATUSES:
                    self.store.close_ledger(w.instance_id, self._clock(), f"provider:{inst.status}")
                    self.store.update_worker(w.id, status="failed", terminated_at=self._clock())
                    raise WorkerFailed(f"instance {w.instance_id} is {inst.status} on the provider side")
                if inst.status == "active" and inst.ip:
                    w = self.store.update_worker(w.id, ip=inst.ip, domain=sslip_domain(inst.ip))
                    break
                await self._sleep(self.poll_interval_s)
            else:
                await self._terminate_one(w, "boot_timeout")
                raise WorkerFailed(f"instance {w.instance_id} did not become active in {self.boot_timeout_s:.0f}s")
        last_capture: float | None = None
        for _ in range(self._attempts(self.ready_timeout_s)):
            current = self.store.get_worker(w.id)
            if current is not None and current.status in ("terminating", "terminated", "failed"):
                # Stopped from the admin panel or the reaper while we waited (live finding
                # 2026-10-20: the wait kept polling a dead worker and blocked new launches).
                raise WorkerFailed(f"worker {w.instance_id} was {current.status} while waiting for readiness")
            if await self._healthy(w):
                now = self._clock()
                await self.capture_boot_log(w)
                return self.store.update_worker(w.id, status="ready", ready_at=w.ready_at or now,
                                                last_used_at=now)
            # Evidence retention: keep the latest diagnostics snapshot while waiting, so a
            # ready_timeout termination still leaves cloud-init and container status behind.
            now = self._clock()
            if last_capture is None or now - last_capture >= self.boot_log_interval_s:
                last_capture = now
                await self.capture_boot_log(w)
            await self._sleep(self.poll_interval_s)
        log.warning("gpu worker %s: /healthz never passed; elapsed %.0fs of %.0fs budget (last probe: %s)",
                    w.instance_id, self._clock() - t0, self.ready_timeout_s, self._last_probe.get(w.id, "none"))
        await self.capture_boot_log(w)
        await self._terminate_one(w, "ready_timeout")
        raise WorkerFailed(f"worker {w.domain} did not pass /healthz in {self.ready_timeout_s:.0f}s")

    async def capture_boot_log(self, w: WorkerRecord) -> bool:
        """Fetch and persist one diagnostics snapshot for ``w`` when it is readable. Never raises."""
        try:
            snap = await self.boot_log(worker=w)
        except Exception:  # noqa: BLE001 - evidence capture must never break a boot
            log.exception("gpu worker %s: boot-log capture failed", w.instance_id)
            return False
        if not snap.get("available"):
            return False
        snap["last_health_probe"] = self._last_probe.get(w.id)
        self.store.save_boot_log(w.id, w.instance_id, self._clock(), snap)
        return True

    def stored_boot_log(self, worker_id: int | None = None) -> dict[str, Any] | None:
        """The persisted snapshot for ``worker_id`` (default: the most recent worker row)."""
        if worker_id is None:
            latest = self.store.latest_worker()
            if latest is None:
                return None
            worker_id = latest.id
        return self.store.get_boot_log(worker_id)

    async def boot_log(self, tail_lines: int = 200, *, worker: WorkerRecord | None = None) -> dict[str, Any]:
        """Read the worker's redacted cloud-init output and docker status (review 04 O1).

        The files live under ``/diag/<diag_secret(token)>/``. While the worker boots they are
        served over plain HTTP on port 80 by the worker's diagnostics server; once vLLM has been
        healthy for 5 minutes that server stops itself and the final snapshot is served by Caddy
        on 443 behind the bearer. The bearer token is only ever sent over TLS, in the
        ``Authorization`` header, never in a URL. Returns {available, cloud_init, docker_status,
        source, error}; never raises.
        """
        w = worker or self.store.active_worker()
        if w is None or not w.ip:
            return {"available": False, "error": "no active worker with an ip"}
        out: dict[str, Any] = {"available": False, "worker_id": w.id, "instance_id": w.instance_id, "ip": w.ip}
        secret = diag_secret(w.token)
        plain = (f"http://{w.ip}/diag/{secret}", {})
        tls = (f"https://{w.domain}/diag/{secret}", {"Authorization": f"Bearer {w.token}"}) if w.domain else None
        # Booting: the port 80 server is the one that answers. Ready: Caddy holds the snapshot.
        sources = [s for s in ((tls, plain) if w.status == "ready" else (plain, tls)) if s is not None]
        for key, name in (("cloud_init", "cloud-init-output.log"), ("docker_status", "docker-status.txt")):
            last = "unreachable"
            for base, headers in sources:
                try:
                    r = await self._probe_client().get(f"{base}/{name}", headers=headers)
                except httpx.HTTPError as exc:
                    last = f"unreachable: {exc.__class__.__name__}"
                    continue
                if r.status_code == 200:
                    out[key] = "\n".join(r.text.splitlines()[-tail_lines:])
                    out["available"] = True
                    out.setdefault("source", "tls" if base.startswith("https://") else "port80")
                    break
                last = f"http {r.status_code}"
            else:
                out[key] = last
        return out

    async def _healthy(self, w: WorkerRecord) -> bool:
        """GET https://<domain>/healthz with the bearer. Every changed outcome is logged with the
        exception class or HTTP status, so a proxy reset (ConnectError / RemoteProtocolError
        from an egress proxy) can be told apart from the worker answering 502 or 401."""
        if not w.domain:
            return False
        try:
            r = await self._probe_client().get(f"https://{w.domain}/healthz",
                                               headers={"Authorization": f"Bearer {w.token}"})
        except httpx.HTTPError as exc:
            self._note_probe(w, f"{type(exc).__name__}: {str(exc)[:160]}")
            return False
        self._note_probe(w, f"HTTP {r.status_code}")
        return r.status_code == 200

    def _note_probe(self, w: WorkerRecord, outcome: str) -> None:
        if self._last_probe.get(w.id) != outcome:
            level = logging.INFO if outcome == "HTTP 200" else logging.WARNING
            log.log(level, "gpu worker %s: /healthz probe -> %s", w.instance_id, outcome)
        self._last_probe[w.id] = outcome
