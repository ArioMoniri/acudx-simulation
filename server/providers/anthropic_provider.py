"""Anthropic (Claude) provider: one async client for every Claude-routed role.

Used by :class:`server.orchestration.llm.StructuredLLM` (case author, judges, repair,
narrator, debrief, renderings, safety events) and by
:class:`server.model_gateway.ModelGateway` (patient persona, interview guard, tutor).
docs/architecture/20-chat-contract.md section 2 describes the routing.

* The key comes from ``Settings.anthropic_key`` (env ``ANTHROPIC_KEY``, alias
  ``ANTHROPIC_API_KEY``), else a sealed admin-registry key (env wins when both exist), and stays in this process: it is
  never part of a reply, a log line or :func:`repr`.
* Long, stable system prompts carry an explicit ``cache_control`` breakpoint; multi-turn
  calls (the persona) add a second breakpoint on the last stable turn of the transcript.
* JSON layers use structured outputs (``output_config.format`` with a JSON schema reduced
  to the supported subset by :func:`to_anthropic_schema`). A schema that cannot be
  expressed (free maps, recursion) falls back to a prompt-level JSON contract parsed by
  the caller, never to invented output.
* ``on_text`` streams (``messages.stream``); the accumulated text is passed after every
  delta so a caller can parse partial JSON (the S1 opening).
* Usage is returned as ``input``, ``output``, ``cache_read`` and ``cache_write`` tokens and
  priced from :mod:`server.telemetry.prices` (the official Anthropic price table).

Honesty rule: a refusal, an unreachable API or a truncated JSON reply raises; nothing in
this module substitutes a template for a model answer.
"""

from __future__ import annotations

import asyncio
import copy
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

import anthropic

from server.telemetry import prices

log = logging.getLogger("acudx.providers.anthropic")

PROVIDER = "anthropic"
COST_BASIS_TOKENS = "token_price"

# Server-side refusal fallback (Claude API): route a refused request by category instead
# of failing it. Sent on the models that accept the "default" form.
_FALLBACK_BETA = "server-side-fallback-2026-07-01"
_FALLBACK_MODELS = ("claude-opus-5-5", "claude-sonnet-5-5")

# JSON-schema keywords structured outputs does not accept (tool-use-concepts, 2026-10).
_UNSUPPORTED_KEYS = ("minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum",
                     "multipleOf", "maxItems", "pattern", "minProperties", "maxProperties", "uniqueItems",
                     "title", "default", "examples", "format")
_SUPPORTED_FORMATS = {"date-time", "time", "date", "duration", "email", "hostname", "uri", "ipv4", "ipv6", "uuid"}


class AnthropicError(RuntimeError):
    """Base class: the Claude call did not produce a usable answer."""


class AnthropicUnavailable(AnthropicError):
    """No key, route disabled, egress refused, connection failure, 429/5xx or an auth error."""


class AnthropicRefusal(AnthropicError):
    """``stop_reason == "refusal"``: the model declined; the output is not used."""


class AnthropicTruncated(AnthropicError):
    """``stop_reason == "max_tokens"`` on a structured call: the JSON is incomplete."""


class SchemaNotExpressible(ValueError):
    """The JSON schema uses a construct structured outputs cannot express."""


@dataclass
class Usage:
    input: int = 0           # uncached input tokens
    output: int = 0
    cache_read: int = 0
    cache_write: int = 0

    @property
    def prompt_total(self) -> int:
        return self.input + self.cache_read + self.cache_write


@dataclass
class AnthropicReply:
    text: str
    model: str
    model_requested: str
    usage: Usage
    stop_reason: Optional[str]
    latency_ms: float
    cost_usd: float
    structured: bool = False
    extras: dict[str, Any] = field(default_factory=dict)


