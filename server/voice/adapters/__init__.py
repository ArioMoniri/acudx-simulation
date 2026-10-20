"""Provider adapters. ``adapter_for(endpoint)`` picks one from ``extra.adapter`` or the host."""

from __future__ import annotations

from urllib.parse import urlparse

from server.registry.resolve import ProviderEndpoint
from server.voice.adapters.deepgram import DeepgramStt, DeepgramTts
from server.voice.adapters.elevenlabs import ElevenLabsStt, ElevenLabsTts
from server.voice.adapters.openai_compatible import OpenAiCompatibleStt, OpenAiCompatibleTts

TTS_ADAPTERS = {"elevenlabs": ElevenLabsTts(), "deepgram": DeepgramTts(), "openai_compatible": OpenAiCompatibleTts()}
STT_ADAPTERS = {"elevenlabs": ElevenLabsStt(), "deepgram": DeepgramStt(), "openai_compatible": OpenAiCompatibleStt()}

_HOST_HINTS: tuple[tuple[str, str], ...] = (("elevenlabs.io", "elevenlabs"), ("deepgram.com", "deepgram"))


def adapter_name_for(ep: ProviderEndpoint) -> str:
    """``extra.adapter`` when set and known; else inferred from the host; else OpenAI-compatible."""
    declared = str(ep.extra.get("adapter") or "").strip().lower()
    if declared in TTS_ADAPTERS:
        return declared
    host = (urlparse(ep.base_url).hostname or "").lower()
    for suffix, name in _HOST_HINTS:
        if host == suffix or host.endswith("." + suffix):
            return name
    return "openai_compatible"


__all__ = ["TTS_ADAPTERS", "STT_ADAPTERS", "adapter_name_for", "ElevenLabsTts", "ElevenLabsStt", "DeepgramTts",
           "DeepgramStt", "OpenAiCompatibleTts", "OpenAiCompatibleStt"]
