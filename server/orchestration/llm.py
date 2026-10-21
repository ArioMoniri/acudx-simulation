"""Structured-output client for the orchestration nodes.

Every model call in ``server/orchestration`` goes through :class:`StructuredLLM`:
an OpenAI-compatible ``/chat/completions`` call that asks for a JSON object
matching a JSON schema (``response_format: json_schema``; llama-server, vLLM,
SGLang and the hosted providers all accept it) and parses the reply robustly.

Two endpoints are resolved from :class:`server.config.Settings`:

* ``casegen`` (``CASEGEN_BASE_URL`` / ``CASEGEN_MODEL``) for author and repair,
* ``judge`` (``JUDGE_BASE_URL`` / ``JUDGE_MODEL``) for the council and the
  Director's narrator.

Both inherit the active LLM endpoint when unset, and both pass through the
``AIRGAPPED`` egress guard at resolution time and again per call.

Honesty rule: a model that cannot be reached raises :class:`ModelUnreachable`;
a reply that is not valid JSON raises :class:`ModelOutputInvalid`. Nothing in
this module ever substitutes a template for a model answer.

Accounting (live findings 2026-10-20): every call, success or failure, is
recorded through the admin :class:`~server.telemetry.events.TelemetryRecorder`
(``kind=llm``, route from :func:`~server.telemetry.events.call_context`). A call
served by the self-hosted GPU worker has no per-token price, so its cost is
amortised: ``usd_per_hour * latency_h / concurrency``, where the hourly price
comes from the GPU ledger (the active worker, else the latest ledger row, else
``CASEGEN_GPU_USD_PER_HOUR``) and ``concurrency`` is the largest number of calls
in flight on the same endpoint during this one (vLLM batches them, so three
parallel judges share the hour instead of each paying for it). The basis is
recorded as ``cost_basis = "gpu_hour_amortised"``.
"""

from __future__ import annotations

import asyncio
import itertools
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Literal, Optional, Protocol

import httpx
from langchain_core.utils.json import parse_json_markdown

from server.config import EgressBlocked, LlmEndpoint, Settings
from server.model_gateway import strip_think, wants_no_thinking
from server.providers import anthropic_messages
from server.telemetry import prices as telemetry_prices

log = logging.getLogger("acudx.orchestration.llm")

# The vLLM ``--served-model-name`` of the GPU worker (server/providers/gpu_worker.py).
SELF_HOSTED_MODEL = "acudx-llm"
COST_BASIS_GPU = "gpu_hour_amortised"

Role = Literal["casegen", "judge"]


class ModelUnreachable(RuntimeError):
    """The endpoint refused, timed out, or answered 5xx after retries."""


class ModelOutputInvalid(RuntimeError):
    """The endpoint answered, but not with a parseable JSON object."""


@dataclass
class LLMReply:
    data: dict[str, Any]
    model: str
    model_requested: str
    provider: str
    tokens_in: int = 0
    tokens_out: int = 0
    latency_ms: float = 0.0
    raw: str = ""
    extras: dict[str, Any] = field(default_factory=dict)


class GpuCostSource(Protocol):
    """Where the hourly price of the self-hosted worker comes from."""

    def usd_per_hour(self) -> Optional[float]: ...

    def serves(self, base_url: str) -> bool: ...

    def touch(self) -> None: ...


class WorkerCostSource:
    """Adapter over :class:`server.providers.gpu_worker.WorkerManager`."""

    def __init__(self, manager: Any, fallback_usd_per_hour: Optional[float] = None) -> None:
        self.manager = manager
        self.fallback = fallback_usd_per_hour

    def usd_per_hour(self) -> Optional[float]:
        try:
            w = self.manager.store.active_worker()
            if w is not None:
                return w.price_cents_per_hour / 100.0
            rows = self.manager.store.ledger(limit=1)
            if rows:
                return rows[0].price_cents_per_hour / 100.0
        except Exception:  # noqa: BLE001 - accounting must never break a call
            log.debug("gpu ledger read failed", exc_info=True)
        return self.fallback

    def serves(self, base_url: str) -> bool:
        try:
            ep = self.manager.llm_endpoint()
        except Exception:  # noqa: BLE001
            return False
        return bool(ep) and ep["base_url"].rstrip("/") == (base_url or "").rstrip("/")

    def touch(self) -> None:
        try:
            self.manager.touch()
        except Exception:  # noqa: BLE001
            pass


