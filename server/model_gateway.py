"""AcuDx Gateway — the Model Gateway (the ONLY path to any model).

A resource-light async client over the OpenAI-compatible ``/v1/chat/completions``
surface plus thin, defensive adapters for the pod's embed / rerank side-cars.
It **loads no models itself** — it only calls endpoints — and it is the single
chokepoint that mechanically enforces the ``AIRGAPPED`` no-egress invariant
(``docs/architecture/02 §13.1.2``).

What it realises from ``02``:

* ``chat()`` — the conversation clock; robust parsing (``content`` OR
  ``reasoning_content``; ``<think>…</think>`` stripped), retries, timeouts.
* A per-task **tier map** (``patient`` / ``guard`` / ``grade``). Today every
  tier resolves to the one local model, but the structure is the seam where
  future routing (T1 small-open → T2 large-open → T3 frontier) drops in.
* Per-call egress guard so no request can leave the box under ``AIRGAPPED``.
* The Claude route (docs/architecture/20 section 2): with ``ANTHROPIC_KEY`` set and the
  registry's ``anthropic`` row selected, ``chat`` and ``chat_json`` go to Claude first
  (persona, guard classifier, tutor, grading models from settings), with a cache breakpoint
  on the system prompt and automatic caching of the transcript for the persona. Without a
  key, or when Claude is unreachable, the call continues on the registry's next provider.

The exact embed/rerank payload shapes are meant to be *probed at deploy time*;
the adapters below try the common shapes and expose one obvious place to fix.
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from dataclasses import dataclass
from typing import Any

import httpx
from pydantic import BaseModel

from server.config import LlmEndpoint, Settings
from server.providers.anthropic_provider import (
    AnthropicError, AnthropicProvider, AnthropicReply, AnthropicUnavailable, model_for, restore_optional,
)
from server.registry.resolve import ProviderEndpoint, RegistryResolver
from server.telemetry import prices
from server.telemetry.events import TelemetryRecorder

# Matches a complete <think>…</think> reasoning block (some local models, incl.
# Qwen "thinking" variants, wrap chain-of-thought this way). DOTALL for newlines.
_THINK_BLOCK = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)
_STRAY_CLOSE = re.compile(r"^.*?</think>", re.DOTALL | re.IGNORECASE)


class GatewayError(RuntimeError):
    """A model call failed after retries (network, 5xx, or unparseable body)."""


def wants_no_thinking(model: str | None, settings: Settings) -> bool:
    """True when the served model is a Qwen3-family reasoning model (or forced by setting).

    Qwen3 otherwise spends the token budget on hidden reasoning before the
    answer (live finding 2026-10-20: 4 to 6 s and ``had_reasoning=true`` per
    patient turn on the GPU worker). vLLM and SGLang accept
    ``chat_template_kwargs: {"enable_thinking": false}``. The GPU worker serves
    Qwen3 under the alias ``acudx-llm``. Shared by the patient gateway and the
    orchestration client (``server/orchestration/llm.py``)."""
    forced = getattr(settings, "casegen_disable_thinking", None)
    if forced is not None:
        return bool(forced)
    return "qwen3" in (model or "").lower() or (model or "") == "acudx-llm"


def strip_think(text: str) -> tuple[str, bool]:
    """Remove reasoning scaffolding from a completion.

    Returns ``(clean_text, had_think)``. Handles both balanced ``<think>…</think>``
    blocks and the common failure mode of a stray leading ``</think>`` with no
    opening tag (reasoning emitted, then the answer).
    """
    if not text:
        return "", False
    had = False
    if _THINK_BLOCK.search(text):
        text = _THINK_BLOCK.sub("", text)
        had = True
    if "</think>" in text.lower():
        text = _STRAY_CLOSE.sub("", text)
        had = True
    return text.strip(), had


@dataclass(frozen=True)
class TierConfig:
    """Default decode params for a task tier. All point at one model today."""

    task: str
    endpoint: LlmEndpoint
    temperature: float
    max_tokens: int


class ChatResult(BaseModel):
    """Structured result of a ``chat()`` call (+ audit-friendly meta)."""

    text: str                    # clean utterance (think-stripped)
    raw: str                     # model content before stripping
    finish_reason: str | None = None
    model: str
    provider: str
    task: str
    had_reasoning: bool = False  # true if <think> or reasoning_content was seen
    usage: dict[str, Any] | None = None
    latency_ms: float = 0.0


class ModelGateway:
    """Async facade over the pod's model endpoints. One instance per process."""

    def __init__(self, settings: Settings, *, resolver: RegistryResolver | None = None,
                 telemetry: TelemetryRecorder | None = None, anthropic: AnthropicProvider | None = None) -> None:
        self.settings = settings
        # Resolve + guard once at construction so a bad/egressing config fails
        # closed at startup, not mid-encounter.
        self.endpoint: LlmEndpoint = settings.resolve_llm()
        self.tiers: dict[str, TierConfig] = self._build_tiers(self.endpoint)
        self._client: httpx.AsyncClient | None = None
        # Runtime provider registry (docs/architecture/17). When wired, every call
        # resolves its endpoint from the registry (priority, air-gap, GPU worker
        # fallback); without it the env-seeded endpoint above is used.
        self.resolver = resolver
        self.telemetry = telemetry
        # Claude route: ANTHROPIC_KEY, else the key sealed on the registry row (admin panel).
        self.anthropic = anthropic if anthropic is not None else AnthropicProvider(
            settings, key_source=(resolver.anthropic_key if resolver is not None else None), telemetry=telemetry)
        self.claude_fallbacks = 0

    def anthropic_active(self) -> bool:
        """Claude serves this call: a key exists, egress allows it and the registry selects it."""
        if not self.anthropic.usable():
            return False
        if self.resolver is not None:
            try:
                return self.resolver.anthropic_enabled()
            except Exception:  # noqa: BLE001 - a registry read error must not break the call
                return True
        return True

    def anthropic_status(self) -> dict[str, Any]:
        st = dict(self.anthropic.status())
        st["selected"] = self.anthropic_active()
        return st

    # -- endpoint resolution (registry first, env as the seed) -------------- #
    async def resolve_endpoint(self, kind: str) -> ProviderEndpoint:
        """Best endpoint for ``kind`` (llm | embed | rerank) or :class:`GatewayError`."""
        if self.resolver is not None:
            ep = await self.resolver.resolve(kind)
            if ep is None:
                raise GatewayError(
                    f"no enabled {kind} provider is available (configure one under /admin/providers"
                    + (", or allow the GPU worker" if kind == "llm" else "") + ")")
            return ep
        s = self.settings
        if kind == "llm":
            return ProviderEndpoint(kind="llm", name=self.endpoint.provider, base_url=self.endpoint.base_url,
                                    model=self.endpoint.model, api_key=self.endpoint.api_key, source="env")
        if kind == "embed":
            return ProviderEndpoint(kind="embed", name="local", base_url=s.embed_url.rstrip("/"), model=s.embed_model,
                                    api_key=s.llm_api_key, source="env")
        if kind == "rerank":
            return ProviderEndpoint(kind="rerank", name="local", base_url=s.rerank_url.rstrip("/"),
                                    model=s.rerank_model, api_key=s.llm_api_key, source="env")
        raise GatewayError(f"unknown endpoint kind {kind!r}")

    async def _resolve_for_call(self, kind: str) -> ProviderEndpoint:
        """:meth:`resolve_endpoint` for a real call: a refusal is recorded too.

        Acceptance test 2026-10-20 (docs/review/05): once the scheduled probe
        marked the only local model unreachable and the GPU worker was refused
        (AIRGAPPED), every patient turn failed in resolution, before any
        socket, so ``model_calls`` stayed empty and the admin console showed
        0 calls and a 0 % error rate for a session in which every model call
        failed. The failed attempt now leaves one row (provider ``unresolved``).
        """
        try:
            return await self.resolve_endpoint(kind)
        except GatewayError:
            if self.telemetry is not None:
                try:
                    self.telemetry.record(kind=kind, provider="unresolved", model="", billing_provider="unresolved",
                                          latency_ms=0.0, ok=False, error="no_provider")
                except Exception:  # noqa: BLE001 - telemetry is best-effort
                    pass
            raise

    def _record(self, ep: ProviderEndpoint, *, kind: str, model: str | None, usage: dict[str, Any] | None,
                latency_ms: float, ok: bool, error: str | None = None) -> None:
        """One telemetry row per attempt; never lets telemetry break the call."""
        if self.resolver is not None:
            self.resolver.touch(ep)
        if self.telemetry is None:
            return
        u = usage or {}
        details = u.get("prompt_tokens_details") or {}
        try:
            self.telemetry.record(
                kind=kind, provider=ep.name, model=model or ep.model or "",
                billing_provider=prices.provider_from_url(ep.base_url) or ep.name,
                tokens_in=int(u.get("prompt_tokens") or u.get("input_tokens") or 0),
                tokens_out=int(u.get("completion_tokens") or u.get("output_tokens") or 0),
                cached_tokens=int(details.get("cached_tokens") or u.get("cached_tokens") or 0),
                latency_ms=round(latency_ms, 3), ok=ok, error=error, requested_model=ep.model,
            )
        except Exception:  # noqa: BLE001 - telemetry is best-effort
            pass

    # -- tier map (structured for future routing) --------------------------- #
    @staticmethod
    def _build_tiers(ep: LlmEndpoint) -> dict[str, TierConfig]:
        # (temperature, max_tokens) per task. Patient turns are warm + short;
        # guard/grade are deterministic. Future routing swaps `ep` per tier.
        defaults = {
            "patient": (0.7, 400),   # PATIENT_TURN — improvised affect, streamed
            "guard": (0.0, 64),      # GUARDRAIL_CHECK — cheap classifier gate
            "grade": (0.0, 512),     # GRADE_ITEM — structured, deterministic
        }
        return {
            task: TierConfig(task=task, endpoint=ep, temperature=t, max_tokens=m)
            for task, (t, m) in defaults.items()
        }

    # -- lifecycle ---------------------------------------------------------- #
    async def start(self) -> None:
        if self._client is None:
            timeout = httpx.Timeout(
                self.settings.request_timeout_s,
                connect=self.settings.connect_timeout_s,
            )
            self._client = httpx.AsyncClient(timeout=timeout)

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    def _require_client(self) -> httpx.AsyncClient:
        if self._client is None:
            raise GatewayError("ModelGateway.start() was not called")
        return self._client

    # -- chat (conversation clock) ------------------------------------------ #
    async def chat(
        self,
        messages: list[dict[str, str]],
        *,
        task: str = "patient",
        max_tokens: int | None = None,
        temperature: float | None = None,
        stop: list[str] | None = None,
    ) -> ChatResult:
        """Call ``/chat/completions`` for a task tier and parse robustly.

        On the Claude route the task picks the model (``patient`` persona, ``guard``
        classifier, ``tutor``, ``grade``); ``temperature`` and ``stop`` apply to the
        OpenAI-compatible route only."""
        tier = self.tiers.get(task) or self.tiers["patient"]
        if self.anthropic_active():
            try:
                reply = await self._claude(messages, task=task, max_tokens=max_tokens or tier.max_tokens, schema=None)
                return self._claude_result(reply, task)
            except AnthropicUnavailable:
                self.claude_fallbacks += 1
            except AnthropicError as exc:
                raise GatewayError(f"Claude did not answer: {exc}") from exc
        ep = await self._resolve_for_call("llm")
        # Per-call guard: even if the registry were mis-wired to egress, block it.
        self.settings.guard_egress(ep.base_url)

        payload: dict[str, Any] = {
            "model": ep.model or tier.endpoint.model,
            "messages": messages,
            "temperature": tier.temperature if temperature is None else temperature,
            "max_tokens": max_tokens or tier.max_tokens,
            "stream": False,
        }
        if stop:
            payload["stop"] = stop
        if wants_no_thinking(payload["model"], self.settings):
            payload["chat_template_kwargs"] = {"enable_thinking": False}

        t0 = time.monotonic()
        if self.resolver is not None:
            self.resolver.begin(ep)   # the GPU pool balances and scales on requests in flight
        try:
            data = await self._post_json(f"{ep.base_url}/chat/completions", payload, ep.api_key)
        except GatewayError as exc:
            self._record(ep, kind="llm", model=ep.model, usage=None, latency_ms=(time.monotonic() - t0) * 1000.0,
                         ok=False, error=type(exc).__name__)
            raise
        finally:
            if self.resolver is not None:
                self.resolver.end(ep)
        latency_ms = (time.monotonic() - t0) * 1000.0
        result = self._parse_chat(data, tier, latency_ms, ep)
        self._record(ep, kind="llm", model=result.model, usage=result.usage, latency_ms=latency_ms, ok=True)
        return result

    # -- Claude route -------------------------------------------------------- #
    async def _claude(self, messages: list[dict[str, str]], *, task: str, max_tokens: int,
                      schema: dict[str, Any] | None) -> AnthropicReply:
        model, effort = model_for(self.settings, task)
        return await self.anthropic.complete(messages, model=model, max_tokens=max_tokens, effort=effort,
                                             schema=schema, cache_tail=(task == "patient"), node=task)

    @staticmethod
    def _claude_result(reply: AnthropicReply, task: str) -> "ChatResult":
        u = reply.usage
        return ChatResult(
            text=reply.text.strip(), raw=reply.text, finish_reason=reply.stop_reason, model=reply.model,
            provider="anthropic", task=task, had_reasoning=False,
            usage={"input_tokens": u.prompt_total, "output_tokens": u.output, "cache_read_input_tokens": u.cache_read,
                   "cache_creation_input_tokens": u.cache_write, "cost_usd": reply.cost_usd},
            latency_ms=reply.latency_ms,
        )

    async def chat_json(
        self,
        messages: list[dict[str, str]],
        *,
        schema: dict[str, Any],
        schema_name: str,
        task: str = "guard",
        max_tokens: int = 256,
    ) -> tuple[dict[str, Any], "ChatResult"]:
        """One JSON-object completion: Claude structured outputs on the Claude route,
        ``response_format: json_schema`` on an OpenAI-compatible endpoint. Raises
        :class:`GatewayError` when no model answered with a parseable object."""
        if self.anthropic_active():
            try:
                reply = await self._claude(messages, task=task, max_tokens=max_tokens, schema=schema)
                try:
                    data = json.loads(reply.text) if reply.structured else _first_object(reply.text)
                except ValueError as exc:
                    raise GatewayError(f"{reply.model} returned no JSON object") from exc
                if not isinstance(data, dict):
                    raise GatewayError(f"{reply.model} returned {type(data).__name__}, not an object")
                return restore_optional(data, schema), self._claude_result(reply, task)
            except AnthropicUnavailable:
                self.claude_fallbacks += 1
            except AnthropicError as exc:
                raise GatewayError(f"Claude did not answer: {exc}") from exc
        tier = self.tiers.get(task) or self.tiers["guard"]
        ep = await self._resolve_for_call("llm")
        self.settings.guard_egress(ep.base_url)
        payload: dict[str, Any] = {
            "model": ep.model or tier.endpoint.model, "messages": messages, "temperature": 0.0,
            "max_tokens": max_tokens, "stream": False,
            "response_format": {"type": "json_schema",
                                "json_schema": {"name": schema_name, "schema": schema, "strict": False}},
        }
        if wants_no_thinking(payload["model"], self.settings):
            payload["chat_template_kwargs"] = {"enable_thinking": False}
        t0 = time.monotonic()
        try:
            data = await self._post_json(f"{ep.base_url}/chat/completions", payload, ep.api_key)
        except GatewayError as exc:
            self._record(ep, kind="llm", model=ep.model, usage=None, latency_ms=(time.monotonic() - t0) * 1000.0,
                         ok=False, error=type(exc).__name__)
            raise
        latency_ms = (time.monotonic() - t0) * 1000.0
        result = self._parse_chat(data, tier, latency_ms, ep)
        self._record(ep, kind="llm", model=result.model, usage=result.usage, latency_ms=latency_ms, ok=True)
        try:
            obj = _first_object(result.text)
        except ValueError as exc:
            raise GatewayError(f"{result.model} returned no JSON object") from exc
        return obj, result

    @staticmethod
    def _parse_chat(data: dict[str, Any], tier: TierConfig, latency_ms: float,
                    ep: ProviderEndpoint | None = None) -> ChatResult:
        choices = data.get("choices") or [{}]
        choice = choices[0] if choices else {}
        msg = choice.get("message") or {}
        # Prefer visible content; fall back to reasoning_content (thinking models
        # that put the answer there). Either way, strip <think>…</think>.
        content = msg.get("content")
        reasoning = msg.get("reasoning_content")
        raw = content if content else (reasoning or "")
        clean, had_think = strip_think(raw)
        return ChatResult(
            text=clean,
            raw=raw,
            finish_reason=choice.get("finish_reason"),
            model=data.get("model") or (ep.model if ep and ep.model else tier.endpoint.model),
            provider=ep.name if ep is not None else tier.endpoint.provider,
            task=tier.task,
            had_reasoning=bool(reasoning) or had_think,
            usage=data.get("usage"),
            latency_ms=latency_ms,
        )

    # -- HTTP with retries -------------------------------------------------- #
    async def _post_json(
        self, url: str, payload: dict[str, Any], api_key: str | None,
    ) -> dict[str, Any]:
        client = self._require_client()
        headers = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        last_exc: Exception | None = None
        for attempt in range(self.settings.max_retries + 1):
            try:
                resp = await client.post(url, json=payload, headers=headers)
                resp.raise_for_status()
                return resp.json()
            except httpx.HTTPStatusError as exc:
                status = exc.response.status_code
                # Only retry transient server-side / rate-limit failures.
                if status < 500 and status != 429:
                    raise GatewayError(f"{url} -> HTTP {status}: {exc.response.text[:200]}") from exc
                last_exc = exc
            except httpx.TransportError as exc:  # connect/read/timeout/DNS
                last_exc = exc
            await asyncio.sleep(min(0.25 * (2 ** attempt), 2.0))
        raise GatewayError(f"{url} failed after {self.settings.max_retries + 1} attempts: {last_exc}") from last_exc

    # -- embed adapter (thin, defensive) ------------------------------------ #
    async def embed(self, texts: list[str]) -> list[list[float]]:
        """POST texts to ``EMBED_URL`` and return one vector per text.

        The exact request/response shape of the pod's embed service is meant to
        be confirmed at deploy time; we try the common shapes so the fix, if
        any, is one line. ``AIRGAPPED`` guard applies (the URL is local).
        """
        ep = await self._resolve_for_call("embed")
        self.settings.guard_egress(ep.base_url)
        base = ep.base_url
        model = ep.model or self.settings.embed_model
        api_key = ep.api_key or self.settings.llm_api_key
        # The on-pod embed service is OpenAI-compatible: POST /v1/embeddings
        # {"input": [...], "model": ...} -> {"data": [{"embedding": [...]}, ...]}.
        last_exc: Exception | None = None
        t0 = time.monotonic()
        for url in (f"{base}/v1/embeddings", f"{base}/embeddings", base):
            for body in ({"input": texts, "model": model}, {"input": texts}, {"texts": texts}):
                try:
                    data = await self._post_json(url, body, api_key)
                    vecs = _parse_embeddings(data)
                    if vecs and len(vecs) == len(texts):
                        usage = data.get("usage") if isinstance(data, dict) else None
                        self._record(ep, kind="embed", model=model, usage=usage,
                                     latency_ms=(time.monotonic() - t0) * 1000.0, ok=True)
                        return vecs
                except GatewayError as exc:
                    last_exc = exc
        self._record(ep, kind="embed", model=model, usage=None, latency_ms=(time.monotonic() - t0) * 1000.0,
                     ok=False, error="GatewayError")
        raise GatewayError(f"embed() could not reach {base}: {last_exc}")

    # -- rerank adapter (thin, defensive) ----------------------------------- #
    async def rerank(self, query: str, documents: list[str]) -> list[float]:
        """POST (query, documents) to ``RERANK_URL`` → one score per document."""
        ep = await self._resolve_for_call("rerank")
        self.settings.guard_egress(ep.base_url)
        base = ep.base_url
        model = ep.model or self.settings.rerank_model
        api_key = ep.api_key or self.settings.llm_api_key
        # OpenAI/Cohere-style: POST /v1/rerank {"query", "documents", "model"}
        # -> {"results": [{"index", "relevance_score"}, ...]}.
        last_exc: Exception | None = None
        t0 = time.monotonic()
        for url in (f"{base}/v1/rerank", f"{base}/rerank", base):
            for body in ({"query": query, "documents": documents, "model": model},
                         {"query": query, "documents": documents}):
                try:
                    data = await self._post_json(url, body, api_key)
                    scores = _parse_rerank(data, len(documents))
                    if scores is not None:
                        usage = data.get("usage") if isinstance(data, dict) else None
                        self._record(ep, kind="rerank", model=model, usage=usage,
                                     latency_ms=(time.monotonic() - t0) * 1000.0, ok=True)
                        return scores
                except GatewayError as exc:
                    last_exc = exc
        self._record(ep, kind="rerank", model=model, usage=None, latency_ms=(time.monotonic() - t0) * 1000.0,
                     ok=False, error="GatewayError")
        raise GatewayError(f"rerank() could not reach {base}: {last_exc}")

    # -- reachability probes (for /status) ---------------------------------- #
    async def probe(self, url: str, method: str = "GET") -> dict[str, Any]:
        """Cheap 'is anything listening' check — any HTTP reply == reachable."""
        client = self._require_client()
        try:
            resp = await client.request(method, url, timeout=self.settings.probe_timeout_s)
            return {"reachable": True, "status": resp.status_code}
        except Exception as exc:  # noqa: BLE001 — report, never raise, for status
            return {"reachable": False, "error": type(exc).__name__}

    async def reachability(self) -> dict[str, dict[str, Any]]:
        """Probe LLM (/models), embed, and rerank endpoints concurrently."""
        s = self.settings
        llm_models = f"{self.endpoint.base_url}/models"
        llm, embed, rerank = await asyncio.gather(
            self.probe(llm_models),
            self.probe(s.embed_url),
            self.probe(s.rerank_url),
        )
        embed_model = getattr(s, "embed_model", None)
        rerank_model = getattr(s, "rerank_model", None)
        return {
            "llm": {
                "url": self.endpoint.base_url,
                "model": self.endpoint.model,
                "provider": self.endpoint.provider,
                **llm,
            },
            "embed": {"url": s.embed_url, "model": embed_model, **embed},
            "rerank": {"url": s.rerank_url, "model": rerank_model, **rerank},
        }

    # -- scope similarity (docs/architecture/13 §3.2 Layer 1) --------------- #
    async def scope_similarity(self, text: str, scope_vector: list[float]) -> float:
        """Cosine of ``embed(text)`` against a precomputed case scope centroid.

        The embedding Layer-1 signal for the Scope & Injection Guard (the guard
        itself stays pure/deterministic; this is the optional model-assisted
        upgrade). ``numpy`` is imported lazily so the app never hard-depends on
        it at startup — keeping the base install resource-light.
        """
        import numpy as np  # lazy: optional path only

        vecs = await self.embed([text])
        if not vecs:
            return 0.0
        a = np.asarray(vecs[0], dtype=np.float64)
        b = np.asarray(scope_vector, dtype=np.float64)
        denom = float(np.linalg.norm(a) * np.linalg.norm(b))
        return float(np.dot(a, b) / denom) if denom else 0.0


