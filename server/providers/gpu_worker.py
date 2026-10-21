"""On-demand Lambda Cloud GPU worker manager (never always-on).

Policy (docs/process/AGENT-PROTOCOL.md §2.4):

* launch only when a request needs a GPU and no healthy worker exists;
* terminate after ``idle_minutes`` without a request (idle reaper task);
* optional daily budget cap in USD (None, the default, means no cap; the idle reaper
  still stops every worker that is not in use);
* cheapest allow-listed instance type that has capacity wins;
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
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable

import httpx
from pydantic import BaseModel, Field

from server.config import Settings
from server.providers.lambda_cloud import (
    WORKER_FIREWALL_RULES,
    LambdaCloudClient,
    LambdaCloudError,
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


class WorkerFailed(WorkerRefused):
    reason = "worker_failed"


# --------------------------------------------------------------------------- #
# Models                                                                       #
# --------------------------------------------------------------------------- #
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
                """
            )

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
    def __init__(self, settings: Settings, *, store: WorkerStore | None = None,
                 client: LambdaCloudClient | None = None, http_client: httpx.AsyncClient | None = None,
                 template_path: Path | str = DEFAULT_TEMPLATE,
                 clock: Callable[[], float] = time.time,
                 sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
                 poll_interval_s: float = 5.0, boot_timeout_s: float = 900.0,
                 ready_timeout_s: float = 1500.0, boot_log_interval_s: float = 60.0,
                 health_ttl_s: float = 10.0):
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
        self._inflight: asyncio.Task[WorkerRecord] | None = None
        self._reaper: asyncio.Task[None] | None = None
        self._policy = self.store.get_policy() or WorkerPolicy(
            idle_minutes=settings.gpu_idle_minutes, daily_budget_usd=settings.gpu_daily_budget_usd,
            allowlist=settings.gpu_instance_allowlist or DEFAULT_ALLOWLIST, llm_model=settings.gpu_llm_model,
            region_preference=settings.gpu_region_preference,
            file_system_name=settings.gpu_file_system_name or None,
        )

    # -- policy -------------------------------------------------------------- #
    @property
    def policy(self) -> WorkerPolicy:
        return self._policy

    def set_policy(self, policy: WorkerPolicy) -> WorkerPolicy:
        self.store.set_policy(policy)
        self._policy = policy
        return policy

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

    # -- public API ---------------------------------------------------------- #
    def touch(self) -> None:
        """Record a request that used the worker (resets the idle window)."""
        w = self.store.active_worker()
        if w is not None:
            now = self._clock()
            self.store.update_worker(w.id, last_used_at=now)
            if w.status == "ready":
                self._healthy_until[w.id] = now + self.health_ttl_s

    def llm_endpoint(self) -> dict[str, str] | None:
        """Internal consumers only: carries the bearer token."""
        w = self.store.active_worker()
        if w is None or w.status != "ready" or not w.domain:
            return None
        return {"base_url": f"https://{w.domain}/v1", "api_key": w.token, "model": SERVED_MODEL_NAME}

    async def status(self) -> dict[str, Any]:
        refusal = self._refusal()
        w = self.store.active_worker()
        spent = self.spent_today_usd()
        return {
            "configured": self.configured,
            "airgapped": self.settings.airgapped,
            "can_launch": refusal is None,
            "refusal": None if refusal is None else {"reason": refusal.reason, "message": str(refusal)},
            "policy": self.policy.model_dump(),
            "worker": w.public() if w else None,
            "spent_today_usd": spent,
            "budget_remaining_usd": (None if self.policy.daily_budget_usd is None
                                     else round(max(0.0, self.policy.daily_budget_usd - spent), 6)),
            "reaper_running": self.reaper_running,
        }

    async def ensure_worker(self) -> WorkerRecord:
        """Return a healthy worker, launching one if needed. Raises :class:`WorkerRefused`.

        The lock only guards the decision; the launch or readiness wait runs as ONE shared
        task that every concurrent caller awaits (shielded, so a caller that disconnects
        never cancels the boot or triggers an early termination).
        """
        async with self._lock:
            refusal = self._refusal()
            if refusal is not None:
                raise refusal
            now = self._clock()
            w = self.store.active_worker()
            if w is not None and w.status == "ready":
                if now < self._healthy_until.get(w.id, 0.0):
                    return self.store.update_worker(w.id, last_used_at=now)
                if await self._healthy(w):
                    self._healthy_until[w.id] = now + self.health_ttl_s
                    return self.store.update_worker(w.id, last_used_at=now)
                self._healthy_until.pop(w.id, None)
            if self._inflight is None or self._inflight.done():
                self._inflight = asyncio.create_task(self._wait_ready(w) if w is not None else self._launch())
            task = self._inflight
        return await asyncio.shield(task)

    async def terminate(self, reason: str = "admin") -> WorkerRecord | None:
        w = self.store.active_worker()
        inflight = self._inflight
        if inflight is not None and not inflight.done() and asyncio.current_task() is not inflight:
            inflight.cancel()
            self._inflight = None
        if w is None:
            return None
        now = self._clock()
        self.store.update_worker(w.id, status="terminating")
        try:
            await self._lambda().terminate([w.instance_id])
        except LambdaCloudError as exc:
            # Already gone on the provider side is fine; anything else must surface.
            if exc.status_code != 404 and "not-found" not in exc.code:
                self.store.update_worker(w.id, status=w.status)
                raise
        self.store.close_ledger(w.instance_id, now, reason)
        log.info("gpu worker %s terminated (%s) after %.0fs", w.instance_id, reason, now - w.launched_at)
        return self.store.update_worker(w.id, status="terminated", terminated_at=now)

    # -- idle reaper --------------------------------------------------------- #
    async def reap_once(self) -> bool:
        """One reaper pass. Terminates the worker when it is idle past the policy window, when
        today's spend has reached the daily budget (the launch-time check alone lets a worker
        that is kept busy run past the cap), or when a boot has been orphaned (the gateway
        restarted mid-boot and no request re-attached) for longer than both boot budgets."""
        w = self.store.active_worker()
        if w is None:
            return False
        now = self._clock()
        if w.status == "booting":
            # Boot time is never idle time; a boot that an in-flight task is still watching is
            # bounded by ready_timeout_s. Without a watcher (process restart) nothing else would
            # ever terminate it, so the reaper does once both budgets have elapsed.
            watched = self._inflight is not None and not self._inflight.done()
            if watched or now - w.launched_at < self.boot_timeout_s + self.ready_timeout_s:
                return False
            log.warning("gpu worker %s: orphaned boot older than %.0fs; terminating", w.instance_id,
                        self.boot_timeout_s + self.ready_timeout_s)
            await self.terminate(reason="stale_boot")
            return True
        if w.status == "ready" and await self.reconcile(w):
            return True
        spent = self.spent_today_usd()
        if self.policy.daily_budget_usd is not None and spent >= self.policy.daily_budget_usd:
            log.warning("gpu worker %s: spent %.2f USD today >= budget %.2f USD; terminating", w.instance_id,
                        spent, self.policy.daily_budget_usd)
            await self.terminate(reason="budget")
            return True
        idle_s = now - w.last_used_at
        if idle_s < self.policy.idle_minutes * 60:
            return False
        log.info("gpu worker %s idle for %.0fs > %d min; terminating", w.instance_id, idle_s,
                 self.policy.idle_minutes)
        await self.terminate(reason="idle")
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
            if exc.status_code != 404 and "not-found" not in exc.code:
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

    @property
    def reaper_running(self) -> bool:
        return self._reaper is not None and not self._reaper.done()

    def start_reaper(self, interval_s: float = 60.0) -> None:
        if self.reaper_running:
            return

        async def loop() -> None:
            while True:
                try:
                    await self.reap_once()
                except Exception:  # noqa: BLE001 — the reaper must survive provider hiccups
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
        choice = pick_cheapest(offers, self.policy.allowlist, region_pref)
        if choice is None:
            raise NoCapacity(f"no capacity for any allow-listed type {self.policy.allowlist}"
                             + (f" in regions {self.policy.region_preference}" if self.policy.region_preference else ""))
        self._check_budget(choice.price_cents_per_hour)
        await self._ensure_firewall()

        token = secrets.token_urlsafe(32)
        user_data = render_cloud_init(self.template_path.read_text(encoding="utf-8"),
                                      token=token, llm_model=self.policy.llm_model, domain="auto")
        now = self._clock()
        ids = await api.launch(
            region_name=choice.region_name, instance_type_name=choice.instance_type_name,
            ssh_key_name=self.settings.lambda_ssh_key_name or "", name=f"acudx-worker-{int(now)}",
            user_data=user_data, tags=[{"key": "acudx", "value": "gpu-worker"}],
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
                await self.terminate(reason="boot_timeout")
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
        await self.terminate(reason="ready_timeout")
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
