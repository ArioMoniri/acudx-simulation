"""Voice profiles, voice price rows and LiveKit token signing (pure, no network)."""

from __future__ import annotations

import hashlib
import hmac

import pytest

from server.telemetry import prices
from server.voice import livekit as lk
from server.voice import profiles


def test_age_bands_match_the_web_clients_55_cut():
    assert profiles.age_band(8) == "child" and profiles.age_band(13) == "adult"
    assert profiles.age_band(54) == "adult" and profiles.age_band(55) == "older" and profiles.age_band(None) == "adult"


def test_profile_normalizes_sex_and_language():
    p = profiles.profile_for("Female", 67, "tr-TR")
    assert (p.sex, p.band, p.lang) == ("female", "older", "tr")
    assert profiles.profile_for("kadın", 30, None).sex == "female"
    assert profiles.profile_for(None, 30, "").lang == "en"


def test_elevenlabs_defaults_are_the_former_web_client_ids():
    f_young = profiles.resolve_voice("elevenlabs", profiles.profile_for("female", 30, "en"))
    f_old = profiles.resolve_voice("elevenlabs", profiles.profile_for("female", 70, "en"))
    m_young = profiles.resolve_voice("elevenlabs", profiles.profile_for("male", 30, "tr"))
    m_old = profiles.resolve_voice("elevenlabs", profiles.profile_for("male", 60, "tr"))
    assert (f_young, f_old, m_young, m_old) == ("21m00Tcm4TlvDq8ikWAM", "ThT5KcBeYPX3keUQqHPh", "TxGEqnHWrfWFTfGW9XjX",
                                                "pNInz6obpgDQGcFmaJgB")


def test_registry_extra_voices_override_from_most_specific_key():
    extra = {"voices": {"female.older.tr": "custom-tr-older", "male": "custom-male"}}
    assert profiles.resolve_voice("elevenlabs", profiles.profile_for("female", 70, "tr"), extra) == "custom-tr-older"
    # No override matches female/older/en: the adapter default table answers.
    assert profiles.resolve_voice("elevenlabs", profiles.profile_for("female", 70, "en"), extra) == "ThT5KcBeYPX3keUQqHPh"
    assert profiles.resolve_voice("elevenlabs", profiles.profile_for("male", 20, "en"), extra) == "custom-male"
    # An operator "default" wins over every built-in table entry.
    assert profiles.resolve_voice("elevenlabs", profiles.profile_for("female", 70, "en"),
                                  {"voices": {"default": "custom-default"}}) == "custom-default"


def test_worker_voice_names_follow_language_and_kokoro_family_is_english():
    tr = profiles.resolve_voice("openai_compatible", profiles.profile_for("female", 40, "tr"), family="chatterbox")
    en = profiles.resolve_voice("openai_compatible", profiles.profile_for("male", 40, "en"), family="chatterbox")
    assert (tr, en) == ("acudx_tr_female", "acudx_en_male")
    kokoro = profiles.resolve_voice("openai_compatible", profiles.profile_for("female", 40, "en"),
                                    {"voice_family": "kokoro"})
    assert kokoro == "af_heart"
    aura = profiles.resolve_voice("deepgram", profiles.profile_for("male", 70, "en"))
    assert aura == "aura-2-zeus-en"


# --------------------------------------------------------------------------- #
# prices                                                                      #
# --------------------------------------------------------------------------- #
def test_voice_price_rows_are_sourced_and_priced_per_unit():
    assert all(r.source_url.startswith("https://") for r in prices.VOICE_PRICE_TABLE)
    # ElevenLabs Flash v2.5: $0.04 per 1k chars (https://elevenlabs.io/pricing/api)
    assert prices.voice_cost_usd("elevenlabs", "eleven_flash_v2_5", chars=5400) == pytest.approx(0.216)
    assert prices.voice_cost_usd("elevenlabs", "eleven_v4_turbo", chars=1000) == pytest.approx(0.04)
    assert prices.voice_cost_usd("elevenlabs", "eleven_multilingual_v2", chars=1000) == pytest.approx(0.08)
    # Deepgram Nova-3 $0.0048/min; Aura-2 $0.030 per 1k chars (https://deepgram.com/pricing)
    assert prices.voice_cost_usd("deepgram", "nova-3", audio_seconds=600) == pytest.approx(0.048)
    assert prices.voice_cost_usd("deepgram", "aura-2-thalia-en", chars=2000) == pytest.approx(0.06)
    # Scribe v2 batch $0.22 per hour
    assert prices.voice_cost_usd("elevenlabs", "scribe_v2", audio_seconds=3600) == pytest.approx(0.22)
    assert prices.voice_cost_usd("gpu_worker", "chatterbox-multilingual", chars=99999) == 0.0
    assert prices.voice_cost_usd("elevenlabs", "unknown-model", chars=1000) == 0.0
    assert prices.provider_from_url("https://api.elevenlabs.io") == "elevenlabs"
    assert prices.provider_from_url("https://api.deepgram.com") == "deepgram"


# --------------------------------------------------------------------------- #
# LiveKit tokens                                                              #
# --------------------------------------------------------------------------- #
def test_livekit_token_claims_and_signature():
    tok = lk.sign_token("APIkey", "secret", room="acudx-abc", identity="learner-1", name="Learner", ttl_s=600, now=1000)
    head, payload, sig = tok.split(".")
    claims = lk.decode_unverified(tok)
    assert claims["iss"] == "APIkey" and claims["sub"] == "learner-1" and claims["name"] == "Learner"
    assert claims["nbf"] == 1000 and claims["exp"] == 1600
    assert claims["video"] == {"roomJoin": True, "room": "acudx-abc", "canPublish": True, "canSubscribe": True,
                               "canPublishData": True}
    expected = hmac.new(b"secret", f"{head}.{payload}".encode(), hashlib.sha256).digest()
    assert sig == lk._b64(expected)


def test_livekit_ws_url_and_opaque_room_names():
    assert lk.ws_url("https://lk.example.org/") == "wss://lk.example.org"
    assert lk.ws_url("http://10.0.0.5:7880") == "ws://10.0.0.5:7880"
    assert lk.ws_url("wss://already") == "wss://already"
    room = lk.room_name("encounter-42")
    assert room.startswith("acudx-") and "encounter" not in room and room == lk.room_name("encounter-42")
