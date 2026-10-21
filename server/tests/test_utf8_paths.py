"""Turkish text survives every byte -> text step between the worker, the gateway and the browser.

Live 2026-10-21 (production, TR): the patient status line once showed "korkmuş … kafası karışık" as
UTF-8 read as Windows-1251. Every place that turns bytes into text now names UTF-8, and every
text-like reply the gateway sends names its charset, so no client, proxy or tool falls back to a
locale default.
"""

from __future__ import annotations

import json

import httpx
import pytest
from fastapi import FastAPI
from fastapi.responses import JSONResponse, PlainTextResponse, Response, StreamingResponse
from fastapi.testclient import TestClient

from server import app as app_module
from server.app import utf8_content_type
from server.voice.avatar import musetalk as mt
from server.voice.avatar.routes import _sse

TR = "korkmuş, kafası karışık; ağrı İğne Çok ÖÜ ı ş ğ ü ö ç İ"


@pytest.mark.parametrize("ctype,want", [
    ("application/json", "application/json; charset=utf-8"),
    ("text/event-stream", "text/event-stream; charset=utf-8"),
    ("text/plain; charset=utf-8", "text/plain; charset=utf-8"),
    ("text/html; charset=ISO-8859-9", "text/html; charset=ISO-8859-9"),   # a declared charset is kept
    ("audio/wav", "audio/wav"),
    ("image/jpeg", "image/jpeg"),
    (None, None),
])
def test_text_replies_name_their_charset(ctype, want):
    assert utf8_content_type(ctype) == want


def test_the_gateway_sends_turkish_json_with_an_explicit_utf8_charset():
    app = FastAPI()
    app.middleware("http")(app_module._telemetry_context)

    @app.get("/j")
    async def j():
        return JSONResponse({"mood_tr": TR})

    @app.get("/t")
    async def t():
        return PlainTextResponse(TR)

    @app.get("/s")
    async def s():
        return StreamingResponse(iter([f"data: {json.dumps({'m': TR}, ensure_ascii=False)}\n\n"]),
                                 media_type="text/event-stream")

    @app.get("/b")
    async def b():
        return Response(content=b"\xff\xd8", media_type="image/jpeg")

    c = TestClient(app)
    r = c.get("/j")
    assert r.headers["content-type"] == "application/json; charset=utf-8"
    assert r.content.decode("utf-8") == json.dumps({"mood_tr": TR}, ensure_ascii=False, separators=(",", ":"))
    assert r.json()["mood_tr"] == TR
    assert c.get("/t").headers["content-type"] == "text/plain; charset=utf-8" and c.get("/t").text == TR
    sse = c.get("/s")
    assert sse.headers["content-type"] == "text/event-stream; charset=utf-8" and TR in sse.content.decode("utf-8")
    assert c.get("/b").headers["content-type"] == "image/jpeg"


def test_a_charset_guess_would_have_produced_the_live_mojibake():
    """What the screenshot showed is exactly UTF-8 decoded as Windows-1251; the explicit charset rules it out."""
    garbled = "korkmuş".encode("utf-8").decode("cp1251")
    assert garbled == "korkmuЕџ"
    r = httpx.Response(200, content=TR.encode("utf-8"), headers={"content-type": utf8_content_type("text/plain")})
    assert r.text == TR


async def test_a_worker_reply_that_is_not_json_is_decoded_as_utf8():
    r = httpx.Response(502, content=f"<h1>{TR}</h1>".encode("utf-8"), headers={"content-type": "text/html"})
    body = await mt._json(r)
    assert TR in body["raw"]


def test_the_tavus_sse_and_runner_messages_are_utf8_bytes():
    raw = _sse({"choices": [{"delta": {"content": TR}}]})
    assert isinstance(raw, bytes) and TR in raw.decode("utf-8")
