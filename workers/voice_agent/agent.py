"""Runnable LiveKit Agents worker: ``python -m workers.voice_agent.agent dev``.

Cascade per docs/architecture/03 and 18: Silero VAD + LiveKit audio turn detector
(``v1-mini`` runs on CPU and covers Turkish) -> STT plugin -> ``PatientAgent.llm_node``
(gateway ``POST /v1/patient/turn``) -> TTS plugin -> room, or to the avatar renderer
when one is configured (``AvatarSession`` for Simli / Anam, ``DataStreamAudioOutput``
for the self-hosted MuseTalk runner). Everything is chosen from the admin registry
through ``GET /admin/voice/agent-config``; nothing here hardcodes a vendor.

Job metadata (set by the browser when it requests a room through
``POST /v1/voice/room``, see ``server/voice/routes.py``) carries ``encounter_id``;
``case_state`` / ``persona`` arrive through participant attributes ``acudx.case_state``
and ``acudx.persona`` (JSON) published by the EHR client on join.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any

from workers.voice_agent.config import AgentConfig, load_config
from workers.voice_agent.gateway_patient import GatewayPatientClient, make_patient_agent
from workers.voice_agent.selection import build_avatar, build_stt, build_tts, plan

log = logging.getLogger("acudx.voice_agent")

INSTRUCTIONS = ("You are a simulated patient in a medical education encounter. Speak as the patient only; "
                "the gateway decides every clinical fact.")


def _participant_json(participant: Any, key: str) -> dict[str, Any] | None:
    attrs = getattr(participant, "attributes", None) or {}
    raw = attrs.get(key)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return None


async def run_session(ctx: Any, cfg: AgentConfig) -> None:
    from livekit.agents import AgentSession, RoomInputOptions, RoomOutputOptions, TurnHandlingOptions, inference  # noqa: PLC0415
    from livekit.plugins import silero  # noqa: PLC0415

    await ctx.connect()
    participant = await ctx.wait_for_participant()
    case_state = _participant_json(participant, "acudx.case_state") or {}
    persona = _participant_json(participant, "acudx.persona")
    sex = str((persona or {}).get("sex") or case_state.get("sex") or "female").lower()
    meta: dict[str, Any] = {}
    try:
        meta = json.loads(ctx.job.metadata or "{}")
    except ValueError:
        pass
    encounter_id = meta.get("encounter_id") or case_state.get("encounter_id")

    log.info("voice agent plan: %s", json.dumps(plan(cfg, sex=sex)))
    gateway = GatewayPatientClient(cfg.gateway_url, cfg.patient_turn_path, encounter_id=encounter_id)
    session = AgentSession(
        stt=build_stt(cfg),
        tts=build_tts(cfg, sex=sex),
        vad=silero.VAD.load(),
        turn_handling=TurnHandlingOptions(turn_detection=inference.TurnDetector(version="v1-mini")),
    )
    avatar = build_avatar(cfg, room=ctx.room)
    audio_enabled = True
    if avatar is not None and hasattr(avatar, "start"):
        # Simli / Anam: the renderer joins as a second participant and publishes synced audio + video.
        await avatar.start(session, room=ctx.room)
        try:
            await avatar.wait_for_join()
        except asyncio.TimeoutError:
            log.warning("avatar renderer did not join in time; continuing audio-only")
        else:
            audio_enabled = False
    elif avatar is not None:
        # MuseTalk / LiveTalking runner: route the agent audio to the renderer participant.
        session.output.audio = avatar
        audio_enabled = False

    agent = make_patient_agent(gateway, case_state=case_state, persona=persona, locale=cfg.language,
                               instructions=INSTRUCTIONS)
    await session.start(
        agent=agent,
        room=ctx.room,
        room_input_options=RoomInputOptions(),
        room_output_options=RoomOutputOptions(audio_enabled=audio_enabled, transcription_enabled=True),
    )


def main() -> None:
    from livekit.agents import AgentServer, JobContext, cli  # noqa: PLC0415

    cfg = asyncio.run(load_config())
    if not cfg.complete:
        missing = [k for k, v in (("stt", cfg.stt), ("tts", cfg.tts), ("livekit", cfg.livekit)) if v is None]
        raise SystemExit(f"voice agent cannot start: missing {missing}; configure them under /admin/providers")
    os.environ.setdefault("LIVEKIT_URL", cfg.livekit.url)          # type: ignore[union-attr]
    os.environ.setdefault("LIVEKIT_API_KEY", cfg.livekit.api_key)  # type: ignore[union-attr]
    os.environ.setdefault("LIVEKIT_API_SECRET", cfg.livekit.api_secret)  # type: ignore[union-attr]

    server = AgentServer()

    @server.rtc_session(agent_name=os.environ.get("ACUDX_AGENT_NAME", "acudx-patient"))
    async def entrypoint(ctx: JobContext) -> None:
        await run_session(ctx, cfg)

    cli.run_app(server)


if __name__ == "__main__":
    main()