# --------------------------------------------------------------------------- #
# Request shaping                                                             #
# --------------------------------------------------------------------------- #
def to_anthropic_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """The schema reduced to the structured-outputs subset.

    Drops length, range, pattern and size constraints (the gates in staged.py and the
    pydantic models still enforce them after parsing), keeps ``minItems`` only at 0 or 1,
    forces ``additionalProperties: false`` on every object and makes every declared
    property required (unrequired ones become nullable). Raises
    :class:`SchemaNotExpressible` for a free map (``additionalProperties`` set to a schema
    or ``true``) or an object without properties, which structured outputs cannot hold."""
    out = copy.deepcopy(schema)

    def walk(node: Any) -> Any:
        if isinstance(node, list):
            return [walk(n) for n in node]
        if not isinstance(node, dict):
            return node
        fmt = node.get("format")
        for key in _UNSUPPORTED_KEYS:
            if key == "format" and fmt in _SUPPORTED_FORMATS:
                continue
            node.pop(key, None)
        if "minItems" in node and int(node.get("minItems") or 0) > 1:
            node["minItems"] = 1
        is_object = node.get("type") == "object" or "properties" in node
        if is_object:
            extra = node.get("additionalProperties", False)
            if extra not in (False, None):
                raise SchemaNotExpressible("free-form map (additionalProperties) is not expressible")
            props = node.get("properties")
            if not props:
                raise SchemaNotExpressible("object without properties is not expressible")
            node["additionalProperties"] = False
            required = set(node.get("required") or [])
            for name, sub in list(props.items()):
                sub = walk(sub)
                if name not in required:
                    sub = {"anyOf": [sub, {"type": "null"}]}
                props[name] = sub
            node["required"] = list(props)
        for key in ("items", "anyOf", "allOf", "oneOf", "$defs", "definitions"):
            if key in node:
                if key in ("$defs", "definitions") and isinstance(node[key], dict):
                    node[key] = {k: walk(v) for k, v in node[key].items()}
                else:
                    node[key] = walk(node[key])
        if "oneOf" in node:  # structured outputs supports anyOf; oneOf of disjoint shapes is equivalent here
            node["anyOf"] = node.pop("oneOf")
        return node

    return walk(out)


def restore_optional(data: Any, schema: dict[str, Any]) -> Any:
    """Undo :func:`to_anthropic_schema`'s nullable stand-ins: a ``null`` for a property the
    ORIGINAL schema did not require is removed, so callers see an absent key as before."""
    if isinstance(data, list):
        items = schema.get("items") if isinstance(schema, dict) else None
        return [restore_optional(d, items or {}) for d in data]
    if not isinstance(data, dict) or not isinstance(schema, dict):
        return data
    props = schema.get("properties") or {}
    required = set(schema.get("required") or [])
    out: dict[str, Any] = {}
    for key, val in data.items():
        if val is None and key in props and key not in required:
            continue
        out[key] = restore_optional(val, props.get(key) or {})
    return out


def split_messages(messages: list[dict[str, Any]]) -> tuple[str, list[dict[str, Any]]]:
    """OpenAI-style messages -> (system text, alternating user/assistant messages).

    Every ``system`` message joins the system prompt (in order); consecutive turns of the
    same role are merged; a transcript that starts with the assistant gets a minimal user
    opener so the first turn is the user's."""
    system_parts: list[str] = []
    out: list[dict[str, Any]] = []
    for m in messages:
        role = m.get("role")
        content = m.get("content") or ""
        if isinstance(content, list):
            content = "".join(p.get("text", "") for p in content if isinstance(p, dict))
        if role == "system":
            if content.strip():
                system_parts.append(content)
            continue
        role = "assistant" if role == "assistant" else "user"
        if not content.strip():
            continue
        if out and out[-1]["role"] == role:
            out[-1]["content"] = out[-1]["content"] + "\n\n" + content
        else:
            out.append({"role": role, "content": content})
    if out and out[0]["role"] == "assistant":
        out.insert(0, {"role": "user", "content": "(the encounter begins)"})
    if not out:
        out.append({"role": "user", "content": "(no message)"})
    return "\n\n".join(system_parts), out


def thinking_for(model: str, effort: str) -> Optional[dict[str, Any]]:
    """Thinking setting per model family (claude-api skill, thinking table 2026-10).

    Claude Opus 5.5 cannot turn thinking off (effort is the control), so it is omitted.
    Claude Sonnet 5.5 turns it off with ``between_tools`` at effort high or below, Claude
    Haiku 5.5 with ``disabled`` at high or below. Short JSON and persona lines do not
    need it, and it would otherwise eat the small output budgets."""
    m = model.lower()
    low_enough = effort in ("low", "medium", "high")
    if m.startswith("claude-sonnet-5-5") and low_enough:
        return {"type": "between_tools"}
    if m.startswith("claude-haiku-5-5") and low_enough:
        return {"type": "disabled"}
    return None


