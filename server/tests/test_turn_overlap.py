"""A new reply released while the previous one still speaks (docs/architecture/18 6.3.10).

Live 2026-10-21 (A100 40 GB, Turkish): the worker's Chatterbox ran slower than real time during a call,
so the next question's reply queued behind the previous one, its speech start read under 100 ms (the
voice had never stopped) and its lip offset (+280 ms) moved the runner's delay the wrong way. Now the
new reply cuts the old one at a frame boundary (old TTS stopped, the runner's queued audio flushed),
starts at once, and the lip-sync loop skips the measurement that spans the cut."""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Any

import pytest

from server.voice.avatar import musetalk as mt
from server.voice.avatar.sessions import CallSession
from server.voice.avatar.turn_speech import CallSpeaker, TurnTimings


class SlowTts:
    """Raw 24 kHz PCM, one 20 ms chunk every ``gap_s`` (a TTS slower than real time when gap > 0.02)."""

    def __init__(self, chunks: int, gap_s: float):
        self.chunks, self.gap_s = chunks, gap_s
        self.settings = SimpleNamespace(avatar_fast_en_tts=False)
        self.started: list[str] = []
        self.stopped: list[str] = []

    async def tts(self, text: str, **_kw: Any) -> Any:
        self.started.append(text)

        async def gen():
            try:
                for _ in range(self.chunks):
                    await asyncio.sleep(self.gap_s)
                    yield b"\x01\x00" * 480
            finally:
                self.stopped.append(text)

        return SimpleNamespace(stream=SimpleNamespace(content_type="audio/pcm", sample_rate=24000, chunks=gen(),
                                                      model="m"), endpoint=SimpleNamespace(name="tts-double"))


@dataclass
class FakeLink:
    lines: list[dict] = field(default_factory=list)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    async def utterance(self, pcm, rate, *, interrupt=False, on_first_chunk=None):
        async with self.lock:
            line = {"interrupt": interrupt, "bytes": 0, "done": False}
            self.lines.append(line)
            async for c in pcm:
                if line["bytes"] == 0 and on_first_chunk:
                    on_first_chunk()
                line["bytes"] += len(c)
            line["done"] = True
            return {"frames": line["bytes"] // 640}


class Persona:
    def __init__(self, text: str):
        self.text, self.done, self.updated = text, True, asyncio.Event()
        self.updated.set()


def _call() -> CallSession:
    s = CallSession(id="c1", provider="musetalk", user_hash="u", encounter_id="e", lang="tr")
    s.worker_session = "lt-1"
    s.audio_link = FakeLink()
    return s


def _speaker(svc, call, text):
    return CallSpeaker(svc=svc, session=call, worker=SimpleNamespace(origin="https://w"), lang="tr", sex="female",
                       age=40, speed=1.0, gate=lambda t: t, timings=TurnTimings()).start(Persona(text))


async def _until(cond, timeout=5.0):
    for _ in range(int(timeout / 0.01)):
        if cond():
            return True
        await asyncio.sleep(0.01)
    return False


async def test_a_reply_released_while_the_previous_speaks_cuts_it_and_flushes_the_runner():
    svc = SlowTts(chunks=200, gap_s=0.03)      # 4 s of audio at 0.67 x real time
    call = _call()
    a = _speaker(svc, call, "Birinci cevap, uzun bir cevap.")
    a.release()
    assert await _until(lambda: call.audio_link.lines and call.audio_link.lines[0]["bytes"] > 0)
    b = _speaker(svc, call, "İkinci cevap.")
    b.release()
    await asyncio.wait_for(b.task, 10)
    await asyncio.wait_for(a.task, 1)
    lines = call.audio_link.lines
    assert len(lines) == 2
    assert lines[0]["interrupt"] is False and lines[1]["interrupt"] is True
    assert a.cut and not a.cut_previous and b.cut_previous and not b.cut
    assert svc.started[0] in svc.stopped and "cevap." not in svc.started   # old TTS closed, its rest never asked
    assert lines[0]["bytes"] < 200 * 960                               # the old reply did not play out
    assert lines[1]["done"] and lines[1]["bytes"] == 200 * 960
    turns = call.metrics["voiced_turns"]
    assert [t["cut"] for t in turns] == [True, False] and turns[1]["cut_previous"] is True
    assert call.metrics.get("lip_overlap") is True and call.active_speaker is None


async def test_a_reply_after_the_previous_finished_is_queued_not_cut():
    svc = SlowTts(chunks=5, gap_s=0.0)
    call = _call()
    a = _speaker(svc, call, "Bir.")
    a.release()
    await asyncio.wait_for(a.task, 5)
    b = _speaker(svc, call, "İki.")
    b.release()
    await asyncio.wait_for(b.task, 5)
    assert [ln["interrupt"] for ln in call.audio_link.lines] == [False, False]
    assert not a.cut and not b.cut_previous and "lip_overlap" not in call.metrics


async def test_an_unreleased_speculative_reply_is_never_cut_into():
    svc = SlowTts(chunks=50, gap_s=0.01)
    call = _call()
    spec = _speaker(svc, call, "Spekülatif.")      # never released (the guard has not labelled it)
    real = _speaker(svc, call, "Gerçek cevap.")
    real.release()
    await asyncio.wait_for(real.task, 5)
    spec.cancel()
    assert not real.cut_previous and [ln["interrupt"] for ln in call.audio_link.lines] == [False]


class Socket:
    def __init__(self, hold_done: asyncio.Event):
        self.sent: list = []
        self.close_code = None
        self.hold = hold_done

    async def send(self, m):
        self.sent.append(m)

    async def recv(self):
        await self.hold.wait()
        return json.dumps({"type": "done", "frames": 1})

    async def close(self):
        self.close_code = 1000


async def test_a_line_cancelled_after_its_end_drops_the_socket(monkeypatch):
    hold = asyncio.Event()
    socks: list[Socket] = []

    async def connect(url, headers, timeout_s):
        socks.append(Socket(hold))
        return socks[-1]

    monkeypatch.setattr(mt, "ws_connect", connect)
    link = mt.RunnerAudioLink(worker=mt.WorkerAvatar(origin="https://w", token="t"), worker_session="s")

    async def pcm():
        yield b"\x00\x00" * 160

    t = asyncio.get_running_loop().create_task(link.utterance(pcm(), 24000))
    assert await _until(lambda: socks and any(isinstance(m, str) and '"end"' in m for m in socks[0].sent))
    t.cancel()
    with pytest.raises(asyncio.CancelledError):
        await t
    assert socks[0].close_code == 1000 and link._ws is None   # the stale "done" is never read by the next line
    hold.set()

    async def pcm2():
        yield b"\x00\x00" * 160

    out = await asyncio.wait_for(link.utterance(pcm2(), 24000, interrupt=True), 2)
    assert out["frames"] == 1 and len(socks) == 2
    begin = json.loads(next(m for m in socks[1].sent if isinstance(m, str)))
    assert begin["type"] == "begin" and begin["interrupt"] is True
