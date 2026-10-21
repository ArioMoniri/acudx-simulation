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
 * on the call / Voice-on click (`unlockTts`, synchronous, inside the gesture) by
 * playing a silent clip. The same element is what the lip-sync analyser reads
 * (`getTtsAudioElement`), so the face follows the real audio.
 *
 * Never silent while the GPU boots: the gateway answers a fast 503 with
 * `pending_launch` while the on-demand worker starts, and then the line is spoken
 * by the browser's own speech synthesis (a voice matching the case language and the
 * patient's sex when one is installed). Every later line asks the gateway again, so
 * the patient switches to the server voice as soon as the worker is ready. Only a
 * permanent refusal (air-gapped, nothing configured) stops asking for the session;
 * the browser voice still speaks then.
 */

import { playTtsStream, voiceApi, type Sex, type TtsMeta, type VoiceApi } from "@/lib/voiceApi";

export type { Sex };

export type VoiceProfile = { sex: Sex; age: number; lang: string };

/** Which engine voiced the most recent line. */
export type SpeechEngine = "server" | "browser";

// A short silent WAV used only to unlock playback within a user gesture.
const SILENT_WAV =
  "data:audio/wav;base64,UklGRjIAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQ4AAAAAAAAAAAAAAAAAAAAAAAA=";

// The server can take a while to answer for a worker that is up but busy; past this the
// line goes to the browser voice instead of arriving late.
const SERVER_HEADER_TIMEOUT_MS = 15_000;

let el: HTMLAudioElement | null = null;
let unlocked = false;
let speechPrimed = false;
let disabledForSession = false;
let muted = false;
let api: VoiceApi = voiceApi;
let lastMeta: TtsMeta | null = null;
let lastFirstAudioMs: number | null = null;
let lastEngine: SpeechEngine | null = null;
let current: AbortController | null = null;

/** Swap the gateway client (tests). */
export function configureTts(client: VoiceApi): void {
  api = client;
}

