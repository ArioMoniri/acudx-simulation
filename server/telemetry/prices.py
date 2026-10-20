"""Versioned token price table (USD per 1M tokens).

Cost is computed in the gateway from this table and attached to every call row
and span, so dashboards never re-derive totals from histograms
(docs/research/16 section 5.2). Rows carry the page they were read from and the
date they took effect; ``PRICE_TABLE_VERSION`` is the fetch date of the table.

Self-hosted endpoints (``local``, ``gpu_worker``, in-VPC side-cars) cost 0 here:
their money is accounted in ``gpu_ledger`` by the hour, not by the token.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import urlparse

PRICE_TABLE_VERSION = "2026-10-19"

_FREE_PROVIDERS = {"local", "gpu_worker", "gpu-worker", "env-llm", "env-embed", "env-rerank"}


@dataclass(frozen=True)
class PriceRow:
    provider: str              # lower-case provider slug as stored on the provider row / endpoint name
    model_pattern: str         # case-insensitive regex matched against the served model id
    input_per_m: float
    output_per_m: float
    cached_input_per_m: float | None
    effective_from: str        # ISO date
    source_url: str

    def matches(self, provider: str, model: str) -> bool:
        return provider.lower().startswith(self.provider) and re.search(self.model_pattern, model, re.I) is not None


# Values from docs/research/16-agent-orchestration-identity-deploy-oct-2026.md section 2.2 (fetched 2026-10-19).
PRICE_TABLE: tuple[PriceRow, ...] = (
    PriceRow("deepinfra", r"qwen3-32b", 0.08, 0.28, None, "2026-10-19", "https://deepinfra.com/pricing"),
    PriceRow("deepinfra", r"qwen3-235b", 0.09, 0.55, None, "2026-10-19", "https://deepinfra.com/pricing"),
    PriceRow("deepinfra", r"llama-4-scout", 0.10, 0.30, None, "2026-10-19", "https://deepinfra.com/pricing"),
    PriceRow("deepinfra", r"deepseek-v3\.2", 0.26, 0.38, 0.13, "2026-10-19", "https://deepinfra.com/pricing"),
    PriceRow("deepinfra", r"deepseek-v4-flash", 0.09, 0.18, 0.018, "2026-10-19", "https://deepinfra.com/pricing"),
    PriceRow("deepinfra", r"deepseek-v4-pro", 1.30, 2.60, None, "2026-10-19", "https://deepinfra.com/pricing"),
    PriceRow("deepinfra", r"gemma-3-27b", 0.08, 0.16, None, "2026-10-19", "https://deepinfra.com/pricing"),
    PriceRow("deepinfra", r"llama-guard-4", 0.18, 0.18, None, "2026-10-19", "https://deepinfra.com/pricing"),
    PriceRow("together", r"qwen3-235b", 0.20, 0.60, None, "2026-10-19", "https://www.together.ai/pricing"),
    PriceRow("together", r"deepseek-v4-pro", 1.32, 3.96, None, "2026-10-19", "https://www.together.ai/pricing"),
    PriceRow("together", r"gpt-oss-120b", 0.15, 0.60, None, "2026-10-19", "https://www.together.ai/pricing"),
    PriceRow("groq", r"gpt-oss-120b", 0.15, 0.60, None, "2026-10-19", "https://console.groq.com/docs/models"),
    PriceRow("groq", r"gpt-oss-20b", 0.075, 0.30, None, "2026-10-19", "https://console.groq.com/docs/models"),
    PriceRow("fireworks", r"gpt-oss-120b", 0.15, 0.60, None, "2026-10-19", "https://fireworks.ai/pricing"),
    PriceRow("openrouter", r"gpt-oss-120b", 0.15, 0.60, None, "2026-10-19", "https://openrouter.ai/openai/gpt-oss-120b"),
    PriceRow("openrouter", r"qwen3-235b", 0.09, 0.55, None, "2026-10-19", "https://openrouter.ai/"),
    PriceRow("openrouter", r"deepseek-v3\.2", 0.27, 0.42, None, "2026-10-19", "https://openrouter.ai/"),
)


_HOST_SLUGS: tuple[tuple[str, str], ...] = (
    ("deepinfra.com", "deepinfra"),
    ("together.xyz", "together"),
    ("together.ai", "together"),
    ("groq.com", "groq"),
    ("fireworks.ai", "fireworks"),
    ("openrouter.ai", "openrouter"),
    ("huggingface.co", "huggingface"),
    ("openai.com", "openai"),
    ("elevenlabs.io", "elevenlabs"),
    ("deepgram.com", "deepgram"),
)


# --------------------------------------------------------------------------- #
# Voice (TTS / STT) unit prices                                               #
# --------------------------------------------------------------------------- #
# TTS is billed per 1,000 characters, STT per audio minute. Figures read on
# 2026-10-19 (docs/research/14-voice-video-stack-oct-2026.md sections 3.1, 3.2):
#   ElevenLabs Flash/Turbo v2.5 and v4 Turbo $0.04 per 1k chars; Multilingual v2,
#   v3 and v4 $0.08; Scribe v2 batch $0.22 per audio hour, Scribe v2 realtime
#   $0.39 per audio hour (https://elevenlabs.io/pricing/api).
#   Deepgram Nova-3 $0.0048/min monolingual, $0.0058/min multilingual; Aura-2
#   $0.030 per 1k chars (https://deepgram.com/pricing).
VoiceUnit = str   # "chars" (per 1,000 characters) | "minutes" (per audio minute)


@dataclass(frozen=True)
class VoicePriceRow:
    provider: str
    model_pattern: str
    unit: VoiceUnit
    usd_per_unit: float        # per 1k chars or per minute
    effective_from: str
    source_url: str

    def matches(self, provider: str, model: str) -> bool:
        return provider.lower().startswith(self.provider) and re.search(self.model_pattern, model, re.I) is not None


VOICE_PRICE_TABLE: tuple[VoicePriceRow, ...] = (
    VoicePriceRow("elevenlabs", r"eleven_(flash|turbo)_v2(_5)?$", "chars", 0.04, "2026-10-19",
                  "https://elevenlabs.io/pricing/api"),
    VoicePriceRow("elevenlabs", r"eleven_v4_turbo", "chars", 0.04, "2026-10-19", "https://elevenlabs.io/pricing/api"),
    VoicePriceRow("elevenlabs", r"eleven_(multilingual_v2|v3|v4)$", "chars", 0.08, "2026-10-19",
                  "https://elevenlabs.io/pricing/api"),
    VoicePriceRow("elevenlabs", r"scribe_v2_realtime", "minutes", 0.39 / 60.0, "2026-10-19",
                  "https://elevenlabs.io/pricing/api"),
    VoicePriceRow("elevenlabs", r"scribe_v(1|2)", "minutes", 0.22 / 60.0, "2026-10-19",
                  "https://elevenlabs.io/pricing/api"),
    VoicePriceRow("deepgram", r"nova-3.*multi|nova-3-multi", "minutes", 0.0058, "2026-10-19",
                  "https://deepgram.com/pricing"),
    VoicePriceRow("deepgram", r"nova-3", "minutes", 0.0048, "2026-10-19", "https://deepgram.com/pricing"),
    VoicePriceRow("deepgram", r"aura-2", "chars", 0.030, "2026-10-19", "https://deepgram.com/pricing"),
)


def voice_lookup(provider: str, model: str) -> VoicePriceRow | None:
    for row in VOICE_PRICE_TABLE:
        if row.matches(provider, model):
            return row
    return None


def voice_cost_usd(provider: str, model: str, *, chars: int = 0, audio_seconds: float = 0.0) -> float:
    """USD for one TTS (characters) or STT (audio seconds) call; self-hosted and unknown cost 0."""
    if provider.lower() in _FREE_PROVIDERS:
        return 0.0
    row = voice_lookup(provider, model or "")
    if row is None:
        return 0.0
    if row.unit == "chars":
        return round(max(0, chars) / 1000.0 * row.usd_per_unit, 8)
    return round(max(0.0, audio_seconds) / 60.0 * row.usd_per_unit, 8)


def provider_from_url(base_url: str) -> str | None:
    """Billing slug derived from a hosted endpoint's host (``api.deepinfra.com`` -> ``deepinfra``)."""
    host = (urlparse(base_url).hostname or "").lower()
    for suffix, slug in _HOST_SLUGS:
        if host == suffix or host.endswith("." + suffix):
            return slug
    return None


def lookup(provider: str, model: str) -> PriceRow | None:
    """First row whose provider prefix and model regex match, else None."""
    for row in PRICE_TABLE:
        if row.matches(provider, model):
            return row
    return None


def cost_usd(provider: str, model: str, tokens_in: int, tokens_out: int, cached_tokens: int = 0) -> float:
    """USD for one call. Unknown hosted models and self-hosted endpoints cost 0."""
    if provider.lower() in _FREE_PROVIDERS:
        return 0.0
    row = lookup(provider, model or "")
    if row is None:
        return 0.0
    cached = max(0, min(cached_tokens, tokens_in))
    uncached = max(0, tokens_in - cached)
    cached_rate = row.cached_input_per_m if row.cached_input_per_m is not None else row.input_per_m
    total = (uncached * row.input_per_m + cached * cached_rate + max(0, tokens_out) * row.output_per_m) / 1_000_000.0
    return round(total, 8)
