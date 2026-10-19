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

from server.orchestration.prices import PRICE_TABLE_VERSION, cost_usd


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
    **attributes: Any,
) -> dict[str, Any]:
    """Build a serialisable trace record. ``started`` is a ``time.monotonic()``."""
    ev = TraceEvent(
        node=node,
        status=status,
        latency_ms=round((time.monotonic() - started) * 1000.0, 1),
        model=model,
        model_requested=model_requested,
        provider=provider,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        cost_usd=cost_usd(model, tokens_in, tokens_out) if model else None,
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
        "cost_usd": round(sum(priced), 8) if priced else None,
        "unpriced_models": unpriced_models,
        "price_table_version": PRICE_TABLE_VERSION,
    }