/** Forget the per-session state (tests). */
export function resetTtsForTests(): void {
  el = null;
  unlocked = false;
  speechPrimed = false;
  disabledForSession = false;
  muted = false;
  lastMeta = null;
  lastFirstAudioMs = null;
  lastEngine = null;
  current = null;
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

function synth(): SpeechSynthesis | null {
  if (typeof globalThis === "undefined") return null;
  const s = (globalThis as { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
  return s && typeof (globalThis as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance === "function"
    ? s
    : null;
}

/** The shared playback element (for the Web Audio analyser); null outside a browser. */
export function getTtsAudioElement(): HTMLAudioElement | null {
  return element();
}

/**
 * Unlock audio playback: call SYNCHRONOUSLY from a user gesture (the call or
 * Voice-on click). Plays a silent clip on the persistent element so the browser
 * then permits programmatic playback of the streamed speech, and primes the
 * browser speech synthesis (iOS only speaks after a first utterance in a gesture).
 */
export function unlockTts(): void {
  const s = synth();
  if (s && !speechPrimed) {
    speechPrimed = true;
    try {
      s.getVoices(); // starts the async voice list load in Chrome
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      s.speak(u);
    } catch {
      /* ignore */
    }
  }
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
  try {
    synth()?.cancel();
  } catch {
    /* ignore */
  }
}

/** Pause without discarding the clip (call hold); `resumeTts` continues it. */
export function pauseTts(): void {
  try {
    el?.pause();
    synth()?.pause();
  } catch {
    /* ignore */
  }
}

export function resumeTts(): void {
  try {
    synth()?.resume();
  } catch {
    /* ignore */
  }
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

/** Which engine voiced the most recent line (null before the first). */
export function lastSpeechEngine(): SpeechEngine | null {
  return lastEngine;
}

/* -------------------------------------------------------------------------- */
/* Browser speech (the voice while the GPU worker boots)                        */
/* -------------------------------------------------------------------------- */

// Common installed voices by sex (Windows / Edge, macOS / iOS, Android, Chrome). Names only
// carry a hint; anything unknown is treated as neutral and ranked after a match.
const FEMALE_HINTS = [
  "female", "woman", "zira", "aria", "jenny", "samantha", "victoria", "karen", "moira", "tessa", "fiona",
  "susan", "hazel", "serena", "allison", "ava", "emma", "michelle", "libby", "sonia", "natasha", "emel",
  "yelda", "seda", "filiz", "kadın",
];
const MALE_HINTS = [
  "male", "man", "david", "mark", "guy", "daniel", "alex", "fred", "tom", "oliver", "george", "ryan",
  "william", "james", "christopher", "eric", "rishi", "aaron", "arthur", "ahmet", "tolga", "cem", "erkek",
];

function hasHint(name: string, hints: string[]): boolean {
  const words = name.toLowerCase().split(/[^a-zçğıöşü]+/);
  return hints.some((h) => words.includes(h));
}

/**
 * Pick the installed voice for `lang` ("en" | "tr") that best fits the patient's sex:
 * same language AND a matching name hint first, then a same-language voice that is not
 * the other sex, then any same-language voice. Null when none speaks the language (the
 * utterance then carries only `lang` and the browser picks its default).
 */
export function pickBrowserVoice(
  voices: ReadonlyArray<Pick<SpeechSynthesisVoice, "lang" | "name" | "localService" | "default">>,
  lang: string,
  sex: Sex,
): SpeechSynthesisVoice | null {
  const want = (lang || "en").toLowerCase().split("-")[0];
  const same = voices.filter((v) => (v.lang || "").toLowerCase().replace("_", "-").split("-")[0] === want);
  if (same.length === 0) return null;
  const mine = sex === "female" ? FEMALE_HINTS : MALE_HINTS;
  const other = sex === "female" ? MALE_HINTS : FEMALE_HINTS;
  const score = (v: (typeof same)[number]) =>
    (hasHint(v.name, mine) && !hasHint(v.name, other) ? 4 : 0) +
    (hasHint(v.name, other) && !hasHint(v.name, mine) ? -4 : 0) +
    (v.localService ? 1 : 0) +
    (v.default ? 0.5 : 0);
  const ranked = [...same].sort((a, b) => score(b) - score(a));
  return ranked[0] as SpeechSynthesisVoice;
}

/** A rough spoken length (ms) for a line, used as the clip's safety cap if `onend` never fires. */
export function estimateSpeechMs(text: string): number {
  return Math.max(1200, Math.round(text.length * 75));
}

/** True when the browser can speak (Web Speech API speech synthesis). */
export function browserSpeechAvailable(): boolean {
  return synth() !== null;
}

function speakWithBrowser(text: string, opts: SpeakOptions, ctl: AbortController): boolean {
  const s = synth();
  if (!s) return false;
  try {
    s.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const lang = (opts.lang || "en").toLowerCase().split("-")[0];
    u.lang = lang === "tr" ? "tr-TR" : lang === "en" ? "en-US" : lang;
    const voice = pickBrowserVoice(s.getVoices?.() ?? [], lang, opts.sex);
    if (voice) u.voice = voice;
    // An older patient speaks a little lower and slower.
    u.pitch = opts.age >= 65 ? 0.9 : 1;
    u.rate = opts.age >= 65 ? 0.92 : 1;
    u.volume = muted ? 0 : 1;
    let started = false;
    let ended = false;
    const start = () => {
      if (started || ctl.signal.aborted) return;
      started = true;
      opts.onStart?.(estimateSpeechMs(text), "browser");
    };
    const end = () => {
      if (ended) return;
      ended = true;
      if (current === ctl) current = null;
      if (!ctl.signal.aborted) opts.onEnded?.();
    };
    u.onstart = start;
    u.onend = end;
    u.onerror = end;
    ctl.signal.addEventListener("abort", () => {
      try {
        s.cancel();
      } catch {
        /* ignore */
      }
    }, { once: true });
    lastEngine = "browser";
    s.speak(u);
    return true;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Speaking a patient line                                                      */
/* -------------------------------------------------------------------------- */

export interface SpeakOptions extends VoiceProfile {
  /**
   * Fires once the line starts: with the clip's duration when known (0 when still unknown,
   * e.g. MP3 via MediaSource), and which engine speaks it. The browser engine reports an
   * estimate; its `onEnded` fires on the real end of speech.
   */
  onStart?: (durationMs: number, engine: SpeechEngine) => void;
  /** Fires with the measured first-audio latency in ms (server engine). */
  onFirstAudio?: (latencyMs: number) => void;
  onEnded?: () => void;
  signal?: AbortSignal;
  /** Speak with the browser when the gateway cannot (default true). */
  browserFallback?: boolean;
}

/**
 * Speak `text` in the patient's voice. A new call cancels the previous one. The
 * gateway voice is tried first (unless refused for the session); when it cannot
 * serve (worker booting, refused, timed out) the browser voice speaks instead.
 * Returns whether any voice began; `false` means the caller should fall back to
 * the text-timed animation.
 */
export async function speakAsPatient(text: string, opts: SpeakOptions): Promise<boolean> {
  const clean = text?.trim();
  if (!clean) return false;
  stopTts();
  const ctl = new AbortController();
  current = ctl;
  opts.signal?.addEventListener("abort", () => ctl.abort(), { once: true });
  const fallback = () => (opts.browserFallback === false || ctl.signal.aborted ? false : speakWithBrowser(clean, opts, ctl));
  const a = element();
  if (disabledForSession || !a) return fallback();
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  try {
    const res = await api.synthesize(
      { text: clean, lang: opts.lang, sex: opts.sex, age: opts.age, format: "mp3" },
      { signal: ctl.signal, timeoutMs: SERVER_HEADER_TIMEOUT_MS },
    );
    if (ctl.signal.aborted) return false;
    if (!res.ok) {
      // Only a permanent refusal stops asking; a booting worker (pending_launch) is asked
      // again on the next line, so the server voice takes over once it is ready.
      if (res.error === "unavailable" && !res.pendingLaunch) disabledForSession = true;
      return fallback();
    }
    lastMeta = res.meta;
    lastFirstAudioMs = null;
    lastEngine = "server";
    let started = false;
    const fireStart = (durationMs: number) => {
      if (started || ctl.signal.aborted) return;
      started = true;
      opts.onStart?.(durationMs, "server");
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
    return fallback();
  }
}

/** True until the gateway has refused voice for good (503 without `pending_launch`) this session. */
export function ttsMaybeAvailable(): boolean {
  return !disabledForSession;
}
