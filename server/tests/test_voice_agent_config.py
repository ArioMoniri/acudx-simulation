"""workers/voice_agent: configuration parsing and plugin selection (pure, no livekit install needed)."""

from __future__ import annotations

import json

import httpx
import pytest

from workers.voice_agent import config as cfgmod
from workers.voice_agent import selection
from workers.voice_agent.gateway_patient import (
    GatewayPatientClient,
    build_turn_request,
    history_from_items,
    latest_learner_message,
    utterance_from_response,
)

GATEWAY_REPLY = {
    "airgapped": False,
    "gateway": {"patient_turn_path": "/v1/patient/turn"},
    "stt": {"provider": "dg", "adapter": "deepgram", "base_url": "https://api.deepgram.com", "api_key": "dg-secret",
            "model": "nova-3", "source": "registry", "extra": {}},
    "tts": {"provider": "gpu-worker", "adapter": "openai_compatible", "base_url": "https://1-2-3-4.sslip.io/tts",
            "api_key": "wtok", "model": "chatterbox-multilingual", "source": "gpu_worker", "extra": {}},
    "avatar": {"renderer": "simli", "provider": "lk", "api_key": "simli-key", "options": {"face_id": "face-1"}},
    "livekit": {"url": "wss://lk.example.org", "api_key": "APIabc", "api_secret": "lk-secret"},
}


def test_parse_agent_config_from_gateway_reply():
    cfg = cfgmod.parse_agent_config(GATEWAY_REPLY, gateway_url="http://127.0.0.1:8890/", language="tr")
    assert cfg.complete and cfg.gateway_url == "http://127.0.0.1:8890" and cfg.language == "tr"
    assert cfg.stt.adapter == "deepgram" and cfg.stt.api_key == "dg-secret"
    assert cfg.tts.source == "gpu_worker" and cfg.tts.base_url == "https://1-2-3-4.sslip.io/tts"
    assert cfg.avatar.renderer == "simli" and cfg.avatar.options == {"face_id": "face-1"}
    assert cfg.livekit.url == "wss://lk.example.org"


def test_unknown_renderer_and_missing_blocks_degrade_cleanly():
    cfg = cfgmod.parse_agent_config({"avatar": {"renderer": "hologram"}, "livekit": {"url": "wss://x"}})
    assert cfg.avatar.renderer == "none" and cfg.livekit is None and cfg.stt is None and not cfg.complete
    assert selection.plan_avatar(cfg) is None
    assert selection.plan(cfg)["avatar"]["cls"] is None


def test_env_fallback_reads_the_plugins_variable_names():
    env = {"LIVEKIT_URL": "wss://lk", "LIVEKIT_API_KEY": "k", "LIVEKIT_API_SECRET": "s", "ELEVEN_API_KEY": "xi",
           "ACUDX_STT_BASE_URL": "https://w.sslip.io/stt", "ACUDX_STT_API_KEY": "t", "ACUDX_AVATAR": "anam",
           "ACUDX_AVATAR_OPTIONS": json.dumps({"avatar_id": "av-1"}), "ACUDX_AVATAR_API_KEY": "anam-key",
           "ACUDX_LANG": "tr", "AIRGAPPED": "true"}
    cfg = cfgmod.config_from_env(env)
    assert cfg.complete and cfg.tts.adapter == "elevenlabs" and cfg.stt.adapter == "openai_compatible"
    assert cfg.avatar.renderer == "anam" and cfg.airgapped is True and cfg.language == "tr"


def test_plan_maps_adapters_to_livekit_plugins_without_leaking_keys():
    cfg = cfgmod.parse_agent_config(GATEWAY_REPLY, language="tr")
    p = selection.plan(cfg, sex="male")
    assert p["stt"]["module"] == "deepgram" and p["stt"]["cls"] == "STT"
    assert p["stt"]["kwargs"]["model"] == "nova-3" and p["stt"]["kwargs"]["language"] == "tr"
    assert p["stt"]["kwargs"]["api_key"] == "***"
    assert p["tts"]["module"] == "openai" and p["tts"]["kwargs"]["voice"] == "acudx_tr_male"
    assert p["tts"]["kwargs"]["base_url"] == "https://1-2-3-4.sslip.io/tts/v1"
    assert p["avatar"]["module"] == "simli" and p["avatar"]["kwargs"]["face_id"] == "face-1"
    assert "simli-key" not in json.dumps(p) and "dg-secret" not in json.dumps(p)
    assert "tr" in p["turn_detection"]["model"]


