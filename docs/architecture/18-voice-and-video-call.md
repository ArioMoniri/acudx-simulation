# 18. Voice and the patient video call

Status: implemented (server/voice, workers/voice_agent, web/src/components/ehr/PatientCallTile.tsx, infra/gpu-worker). Owner: AI engineer. Related: 03 (voice pipeline design), 12 (air-gapped reference), 17 (provider registry and telemetry), research 14 (vendor survey, prices, open models, 2026-10-19).

## 1. What changed

Before this wave the dev server carried an ElevenLabs key and two vendor-specific middlewares (`/tts`, `/stt`) in `web/vite.config.ts`, the browser hardwired four ElevenLabs voice ids, and the talking head was animated from text timing. Now:

* every voice call goes through the gateway (`/v1/voice/*`), which resolves the provider from the admin registry (document 17) with the same priority order, air-gap guard, probe awareness and on-demand GPU worker fallback the LLM uses;
* Turkish is served end to end: ElevenLabs Flash v2.5 / v4 Turbo and Deepgram Nova-3 when hosted rows exist, Chatterbox Multilingual and faster-whisper large-v3-turbo on the GPU worker otherwise, and nothing hosted under `AIRGAPPED=true`;
* the patient is a call participant: a LiveKit room with an avatar renderer when an `avatar` row is configured, else the bundled talking-head clip driven by the actual audio through a Web Audio analyser;
* every TTS and STT call writes a telemetry row with a cost from a sourced price table.

## 2. Components

```
server/voice/base.py            TtsRequest / TtsStream / SttRequest / SttResult, adapter protocols, wav_duration_ms
server/voice/adapters/          elevenlabs (TTS stream + Scribe), deepgram (Nova-3 prerecorded + Aura-2), openai_compatible
server/voice/profiles.py        sex + age band + language -> voice id, overridable per row (extra.voices)
server/voice/service.py         VoiceService: candidates, language skipping, worker fallback, telemetry rows
server/voice/livekit.py         room tokens (livekit-api when installed, stdlib HS256 otherwise), opaque room names
server/voice/routes.py          /v1/voice/tts, /v1/voice/stt, /v1/voice/capabilities, /v1/voice/room, /admin/voice/agent-config
server/voice/avatar/            live patient video: sessions (case state per call), musetalk (GPU worker runner client,
                                TURN REST credentials), tavus (Tavus CVI PAL + conversation), routes (/v1/voice/avatar/*,
                                /v1/patient/openai/chat/completions)
server/registry/resolve.py      endpoints(kind), resolve_worker(kind) for llm | tts | stt (worker /v1, /tts, /stt)
server/telemetry/prices.py      VOICE_PRICE_TABLE (per 1k chars, per minute) + voice_cost_usd
workers/voice_agent/            LiveKit Agents 1.8.8 worker: config, plugin selection, gateway patient turn, agent entrypoint
infra/gpu-worker/cloud-init.yaml  vLLM + Chatterbox Multilingual (built from a pinned commit) + Kokoro + speaches behind Caddy,
                                plus the avatar runner (LiveTalking + MuseTalk 1.5, built from a pinned commit) and coturn
scripts/turn_ws_tunnel.py       TURN-over-TCP through a WebSocket, for test harnesses whose only egress is an HTTPS proxy
web/src/lib/avatarCall.ts       receive-only WebRTC call, first frame, speech start, audio-to-lip lag (cross-correlation)
web/e2e/capture/live-avatar.mjs the live capture behind docs/media/live-avatar/
web/src/lib/voiceApi.ts         typed client, streaming playback (MediaSource or chunked blob), first-audio latency
web/src/lib/audioLipsync.ts     AnalyserNode RMS -> jaw envelope -> MouthShape; overlay geometry
web/src/lib/tts.ts, stt.ts      same exported names as before, internals call /api/v1/voice/*
web/src/components/ehr/PatientCallTile.tsx  the call tile (mute, hold, end, captions, symptom overlay)
web/src/i18n/features/voice2.{en,tr}.json
```

