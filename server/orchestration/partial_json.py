"""Incremental JSON for token streaming (review 06a, section 4.4 item 6).

The S1 call streams tokens; the learner should see the banner, the complaint and the
triage vitals field by field instead of waiting for the closing brace. ``parse_partial``
parses the longest valid prefix of a JSON object and returns only COMPLETE scalars
(a string whose closing quote has arrived, a number followed by a delimiter, a literal);
``leaf_paths`` flattens that to ``{"demographics.age": 58, ...}``; :class:`DeltaTracker`
emits each completed leaf once, in arrival order.

Pure and dependency-free.
"""

from __future__ import annotations

import json
from typing import Any, Iterator

_WS = " \t\r\n"
_INCOMPLETE = object()


class _Parser:
    def __init__(self, text: str) -> None:
        self.s = text
        self.i = 0
        self.n = len(text)

    def ws(self) -> None:
        while self.i < self.n and self.s[self.i] in _WS:
            self.i += 1

    def value(self) -> Any:
        self.ws()
        if self.i >= self.n:
            return _INCOMPLETE
        c = self.s[self.i]
        if c == "{":
            return self.obj()
        if c == "[":
            return self.arr()
        if c == '"':
            return self.string()
        return self.scalar()

    def obj(self) -> Any:
        self.i += 1
        out: dict[str, Any] = {}
        while True:
            self.ws()
            if self.i >= self.n:
                return _Partial(out)
            if self.s[self.i] == "}":
                self.i += 1
                return out
            if self.s[self.i] == ",":
                self.i += 1
                continue
            key = self.string()
            if key is _INCOMPLETE or isinstance(key, _Partial):
                return _Partial(out)
            self.ws()
            if self.i >= self.n or self.s[self.i] != ":":
                return _Partial(out)
            self.i += 1
            val = self.value()
            if val is _INCOMPLETE:
                return _Partial(out)
            if isinstance(val, _Partial):
                out[key] = val.value
                return _Partial(out)
            out[key] = val

    def arr(self) -> Any:
        self.i += 1
        out: list[Any] = []
        while True:
            self.ws()
            if self.i >= self.n:
                return _Partial(out)
            if self.s[self.i] == "]":
                self.i += 1
                return out
            if self.s[self.i] == ",":
                self.i += 1
                continue
            val = self.value()
            if val is _INCOMPLETE:
                return _Partial(out)
            if isinstance(val, _Partial):
                out.append(val.value)
                return _Partial(out)
            out.append(val)

    def string(self) -> Any:
        if self.i >= self.n or self.s[self.i] != '"':
            return _INCOMPLETE
        j = self.i + 1
        while j < self.n:
            ch = self.s[j]
            if ch == "\\":
                j += 2
                continue
            if ch == '"':
                raw = self.s[self.i:j + 1]
                self.i = j + 1
                try:
                    return json.loads(raw)
                except json.JSONDecodeError:
                    return _INCOMPLETE
            j += 1
        return _INCOMPLETE

    def scalar(self) -> Any:
        j = self.i
        while j < self.n and self.s[j] not in ",]}" + _WS:
            j += 1
        if j >= self.n:
            return _INCOMPLETE          # a number may still be growing ("5" of "58")
        tok = self.s[self.i:j]
        self.i = j
        try:
            return json.loads(tok)
        except json.JSONDecodeError:
            return _INCOMPLETE


class _Partial:
    __slots__ = ("value",)

    def __init__(self, value: Any) -> None:
        self.value = value


def parse_partial(text: str) -> dict[str, Any]:
    """The complete part of a (possibly truncated) JSON object; ``{}`` when nothing parses yet."""
    s = text or ""
    start = s.find("{")
    if start < 0:
        return {}
    val = _Parser(s[start:]).value()
    if isinstance(val, _Partial):
        val = val.value
    return val if isinstance(val, dict) else {}


def leaf_paths(obj: Any, prefix: str = "") -> Iterator[tuple[str, Any]]:
    """Scalar leaves as dotted paths (list items by index), depth first, in key order."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield from leaf_paths(v, f"{prefix}.{k}" if prefix else str(k))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from leaf_paths(v, f"{prefix}.{i}" if prefix else str(i))
    else:
        yield prefix, obj


class DeltaTracker:
    """Feed the accumulated text; get the newly completed leaves under ``root``."""

    def __init__(self, root: str | None = None) -> None:
        self.root = root
        self.seen: dict[str, Any] = {}

    def feed(self, text: str) -> list[tuple[str, Any]]:
        obj = parse_partial(text)
        if self.root is not None:
            obj = obj.get(self.root) if isinstance(obj.get(self.root), dict) else {}
        out: list[tuple[str, Any]] = []
        for path, value in leaf_paths(obj):
            if path in self.seen and self.seen[path] == value:
                continue
            self.seen[path] = value
            out.append((path, value))
        return out


__all__ = ["DeltaTracker", "leaf_paths", "parse_partial"]