class StaticGpuCost:
    """A fixed hourly price (settings fallback, tests)."""

    def __init__(self, usd_per_hour: Optional[float]) -> None:
        self._usd = usd_per_hour

    def usd_per_hour(self) -> Optional[float]:
        return self._usd

    def serves(self, base_url: str) -> bool:
        return False

    def touch(self) -> None:
        return None


def amortised_cost_usd(usd_per_hour: float, latency_ms: float, concurrency: int = 1) -> float:
    """GPU-hour share of one call: hourly price times its latency, split across overlapping calls."""
    return round(max(0.0, usd_per_hour) * max(0.0, latency_ms) / 3_600_000.0 / max(1, concurrency), 8)


def _parse_object(text: str) -> dict[str, Any]:
    clean, _ = strip_think(text or "")
    if not clean:
        raise ModelOutputInvalid("empty reply")
    try:
        obj = parse_json_markdown(clean)
    except (json.JSONDecodeError, ValueError) as exc:
        # Last resort: first balanced object in the text.
        start = clean.find("{")
        end = clean.rfind("}")
        if start == -1 or end <= start:
            raise ModelOutputInvalid(f"no JSON object in reply: {clean[:120]!r}") from exc
        try:
            obj = json.loads(clean[start:end + 1])
        except json.JSONDecodeError as exc2:
            raise ModelOutputInvalid(f"unparseable JSON: {clean[:120]!r}") from exc2
    if not isinstance(obj, dict):
        raise ModelOutputInvalid(f"reply is {type(obj).__name__}, not an object")
    return obj


