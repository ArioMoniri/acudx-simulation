"""OTel-style trace events emitted by every orchestration node.

One :class:`TraceEvent` per node execution, appended to the graph state's
``trace`` list (reducer ``operator.add``) and therefore persisted in every
checkpoint. Attribute names follow the ``gen_ai.*`` semantic conventions
loosely (node, requested and served model, input and output tokens, latency,
cost from the versioned price table) so the records can be exported to an OTel
collector or Langfuse without renaming.
"""

from __future__ import annotations

import time
from typing import Any, Optional

from pydantic import BaseModel, Field

from server.orchestration.prices import PRICE_TABLE_VERSION
from server.orchestration.prices import cost_usd as table_cost


class TraceEvent(BaseModel):
    """What one node did, in a shape an OTel span exporter can consume."""

    node: str
    status: str = "ok"                     # ok | fail | skipped
    ts: float = Field(default_factory=time.time)
    latency_ms: float = 0.0
    model: Optional[str] = None            # served model (None for deterministic nodes)
    model_requested: Optional[str] = None
    provider: Optional[str] = None
    tokens_in: int = 0
    tokens_out: int = 0
    cost_usd: Optional[float] = None
    # "token_table" (prices.py per-token row) or "gpu_hour_amortised" (self-hosted
    # worker: the GPU ledger's hourly price times this call's share of the hour).
    cost_basis: Optional[str] = None
    price_table_version: str = PRICE_TABLE_VERSION
    attributes: dict[str, Any] = Field(default_factory=dict)
    note: Optional[str] = None


def make_event(
    node: str,
    *,
    started: float,
    status: str = "ok",
    model: str | None = None,
    model_requested: str | None = None,
    provider: str | None = None,
    tokens_in: int = 0,
    tokens_out: int = 0,
    note: str | None = None,
    cost_usd: float | None = None,
    cost_basis: str | None = None,
    **attributes: Any,
) -> dict[str, Any]:
    """Build a serialisable trace record. ``started`` is a ``time.monotonic()``.

    ``cost_usd`` given by the caller (an amortised GPU-hour cost) wins over the
    per-token price table."""
    if cost_usd is None and model:
        cost_usd = table_cost(model, tokens_in, tokens_out)
        if cost_usd is not None:
            cost_basis = cost_basis or "token_table"
    ev = TraceEvent(
        node=node,
        status=status,
        latency_ms=round((time.monotonic() - started) * 1000.0, 1),
        model=model,
        model_requested=model_requested,
        provider=provider,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        cost_usd=cost_usd,
        cost_basis=cost_basis if cost_usd is not None else None,
        note=note,
        attributes=attributes,
    )
    return ev.model_dump()


def summarize(trace: list[dict[str, Any]]) -> dict[str, Any]:
    """Roll a trace up into totals for the API response."""
    tokens_in = sum(int(e.get("tokens_in") or 0) for e in trace)
    tokens_out = sum(int(e.get("tokens_out") or 0) for e in trace)
    priced = [e.get("cost_usd") for e in trace if e.get("cost_usd") is not None]
    unpriced_models = sorted({
        str(e.get("model")) for e in trace
        if e.get("model") and e.get("cost_usd") is None
    })
    return {
        "nodes": [e.get("node") for e in trace],
        "model_calls": sum(1 for e in trace if e.get("model")),
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
        "latency_ms": round(sum(float(e.get("latency_ms") or 0.0) for e in trace), 1),
        # Wall clock from the first node's start to the last node's end. Smaller
        # than ``latency_ms`` because the three judges overlap.
        "wall_ms": _wall_ms(trace),
        "cost_usd": round(sum(priced), 8) if priced else None,
        "cost_basis": sorted({str(e["cost_basis"]) for e in trace if e.get("cost_basis")}),
        "unpriced_models": unpriced_models,
        "price_table_version": PRICE_TABLE_VERSION,
    }


def _wall_ms(trace: list[dict[str, Any]]) -> float:
    spans = [(float(e["ts"]) - float(e.get("latency_ms") or 0.0) / 1000.0, float(e["ts"]))
             for e in trace if e.get("ts") is not None]
    if not spans:
        return 0.0
    return round((max(end for _, end in spans) - min(start for start, _ in spans)) * 1000.0, 1)
