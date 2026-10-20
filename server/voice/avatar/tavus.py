"""Hosted live patient video: Tavus CVI (Conversational Video Interface).

Request shapes from the Tavus docs, read 2026-10-20:

* ``POST https://tavusapi.com/v2/pals`` (header ``x-api-key``) creates a PAL: ``pal_name``,
  ``system_prompt``, ``pipeline_mode: "full"``, ``default_face_id`` (required on /v2/pals),
  ``layers.llm`` and ``layers.tts``; returns ``pal_id``
  (https://docs.tavus.io/api-reference/pals/create-pal). ``/v2/personas`` and ``persona_id`` /
  ``default_replica_id`` remain accepted aliases of the same resource.
* Custom LLM: ``layers.llm = {model, base_url, api_key, speculative_inference, headers?}``; Tavus
  posts OpenAI-style ``/chat/completions`` to ``base_url`` (no route suffix in ``base_url``) and
  expects an SSE stream (https://docs.tavus.io/sections/conversational-video-interface/pal/llm).
  We point it at the gateway's ``/v1/patient/openai`` with a per-call bearer, so every patient
  reply still goes through the scope guard, the persona prompt and the FactAssertionGate.
* TTS: ``layers.tts = {tts_engine: "elevenlabs", api_key, external_voice_id, tts_model_name}``
  uses our own ElevenLabs account and voice (the same voice profile the gateway TTS picks);
  without an ElevenLabs row the PAL keeps Tavus's default voice (``tavus-auto``)
  (https://docs.tavus.io/sections/conversational-video-interface/pal/tts).
* PAL per call ("Approach B", https://docs.tavus.io/sections/onboarding-guide/pal-strategies):
  create PAL -> create conversation -> on end, end the conversation and ``DELETE /v2/pals/{id}``.
* ``POST /v2/conversations`` ``{pal_id, face_id?, conversation_name, conversational_context,
  custom_greeting?, properties: {max_call_duration, participant_left_timeout,
  participant_absent_timeout, languages[], enable_closed_captions}}`` returns
  ``conversation_id``, ``conversation_url`` (a Daily room the browser embeds), ``status``
  (https://docs.tavus.io/api-reference/conversations/create-conversation).
* ``POST /v2/conversations/{conversation_id}/end``
  (https://docs.tavus.io/api-reference/conversations/end-conversation).

Registry row: kind ``avatar``, name ``tavus`` (or ``extra.transport: "tavus"``), base_url
``https://tavusapi.com``, the sealed ``api_key`` is the Tavus key (write-only in the admin
panel), ``extra.face_id`` the default face (a stock face or one trained from a portrait),
``extra.face_ids`` an optional ``{photo_id: face_id}`` map, ``extra.public_base_url`` the
gateway's internet-reachable origin Tavus calls back (falls back to ``PUBLIC_BASE_URL``).
Nothing here runs until the owner adds that row.

Billing (https://www.tavus.io/pricing, research 14 section 1.1): per conversation minute in
6 s increments with a 30 s minimum; the gateway records the call length in the session metrics.
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from typing import Any

import httpx

from server.registry.resolve import ProviderEndpoint

TAVUS_API = "https://tavusapi.com"
DEFAULT_MAX_CALL_S = 20 * 60
LLM_MODEL_NAME = "acudx-patient"


class TavusError(RuntimeError):
    def __init__(self, status: int, detail: str):
        super().__init__(f"tavus {status}: {detail}")
        self.status = status
        self.detail = detail


def is_tavus_endpoint(ep: ProviderEndpoint) -> bool:
    transport = str(ep.extra.get("transport") or "").lower()
    return ep.kind == "avatar" and (transport == "tavus" or (not transport and ep.name.lower() == "tavus")
                                    or "tavusapi.com" in ep.base_url)


@dataclass(frozen=True)
class TavusConfig:
    base_url: str
    api_key: str
    face_id: str | None
    face_ids: dict[str, str]
    public_base_url: str | None
    max_call_s: int

    def face_for(self, photo_id: str | None) -> str | None:
        if photo_id and photo_id in self.face_ids:
            return self.face_ids[photo_id]
        return self.face_id


def config_from_endpoint(ep: ProviderEndpoint, *, public_base_url: str | None = None) -> TavusConfig | None:
    if not is_tavus_endpoint(ep) or not ep.api_key:
        return None
    face_ids = ep.extra.get("face_ids") if isinstance(ep.extra.get("face_ids"), dict) else {}
    return TavusConfig(
        base_url=(ep.base_url or TAVUS_API).rstrip("/"), api_key=ep.api_key,
        face_id=str(ep.extra.get("face_id") or "") or None,
        face_ids={str(k): str(v) for k, v in face_ids.items()},
        public_base_url=(str(ep.extra.get("public_base_url") or "") or public_base_url or None),
        max_call_s=int(ep.extra.get("max_call_duration") or DEFAULT_MAX_CALL_S),
    )


def new_llm_token() -> str:
    """The per-call bearer the PAL's custom LLM sends back to the gateway."""
    return "acudx-tavus-" + secrets.token_urlsafe(32)


def system_prompt(persona: dict[str, Any] | None, lang: str) -> str:
    """A short PAL prompt; the real persona prompt is built per turn by the gateway endpoint."""
    name = (persona or {}).get("name") or "the patient"
    language = "Turkish" if lang == "tr" else "English"
    return (f"You are {name}, a synthetic patient in a medical education simulation, on a video call with a "
            f"learner. Speak {language}, in short spoken sentences, as the patient. Your replies are generated "
            f"by the simulation server; say exactly what it returns.")


