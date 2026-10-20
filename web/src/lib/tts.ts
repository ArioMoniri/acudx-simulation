/**
 * tts: the patient's spoken voice through the gateway (POST /api/v1/voice/tts).
 *
 * The gateway resolves the provider from the admin registry (ElevenLabs, Deepgram
 * Aura, the GPU worker's Chatterbox Multilingual, any OpenAI-compatible server)
 * and streams the audio back; keys never reach the browser (server/voice). Voice
 * selection by patient sex, age band and language lives server-side too
 * (server/voice/profiles.py), so this module only forwards the profile.
 *
 * Autoplay: browsers block `audio.play()` outside a user gesture and our audio
 * arrives after an async fetch, so ONE persistent <audio> element is "unlocked"
 * on the Voice-toggle click (`unlockTts`, synchronous, inside the gesture) by
 * playing a silent clip. The same element is what the lip-sync analyser reads
 * (`getTtsAudioElement`), so the face follows the real audio.
 *
 * Degrades gracefully: a 503 (no provider can serve) disables voice for the
 * session and the patient stays text-only with the text-timed animation.
 */

import { playTtsStream, voiceApi, type Sex, type TtsMeta, type VoiceApi } from "@/lib/voiceApi";

export type { Sex };

export type VoiceProfile = { sex: Sex; age: number; lang: string };

// A short silent WAV used only to unlock playback within a user gesture.
const SILENT_WAV =
  "data:audio/wav;base64,UklGRjIAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQ4AAAAAAAAAAAAAAAAAAAAAAAA=";

let el: HTMLAudioElement | null = null;
let unlocked = false;
let disabledForSession = false;
let muted = false;
let api: VoiceApi = voiceApi;
let lastMeta: TtsMeta | null = null;
let lastFirstAudioMs: number | null = null;
let current: AbortController | null = null;

/** Swap the gateway client (tests). */
export function configureTts(client: VoiceApi): void {
  api = client;
}

function element(): HTMLAudioElement | null {
  if (typeof Audio === "undefined") return null;
  if (!el) {
    el = new Audio();
    el.preload = "auto";
    el.crossOrigin = "anonymous";
  }
  return el;
}

/** The shared playback element (for the Web Audio analyser); null outside a browser. */
export function getTtsAudioElement(): HTMLAudioElement | null {
  return element();
}

/**
 * Unlock audio playback: call SYNCHRONOUSLY from a user gesture (the Voice-on
 * click). Plays a silent clip on the persistent element so the browser then
 * permits programmatic playback of the streamed speech.
 */
export function unlockTts(): void {
  const a = element();
  if (!a || unlocked) return;
  try {
    a.muted = true;
    a.src = SILENT_WAV;
    const p = a.play();
    const done = () => {
      unlocked = true;
      try {
        a.pause();
        a.currentTime = 0;
      } catch {
        /* ignore */
      }
      a.muted = muted;
    };
    if (p && typeof p.then === "function") p.then(done).catch(() => (a.muted = muted));
    else done();
  } catch {
    /* ignore */
  }
}

/** Stop any patient audio currently playing (and cancel an in-flight download). */
export function stopTts(): void {
  current?.abort();
  current = null;
  if (el) {
    try {
      el.pause();
    } catch {
      /* ignore */
    }
  }
}

/** Pause without discarding the clip (call hold); `resumeTts` continues it. */
export function pauseTts(): void {
  try {
    el?.pause();
  } catch {
    /* ignore */
  }
}

export function resumeTts(): void {
  if (!el || !el.src) return;
  void el.play().catch(() => {});
}

/** Mute the patient's voice without stopping playback (the face keeps moving). */
export function setTtsMuted(next: boolean): void {
  muted = next;
  if (el) el.muted = next;
}

export function isTtsMuted(): boolean {
  return muted;
}

/** Provenance of the most recent synthesis (provider, model, duration, latency). */
export function lastTtsMeta(): (TtsMeta & { firstAudioMs: number | null }) | null {
  return lastMeta ? { ...lastMeta, firstAudioMs: lastFirstAudioMs } : null;
}

export interface SpeakOptions extends VoiceProfile {
  /** Fires once the clip's duration is known (0 when still unknown, e.g. MP3 via MediaSource). */
  onStart?: (durationMs: number) => void;
  /** Fires with the measured first-audio latency in ms. */
  onFirstAudio?: (latencyMs: number) => void;
  onEnded?: () => void;
  signal?: AbortSignal;
}

/**
 * Speak `text` in the patient's voice on the shared (unlocked) element. A new
 * call cancels the previous one. Returns whether audio began streaming; `false`
 * means the caller should fall back to the text-timed animation.
 */
export async function speakAsPatient(text: string, opts: SpeakOptions): Promise<boolean> {
  const clean = text?.trim();
  const a = element();
  if (!clean || disabledForSession || !a) return false;
  stopTts();
  const ctl = new AbortController();
  current = ctl;
  opts.signal?.addEventListener("abort", () => ctl.abort(), { once: true });
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  try {
    const res = await api.synthesize(
      { text: clean, lang: opts.lang, sex: opts.sex, age: opts.age, format: "mp3" },
      { signal: ctl.signal },
    );
    if (!res.ok) {
      if (res.error === "unavailable") disabledForSession = true; // nothing can serve; stop asking
      return false;
    }
    if (ctl.signal.aborted) return false;
    lastMeta = res.meta;
    lastFirstAudioMs = null;
    let started = false;
    const fireStart = (durationMs: number) => {
      if (started || ctl.signal.aborted) return;
      started = true;
      opts.onStart?.(durationMs);
    };
    a.muted = muted;
    const handle = playTtsStream(res.response, a, {
      signal: ctl.signal,
      startedAt,
      onFirstAudio: (ms) => {
        lastFirstAudioMs = ms;
        opts.onFirstAudio?.(ms);
        // Duration may stay unknown while streaming through MediaSource; the
        // analyser-driven lip-sync does not need it, so start the treatment now.
        fireStart(res.meta.durationMs ?? 0);
      },
      onDuration: (ms) => fireStart(ms),
    });
    void handle.done.then(() => {
      if (current === ctl) current = null;
      if (!ctl.signal.aborted) opts.onEnded?.();
    });
    return true;
  } catch {
    return false;
  }
}

/** True until the gateway has answered 503 (no provider can serve) this session. */
export function ttsMaybeAvailable(): boolean {
  return !disabledForSession;
}
