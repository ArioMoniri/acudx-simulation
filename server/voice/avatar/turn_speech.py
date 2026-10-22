"""Speak the patient's reply into the live call while the persona model is still writing it.

Live 2026-10-21 (production, A100 worker, Claude persona): the student's typed question reached the
patient's voice after the whole chain ran one hop after another: the guard model, the persona model
to its last token, the response to the browser, the browser's ``/speak`` request, the TTS to its first
chunk, the runner, WebRTC. This module removes the serial hops (docs/architecture/18 section 6.3.9):

* the persona reply streams (``ModelGateway.chat(on_text=...)``) and is cut into clauses as it
  arrives (:class:`ClauseStream`); the first clause is spoken on its own, every later request takes
  all the sentences that are complete by then, so the TTS starts on the first clause and the voice
  never waits for the end of the reply;
* each clause passes the same gates as the typed reply (FactAssertionGate, the diagnosis scrub)
  before it is spoken, and nothing is spoken before the guard has labelled the message;
* the gateway speaks into the call's runner socket itself (one utterance, so lips stay on one
  timeline), and tells the browser so it does not speak the line a second time;
* every hop is timed (:class:`TurnTimings`) and kept on the call's metrics;
* a reply released while the previous one is still being synthesised cuts it (the old TTS stops and
  the runner's queued audio is flushed at a frame boundary), so the new reply starts at once on a
  fresh timeline instead of queueing behind a Turkish reply that runs slower than real time, and the
  lip-sync loop ignores the lines around the cut (docs/architecture/18 6.3.10).
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Callable

from server.voice.avatar import musetalk as mt

log = logging.getLogger("acudx.voice.avatar.turn")

FIRST_MIN_WORDS = 3
# Live 2026-10-21 (A100 40 GB, the image edits running): Chatterbox took 1.9 s to the first chunk of a
# 21-character clause and 3.0 to 3.7 s for 35 to 38 characters, so the opening clause is kept short.
FIRST_MAX_WORDS = 6
FIRST_MAX_CHARS = 28
# Audio forwarded to the runner at most this far ahead of real time.
PACE_LEAD_S = 1.0
_FIRST_BREAK = re.compile(r"[,;:.!?…](?=\s|$)")
_SENTENCE_END = re.compile(r"[.!?…]+[\"')\]]*(?=\s|$)")


def _words(text: str) -> int:
    return len(text.split())


class ClauseStream:
    """Cut a growing reply into speakable pieces.

    ``feed(accumulated_text)`` returns the pieces completed since the last call: first the opening
    clause (up to the first ``, ; : . ! ?`` after at least three words, else the first ten words once
    more text follows), then whole sentences. ``finish()`` returns what is left."""

    def __init__(self, *, first_min_words: int = FIRST_MIN_WORDS, first_max_words: int = FIRST_MAX_WORDS):
        self.first_min = first_min_words
        self.first_max = first_max_words
        self.pos = 0          # characters of the accumulated text already handed out
        self.first_done = False

    def _first(self, rest: str) -> int | None:
        end = None
        for m in _FIRST_BREAK.finditer(rest):
            if _words(rest[:m.end()]) >= self.first_min:
                end = m.end()
                break
        words = list(re.finditer(r"\S+", rest))
        if end is None and len(words) > self.first_max:   # a word after the sixth: the sixth is complete
            end = words[self.first_max - 1].end()
        if end is None:
            return None
        # Turkish words are long: cap the opening clause by characters too, at a word boundary.
        if end > FIRST_MAX_CHARS:
            fit = [w.end() for w in words if w.end() <= FIRST_MAX_CHARS]
            if len(fit) >= self.first_min:
                end = fit[-1]
        return end

    def feed(self, text: str) -> list[str]:
        out: list[str] = []
        while True:
            rest = text[self.pos:]
            if not rest.strip():
                return out
            if not self.first_done:
                end = self._first(rest)
                if end is None:
                    return out
                self.first_done = True
            else:
                m = _SENTENCE_END.search(rest)
                if m is None:
                    return out
                end = m.end()
            piece = rest[:end].strip()
            self.pos += end
            if piece:
                out.append(piece)

    def finish(self, text: str) -> list[str]:
        out = self.feed(text)
        rest = text[self.pos:].strip()
        self.pos = len(text)
        if rest:
            out.append(rest)
        return out


@dataclass
class TurnTimings:
    """Milliseconds from the moment the gateway received the student's message."""

    t0: float = field(default_factory=time.monotonic)
    marks: dict[str, float] = field(default_factory=dict)

    def mark(self, name: str) -> None:
        if name not in self.marks:
            self.marks[name] = round((time.monotonic() - self.t0) * 1000.0, 1)

    def public(self) -> dict[str, float]:
        return dict(self.marks)


