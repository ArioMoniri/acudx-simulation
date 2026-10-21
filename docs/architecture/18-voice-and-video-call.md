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
web/e2e/capture/live-avatar.mjs the live capture behind docs/media/live-avatar/{en,tr}/ (LANG_UI=en|tr)
web/e2e/capture/live-avatar-concurrency.mjs  N simultaneous calls speaking at once, per-call runner numbers, lip-sync rounds
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
| POST | /v1/voice/avatar/speak | `{session_id, text}` | gateway TTS (registry row or worker Chatterbox, streamed) -> PCM chunks over the call's WebSocket to the runner as they arrive; `{provider, model, voice_id, transport: "stream", tts_ms, first_chunk_ms, stream_ms, audio_bytes, audio_duration_ms, sample_rate, link_connect_ms, runner: {frames, first_frame_ms, elapsed_ms}}`; MP3-only providers take the whole-file `/humanaudio` path |
| GET | /admin/gpu/turn-check | `X-Admin-Token` | the runner's own TURN Allocate on UDP 3478, TCP 3478 and TLS 443 (`turns:turn.<domain>`, certificate and host name verified) |
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

`infra/gpu-worker/cloud-init.yaml` now runs four services behind Caddy on `<ip>.sslip.io`, every route needing `Authorization: Bearer <token>`. Public 443 is an nginx stream SNI router (`edge`, `nginx:1.30.6-alpine`, `edge.conf`): the server name `turn.<domain>` goes to coturn's TLS listener (section 6.3.4), everything else, and every ACME `acme-tls/1` challenge, to Caddy on `127.0.0.1:8443` (`https_port 8443`, `alt_tlsalpn_port 8443`, HTTP/3 off).

| route | service | image / build | note |
|---|---|---|---|
| `/v1/*` | vLLM | `vllm/vllm-openai:v0.11.0` | `--gpu-memory-utilization 0.60` (was 0.72) to leave room for the voice side-cars; 0.50 on single cards under 70 GB so the image edit server fits next to the runner (section 6.6) |
| `/tts/*` | Chatterbox Multilingual TTS API | built from `travisvn/chatterbox-tts-api` commit `a5f466128e4baa8e4cceb3bba9b7ca9de6f7ec6b` (main, 2026-10-19) with `docker/Dockerfile.uv.gpu`, `USE_MULTILINGUAL_MODEL=true` | Docker Hub `travisvn/chatterbox-tts-api` tags (`v1.0.1`, `latest`, `gpu`) all date from 2025-06-03, before the multilingual model, so no published image was usable; GHCR has no package. 23 languages including `tr`; the voice name carries the language (`docs/MULTILINGUAL.md`), so `seed-voices.sh` uploads `acudx_tr_*` and `acudx_en_*` from inside the container once the model reports `initialization_state: ready`, then streams one warm-up line per seeded voice. `setuptools` is pinned to 80.9.0 (section 6.3.1). The AcuDx patch caches voice conditionals, serialises `generate`, sends the first clause as its own chunk and folds one-word chunks; a second replica `chatterbox2` runs on 80 GB cards (section 6.3.8) |
| `/tts-en/*` | Kokoro FastAPI | `ghcr.io/remsky/kokoro-fastapi-gpu:v0.2.4` | English-only secondary (fast utility lines); add a registry row with `extra.voice_family: kokoro` to use it. Two replicas behind `least_conn` (section 6.3.8) |
| `/stt/*` | speaches | `ghcr.io/speaches-ai/speaches:0.8.3-cuda` | `PRELOAD_MODELS=["deepdml/faster-whisper-large-v3-turbo-ct2"]`, `STT_MODEL_TTL=-1`, fp16 |
| `/imagegen/*` | AcuDx image edit server | FLUX.2 [klein] 4B, Apache-2.0, `black-forest-labs/FLUX.2-klein-4B@e7b7dc27`, diffusers 0.40.0 on torch 2.9.1 cu128 (other packages resolved by uv as of 2026-09-01) | per-case patient appearance (section 6.6); `POST /edit {image_b64, prompt, seed, steps}` -> JPEG; mode `gpu` (whole model on the card, 20 GB free), `offload` (model CPU offload, 9 GB) or `sequential` (layer by layer, 3 GB); a warm-up edit at load; the torch cache is emptied after every edit and an out-of-memory answers 503 |

### 5.1 The worker pool (2026-10-21)

`server/providers/gpu_worker.py` runs a pool instead of one worker:

* `policy.max_workers` (default 3, `GPU_MAX_WORKERS`) caps how many run at once; `policy.llm_queue_per_worker` (default 6) is the number of requests in flight per GPU at which a worker counts as saturated. There is still no daily budget cap unless the owner sets one (`daily_budget_usd` stays `None`).
* The allowlist may hold any amd64 instance type, including `gpu_2x_*`, `gpu_4x_*` and `gpu_8x_*` (the cheapest type with capacity wins); `gpu_1x_gh200` is refused because it is aarch64 and every worker image is amd64.
* Load balancing: `llm_endpoint()` returns the ready worker with the lowest load per GPU (requests in flight from the model gateway's `begin`/`end`, plus three per live call reported by the runner), round robin on ties. Every TTS, STT and LLM resolution goes through it; a live call stays on the worker it started on (`CallSession.worker_origin`), and a new call goes to the runner with the most free slots (`musetalk.pick_worker`).
* Scale up: `maybe_scale_up()` launches one more worker in the background when every ready worker is saturated (a live call found no free slot in the last 120 s, or every worker has `llm_queue_per_worker` requests in flight per GPU) and the pool is below `max_workers`; one launch at a time. It runs after every `ensure_worker` and on every reaper pass; `POST /admin/gpu/scale-up` forces one.
* Scale down: the reaper checks every worker on its own idle window (`last_used_at`, touched only for the worker that served the request) and skips a worker with requests or calls in flight. A booting worker that nobody waits for (the gateway restarted mid-boot while another worker was ready) is re-attached by the reaper.
* Multi-GPU hosts: cloud-init gives the avatar runner card 1 to itself (`AVATAR_GPU`, `AVATAR_DEDICATED_GPU=1`, `AVATAR_MAX_SESSIONS=4`; the gateway then takes the runner's own limit) and the image edit server the next card (`IMAGEGEN_GPU`); vLLM, the voices and STT stay on card 0. On NVSwitch hosts the fabric manager is started and its state awaited before anything uses CUDA (a `gpu_4x_h100_sxm5` worker on 2026-10-21 failed every CUDA call with "Error 802: system not yet initialized"; it was stopped after 15 min, 5.63 USD, and the fix has not yet been exercised on a multi-GPU host).
* Admin: `GET /admin/gpu/status` lists `workers[]` (each with `gpus` and `load {inflight, calls, score}`) and `capacity`; `POST /admin/gpu/stop?worker_id=N` stops one worker, without it every worker; the admin GPU section shows the pool table with a Stop button per worker and an "Add a worker" button.

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
| `avatar` container | `acudx_avatar_server.py`, an aiohttp app around LiveTalking's `RTCManager`, `session_manager` and the musetalk avatar class; one shared model (fp16 UNet, VAE, whisper-tiny, S3FD face detector, BiSeNet face parser), per-call sessions (`AVATAR_MAX_SESSIONS=2`, batch 4 frames, each call on its own CUDA stream) | LiveTalking `c7269433a2b6ecebcd9342445d2ecc882c98b0da` (main, 2026-10-20, Apache-2.0), torch 2.9.1 cu128 on `python:3.12-slim-bookworm`, constraint file in the template |
| weights | `acudx_fetch_models.py` downloads by Hugging Face revision into the shared `HF_HOME` and links them where LiveTalking loads them | `TMElyralab/MuseTalk@2bcb936e` (`musetalkV15/unet.pth`, `musetalk.json`), `stabilityai/sd-vae-ft-mse@31f26fde`, `openai/whisper-tiny@169d4a43`, `ManyOtherFunctions/face-parse-bisent@0073b233` (sha256 checked), S3FD `s3fd-619a316812.pth` (sha256 prefix checked) |
| `turn` container | coturn, host network, `use-auth-secret`, relay ports 49160 to 49260 on the primary address, peers limited to the container network; TLS on 5349 (loopback only, reached through the edge router on 443) with the Let's Encrypt certificate Caddy obtains for `turn.<domain>` | `ghcr.io/coturn/coturn:4.18.0-debian` |
| `edge` container | nginx stream router on public 443: `ssl_preread` server name `turn.*` -> coturn TLS, anything else and ALPN `acme-tls/1` -> Caddy on `127.0.0.1:8443` | `nginx:1.30.6-alpine` |
| `avatar.sh` | builds the image while vLLM loads, waits for vLLM health (or its exit) and Chatterbox health, reads `nvidia-smi`, copies the `turn.<domain>` certificate for coturn (up to 5 minutes, else TURN starts without TLS), starts `turn` + `avatar` only when `AVATAR_REQUIRED_MB` (5000) is free, writes `/avatar-status/status.json` (`building`, `waiting`, `starting`, `ready`, or `disabled` with `insufficient_vram`, `build_failed`, `start_timeout`) | |
| firewall | TURN 3478 UDP and TCP added to `WORKER_FIREWALL_RULES` (credentials required for every allocation); TURN over TLS shares the existing 443 rule | |

The reference face is the case portrait (`web/public/patients/<photoId>.jpg`, the same `photoId` the tile shows): `PUT /avatar/avatars/acudx-<photoId>` runs face detection, extends the portrait where the blend box needs room (section 6.3.5), generates a 75-frame idle loop (3 s, played forward and back), and caches per frame the VAE latents, face box and blend mask once per worker (`prepare_ms` in the session reply, about 32 s on a fresh H100 worker, 50 to 500 ms once prepared; `GET /avatar/avatars/{id}` returns the frame size and face box the browser's lip-sync meter uses). The upstream `LiveTalking` corner mark that the runner draws on every frame is kept as attribution.

Per call: `POST /v1/voice/avatar/session` (call limit checked and the slot taken before the portrait work, TURN REST credentials issued from `turn_secret(worker token)`), the browser's receive-only offer goes through `POST /v1/voice/avatar/offer` (the gateway adds its per-call tuning and opens the call's audio WebSocket to the runner right away), and every patient line is spoken by `POST /v1/voice/avatar/speak`: the gateway asks the normal TTS resolution for a streamed WAV (Chatterbox's `/v1/audio/speech/stream`, Kokoro's chunked `/speech`, ElevenLabs `pcm_24000`), strips the header, and forwards each PCM chunk on that WebSocket as it arrives (section 6.3.2). The runner resamples to 16 kHz in a streaming soxr resampler and pushes 20 ms frames straight into LiveTalking's audio queue; LiveTalking computes whisper features, runs the UNet and emits each video frame together with its two audio frames, so voice and lips leave on one synchronized WebRTC connection.

#### 6.3.1 Turkish worker voice: the Chatterbox Multilingual init failure

Root cause, reproduced locally with the exact message: `ChatterboxMultilingualTTS.__init__` (chatterbox-multilingual `c33cc02`, `src/chatterbox/mtl_tts.py` line 153) builds `perth.PerthImplicitWatermarker()`. resemble-perth 1.0.1 (the latest release, 2025-05-23) imports `pkg_resources` in `perth/perth_net/__init__.py`, wraps that import in `try/except ImportError` and sets `PerthImplicitWatermarker = None` on failure. setuptools 82.0.0 (2026-02-08) removed `pkg_resources`, and the image installed the latest setuptools (84.2.1), so the class was `None` and the call raised `TypeError: 'NoneType' object is not callable`, which chatterbox-tts-api reports as `initialization_error` while `/health` still answers 200. Not an API change between the server and the model package. Fix in the Chatterbox Dockerfile written by cloud-init: `setuptools==80.9.0` installed first and appended to the constraint file used for the chatterbox install, and a build step that fails unless `perth.PerthImplicitWatermarker` is a class.

A second defect hid behind it: `seed-voices.sh` posted the voice uploads to `127.0.0.1:4123` on the host, but the API is only on the compose network, so the voice library stayed empty; an unknown voice falls back to the default sample with language `en` (`resolve_voice_path_and_language`), so even a healthy model would have read Turkish text as English. The script now waits for `initialization_state: ready` and uploads from inside the container, then synthesizes one warm-up line per language (the first synthesis on a fresh container took 13.6 s, later ones 1.4 to 2.7 s). Verified on workers 3 to 5: `/tts/health` `healthy, ready, error null`, four voices seeded (`acudx: voice acudx_tr_female (tr) seeded` in the diagnostics), Turkish lines spoken with `acudx_tr_female` and `acudx_tr_male` through the gateway and into the runner (docs/media/live-avatar/tr/, `audioEnergy` 0.55 at the browser).

#### 6.3.2 Streaming audio in and the latency budget

* Gateway (`server/voice/avatar/musetalk.py` `PcmStream`, `RunnerAudioLink`; `routes.py` `_speak_streaming`): one WebSocket per call to the runner's `/avatar/stream` (through Caddy, bearer in the handshake, never in a URL), opened right after the offer while the browser is still on ICE (430 to 660 ms, off the speak path) and reused for every line. A line is `{"type":"begin","sessionid","sample_rate"}`, binary 16-bit mono PCM chunks as the TTS produces them, `{"type":"end"}`, answered by `{"type":"done", frames, first_frame_ms, elapsed_ms}`. The WAV header is parsed incrementally (streaming servers write a 0xFFFFFFFF size); odd chunk boundaries are carried over. Rows can override the stream route with `extra.tts_stream_path` / `extra.tts_stream_body`; the worker's Chatterbox uses `/v1/audio/speech/stream` with `streaming_chunk_size` 60 and the sentence strategy. A row that declares `extra.languages` is skipped for other languages (the Kokoro row declares `["en"]`, so Turkish goes to Chatterbox).
* Runner: lip sync starts on the first 20 ms frame. The render loop no longer throttles on the WebRTC video queue alone (upstream: sleep at 5 queued frames while two feature batches and two rendered batches pile up behind it, about 1.5 s); it counts the sender (the deeper of the video queue and the audio queue in video frames), the rendered-frame queue (one batch), the feature queue (one batch) and the batch in the UNet, and extracts the next batch only while the total is below `ahead_frames` (6 by default, batch 4, whisper right context 4 audio frames). The first UNet batch on a call's inference thread and CUDA stream cost 2.04 to 2.08 s; it is now paid during the idle frames right after the call connects (`warm_up_ms` per call in `/health`) instead of on the patient's first line. `/health` reports per call `infer_fps`, `out_fps`, `underruns`, sender queue depths, and `last_speech_trace` (first speech sample in -> first speech sample handed to the WebRTC audio queue).
* Browser: `lowLatencyReceiver` sets `jitterBufferTarget` 0 and `playoutDelayHint` 0 on both receivers; `stats()` reports the mean jitter-buffer delay of audio and video.

#### 6.3.3 Lips and voice

The pairing inside the runner is exact by construction (each video frame leaves with the two audio frames its whisper window was centred on). The browser meter now correlates the remote audio RMS with mouth openness (mean darkness of a mouth box placed from the runner's face box) instead of frame-to-frame motion, because the idle head loop moves the whole face all the time. `av_shift_ms` (per call, from the gateway's `AVATAR_AV_SHIFT_MS`, default 160) re-pairs by index: the WebRTC tracks emit frame k at start + 40 k ms, so a plain delay line is absorbed by the queues; the runner prefills a one-frame-per-frame delay line instead. Measured with `live-avatar-concurrency.mjs` (one call, six lines of the same 22 s utterance): shift 0 gave -420, +120, 0, -80, -100 ms (mouth after voice); shift 160 gave +420, +280, +60, 0, -40, -60 ms; the steady state from the third line on is inside 80 ms with shift 160 (docs/media/live-avatar/lipsync-rounds-shift160.json). The first two lines of a call swung by up to 420 ms in both directions while the browser's jitter buffer settled; with the 800 ms silent pre-roll after connect they read 0 and 0 ms (EN) and +40 and +40 ms (TR) (section 6.3.8).

#### 6.3.4 TURN over TLS on 443

`ice_servers` now hands the browser `turn:<domain>:3478?transport=udp`, `turn:<domain>:3478?transport=tcp` and `turns:turn.<domain>:443?transport=tcp` with the same TURN REST credentials; the browser gathers relay candidates from all three and ICE keeps a pair that works, so a learner behind an HTTPS-only proxy or a UDP-blocking firewall falls back to 443 with no client logic. `turn.<1-2-3-4>.sslip.io` resolves like the worker name. On the worker the nginx SNI router sends that name to coturn's TLS listener and everything else to Caddy; Caddy obtains the `turn.<domain>` certificate (a respond-404 site, TLS-ALPN through the router) and `avatar.sh` copies it for coturn, which runs as `nobody`. `GET /admin/gpu/turn-check` makes the runner allocate on all three: on worker 5, `turns:turn.68-209-75-215.sslip.io:443` answered with TLS 1.3, certificate subject `turn.68-209-75-215.sslip.io`, issuer Let's Encrypt, a relay in 26.5 ms; TCP 3478 in 12.7 ms; UDP 3478 in 1.1 ms (docs/media/live-avatar/turn-check.json). The check dials the host's own address with the public names for SNI and verification, because the Lambda public address is NATed and a worker cannot reach itself through it (a self-dial got a foreign self-signed certificate on 443 and timeouts on 3478). This sandbox's egress proxy re-terminates TLS, so the browser captures still use `scripts/turn_ws_tunnel.py`.

#### 6.3.5 Portrait: extension and idle motion

A close-up portrait needs room for MuseTalk's 1.5x blend box. The old fix replicated the edge pixels (visible streaks at the frame sides). Now only the sides that need it are extended: mirrored image right at the seam (texture continues), cross-faded within 6 to 16 px into the edge colours smeared outwards and blurred across with a wide Gaussian, original pixels untouched; when the result would exceed 720 px the portrait is shrunk first instead of padding and shrinking again (docs/media/live-avatar/en/frames/07-tile.png, idle-loop.png).

Idle head motion: LivePortrait was considered and not used. It needs its own repository, insightface/onnxruntime face analysis, its weights and a driving motion template for an idle (non-talking) loop, and MuseTalk would then re-render the lower face of every frame anyway; that is a second model stack in the runner for a 3 s loop. Chosen instead: a deterministic loop generated from the portrait at preparation time, 75 frames (3 s, played forward then backward by LiveTalking's `mirror_index`, so it never jumps): a sway of +-0.7 degrees around a pivot under the chin, a 1.2 px nod, a 0.8 px drift and a 0.3 % breathing scale, each with zero velocity at both ends of the loop, applied only inside a feathered ellipse over the head (shoulders and background stay still). Each frame gets its own latents, face box and blend mask, so lips stay locked to the moving face. VRAM is unchanged (latents are 75 x 8 x 32 x 32); the per-avatar RAM is about 100 MB. `AVATAR_IDLE_FRAMES=1` restores the still portrait.

#### 6.3.6 Concurrency and the call limit

Two calls on one H100 SXM5 80 GB (worker 5), both speaking the same 22 s line at the same time: per-call inference 94.2 and 84.2 frames per second (batch 4, separate CUDA streams), both sending 25 fps (`out_fps`), with 22 and 23 sender underruns over the whole call, the same count a single call shows from start-up (in single-call traces the counter stayed flat through speech), sender queues 4 to 6 video frames, runner torch reserved 4774 MB with two calls (3464 MB with one, 2.7 GB idle), 18.5 GB of the card still free after vLLM (0.60), Chatterbox, speaches and Kokoro (docs/media/live-avatar/concurrency.json). The limit is `min(AVATAR_MAX_CALLS_PER_WORKER (gateway, default 2), AVATAR_MAX_SESSIONS (runner, 2))`; active calls are the runner's connected calls plus the gateway's calls still being set up (created in the last 120 s and not offered), so a closed tab frees its slot as soon as its peer connection closes. `/v1/voice/capabilities` reports `max_calls`, `active_calls`, `calls_available`, `live_video: false` when full, and the per-call runner numbers; a third session gets 503 `worker_full` with the reason before any portrait work. The second call's speech start was longer (1.55 to 3.38 s) because the worker's Kokoro serialized requests (its first chunk took 0.57 to 2.69 s); the runner side stayed at 82 to 86 ms. With two Kokoro replicas the second call starts at 1.17 to 1.27 s, and a second Chatterbox replica carries a second Turkish call (section 6.3.8).

#### 6.3.7 Measured

Live on 2026-10-20/21 with the private gateway, Lambda workers 3 to 5 (H100 SXM5 80 GB, us-southeast-1), browser in the sandbox reaching TURN through `scripts/turn_ws_tunnel.py` (captures, frames, MP4s and metrics in docs/media/live-avatar/{en,tr}/):

| measure | before (first live run) | now | how |
|---|---|---|---|
| TTS to first audio | 1412 ms for the whole line (Kokoro) | Kokoro 140 to 600 ms first chunk; Chatterbox TR 2.2 to 2.7 s, EN 1.0 to 2.1 s | `/speak` `first_chunk_ms` |
| audio to the runner | about 2.5 s upload of the whole WAV | streamed; the runner had the first frame 0.2 ms after the chunk arrived | `/speak` `runner.first_frame_ms` |
| runner: audio in -> WebRTC sender | about 1.5 s buffering, plus 2.06 to 2.20 s on the first line of every call | 56 to 161 ms (first line included, warm-up moved to idle: `warm_up_ms` 2036 to 2079) | `/health` `last_speech_trace` |
| speech start, EN, first line of a call | 8.7 s | 1.4 to 3.5 s (the sandbox path holds 1.0 to 1.3 s in the audio jitter buffer) | in-page Web Audio, speak request -> first audible sample |
| speech start, EN, later lines | | 0.76 to 0.93 s (lines 3 to 6) | `live-avatar-concurrency.mjs` rounds |
| speech start, TR (Chatterbox), first line | worker TTS down | 5.3 to 5.5 s (first chunk 2.2 to 2.7 s) | capture `tr/metrics.json` |
| lips vs voice | -240 ms (page), -480 ms (recording), motion metric | -60 to +60 ms from the third line (shift 160); first two lines -420 to +420 ms | openness meter, section 6.3.3 |
| first frame / SDP answer | 1957 / 754 ms | 1.1 to 1.6 s / 240 to 470 ms | offer -> first decoded frame |
| inference | 35.6 fps (batch 8) | 94 to 101 fps per call (batch 4, own stream), 84 to 94 with two calls | `/health` per call |
| TURN | UDP/TCP 3478 | plus TLS 443, verified by allocation | `/admin/gpu/turn-check` |

Against the target of speech start under 2.5 s from a browser on a normal network: EN meets it (0.8 to 0.9 s steady, and the first line's 1.4 to 3.5 s here includes about 1 s of jitter buffer and the WebSocket-tunnelled TURN that only this sandbox needs); TR with the worker's Chatterbox did not (its first chunk alone was 2.2 to 2.7 s); after the latency pass in section 6.3.8 it starts at 2.2 to 2.9 s in this sandbox (about 1.6 to 2.2 s expected outside it), and an ElevenLabs Turkish row stays the fastest path, about 75 ms to first audio.

Networks: a browser on an ordinary network uses `turn:<worker>:3478` over UDP (or TCP), or `turns:turn.<worker>:443` behind an HTTPS-only proxy. This sandbox has no UDP egress and only HTTPS through a TLS-re-terminating proxy, so the captures ran with `AVATAR_TURN_URLS=turn:127.0.0.1:3481?transport=tcp` and the tunnel script carrying TURN-over-TCP inside a WebSocket to the runner's `/avatar/turn` bridge; numbers through the tunnel include that extra hop.

#### 6.3.8 First-line latency pass (2026-10-21)

Goal: the Turkish patient's speech starts under 2.5 s on the first line of a call, as English already did from the third line. Measured live on Lambda H100 SXM5 workers (us-south-2 and us-southeast-1) with a private gateway, the browser in the sandbox reaching TURN through `scripts/turn_ws_tunnel.py` (docs/media/live-avatar/: `tr/`, `en/`, `lipsync-rounds-{en,tr}.json`, `concurrency.json`, `concurrency-tr.json`, `chatterbox-tuning-ab.json`).

What was changed:

* **Chatterbox patch** (`/opt/acudx/chatterbox-acudx-patch.py` in cloud-init, copied into the pinned chatterbox-tts-api checkout as `app/acudx_patch.py` and installed at the end of `app/main.py`; a failed install falls back to upstream behaviour and logs it):
  * prepared voice conditionals cached per voice id (the clip's name in the voice library) and the sha256 of the clip; voice upload, delete and rename drop the voice's entries; a hit hands the model a fresh wrapper with the request's exaggeration, so the cache is never mutated. `seed-voices.sh` streams one line per seeded voice, so all four are cached before the first call.
  * `generate` serialised with a lock: the model keeps the conditionals on `self.conds`, so two requests in the default executor could speak one voice's text with the other's conditionals.
  * the first clause goes out as its own chunk (first `,;:.!?` after 3 to 10 words, else the first 8 words), the rest is chunked by upstream's sentence splitter, and chunks under three words are folded into a neighbour with their comma put back (upstream cuts long sentences at every ", ", and T3 ran on for 3.8 to 18.5 s of audio on a one-word chunk such as "Terliyorum").
  * per-generate timings (`conds_ms`, `t3_ms`, `tokens`, `s3gen_ms`, `watermark_ms`, `lock_wait_ms`, `audio_ms`) and counters at `GET /tts/acudx/stats`; bounded runtime switches at `POST /tts/acudx/tuning` (`t3_autocast` null, bf16 or fp16; `first_clause`; `first_max_words` 3 to 20; `second_max_words` 0 to 30), both behind the worker bearer.
* **fp16 / bf16 and torch.compile**: measured, not enabled. `torch.autocast` around T3 only (eager, no compile, no CUDA graphs) made it slower: 16.8 ms per token (bf16) and 18.0 ms (fp16) against 13.4 ms in fp32, first audio median 1.74 and 1.75 s against 1.13 s (6 runs each). The T3 loop is launch- and sync-bound at batch 2 (one `.item()` per step for the alignment analyzer), so casts add kernels without saving time. `torch.compile` was not tried: its useful modes capture CUDA graphs, which these hosts do not allow, and the default mode recompiles as the KV cache grows.
* **Kokoro**: two replicas (`kokoro`, `kokoro2`) behind Caddy `lb_policy least_conn` with `/health` checks; one Kokoro FastAPI process synthesises one request at a time.
* **Second Chatterbox replica** (`chatterbox2`, same image, started only when the card has 70 GB or more; Caddy sends traffic only to a replica whose `/health` says `ready`). One Chatterbox runs at about 0.6 to 0.7 x real time while a call renders, so two Turkish calls on one process starved each other.
* **Gateway**: `avatar_preroll_ms` (800) streams that much 16 kHz silence through the call's runner socket right after the offer, so the speech path, the delay line and the browser's jitter buffer have settled before the first patient line; the offer also opens the TTS connection the first line will use (`VoiceService.prewarm_tts`); a ready worker is trusted for 30 s after a passing `/healthz` or a request instead of being probed before every TTS, STT and LLM resolution; `/speak` reports `stream_stall_ms` (how far the TTS stream fell behind real time) and the pre-roll.
* **Launch image pinned** to `lambda-stack-24-04` (`WORKER_IMAGE_FAMILY`): two us-south-2 workers launched without an image came up on `lambda-stack-22-04` and never served a route in 30 minutes (no diagnostics on 80, no TLS on 443); with the family pinned, the next us-south-2 worker was ready in 6 minutes.

Where the Turkish first chunk goes (per-generate timings on the worker):

| step | idle GPU | during a live call |
|---|---|---|
| conditionals | 11.4 to 12.7 s on the first request of a fresh container (paid by the seed warm-up), 42 to 54 ms warm without the cache, 0.2 to 0.7 ms cached | same |
| T3 decoder | 13.4 ms per token (a 5-word clause is 46 to 86 tokens) | 17 to 20 ms per token (the MuseTalk runner and vLLM share the GPU) |
| S3Gen (flow matching, 10 steps, vocoder) | 350 to 410 ms per chunk | 280 to 660 ms |
| watermark | 6 to 13 ms | same |

So the fixed cost that remained after the cache is S3Gen plus the T3 tokens of the first clause; the old "1.3 s fixed" was mostly T3 and S3Gen, not the conditionals (warm, those cost about 50 ms). In this sandbox every request after a pause of more than about 2 s also pays a new TLS connection through the egress proxy (about 450 ms, measured with back-to-back and idle `/tts/health` calls: 65 ms warm, 430 to 490 ms after 5 to 20 s idle); a gateway next to the worker pays one round trip.

Before and after:

| measure | before (6.3.7, 2026-10-20/21) | after (this pass) | how |
|---|---|---|---|
| TR speech start, first line, real app | 5.3 to 5.5 s (first chunk 2.7 s) | 2.58, 3.13 and 3.02 s on two workers (first chunk 1.89, 2.41 and 2.36 s, of which about 0.45 s is the sandbox's new TLS connection; the 3.02 s run had the TTS connection pre-opened, which this sandbox's proxy drops after about 2 s idle); 4.15 s on the first worker while the director's LLM call ran on the same GPU | `live-avatar.mjs`, `LANG_UI=tr` |
| TR first audio, direct to the worker, idle | | median 1.13 s (1.09 to 1.34 s), 5-word first clause | `chatterbox-tuning-ab.json` |
| TR speech start, lines 1 to 6 of one call | | 2.67, 2.73, 2.19, 2.87, 2.24, 2.55 s (first chunk 1.56 to 2.23 s) | `lipsync-rounds-tr.json` |
| EN speech start, first line, real app | 1.4 to 3.5 s | 1.31 s (Kokoro first chunk 626 ms) | `live-avatar.mjs` |
| EN speech start, lines 1 to 6 of one call | 2.34, 1.36, 0.82, 0.82, 0.89, 0.90 s | 1.36, 0.85, 0.87, 0.83, 0.84, 0.82 s | `lipsync-rounds-en.json` |
| lips vs voice, first two lines | +420, +280 ms (EN) | EN 0, 0 ms; TR +40, +40 ms; lines 3 to 6 0 to +60 ms | same rounds, openness meter |
| one-word chunks | T3 ran on to 3.8 to 18.5 s of audio for "Terliyorum", gaps up to 4.9 s | folded into a neighbour; no split chunk under 3 words | `/tts/acudx/stats` |
| two EN calls at once, second call | first chunk 0.57 to 2.69 s, speech start 1.55 to 3.38 s | first chunk 0.59 to 0.65 s, speech start 1.17 to 1.27 s; sender underruns 1 per call (was 22 to 23) | `concurrency.json` |
| two TR calls at once | one Chatterbox: 9.4 to 10.9 s of gaps in each voice | two replicas: gaps 0 to 0.93 s, speech start 2.16 to 2.87 s (one outlier 5.6 s) | `concurrency-tr.json` |
| Kokoro, parallel requests direct | serialized (up to 2.7 s for the second) | 2 and 3 at once: 154 to 266 ms first audio after the voice is loaded | direct bench |

Against the 2.5 s target: Turkish now starts at 2.2 to 2.9 s in this sandbox, of which about 0.45 s is the sandbox's TLS reconnect and 0.6 to 0.7 s the WebSocket-tunnelled TURN and jitter buffer; from a gateway beside the worker and a browser on an ordinary network the same lines add up to about 1.6 to 2.2 s (first clause 1.1 to 1.5 s under call load, runner about 0.1 s, WebRTC 0.2 to 0.4 s). Not yet shown end to end outside the sandbox. The remaining gap in a long Turkish answer is the second chunk: during a call T3 runs at 0.6 to 0.7 x real time, so a long second chunk can still leave a 0.2 to 1.2 s pause (`stream_stall_ms`); `second_max_words` (runtime) splits it once more.

### 6.5 Hosted live video: Tavus CVI (optional adapter; runs only when asked for or marked default)

`server/voice/avatar/tavus.py`, request shapes read from docs.tavus.io on 2026-10-20 (create PAL https://docs.tavus.io/api-reference/pals/create-pal, custom LLM https://docs.tavus.io/sections/conversational-video-interface/pal/llm, TTS layer https://docs.tavus.io/sections/conversational-video-interface/pal/tts, create conversation https://docs.tavus.io/api-reference/conversations/create-conversation, end conversation https://docs.tavus.io/api-reference/conversations/end-conversation, PAL-per-session strategy https://docs.tavus.io/sections/onboarding-guide/pal-strategies). Tavus renamed personas to PALs and replicas to faces; `/v2/personas` remains an alias.

* Registry row: kind `avatar`, name `tavus`, base URL `https://tavusapi.com`, the Tavus key in the write-only key field of `/admin/providers`, `extra.face_id` (a stock face, or one trained from a portrait with Create Face `train_image_url`), optional `extra.face_ids` `{photoId: face_id}`, optional `extra.public_base_url`. The gateway also needs `PUBLIC_BASE_URL`, its internet-reachable origin. The probe calls `GET /v2/pals?limit=1` with `x-api-key`.
* Per call: a PAL is created with `layers.llm = {model: "acudx-patient", base_url: <PUBLIC_BASE_URL>/v1/patient/openai, api_key: <per-call token>}`, perception off, and, when an ElevenLabs TTS row exists, `layers.tts = {tts_engine: "elevenlabs", api_key, external_voice_id, tts_model_name}` with the voice the gateway profile picks (else Tavus's own voice); then a conversation with `languages: [lang]`, `max_call_duration` 1200 s, captions on. The tile embeds `conversation_url`. Ending the call ends the conversation and deletes the PAL; a failed conversation deletes the PAL at once.
* `POST /v1/patient/openai/chat/completions` authenticates the per-call token (only its SHA-256 is stored), drops system and perception messages, takes the last user line and the prior dialogue, and runs the same `patient_turn` as the typed encounter (guard, persona, FactAssertionGate) with the call's stored case state; it streams SSE in sentence-sized deltas when asked.
* Cost: Tavus bills conversation minutes in 6 s increments with a 30 s minimum ($0.26 to $0.35 per minute self-serve, research 14 section 1.1).
* Since 2026-10-21 (owner decision): Tavus is not the default renderer. `provider: "auto"` uses it only when its row carries `extra.default: true`; otherwise a session asks for `provider: "tavus"` by name. A call bound to a case thread answers every Tavus turn from the thread's live server state (the same voice lines as the on-prem call: breathless phrasing, pain, cough, drowsiness) and prefixes the reply with the Phoenix emotion that fits (`scared`, `sad`, `dejected`, `content`; https://docs.tavus.io/sections/conversational-video-interface/quickstart/emotional-expression.md, read 2026-10-21). Tavus faces cannot show physical signs, so on Tavus the illness is in the voice and the words only. Patients under 18 are refused (Tavus acceptable use policy 3.2, https://tavus.io/acceptable-use-policy, effective 2026-04-14). The full comparison and verdict: docs/review/08-video-avatar-landscape-2026-10.md.

### 6.4 Fallback ladder

Live video is tried in this order (owner decision 2026-10-21, on-prem by default): a hosted row the owner marked `extra.default: true`, the GPU worker runner, then a hosted row only when no GPU worker is configured (capabilities `avatar.transport` tavus | livekit | webrtc, `live_video: true` only when a stream can be served now; other hosted rows are listed under `avatar.optional`). The runner needs a ready worker, `/avatar/health` answering, the portrait prepared and a first frame within 30 s; a worker that is still booting reports `pending_launch` and the tile re-checks every 30 s. Any miss drops the tile to the local path (status text "Voice call" or "Text-timed animation"), the audio path drops hosted -> worker -> none, and the encounter always continues in text (document 03 invariant V-5).

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
* `server/tests/test_voice_avatar.py`: TURN URLs (UDP, TCP, TLS 443), the streamed speak path end to end against an in-process runner socket (Chatterbox `/speech/stream` header split across chunks, odd byte boundaries, one socket reused per call), `PcmStream`, the call limit (slot taken before preparation, refusal with reasons, freed on end, closed tabs not counted), capabilities `max_calls`, per-call tuning on the offer, a broken runner stream reported as `speak_failed`. `server/tests/test_voice_service.py`: Chatterbox stream route and body, `extra.languages` skipping. `server/tests/test_gpu_worker.py`: setuptools pin and perth check, the edge router and Caddy ports, coturn TLS arguments (and no `--no-dtls`), the runner's routes and defaults. `web/src/lib/avatarCall.test.ts`: openness lag, mouth box from the face box. Latency pass (6.3.8): `test_voice_avatar.py` pre-roll (length, off switch, sent before the first line), `stream_stall_ms`, TTS pre-warm on the offer; `test_gpu_worker.py` the Chatterbox patch loaded from cloud-init without torch (first clause, tiny-chunk folding with the comma put back, conditionals cache keyed by voice and clip hash, invalidation on upload, delete and rename, the generate lock, timings rows, bounded tuning switch, no compile), two Kokoro and two Chatterbox replicas in Caddy and compose, the health TTL, the pinned launch image; `test_lambda_cloud.py` the `image.family` launch field.

## 10. Operations

1. Add rows under `/admin/providers`: kind `tts` (ElevenLabs with `extra.model_id`, or the worker is used automatically), kind `stt` (Deepgram Nova-3), optional kind `avatar` (LiveKit transport, renderer and keys). Press Probe.
2. Air-gapped pods: leave `AIRGAPPED=true`; `GET /v1/voice/capabilities` lists every refused row by name; add an on-prem OpenAI-compatible row (Chatterbox, speaches) with its host in `LOCAL_ALLOWLIST`.
3. Start the agent worker only when an avatar row exists (`workers/voice_agent/README.md`); the tile works without it.
4. Watch `/admin/telemetry/summary` by kind `tts` / `stt` for cost and p95; a failed hosted row shows as `ok = 0` with the error type.

## 11. Open items

* Closed on 2026-10-21 (section 6.3.1 to 6.3.7): Chatterbox Multilingual init failure and the empty voice library (Turkish worker TTS works), streamed audio and the runner buffering, TURN over TLS on 443, the streaked padding, a still face, the per-worker call limit.
* Closed on 2026-10-21 (section 6.3.8): Chatterbox conditionals cached and the first clause sent alone (TR first line 5.3 s -> 2.6 to 3.1 s in the sandbox), the first-two-lines lip swing (silent pre-roll), Kokoro serializing concurrent calls (two replicas), the per-request health probe, the unpinned launch image.
* Turkish speech start is not yet measured from a browser outside this sandbox; the sandbox adds about 0.45 s (TLS reconnect through the egress proxy) and 0.6 to 0.7 s (WebSocket-tunnelled TURN). Inside a call T3 runs at 17 to 20 ms per token, so a long second chunk can still leave a pause of up to 1.2 s; try `second_max_words` 6 to 8 through `/tts/acudx/tuning` and make it the default if listening tests agree. The patient turn's director LLM call shares the GPU with Chatterbox (first chunk 3.5 s on the run where they overlapped); the web could start the director step after the first audio.
* The lip meter has about 40 to 60 ms of run-to-run noise; the pre-roll results (0 to +60 ms on every line) are inside it.
* Two Turkish calls at once still share one GPU: with two Chatterbox replicas the gaps are 0 to 0.9 s and one second line started at 5.6 s; a third call or a 40 GB card (no second replica) needs ElevenLabs for Turkish.
* After two failed launches and a stop, the gateway's readiness wait for the third worker never saw `/healthz` 200 (logged PoolTimeout) until the gateway restarted; not reproduced in tests yet.
* SoulX-FlashHead Lite comparison (head motion and expression, not only lips); the idle loop is a rigid head motion without blinks.
* Tavus has not been exercised against the live API (no key in this environment); the request shapes are tested with respx against the documented contract.
* Turkish listening test of Chatterbox Multilingual against ElevenLabs on short clinical utterances (research 14 section 5.4 item 4); the bundled reference voice is a stand-in for consented actor recordings.
* Streaming STT through the gateway (websocket) for the dictation path; today the agent worker streams and the gateway transcribes whole clips.
* The console does not yet show the voice kinds' probe details or the `/v1/voice/capabilities` view; the data is there.