def test_plan_elevenlabs_tts_and_aura_english_only():
    el = cfgmod.EngineConfig("el", "elevenlabs", "https://api.elevenlabs.io", "xi", "eleven_v4_turbo")
    choice = selection.plan_tts(el, "tr", "female")
    assert choice.module == "elevenlabs" and choice.kwargs["voice_id"] == "21m00Tcm4TlvDq8ikWAM"
    assert choice.kwargs["model"] == "eleven_v4_turbo" and choice.kwargs["language"] == "tr"
    aura = cfgmod.EngineConfig("dg", "deepgram", "https://api.deepgram.com", "dg", None)
    assert selection.plan_tts(aura, "tr", "female") is None
    assert selection.plan_tts(aura, "en", "female").kwargs["model"] == "aura-2-thalia-en"
    with_override = cfgmod.EngineConfig("el", "elevenlabs", "https://api.elevenlabs.io", "xi", None,
                                        extra={"voices": {"female.tr": "custom-tr"}})
    assert selection.plan_tts(with_override, "tr", "female").kwargs["voice_id"] == "custom-tr"


def test_plan_musetalk_routes_audio_to_the_runner_participant():
    cfg = cfgmod.parse_agent_config({**GATEWAY_REPLY, "avatar": {"renderer": "musetalk", "options": {}}})
    choice = selection.plan_avatar(cfg)
    assert choice.module == "livekit.agents.voice.avatar" and choice.cls == "DataStreamAudioOutput"
    assert choice.kwargs["destination_identity"] == selection.MUSETALK_RUNNER_IDENTITY
    simli_without_face = cfgmod.parse_agent_config({**GATEWAY_REPLY, "avatar": {"renderer": "simli", "api_key": "k"}})
    assert selection.plan_avatar(simli_without_face) is None


def test_build_functions_fail_clearly_without_a_resolved_engine():
    cfg = cfgmod.parse_agent_config({})
    with pytest.raises(RuntimeError, match="no STT provider"):
        selection.build_stt(cfg)
    with pytest.raises(RuntimeError, match="no TTS provider"):
        selection.build_tts(cfg)
    assert selection.build_avatar(cfg) is None


# --------------------------------------------------------------------------- #
# gateway patient turn                                                         #
# --------------------------------------------------------------------------- #
def test_chat_context_helpers_pick_the_last_learner_turn_and_history():
    items = [{"role": "system", "content": "x"}, {"role": "user", "content": ["Where", "does it hurt?"]},
             {"role": "assistant", "content": "My chest."}, {"role": "user", "content": " Since when? "}]
    assert latest_learner_message(items) == "Since when?"
    assert history_from_items(items[:-1]) == [{"role": "user", "content": "Where does it hurt?"},
                                              {"role": "assistant", "content": "My chest."}]
    body = build_turn_request("Since when?", case_state={"a": 1}, persona=None, history=[], locale="tr")
    assert body == {"learner_msg": "Since when?", "case_state": {"a": 1}, "persona": None, "history": [], "locale": "tr",
                    "max_tokens": 160}
    assert utterance_from_response({"utterance": "  Bir saattir.  "}) == "Bir saattir."
    assert utterance_from_response({}) == ""


async def test_gateway_client_posts_to_patient_turn_with_encounter_header():
    seen: dict = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["headers"] = dict(request.headers)
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"utterance": "Göğsüm sıkışıyor.", "routed_as": "in-scope"})

    client = GatewayPatientClient("http://gw.test/", "/v1/patient/turn", encounter_id="enc-9",
                                 client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    out = await client.turn(build_turn_request("Neyiniz var?", case_state={}, persona=None, history=[], locale="tr"))
    await client.aclose()
    assert out["utterance"] == "Göğsüm sıkışıyor." and seen["url"] == "http://gw.test/v1/patient/turn"
    assert seen["headers"]["x-encounter-id"] == "enc-9" and seen["body"]["learner_msg"] == "Neyiniz var?"