class PersonaStream:
    """One persona call streaming into an accumulated text; ``updated`` fires on every delta."""

    def __init__(self, gateway: Any, messages: list[dict[str, str]], *, max_tokens: int,
                 timings: TurnTimings | None = None, speculative: bool = False, task: str = "patient_live"):
        self.messages = messages
        self.text = ""
        self.done = False
        self.speculative = speculative
        self.updated = asyncio.Event()
        self.timings = timings
        self.model_task = task
        self.task: asyncio.Task[Any] = asyncio.get_running_loop().create_task(self._run(gateway, max_tokens))

    async def _run(self, gateway: Any, max_tokens: int) -> Any:
        def on_text(acc: str) -> None:
            if self.timings is not None and acc.strip():
                self.timings.mark("persona_first_text_ms")
            self.text = acc
            self.updated.set()

        try:
            res = await gateway.chat(self.messages, task=self.model_task, max_tokens=max_tokens, on_text=on_text)
            self.text = res.text or self.text
            return res
        finally:
            self.done = True
            self.updated.set()

    async def result(self) -> Any:
        return await self.task

    def cancel(self) -> None:
        self.task.cancel()


# Voiced turns in progress per worker origin: the image edits for the patient's pictures wait while the
# voice speaks on the same GPU (state_sync._gen), so the TTS is not starved by a 10 s edit.
SPEAKING: dict[str, int] = {}


async def wait_until_quiet(origin: str, *, max_s: float = 60.0, poll_s: float = 0.2) -> float:
    """Wait (at most ``max_s``) until no voiced turn speaks on ``origin``; returns the seconds waited."""
    t = time.monotonic()
    while SPEAKING.get(origin, 0) > 0 and time.monotonic() - t < max_s:
        await asyncio.sleep(poll_s)
    return time.monotonic() - t


