"""Map the resolved configuration onto LiveKit plugin instances.

``plan()`` is pure and describes the choice (module, class, key arguments) so the
gateway test suite can assert the mapping without ``livekit-agents`` installed;
``build_stt`` / ``build_tts`` / ``build_avatar`` import the plugins lazily and
construct them. Switching provider or renderer is therefore configuration only:
change the registry row, restart the worker.

Plugin constructor arguments follow the LiveKit docs:
* Deepgram STT: ``deepgram.STT(model="nova-3", language="tr", api_key=...)``
  (https://docs.livekit.io/agents/models/stt/deepgram/)
* ElevenLabs TTS: ``elevenlabs.TTS(voice_id=..., model=..., language=..., api_key=...)``
  (https://docs.livekit.io/agents/models/tts/plugins/elevenlabs/)
* OpenAI-compatible STT / TTS: ``openai.STT(model=..., base_url=..., api_key=...)``,
  ``openai.TTS(model=..., voice=..., base_url=..., api_key=...)``
  (https://docs.livekit.io/agents/models/tts/plugins/openai/ and .../stt/plugins/openai/)
* Avatars: ``simli.AvatarSession(simli_config=simli.SimliConfig(api_key=..., face_id=...))``,
  ``anam.AvatarSession(persona_config=anam.PersonaConfig(name=..., avatarId=...))``
  (https://docs.livekit.io/agents/models/avatar/plugins/simli/ and .../anam/)
* Custom renderer (MuseTalk via LiveTalking, docs/architecture/18 section 6): the
  agent routes its audio to the renderer participant with ``DataStreamAudioOutput``
  (https://docs.livekit.io/agents/models/avatar/#custom-avatar-workers).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from workers.voice_agent.config import AgentConfig, EngineConfig

# Voice ids per language and sex for the hosted and worker engines, mirroring server/voice/profiles.py.
ELEVENLABS_VOICE = {"female": "21m00Tcm4TlvDq8ikWAM", "male": "TxGEqnHWrfWFTfGW9XjX"}
CHATTERBOX_VOICE = {("tr", "female"): "acudx_tr_female", ("tr", "male"): "acudx_tr_male",
                    ("en", "female"): "acudx_en_female", ("en", "male"): "acudx_en_male"}
MUSETALK_RUNNER_IDENTITY = "acudx-avatar-runner"


@dataclass(frozen=True)
class PluginChoice:
    module: str                 # livekit.plugins.<module>
    cls: str                    # class inside the module
    kwargs: dict[str, Any] = field(default_factory=dict, repr=False)
    note: str = ""

    def public(self) -> dict[str, Any]:
        """Loggable view: never the key."""
        return {"module": self.module, "cls": self.cls,
                "kwargs": {k: ("***" if "key" in k.lower() or "secret" in k.lower() else v) for k, v in self.kwargs.items()},
                "note": self.note}


def _voice_for(engine: EngineConfig, lang: str, sex: str) -> str:
    voices = engine.extra.get("voices") if isinstance(engine.extra, dict) else None
    if isinstance(voices, dict):
        for key in (f"{sex}.adult.{lang}", f"{sex}.{lang}", f"{sex}.adult", sex, "default"):
            if voices.get(key):
                return str(voices[key])
    if engine.adapter == "elevenlabs":
        return ELEVENLABS_VOICE[sex]
    if engine.adapter == "deepgram":
        return "aura-2-thalia-en" if sex == "female" else "aura-2-apollo-en"
    return CHATTERBOX_VOICE.get((lang, sex)) or CHATTERBOX_VOICE[("en", sex)]


def plan_stt(engine: EngineConfig | None, lang: str) -> PluginChoice | None:
    if engine is None:
        return None
    if engine.adapter == "deepgram":
        return PluginChoice("deepgram", "STT", {"model": engine.model or "nova-3", "language": lang,
                                                 "api_key": engine.api_key, "interim_results": True},
                            note="Deepgram Nova-3 streaming websocket; Turkish listed on nova-3")
    if engine.adapter == "elevenlabs":
        return PluginChoice("elevenlabs", "STT", {"api_key": engine.api_key, "language_code": lang},
                            note="ElevenLabs Scribe v2 realtime")
    return PluginChoice("openai", "STT", {"model": engine.model or "deepdml/faster-whisper-large-v3-turbo-ct2",
                                          "base_url": f"{engine.base_url}/v1", "api_key": engine.api_key or "none",
                                          "language": lang},
                        note="OpenAI-compatible /v1/audio/transcriptions (worker speaches); the session's Silero VAD "
                             "chunks the stream because Whisper is not streaming-native")


def plan_tts(engine: EngineConfig | None, lang: str, sex: str) -> PluginChoice | None:
    if engine is None:
        return None
    voice = _voice_for(engine, lang, sex)
    if engine.adapter == "elevenlabs":
        return PluginChoice("elevenlabs", "TTS", {"voice_id": voice, "model": engine.model or "eleven_flash_v2_5",
                                                   "language": lang, "api_key": engine.api_key},
                            note="ElevenLabs streaming TTS")
    if engine.adapter == "deepgram":
        if lang != "en":
            return None    # Aura-2 has no Turkish; the gateway resolves another row for tr
        return PluginChoice("deepgram", "TTS", {"model": voice, "api_key": engine.api_key}, note="Deepgram Aura-2 (English)")
    return PluginChoice("openai", "TTS", {"model": engine.model or "chatterbox-multilingual", "voice": voice,
                                          "base_url": f"{engine.base_url}/v1", "api_key": engine.api_key or "none",
                                          "response_format": "wav"},
                        note="OpenAI-compatible /v1/audio/speech (worker Chatterbox Multilingual, Turkish via voice metadata)")


def plan_avatar(cfg: AgentConfig) -> PluginChoice | None:
    av = cfg.avatar
    if av.renderer == "simli":
        if not av.api_key or not av.options.get("face_id"):
            return None
        return PluginChoice("simli", "AvatarSession", {"api_key": av.api_key, "face_id": str(av.options["face_id"]),
                                                       "emotion_id": av.options.get("emotion_id")},
                            note="Simli render-only avatar, $0.01/min class (research doc 14 section 1.1)")
    if av.renderer == "anam":
        if not av.api_key or not av.options.get("avatar_id"):
            return None
        return PluginChoice("anam", "AvatarSession", {"api_key": av.api_key, "avatar_id": str(av.options["avatar_id"]),
                                                      "name": str(av.options.get("persona_name") or "Patient")},
                            note="Anam managed avatar with BYO audio")
    if av.renderer == "musetalk":
        return PluginChoice("livekit.agents.voice.avatar", "DataStreamAudioOutput",
                            {"destination_identity": str(av.options.get("runner_identity") or MUSETALK_RUNNER_IDENTITY)},
                            note="Self-hosted LiveTalking/MuseTalk AvatarRunner joins the room as the renderer participant; "
                                 "see docs/architecture/18 section 6 for the GPU worker steps")
    return None


def plan(cfg: AgentConfig, *, sex: str = "female") -> dict[str, Any]:
    """Loggable summary of what ``build_*`` will instantiate for this configuration."""
    stt = plan_stt(cfg.stt, cfg.language)
    tts = plan_tts(cfg.tts, cfg.language, sex)
    avatar = plan_avatar(cfg)
    return {"language": cfg.language, "stt": stt.public() if stt else None, "tts": tts.public() if tts else None,
            "avatar": avatar.public() if avatar else {"module": None, "cls": None, "note": "no renderer: audio-only agent, "
                                                                                       "the browser tile animates the "
                                                                                       "talking head from the audio"},
            "turn_detection": {"vad": "silero", "model": "livekit inference TurnDetector v1-mini (14 languages incl. tr)"},
            "airgapped": cfg.airgapped}


# --------------------------------------------------------------------------- #
# construction (lazy imports)                                                 #
# --------------------------------------------------------------------------- #
def build_stt(cfg: AgentConfig):
    choice = plan_stt(cfg.stt, cfg.language)
    if choice is None:
        raise RuntimeError("no STT provider resolved; configure one under /admin/providers (kind stt)")
    if choice.module == "deepgram":
        from livekit.plugins import deepgram  # noqa: PLC0415
        return deepgram.STT(**choice.kwargs)
    if choice.module == "elevenlabs":
        from livekit.plugins import elevenlabs  # noqa: PLC0415
        return elevenlabs.STT(**choice.kwargs)
    from livekit.plugins import openai  # noqa: PLC0415
    return openai.STT(**choice.kwargs)


def build_tts(cfg: AgentConfig, *, sex: str = "female"):
    choice = plan_tts(cfg.tts, cfg.language, sex)
    if choice is None:
        raise RuntimeError("no TTS provider resolved for this language; configure one under /admin/providers (kind tts)")
    if choice.module == "elevenlabs":
        from livekit.plugins import elevenlabs  # noqa: PLC0415
        return elevenlabs.TTS(**choice.kwargs)
    if choice.module == "deepgram":
        from livekit.plugins import deepgram  # noqa: PLC0415
        return deepgram.TTS(**choice.kwargs)
    from livekit.plugins import openai  # noqa: PLC0415
    return openai.TTS(**choice.kwargs)


def build_avatar(cfg: AgentConfig, room=None):
    """An ``AvatarSession`` (simli / anam), a ``DataStreamAudioOutput`` for the MuseTalk runner, or None."""
    choice = plan_avatar(cfg)
    if choice is None:
        return None
    if choice.module == "simli":
        from livekit.plugins import simli  # noqa: PLC0415
        kw = {k: v for k, v in choice.kwargs.items() if v is not None}
        return simli.AvatarSession(simli_config=simli.SimliConfig(**kw))
    if choice.module == "anam":
        from livekit.plugins import anam  # noqa: PLC0415
        return anam.AvatarSession(persona_config=anam.PersonaConfig(name=choice.kwargs["name"],
                                                                     avatarId=choice.kwargs["avatar_id"]),
                                  api_key=choice.kwargs["api_key"])
    from livekit.agents.voice.avatar import DataStreamAudioOutput  # noqa: PLC0415
    if room is None:
        raise RuntimeError("the MuseTalk renderer needs the room to route audio")
    return DataStreamAudioOutput(room, destination_identity=choice.kwargs["destination_identity"],
                                 wait_playback_start=True)
