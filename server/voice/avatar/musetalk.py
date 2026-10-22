"""Self-hosted live patient video: the GPU worker's LiveTalking + MuseTalk 1.5 runner.

The worker (``infra/gpu-worker/cloud-init.yaml``) runs the runner as the ``avatar``
container behind Caddy at ``/avatar/*`` (bearer required) plus a coturn TURN server on
3478 (UDP and TCP). The gateway is the runner's only control client:

* ``PUT  /avatar/avatars/{id}``  the case portrait (``web/public/patients/<photo>.jpg``) becomes
                                the reference face: MuseTalk latents, face box, blend mask;
* ``POST /avatar/offer``         the browser's SDP offer (proxied, never the bearer) -> answer;
* ``GET  /avatar/stream``        WebSocket: the patient's TTS audio (Chatterbox or ElevenLabs,
                                synthesized by :class:`~server.voice.service.VoiceService`) as raw
                                16-bit PCM chunks while it is generated; the runner lip-syncs from
                                the first 20 ms and streams voice and face on the same WebRTC
                                connection (:class:`RunnerAudioLink`);
* ``POST /avatar/humanaudio``    the whole-file fallback (MP3, or a runner without ``/stream``);
* ``POST /avatar/close``         end the runner session;
* ``GET  /avatar/health``        model, sessions, VRAM, measured inference fps.

Media never passes through the gateway: the browser reaches the worker's TURN server
(UDP and TCP on 3478, and TLS on 443 at ``turn.<domain>`` for networks that only allow HTTPS;
the worker's nginx SNI router hands that name to coturn and everything else to Caddy)
with short-lived TURN REST credentials (``username = "<expiry>:<session>"``,
``credential = base64(HMAC-SHA1(secret, username))``, the coturn ``use-auth-secret``
scheme), where the secret is derived from the worker token the same way the boot
diagnostics secret is: HMAC-SHA256(key=token, "acudx-turn-v1"), hex, 32 characters.
The worker computes the identical value at boot with openssl.

When the runner did not start, the worker publishes why at ``/avatar-status/status.json``
(``state`` building | waiting | starting | ready | disabled, ``reason`` e.g.
``insufficient_vram`` with ``total_mb``, ``free_mb``, ``required_mb``), so capabilities can
say "disabled on this 40 GB card" instead of a bare 502.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import re
import time
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, AsyncIterator, Callable
from urllib.parse import urlparse

import httpx

log = logging.getLogger("acudx.voice.avatar")

TURN_SECRET_LABEL = b"acudx-turn-v1"
TURN_PORT = 3478
TURN_TLS_PORT = 443
TURN_TLS_HOST_PREFIX = "turn."
TURN_TTL_S = 2 * 60 * 60
HEALTH_PATH = "/avatar/health"
STATUS_PATH = "/avatar-status/status.json"
PHOTO_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,31}$")
DEFAULT_PORTRAIT_DIR = Path(__file__).resolve().parents[3] / "web" / "public" / "patients"
RENDERER = "musetalk"
MODEL = "musetalk-1.5"


class AvatarWorkerError(RuntimeError):
    def __init__(self, status: int, detail: str):
        super().__init__(f"avatar runner {status}: {detail}")
        self.status = status
        self.detail = detail


@dataclass(frozen=True)
class WorkerAvatar:
    """The ready worker's avatar side: origin (https://<ip>.sslip.io), bearer, domain."""
    origin: str
    token: str

    @property
    def domain(self) -> str:
        return self.origin.split("://", 1)[-1].split("/", 1)[0]

    def headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"}


def worker_from_endpoint(ep: dict[str, str] | None) -> WorkerAvatar | None:
    """``GpuWorkerManager.llm_endpoint()`` -> the same worker's avatar side (None when not ready)."""
    if not ep or not ep.get("base_url"):
        return None
    origin = ep["base_url"].rstrip("/")
    if origin.endswith("/v1"):
        origin = origin[:-3]
    return WorkerAvatar(origin=origin, token=str(ep.get("api_key") or ""))


def turn_secret(worker_token: str) -> str:
    """HMAC-SHA256(key=worker token, "acudx-turn-v1"), hex, first 32 characters.

    Shell equivalent on the worker:
    ``printf '%s' acudx-turn-v1 | openssl dgst -sha256 -hmac "$WORKER_TOKEN" -r | cut -c1-32``.
    """
    return hmac.new(worker_token.encode("utf-8"), TURN_SECRET_LABEL, hashlib.sha256).hexdigest()[:32]


