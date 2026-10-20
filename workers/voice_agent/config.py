"""Agent configuration: what the admin registry resolved, fetched from the gateway.

``GET /admin/voice/agent-config`` (``server/voice/routes.py``, ``X-Admin-Token``)
returns the stt / tts / avatar / livekit blocks with the sealed keys decrypted for
this server-to-server hop. Environment variables are the fallback for a worker that
runs without a gateway (``LIVEKIT_URL``, ``LIVEKIT_API_KEY``, ``LIVEKIT_API_SECRET``,
``DEEPGRAM_API_KEY``, ``ELEVEN_API_KEY``, ``OPENAI_BASE_URL`` ...), matching the
variable names the LiveKit plugins read themselves.

Pure parsing lives here so the gateway's pytest suite can cover it without
installing ``livekit-agents``.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any, Mapping

DEFAULT_GATEWAY = "http://127.0.0.1:8890"
SUPPORTED_RENDERERS = ("none", "simli", "anam", "musetalk")


@dataclass(frozen=True)
class EngineConfig:
    provider: str
    adapter: str          # elevenlabs | deepgram | openai_compatible
    base_url: str
    api_key: str
    model: str | None
    source: str = "registry"
    extra: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class AvatarConfig:
    renderer: str         # none | simli | anam | musetalk
    api_key: str = ""
    options: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class LiveKitConfig:
    url: str
    api_key: str
    api_secret: str


@dataclass(frozen=True)
class AgentConfig:
    gateway_url: str
    patient_turn_path: str
    stt: EngineConfig | None
    tts: EngineConfig | None
    avatar: AvatarConfig
    livekit: LiveKitConfig | None
    language: str = "en"
    airgapped: bool = False

    @property
    def complete(self) -> bool:
        return self.stt is not None and self.tts is not None and self.livekit is not None


def _engine(block: Mapping[str, Any] | None) -> EngineConfig | None:
    if not block:
        return None
    return EngineConfig(provider=str(block.get("provider") or "unknown"), adapter=str(block.get("adapter") or "openai_compatible"),
                        base_url=str(block.get("base_url") or "").rstrip("/"), api_key=str(block.get("api_key") or ""),
                        model=block.get("model"), source=str(block.get("source") or "registry"),
                        extra=dict(block.get("extra") or {}))


def parse_agent_config(payload: Mapping[str, Any], *, gateway_url: str = DEFAULT_GATEWAY,
                       language: str = "en") -> AgentConfig:
    """Shape the gateway's ``/admin/voice/agent-config`` reply; unknown renderers degrade to ``none``."""
    avatar_block = payload.get("avatar") or {}
    renderer = str(avatar_block.get("renderer") or "none").lower()
    if renderer not in SUPPORTED_RENDERERS:
        renderer = "none"
    lk_block = payload.get("livekit") or {}
    livekit = None
    if lk_block.get("url") and lk_block.get("api_key") and lk_block.get("api_secret"):
        livekit = LiveKitConfig(url=str(lk_block["url"]), api_key=str(lk_block["api_key"]),
                                api_secret=str(lk_block["api_secret"]))
    return AgentConfig(
        gateway_url=gateway_url.rstrip("/"),
        patient_turn_path=str((payload.get("gateway") or {}).get("patient_turn_path") or "/v1/patient/turn"),
        stt=_engine(payload.get("stt")), tts=_engine(payload.get("tts")),
        avatar=AvatarConfig(renderer=renderer, api_key=str(avatar_block.get("api_key") or ""),
                            options=dict(avatar_block.get("options") or {})),
        livekit=livekit, language=language, airgapped=bool(payload.get("airgapped")),
    )


def config_from_env(env: Mapping[str, str] | None = None) -> AgentConfig:
    """Fallback for a worker with no gateway admin token: the LiveKit plugins' own variable names."""
    e = env if env is not None else os.environ
    stt = tts = None
    if e.get("DEEPGRAM_API_KEY"):
        stt = EngineConfig("deepgram", "deepgram", "https://api.deepgram.com", e["DEEPGRAM_API_KEY"],
                           e.get("DEEPGRAM_MODEL", "nova-3"), source="env")
    elif e.get("ACUDX_STT_BASE_URL"):
        stt = EngineConfig("openai-compatible", "openai_compatible", e["ACUDX_STT_BASE_URL"], e.get("ACUDX_STT_API_KEY", ""),
                           e.get("ACUDX_STT_MODEL", "deepdml/faster-whisper-large-v3-turbo-ct2"), source="env")
    if e.get("ELEVEN_API_KEY"):
        tts = EngineConfig("elevenlabs", "elevenlabs", "https://api.elevenlabs.io", e["ELEVEN_API_KEY"],
                           e.get("ELEVEN_MODEL", "eleven_flash_v2_5"), source="env")
    elif e.get("ACUDX_TTS_BASE_URL"):
        tts = EngineConfig("openai-compatible", "openai_compatible", e["ACUDX_TTS_BASE_URL"], e.get("ACUDX_TTS_API_KEY", ""),
                           e.get("ACUDX_TTS_MODEL", "chatterbox-multilingual"), source="env")
    livekit = None
    if e.get("LIVEKIT_URL") and e.get("LIVEKIT_API_KEY") and e.get("LIVEKIT_API_SECRET"):
        livekit = LiveKitConfig(e["LIVEKIT_URL"], e["LIVEKIT_API_KEY"], e["LIVEKIT_API_SECRET"])
    renderer = e.get("ACUDX_AVATAR", "none").lower()
    options: dict[str, Any] = {}
    if e.get("ACUDX_AVATAR_OPTIONS"):
        options = json.loads(e["ACUDX_AVATAR_OPTIONS"])
    return AgentConfig(gateway_url=e.get("ACUDX_GATEWAY_URL", DEFAULT_GATEWAY).rstrip("/"),
                       patient_turn_path="/v1/patient/turn", stt=stt, tts=tts,
                       avatar=AvatarConfig(renderer if renderer in SUPPORTED_RENDERERS else "none",
                                           e.get("ACUDX_AVATAR_API_KEY", ""), options),
                       livekit=livekit, language=e.get("ACUDX_LANG", "en"),
                       airgapped=e.get("AIRGAPPED", "false").lower() in ("1", "true", "yes"))


async def load_config(*, gateway_url: str | None = None, admin_token: str | None = None,
                      language: str | None = None, env: Mapping[str, str] | None = None) -> AgentConfig:
    """Gateway first (admin token), env second. Never logs a key."""
    e = env if env is not None else os.environ
    gateway = (gateway_url or e.get("ACUDX_GATEWAY_URL") or DEFAULT_GATEWAY).rstrip("/")
    token = admin_token or e.get("ADMIN_TOKEN")
    lang = language or e.get("ACUDX_LANG", "en")
    if token:
        import httpx  # noqa: PLC0415 - optional at import time

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{gateway}/admin/voice/agent-config", headers={"X-Admin-Token": token})
            resp.raise_for_status()
            return parse_agent_config(resp.json(), gateway_url=gateway, language=lang)
    return config_from_env(e)