def output_budget(model: str, requested: int, *, streaming: bool, structured: bool = False) -> int:
    """``max_tokens`` with room for adaptive thinking on models that always think.

    A structured (JSON schema) reply on a model with thinking off gets half again as headroom:
    the caps were sized for a guided-JSON GPU worker, and a Claude reply cut at ``max_tokens``
    is unparseable (live 2026-10-21: the Sonnet clinical-consistency judge hit 500 on every
    case). ``max_tokens`` is only a ceiling, so the headroom costs nothing when unused."""
    requested = max(64, int(requested or 0))
    if thinking_for(model, "low") is not None:
        return requested + requested // 2 if structured else requested
    cap = 32_000 if streaming else 16_000
    return min(cap, max(requested * 3, requested + 2048))


def usage_of(message: Any) -> Usage:
    u = getattr(message, "usage", None)
    if u is None:
        return Usage()
    return Usage(input=int(getattr(u, "input_tokens", 0) or 0), output=int(getattr(u, "output_tokens", 0) or 0),
                 cache_read=int(getattr(u, "cache_read_input_tokens", 0) or 0),
                 cache_write=int(getattr(u, "cache_creation_input_tokens", 0) or 0))


def reply_cost(model: str, usage: Usage) -> float:
    return prices.cost_usd(PROVIDER, model, usage.prompt_total, usage.output, usage.cache_read, usage.cache_write)


def _text_of(message: Any) -> str:
    return "".join(getattr(b, "text", "") for b in (getattr(message, "content", None) or [])
                   if getattr(b, "type", None) == "text")


