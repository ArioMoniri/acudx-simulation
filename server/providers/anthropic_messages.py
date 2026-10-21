"""Native Anthropic Messages API adapter for registry LLM rows that point at api.anthropic.com.

The gateway's model calls are written against the OpenAI-compatible ``/chat/completions``
shape (local vLLM / llama-server, the GPU worker). An LLM row whose ``base_url`` host is
``api.anthropic.com`` (added by a super_admin in the admin console; the key is sealed in the
registry) is instead called through the official ``anthropic`` SDK, and the reply is folded
back into the OpenAI body shape the callers already parse:

    {"model", "choices": [{"message": {"content"}, "finish_reason"}],
     "usage": {"prompt_tokens", "completion_tokens"}}

* system messages are lifted into ``system``; the rest keep their user / assistant roles;
* a JSON schema becomes ``output_config.format`` (structured outputs); when the API refuses
  the schema shape (400), the call is repeated once without it and the caller's JSON parser
  takes the text;
* no ``temperature`` is sent (current Claude models reject sampling parameters) and no
  ``thinking`` setting (adaptive by default);
* ``on_text`` streams the call and receives the accumulated text after each delta;
* a ``refusal`` stop reason surfaces as ``finish_reason="refusal"`` with empty content.
"""

from __future__ import annotations

import asyncio
from typing import Any, Callable, Optional
from urllib.parse import urlparse

DEFAULT_MODEL = "claude-opus-5-5"


def is_anthropic(base_url: str | None) -> bool:
    host = (urlparse(base_url or "").hostname or "").lower()
    return host == "api.anthropic.com" or host.endswith(".anthropic.com")


class AnthropicCallError(RuntimeError):
    """Transport or API failure. ``retryable`` is True for 429, 5xx and connection errors."""

    def __init__(self, message: str, *, retryable: bool, status: int | None = None):
        super().__init__(message)
        self.retryable = retryable
        self.status = status


def _split(messages: list[dict[str, Any]]) -> tuple[str, list[dict[str, Any]]]:
    system_parts: list[str] = []
    out: list[dict[str, Any]] = []
    for m in messages:
        role = m.get("role")
        content = m.get("content")
        text = content if isinstance(content, str) else "".join(
            p.get("text", "") for p in (content or []) if isinstance(p, dict))
        if role == "system":
            system_parts.append(text)
            continue
        role = "assistant" if role == "assistant" else "user"
        if out and out[-1]["role"] == role:  # the API wants alternating turns
            out[-1]["content"] += "\n\n" + text
        else:
            out.append({"role": role, "content": text})
    if not out or out[0]["role"] != "user":
        out.insert(0, {"role": "user", "content": "Begin."})
    return "\n\n".join(p for p in system_parts if p), out


def _api_root(base_url: str) -> str:
    """``https://api.anthropic.com/v1`` and ``https://api.anthropic.com`` both mean the API root."""
    u = base_url.rstrip("/")
    return u[:-3] if u.endswith("/v1") else u


async def chat(
    *,
    base_url: str,
    api_key: str,
    model: str | None,
    messages: list[dict[str, Any]],
    max_tokens: int,
    schema: dict[str, Any] | None = None,
    on_text: Optional[Callable[[str], Any]] = None,
    timeout_s: float = 300.0,
    client: Any = None,
) -> dict[str, Any]:
    """One Messages API call, returned in the OpenAI chat-completions body shape."""
    import anthropic  # noqa: PLC0415 - optional at import time; required only for Anthropic rows

    if not api_key:
        raise AnthropicCallError("the Anthropic provider row has no API key", retryable=False)
    own = client is None
    if own:
        client = anthropic.AsyncAnthropic(api_key=api_key, base_url=_api_root(base_url), timeout=timeout_s,
                                          max_retries=2)
    system, turns = _split(messages)
    params: dict[str, Any] = {"model": model or DEFAULT_MODEL, "max_tokens": max_tokens, "messages": turns}
    if system:
        params["system"] = system
    if schema is not None:
        params["output_config"] = {"format": {"type": "json_schema", "schema": schema}}
    try:
        try:
            msg = await _call(client, params, on_text)
        except anthropic.BadRequestError as exc:
            if schema is None:
                raise
            # The schema used a construct structured outputs does not accept: ask for JSON in text.
            params.pop("output_config", None)
            params["system"] = (system + "\n\n" if system else "") + "Answer with one JSON object only."
            del exc
            msg = await _call(client, params, on_text)
    except anthropic.RateLimitError as exc:
        raise AnthropicCallError(f"anthropic rate limited: {exc.message}", retryable=True, status=429) from exc
    except anthropic.APIStatusError as exc:
        raise AnthropicCallError(f"anthropic HTTP {exc.status_code}: {exc.message}"[:300],
                                 retryable=exc.status_code >= 500, status=exc.status_code) from exc
    except anthropic.APIConnectionError as exc:
        raise AnthropicCallError(f"anthropic unreachable: {exc}", retryable=True) from exc
    finally:
        if own:
            await client.close()
    text = "" if msg.stop_reason == "refusal" else "".join(
        b.text for b in msg.content if getattr(b, "type", "") == "text")
    return {
        "model": msg.model,
        "choices": [{"message": {"role": "assistant", "content": text}, "finish_reason": msg.stop_reason}],
        "usage": {"prompt_tokens": msg.usage.input_tokens, "completion_tokens": msg.usage.output_tokens},
    }


async def _call(client: Any, params: dict[str, Any], on_text: Optional[Callable[[str], Any]]) -> Any:
    # Always stream: long structured generations must not hit HTTP timeouts.
    acc = ""
    async with client.messages.stream(**params) as stream:
        async for delta in stream.text_stream:
            if on_text is None:
                continue
            acc += delta
            res = on_text(acc)
            if asyncio.iscoroutine(res):
                await res
        return await stream.get_final_message()
