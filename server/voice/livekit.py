"""LiveKit room tokens for the realtime patient video tile.

A registry row of kind ``avatar`` with ``extra.transport == "livekit"`` carries the
connection: ``base_url`` is the LiveKit server over https (the browser dials the
same host over wss), ``extra.livekit_api_key`` the API key and the sealed
``api_key`` the API secret. ``extra.avatar`` names the renderer the agent worker
should start (``simli``, ``anam``, ``musetalk``, ``none``).

Tokens are JWTs signed with HS256 by the API secret, claims per
https://docs.livekit.io/home/server/generating-tokens/ (``iss`` = API key,
``sub`` = participant identity, ``video`` grants with ``roomJoin`` and ``room``).
``livekit-api`` (``livekit.api.AccessToken``) is used when installed; the stdlib
signer below produces the same token so the gateway has no hard dependency.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse, urlunparse

from server.registry.resolve import ProviderEndpoint

DEFAULT_TTL_S = 15 * 60


@dataclass(frozen=True)
class LiveKitConfig:
    url: str              # wss://host[:port]
    http_url: str         # https://host[:port]
    api_key: str
    api_secret: str
    renderer: str         # simli | anam | musetalk | none
    extra: dict[str, Any]


def ws_url(http_url: str) -> str:
    """``https://lk.example`` -> ``wss://lk.example`` (``http`` -> ``ws``); ws(s) is kept."""
    p = urlparse(http_url)
    scheme = {"https": "wss", "http": "ws"}.get(p.scheme, p.scheme)
    return urlunparse((scheme, p.netloc, p.path.rstrip("/"), "", "", ""))


def config_from_endpoint(ep: ProviderEndpoint) -> LiveKitConfig | None:
    """The LiveKit connection carried by an ``avatar`` row, or None when it is not a LiveKit row."""
    transport = str(ep.extra.get("transport") or "livekit").lower()
    if ep.kind != "avatar" or transport != "livekit":
        return None
    key = str(ep.extra.get("livekit_api_key") or "").strip()
    if not key or not ep.api_key:
        return None
    return LiveKitConfig(url=ws_url(ep.base_url), http_url=ep.base_url, api_key=key, api_secret=ep.api_key,
                         renderer=str(ep.extra.get("avatar") or "none").lower(), extra=dict(ep.extra))


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def sign_token(api_key: str, api_secret: str, *, room: str, identity: str, name: str | None = None,
               ttl_s: int = DEFAULT_TTL_S, can_publish: bool = True, can_subscribe: bool = True,
               metadata: str | None = None, now: float | None = None) -> str:
    """HS256 LiveKit access token (identical claims to ``livekit.api.AccessToken``)."""
    if not room or not identity:
        raise ValueError("room and identity are required")
    ts = int(now if now is not None else time.time())
    header = {"alg": "HS256", "typ": "JWT"}
    payload: dict[str, Any] = {
        "iss": api_key, "sub": identity, "nbf": ts, "exp": ts + int(ttl_s),
        "video": {"roomJoin": True, "room": room, "canPublish": can_publish, "canSubscribe": can_subscribe,
                  "canPublishData": True},
    }
    if name:
        payload["name"] = name
    if metadata:
        payload["metadata"] = metadata
    signing_input = f"{_b64(json.dumps(header, separators=(',', ':')).encode())}." \
                    f"{_b64(json.dumps(payload, separators=(',', ':'), sort_keys=True).encode())}"
    sig = hmac.new(api_secret.encode(), signing_input.encode(), hashlib.sha256).digest()
    return f"{signing_input}.{_b64(sig)}"


def issue_token(cfg: LiveKitConfig, *, room: str, identity: str, name: str | None = None,
                ttl_s: int = DEFAULT_TTL_S, metadata: str | None = None) -> str:
    """Prefer ``livekit-api`` when installed (same claims), else the stdlib signer."""
    try:
        from livekit import api as lk_api  # noqa: PLC0415 - optional dependency
    except ImportError:
        return sign_token(cfg.api_key, cfg.api_secret, room=room, identity=identity, name=name, ttl_s=ttl_s,
                          metadata=metadata)
    token = lk_api.AccessToken(cfg.api_key, cfg.api_secret).with_identity(identity).with_grants(
        lk_api.VideoGrants(room_join=True, room=room, can_publish=True, can_subscribe=True, can_publish_data=True))
    if name:
        token = token.with_name(name)
    if metadata:
        token = token.with_metadata(metadata)
    from datetime import timedelta  # noqa: PLC0415
    return token.with_ttl(timedelta(seconds=ttl_s)).to_jwt()


def decode_unverified(token: str) -> dict[str, Any]:
    """Payload of a JWT without verifying it (tests and diagnostics only)."""
    part = token.split(".")[1]
    part += "=" * (-len(part) % 4)
    return json.loads(base64.urlsafe_b64decode(part.encode()))


def room_name(encounter_id: str) -> str:
    """Opaque room name: never a learner name or other PII (LiveKit logs room names)."""
    digest = hashlib.sha256(encounter_id.encode("utf-8")).hexdigest()[:16]
    return f"acudx-{digest}"