# --------------------------------------------------------------------------- #
# Client                                                                      #
# --------------------------------------------------------------------------- #
class AnthropicProvider:
    """Async Claude client bound to the server settings (or an admin-registry key).

    ``http_client`` is injectable for tests (an ``anthropic.DefaultAsyncHttpxClient`` over
    a recorded-response transport); production builds the SDK default."""

    def __init__(self, settings: Any, *, api_key: Optional[str] = None,
                 key_source: Optional[Callable[[], Optional[str]]] = None, http_client: Any = None,
                 max_retries: int = 2, telemetry: Any = None) -> None:
        self.settings = settings
        self._key_override = api_key
        # Runtime key lookup: the admin registry's sealed key, used when ANTHROPIC_KEY is unset.
        self._key_source = key_source
        self._http_client = http_client
        self._max_retries = max_retries
        self._client: Optional[anthropic.AsyncAnthropic] = None
        self._client_key: Optional[str] = None
        self.telemetry = telemetry

    def __repr__(self) -> str:  # never the key
        return f"AnthropicProvider(base_url={self.base_url!r}, has_key={bool(self._key())})"

    @property
    def base_url(self) -> str:
        return str(getattr(self.settings, "anthropic_base_url", "https://api.anthropic.com")).rstrip("/")

    def _key(self) -> str:
        """An explicit key, else ``ANTHROPIC_KEY`` from the environment, else the key sealed on the
        admin registry's anthropic row (pasted in the admin panel). The environment wins when both
        exist, so an operator can always override the panel from the host."""
        key = self._key_override or (getattr(self.settings, "anthropic_key", None) or "").strip()
        if not key and self._key_source is not None:
            try:
                key = self._key_source()
            except Exception:  # noqa: BLE001 - a broken key source means "no key", never a crash
                key = None
        return (key or "").strip()

    def status(self) -> dict[str, Any]:
        """``{configured, usable, reason}``; ``reason`` is the operator-facing text."""
        if not self._key():
            return {"configured": False, "usable": False, "reason": "Anthropic key not configured"}
        if not getattr(self.settings, "anthropic_route", True):
            return {"configured": True, "usable": False, "reason": "Anthropic route disabled (ANTHROPIC_ROUTE=false)"}
        try:
            self.settings.guard_egress(self.base_url)
        except Exception:  # noqa: BLE001 - EgressBlocked
            return {"configured": True, "usable": False, "reason": f"AIRGAPPED refuses {self.base_url}"}
        return {"configured": True, "usable": True, "reason": None}

    def usable(self) -> bool:
        return bool(self.status().get("usable"))

    def _require(self) -> anthropic.AsyncAnthropic:
        st = self.status()
        if not st.get("usable"):
            raise AnthropicUnavailable(str(st.get("reason") or "Anthropic route unavailable"))
        key = self._key()
        if self._client is None or self._client_key != key:
            kwargs: dict[str, Any] = {"api_key": key, "base_url": self.base_url,
                                      "max_retries": self._max_retries,
                                      "timeout": float(getattr(self.settings, "anthropic_timeout_s", 120.0))}
            if self._http_client is not None:
                kwargs["http_client"] = self._http_client
            self._client = anthropic.AsyncAnthropic(**kwargs)
            self._client_key = key
        return self._client

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.close()
            self._client = None

    # ------------------------------------------------------------------ calls
    def _request(self, *, model: str, system: str, messages: list[dict[str, Any]], max_tokens: int, effort: str,
                 schema: Optional[dict[str, Any]], cache_tail: bool) -> dict[str, Any]:
        req: dict[str, Any] = {"model": model, "max_tokens": max_tokens, "messages": messages}
        if system:
            # Explicit breakpoint on the stable system prefix (charter + case block).
            req["system"] = [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}]
        output_config: dict[str, Any] = {"effort": effort}
        if schema is not None:
            output_config["format"] = {"type": "json_schema", "schema": schema}
        req["output_config"] = output_config
        thinking = thinking_for(model, effort)
        if thinking is not None:
            req["thinking"] = thinking
        if cache_tail and len(messages) >= 2:
            # Multi-turn: breakpoint on the last STABLE turn, not the tail. The last user message
            # carries volatile state and is rebuilt shorter next turn, so a tail breakpoint writes
            # an entry no later request matches (live run 2026-10-21: reads stayed at the system).
            stable = dict(messages[-2])
            stable["content"] = [{"type": "text", "text": stable["content"], "cache_control": {"type": "ephemeral"}}]
            req["messages"] = [*messages[:-2], stable, messages[-1]]
        if model in _FALLBACK_MODELS:
            req["extra_headers"] = {"anthropic-beta": _FALLBACK_BETA}
            req["extra_body"] = {"fallbacks": "default"}
        return req

    async def complete(
        self,
        messages: list[dict[str, Any]],
        *,
        model: str,
        max_tokens: int,
        effort: str = "low",
        schema: Optional[dict[str, Any]] = None,
        on_text: Optional[Callable[[str], Any]] = None,
        cache_tail: bool = False,
        kind: str = "llm",
        node: Optional[str] = None,
    ) -> AnthropicReply:
        """One Claude call. ``schema`` turns on structured outputs (when expressible);
        ``on_text`` streams. Records one telemetry row (success or failure)."""
        client = self._require()
        system, msgs = split_messages(messages)
        structured = False
        api_schema = None
        if schema is not None:
            try:
                api_schema = to_anthropic_schema(schema)
                structured = True
            except SchemaNotExpressible:
                log.info("schema for %s is not expressible as structured output; prompt contract used", node)
        budget = output_budget(model, max_tokens, streaming=on_text is not None, structured=structured)
        req = self._request(model=model, system=system, messages=msgs, max_tokens=budget, effort=effort,
                            schema=api_schema, cache_tail=cache_tail)
        t0 = time.monotonic()
        try:
            if on_text is not None:
                message = await self._stream(client, req, on_text)
            else:
                message = await client.messages.create(**req)
        except anthropic.AuthenticationError as exc:
            self._record(model, Usage(), t0, ok=False, error="AuthenticationError", kind=kind)
            raise AnthropicUnavailable("Anthropic rejected the key (401)") from exc
        except anthropic.PermissionDeniedError as exc:
            self._record(model, Usage(), t0, ok=False, error="PermissionDeniedError", kind=kind)
            raise AnthropicUnavailable("Anthropic key lacks permission (403)") from exc
        except anthropic.RateLimitError as exc:
            self._record(model, Usage(), t0, ok=False, error="RateLimitError", kind=kind)
            raise AnthropicUnavailable("Anthropic rate limited the request (429)") from exc
        except anthropic.BadRequestError as exc:
            self._record(model, Usage(), t0, ok=False, error="BadRequestError", kind=kind)
            raise AnthropicError(f"Anthropic rejected the request (400): {exc.message[:200]}") from exc
        except anthropic.APIStatusError as exc:
            self._record(model, Usage(), t0, ok=False, error=f"HTTP{exc.status_code}", kind=kind)
            raise AnthropicUnavailable(f"Anthropic answered HTTP {exc.status_code}") from exc
        except anthropic.APIConnectionError as exc:
            self._record(model, Usage(), t0, ok=False, error=type(exc).__name__, kind=kind)
            raise AnthropicUnavailable(f"Anthropic unreachable: {type(exc).__name__}") from exc
        usage = usage_of(message)
        served = str(getattr(message, "model", None) or model)
        stop = getattr(message, "stop_reason", None)
        latency = self._record(served, usage, t0, ok=stop not in ("refusal",), error=("refusal" if stop == "refusal"
                                                                                        else None),
                               kind=kind, requested=model)
        if stop == "refusal":
            raise AnthropicRefusal(f"{served} declined the request")
        text = _text_of(message)
        if structured and stop == "max_tokens":
            raise AnthropicTruncated(f"{served} hit max_tokens={budget} before the JSON closed")
        return AnthropicReply(text=text, model=served, model_requested=model, usage=usage, stop_reason=stop,
                              latency_ms=latency, cost_usd=reply_cost(served, usage), structured=structured,
                              extras={"max_tokens": budget, "effort": effort, "node": node})

    async def _stream(self, client: anthropic.AsyncAnthropic, req: dict[str, Any],
                      on_text: Callable[[str], Any]) -> Any:
        acc = ""
        async with client.messages.stream(**req) as stream:
            async for piece in stream.text_stream:
                if not piece:
                    continue
                acc += piece
                res = on_text(acc)
                if asyncio.iscoroutine(res):
                    await res
            return await stream.get_final_message()

    def _record(self, model: str, usage: Usage, t0: float, *, ok: bool, error: Optional[str], kind: str,
                requested: Optional[str] = None) -> float:
        latency = round((time.monotonic() - t0) * 1000.0, 1)
        if self.telemetry is None:
            return latency
        try:
            self.telemetry.record(
                kind=kind, provider=PROVIDER, model=model, billing_provider=PROVIDER,
                tokens_in=usage.prompt_total, tokens_out=usage.output, cached_tokens=usage.cache_read,
                cache_write_tokens=usage.cache_write, latency_ms=latency, ok=ok, error=error,
                requested_model=requested or model,
            )
        except Exception:  # noqa: BLE001 - telemetry is best-effort
            log.debug("telemetry record failed", exc_info=True)
        return latency

    async def list_models(self) -> list[str]:
        """Model ids the key can use (admin probe)."""
        client = self._require()
        page = await client.models.list()
        return [m.id for m in getattr(page, "data", [])]


