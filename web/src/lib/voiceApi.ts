/**
 * voiceApi: typed client for the gateway's voice routes (server/voice/routes.py).
 *
 *   GET  /v1/voice/capabilities  -> what is enabled now (provider, adapter, languages)
 *   POST /v1/voice/warm          -> wake the on-demand GPU worker on call start (answers at once)
 *   POST /v1/voice/tts           -> chunked audio stream + provenance headers
 *   POST /v1/voice/stt           -> { text, language, confidence, provider }
 *   POST /v1/voice/room          -> LiveKit room token when an avatar row is configured
 *   POST /v1/voice/avatar/*      -> live patient video: session (portrait + TURN credentials or a
 *                                   Tavus conversation), offer/answer, speak, end (server/voice/avatar)
 *
 * Every provider key stays server-side; the browser only ever sees audio and
 * provenance headers. Streaming playback goes through `playTtsStream`: MediaSource
 * when the codec allows (audio/mpeg), else a chunked blob, in both cases measuring
 * the first-audio latency (request sent -> the element's `playing` event).
 *
 * Pure helpers (`parseTtsHeaders`, `pickPlaybackStrategy`, `buildTtsBody`) are
 * unit-tested in voiceApi.test.ts. Nothing here logs or touches globals besides
 * the injected `fetch`.
 */

import { BACKEND_URL, type BackendResult, type RequestOptions } from "@/lib/backend";

/* -------------------------------------------------------------------------- */
/* Shapes (mirror server/voice/routes.py and service.py)                        */
/* -------------------------------------------------------------------------- */

export interface EngineCapabilities {
  enabled: boolean;
  provider: string | null;
  source: "registry" | "gpu_worker" | "env" | null;
  adapter: "elevenlabs" | "deepgram" | "openai_compatible" | null;
  model: string | null;
  languages: string[];
  reasons: string[];
  /** The GPU worker is not up yet but the first request will launch it. */
  pending_launch?: boolean;
}

export interface AvatarCapabilities {
  enabled: boolean;
  provider: string | null;
  /** "webrtc" (GPU worker MuseTalk runner), "tavus", "livekit", or null. */
  transport: string | null;
  renderer: "none" | "simli" | "anam" | "musetalk" | "tavus" | string;
  source?: string;
  reasons?: string[];
  /** True only when a real lip-synced video stream can be served now. */
  live_video?: boolean;
  /** The GPU worker is not up yet; the first spoken reply launches it. */
  pending_launch?: boolean;
  /** Runner bring-up state on the worker (ready, building, waiting, starting, disabled). */
  state?: string;
  model?: string;
  infer_fps?: number | null;
  vram?: { name?: string; total_mb?: number; free_mb?: number; required_mb?: number; process_reserved_mb?: number };
  /** How far the GPU worker's live video is from ready (server/voice/service.py `_video_wake`). */
  wake?: VideoWake;
}

/** Stage of the live video launch: the machine boots, then the runner, voices and image edits load. */
export interface VideoWake {
  stage: "idle" | "machine" | "video_services" | "ready" | "failed";
  elapsed_s: number | null;
  estimate_s: number;
  /** 0..1 (capped at 0.95 until ready). */
  progress: number;
  detail?: string;
  runner?: string;
}

/** GET /v1/voice/avatar/look: the case's generated picture for how the patient is now. */
export interface AvatarLook {
  state: "none" | "preparing" | "ready" | "failed";
  has_image: boolean;
  key?: string;
  live_key?: string;
  exact?: boolean;
  reason?: string | null;
  signs?: Record<string, number>;
}

/** POST /v1/voice/avatar/session (server/voice/avatar/routes.py). */
export interface AvatarSession {
  session_id: string;
  provider: "musetalk" | "tavus" | string;
  transport: "webrtc" | "tavus" | string;
  renderer: string;
  model?: string;
  lang: string;
  avatar_id?: string | null;
  conversation_url?: string | null;
  ice_servers?: RTCIceServer[];
  ice_transport_policy?: "relay" | "all";
  prepare_ms?: number;
  worker?: { infer_fps?: number | null; sessions?: number; max_sessions?: number };
}

