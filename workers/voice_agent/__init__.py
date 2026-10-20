"""AcuDx voice agent (LiveKit Agents 1.8.x): STT -> gateway patient turn -> TTS, with an avatar renderer.

Import-safe modules (no livekit import at module load, so the gateway test suite can
cover them): ``config`` (what the admin registry resolved), ``selection`` (which
plugin classes a configuration maps to), ``gateway_patient`` (request shaping for
``POST /v1/patient/turn``). ``agent`` is the runnable entrypoint and needs the pinned
packages in ``requirements.txt``.
"""
