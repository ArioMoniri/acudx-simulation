"""Voice profiles: patient sex + age band + language -> a provider voice id.

The ElevenLabs premade voice ids that used to live in ``web/src/lib/tts.ts`` are
the defaults here, next to the Chatterbox voice-library names the GPU worker
uploads at boot (``infra/gpu-worker/cloud-init.yaml``), Kokoro's English voices
and Deepgram Aura-2's English voices. Operators override any of them through the
provider row's ``extra.voices`` map in the admin console; keys are matched from
most to least specific: ``"<sex>.<band>.<lang>"``, ``"<sex>.<lang>"``, ``"<sex>.<band>"``,
``"<sex>"``, ``"default"``.

Bands: ``child`` (< 13), ``adult`` (13 to 54), ``older`` (55 and up), matching the
``age >= 55`` cut the web client used.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, Mapping

Sex = Literal["male", "female"]
AgeBand = Literal["child", "adult", "older"]


@dataclass(frozen=True)
class VoiceProfile:
    sex: Sex
    band: AgeBand
    lang: str

    def keys(self) -> tuple[str, ...]:
        return (f"{self.sex}.{self.band}.{self.lang}", f"{self.sex}.{self.lang}", f"{self.sex}.{self.band}", self.sex,
                "default")


def age_band(age: int | float | None) -> AgeBand:
    if age is None:
        return "adult"
    if age < 13:
        return "child"
    if age >= 55:
        return "older"
    return "adult"


def normalize_sex(value: str | None) -> Sex:
    v = (value or "").strip().lower()
    if v in ("f", "female", "woman", "girl", "kadın", "kadin"):
        return "female"
    return "male"


def normalize_lang(value: str | None, default: str = "en") -> str:
    v = (value or "").strip().lower().replace("_", "-")
    return v.split("-", 1)[0] or default


def profile_for(sex: str | None, age: int | float | None, lang: str | None) -> VoiceProfile:
    return VoiceProfile(sex=normalize_sex(sex), band=age_band(age), lang=normalize_lang(lang))


# ElevenLabs premade voices (every account): Rachel, Dorothy, Josh, Adam.
# Source: https://elevenlabs.io/app/default-voices (ids were the web client's defaults).
ELEVENLABS_VOICES: dict[str, str] = {
    "female.child": "21m00Tcm4TlvDq8ikWAM",
    "female.adult": "21m00Tcm4TlvDq8ikWAM",
    "female.older": "ThT5KcBeYPX3keUQqHPh",
    "male.child": "TxGEqnHWrfWFTfGW9XjX",
    "male.adult": "TxGEqnHWrfWFTfGW9XjX",
    "male.older": "pNInz6obpgDQGcFmaJgB",
}

# Chatterbox Multilingual on the GPU worker: voice-library names uploaded at boot
# with language metadata (the API picks the language from the voice, see
# https://github.com/travisvn/chatterbox-tts-api/blob/main/docs/MULTILINGUAL.md).
CHATTERBOX_VOICES: dict[str, str] = {
    "female.tr": "acudx_tr_female", "male.tr": "acudx_tr_male",
    "female.en": "acudx_en_female", "male.en": "acudx_en_male",
    "default": "acudx_en_female",
}

# Kokoro 82M (English only): https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md
KOKORO_VOICES: dict[str, str] = {
    "female.child": "af_bella", "female.adult": "af_heart", "female.older": "af_sarah",
    "male.child": "am_adam", "male.adult": "am_michael", "male.older": "am_fenrir",
}

# Deepgram Aura-2 English voices: https://developers.deepgram.com/docs/tts-models
AURA_VOICES: dict[str, str] = {
    "female.child": "aura-2-thalia-en", "female.adult": "aura-2-thalia-en", "female.older": "aura-2-helena-en",
    "male.child": "aura-2-apollo-en", "male.adult": "aura-2-apollo-en", "male.older": "aura-2-zeus-en",
}

DEFAULTS_BY_ADAPTER: dict[str, dict[str, str]] = {
    "elevenlabs": ELEVENLABS_VOICES,
    "deepgram": AURA_VOICES,
    "chatterbox": CHATTERBOX_VOICES,
    "kokoro": KOKORO_VOICES,
    "openai_compatible": CHATTERBOX_VOICES,
}


def _lookup(table: Mapping[str, Any], profile: VoiceProfile) -> str | None:
    for key in profile.keys():
        val = table.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return None


def resolve_voice(adapter: str, profile: VoiceProfile, extra: Mapping[str, Any] | None = None,
                  *, family: str | None = None) -> str:
    """Voice id for ``profile`` on ``adapter``: registry ``extra.voices`` first, then the defaults.

    ``family`` (``extra.voice_family``) picks the default table for OpenAI-compatible
    servers (``chatterbox`` or ``kokoro``); the worker's Chatterbox is the default.
    """
    extra = extra or {}
    override = extra.get("voices")
    if isinstance(override, Mapping):
        found = _lookup(override, profile)
        if found:
            return found
    table_name = (family or extra.get("voice_family") or adapter).lower()
    table = DEFAULTS_BY_ADAPTER.get(table_name) or DEFAULTS_BY_ADAPTER.get(adapter) or {}
    found = _lookup(table, profile)
    if found:
        return found
    # Last resort: any entry of the table, then a neutral name the server can map.
    for val in table.values():
        if isinstance(val, str) and val:
            return val
    return "default"