export interface AvatarSpeakResult {
  provider: string;
  adapter: string;
  model: string;
  voice_id: string;
  source: string;
  tts_ms: number;
  queued_ms: number;
  audio_bytes: number;
  audio_duration_ms: number | null;
  /** "stream": PCM forwarded to the runner while it is synthesised; absent for the whole-file path. */
  transport?: "stream" | string;
  /** Speak request -> first PCM chunk forwarded (streamed path). */
  first_chunk_ms?: number | null;
  stream_ms?: number;
}

export interface AvatarUnavailable {
  error: "avatar_unavailable";
  state: string;
  reasons: string[];
  pending_launch?: boolean;
}

export type AvatarSessionResult =
  | { ok: true; data: AvatarSession }
  | { ok: false; error: "unavailable"; status: 503; detail: AvatarUnavailable }
  | { ok: false; error: string; status?: number };

export interface VoiceCapabilities {
  airgapped: boolean;
  tts: EngineCapabilities;
  stt: EngineCapabilities;
  avatar: AvatarCapabilities;
  gpu_worker?: {
    ready: boolean | null;
    can_launch: boolean;
    refusal: { reason: string; message: string } | null;
    /** Where an on-demand launch stands (server/voice/service.py `_wake_state`). */
    wake?: WorkerWake;
  };
}

/** The on-demand GPU worker's launch: idle, starting (with elapsed / estimated seconds), ready or failed. */
export interface WorkerWake {
  state: "idle" | "starting" | "ready" | "failed";
  detail: string | null;
  elapsed_s: number | null;
  estimate_s: number;
}

/** POST /v1/voice/warm: the call started; the worker launches in the background. */
export interface WarmResult {
  ready: boolean;
  pending_launch: boolean;
  refusal: { reason: string; message: string } | null;
}

export interface SttResponse {
  text: string;
  language: string | null;
  confidence: number | null;
  provider: string;
  adapter: string;
  model: string;
  source: string;
  audio_seconds: number | null;
  latency_ms: number;
}

export interface RoomToken {
  url: string;
  token: string;
  room: string;
  identity: string;
  renderer: string;
  ttl_s: number;
}

export type Sex = "male" | "female";

export interface TtsRequest {
  text: string;
  lang: string;
  sex: Sex;
  age: number;
  voiceId?: string;
  format?: "mp3" | "wav";
  speed?: number;
}

/** Provenance the gateway attaches to every synthesized stream. */
export interface TtsMeta {
  contentType: string;
  durationMs: number | null;
  provider: string | null;
  adapter: string | null;
  model: string | null;
  source: string | null;
  voiceId: string | null;
  /** Server-side time to the provider's first byte. */
  ttfbMs: number | null;
}

export interface TtsOk {
  ok: true;
  response: Response;
  meta: TtsMeta;
}

export interface TtsUnavailable {
  ok: false;
  /** "unavailable" (503: nothing can serve), "http_<status>", "network", "aborted", "timeout". */
  error: string;
  status?: number;
  reasons?: string[];
  /** 503 while the GPU worker boots (retry later), as opposed to a permanent refusal. */
  pendingLaunch?: boolean;
  airgapped?: boolean;
}

export type TtsResult = TtsOk | TtsUnavailable;

/* -------------------------------------------------------------------------- */
/* Pure helpers                                                                 */
/* -------------------------------------------------------------------------- */

