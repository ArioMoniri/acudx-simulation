# AcuDx voice agent worker

LiveKit Agents 1.8.8 worker that turns the patient into a video-call participant:
Silero VAD and the LiveKit audio turn detector (`v1-mini`, CPU, Turkish included)
feed the resolved STT plugin, the learner's turn goes to the gateway
(`POST /v1/patient/turn`, scope guard and FactAssertionGate included), the reply is
spoken by the resolved TTS plugin, and an avatar renderer (Simli, Anam, or the
self-hosted MuseTalk runner) publishes synced video when one is configured.

Everything is selected from the admin registry (`/admin/providers`), fetched once at
start through `GET /admin/voice/agent-config`. Design and the MuseTalk steps:
`docs/architecture/18-voice-and-video-call.md`.

```
python -m venv .venv-agent
.venv-agent/bin/pip install -r workers/voice_agent/requirements.txt
export ACUDX_GATEWAY_URL=http://127.0.0.1:8890 ADMIN_TOKEN=...   # same token as the admin console
.venv-agent/bin/python -m workers.voice_agent.agent download-files   # Silero + turn detector weights
.venv-agent/bin/python -m workers.voice_agent.agent dev
```

Without an admin token the worker reads `LIVEKIT_URL`, `LIVEKIT_API_KEY`,
`LIVEKIT_API_SECRET`, `DEEPGRAM_API_KEY` or `ACUDX_STT_BASE_URL`, `ELEVEN_API_KEY` or
`ACUDX_TTS_BASE_URL`, `ACUDX_AVATAR` (`none|simli|anam|musetalk`) and
`ACUDX_AVATAR_OPTIONS` (JSON) from the environment.

Under `AIRGAPPED=true` the gateway resolves only local rows (self-hosted LiveKit,
the GPU worker's Chatterbox and speaches, the MuseTalk runner), so the worker
inherits the same zero-egress posture.
