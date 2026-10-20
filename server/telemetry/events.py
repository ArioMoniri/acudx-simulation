"""Model-call telemetry: SQLite rows, request context, aggregation, optional OTel spans.

``TelemetryRecorder.record()`` is called by :class:`server.model_gateway.ModelGateway`
after every chat / embed / rerank attempt (success or failure). The row carries
the request context (route, tenant, user hash, encounter) taken from a
``contextvars`` slot that the HTTP layer sets per request (:func:`call_context`),
so the gateway signature does not change.

OpenTelemetry is an optional import: when ``OTEL_EXPORTER_OTLP_ENDPOINT`` is set
and ``opentelemetry-sdk`` + the OTLP HTTP exporter are installed, each call also
emits one ``gen_ai.*`` span. Nothing here ever records an API key.
"""

from __future__ import annotations

import contextlib
import contextvars
import logging
import math
import os
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterator

from server.telemetry import prices

log = logging.getLogger("acudx.telemetry")

WINDOWS: dict[str, tuple[int, int]] = {   # window -> (seconds, bucket seconds)
    "24h": (24 * 3600, 3600),
    "7d": (7 * 86400, 86400),
    "30d": (30 * 86400, 86400),
}


# --------------------------------------------------------------------------- #
# request context                                                             #
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class CallContext:
    route: str | None = None
    tenant: str | None = None
    user_hash: str | None = None
    encounter_id: str | None = None


_ctx: contextvars.ContextVar[CallContext] = contextvars.ContextVar("acudx_call_context", default=CallContext())


def current_context() -> CallContext:
    return _ctx.get()


@contextlib.contextmanager
def call_context(**fields: str | None) -> Iterator[CallContext]:
    """Bind route/tenant/user/encounter for every model call made inside the block."""
    token = _ctx.set(CallContext(**fields))
    try:
        yield _ctx.get()
    finally:
        _ctx.reset(token)


# --------------------------------------------------------------------------- #
# recorder                                                                    #
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class CallRow:
    id: int
    ts: float
    kind: str
    provider: str
    model: str
    tokens_in: int
    tokens_out: int
    cached_tokens: int
    latency_ms: float
    cost_usd: float
    price_version: str
    ok: bool
    error: str | None


