"""Versioned model price table for the orchestration trace (cost_usd per node).

Prices are USD per 1M tokens (input, output) and were taken from the provider
pages recorded in ``docs/research/16-agent-orchestration-identity-deploy-oct-2026``
on 2026-10-19. A self-hosted model costs nothing per token here; its GPU hour
is accounted elsewhere. Unknown models price as ``None`` so the trace says
"unpriced" instead of inventing a number.

The table is matched by a case-insensitive regular expression against the
*served* model name (providers substitute models, so the response ``model``
field is used, not the requested one). First match wins; keep specific rows
above generic ones.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

PRICE_TABLE_VERSION = "2026-10-19.1"


@dataclass(frozen=True)
class PriceRow:
    pattern: str
    input_per_1m: float
    output_per_1m: float
    provider: str
    effective_from: str


PRICE_TABLE: tuple[PriceRow, ...] = (
    # Local / self-hosted engines (llama-server, vLLM, SGLang): no per-token fee.
    PriceRow(r"^qwen2\.5-7b", 0.0, 0.0, "local", "2026-01-01"),
    PriceRow(r"^qwen2\.5-.*(local|instruct)$", 0.0, 0.0, "local", "2026-01-01"),
    PriceRow(r"medgemma", 0.0, 0.0, "local", "2026-01-01"),
    # DeepInfra list prices.
    PriceRow(r"qwen3-235b", 0.09, 0.55, "deepinfra", "2026-10-01"),
    PriceRow(r"qwen3-32b", 0.08, 0.28, "deepinfra", "2026-10-01"),
    PriceRow(r"deepseek-v4-flash", 0.09, 0.18, "deepinfra", "2026-10-01"),
    PriceRow(r"deepseek-v3\.2", 0.26, 0.38, "deepinfra", "2026-10-01"),
    PriceRow(r"gemma-3-27b", 0.08, 0.16, "deepinfra", "2026-10-01"),
    PriceRow(r"llama-guard-4", 0.18, 0.18, "deepinfra", "2026-10-01"),
    # Groq / Together list prices.
    PriceRow(r"gpt-oss-120b", 0.15, 0.60, "groq", "2026-10-01"),
    PriceRow(r"gpt-oss-20b", 0.075, 0.30, "groq", "2026-10-01"),
)


def find_price(model: str | None) -> Optional[PriceRow]:
    """Return the first matching row for a served model name, else ``None``."""
    if not model:
        return None
    name = model.strip().lower()
    for row in PRICE_TABLE:
        if re.search(row.pattern, name, re.IGNORECASE):
            return row
    return None


def cost_usd(model: str | None, tokens_in: int, tokens_out: int) -> Optional[float]:
    """USD cost of one call, or ``None`` when the model is not in the table."""
    row = find_price(model)
    if row is None:
        return None
    cost = (max(0, tokens_in) * row.input_per_1m + max(0, tokens_out) * row.output_per_1m) / 1_000_000.0
    return round(cost, 8)