@dataclass
class CallSpeaker:
    """Speaks a streaming reply into one live call: clauses -> gates -> TTS -> the runner socket.

    ``gate(piece)`` returns the text to speak (the same gates the typed reply passes). Nothing is
    spoken until :meth:`release` (the guard has labelled the message)."""

    svc: Any
    session: Any
    worker: mt.WorkerAvatar
    lang: str
    sex: str | None
    age: float | None
    speed: float
    gate: Callable[[str], str]
    timings: TurnTimings
    released: asyncio.Event = field(default_factory=asyncio.Event)
    spoken: list[str] = field(default_factory=list)
    requests: list[dict[str, Any]] = field(default_factory=list)
    error: str | None = None
    runner: dict[str, Any] | None = None
    task: asyncio.Task[Any] | None = None
    cut: bool = False                 # this reply was cut by the next one
    cut_previous: bool = False        # this reply cut the one before it

    def start(self, persona: PersonaStream) -> "CallSpeaker":
        self.task = asyncio.get_running_loop().create_task(self._run(persona))
        return self

    def release(self) -> None:
        self.released.set()

    def cancel(self) -> None:
        if self.task is not None:
            self.task.cancel()

    def speaking(self) -> bool:
        return self.task is not None and not self.task.done() and self.released.is_set()

    def cut_by_next(self) -> None:
        """The next reply was released while this one still speaks: stop it (TTS and runner audio)."""
        self.cut = True
        self.cancel()

    def _take_call(self) -> bool:
        """Become the call's speaker; True when a reply still speaking was cut for this one."""
        prev = getattr(self.session, "active_speaker", None)
        cut = prev is not None and prev is not self and prev.speaking()
        if cut:
            prev.cut_by_next()
            self.cut_previous = True
            self.session.metrics["lip_overlap"] = True   # the lip-sync loop skips the lines around a cut
        self.session.active_speaker = self
        return cut

    async def _pieces(self, persona: PersonaStream) -> AsyncIterator[str]:
        """Pieces as the reply grows: the first clause alone, then everything complete when asked."""
        cs = ClauseStream()
        ready: list[str] = []
        while True:
            persona.updated.clear()
            text = persona.text
            ready += cs.finish(text) if persona.done else cs.feed(text)
            if ready:
                for piece in ready:
                    yield piece
                ready = []
                continue
            if persona.done:
                return
            await persona.updated.wait()

    async def _batches(self, persona: PersonaStream) -> AsyncIterator[str]:
        """The first clause on its own; then each request takes all pieces completed meanwhile."""
        q: asyncio.Queue[str | None] = asyncio.Queue()

        async def pump() -> None:
            try:
                async for p in self._pieces(persona):
                    q.put_nowait(p)
            finally:
                q.put_nowait(None)

        pumper = asyncio.get_running_loop().create_task(pump())
        try:
            first = True
            while True:
                item = await q.get()
                if item is None:
                    return
                parts = [item]
                if not first:
                    while not q.empty():
                        nxt = q.get_nowait()
                        if nxt is None:
                            q.put_nowait(None)
                            break
                        parts.append(nxt)
                first = False
                text = self.gate(" ".join(parts)).strip()
                if text:
                    yield text
        finally:
            pumper.cancel()

    async def _pcm(self, persona: PersonaStream, rate_box: dict[str, int]) -> AsyncIterator[bytes]:
        """PCM of every TTS request in order (one runner utterance: lips stay on one timeline)."""
        async for text in self._batches(persona):
            self.timings.mark("first_clause_ms")
            t = time.monotonic()
            out = await self.svc.tts(text, lang=self.lang, sex=self.sex, age=self.age, output_format="wav",
                                     stream=True, speed=self.speed,
                                     prefer_fast=bool(getattr(self.svc.settings, "avatar_fast_en_tts", False)))
            parser = mt.PcmStream(out.stream.content_type, sample_rate=out.stream.sample_rate)
            req: dict[str, Any] = {"chars": len(text), "provider": out.endpoint.name, "model": out.stream.model}
            self.requests.append(req)
            odd = b""
            async for chunk in out.stream.chunks:
                pcm = parser.feed(chunk)
                if not parser.ready:
                    continue
                if "rate" not in rate_box:
                    rate_box["rate"] = int(parser.sample_rate or 24000)
                if int(parser.sample_rate or 0) != rate_box["rate"] or not parser.supported:
                    req["skipped"] = "sample rate or format differs from the line's first request"
                    break
                data = odd + pcm
                odd = data[len(data) // 2 * 2:]
                data = data[:len(data) // 2 * 2]
                if data:
                    if "first_chunk_ms" not in req:
                        req["first_chunk_ms"] = round((time.monotonic() - t) * 1000.0, 1)
                        self.timings.mark("tts_first_chunk_ms")
                    req["bytes"] = req.get("bytes", 0) + len(data)
                    yield data
            self.spoken.append(text)

    async def _run(self, persona: PersonaStream) -> None:
        origin = getattr(self.worker, "origin", "")
        SPEAKING[origin] = SPEAKING.get(origin, 0) + 1
        try:
            await self._run_line(persona)
        finally:
            SPEAKING[origin] = max(0, SPEAKING.get(origin, 1) - 1)

    async def _run_line(self, persona: PersonaStream) -> None:
        # The TTS may start on the speculative reply before the guard has labelled the message (synthesis
        # is not exposure); the runner, i.e. the learner's ears, gets audio only after release().
        rate_box: dict[str, int] = {}
        gen = self._pcm(persona, rate_box)
        first: bytes | None = None
        try:
            async for chunk in gen:      # the first PCM chunk tells the sample rate for "begin"
                first = chunk
                break
            await self.released.wait()
            self.timings.mark("released_ms")
            interrupt = self._take_call()
            if first is None:
                return

            rate = int(rate_box["rate"])

            async def rest() -> AsyncIterator[bytes]:
                # Real-time pacing with a short lead: a fast TTS (Kokoro wrote 14 s of audio in 0.6 s live)
                # must not pile the whole reply into the runner at once (lips lost the voice live).
                t0 = time.monotonic()
                sent = 0
                for c in (first,):
                    sent += len(c)  # type: ignore[arg-type]
                    yield c  # type: ignore[misc]
                async for c in gen:
                    ahead = sent / 2 / rate - (time.monotonic() - t0)
                    if ahead > PACE_LEAD_S:
                        await asyncio.sleep(ahead - PACE_LEAD_S)
                    sent += len(c)
                    yield c

            link = self.session.audio_link or mt.RunnerAudioLink(worker=self.worker,
                                                                 worker_session=str(self.session.worker_session))
            self.session.audio_link = link
            self.runner = await link.utterance(rest(), rate, interrupt=interrupt,
                                               on_first_chunk=lambda: self.timings.mark("runner_first_chunk_ms"))
            self.timings.mark("runner_done_ms")
        except asyncio.CancelledError:
            if not self.cut:
                raise
        except Exception as exc:  # noqa: BLE001 - reported on the call's metrics; the text reply stands
            self.error = f"{type(exc).__name__}: {getattr(exc, 'detail', None) or exc}"[:200]
            log.warning("voiced turn for call %s failed: %s", str(getattr(self.session, "id", ""))[:8], self.error)
        finally:
            await gen.aclose()
            if getattr(self.session, "active_speaker", None) is self:
                self.session.active_speaker = None
            self.session.metrics["turns"] = int(self.session.metrics.get("turns", 0)) + 1
            turns = self.session.metrics.setdefault("voiced_turns", [])
            turns.append(self.public())
            del turns[:-20]

    def public(self) -> dict[str, Any]:
        return {"timings": self.timings.public(), "requests": self.requests, "spoken_text": " ".join(self.spoken),
                "error": self.error, "cut": self.cut, "cut_previous": self.cut_previous, "runner": {k: (self.runner or {}).get(k) for k in ("frames", "first_frame_ms",
                                                                                       "elapsed_ms")}}