## 3. HTTP surface

| method | path | body / form | result |
|---|---|---|---|
| POST | /v1/voice/tts | `{text (<=1200), lang, sex, age, voice_id?, format: mp3|wav, speed}` | chunked `audio/mpeg` or `audio/wav`; headers `X-Voice-Provider`, `X-Voice-Adapter`, `X-Voice-Model`, `X-Voice-Source` (registry | gpu_worker), `X-Voice-Id`, `X-Voice-TTFB-Ms`, `X-Audio-Duration-Ms` when known (WAV header or vendor metadata) |
| POST | /v1/voice/stt | multipart `file` (+ `lang`) | `{text, language, confidence, provider, adapter, model, source, audio_seconds, latency_ms}` |
| GET | /v1/voice/capabilities | | `{airgapped, tts, stt, avatar, gpu_worker}`; each engine block has `enabled, provider, source, adapter, model, languages, reasons, pending_launch?` |
| POST | /v1/voice/room | `{encounter_id, identity?, name?}` | `{url (wss), token, room, identity, renderer, ttl_s}`; 404 when no LiveKit avatar row is eligible |
| GET | /admin/voice/agent-config | `X-Admin-Token` | resolved stt / tts / avatar / livekit blocks with decrypted keys, for the agent worker only |
| POST | /v1/voice/avatar/session | `{encounter_id, photo_id, lang, sex, age, case_state, persona, case_context, provider?: auto|musetalk|tavus}` (signed in) | musetalk: `{session_id, transport: "webrtc", ice_servers, ice_transport_policy: "relay", prepare_ms, worker}`; tavus: `{session_id, transport: "tavus", conversation_url}`; 503 `{error: "avatar_unavailable", state, reasons[], pending_launch?}` |
| POST | /v1/voice/avatar/offer | `{session_id, sdp, type: "offer"}` | `{sdp, type: "answer", answer_ms}` (SDP proxied to the worker runner; the bearer stays server-side) |
| POST | /v1/voice/avatar/speak | `{session_id, text}` | gateway TTS (registry row or worker Chatterbox) -> runner audio in; `{provider, model, voice_id, tts_ms, queued_ms, audio_bytes, audio_duration_ms}` |
| POST | /v1/voice/avatar/interrupt, /end | `{session_id}` | stop the current line / end the call (runner session closed, or Tavus conversation ended and its PAL deleted) |
| POST | /v1/patient/openai/chat/completions | OpenAI chat body, `Authorization: Bearer <per-call token>` | OpenAI `chat.completion` (or SSE chunks when `stream`): `/v1/patient/turn` with the call's stored case state, so the guard, persona and FactAssertionGate run on every Tavus turn; header `X-AcuDx-Routed-As` |

503 `{error: "<kind>_unavailable", airgapped, reasons[]}` when nothing can serve. The reasons name every refused row ("eleven: refused by AIRGAPPED (non-local https://api.elevenlabs.io)") and the worker refusal (`gpu-worker: airgapped | not_configured | budget_exceeded | no_capacity`), so the console and the tile can say why.

## 4. Resolution and providers

### 4.1 Order of attempts

1. `RegistryResolver.endpoints(kind)`: enabled rows of kind `tts` or `stt` by `priority, id`; under `AIRGAPPED` non-local rows are refused; rows with a failed last probe are skipped.
2. Per row the adapter is `extra.adapter` when set, else inferred from the host (`*.elevenlabs.io`, `*.deepgram.com`), else `openai_compatible`. An adapter that cannot speak the requested language (Deepgram Aura-2 has no Turkish; ElevenLabs Flash v2 is English only) is skipped without a network call, and an upstream failure moves to the next row (recorded as a failed telemetry row).
3. `RegistryResolver.resolve_worker(kind)`: `ensure_worker()` launches or reuses the Lambda worker and maps the kind onto its route (`/tts`, `/stt`) behind the worker's bearer token. `WorkerRefused` yields nothing and the reason is surfaced. Capabilities never launch a worker; they report `pending_launch: true` when one could be launched.