class StructuredLLM:
    """Async JSON-schema completions against the casegen and judge endpoints."""

    def __init__(
        self,
        settings: Settings,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        timeout_s: float | None = None,
        retries: int = 1,
        telemetry: Any = None,
        gpu: GpuCostSource | None = None,
    ) -> None:
        self.settings = settings
        self.telemetry = telemetry
        fallback = getattr(settings, "casegen_gpu_usd_per_hour", None)
        self.gpu: GpuCostSource | None = gpu if gpu is not None else (
            StaticGpuCost(fallback) if fallback is not None else None)
        self._ids = itertools.count(1)
        # endpoint base_url -> {call id: largest number of calls in flight seen}
        self._inflight: dict[str, dict[int, int]] = {}
        self.endpoints: dict[str, LlmEndpoint] = {
            "casegen": settings.resolve_casegen(),
            "judge": settings.resolve_judge(),
        }
        self._transport = transport
        # Structured case generation is long (thousands of tokens at tens of tokens per
        # second on one GPU), so it gets its own read budget instead of the generic
        # request timeout (live finding 2026-10-20: 60 s cut every author call short).
        self._timeout = httpx.Timeout(
            timeout_s or getattr(settings, "casegen_timeout_s", None) or settings.request_timeout_s,
            connect=settings.connect_timeout_s,
        )
        self._retries = max(0, retries)
        self._client: httpx.AsyncClient | None = None

    def endpoint(self, role: Role) -> LlmEndpoint:
        return self.endpoints[role]

    def self_hosted(self, ep: LlmEndpoint) -> bool:
        """True when ``ep`` is the GPU worker (served alias or the worker's own URL)."""
        if (ep.model or "") == SELF_HOSTED_MODEL:
            return True
        return self.gpu is not None and self.gpu.serves(ep.base_url)

    def _begin(self, base_url: str) -> int:
        cid = next(self._ids)
        active = self._inflight.setdefault(base_url, {})
        active[cid] = 1
        n = len(active)
        for k in active:
            active[k] = max(active[k], n)
        return cid

    def _end(self, base_url: str, cid: int) -> int:
        return self._inflight.get(base_url, {}).pop(cid, 1)

    def _cost(self, ep: LlmEndpoint, latency_ms: float, concurrency: int) -> tuple[Optional[float], Optional[str]]:
        if not self.self_hosted(ep) or self.gpu is None:
            return None, None
        usd = self.gpu.usd_per_hour()
        if usd is None:
            return None, None
        return amortised_cost_usd(usd, latency_ms, concurrency), COST_BASIS_GPU

    def _record(self, ep: LlmEndpoint, *, model: str, tokens_in: int, tokens_out: int, latency_ms: float,
                ok: bool, error: Optional[str], cost: Optional[float]) -> None:
        if self.telemetry is None:
            return
        hosted = self.self_hosted(ep)
        provider = "gpu-worker" if hosted else (telemetry_prices.provider_from_url(ep.base_url) or ep.provider)
        try:
            self.telemetry.record(
                kind="llm", provider=provider, model=model or ep.model or "", billing_provider=provider,
                tokens_in=tokens_in, tokens_out=tokens_out, latency_ms=round(latency_ms, 3), ok=ok,
                error=error, requested_model=ep.model, cost_usd=cost,
            )
        except Exception:  # noqa: BLE001 - telemetry is best-effort
            log.debug("telemetry record failed", exc_info=True)

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=self._timeout, transport=self._transport)
        return self._client

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def complete_json(
        self,
        messages: list[dict[str, str]],
        *,
        schema: dict[str, Any],
        schema_name: str,
        role: Role,
        temperature: float,
        max_tokens: int,
        on_text: Optional[Callable[[str], Any]] = None,
    ) -> LLMReply:
        """One structured completion. With ``on_text`` the call streams (``stream: true``,
        review 06a 4.4 item 6) and ``on_text(accumulated_text)`` runs after every
        content delta, so a caller can parse partial JSON and show fields as they
        arrive. The final reply is parsed exactly like a non-streamed one."""
        ep = self.endpoints[role]
        try:
            self.settings.guard_egress(ep.base_url)
        except EgressBlocked as exc:
            raise ModelUnreachable(str(exc)) from exc

        payload: dict[str, Any] = {
            "model": ep.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": on_text is not None,
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": schema_name, "schema": schema, "strict": False},
            },
        }
        if on_text is not None:
            payload["stream_options"] = {"include_usage": True}
        if wants_no_thinking(ep.model, self.settings):
            # Qwen3-family models otherwise spend the token budget on hidden reasoning
            # before the JSON; vLLM and SGLang accept chat_template_kwargs.
            payload["chat_template_kwargs"] = {"enable_thinking": False}
        headers = {"Content-Type": "application/json"}
        if ep.api_key:
            headers["Authorization"] = f"Bearer {ep.api_key}"

        client = await self._get_client()
        url = f"{ep.base_url}/chat/completions"
        if self.gpu is not None and self.self_hosted(ep):
            self.gpu.touch()  # keep the idle reaper off a worker that is generating
        t0 = time.monotonic()
        cid = self._begin(ep.base_url)
        try:
            if anthropic_messages.is_anthropic(ep.base_url):
                # Registry row for the Anthropic API: native Messages call (server/providers/anthropic_messages.py).
                try:
                    data = await anthropic_messages.chat(
                        base_url=ep.base_url, api_key=ep.api_key, model=ep.model, messages=messages,
                        max_tokens=max_tokens, schema=schema, on_text=on_text,
                        timeout_s=self._timeout.read or 300.0)
                except anthropic_messages.AnthropicCallError as exc:
                    raise ModelUnreachable(str(exc)) from exc
            elif on_text is not None:
                data = await self._post_stream(client, url, payload, headers, on_text)
            else:
                data = await self._post_with_retries(client, url, payload, headers)
        except (ModelUnreachable, ModelOutputInvalid) as exc:
            latency_ms = round((time.monotonic() - t0) * 1000.0, 1)
            concurrency = self._end(ep.base_url, cid)
            cost, _basis = self._cost(ep, latency_ms, concurrency)
            self._record(ep, model=ep.model, tokens_in=0, tokens_out=0, latency_ms=latency_ms, ok=False,
                         error=type(exc).__name__, cost=cost)
            raise
        latency_ms = round((time.monotonic() - t0) * 1000.0, 1)
        concurrency = self._end(ep.base_url, cid)
        cost, basis = self._cost(ep, latency_ms, concurrency)

        choices = data.get("choices") or [{}]
        msg = (choices[0] or {}).get("message") or {}
        content = msg.get("content") or msg.get("reasoning_content") or ""
        if isinstance(content, list):  # some servers return content parts
            content = "".join(p.get("text", "") for p in content if isinstance(p, dict))
        usage = data.get("usage") or {}
        served = str(data.get("model") or ep.model)
        tokens_in = int(usage.get("prompt_tokens") or 0)
        tokens_out = int(usage.get("completion_tokens") or 0)
        try:
            obj = _parse_object(content)
        except ModelOutputInvalid as exc:
            self._record(ep, model=served, tokens_in=tokens_in, tokens_out=tokens_out, latency_ms=latency_ms,
                         ok=False, error=type(exc).__name__, cost=cost)
            raise
        self._record(ep, model=served, tokens_in=tokens_in, tokens_out=tokens_out, latency_ms=latency_ms,
                     ok=True, error=None, cost=cost)
        return LLMReply(
            data=obj,
            model=served,
            model_requested=ep.model,
            provider=ep.provider,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            latency_ms=latency_ms,
            raw=content,
            extras={"finish_reason": (choices[0] or {}).get("finish_reason"), "cost_usd": cost,
                    "cost_basis": basis, "concurrency": concurrency},
        )

    async def _post_with_retries(self, client: httpx.AsyncClient, url: str, payload: dict[str, Any],
                                 headers: dict[str, str]) -> dict[str, Any]:
        last: Exception | None = None
        data: dict[str, Any] | None = None
        for attempt in range(self._retries + 1):
            try:
                resp = await client.post(url, json=payload, headers=headers)
                if resp.status_code >= 500 or resp.status_code == 429:
                    last = ModelUnreachable(f"{url} -> HTTP {resp.status_code}")
                elif resp.status_code >= 400:
                    raise ModelUnreachable(f"{url} -> HTTP {resp.status_code}: {resp.text[:200]}")
                else:
                    data = resp.json()
                    break
            except httpx.TimeoutException as exc:
                # A read timeout on a long generation will time out again; do not
                # triple the wait. Connect timeouts are retried below like other errors.
                last = exc
                if not isinstance(exc, httpx.ConnectTimeout):
                    break
            except httpx.TransportError as exc:
                last = exc
            except ValueError as exc:  # body not JSON
                raise ModelOutputInvalid(f"{url} returned a non-JSON body") from exc
            if attempt < self._retries:
                await asyncio.sleep(min(0.2 * (2 ** attempt), 1.0))
        if data is None:
            raise ModelUnreachable(f"{url} unreachable: {type(last).__name__}: {last}")
        return data

    async def _post_stream(self, client: httpx.AsyncClient, url: str, payload: dict[str, Any],
                           headers: dict[str, str], on_text: Callable[[str], Any]) -> dict[str, Any]:
        """POST with ``stream: true`` and fold the OpenAI SSE chunks into one completion body.

        Connection errors before the first byte are retried like a normal call; once
        tokens have arrived a failure propagates (a half-streamed case is not replayed)."""
        last: Exception | None = None
        for attempt in range(self._retries + 1):
            text = ""
            usage: dict[str, Any] = {}
            model = ""
            finish = None
            started = False
            try:
                async with client.stream("POST", url, json=payload,
                                         headers={**headers, "Accept": "text/event-stream"}) as resp:
                    if resp.status_code >= 500 or resp.status_code == 429:
                        last = ModelUnreachable(f"{url} -> HTTP {resp.status_code}")
                    elif resp.status_code >= 400:
                        body = (await resp.aread()).decode("utf-8", "replace")
                        raise ModelUnreachable(f"{url} -> HTTP {resp.status_code}: {body[:200]}")
                    else:
                        ctype = resp.headers.get("content-type", "")
                        if "text/event-stream" not in ctype:
                            # A server that ignored stream:true answered with one JSON body.
                            data = json.loads((await resp.aread()).decode("utf-8"))
                            choices = data.get("choices") or [{}]
                            content = ((choices[0] or {}).get("message") or {}).get("content") or ""
                            if content:
                                res = on_text(content)
                                if asyncio.iscoroutine(res):
                                    await res
                            return data
                        async for line in resp.aiter_lines():
                            if not line.startswith("data:"):
                                continue
                            chunk = line[5:].strip()
                            if not chunk or chunk == "[DONE]":
                                continue
                            try:
                                obj = json.loads(chunk)
                            except json.JSONDecodeError:
                                continue
                            started = True
                            model = str(obj.get("model") or model)
                            if obj.get("usage"):
                                usage = obj["usage"]
                            for ch in obj.get("choices") or []:
                                delta = (ch or {}).get("delta") or {}
                                piece = delta.get("content")
                                if piece:
                                    text += piece
                                    res = on_text(text)
                                    if asyncio.iscoroutine(res):
                                        await res
                                if ch.get("finish_reason"):
                                    finish = ch["finish_reason"]
                        return {"model": model, "usage": usage,
                                "choices": [{"message": {"content": text}, "finish_reason": finish}]}
            except httpx.TimeoutException as exc:
                last = exc
                if started or not isinstance(exc, httpx.ConnectTimeout):
                    break
            except httpx.TransportError as exc:
                last = exc
                if started:
                    break
            except ValueError as exc:
                raise ModelOutputInvalid(f"{url} returned a non-JSON body") from exc
            if attempt < self._retries:
                await asyncio.sleep(min(0.2 * (2 ** attempt), 1.0))
        raise ModelUnreachable(f"{url} unreachable: {type(last).__name__}: {last}")

    def route_via_registry(self, resolver: Any) -> bool:
        """Point every role WITHOUT an explicit ``CASEGEN_*`` / ``JUDGE_*`` base URL at the gateway's
        registry: the first eligible ``llm`` row (an Anthropic row is called natively), else the
        on-demand GPU worker when it is ready. Returns True when an endpoint was found.

        Never launches a worker (that would block the request for the whole cold boot); the
        route starts one in the background instead (server/orchestration/routes.py ``_preflight``).
        """
        if resolver is None:
            return False
        ep: LlmEndpoint | None = None
        rows = resolver.endpoints("llm")
        if rows:
            r = rows[0]
            ep = LlmEndpoint(base_url=r.base_url.rstrip("/"), model=r.model or "", api_key=r.api_key,
                             provider="api")
        else:
            wm = getattr(resolver, "worker_manager", None)
            w = wm.llm_endpoint() if wm is not None else None
            if w:
                ep = LlmEndpoint(base_url=w["base_url"].rstrip("/"), model=w["model"], api_key=w["api_key"],
                                 provider="local")
        if ep is None:
            return False
        explicit = {"casegen": self.settings.casegen_base_url, "judge": self.settings.judge_base_url}
        for role, pinned in explicit.items():
            if not pinned:
                self.endpoints[role] = ep  # type: ignore[index]
        return True

    async def probe(self, role: Role = "casegen") -> dict[str, Any]:
        """Reachability check used by the routes before starting a graph run."""
        ep = self.endpoints[role]
        try:
            self.settings.guard_egress(ep.base_url)
            client = await self._get_client()
            resp = await client.get(f"{ep.base_url}/models", timeout=self.settings.probe_timeout_s)
            return {"reachable": True, "status": resp.status_code, "model": ep.model, "url": ep.base_url}
        except (httpx.TransportError, EgressBlocked) as exc:
            return {"reachable": False, "error": type(exc).__name__, "model": ep.model, "url": ep.base_url}


def schema_of(model_cls: Any, *, drop: tuple[str, ...] = ()) -> dict[str, Any]:
    """JSON schema for a pydantic model, with optional top-level keys removed."""
    schema = model_cls.model_json_schema()
    props = schema.get("properties", {})
    for key in drop:
        props.pop(key, None)
    if "required" in schema:
        schema["required"] = [r for r in schema["required"] if r not in drop]
    return schema


__all__ = [
    "COST_BASIS_GPU", "GpuCostSource", "LLMReply", "ModelOutputInvalid", "ModelUnreachable", "Role",
    "StaticGpuCost", "StructuredLLM", "WorkerCostSource", "amortised_cost_usd", "schema_of",
]

# Kept for callers that imported the private name before it moved to model_gateway.
_wants_no_thinking = wants_no_thinking
