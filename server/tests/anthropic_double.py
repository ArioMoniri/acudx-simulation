"""In-process double of the Anthropic Messages API for tests (no network, no key).

The replies follow the documented wire shapes of ``POST /v1/messages`` (JSON body, or the
SSE event sequence when ``stream`` is true) and of ``GET /v1/models``. They are scripted
test fixtures, not recordings of a live model, and they live only under ``server/tests``.

``AnthropicDouble.client()`` returns an ``anthropic.DefaultAsyncHttpxClient`` over an
``httpx2.MockTransport``, which is what :class:`AnthropicProvider` accepts as
``http_client``. Every request body is kept in ``calls`` so tests can assert on the model,
the cache breakpoints, the structured-output schema and the effort that were sent.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

import anthropic
import httpx2


@dataclass
class Scripted:
    text: str
    stop_reason: str = "end_turn"
    input_tokens: int = 120
    output_tokens: int = 40
    cache_read: int = 0
    cache_write: int = 0
    status: int = 200
    model: Optional[str] = None        # served model; default = requested model


@dataclass
class AnthropicDouble:
    """Scripted Messages API. ``responder(body) -> Scripted`` decides each reply."""

    responder: Optional[Callable[[dict[str, Any]], Scripted]] = None
    queue: list[Scripted] = field(default_factory=list)
    calls: list[dict[str, Any]] = field(default_factory=list)
    headers: list[dict[str, str]] = field(default_factory=list)
    models: list[str] = field(default_factory=lambda: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"])

    def push(self, *items: Scripted) -> "AnthropicDouble":
        self.queue.extend(items)
        return self

    def _next(self, body: dict[str, Any]) -> Scripted:
        if self.queue:
            return self.queue.pop(0)
        if self.responder is not None:
            return self.responder(body)
        return Scripted(text="{}")

    def handler(self, request: httpx2.Request) -> httpx2.Response:
        self.headers.append({k.lower(): v for k, v in request.headers.items()})
        if request.url.path.endswith("/v1/models"):
            return httpx2.Response(200, json={"data": [{"id": m, "type": "model", "display_name": m,
                                                         "created_at": "2026-10-01T00:00:00Z"} for m in self.models],
                                              "has_more": False, "first_id": self.models[0],
                                              "last_id": self.models[-1]})
        body = json.loads(request.content.decode("utf-8") or "{}")
        self.calls.append(body)
        s = self._next(body)
        model = s.model or body.get("model") or "claude-opus-5-5"
        if s.status != 200:
            err = {"type": "error", "error": {"type": "api_error" if s.status >= 500 else "invalid_request_error",
                                              "message": f"scripted HTTP {s.status}"}}
            return httpx2.Response(s.status, json=err)
        usage = {"input_tokens": s.input_tokens, "output_tokens": s.output_tokens,
                 "cache_read_input_tokens": s.cache_read, "cache_creation_input_tokens": s.cache_write}
        if body.get("stream"):
            return httpx2.Response(200, headers={"content-type": "text/event-stream"},
                                   content=_sse(model, s, usage).encode("utf-8"))
        return httpx2.Response(200, json={
            "id": f"msg_{len(self.calls):04d}", "type": "message", "role": "assistant", "model": model,
            "content": [{"type": "text", "text": s.text}], "stop_reason": s.stop_reason, "stop_sequence": None,
            "usage": usage,
        })

    def client(self) -> Any:
        return anthropic.DefaultAsyncHttpxClient(transport=httpx2.MockTransport(self.handler))


def _sse(model: str, s: Scripted, usage: dict[str, int]) -> str:
    def ev(name: str, data: dict[str, Any]) -> str:
        return f"event: {name}\ndata: {json.dumps(data)}\n\n"

    start_usage = {**usage, "output_tokens": 1}
    out = [ev("message_start", {"type": "message_start", "message": {
        "id": "msg_stream", "type": "message", "role": "assistant", "model": model, "content": [],
        "stop_reason": None, "stop_sequence": None, "usage": start_usage}})]
    out.append(ev("content_block_start", {"type": "content_block_start", "index": 0,
                                          "content_block": {"type": "text", "text": ""}}))
    step = max(1, len(s.text) // 4)
    for i in range(0, len(s.text), step):
        out.append(ev("content_block_delta", {"type": "content_block_delta", "index": 0,
                                              "delta": {"type": "text_delta", "text": s.text[i:i + step]}}))
    out.append(ev("content_block_stop", {"type": "content_block_stop", "index": 0}))
    out.append(ev("message_delta", {"type": "message_delta",
                                    "delta": {"stop_reason": s.stop_reason, "stop_sequence": None},
                                    "usage": {"output_tokens": s.output_tokens}}))
    out.append(ev("message_stop", {"type": "message_stop"}))
    return "".join(out)