def turn_credentials(secret: str, session_id: str, *, ttl_s: int = TURN_TTL_S,
                     now: float | None = None) -> tuple[str, str]:
    """TURN REST API credentials (draft-uberti-behave-turn-rest, coturn ``use-auth-secret``)."""
    expiry = int(now if now is not None else time.time()) + int(ttl_s)
    username = f"{expiry}:{session_id}"
    digest = hmac.new(secret.encode("utf-8"), username.encode("utf-8"), hashlib.sha1).digest()
    return username, base64.b64encode(digest).decode("ascii")


def ice_servers(worker: WorkerAvatar, session_id: str, *, override_urls: list[str] | None = None,
                now: float | None = None) -> list[dict[str, Any]]:
    """RTCIceServer list for the browser: the worker's TURN over UDP, TCP and TLS on 443.

    The browser gathers relay candidates from every URL at once and ICE keeps a pair that
    works, so a learner behind an HTTPS-only proxy or a UDP-blocking firewall falls back to
    ``turns:turn.<domain>:443`` without any client logic. ``override_urls``
    (``AVATAR_TURN_URLS``) replaces the URLs, for deployments that front the TURN port
    elsewhere (or a local tunnel in a test harness); the credentials stay the worker's.
    """
    username, credential = turn_credentials(turn_secret(worker.token), session_id, now=now)
    urls = list(override_urls) if override_urls else [
        f"turn:{worker.domain}:{TURN_PORT}?transport=udp",
        f"turn:{worker.domain}:{TURN_PORT}?transport=tcp",
        f"turns:{TURN_TLS_HOST_PREFIX}{worker.domain}:{TURN_TLS_PORT}?transport=tcp",
    ]
    return [{"urls": urls, "username": username, "credential": credential}]


def avatar_id_for(photo_id: str) -> str:
    return f"acudx-{photo_id}"


def portrait_path(photo_id: str, portrait_dir: Path | None = None) -> Path | None:
    """The case portrait on disk, or None for an unknown or malformed id (no path traversal)."""
    if not PHOTO_ID_RE.match(photo_id or ""):
        return None
    root = portrait_dir or DEFAULT_PORTRAIT_DIR
    for ext in (".jpg", ".jpeg", ".png"):
        p = root / f"{photo_id}{ext}"
        if p.is_file():
            return p
    return None


async def _json(r: httpx.Response) -> dict[str, Any]:
    try:
        body = r.json()
    except ValueError:
        # Worker replies are UTF-8 (aiohttp, Caddy); never let a charset guess decode them.
        body = {"raw": r.content[:600].decode("utf-8", "replace")[:300]}
    return body if isinstance(body, dict) else {"data": body}


async def health(client: httpx.AsyncClient, worker: WorkerAvatar, *, timeout_s: float = 4.0) -> dict[str, Any]:
    """``{"ok": bool, "state": ..., ...}``: the runner's /health, else the boot status file, never raises."""
    try:
        r = await client.get(worker.origin + HEALTH_PATH, headers=worker.headers(), timeout=timeout_s)
        if r.status_code == 200:
            body = await _json(r)
            body.setdefault("ok", True)
            body["state"] = "ready"
            return body
        detail = f"HTTP {r.status_code}"
    except httpx.HTTPError as exc:
        detail = f"unreachable ({type(exc).__name__})"
    try:
        r = await client.get(worker.origin + STATUS_PATH, headers=worker.headers(), timeout=timeout_s)
        if r.status_code == 200:
            status = await _json(r)
            status["ok"] = False
            status.setdefault("state", "unknown")
            status.setdefault("detail", detail)
            return status
    except httpx.HTTPError:
        pass
    return {"ok": False, "state": "unknown", "detail": detail}


