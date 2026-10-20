"""The patient "LLM" is the gateway: every spoken learner turn becomes ``POST /v1/patient/turn``.

The gateway runs the scope guard, routes by class, calls the persona model through
the registry and applies the FactAssertionGate (server/app.py), so the agent never
imports a model SDK and never resolves a clinical fact (docs/architecture/03
section 14, boundary discipline). The response's ``utterance`` is what the TTS speaks.

The pure helpers (``latest_learner_message``, ``build_turn_request``,
``utterance_from_response``) are covered by the gateway test suite; ``PatientAgent``
needs ``livekit-agents`` and is imported only by ``agent.py``.
"""

from __future__ import annotations

from typing import Any, Iterable, Mapping

import httpx


def latest_learner_message(items: Iterable[Any]) -> str:
    """Text of the last user message in a chat context (items may be ChatMessage objects or dicts)."""
    last = ""
    for item in items:
        role = getattr(item, "role", None) if not isinstance(item, Mapping) else item.get("role")
        if role != "user":
            continue
        content = getattr(item, "content", None) if not isinstance(item, Mapping) else item.get("content")
        if isinstance(content, list):
            content = " ".join(str(c) for c in content if isinstance(c, str))
        if isinstance(content, str) and content.strip():
            last = content.strip()
    return last


def history_from_items(items: Iterable[Any], *, limit: int = 12) -> list[dict[str, str]]:
    """Alternating learner / patient turns in the gateway's ``history`` shape."""
    out: list[dict[str, str]] = []
    for item in items:
        role = getattr(item, "role", None) if not isinstance(item, Mapping) else item.get("role")
        content = getattr(item, "content", None) if not isinstance(item, Mapping) else item.get("content")
        if isinstance(content, list):
            content = " ".join(str(c) for c in content if isinstance(c, str))
        if role in ("user", "assistant") and isinstance(content, str) and content.strip():
            out.append({"role": role, "content": content.strip()})
    return out[-limit:]


def build_turn_request(learner_msg: str, *, case_state: Mapping[str, Any] | None, persona: Mapping[str, Any] | None,
                       history: list[dict[str, str]], locale: str) -> dict[str, Any]:
    return {"learner_msg": learner_msg, "case_state": dict(case_state or {}), "persona": dict(persona) if persona else None,
            "history": history, "locale": locale, "max_tokens": 160}


def utterance_from_response(payload: Mapping[str, Any]) -> str:
    text = str(payload.get("utterance") or "").strip()
    return text


class GatewayPatientClient:
    """Thin async client for ``POST {gateway}{patient_turn_path}``."""

    def __init__(self, gateway_url: str, patient_turn_path: str, *, encounter_id: str | None = None,
                 client: httpx.AsyncClient | None = None):
        self.url = gateway_url.rstrip("/") + patient_turn_path
        self.encounter_id = encounter_id
        self._client = client or httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=5.0))

    async def turn(self, body: Mapping[str, Any]) -> dict[str, Any]:
        headers = {"X-Encounter-Id": self.encounter_id} if self.encounter_id else {}
        resp = await self._client.post(self.url, json=dict(body), headers=headers)
        resp.raise_for_status()
        return resp.json()

    async def aclose(self) -> None:
        await self._client.aclose()


def make_patient_agent(client: GatewayPatientClient, *, case_state: Mapping[str, Any] | None,
                       persona: Mapping[str, Any] | None, locale: str, instructions: str):
    """Build the ``Agent`` subclass lazily so this module stays import-safe without livekit."""
    from livekit.agents import Agent, ModelSettings, llm  # noqa: PLC0415

    class PatientAgent(Agent):
        async def llm_node(self, chat_ctx: llm.ChatContext, tools, model_settings: ModelSettings):
            items = list(chat_ctx.items)
            learner_msg = latest_learner_message(items)
            if not learner_msg:
                return
            body = build_turn_request(learner_msg, case_state=case_state, persona=persona,
                                      history=history_from_items(items[:-1]), locale=locale)
            payload = await client.turn(body)
            text = utterance_from_response(payload)
            if text:
                yield text

    return PatientAgent(instructions=instructions)