class TelemetryRecorder:
    def __init__(self, db_path: str, *, clock: Callable[[], float] | None = None, tracer_provider: Any = None):
        self.db_path = db_path
        self._clock = clock or time.time
        Path(db_path).expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)
        with self._conn() as c:
            c.executescript(
                """
                CREATE TABLE IF NOT EXISTS model_calls (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ts REAL NOT NULL,
                    kind TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    model TEXT NOT NULL,
                    tokens_in INTEGER NOT NULL DEFAULT 0,
                    tokens_out INTEGER NOT NULL DEFAULT 0,
                    cached_tokens INTEGER NOT NULL DEFAULT 0,
                    latency_ms REAL NOT NULL,
                    cost_usd REAL NOT NULL DEFAULT 0,
                    price_version TEXT,
                    route TEXT,
                    tenant TEXT,
                    user_hash TEXT,
                    encounter_id TEXT,
                    ok INTEGER NOT NULL,
                    error TEXT
                );
                CREATE INDEX IF NOT EXISTS model_calls_ts ON model_calls (ts);
                """
            )
        self.tracer = self._build_tracer(tracer_provider)

    def _conn(self) -> sqlite3.Connection:
        c = sqlite3.connect(self.db_path, isolation_level=None)
        c.row_factory = sqlite3.Row
        return c

    # -- OpenTelemetry (optional) --------------------------------------------- #
    @staticmethod
    def _build_tracer(tracer_provider: Any) -> Any:
        """A tracer when a provider is injected or ``OTEL_EXPORTER_OTLP_ENDPOINT`` is set; else None."""
        endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT")
        if tracer_provider is None and not endpoint:
            return None
        try:
            from opentelemetry import trace  # noqa: PLC0415 - optional dependency
        except ImportError:
            log.warning("OTEL_EXPORTER_OTLP_ENDPOINT is set but opentelemetry-sdk is not installed; "
                        "install server/requirements-telemetry.txt to export gen_ai spans")
            return None
        if tracer_provider is None:
            try:
                from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter  # noqa: PLC0415
                from opentelemetry.sdk.resources import Resource  # noqa: PLC0415
                from opentelemetry.sdk.trace import TracerProvider  # noqa: PLC0415
                from opentelemetry.sdk.trace.export import BatchSpanProcessor  # noqa: PLC0415
            except ImportError:
                log.warning("opentelemetry OTLP HTTP exporter missing; gen_ai spans disabled")
                return None
            tracer_provider = TracerProvider(resource=Resource.create({"service.name": "acudx-gateway"}))
            tracer_provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
            trace.set_tracer_provider(tracer_provider)
        return tracer_provider.get_tracer("acudx.gateway")

    def _emit_span(self, *, kind: str, provider: str, model: str, requested_model: str | None, tokens_in: int,
                   tokens_out: int, cached_tokens: int, latency_ms: float, cost: float, ctx: CallContext, ok: bool,
                   error: str | None, ts: float) -> None:
        if self.tracer is None:
            return
        op = {"llm": "chat", "embed": "embeddings", "rerank": "rerank", "tts": "text_to_speech",
              "stt": "speech_to_text"}.get(kind, kind)
        start_ns = int((ts - latency_ms / 1000.0) * 1e9)
        attrs: dict[str, Any] = {
            "gen_ai.operation.name": op,
            "gen_ai.system": provider,
            "gen_ai.request.model": requested_model or model,
            "gen_ai.response.model": model,
            "gen_ai.usage.input_tokens": tokens_in,
            "gen_ai.usage.output_tokens": tokens_out,
            "gen_ai.usage.cached_input_tokens": cached_tokens,
            "acudx.kind": kind,
            "acudx.cost_usd": cost,
            "acudx.price_version": prices.PRICE_TABLE_VERSION,
            "acudx.latency_ms": latency_ms,
            "acudx.ok": ok,
        }
        for key, val in (("acudx.route", ctx.route), ("acudx.tenant", ctx.tenant), ("acudx.user_hash", ctx.user_hash),
                         ("acudx.encounter_id", ctx.encounter_id), ("error.type", error)):
            if val is not None:
                attrs[key] = val
        try:
            span = self.tracer.start_span(f"gen_ai.{op} {provider}", attributes=attrs, start_time=start_ns)
            if not ok:
                from opentelemetry.trace import Status, StatusCode  # noqa: PLC0415
                span.set_status(Status(StatusCode.ERROR, error or "error"))
            span.end(end_time=int(ts * 1e9))
        except Exception:  # noqa: BLE001 - telemetry must never break a model call
            log.exception("gen_ai span emission failed")

    # -- write ------------------------------------------------------------------ #
    def record(self, *, kind: str, provider: str, model: str, tokens_in: int = 0, tokens_out: int = 0,
               cached_tokens: int = 0, latency_ms: float, route: str | None = None, tenant: str | None = None,
               user_hash: str | None = None, encounter_id: str | None = None, ok: bool, error: str | None = None,
               requested_model: str | None = None, billing_provider: str | None = None,
               cost_usd: float | None = None) -> CallRow:
        """Persist one call. Explicit context args win over the ambient :func:`call_context`.

        ``provider`` is the registry row name shown in dashboards; ``billing_provider``
        (default: the same) is the slug the price table is keyed by. ``cost_usd``
        overrides the token-table price for calls billed in other units (TTS
        characters, STT minutes; see :func:`server.telemetry.prices.voice_cost_usd`),
        with ``tokens_in`` then carrying the billed unit count.
        """
        ambient = current_context()
        ctx = CallContext(route=route if route is not None else ambient.route,
                          tenant=tenant if tenant is not None else ambient.tenant,
                          user_hash=user_hash if user_hash is not None else ambient.user_hash,
                          encounter_id=encounter_id if encounter_id is not None else ambient.encounter_id)
        ts = self._clock()
        cost = (float(cost_usd) if cost_usd is not None
                else prices.cost_usd(billing_provider or provider, model, tokens_in, tokens_out, cached_tokens))
        with self._conn() as c:
            cur = c.execute(
                "INSERT INTO model_calls (ts, kind, provider, model, tokens_in, tokens_out, cached_tokens, latency_ms, "
                "cost_usd, price_version, route, tenant, user_hash, encounter_id, ok, error) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (ts, kind, provider, model, int(tokens_in), int(tokens_out), int(cached_tokens), float(latency_ms),
                 cost, prices.PRICE_TABLE_VERSION, ctx.route, ctx.tenant, ctx.user_hash, ctx.encounter_id, int(ok),
                 error),
            )
            row_id = int(cur.lastrowid)
        self._emit_span(kind=kind, provider=provider, model=model, requested_model=requested_model,
                        tokens_in=tokens_in, tokens_out=tokens_out, cached_tokens=cached_tokens,
                        latency_ms=latency_ms, cost=cost, ctx=ctx, ok=ok, error=error, ts=ts)
        return CallRow(id=row_id, ts=ts, kind=kind, provider=provider, model=model, tokens_in=tokens_in,
                       tokens_out=tokens_out, cached_tokens=cached_tokens, latency_ms=latency_ms, cost_usd=cost,
                       price_version=prices.PRICE_TABLE_VERSION, ok=ok, error=error)

    # -- read ------------------------------------------------------------------- #
    def recent(self, limit: int = 100) -> list[dict[str, Any]]:
        with self._conn() as c:
            rows = c.execute("SELECT * FROM model_calls ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        return [dict(r) for r in rows]

    def purge_older_than(self, days: float, *, now: float | None = None) -> int:
        """Delete rows with ``ts`` older than ``days`` before ``now``; returns the count.

        The retention job (server/registry/jobs.py) calls this with the console's
        ``telemetry.retention_days``. A non-positive window deletes nothing.
        """
        if days <= 0:
            return 0
        cutoff = (now if now is not None else self._clock()) - float(days) * 86_400.0
        with self._conn() as c:
            cur = c.execute("DELETE FROM model_calls WHERE ts < ?", (cutoff,))
            return int(cur.rowcount or 0)

    def rows_since(self, since: float, until: float) -> list[dict[str, Any]]:
        with self._conn() as c:
            rows = c.execute("SELECT ts, kind, provider, model, tokens_in, tokens_out, cached_tokens, latency_ms, "
                             "cost_usd, route, ok FROM model_calls WHERE ts > ? AND ts <= ? ORDER BY ts",
                             (since, until)).fetchall()
        return [dict(r) for r in rows]


# --------------------------------------------------------------------------- #
# aggregation                                                                 #
# --------------------------------------------------------------------------- #
def percentile(values: list[float], pct: float) -> float | None:
    """Linear-interpolated percentile (numpy 'linear' method). None for empty input."""
    if not values:
        return None
    xs = sorted(float(v) for v in values)
    if len(xs) == 1:
        return xs[0]
    rank = (pct / 100.0) * (len(xs) - 1)
    lo = math.floor(rank)
    hi = math.ceil(rank)
    if lo == hi:
        return xs[lo]
    return xs[lo] + (xs[hi] - xs[lo]) * (rank - lo)


def _group(rows: list[dict[str, Any]], key: str) -> list[dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for r in rows:
        k = r.get(key) or "unknown"
        b = out.setdefault(k, {"key": k, "calls": 0, "errors": 0, "cost_usd": 0.0, "tokens_in": 0, "tokens_out": 0,
                               "_lat": []})
        b["calls"] += 1
        b["errors"] += 0 if r["ok"] else 1
        b["cost_usd"] += r["cost_usd"]
        b["tokens_in"] += r["tokens_in"]
        b["tokens_out"] += r["tokens_out"]
        b["_lat"].append(r["latency_ms"])
    result = []
    for b in out.values():
        lat = b.pop("_lat")
        b["cost_usd"] = round(b["cost_usd"], 6)
        b["p50_ms"] = percentile(lat, 50)
        b["p95_ms"] = percentile(lat, 95)
        result.append(b)
    result.sort(key=lambda b: (-b["calls"], b["key"]))
    return result


def summarize(recorder: TelemetryRecorder, window: str, *, now: float | None = None) -> dict[str, Any]:
    """Calls, cost, p50/p95 latency, error rate, by provider/model/route, time buckets."""
    if window not in WINDOWS:
        raise ValueError(f"window must be one of {sorted(WINDOWS)}, got {window!r}")
    span_s, bucket_s = WINDOWS[window]
    to_ts = now if now is not None else recorder._clock()
    from_ts = to_ts - span_s
    rows = recorder.rows_since(from_ts, to_ts)
    n_buckets = span_s // bucket_s
    series = [{"ts": from_ts + i * bucket_s, "calls": 0, "errors": 0, "cost_usd": 0.0, "tokens_in": 0,
               "tokens_out": 0, "_lat": []} for i in range(n_buckets)]
    for r in rows:
        # Buckets are right-inclusive, (start, start + bucket], matching rows_since().
        idx = min(n_buckets - 1, max(0, math.ceil((r["ts"] - from_ts) / bucket_s) - 1))
        b = series[idx]
        b["calls"] += 1
        b["errors"] += 0 if r["ok"] else 1
        b["cost_usd"] += r["cost_usd"]
        b["tokens_in"] += r["tokens_in"]
        b["tokens_out"] += r["tokens_out"]
        b["_lat"].append(r["latency_ms"])
    for b in series:
        lat = b.pop("_lat")
        b["cost_usd"] = round(b["cost_usd"], 6)
        b["p50_ms"] = percentile(lat, 50)
        b["p95_ms"] = percentile(lat, 95)
    latencies = [r["latency_ms"] for r in rows]
    errors = sum(1 for r in rows if not r["ok"])
    return {
        "window": window,
        "from_ts": from_ts,
        "to_ts": to_ts,
        "bucket_seconds": bucket_s,
        "calls": len(rows),
        "errors": errors,
        "error_rate": round(errors / len(rows), 6) if rows else 0.0,
        "cost_usd": round(sum(r["cost_usd"] for r in rows), 6),
        "tokens_in": sum(r["tokens_in"] for r in rows),
        "tokens_out": sum(r["tokens_out"] for r in rows),
        "cached_tokens": sum(r["cached_tokens"] for r in rows),
        "latency_ms": {"p50": percentile(latencies, 50), "p95": percentile(latencies, 95)},
        "by_provider": _group(rows, "provider"),
        "by_model": _group(rows, "model"),
        "by_route": _group(rows, "route"),
        "by_kind": _group(rows, "kind"),
        "series": series,
        "price_version": prices.PRICE_TABLE_VERSION,
    }
