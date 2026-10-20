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

## 6. The realtime video path (LiveKit, self-hosted WebRTC, Tavus)

### 6.1 Configuration

One registry row of kind `avatar`: `base_url` is the LiveKit server over https (the gateway returns the `wss` form), `extra.transport: livekit`, `extra.livekit_api_key`, the sealed `api_key` is the LiveKit API secret, `extra.avatar` is the renderer (`simli`, `anam`, `musetalk`, `none`), `extra.renderer_api_key` and renderer options (`face_id` for Simli, `avatar_id` and `persona_name` for Anam, `runner_identity` for MuseTalk). Under `AIRGAPPED` a LiveKit Cloud URL is refused like any hosted row; a private LiveKit server (Apache-2.0, self-hosted) passes.

`POST /v1/voice/room` signs a 15-minute token (`iss` = API key, `sub` = identity, `video.roomJoin`, `room = acudx-<sha256(encounter_id)[:16]>`, per https://docs.livekit.io/home/server/generating-tokens/). Room names and identities never carry a learner name.

### 6.2 Agent worker

`workers/voice_agent` (pinned `livekit-agents==1.8.8`, `livekit-api==1.2.2`, plugins 1.8.8; verified on PyPI 2026-10-19, 2.0.0b1 exists but is a beta). `agent.py` builds `AgentSession(stt, tts, vad=silero.VAD.load(), turn_handling=TurnHandlingOptions(turn_detection=inference.TurnDetector(version="v1-mini")))`; `v1-mini` runs on CPU and covers 14 languages including Turkish (https://docs.livekit.io/agents/logic/turns/turn-detector/), replacing the deprecated text `MultilingualModel`. The patient "LLM" is `PatientAgent.llm_node`, which posts the last learner line to `POST /v1/patient/turn` (scope guard, persona, FactAssertionGate unchanged, document 03 section 14) and yields the utterance to TTS. `selection.plan()` maps the resolved rows to plugin classes (`deepgram.STT`, `elevenlabs.STT`, `openai.STT` for speaches; `elevenlabs.TTS`, `deepgram.TTS`, `openai.TTS` for Chatterbox) and the renderer to `simli.AvatarSession(SimliConfig)`, `anam.AvatarSession(PersonaConfig)` or a `DataStreamAudioOutput` aimed at the MuseTalk runner participant; the worker logs the plan with keys masked. Switching provider or renderer is a registry edit and a worker restart.

### 6.3 Self-hosted live video: LiveTalking + MuseTalk 1.5 on the GPU worker (shipped)

**Choice: direct WebRTC from the LiveTalking runner, signalled through the gateway, media relayed by coturn on the worker; not LiveKit.** LiveTalking already is a WebRTC server (aiortc, `POST /offer` JSON offer/answer, `POST /humanaudio` audio in, https://github.com/lipku/LiveTalking `docs/api.md`), so the shortest working path keeps its transport and puts the gateway in front of its control routes. LiveKit would add a server, an agent worker and a custom `AvatarRunner` port of the musetalk pipeline for the same browser result; the LiveKit path (6.1, 6.2) stays for hosted renderers (Simli, Anam). Signalling never exposes the worker bearer: the browser talks to `/v1/voice/avatar/*` only, and the gateway calls Caddy's `/avatar/*` with the bearer.

On the worker (`infra/gpu-worker/cloud-init.yaml`):

| piece | what | pin |
|---|---|---|
| `avatar` container | `acudx_avatar_server.py`, an aiohttp app around LiveTalking's `RTCManager`, `session_manager` and the musetalk avatar class; one shared model (fp16 UNet, VAE, whisper-tiny, S3FD face detector, BiSeNet face parser), per-call sessions (`AVATAR_MAX_SESSIONS=2`, batch 8 frames) | LiveTalking `c7269433a2b6ecebcd9342445d2ecc882c98b0da` (main, 2026-10-20, Apache-2.0), torch 2.9.1 cu128 on `python:3.12-slim-bookworm`, constraint file in the template |
| weights | `acudx_fetch_models.py` downloads by Hugging Face revision into the shared `HF_HOME` and links them where LiveTalking loads them | `TMElyralab/MuseTalk@2bcb936e` (`musetalkV15/unet.pth`, `musetalk.json`), `stabilityai/sd-vae-ft-mse@31f26fde`, `openai/whisper-tiny@169d4a43`, `ManyOtherFunctions/face-parse-bisent@0073b233` (sha256 checked), S3FD `s3fd-619a316812.pth` (sha256 prefix checked) |
| `turn` container | coturn, host network, `use-auth-secret`, relay ports 49160 to 49260 on the primary address, peers limited to the container network | `ghcr.io/coturn/coturn:4.18.0-debian` |
| `avatar.sh` | builds the image while vLLM loads, waits for vLLM health (or its exit) and Chatterbox health, reads `nvidia-smi`, starts `turn` + `avatar` only when `AVATAR_REQUIRED_MB` (5000) is free, writes `/avatar-status/status.json` (`building`, `waiting`, `starting`, `ready`, or `disabled` with `insufficient_vram`, `build_failed`, `start_timeout`) | |
| firewall | TURN 3478 UDP and TCP added to `WORKER_FIREWALL_RULES` (credentials required for every allocation) | |

The reference face is the case portrait (`web/public/patients/<photoId>.jpg`, the same `photoId` the tile shows): `PUT /avatar/avatars/acudx-<photoId>` runs face detection, crops the 256 x 256 mouth-and-jaw box, caches the VAE latents and the blend mask once per worker (`prepare_ms` in the session reply). The face is a single still frame, so only the lower face moves; the upstream `LiveTalking` corner mark that the runner draws on every frame is kept as attribution.

Per call: `POST /v1/voice/avatar/session` (portrait prepared, TURN REST credentials issued from `turn_secret(worker token)`), the browser's receive-only offer goes through `POST /v1/voice/avatar/offer`, and every patient line is spoken by `POST /v1/voice/avatar/speak`: the gateway synthesizes it with the normal TTS resolution (a hosted ElevenLabs row, else the worker's Chatterbox Multilingual), wraps raw PCM in WAV when needed, and posts it to the runner's `/humanaudio`. LiveTalking chunks it into 20 ms frames, computes whisper features, runs the UNet in batches of 8 and emits each video frame together with its two audio frames, so voice and lips leave on one synchronized WebRTC connection.

Measured live on 2026-10-20, browser in the sandbox reaching TURN through `scripts/turn_ws_tunnel.py` (capture, frames, MP4s and metrics.json in docs/media/live-avatar/):

| measure | value | how |
|---|---|---|
| card | H100 PCIe 80 GB (us-west-3) for the capture; A100-SXM4-40GB (us-east-1) for the 40 GB fit check | Lambda worker 3 and worker 2 of the private gateway |
| VRAM, 40 GB card | runner started with 7.2 GB free after vLLM (0.60), Chatterbox, speaches and Kokoro; runner torch reserved 3.0 GB idle | avatar.sh status and runner /health on worker 2, so the 5000 MB gate passes on an A100 40 GB |
| VRAM, runner | torch reserved 3.0 GB idle, 4.2 GB after a call; nvidia-smi delta at start 7.2 GB (an upper bound, Chatterbox was still allocating) | runner /health, avatar.sh |
| model load + warm-up | 54 s (CPU build check), weights from the HF cache | runner log |
| portrait preparation | 39 s on the first call of a fresh worker (face detector and parser warm-up), 0.5 s when already prepared, 6 to 12 s on CPU | session `prepare_ms` |
| inference | 35.6 frames per second (batch 8) on the H100 PCIe, output paced at 25 fps | LiveTalking "actual avg infer fps" via /health |
| SDP answer | 754 ms (H100 run), 388 to 456 ms (A100 runs) | offer sent -> answer, gateway proxied |
| first frame | 1957 ms (H100 run), 1280 to 1327 ms (A100 runs) | offer sent -> first decoded frame (requestVideoFrameCallback), through the TURN tunnel |
| patient reply TTS | 1412 ms (Kokoro on the worker, 6 s of speech) | `/speak` `tts_ms` |
| audio upload to runner | about 2.5 s for 300 KB of 24 kHz WAV | gateway log; the sandbox proxy uplink, a datacenter gateway is far faster |
| speech start | 8.7 s from the speak request to the first audible sample in the browser (includes TTS 1.4 s, upload 2.5 s, about 1.5 s of runner buffering, the tunnel) | in-page Web Audio on the remote track |
| audio-to-lip offset | -240 ms in the page (mouth leads the voice), -480 ms in the recorded stream (40 ms resolution) | cross-correlation of the remote audio envelope with mouth-box motion |
| audio delivered | totalAudioEnergy 0.215, 4.0 s voiced, peak RMS 0.105; 374 of 2834 frames carried sound, 0 blend errors | getStats inbound-rtp, recorded MP4, runner /health media counters |

Networks: a browser on an ordinary network uses `turn:<worker>:3478` over UDP (or TCP). This sandbox has no UDP egress and only HTTPS through a proxy, so the capture ran with `AVATAR_TURN_URLS=turn:127.0.0.1:3480?transport=tcp` and the tunnel script carrying TURN-over-TCP inside a WebSocket to the runner's `/avatar/turn` bridge; numbers through the tunnel include that extra hop. Institutions behind strict proxies need a TURN-over-TLS endpoint on 443 (a separate hostname or an SNI router in front of Caddy); that is not built yet.

### 6.5 Hosted live video: Tavus CVI (runs only when the owner adds a key)

`server/voice/avatar/tavus.py`, request shapes read from docs.tavus.io on 2026-10-20 (create PAL https://docs.tavus.io/api-reference/pals/create-pal, custom LLM https://docs.tavus.io/sections/conversational-video-interface/pal/llm, TTS layer https://docs.tavus.io/sections/conversational-video-interface/pal/tts, create conversation https://docs.tavus.io/api-reference/conversations/create-conversation, end conversation https://docs.tavus.io/api-reference/conversations/end-conversation, PAL-per-session strategy https://docs.tavus.io/sections/onboarding-guide/pal-strategies). Tavus renamed personas to PALs and replicas to faces; `/v2/personas` remains an alias.

* Registry row: kind `avatar`, name `tavus`, base URL `https://tavusapi.com`, the Tavus key in the write-only key field of `/admin/providers`, `extra.face_id` (a stock face, or one trained from a portrait with Create Face `train_image_url`), optional `extra.face_ids` `{photoId: face_id}`, optional `extra.public_base_url`. The gateway also needs `PUBLIC_BASE_URL`, its internet-reachable origin. The probe calls `GET /v2/pals?limit=1` with `x-api-key`.
* Per call: a PAL is created with `layers.llm = {model: "acudx-patient", base_url: <PUBLIC_BASE_URL>/v1/patient/openai, api_key: <per-call token>}`, perception off, and, when an ElevenLabs TTS row exists, `layers.tts = {tts_engine: "elevenlabs", api_key, external_voice_id, tts_model_name}` with the voice the gateway profile picks (else Tavus's own voice); then a conversation with `languages: [lang]`, `max_call_duration` 1200 s, captions on. The tile embeds `conversation_url`. Ending the call ends the conversation and deletes the PAL; a failed conversation deletes the PAL at once.
* `POST /v1/patient/openai/chat/completions` authenticates the per-call token (only its SHA-256 is stored), drops system and perception messages, takes the last user line and the prior dialogue, and runs the same `patient_turn` as the typed encounter (guard, persona, FactAssertionGate) with the call's stored case state; it streams SSE in sentence-sized deltas when asked.
* Cost: Tavus bills conversation minutes in 6 s increments with a 30 s minimum ($0.26 to $0.35 per minute self-serve, research 14 section 1.1).

### 6.4 Fallback ladder

Live video is tried in this order: a Tavus row, a LiveKit row, the GPU worker runner (capabilities `avatar.transport` tavus | livekit | webrtc, `live_video: true` only when a stream can be served now). The runner needs a ready worker, `/avatar/health` answering, the portrait prepared and a first frame within 30 s; a worker that is still booting reports `pending_launch` and the tile re-checks every 30 s. Any miss drops the tile to the local path (status text "Voice call" or "Text-timed animation"), the audio path drops hosted -> worker -> none, and the encounter always continues in text (document 03 invariant V-5).

## 7. The browser tile

`PatientCallTile` (mounted by `PatientPresence` in `InterviewTab`, right column at 1280 px and up, full width under 1024 px):

* live WebRTC video (self-hosted) when `avatar.transport` is `webrtc`: `lib/avatarCall.ts` opens a receive-only peer connection with the session's TURN servers (`iceTransportPolicy: relay`), the patient line of each turn is sent to `/v1/voice/avatar/speak`, voice and lip-synced face arrive on the same stream; the provenance line shows "First frame", "Speech start" and "Voice to lips" in ms; while connecting the status says "Connecting video" and the line under the tile says what the live path is doing (preparing the face, worker starting, unavailable);
* Tavus (`avatar.transport` `tavus`): the conversation room is embedded as an iframe with camera and microphone, Tavus listens and speaks, our gateway answers as the patient;
* the local path is labelled "Animated portrait, not live video" on the picture (`voice2.tile.notLive`), so the fallback is never mistaken for a stream;
* capabilities fetched once; LiveKit realtime when `avatar.transport` is `livekit` and a token is issued (dynamic `import("livekit-client")` 2.23.0, agent video and audio tracks attached, learner microphone published for the agent's STT);
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

* The runner is shipped and measured (section 6.3). Still open: SoulX-FlashHead Lite comparison (head motion and expression, not only lips); a TURN-over-TLS endpoint on 443 for learners behind HTTPS-only proxies; the 1.5 s runner buffering (LiveTalking queues two feature batches plus 16 rendered frames) and the voice leading the lips by 240 to 480 ms; the edge-replicate padding a close-up portrait needs (visible as streaks at the frame sides; MuseTalk's 1.5x blend box must fit inside the frame); a still single-frame face (only the lower face moves).
* Chatterbox Multilingual on the worker answers `/health` 200 with `"initialization_state": "error", "initialization_error": "'NoneType' object is not callable"` on 2026-10-20 (workers 2 and 3 of the avatar gateway); capabilities now read the body and report the worker TTS as down, and the capture used the worker's Kokoro (English) through a registry row. Turkish worker TTS needs that fixed.
* Tavus has not been exercised against the live API (no key in this environment); the request shapes are tested with respx against the documented contract.
* Turkish listening test of Chatterbox Multilingual against ElevenLabs on short clinical utterances (research 14 section 5.4 item 4); the bundled reference voice is a stand-in for consented actor recordings.
* Streaming STT through the gateway (websocket) for the dictation path; today the agent worker streams and the gateway transcribes whole clips.
* The console does not yet show the voice kinds' probe details or the `/v1/voice/capabilities` view; the data is there.