def model_for(settings: Any, role: str, node: Optional[str] = None) -> tuple[str, str]:
    """(model, effort) for one call site. ``role`` is the StructuredLLM role or a gateway task;
    ``node`` the stage (``s1``, ``kernel``, ``layer:history.presenting``, ``render:...``,
    ``repair``, ``judge:<name>``, ``narrator``, ``safety_event``)."""
    s = settings
    n = (node or "").lower()
    if role in ("patient", "persona"):
        return s.anthropic_model_persona, "low"
    if role in ("guard", "classifier"):
        return s.anthropic_model_classifier, "low"
    if role == "tutor":
        return s.anthropic_model_tutor, "low"
    if role == "grade":
        return s.anthropic_model_debrief, "medium"
    if role == "grounding" or n.startswith("ground"):
        return s.anthropic_model_grounding, "low"
    if n.startswith("judge:"):
        from server.orchestration.judges import JUDGES  # noqa: PLC0415 - avoid an import cycle

        name = n.split(":", 1)[1]
        models = list(s.anthropic_judge_models or []) or [s.anthropic_model_author]
        idx = JUDGES.index(name) if name in JUDGES else 0
        return models[idx % len(models)], "medium"
    if n in ("narrator", "director_affect"):
        return s.anthropic_model_narrator, "low"
    if n.startswith("render"):
        return s.anthropic_model_render, "low"
    if "debrief" in n:
        return s.anthropic_model_debrief, "medium"
    if n.startswith("repair") or "repair" in n:
        return s.anthropic_model_repair, "high"
    if n in ("s1",):
        return s.anthropic_model_author, "low"
    if role == "judge":
        models = list(s.anthropic_judge_models or []) or [s.anthropic_model_author]
        return models[0], "medium"
    return s.anthropic_model_author, "medium"


__all__ = [
    "AnthropicError", "AnthropicProvider", "AnthropicRefusal", "AnthropicReply", "AnthropicTruncated",
    "AnthropicUnavailable", "COST_BASIS_TOKENS", "PROVIDER", "SchemaNotExpressible", "Usage", "model_for",
    "output_budget", "reply_cost", "restore_optional", "split_messages", "thinking_for", "to_anthropic_schema", "usage_of",
]
