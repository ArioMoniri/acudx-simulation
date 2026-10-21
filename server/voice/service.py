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
   For TTS this step never waits on a cold boot: with no ready worker the launch runs in the
   background (:meth:`VoiceService.wake_worker`) and the route answers a fast 503 with
   ``pending_launch: true``, so the browser voices the line itself until the worker is up.

Every attempt writes one telemetry row (``kind`` tts/stt) through
:class:`~server.telemetry.events.TelemetryRecorder`; the cost comes from
:func:`server.telemetry.prices.voice_cost_usd` with ``tokens_in`` carrying the
billed unit (characters for TTS, whole audio seconds for STT).
"""

from __future__ import annotations

import asyncio
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

# Chatterbox TTS API health route behind the worker's Caddy /tts prefix (bearer required).
WORKER_TTS_HEALTH_PATH = "/tts/health"
WORKER_PROBE_TIMEOUT_S = 3.0

# Languages the self-hosted worker serves (Chatterbox Multilingual list, research doc section 3.2).
WORKER_TTS_LANGUAGES = ("ar", "da", "de", "el", "en", "es", "fi", "fr", "he", "hi", "it", "ja", "ko", "ms", "nl",
                        "no", "pl", "pt", "ru", "sv", "sw", "tr")

# A patient line never waits on a GPU cold boot (minutes) while the browser gives up after 30 s:
# with no ready worker the TTS route starts one in the background, waits only this long (a worker
# that is already up answers well within it), then answers a fast 503 ``pending_launch`` so the
# browser speaks the line itself until the worker is ready.
WORKER_TTS_BOOT_WAIT_S = 0.25
# A worker marked ready gets longer: its health probe (TLS through any egress proxy) runs first.
WORKER_TTS_READY_WAIT_S = 10.0
# Typical cold boot of a worker (image pull, weights, vLLM, Chatterbox, MuseTalk), shown as an estimate.
WORKER_BOOT_ESTIMATE_S = 600
# Cold launch to live video: the worker above, then the MuseTalk runner build and its models, the
# voices and the image edit server (measured on a Lambda A100 40 GB, docs/architecture/18 6.7).
VIDEO_READY_ESTIMATE_S = 1200


class NoVoiceProvider(RuntimeError):
    def __init__(self, kind: str, reasons: list[str], *, airgapped: bool, pending_launch: bool = False):
        super().__init__(f"no {kind} provider available: {'; '.join(reasons) or 'none configured'}")
        self.kind = kind
        self.reasons = reasons
        self.airgapped = airgapped
        # True while the GPU worker is booting (or its TTS side-car is still loading): retry later.
        self.pending_launch = pending_launch


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
        # Calls being set up per worker origin (SessionStore.pending_on), wired by the app.
        self.avatar_calls: Any = None
        # The background GPU worker launch (``wake_worker``): one at a time, shared by every caller.
        self._wake: asyncio.Task[ProviderEndpoint | None] | None = None
        self._wake_started_at: float | None = None
        self._wake_error: str | None = None

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

    async def _tts_candidates(self, flags: dict[str, bool]) -> AsyncIterator[ProviderEndpoint]:
        """As :meth:`_candidates`, but the GPU worker step never waits on a cold boot: with no
        ready worker it starts one in the background and sets ``flags["pending"]``."""
        for ep in self.resolver.endpoints("tts"):
            yield ep
        worker = await self._worker_for_tts(flags)
        if worker is not None:
            yield worker

    # -- on-demand GPU worker ---------------------------------------------------- #
    def wake_worker(self) -> asyncio.Task[ProviderEndpoint | None] | None:
        """Start (or join) a GPU worker launch WITHOUT waiting on its boot; None when no manager.

        The launch runs as one shared task (``ensure_worker`` shields the boot itself, so a caller
        that stops waiting never cancels it); its outcome feeds ``capabilities()["gpu_worker"]["wake"]``.
        """
        if self.resolver.worker_manager is None:
            return None
        task = self._wake
        if task is None or task.done():
            self._wake_error = None
            self._wake_started_at = time.time()
            task = asyncio.get_running_loop().create_task(self._wake_run())
            self._wake = task
        return task

    async def _wake_run(self) -> ProviderEndpoint | None:
        try:
            ep = await self.resolver.resolve_worker("tts")
        except Exception as exc:  # noqa: BLE001 - background launch: recorded for the status, never raised
            log.warning("gpu worker launch failed: %s", type(exc).__name__)
            self._wake_error = f"launch failed ({type(exc).__name__})"
            return None
        if ep is None:
            self._wake_error = self.resolver.last_worker_refusal or "not available"
        return ep

    def _wake_state(self, status: dict[str, Any], ready: bool) -> dict[str, Any]:
        """Where an on-demand launch stands: idle | starting | ready | failed, with the boot's elapsed time."""
        booting = [w for w in (status.get("workers") or [])
                   if isinstance(w, dict) and w.get("status") in ("launching", "booting")]
        launching = bool((status.get("capacity") or {}).get("launching")) or bool(booting)
        running = self._wake is not None and not self._wake.done()
        started = [float(w["launched_at"]) for w in booting if w.get("launched_at")]
        if self._wake_started_at is not None and running:
            started.append(self._wake_started_at)
        if ready:
            state, detail = "ready", None
        elif running or launching:
            state, detail = "starting", None
        elif self._wake_error:
            state, detail = "failed", self._wake_error
        else:
            state, detail = "idle", None
        elapsed = round(max(0.0, time.time() - min(started)), 1) if started and state == "starting" else None
        return {"state": state, "detail": detail, "elapsed_s": elapsed, "estimate_s": WORKER_BOOT_ESTIMATE_S}

    async def _worker_for_tts(self, flags: dict[str, bool]) -> ProviderEndpoint | None:
        """The worker's TTS endpoint when it answers within a short wait, else None with a launch
        running in the background and ``flags["pending"]`` set. A refusal yields None, not pending."""
        wm = self.resolver.worker_manager
        if wm is None:
            return None
        wait = WORKER_TTS_READY_WAIT_S if wm.llm_endpoint() else WORKER_TTS_BOOT_WAIT_S
        task = self.wake_worker()
        assert task is not None
        try:
            ep = await asyncio.wait_for(asyncio.shield(task), timeout=wait)
        except asyncio.TimeoutError:
            flags["pending"] = True
            return None
        if ep is not None:
            flags["worker"] = True
        return ep

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
                  voice_id: str | None = None, output_format: str = "mp3", speed: float = 1.0,
                  stream: bool = False) -> TtsOutcome:
        text = text.strip()
        if not text:
            raise ValueError("text is empty")
        lang = profiles.normalize_lang(lang)
        profile = profiles.profile_for(sex, age, lang)
        reasons: list[str] = []
        flags = {"pending": False, "worker": False}
        async for ep in self._tts_candidates(flags):
            name = adapter_name_for(ep)
            adapter = TTS_ADAPTERS[name]
            if adapter.languages is not None and lang not in adapter.languages:
                reasons.append(f"{ep.name}: {name} does not speak {lang}")
                continue
            declared = ep.extra.get("languages")
            if isinstance(declared, list) and declared and lang not in [str(x) for x in declared]:
                # e.g. a Kokoro row (English voices only) declared ["en"]: a Turkish line goes on
                # to the next row or the worker's Chatterbox instead of an English voice.
                reasons.append(f"{ep.name}: row declares languages {declared}, not {lang}")
                continue
            family = "chatterbox" if ep.source == "gpu_worker" else None
            vid = voice_id or profiles.resolve_voice(name, profile, ep.extra, family=family)
            req = TtsRequest(text=text, lang=lang, voice_id=vid, output_format=output_format, speed=speed,
                             stream=stream)
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
                if ep.source == "gpu_worker":
                    # Chatterbox is built after vLLM is up: a ready worker whose TTS side-car does not
                    # answer yet is still booting, not a permanent refusal.
                    flags["pending"] = True
                continue
            ttfb = (time.monotonic() - t0) * 1000.0
            stream.chunks = self._metered(stream.chunks, ep, model=stream.model, chars=len(text), t0=t0)
            return TtsOutcome(stream=stream, endpoint=ep, adapter=name, voice_id=vid, ttfb_ms=ttfb)
        if flags["pending"] and not flags["worker"]:
            reasons.append("gpu-worker: starting (launched on demand; retry shortly)")
        raise NoVoiceProvider("tts", self._refusal_reasons("tts") + reasons, airgapped=self.settings.airgapped,
                              pending_launch=flags["pending"])

    async def prewarm_tts(self, lang: str) -> str | None:
        """Open the connection the next ``tts(lang)`` call will use (TLS through any egress proxy, the
        worker's health TTL), so a call's first patient line does not pay it. The first row that would
        serve ``lang`` gets one cheap GET: the worker's ``/tts/health`` with its bearer, a registry row's
        base URL without credentials (any status is fine; only the connection matters). Never raises."""
        lang = profiles.normalize_lang(lang)
        try:
            async for ep in self._candidates("tts"):
                adapter = TTS_ADAPTERS[adapter_name_for(ep)]
                if adapter.languages is not None and lang not in adapter.languages:
                    continue
                declared = ep.extra.get("languages")
                if isinstance(declared, list) and declared and lang not in [str(x) for x in declared]:
                    continue
                if ep.source == "gpu_worker":
                    await self.client.get(f"{ep.base_url.rstrip('/')}/health", timeout=5.0,
                                          headers={"Authorization": f"Bearer {ep.api_key}"})
                else:
                    await self.client.get(ep.base_url, timeout=5.0)
                return ep.name
        except (httpx.HTTPError, VoiceError) as exc:
            log.info("tts prewarm failed: %s", type(exc).__name__)
        except Exception as exc:  # noqa: BLE001 - a warm-up must never break a call (WorkerRefused, ...)
            log.info("tts prewarm skipped: %s", type(exc).__name__)
        return None

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

    async def _probe_worker_path(self, url: str, token: str) -> tuple[bool, str]:
        """One bearer GET against a worker side-car route; never raises."""
        try:
            r = await self.client.get(url, headers={"Authorization": f"Bearer {token}"},
                                      timeout=WORKER_PROBE_TIMEOUT_S)
        except httpx.HTTPError as exc:
            return False, f"unreachable ({type(exc).__name__})"
        if r.status_code != 200:
            return False, f"HTTP {r.status_code}"
        # Chatterbox answers 200 on /health even when its model failed to initialize
        # (2026-10-20: "initialization_state": "error"); trust the body when it says so.
        try:
            body = r.json()
        except ValueError:
            return True, "ok"
        if isinstance(body, dict) and (body.get("model_loaded") is False or body.get("status") == "error"):
            return False, f"model not loaded ({body.get('initialization_error') or body.get('status')})"
        return True, "ok"

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
                                 "refusal": status.get("refusal"), "wake": self._wake_state(status, worker_ready)}
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
                    if kind == "tts":
                        # The worker's /healthz is vLLM only, and Chatterbox is built after vLLM
                        # starts, so a ready worker does not imply TTS: ask the side-car itself.
                        ok, detail = await self._probe_worker_path(origin + WORKER_TTS_HEALTH_PATH,
                                                                   str(ready.get("api_key") or ""))
                        out["gpu_worker"]["tts"] = {"path": WORKER_TTS_HEALTH_PATH, "ok": ok, "detail": detail}
                        if not ok:
                            reasons.append(f"gpu-worker: {WORKER_TTS_HEALTH_PATH} {detail}")
                            ep = None
                elif probe_worker and out["gpu_worker"]["can_launch"]:
                    launchable = True
                elif out["gpu_worker"].get("refusal"):
                    reasons.append(f"gpu-worker: {out['gpu_worker']['refusal']['reason']}")
            out[kind] = self._describe(kind, ep, reasons, worker_launchable=launchable)
        out["avatar"] = await self._avatar_capabilities(out.get("gpu_worker"), probe_worker=probe_worker)
        if wm is not None and out["avatar"].get("source") == "gpu_worker":
            out["avatar"]["wake"] = self._video_wake(status, out["avatar"])
        return out

    def _video_wake(self, status: dict[str, Any], avatar: dict[str, Any]) -> dict[str, Any]:
        """How far the live video is from ready: stage ``idle`` (nothing launched), ``machine`` (the GPU
        machine boots), ``video_services`` (the worker answers; runner, voices and image edits load),
        ``ready`` or ``failed``, with the time since launch and an estimate for the progress bar."""
        if avatar.get("enabled") and avatar.get("live_video"):
            return {"stage": "ready", "elapsed_s": None, "estimate_s": VIDEO_READY_ESTIMATE_S, "progress": 1.0}
        workers = [w for w in (status.get("workers") or [])
                   if isinstance(w, dict) and w.get("status") in ("launching", "booting", "ready")]
        started = [float(w["launched_at"]) for w in workers if w.get("launched_at")]
        running = self._wake is not None and not self._wake.done()
        if running and self._wake_started_at is not None:
            started.append(self._wake_started_at)
        state = str(avatar.get("state") or "")
        if any(w.get("status") == "ready" for w in workers):
            stage = "failed" if state in ("disabled", "failed", "error") else "video_services"
        elif workers or running or (status.get("capacity") or {}).get("launching"):
            stage = "machine"
        elif self._wake_error:
            return {"stage": "failed", "elapsed_s": None, "estimate_s": VIDEO_READY_ESTIMATE_S, "progress": 0.0,
                    "detail": self._wake_error}
        else:
            return {"stage": "idle", "elapsed_s": None, "estimate_s": VIDEO_READY_ESTIMATE_S, "progress": 0.0}
        elapsed = round(max(0.0, time.time() - min(started)), 1) if started else 0.0
        out = {"stage": stage, "elapsed_s": elapsed, "estimate_s": VIDEO_READY_ESTIMATE_S,
               "progress": round(min(0.95, elapsed / VIDEO_READY_ESTIMATE_S), 3)}
        if stage == "failed":
            out["detail"] = (avatar.get("reasons") or [state])[-1]
        elif stage == "video_services" and state:
            out["runner"] = state
        return out

    async def _avatar_capabilities(self, gpu: dict[str, Any] | None, *, probe_worker: bool) -> dict[str, Any]:
        """Live patient video. The on-prem GPU worker runner is the default (owner decision 2026-10-21); a
        hosted row (Tavus, LiveKit) is used first only when the owner marked it ``extra.default: true``,
        and otherwise when no GPU worker is configured. Hosted rows are listed under ``optional``."""
        from server.voice.avatar import musetalk as mt  # noqa: PLC0415 - avatar imports this module
        from server.voice.avatar import tavus as tv  # noqa: PLC0415

        reasons = [f"{r.name}: refused by AIRGAPPED" for r in self.resolver.refused("avatar")]
        hosted: list[dict[str, Any]] = []
        for av in self.resolver.endpoints("avatar"):
            if tv.is_tavus_endpoint(av):
                if not av.api_key:
                    reasons.append(f"{av.name}: no Tavus API key stored")
                    continue
                block = {"enabled": True, "provider": av.name, "transport": "tavus", "renderer": "tavus",
                         "source": av.source, "live_video": True}
            else:
                block = {"enabled": True, "provider": av.name, "transport": av.extra.get("transport") or "livekit",
                         "renderer": av.extra.get("avatar") or "none", "source": av.source, "live_video": True}
            if av.extra.get("default"):
                return {**block, "reasons": reasons}
            hosted.append(block)
        optional = [{"provider": b["provider"], "transport": b["transport"]} for b in hosted]
        wm = self.resolver.worker_manager
        base = {"enabled": False, "provider": None, "transport": None, "renderer": "none", "live_video": False}
        if wm is None:
            if hosted:
                return {**hosted[0], "reasons": reasons}
            return {**base, "reasons": reasons}
        out = await self._worker_avatar(mt, wm, gpu, probe_worker=probe_worker, reasons=reasons, base=base)
        if optional:
            out["optional"] = optional
        return out

    async def _worker_avatar(self, mt: Any, wm: Any, gpu: dict[str, Any] | None, *, probe_worker: bool,
                             reasons: list[str], base: dict[str, Any]) -> dict[str, Any]:
        limit = int(getattr(self.settings, "avatar_max_calls_per_worker", 2) or 2)
        pending = self.avatar_calls if callable(self.avatar_calls) else None
        eps = wm.endpoints() if hasattr(wm, "endpoints") else [wm.llm_endpoint()]
        eps = [e for e in eps if e]
        if len(eps) > 1:
            picked, _h, _cap = await mt.pick_worker(self.client, wm, gateway_limit=limit, pending=pending)
            worker = picked or mt.worker_from_endpoint(eps[0])
        else:
            worker = mt.worker_from_endpoint(eps[0]) if eps else None
        if worker is None:
            can_launch = bool(gpu and gpu.get("can_launch"))
            if can_launch:
                reasons.append("gpu-worker: not running; it starts on demand (the first spoken reply launches it)")
            elif gpu and gpu.get("refusal"):
                reasons.append(f"gpu-worker: {gpu['refusal']['reason']}")
            return {**base, "provider": "gpu-worker", "transport": "webrtc", "renderer": mt.RENDERER,
                    "source": "gpu_worker", "pending_launch": bool(probe_worker and can_launch), "reasons": reasons}
        h = await mt.health(self.client, worker)
        block: dict[str, Any] = {"provider": "gpu-worker", "transport": "webrtc", "renderer": mt.RENDERER,
                                 "model": mt.MODEL, "source": "gpu_worker", "state": h.get("state")}
        if h.get("ok"):
            gpu_info = h.get("gpu") or {}
            pending = self.avatar_calls(worker.origin) if callable(self.avatar_calls) else 0
            cap = mt.call_capacity(h, gateway_limit=int(getattr(self.settings, "avatar_max_calls_per_worker", 2) or 2),
                                   gateway_pending=pending)
            if cap["calls_available"] <= 0:
                reasons.append(f"gpu-worker avatar: all {cap['max_calls']} live calls on this worker are in use")
            ig = await mt.imagegen_health(self.client, worker)
            block["appearance"] = {"enabled": bool(ig.get("ok")), "model": ig.get("model"), "mode": ig.get("mode"),
                                   "licence": ig.get("licence"), "reason": None if ig.get("ok") else ig.get("reason")}
            return {**block, "enabled": True, "live_video": cap["calls_available"] > 0, "reasons": reasons,
                    "sessions": h.get("sessions"), "max_sessions": h.get("max_sessions"), **cap,
                    "turn": ["udp:3478", "tcp:3478", "tls:443"], "infer_fps": h.get("infer_fps"),
                    "calls": h.get("calls") or [], "last_speech_trace": h.get("last_speech_trace"),
                    "vram": {k: gpu_info.get(k) for k in ("name", "total_mb", "free_mb", "process_reserved_mb")}}
        detail = h.get("reason") or h.get("detail") or ""
        reasons.append(f"gpu-worker avatar: {h.get('state')}{(' (' + str(detail) + ')') if detail else ''}")
        vram = {k: h[k] for k in ("total_mb", "free_mb", "required_mb") if k in h}
        return {**block, "enabled": False, "live_video": False, "reasons": reasons,
                **({"vram": vram} if vram else {})}
