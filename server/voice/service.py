"""VoiceService: registry resolution, air-gap guard, GPU worker fallback, telemetry.

Order of attempts for ``kind`` in {tts, stt}:

1. :meth:`RegistryResolver.endpoints(kind)`: enabled rows in priority order, with
   hosted rows already refused under ``AIRGAPPED`` and known-dead rows skipped;
   adapters that cannot serve the requested language are skipped
   (:class:`~server.voice.base.LanguageUnsupported`), as are upstream failures.
2. :meth:`RegistryResolver.resolve_worker(kind)`: the on-demand GPU worker's
   ``/tts`` (Chatterbox Multilingual, Turkish included) or ``/stt`` (speaches,
   faster-whisper large-v3-turbo). Under ``AIRGAPPED`` the manager refuses to
   launch cloud capacity, so this step yields nothing and the route answers 503.

Every attempt writes one telemetry row (``kind`` tts/stt) through
:class:`~server.telemetry.events.TelemetryRecorder`; the cost comes from
:func:`server.telemetry.prices.voice_cost_usd` with ``tokens_in`` carrying the
billed unit (characters for TTS, whole audio seconds for STT).
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any, AsyncIterator

import httpx

from server.config import Settings
from server.registry.resolve import WORKER_MODELS, WORKER_PATHS, ProviderEndpoint, RegistryResolver
from server.telemetry import prices
from server.telemetry.events import TelemetryRecorder
from server.voice import profiles
from server.voice.adapters import STT_ADAPTERS, TTS_ADAPTERS, adapter_name_for
from server.voice.base import LanguageUnsupported, SttRequest, SttResult, TtsRequest, TtsStream, VoiceError

log = logging.getLogger("acudx.voice")

# Languages the self-hosted worker serves (Chatterbox Multilingual list, research doc section 3.2).
WORKER_TTS_LANGUAGES = ("ar", "da", "de", "el", "en", "es", "fi", "fr", "he", "hi", "it", "ja", "ko", "ms", "nl",
                        "no", "pl", "pt", "ru", "sv", "sw", "tr")


class NoVoiceProvider(RuntimeError):
    def __init__(self, kind: str, reasons: list[str], *, airgapped: bool):
        super().__init__(f"no {kind} provider available: {'; '.join(reasons) or 'none configured'}")
        self.kind = kind
        self.reasons = reasons
        self.airgapped = airgapped


@dataclass
class TtsOutcome:
    stream: TtsStream
    endpoint: ProviderEndpoint
    adapter: str
    voice_id: str
    ttfb_ms: float


@dataclass
class SttOutcome:
    result: SttResult
    endpoint: ProviderEndpoint
    adapter: str
    latency_ms: float


class VoiceService:
    def __init__(self, settings: Settings, resolver: RegistryResolver, *, telemetry: TelemetryRecorder | None = None,
                 client: httpx.AsyncClient | None = None):
        self.settings = settings
        self.resolver = resolver
        self.telemetry = telemetry
        self._client = client
        self._owns_client = client is None

    # -- lifecycle ------------------------------------------------------------ #
    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=httpx.Timeout(self.settings.request_timeout_s,
                                                                   connect=self.settings.connect_timeout_s))
        return self._client

    async def aclose(self) -> None:
        if self._client is not None and self._owns_client:
            await self._client.aclose()
            self._client = None

    # -- candidates ----------------------------------------------------------- #
    async def _candidates(self, kind: str) -> AsyncIterator[ProviderEndpoint]:
        """Registry endpoints first; the GPU worker is asked for ONLY after every registry
        row has been tried, so a request a hosted provider can serve never launches (or
        waits on the boot of) cloud GPU capacity (AGENT-PROTOCOL section 2.4)."""
        for ep in self.resolver.endpoints(kind):
            yield ep
        worker = await self.resolver.resolve_worker(kind)
        if worker is not None:
            yield worker

    def _refusal_reasons(self, kind: str) -> list[str]:
        reasons = [f"{rec.name}: refused by AIRGAPPED (non-local {rec.base_url})" for rec in self.resolver.refused(kind)]
        if self.resolver.worker_manager is not None and self.resolver.last_worker_refusal:
            reasons.append(f"gpu-worker: {self.resolver.last_worker_refusal}")
        return reasons

    # -- telemetry ------------------------------------------------------------ #
    def _record(self, ep: ProviderEndpoint, *, kind: str, model: str, chars: int = 0, audio_seconds: float = 0.0,
                latency_ms: float, ok: bool, error: str | None = None) -> None:
        self.resolver.touch(ep)
        if self.telemetry is None:
            return
        billing = "gpu_worker" if ep.source == "gpu_worker" else (prices.provider_from_url(ep.base_url) or ep.name)
        try:
            self.telemetry.record(kind=kind, provider=ep.name, model=model, billing_provider=billing,
                                  tokens_in=chars if kind == "tts" else int(round(audio_seconds)),
                                  latency_ms=round(latency_ms, 3), ok=ok, error=error, requested_model=ep.model,
                                  cost_usd=prices.voice_cost_usd(billing, model, chars=chars,
                                                                 audio_seconds=audio_seconds))
        except Exception:  # noqa: BLE001 - telemetry is best-effort
            log.exception("voice telemetry row failed")

    # -- TTS --------------------------------------------------------------------- #
    async def tts(self, text: str, *, lang: str, sex: str | None, age: int | float | None,
                  voice_id: str | None = None, output_format: str = "mp3", speed: float = 1.0) -> TtsOutcome:
        text = text.strip()
        if not text:
            raise ValueError("text is empty")
        lang = profiles.normalize_lang(lang)
        profile = profiles.profile_for(sex, age, lang)
        reasons: list[str] = []
        async for ep in self._candidates("tts"):
            name = adapter_name_for(ep)
            adapter = TTS_ADAPTERS[name]
            if adapter.languages is not None and lang not in adapter.languages:
                reasons.append(f"{ep.name}: {name} does not speak {lang}")
                continue
            family = "chatterbox" if ep.source == "gpu_worker" else None
            vid = voice_id or profiles.resolve_voice(name, profile, ep.extra, family=family)
            req = TtsRequest(text=text, lang=lang, voice_id=vid, output_format=output_format, speed=speed)
            t0 = time.monotonic()
            try:
                stream = await adapter.synthesize(self.client, ep, req)
            except LanguageUnsupported as exc:
                reasons.append(f"{ep.name}: {exc.detail}")
                continue
            except (VoiceError, httpx.HTTPError) as exc:
                detail = getattr(exc, "detail", None) or f"{type(exc).__name__}: {exc}"
                reasons.append(f"{ep.name}: {detail}")
                self._record(ep, kind="tts", model=req.model or ep.model or name, chars=len(text),
                             latency_ms=(time.monotonic() - t0) * 1000.0, ok=False, error=type(exc).__name__)
                continue
            ttfb = (time.monotonic() - t0) * 1000.0
            stream.chunks = self._metered(stream.chunks, ep, model=stream.model, chars=len(text), t0=t0)
            return TtsOutcome(stream=stream, endpoint=ep, adapter=name, voice_id=vid, ttfb_ms=ttfb)
        raise NoVoiceProvider("tts", self._refusal_reasons("tts") + reasons, airgapped=self.settings.airgapped)

    async def _metered(self, chunks: AsyncIterator[bytes], ep: ProviderEndpoint, *, model: str, chars: int,
                       t0: float) -> AsyncIterator[bytes]:
        ok = True
        error: str | None = None
        try:
            async for chunk in chunks:
                yield chunk
        except Exception as exc:  # noqa: BLE001 - recorded, then re-raised to the client
            ok, error = False, type(exc).__name__
            raise
        finally:
            self._record(ep, kind="tts", model=model, chars=chars, latency_ms=(time.monotonic() - t0) * 1000.0,
                         ok=ok, error=error)

    # -- STT --------------------------------------------------------------------- #
    async def stt(self, audio: bytes, *, content_type: str, filename: str = "audio.webm",
                  lang: str | None = None) -> SttOutcome:
        if not audio:
            raise ValueError("audio is empty")
        hint = profiles.normalize_lang(lang) if lang else None
        reasons: list[str] = []
        async for ep in self._candidates("stt"):
            name = adapter_name_for(ep)
            adapter = STT_ADAPTERS[name]
            req = SttRequest(audio=audio, content_type=content_type or "application/octet-stream", filename=filename,
                             lang=hint)
            t0 = time.monotonic()
            try:
                result = await adapter.transcribe(self.client, ep, req)
            except (VoiceError, httpx.HTTPError) as exc:
                detail = getattr(exc, "detail", None) or f"{type(exc).__name__}: {exc}"
                reasons.append(f"{ep.name}: {detail}")
                self._record(ep, kind="stt", model=ep.model or name, latency_ms=(time.monotonic() - t0) * 1000.0,
                             ok=False, error=type(exc).__name__)
                continue
            latency = (time.monotonic() - t0) * 1000.0
            self._record(ep, kind="stt", model=result.model, audio_seconds=result.audio_seconds or 0.0,
                         latency_ms=latency, ok=True)
            return SttOutcome(result=result, endpoint=ep, adapter=name, latency_ms=latency)
        raise NoVoiceProvider("stt", self._refusal_reasons("stt") + reasons, airgapped=self.settings.airgapped)

    # -- capabilities ------------------------------------------------------------ #
    def _describe(self, kind: str, ep: ProviderEndpoint | None, reasons: list[str], *,
                  worker_launchable: bool = False) -> dict[str, Any]:
        if ep is None and worker_launchable:
            # Nothing is serving yet, but the first request will launch the GPU worker.
            languages = list(WORKER_TTS_LANGUAGES) if kind == "tts" else ["en", "tr"]
            return {"enabled": True, "provider": "gpu-worker", "source": "gpu_worker", "adapter": "openai_compatible",
                    "model": WORKER_MODELS[kind], "languages": languages, "reasons": reasons, "pending_launch": True}
        if ep is None:
            return {"enabled": False, "provider": None, "source": None, "adapter": None, "model": None,
                    "languages": [], "reasons": reasons}
        name = adapter_name_for(ep)
        if ep.source == "gpu_worker":
            languages: list[str] = list(WORKER_TTS_LANGUAGES) if kind == "tts" else ["en", "tr"]
            model = ep.model
        else:
            adapter: Any = (TTS_ADAPTERS if kind == "tts" else STT_ADAPTERS)[name]
            declared = ep.extra.get("languages")
            if isinstance(declared, list) and declared:
                languages = [str(x) for x in declared]
            elif getattr(adapter, "languages", None):
                languages = sorted(adapter.languages)
            else:
                languages = ["en", "tr"]
            model = adapter.model_for(ep) if hasattr(adapter, "model_for") else ep.model
        return {"enabled": True, "provider": ep.name, "source": ep.source, "adapter": name, "model": model,
                "languages": languages, "reasons": reasons}

    async def capabilities(self, *, probe_worker: bool = False) -> dict[str, Any]:
        """What is enabled now. ``probe_worker`` also counts a launchable GPU worker (never launches one)."""
        out: dict[str, Any] = {"airgapped": self.settings.airgapped}
        wm = self.resolver.worker_manager
        worker_ready = None
        if wm is not None:
            ready = wm.llm_endpoint()
            worker_ready = ready is not None
            status = await wm.status()
            out["gpu_worker"] = {"ready": worker_ready, "can_launch": bool(status.get("can_launch")),
                                 "refusal": status.get("refusal")}
        for kind in ("tts", "stt"):
            eps = self.resolver.endpoints(kind)
            reasons = [f"{r.name}: refused by AIRGAPPED" for r in self.resolver.refused(kind)]
            ep = eps[0] if eps else None
            launchable = False
            if ep is None and wm is not None:
                ready = wm.llm_endpoint()
                if ready is not None:
                    origin = ready["base_url"].rstrip("/")
                    origin = origin[:-3] if origin.endswith("/v1") else origin
                    ep = ProviderEndpoint(kind=kind, name="gpu-worker", base_url=origin + WORKER_PATHS[kind],
                                          model=WORKER_MODELS[kind], api_key="", source="gpu_worker")
                elif probe_worker and out["gpu_worker"]["can_launch"]:
                    launchable = True
                elif out["gpu_worker"].get("refusal"):
                    reasons.append(f"gpu-worker: {out['gpu_worker']['refusal']['reason']}")
            out[kind] = self._describe(kind, ep, reasons, worker_launchable=launchable)
        avatars = self.resolver.endpoints("avatar")
        if avatars:
            av = avatars[0]
            out["avatar"] = {"enabled": True, "provider": av.name, "transport": av.extra.get("transport") or "livekit",
                             "renderer": av.extra.get("avatar") or "none", "source": av.source}
        else:
            refused = [r.name for r in self.resolver.refused("avatar")]
            out["avatar"] = {"enabled": False, "provider": None, "transport": None, "renderer": "none",
                             "reasons": [f"{n}: refused by AIRGAPPED" for n in refused]}
        return out
