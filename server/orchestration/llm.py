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
"""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass, field
from typing import Any, Literal

import httpx
from langchain_core.utils.json import parse_json_markdown

from server.config import EgressBlocked, LlmEndpoint, Settings
from server.model_gateway import strip_think

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
    ) -> None:
        self.settings = settings
        self.endpoints: dict[str, LlmEndpoint] = {
            "casegen": settings.resolve_casegen(),
            "judge": settings.resolve_judge(),
        }
        self._transport = transport
        self._timeout = httpx.Timeout(
            timeout_s or settings.request_timeout_s, connect=settings.connect_timeout_s,
        )
        self._retries = max(0, retries)
        self._client: httpx.AsyncClient | None = None

    def endpoint(self, role: Role) -> LlmEndpoint:
        return self.endpoints[role]

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
    ) -> LLMReply:
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
            "stream": False,
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": schema_name, "schema": schema, "strict": False},
            },
        }
        headers = {"Content-Type": "application/json"}
        if ep.api_key:
            headers["Authorization"] = f"Bearer {ep.api_key}"

        client = await self._get_client()
        url = f"{ep.base_url}/chat/completions"
        t0 = time.monotonic()
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
            except httpx.TransportError as exc:
                last = exc
            except ValueError as exc:  # body not JSON
                raise ModelOutputInvalid(f"{url} returned a non-JSON body") from exc
            if attempt < self._retries:
                await asyncio.sleep(min(0.2 * (2 ** attempt), 1.0))
        if data is None:
            raise ModelUnreachable(f"{url} unreachable: {last}")
        latency_ms = round((time.monotonic() - t0) * 1000.0, 1)

        choices = data.get("choices") or [{}]
        msg = (choices[0] or {}).get("message") or {}
        content = msg.get("content") or msg.get("reasoning_content") or ""
        if isinstance(content, list):  # some servers return content parts
            content = "".join(p.get("text", "") for p in content if isinstance(p, dict))
        obj = _parse_object(content)
        usage = data.get("usage") or {}
        return LLMReply(
            data=obj,
            model=str(data.get("model") or ep.model),
            model_requested=ep.model,
            provider=ep.provider,
            tokens_in=int(usage.get("prompt_tokens") or 0),
            tokens_out=int(usage.get("completion_tokens") or 0),
            latency_ms=latency_ms,
            raw=content,
            extras={"finish_reason": (choices[0] or {}).get("finish_reason")},
        )

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
    "LLMReply", "ModelOutputInvalid", "ModelUnreachable", "Role", "StructuredLLM", "schema_of",
]