def _first_object(text: str) -> dict[str, Any]:
    """The JSON object in a completion (fenced or bare); ``ValueError`` when there is none."""
    clean, _ = strip_think(text or "")
    start, end = clean.find("{"), clean.rfind("}")
    if start == -1 or end <= start:
        raise ValueError("no JSON object")
    obj = json.loads(clean[start:end + 1])
    if not isinstance(obj, dict):
        raise ValueError("not an object")
    return obj


# --------------------------------------------------------------------------- #
# Response-shape adapters — the one obvious place to tweak per real service.   #
# --------------------------------------------------------------------------- #
def _parse_embeddings(data: Any) -> list[list[float]] | None:
    """Coerce a variety of embed responses into ``list[list[float]]``."""
    if isinstance(data, list):
        # already a list of vectors, or a list of {embedding:[...]}
        if data and isinstance(data[0], dict) and "embedding" in data[0]:
            return [d["embedding"] for d in data]
        return data  # type: ignore[return-value]
    if isinstance(data, dict):
        if isinstance(data.get("embeddings"), list):
            return data["embeddings"]
        if isinstance(data.get("vectors"), list):
            return data["vectors"]
        if isinstance(data.get("data"), list):  # OpenAI: {data:[{embedding:[...]}]}
            out = [d.get("embedding") for d in data["data"] if isinstance(d, dict)]
            if all(v is not None for v in out) and out:
                return out  # type: ignore[return-value]
    return None


def _parse_rerank(data: Any, n_docs: int) -> list[float] | None:
    """Coerce a variety of rerank responses into a per-document score list."""
    if isinstance(data, dict):
        if isinstance(data.get("scores"), list):
            return [float(x) for x in data["scores"]]
        results = data.get("results")
        if isinstance(results, list) and results:
            # Cohere-style: [{index, relevance_score}] — realign to input order.
            scores = [0.0] * n_docs
            ok = False
            for r in results:
                if not isinstance(r, dict):
                    continue
                idx = r.get("index")
                sc = r.get("relevance_score", r.get("score"))
                if isinstance(idx, int) and 0 <= idx < n_docs and sc is not None:
                    scores[idx] = float(sc)
                    ok = True
            if ok:
                return scores
    if isinstance(data, list) and data and isinstance(data[0], (int, float)):
        return [float(x) for x in data]
    return None