/** Clamp and shape the TTS body the gateway validates (max 1200 chars, mp3|wav). */
export function buildTtsBody(req: TtsRequest): Record<string, unknown> {
  const text = req.text.trim().slice(0, 1200);
  const body: Record<string, unknown> = {
    text,
    lang: (req.lang || "en").toLowerCase().split("-")[0],
    sex: req.sex,
    age: Math.max(0, Math.min(120, Math.round(req.age))),
    format: req.format ?? "mp3",
  };
  if (req.voiceId) body.voice_id = req.voiceId;
  if (req.speed && req.speed !== 1) body.speed = Math.max(0.5, Math.min(2, req.speed));
  return body;
}

function headerInt(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Read the provenance headers off a /v1/voice/tts response. */
export function parseTtsHeaders(headers: Headers): TtsMeta {
  const contentType = (headers.get("content-type") ?? "audio/mpeg").split(";")[0].trim();
  return {
    contentType,
    durationMs: headerInt(headers, "x-audio-duration-ms"),
    provider: headers.get("x-voice-provider"),
    adapter: headers.get("x-voice-adapter"),
    model: headers.get("x-voice-model"),
    source: headers.get("x-voice-source"),
    voiceId: headers.get("x-voice-id"),
    ttfbMs: headerInt(headers, "x-voice-ttfb-ms"),
  };
}

export type PlaybackStrategy = "mediasource" | "blob";

export interface PlaybackEnv {
  hasMediaSource: boolean;
  isTypeSupported: (mime: string) => boolean;
}

/**
 * MediaSource lets playback start on the first chunk, but only for codecs it
 * accepts (MP3 is; WAV / PCM are not). Anything else buffers to a blob.
 */
export function pickPlaybackStrategy(contentType: string, env: PlaybackEnv): PlaybackStrategy {
  const mime = contentType.split(";")[0].trim().toLowerCase();
  if (!env.hasMediaSource) return "blob";
  if (mime !== "audio/mpeg" && mime !== "audio/mp3") return "blob";
  try {
    return env.isTypeSupported("audio/mpeg") ? "mediasource" : "blob";
  } catch {
    return "blob";
  }
}

/** Detect the live browser playback environment (SSR-safe). */
export function browserPlaybackEnv(): PlaybackEnv {
  const ms = typeof MediaSource !== "undefined" ? MediaSource : null;
  return {
    hasMediaSource: ms !== null,
    isTypeSupported: (mime) => (ms ? ms.isTypeSupported(mime) : false),
  };
}

/** Milliseconds from request start to the first audible frame. */
export function firstAudioLatency(startedAt: number, playingAt: number): number {
  return Math.max(0, Math.round(playingAt - startedAt));
}

/* -------------------------------------------------------------------------- */
/* Client                                                                       */
/* -------------------------------------------------------------------------- */

export interface VoiceApiOptions {
  baseUrl?: string;
  fetchFn?: typeof fetch;
  defaultTimeoutMs?: number;
  /** Identity headers for the signed-in avatar routes; defaults to the app's profile. */
  identity?: () => Promise<Record<string, string>>;
}

function composeSignal(opts: RequestOptions, timeoutMs: number): { signal: AbortSignal; clear: () => void } {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const onAbort = () => ctl.abort();
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: ctl.signal,
    clear: () => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    },
  };
}

function failure(err: unknown, signal?: AbortSignal): { ok: false; error: string } {
  if (signal?.aborted) return { ok: false, error: "aborted" };
  if (err instanceof DOMException && err.name === "AbortError") return { ok: false, error: "timeout" };
  return { ok: false, error: "network" };
}