async def ensure_avatar(client: httpx.AsyncClient, worker: WorkerAvatar, avatar_id: str,
                        image: bytes, *, ref: str | None = None, priority: str | None = None) -> dict[str, Any]:
    """Prepare the reference face once per worker (the runner keeps it on disk).

    ``ref``: the base portrait this picture is an edit of (prepared first). The runner registers the
    edit onto that portrait's frame and reuses its crop and face box, so a cross-fade between them
    never shows two faces (docs/architecture/18 6.6.1).

    ``priority="call"``: a learner's call waits for this picture, so the runner prepares it before the
    case's look ladder (docs/architecture/18 6.8.1); the runner also answers at once when the same
    picture is already prepared (or another worker's preparation of it is on the shared filesystem)."""
    r = await client.get(worker.origin + "/avatar/avatars", headers=worker.headers(), timeout=10.0)
    if r.status_code == 200 and avatar_id in (await _json(r)).get("avatars", []):
        out: dict[str, Any] = {"avatar_id": avatar_id, "prepared": False}
        # Frame size and face box for the browser's lip-sync meter (older runners answer 404/405).
        try:
            g = await client.get(worker.origin + f"/avatar/avatars/{avatar_id}", headers=worker.headers(), timeout=10.0)
            if g.status_code == 200:
                info = await _json(g)
                out.update({k: info[k] for k in ("face_box", "width", "height", "idle_frames", "ref", "registration")
                            if info.get(k) is not None})
        except httpx.HTTPError:
            pass
        return out
    params = {k: v for k, v in (("ref", ref), ("priority", priority)) if v}
    r = await client.put(worker.origin + f"/avatar/avatars/{avatar_id}", content=image,
                         params=params or None,
                         headers={**worker.headers(), "Content-Type": "image/jpeg"}, timeout=120.0)
    body = await _json(r)
    if r.status_code != 200:
        raise AvatarWorkerError(r.status_code, str(body.get("error") or body))
    body.setdefault("prepared", True)
    return body


