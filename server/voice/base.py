"""Shared voice types: one request/result shape per direction, one adapter protocol each.

Adapters never pick an endpoint or a key. They receive a resolved
:class:`~server.registry.resolve.ProviderEndpoint` (base URL, key, model, ``extra``)
and translate AcuDx's neutral request into the vendor's wire format. Resolution,
the air-gap guard, GPU worker fallback and telemetry live in ``service.py``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import AsyncIterator, Protocol

import httpx

from server.registry.resolve import ProviderEndpoint


class VoiceError(RuntimeError):
    """A provider call failed. ``status`` is the upstream HTTP status when known."""

    def __init__(self, provider: str, detail: str, *, status: int | None = None):
        super().__init__(f"{provider}: {detail}")
        self.provider = provider
        self.detail = detail
        self.status = status


class LanguageUnsupported(VoiceError):
    """The adapter cannot serve this language; the service tries the next candidate."""


@dataclass(frozen=True)
class TtsRequest:
    text: str
    lang: str                      # ISO 639-1 ("en", "tr")
    voice_id: str                  # provider voice id resolved by profiles.py
    model: str | None = None       # provider model id; adapters fall back to their default
    output_format: str = "mp3"     # "mp3" | "wav"
    speed: float = 1.0


@dataclass
class TtsStream:
    """A streamed synthesis: ``chunks`` yields encoded audio as it arrives."""

    content_type: str
    chunks: AsyncIterator[bytes]
    model: str
    duration_ms: int | None = None   # known up front only for WAV (header) or vendor metadata


@dataclass(frozen=True)
class SttRequest:
    audio: bytes
    content_type: str              # e.g. "audio/webm"
    filename: str = "audio.webm"
    lang: str | None = None        # hint; None lets the provider detect
    model: str | None = None


@dataclass(frozen=True)
class SttResult:
    text: str
    language: str | None
    confidence: float | None
    model: str
    audio_seconds: float | None = None
    raw: dict = field(default_factory=dict, repr=False)


class TtsAdapter(Protocol):
    name: str
    languages: frozenset[str] | None      # None means "any language the model accepts"

    def supports_language(self, lang: str) -> bool: ...

    async def synthesize(self, client: httpx.AsyncClient, ep: ProviderEndpoint, req: TtsRequest) -> TtsStream: ...


class SttAdapter(Protocol):
    name: str

    async def transcribe(self, client: httpx.AsyncClient, ep: ProviderEndpoint, req: SttRequest) -> SttResult: ...


def wav_duration_ms(header: bytes) -> int | None:
    """Duration from a RIFF/WAVE header (``fmt`` byte rate and ``data`` size), else None.

    Streaming servers often write a data size of 0 or 0xFFFFFFFF; those are reported
    as unknown rather than guessed.
    """
    if len(header) < 12 or header[:4] != b"RIFF" or header[8:12] != b"WAVE":
        return None
    pos = 12
    byte_rate: int | None = None
    while pos + 8 <= len(header):
        cid = header[pos:pos + 4]
        size = int.from_bytes(header[pos + 4:pos + 8], "little")
        if cid == b"fmt " and pos + 16 <= len(header):
            byte_rate = int.from_bytes(header[pos + 16:pos + 20], "little")
        elif cid == b"data":
            if byte_rate and 0 < size < 0xFFFFFFFF:
                return int(round(size / byte_rate * 1000.0))
            return None
        pos += 8 + size + (size & 1)
    return None
