"""Self-hosted live patient video: the GPU worker's LiveTalking + MuseTalk 1.5 runner.

The worker (``infra/gpu-worker/cloud-init.yaml``) runs the runner as the ``avatar``
container behind Caddy at ``/avatar/*`` (bearer required) plus a coturn TURN server on
3478 (UDP and TCP). The gateway is the runner's only control client:

* ``PUT  /avatar/avatars/{id}``  the case portrait (``web/public/patients/<photo>.jpg``) becomes
                                the reference face: MuseTalk latents, face box, blend mask;
* ``POST /avatar/offer``         the browser's SDP offer (proxied, never the bearer) -> answer;
* ``POST /avatar/humanaudio``    the patient's TTS audio (Chatterbox or ElevenLabs, synthesized
                                by :class:`~server.voice.service.VoiceService`) is lip-synced and
                                streamed on the same WebRTC connection, audio and video together;
* ``POST /avatar/close``         end the runner session;
* ``GET  /avatar/health``        model, sessions, VRAM, measured inference fps.

Media never passes through the gateway: the browser reaches the worker's TURN server
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

import base64
import hashlib
import hmac
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

TURN_SECRET_LABEL = b"acudx-turn-v1"
TURN_PORT = 3478
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
    """RTCIceServer list for the browser: the worker's TURN over UDP and TCP.

    ``override_urls`` (``AVATAR_TURN_URLS``) replaces the URLs, for deployments that front
    the TURN port elsewhere (a TLS terminator on 443, or a local tunnel in a test harness);
    the credentials stay the worker's.
    """
    username, credential = turn_credentials(turn_secret(worker.token), session_id, now=now)
    urls = list(override_urls) if override_urls else [
        f"turn:{worker.domain}:{TURN_PORT}?transport=udp",
        f"turn:{worker.domain}:{TURN_PORT}?transport=tcp",
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
        body = {"raw": r.text[:300]}
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
                        image: bytes) -> dict[str, Any]:
    """Prepare the reference face once per worker (the runner keeps it on disk)."""
    r = await client.get(worker.origin + "/avatar/avatars", headers=worker.headers(), timeout=10.0)
    if r.status_code == 200 and avatar_id in (await _json(r)).get("avatars", []):
        return {"avatar_id": avatar_id, "prepared": False}
    r = await client.put(worker.origin + f"/avatar/avatars/{avatar_id}", content=image,
                         headers={**worker.headers(), "Content-Type": "image/jpeg"}, timeout=120.0)
    body = await _json(r)
    if r.status_code != 200:
        raise AvatarWorkerError(r.status_code, str(body.get("error") or body))
    body["prepared"] = True
    return body


async def offer(client: httpx.AsyncClient, worker: WorkerAvatar, *, sdp: str, sdp_type: str,
                avatar_id: str) -> dict[str, Any]:
    r = await client.post(worker.origin + "/avatar/offer", headers=worker.headers(),
                          json={"sdp": sdp, "type": sdp_type, "avatar": avatar_id}, timeout=60.0)
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