export function createVoiceApi(options: VoiceApiOptions = {}) {
  const base = (options.baseUrl ?? BACKEND_URL).replace(/\/$/, "");
  const fetchFn = options.fetchFn ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const defaultTimeout = options.defaultTimeoutMs ?? 20_000;
  // Lazy: the profile store pulls in i18n and the DOM, which the pure helpers here do not need.
  const identity = options.identity ?? (async () => (await import("@/lib/panelsApi")).identityHeaders());

  async function identityOrNone(): Promise<Record<string, string>> {
    try {
      return await identity();
    } catch {
      return {}; // anonymous: the route answers 401 and the caller falls back
    }
  }

  async function json<T>(path: string, init: RequestInit, opts: RequestOptions): Promise<BackendResult<T>> {
    const { signal, clear } = composeSignal(opts, opts.timeoutMs ?? defaultTimeout);
    try {
      const res = await fetchFn(`${base}${path}`, { ...init, signal });
      if (!res.ok) return { ok: false, error: `http_${res.status}`, status: res.status };
      return { ok: true, data: (await res.json()) as T };
    } catch (err) {
      return failure(err, opts.signal);
    } finally {
      clear();
    }
  }

  async function signedJson<T>(path: string, body: unknown, opts: RequestOptions): Promise<BackendResult<T>> {
    const headers = await identityOrNone();
    return json<T>(
      path,
      { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) },
      opts,
    );
  }

  return {
    /** What is enabled right now; never launches a worker. */
    capabilities(opts: RequestOptions = {}): Promise<BackendResult<VoiceCapabilities>> {
      return json<VoiceCapabilities>("/v1/voice/capabilities", { method: "GET" }, opts);
    },

    /**
     * The learner started the patient call: wake the on-demand GPU worker (voice and live video).
     * Answers at once; readiness is then read from `capabilities().gpu_worker.wake`.
     */
    warm(opts: RequestOptions = {}): Promise<BackendResult<WarmResult>> {
      return signedJson<WarmResult>("/v1/voice/warm", {}, { timeoutMs: 10_000, ...opts });
    },

    /** Transcribe a recorded clip. `lang` is a hint ("en" | "tr"); omit to auto-detect. */
    transcribe(
      blob: Blob,
      params: { lang?: string; filename?: string } = {},
      opts: RequestOptions = {},
    ): Promise<BackendResult<SttResponse>> {
      const fd = new FormData();
      const name = params.filename ?? (blob.type.includes("mp4") ? "dictation.mp4" : "dictation.webm");
      fd.append("file", blob, name);
      if (params.lang) fd.append("lang", params.lang.toLowerCase().split("-")[0]);
      return json<SttResponse>("/v1/voice/stt", { method: "POST", body: fd }, { timeoutMs: 45_000, ...opts });
    },

    /**
     * Start a synthesis. Resolves as soon as the response headers arrive so the
     * caller can begin streaming playback; the body is consumed by `playTtsStream`.
     */
    async synthesize(req: TtsRequest, opts: RequestOptions = {}): Promise<TtsResult> {
      const { signal, clear } = composeSignal(opts, opts.timeoutMs ?? 30_000);
      let res: Response;
      try {
        res = await fetchFn(`${base}/v1/voice/tts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildTtsBody(req)),
          signal,
        });
      } catch (err) {
        clear();
        return failure(err, opts.signal);
      }
      // The stream outlives the header timeout; a caller abort still cancels it.
      clear();
      if (res.status === 503) {
        let reasons: string[] | undefined;
        let pendingLaunch = false;
        let airgapped = false;
        try {
          const j = (await res.json()) as { reasons?: string[]; pending_launch?: boolean; airgapped?: boolean };
          reasons = j.reasons;
          pendingLaunch = j.pending_launch === true;
          airgapped = j.airgapped === true;
        } catch {
          /* no body */
        }
        return { ok: false, error: "unavailable", status: 503, reasons, pendingLaunch, airgapped };
      }
      if (!res.ok || !res.body) return { ok: false, error: `http_${res.status}`, status: res.status };
      return { ok: true, response: res, meta: parseTtsHeaders(res.headers) };
    },

    /**
     * Start a live patient video call. A 503 carries `state` and `reasons` (worker starting,
     * runner disabled for VRAM, no renderer) and comes back as `unavailable`.
     */
    async avatarSession(body: Record<string, unknown>, opts: RequestOptions = {}): Promise<AvatarSessionResult> {
      const headers = await identityOrNone();
      const { signal, clear } = composeSignal(opts, opts.timeoutMs ?? 150_000);
      try {
        const res = await fetchFn(`${base}/v1/voice/avatar/session`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify(body),
          signal,
        });
        if (res.status === 503) {
          const detail = (await res.json().catch(() => ({}))) as AvatarUnavailable;
          return { ok: false, error: "unavailable", status: 503, detail };
        }
        if (!res.ok) return { ok: false, error: `http_${res.status}`, status: res.status };
        return { ok: true, data: (await res.json()) as AvatarSession };
      } catch (err) {
        return failure(err, opts.signal);
      } finally {
        clear();
      }
    },

    avatarOffer(
      sessionId: string,
      sdp: string,
      opts: RequestOptions = {},
    ): Promise<BackendResult<{ sdp: string; type: string; answer_ms: number }>> {
      return signedJson("/v1/voice/avatar/offer", { session_id: sessionId, sdp, type: "offer" }, { timeoutMs: 60_000, ...opts });
    },

    avatarSpeak(sessionId: string, text: string, opts: RequestOptions = {}): Promise<BackendResult<AvatarSpeakResult>> {
      return signedJson("/v1/voice/avatar/speak", { session_id: sessionId, text }, { timeoutMs: 60_000, ...opts });
    },

    /**
     * At case start: ask the gateway to make this patient's pictures (presenting, worse, critical,
     * improved) from the case thread before any call, so a later call opens on the patient as they are.
     */
    avatarPrepare(threadId: string, photoId: string, opts: RequestOptions = {}): Promise<BackendResult<{ state: string }>> {
      return signedJson("/v1/voice/avatar/prepare", { thread_id: threadId, photo_id: photoId }, { timeoutMs: 30_000, ...opts });
    },

    /** The chart's still portrait: the generated look for how the patient is now (owner only). */
    async avatarLook(threadId: string, photoId: string, opts: RequestOptions = {}): Promise<BackendResult<AvatarLook>> {
      const headers = await identityOrNone();
      const q = new URLSearchParams({ thread_id: threadId, photo_id: photoId });
      return json<AvatarLook>(`/v1/voice/avatar/look?${q.toString()}`, { method: "GET", headers }, opts);
    },

    /** One generated picture as a Blob (signed in: the image route needs the bearer, so no plain <img src>). */
    async avatarLookImage(threadId: string, photoId: string, key: string, opts: RequestOptions = {}): Promise<BackendResult<Blob>> {
      const headers = await identityOrNone();
      const q = new URLSearchParams({ thread_id: threadId, photo_id: photoId, key });
      const { signal, clear } = composeSignal(opts, opts.timeoutMs ?? defaultTimeout);
      try {
        const res = await fetchFn(`${base}/v1/voice/avatar/look/image?${q.toString()}`, { method: "GET", headers, signal });
        if (!res.ok) return { ok: false, error: `http_${res.status}`, status: res.status };
        return { ok: true, data: await res.blob() };
      } catch (err) {
        return failure(err, opts.signal);
      } finally {
        clear();
      }
    },

    avatarEnd(sessionId: string, opts: RequestOptions = {}): Promise<BackendResult<{ ok: boolean }>> {
      return signedJson("/v1/voice/avatar/end", { session_id: sessionId }, opts);
    },

    /** A LiveKit room token for this encounter, when an avatar row is configured. */
    roomToken(
      encounterId: string,
      params: { identity?: string; name?: string } = {},
      opts: RequestOptions = {},
    ): Promise<BackendResult<RoomToken>> {
      return json<RoomToken>(
        "/v1/voice/room",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ encounter_id: encounterId, ...params }),
        },
        opts,
      );
    },
  };
}

export type VoiceApi = ReturnType<typeof createVoiceApi>;

/** Shared default client (same-origin `/api`). */
export const voiceApi: VoiceApi = createVoiceApi();

/* -------------------------------------------------------------------------- */
/* Streaming playback                                                           */
/* -------------------------------------------------------------------------- */

export interface PlaybackOptions {
  /** Fires once with the measured first-audio latency (ms from `startedAt`). */
  onFirstAudio?: (latencyMs: number) => void;
  /** Fires when the clip's duration becomes known (ms). */
  onDuration?: (durationMs: number) => void;
  /** Cancels the download and playback. */
  signal?: AbortSignal;
  /** Override the strategy (tests, or a caller that already knows). */
  strategy?: PlaybackStrategy;
  /** Timestamp the request was issued (performance.now()). Defaults to now. */
  startedAt?: number;
  env?: PlaybackEnv;
}

export interface PlaybackHandle {
  /** The strategy used. */
  strategy: PlaybackStrategy;
  /** Resolves when playback has ended (or was aborted). */
  done: Promise<void>;
}

const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * Pipe a /v1/voice/tts response into an HTMLAudioElement. MP3 streams through
 * MediaSource so the first chunk is audible before the download finishes; other
 * codecs are collected into a blob first. The element must already be unlocked
 * for programmatic playback (see tts.ts `unlockTts`).
 */
export function playTtsStream(response: Response, audio: HTMLAudioElement, opts: PlaybackOptions = {}): PlaybackHandle {
  const startedAt = opts.startedAt ?? now();
  const meta = parseTtsHeaders(response.headers);
  const strategy = opts.strategy ?? pickPlaybackStrategy(meta.contentType, opts.env ?? browserPlaybackEnv());
  let firstFired = false;
  let objectUrl: string | null = null;
  const onPlaying = () => {
    if (firstFired) return;
    firstFired = true;
    opts.onFirstAudio?.(firstAudioLatency(startedAt, now()));
  };
  const onDuration = () => {
    const d = audio.duration;
    if (Number.isFinite(d) && d > 0) opts.onDuration?.(Math.round(d * 1000));
  };
  if (meta.durationMs) opts.onDuration?.(meta.durationMs);

  const done = new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("durationchange", onDuration);
      audio.removeEventListener("ended", finish);
      audio.removeEventListener("error", finish);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      resolve();
    };
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("durationchange", onDuration);
    audio.addEventListener("ended", finish);
    audio.addEventListener("error", finish);
    opts.signal?.addEventListener(
      "abort",
      () => {
        try {
          audio.pause();
        } catch {
          /* ignore */
        }
        finish();
      },
      { once: true },
    );

    const start = () => audio.play().catch(() => finish());

    if (strategy === "mediasource") {
      const ms = new MediaSource();
      objectUrl = URL.createObjectURL(ms);
      ms.addEventListener("sourceopen", async () => {
        let sb: SourceBuffer;
        try {
          sb = ms.addSourceBuffer("audio/mpeg");
        } catch {
          finish();
          return;
        }
        const reader = response.body!.getReader();
        const waitIdle = () =>
          new Promise<void>((r) => {
            if (!sb.updating) return r();
            sb.addEventListener("updateend", () => r(), { once: true });
          });
        let started = false;
        try {
          for (;;) {
            const { value, done: eof } = await reader.read();
            if (opts.signal?.aborted) break;
            if (eof) break;
            if (!value || value.byteLength === 0) continue;
            await waitIdle();
            sb.appendBuffer(value);
            if (!started) {
              started = true;
              void start();
            }
          }
          await waitIdle();
          if (ms.readyState === "open") ms.endOfStream();
        } catch {
          finish();
        }
      });
      audio.src = objectUrl;
      return;
    }

    // Blob path: collect the whole body (chunked transfer still streams the download).
    response
      .blob()
      .then((blob) => {
        if (opts.signal?.aborted) return finish();
        objectUrl = URL.createObjectURL(blob);
        audio.src = objectUrl;
        audio.currentTime = 0;
        void start();
      })
      .catch(() => finish());
  });

  return { strategy, done };
}