async def offer(client: httpx.AsyncClient, worker: WorkerAvatar, *, sdp: str, sdp_type: str,
                avatar_id: str, tuning: dict[str, int] | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {"sdp": sdp, "type": sdp_type, "avatar": avatar_id}
    if tuning:
        payload["tuning"] = tuning
    r = await client.post(worker.origin + "/avatar/offer", headers=worker.headers(), json=payload, timeout=60.0)
    body = await _json(r)
    if r.status_code != 200 or not body.get("sdp") or not body.get("sessionid"):
        raise AvatarWorkerError(r.status_code, str(body.get("error") or body.get("msg") or body))
    return body


async def speak(client: httpx.AsyncClient, worker: WorkerAvatar, *, worker_session: str, audio: bytes,
                filename: str, content_type: str) -> None:
    files = {"file": (filename, audio, content_type)}
    r = await client.post(worker.origin + "/avatar/humanaudio", headers=worker.headers(),
                          data={"sessionid": worker_session}, files=files, timeout=60.0)
    body = await _json(r)
    if r.status_code != 200 or body.get("code", 0) != 0:
        raise AvatarWorkerError(r.status_code, str(body.get("msg") or body))


async def interrupt(client: httpx.AsyncClient, worker: WorkerAvatar, worker_session: str) -> None:
    await client.post(worker.origin + "/avatar/interrupt_talk", headers=worker.headers(),
                      json={"sessionid": worker_session}, timeout=10.0)


async def close(client: httpx.AsyncClient, worker: WorkerAvatar, worker_session: str) -> None:
    try:
        await client.post(worker.origin + "/avatar/close", headers=worker.headers(),
                          json={"sessionid": worker_session}, timeout=10.0)
    except httpx.HTTPError:
        pass


async def switch(client: httpx.AsyncClient, worker: WorkerAvatar, worker_session: str, avatar_id: str, *,
                 crossfade_ms: int = 900) -> dict[str, Any]:
    """Swap a live call's face to another prepared avatar of the same patient, crossfaded."""
    r = await client.post(worker.origin + "/avatar/switch", headers=worker.headers(), timeout=20.0,
                          json={"sessionid": worker_session, "avatar": avatar_id, "crossfade_ms": int(crossfade_ms)})
    body = await _json(r)
    if r.status_code != 200:
        raise AvatarWorkerError(r.status_code, str(body.get("error") or body)[:200])
    return body


async def hold(client: httpx.AsyncClient, worker: WorkerAvatar, seconds: float) -> None:
    """Pause the runner's look preparations for ``seconds`` (0 ends it): a reply is on its way, and its TTS
    and first frames need the card before any audio reaches the runner (docs/architecture/18 6.3.13). An older
    runner without the route answers 404, which is ignored."""
    try:
        await client.post(worker.origin + "/avatar/hold", headers=worker.headers(), timeout=5.0,
                          json={"seconds": float(seconds)})
    except httpx.HTTPError:
        pass


async def tune(client: httpx.AsyncClient, worker: WorkerAvatar, worker_session: str, *, av_shift_ms: int | None = None,
               browser_lag_ms: float | None = None, score: float | None = None,
               receiver_lag_ms: float | None = None) -> dict[str, Any]:
    """Lip sync of a live call. ``av_shift_ms``: a fixed delay (the runner changes its delay line one frame per
    frame). ``browser_lag_ms``: the offset the browser measured, for a runner with auto sync, which keeps the
    delay on its own measured sender skew and takes this as the residual (docs/architecture/18 6.3.13)."""
    payload: dict[str, Any] = {"sessionid": worker_session}
    if av_shift_ms is not None:
        payload["av_shift_ms"] = int(av_shift_ms)
    if receiver_lag_ms is not None:
        payload["receiver_lag_ms"] = float(receiver_lag_ms)
    if browser_lag_ms is not None:
        payload["browser_lag_ms"] = float(browser_lag_ms)
        if score is not None:
            payload["score"] = float(score)
    r = await client.post(worker.origin + "/avatar/tuning", headers=worker.headers(), timeout=10.0, json=payload)
    body = await _json(r)
    if r.status_code != 200:
        raise AvatarWorkerError(r.status_code, str(body.get("error") or body)[:200])
    return body


IMAGEGEN_HEALTH = "/imagegen/health"


async def imagegen_health(client: httpx.AsyncClient, worker: WorkerAvatar, *, timeout_s: float = 4.0) -> dict[str, Any]:
    """The worker's image edit server: ``{ok, loaded, mode, reason, ...}``; never raises."""
    try:
        r = await client.get(worker.origin + IMAGEGEN_HEALTH, headers=worker.headers(), timeout=timeout_s)
    except httpx.HTTPError as exc:
        return {"ok": False, "reason": f"unreachable ({type(exc).__name__})"}
    body = await _json(r)
    if r.status_code != 200:
        return {"ok": False, "reason": f"HTTP {r.status_code}", **body}
    return body


async def imagegen_edit(client: httpx.AsyncClient, worker: WorkerAvatar, image: bytes, prompt: str, *, seed: int,
                        steps: int = 4) -> tuple[bytes, dict[str, Any]]:
    """Edit the portrait into the described state; returns the JPEG and the server's timing headers."""
    r = await client.post(worker.origin + "/imagegen/edit", headers=worker.headers(), timeout=120.0,
                          json={"image_b64": base64.b64encode(image).decode("ascii"), "prompt": prompt,
                                "seed": int(seed), "steps": int(steps)})
    if r.status_code != 200 or not r.headers.get("content-type", "").startswith("image/"):
        body = await _json(r)
        raise AvatarWorkerError(r.status_code, str(body.get("error") or body.get("reason") or body)[:200])
    meta = {"gen_ms": float(r.headers.get("x-gen-ms") or 0.0), "mode": r.headers.get("x-mode"),
            "steps": int(r.headers.get("x-steps") or steps), "seed": int(r.headers.get("x-seed") or seed)}
    return r.content, meta


async def turn_check(client: httpx.AsyncClient, worker: WorkerAvatar) -> dict[str, Any]:
    """The runner's own TURN Allocate against the worker's public endpoints (TLS 443 included)."""
    r = await client.get(worker.origin + "/avatar/turn_check", headers=worker.headers(), timeout=40.0)
    body = await _json(r)
    body.setdefault("http_status", r.status_code)
    return body


def call_capacity(h: dict[str, Any], *, gateway_limit: int, gateway_pending: int) -> dict[str, Any]:
    """Calls this worker can take: the lower of the gateway's per-worker limit and the runner's own
    ``max_sessions``; active = the runner's connected calls plus the gateway's calls still being set
    up (portrait preparation, ICE), which the runner counts only once their offer arrives."""
    runner_max = h.get("max_sessions")
    limit = int(gateway_limit)
    if isinstance(runner_max, int) and runner_max > 0:
        # A runner with a GPU of its own (multi-GPU hosts, cloud-init AVATAR_GPU) sizes its own limit.
        limit = runner_max if h.get("dedicated_gpu") else min(limit, runner_max)
    active = int(h.get("sessions") or 0) + int(gateway_pending)
    return {"max_calls": limit, "active_calls": active, "calls_available": max(0, limit - active)}


async def pick_worker(client: httpx.AsyncClient, wm: Any, *, gateway_limit: int,
                      pending: Callable[[str], int] | None = None,
                      prefer: str | None = None) -> tuple[WorkerAvatar | None, dict[str, Any], dict[str, Any]]:
    """The ready worker of the pool whose runner has the most free call slots (``prefer`` first when it
    has one). Reports each worker's live calls to the pool (load balancing and scale-up) and tells
    the pool when every runner is full. Returns ``(worker, health, capacity)``; worker None when no
    ready worker exists, or every runner is down (health of the last one) or full (capacity 0)."""
    eps = wm.endpoints() if hasattr(wm, "endpoints") else [wm.llm_endpoint()]
    eps = [e for e in eps if e]
    if prefer:
        eps.sort(key=lambda e: 0 if worker_from_endpoint(e).origin == prefer.rstrip("/") else 1)  # type: ignore[union-attr]
    best: tuple[WorkerAvatar, dict[str, Any], dict[str, Any]] | None = None
    last_h: dict[str, Any] = {}
    last_cap: dict[str, Any] = {}
    for ep in eps:
        w = worker_from_endpoint(ep)
        if w is None:
            continue
        h = await health(client, w)
        last_h = h
        if not h.get("ok"):
            continue
        cap = call_capacity(h, gateway_limit=gateway_limit, gateway_pending=pending(w.origin) if pending else 0)
        if hasattr(wm, "set_calls"):
            wm.set_calls(w.origin, cap["active_calls"])
        last_cap = cap
        if cap["calls_available"] > 0 and (best is None or cap["calls_available"] > best[2]["calls_available"]
                                          or (prefer and w.origin == prefer.rstrip("/"))):
            best = (w, h, cap)
            if prefer and w.origin == prefer.rstrip("/"):
                break
    if best is not None:
        return best
    if last_cap and hasattr(wm, "note_call_refused"):
        wm.note_call_refused()   # every runner is full: the pool launches another worker
    return None, last_h, last_cap


# --------------------------------------------------------------------------- #
# Streaming audio in                                                            #
# --------------------------------------------------------------------------- #
class PcmStream:
    """Incremental WAV / raw PCM parser: ``feed(bytes)`` returns the sample bytes seen so far.

    Streaming servers write a RIFF header with a data size of 0 or 0xFFFFFFFF (Chatterbox
    ``/speech/stream``), so the header is parsed up to the ``data`` chunk and every later byte
    is sample data. Raw ``audio/pcm`` (ElevenLabs ``pcm_24000``) has no header and a known rate.
    Only 16-bit mono is forwarded (``supported``); anything else takes the whole-file upload.
    """

    def __init__(self, content_type: str, *, sample_rate: int | None = None):
        self.raw = content_type == "audio/pcm"
        self.sample_rate: int | None = (sample_rate or 24000) if self.raw else None
        self.channels = 1
        self.bits = 16
        self.ready = self.raw
        self._head = b""

    @property
    def supported(self) -> bool:
        return self.bits == 16 and self.channels == 1

    def feed(self, chunk: bytes) -> bytes:
        if self.ready:
            return chunk
        self._head += chunk
        h = self._head
        if len(h) < 12:
            return b""
        if h[:4] != b"RIFF" or h[8:12] != b"WAVE":
            raise ValueError("not a WAV stream")
        pos = 12
        while pos + 8 <= len(h):
            cid = h[pos:pos + 4]
            size = int.from_bytes(h[pos + 4:pos + 8], "little")
            if cid == b"fmt ":
                if pos + 24 > len(h):
                    return b""
                self.channels = int.from_bytes(h[pos + 10:pos + 12], "little")
                self.sample_rate = int.from_bytes(h[pos + 12:pos + 16], "little")
                self.bits = int.from_bytes(h[pos + 22:pos + 24], "little")
            elif cid == b"data":
                self.ready = True
                self._head = b""
                return h[pos + 8:]
            pos += 8 + size + (size & 1)
        return b""


def _ws_url(worker: WorkerAvatar, path: str) -> str:
    u = urlparse(worker.origin)
    return f"{'wss' if u.scheme == 'https' else 'ws'}://{u.netloc}{path}"


def _is_ws_error(exc: BaseException) -> bool:
    return type(exc).__module__.startswith("websockets")


async def ws_connect(url: str, headers: dict[str, str], timeout_s: float) -> Any:
    """Open a client WebSocket (``websockets``, a uvicorn[standard] dependency) through
    ``HTTPS_PROXY`` for a remote worker, directly for a NO_PROXY host (a local runner)."""
    import websockets  # noqa: PLC0415 - only needed for live calls

    kw: dict[str, Any] = {"proxy": None} if urllib.request.proxy_bypass(urlparse(url).hostname or "") else {}
    return await asyncio.wait_for(websockets.connect(url, additional_headers=headers, max_size=1 << 20,
                                                     ping_interval=20, open_timeout=timeout_s, **kw),
                                  timeout=timeout_s + 2)


@dataclass
class RunnerAudioLink:
    """One WebSocket per call to the runner's ``/avatar/stream``, opened once and reused for every
    patient line (the handshake costs a few round trips; a spoken line should not pay them)."""

    worker: WorkerAvatar
    worker_session: str
    connect_timeout_s: float = 10.0
    connect_ms: float | None = None
    _ws: Any = None
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    async def _connect(self) -> Any:
        t0 = time.monotonic()
        ws = await ws_connect(_ws_url(self.worker, "/avatar/stream"), self.worker.headers(), self.connect_timeout_s)
        self.connect_ms = round((time.monotonic() - t0) * 1000.0, 1)
        return ws

    def _open(self) -> bool:
        return self._ws is not None and getattr(self._ws, "close_code", None) is None

    async def ensure(self) -> None:
        """Open the socket ahead of the first line (called right after the offer)."""
        async with self._lock:
            if not self._open():
                self._ws = await self._connect()

    async def utterance(self, pcm: AsyncIterator[bytes], sample_rate: int, *, interrupt: bool = False,
                        on_first_chunk: Callable[[], None] | None = None) -> dict[str, Any]:
        """Send one line: begin, each PCM chunk as it arrives, end; return the runner's stats.

        ``interrupt``: the runner flushes the audio still queued from the previous line first. A line
        cancelled midway (cut by the next one) leaves the socket usable when its ``end`` was not sent yet;
        after ``end`` the runner's ``done`` is still on its way, so the socket is dropped instead (a
        later line must never read the previous line's ``done`` as its own)."""
        async with self._lock:
            ended = False
            try:
                if not self._open():
                    self._ws = await self._connect()
                ws = self._ws
                await ws.send(json.dumps({"type": "begin", "sessionid": self.worker_session,
                                          "sample_rate": int(sample_rate), "interrupt": interrupt}))
                sent = 0
                async for chunk in pcm:
                    if not chunk:
                        continue
                    if sent == 0 and on_first_chunk is not None:
                        on_first_chunk()
                    await ws.send(chunk)
                    sent += len(chunk)
                ended = True
                await ws.send(json.dumps({"type": "end"}))
                deadline = time.monotonic() + 30.0
                while True:
                    raw = await asyncio.wait_for(ws.recv(), timeout=max(0.1, deadline - time.monotonic()))
                    if isinstance(raw, bytes):
                        continue
                    msg = json.loads(raw)
                    if msg.get("type") == "done":
                        return {**msg, "bytes_sent": sent}
                    if msg.get("type") == "error":
                        raise AvatarWorkerError(409, str(msg.get("error")))
            except asyncio.CancelledError:
                if ended:
                    await asyncio.shield(self._drop())
                raise
            except AvatarWorkerError:
                raise
            except (OSError, asyncio.TimeoutError, ValueError) as exc:
                await self._drop()
                raise AvatarWorkerError(502, f"audio stream: {type(exc).__name__}") from exc
            except Exception as exc:
                if _is_ws_error(exc):
                    await self._drop()
                    raise AvatarWorkerError(502, f"audio stream: {type(exc).__name__}") from exc
                raise

    async def _drop(self) -> None:
        ws, self._ws = self._ws, None
        if ws is not None:
            try:
                await ws.close()
            except Exception:  # noqa: BLE001 - best effort
                pass

    async def close(self) -> None:
        async with self._lock:
            await self._drop()