### 4.2 Request shapes (verified against the vendor docs on 2026-10-19)

* ElevenLabs TTS: `POST /v1/text-to-speech/{voice_id}/stream?output_format=mp3_44100_128`, header `xi-api-key`, body `{text, model_id, language_code, voice_settings}` (https://elevenlabs.io/docs/api-reference/text-to-speech/stream). Default `model_id` is `eleven_flash_v2_5` (32 languages including `tr`, about 75 ms, $0.04 per 1k chars); set `extra.model_id` to `eleven_v4_turbo` (90+ languages, about 100 ms, $0.04) or `eleven_multilingual_v2` ($0.08). Model ids from https://elevenlabs.io/docs/overview/models.
* ElevenLabs STT: `POST /v1/speech-to-text` multipart `model_id` (default `scribe_v2`, `extra.stt_model_id`), `file`, `language_code` (https://elevenlabs.io/docs/api-reference/speech-to-text/convert). `language_probability` is reported as the confidence.
* Deepgram STT: `POST /v1/listen?model=nova-3&language=tr&smart_format=true` with the raw clip as the body and `Authorization: Token` (https://developers.deepgram.com/reference/speech-to-text/listen-pre-recorded); `extra.keyterms` becomes repeated `keyterm` parameters. Nova-3 lists `tr` and `tr-TR` (https://developers.deepgram.com/docs/models-languages-overview). Streaming over the websocket is done by the LiveKit agent's Deepgram plugin, which owns the microphone stream; the gateway serves the request/response dictation path.
* Deepgram TTS: `POST /v1/speak?model=aura-2-thalia-en&encoding=mp3` body `{text}` (https://developers.deepgram.com/reference/text-to-speech/speak-request); Aura speaks en, es, de, nl, fr, it, ja only (https://developers.deepgram.com/docs/tts-models).
* OpenAI-compatible: `POST {base}/v1/audio/speech` `{model, input, voice, response_format, speed}` and `POST {base}/v1/audio/transcriptions` multipart `file, model, language, response_format=verbose_json` (https://platform.openai.com/docs/api-reference/audio). `extra.tts_body` merges vendor fields (Chatterbox `exaggeration`, `cfg_weight`); `extra.audio_path` relocates `/v1/audio`. Whisper-style `segments[].avg_logprob` is folded into a confidence (`exp(mean)`).

### 4.3 Voice profiles

`server/voice/profiles.py` maps `(sex, age band, lang)` to a voice id. Bands: child (< 13), adult, older (55 and up; the former web cut). Defaults: the ElevenLabs premade ids the browser used to hardwire (Rachel, Dorothy, Josh, Adam), Chatterbox library names `acudx_{tr|en}_{female|male}` that `cloud-init.yaml` uploads at boot with language metadata, Kokoro English voices, Aura-2 English voices. Operators override through `extra.voices` on the row, matched `"<sex>.<band>.<lang>"`, `"<sex>.<lang>"`, `"<sex>.<band>"`, `"<sex>"`, `"default"`; `extra.voice_family: kokoro` switches the default table for an OpenAI-compatible server. Institutions that record consented voice actors upload them to the worker with `POST /voices` (voice name, `language`, file) and point `extra.voices` at the names; the bundled reference clip is a stand-in, not a persona library (document 03 section 8.1 still owns the consent requirements).

## 5. GPU worker (self-hosted, air-gap capable)

`infra/gpu-worker/cloud-init.yaml` now runs four services behind Caddy on `<ip>.sslip.io`, every route needing `Authorization: Bearer <token>`:

| route | service | image / build | note |
|---|---|---|---|
| `/v1/*` | vLLM | `vllm/vllm-openai:v0.11.0` | `--gpu-memory-utilization 0.60` (was 0.72) to leave room for the voice side-cars |
| `/tts/*` | Chatterbox Multilingual TTS API | built from `travisvn/chatterbox-tts-api` commit `a5f466128e4baa8e4cceb3bba9b7ca9de6f7ec6b` (main, 2026-10-19) with `docker/Dockerfile.uv.gpu`, `USE_MULTILINGUAL_MODEL=true` | Docker Hub `travisvn/chatterbox-tts-api` tags (`v1.0.1`, `latest`, `gpu`) all date from 2025-06-03, before the multilingual model, so no published image was usable; GHCR has no package. 23 languages including `tr`; the voice name carries the language (`docs/MULTILINGUAL.md`), so `seed-voices.sh` uploads `acudx_tr_*` and `acudx_en_*` once the API is healthy |
| `/tts-en/*` | Kokoro FastAPI | `ghcr.io/remsky/kokoro-fastapi-gpu:v0.2.4` | English-only secondary (fast utility lines); add a registry row with `extra.voice_family: kokoro` to use it |
| `/stt/*` | speaches | `ghcr.io/speaches-ai/speaches:0.8.3-cuda` | `PRELOAD_MODELS=["deepdml/faster-whisper-large-v3-turbo-ct2"]`, `STT_MODEL_TTL=-1`, fp16 |

VRAM budget on one A100 40 GB (planning numbers from research 14 section 2.2): vLLM 24 GB at 0.60, Chatterbox about 4 GB, speaches about 3 GB, Kokoro under 1 GB, about 8 GB headroom for CUDA context, batching and one MuseTalk stream. On an H100 80 GB raise vLLM to 0.75. `WorkerRecord.public()` already exposes `tts_url` and `stt_url`; the resolver builds the same URLs from the worker's domain.

## 6. The realtime video path (LiveKit)

### 6.1 Configuration

One registry row of kind `avatar`: `base_url` is the LiveKit server over https (the gateway returns the `wss` form), `extra.transport: livekit`, `extra.livekit_api_key`, the sealed `api_key` is the LiveKit API secret, `extra.avatar` is the renderer (`simli`, `anam`, `musetalk`, `none`), `extra.renderer_api_key` and renderer options (`face_id` for Simli, `avatar_id` and `persona_name` for Anam, `runner_identity` for MuseTalk). Under `AIRGAPPED` a LiveKit Cloud URL is refused like any hosted row; a private LiveKit server (Apache-2.0, self-hosted) passes.

`POST /v1/voice/room` signs a 15-minute token (`iss` = API key, `sub` = identity, `video.roomJoin`, `room = acudx-<sha256(encounter_id)[:16]>`, per https://docs.livekit.io/home/server/generating-tokens/). Room names and identities never carry a learner name.

### 6.2 Agent worker

`workers/voice_agent` (pinned `livekit-agents==1.8.8`, `livekit-api==1.2.2`, plugins 1.8.8; verified on PyPI 2026-10-19, 2.0.0b1 exists but is a beta). `agent.py` builds `AgentSession(stt, tts, vad=silero.VAD.load(), turn_handling=TurnHandlingOptions(turn_detection=inference.TurnDetector(version="v1-mini")))`; `v1-mini` runs on CPU and covers 14 languages including Turkish (https://docs.livekit.io/agents/logic/turns/turn-detector/), replacing the deprecated text `MultilingualModel`. The patient "LLM" is `PatientAgent.llm_node`, which posts the last learner line to `POST /v1/patient/turn` (scope guard, persona, FactAssertionGate unchanged, document 03 section 14) and yields the utterance to TTS. `selection.plan()` maps the resolved rows to plugin classes (`deepgram.STT`, `elevenlabs.STT`, `openai.STT` for speaches; `elevenlabs.TTS`, `deepgram.TTS`, `openai.TTS` for Chatterbox) and the renderer to `simli.AvatarSession(SimliConfig)`, `anam.AvatarSession(PersonaConfig)` or a `DataStreamAudioOutput` aimed at the MuseTalk runner participant; the worker logs the plan with keys masked. Switching provider or renderer is a registry edit and a worker restart.

### 6.3 Self-hosted renderer: LiveTalking + MuseTalk through AvatarRunner

Not shipped as code (no GPU benchmark yet, research 14 section 5.4 item 3); the code path that consumes it is (`extra.avatar: musetalk`). Exact steps on the GPU worker:

1. Clone https://github.com/lipku/LiveTalking (Apache-2.0) and download the MuseTalk 1.5 weights per its README (`sh inference.sh v1.5 realtime` in MuseTalk needs the same files); prepare one avatar per patient portrait from the bundled talk clips (`web/public/patients/talk/<id>.mp4`) with MuseTalk `preparation: True`, which caches the face latents (3080 Ti class minimum per the LiveTalking README; the A100 fits 2 to 3 streams in the headroom above).
2. Write the runner as a LiveKit custom avatar worker: a Python process that joins the room with identity `acudx-avatar-runner` (token from `server/voice/livekit.py::sign_token`), receives the agent's audio through `livekit.agents.voice.avatar.DataStreamAudioReceiver`, feeds 16 kHz PCM into LiveTalking's musetalk pipeline (`--model musetalk --transport` custom; the aiortc WebRTC transport is replaced by publishing frames with `rtc.VideoSource` / `rtc.LocalVideoTrack`), and runs `AvatarRunner(room, audio_recv=..., video_gen=..., options=AvatarOptions(video_width=..., video_height=..., video_fps=25, audio_sample_rate=16000, audio_channels=1))` (https://docs.livekit.io/agents/models/avatar/#custom-avatar-workers and the `livekit.agents.voice.avatar` reference). Set the participant attribute `lk.publish_on_behalf=<agent identity>` so the browser pairs the tracks.
3. Dispatch: start the runner per room from the agent (`rtc_session` receives the room name) or run it as its own LiveKit agent with `agent_name=acudx-avatar-runner` and explicit dispatch; the agent side (`selection.plan_avatar`) already routes audio with `DataStreamAudioOutput(destination_identity=runner_identity, wait_playback_start=True)`.
4. Measure before enabling for a cohort: concurrent 25 fps streams, first-frame latency, VRAM, and compare with SoulX-FlashHead Lite (research 14 section 2.1). Record the numbers in research 14 section 5.4.

### 6.4 Fallback ladder

Realtime video needs an avatar row, a room token and a renderer video track within `wait_for_join()`; any miss drops the tile to the local path (status text "Voice call" or "Text-timed animation"), the audio path drops hosted -> worker -> none, and the encounter always continues in text (document 03 invariant V-5).

## 7. The browser tile

`PatientCallTile` (mounted by `PatientPresence` in `InterviewTab`, right column at 1280 px and up, full width under 1024 px):

* capabilities fetched once; realtime when `avatar.enabled` and a token is issued (dynamic `import("livekit-client")` 2.23.0, agent video and audio tracks attached, learner microphone published for the agent's STT);
* local path: `speakAsPatient` streams `/api/v1/voice/tts` into the shared unlocked `<audio>` (MediaSource for MP3, chunked blob for WAV), `createAnalyserEnvelope` samples RMS at about 25 fps, `envelopeToJaw` smooths it (fast attack, slow release) and `amplitudeToViseme` picks a `MouthShape`; the talking-head clip plays while the audio plays (`speaking` tied to playback) and a translucent mouth overlay follows the envelope. First-audio latency (request sent -> `playing` event) is shown in the provenance line next to the provider name;
* controls: mute (element and remote audio muted, face keeps moving), hold (pause and resume), end / rejoin, captions (last learner line, last patient line, `aria-live`); symptom overlay from `SymptomSummary` on the live vitals, physiology tint through `PatientPhoto`;
* reduced motion: overlay hidden, clip still (PatientPhoto behaviour), status text carries the state; strings in `voice2.{en,tr}.json`.

## 8. Telemetry and cost

`VoiceService` writes one `model_calls` row per attempt with `kind` `tts` or `stt`, `provider` the row name, `model` the served model, `tokens_in` the billed unit (characters for TTS, whole audio seconds for STT), `latency_ms` (TTS: request to end of stream; STT: round trip) and `cost_usd` from `prices.voice_cost_usd`. Rows: ElevenLabs Flash/Turbo v2.5 and v4 Turbo $0.04 per 1k chars, Multilingual v2 / v3 / v4 $0.08, Scribe v2 $0.22 per hour, Scribe v2 realtime $0.39 per hour (https://elevenlabs.io/pricing/api); Deepgram Nova-3 $0.0048 per minute monolingual, $0.0058 multilingual, Aura-2 $0.030 per 1k chars (https://deepgram.com/pricing). Worker calls cost 0 here (the GPU hour is in `gpu_ledger`). `TelemetryRecorder.record` accepts `cost_usd` for these unit-priced calls; the OTel span names are `gen_ai.text_to_speech` and `gen_ai.speech_to_text`.

## 9. Tests

* `server/tests/test_voice_adapters.py`: request shapes and response parsing for every adapter (respx for hosted vendors, the in-process worker double `server/tests/voice_double.py` for OpenAI-compatible), WAV duration, auth failures, language refusals.
* `server/tests/test_voice_service.py`: priority order, language skipping and failover, AIRGAPPED refusal of hosted rows and of the cloud worker, local allow-listed row under AIRGAPPED, worker fallback for tts and stt with zero-cost rows, capabilities (hosted, pending worker, avatar).
* `server/tests/test_voice_routes.py`: streaming headers, body validation, 503 with reasons, multipart STT, capabilities, room tokens (claims, opaque room, LiveKit Cloud refused under AIRGAPPED), admin agent config guard, main app mounts.
* `server/tests/test_voice_profiles.py`: age bands, defaults, overrides, voice price rows, token signature.
* `server/tests/test_voice_agent_config.py`: worker config parsing (gateway reply, env), plugin plan without leaking keys, MuseTalk routing, gateway patient turn helpers and client.
* `web/src/lib/voiceApi.test.ts`, `web/src/lib/audioLipsync.test.ts`: body shaping, header parsing, playback strategy, client calls, RMS, envelope, viseme mapping, overlay geometry.

## 10. Operations

1. Add rows under `/admin/providers`: kind `tts` (ElevenLabs with `extra.model_id`, or the worker is used automatically), kind `stt` (Deepgram Nova-3), optional kind `avatar` (LiveKit transport, renderer and keys). Press Probe.
2. Air-gapped pods: leave `AIRGAPPED=true`; `GET /v1/voice/capabilities` lists every refused row by name; add an on-prem OpenAI-compatible row (Chatterbox, speaches) with its host in `LOCAL_ALLOWLIST`.
3. Start the agent worker only when an avatar row exists (`workers/voice_agent/README.md`); the tile works without it.
4. Watch `/admin/telemetry/summary` by kind `tts` / `stt` for cost and p95; a failed hosted row shows as `ok = 0` with the error type.

## 11. Open items

* Benchmark MuseTalk/LiveTalking and SoulX-FlashHead on the A100 and ship the runner (section 6.3).
* Turkish listening test of Chatterbox Multilingual against ElevenLabs on short clinical utterances (research 14 section 5.4 item 4); the bundled reference voice is a stand-in for consented actor recordings.
* Streaming STT through the gateway (websocket) for the dictation path; today the agent worker streams and the gateway transcribes whole clips.
* The console does not yet show the voice kinds' probe details or the `/v1/voice/capabilities` view; the data is there.