def pal_body(*, persona: dict[str, Any] | None, lang: str, face_id: str, llm_base_url: str, llm_token: str,
             tts: dict[str, Any] | None) -> dict[str, Any]:
    layers: dict[str, Any] = {
        "llm": {"model": LLM_MODEL_NAME, "base_url": llm_base_url, "api_key": llm_token,
                "speculative_inference": False},
        # Perception off: the patient does not need to see the learner, and no biometric
        # emotion inference runs on a learner's camera (EU AI Act guidance in the Tavus docs).
        "perception": {"perception_model": "off"},
    }
    if tts:
        layers["tts"] = tts
    return {"pal_name": f"acudx-patient-{secrets.token_hex(4)}", "system_prompt": system_prompt(persona, lang),
            "pipeline_mode": "full", "default_face_id": face_id, "layers": layers}


def tts_layer(tts_ep: ProviderEndpoint | None, voice_id: str | None) -> dict[str, Any] | None:
    """Our ElevenLabs account and voice when an ElevenLabs TTS row exists, else Tavus's own voice."""
    if tts_ep is None or not tts_ep.api_key or "elevenlabs.io" not in tts_ep.base_url or not voice_id:
        return None
    model = str(tts_ep.extra.get("model_id") or tts_ep.model or "eleven_flash_v2_5")
    return {"tts_engine": "elevenlabs", "api_key": tts_ep.api_key, "external_voice_id": voice_id,
            "tts_model_name": model}


def conversation_body(*, pal_id: str, face_id: str | None, lang: str, context: str, greeting: str | None,
                      max_call_s: int, name: str) -> dict[str, Any]:
    body: dict[str, Any] = {
        "pal_id": pal_id, "conversation_name": name, "conversational_context": context,
        "properties": {"max_call_duration": max_call_s, "participant_left_timeout": 30,
                       "participant_absent_timeout": 120, "languages": [lang], "enable_closed_captions": True},
    }
    if face_id:
        body["face_id"] = face_id
    if greeting:
        body["custom_greeting"] = greeting
    return body


class TavusClient:
    def __init__(self, cfg: TavusConfig, client: httpx.AsyncClient):
        self.cfg = cfg
        self.client = client

    def _headers(self) -> dict[str, str]:
        return {"x-api-key": self.cfg.api_key, "Content-Type": "application/json"}

    async def _post(self, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        r = await self.client.post(self.cfg.base_url + path, headers=self._headers(), json=body or {}, timeout=30.0)
        if r.status_code >= 300:
            raise TavusError(r.status_code, _err(r))
        try:
            data = r.json()
        except ValueError:
            data = {}
        return data if isinstance(data, dict) else {}

    async def create_pal(self, body: dict[str, Any]) -> str:
        data = await self._post("/v2/pals", body)
        pal_id = data.get("pal_id") or data.get("persona_id")
        if not pal_id:
            raise TavusError(502, "create PAL returned no pal_id")
        return str(pal_id)

    async def create_conversation(self, body: dict[str, Any]) -> dict[str, Any]:
        data = await self._post("/v2/conversations", body)
        if not data.get("conversation_id") or not data.get("conversation_url"):
            raise TavusError(502, "create conversation returned no conversation_id / conversation_url")
        return data

    async def end_conversation(self, conversation_id: str) -> None:
        await self._post(f"/v2/conversations/{conversation_id}/end")

    async def delete_pal(self, pal_id: str) -> None:
        r = await self.client.delete(self.cfg.base_url + f"/v2/pals/{pal_id}", headers=self._headers(), timeout=30.0)
        if r.status_code >= 300 and r.status_code != 404:
            raise TavusError(r.status_code, _err(r))

    async def start_call(self, *, persona: dict[str, Any] | None, lang: str, photo_id: str | None,
                         llm_base_url: str, llm_token: str, tts: dict[str, Any] | None, context: str,
                         greeting: str | None, name: str) -> dict[str, Any]:
        """PAL -> conversation. The PAL is deleted again if the conversation cannot start."""
        face_id = self.cfg.face_for(photo_id)
        if not face_id:
            raise TavusError(400, "no face_id configured on the tavus avatar row (extra.face_id)")
        pal_id = await self.create_pal(pal_body(persona=persona, lang=lang, face_id=face_id,
                                                llm_base_url=llm_base_url, llm_token=llm_token, tts=tts))
        try:
            conv = await self.create_conversation(conversation_body(
                pal_id=pal_id, face_id=face_id, lang=lang, context=context, greeting=greeting,
                max_call_s=self.cfg.max_call_s, name=name))
        except Exception:
            try:
                await self.delete_pal(pal_id)
            except (TavusError, httpx.HTTPError):
                pass
            raise
        return {"pal_id": pal_id, "face_id": face_id, **conv}

    async def end_call(self, conversation_id: str | None, pal_id: str | None) -> None:
        if conversation_id:
            try:
                await self.end_conversation(conversation_id)
            except (TavusError, httpx.HTTPError):
                pass
        if pal_id:
            await self.delete_pal(pal_id)


def _err(r: httpx.Response) -> str:
    try:
        j = r.json()
        if isinstance(j, dict):
            return str(j.get("message") or j.get("error") or j)[:300]
    except ValueError:
        pass
    return r.text[:300] or f"HTTP {r.status_code}"
