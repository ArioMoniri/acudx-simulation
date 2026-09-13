/**
 * tts — real patient voice via the dev-server ElevenLabs proxy (POST /tts).
 *
 * The API key lives only in the Node dev server (see vite.config.ts); the
 * browser POSTs text + a voice id and plays the returned audio. It degrades
 * gracefully: if the proxy is unconfigured (503) or unreachable, the patient
 * stays text-only and we stop retrying for the session.
 *
 * Autoplay: browsers block `audio.play()` that isn't inside a user gesture, and
 * our audio arrives AFTER an async fetch (out of the gesture). So we keep ONE
 * persistent <audio> element and "unlock" it on the Voice-toggle click
 * (`unlockTts()`, synchronous, inside the gesture) by playing a silent clip;
 * after that, programmatic playback of the fetched speech is allowed.
 *
 * Voices are ElevenLabs premade voices (on every account), chosen by the
 * patient's sex + age so the voice matches the person on screen.
 */

type Sex = "male" | "female";

const VOICE: Record<Sex, { younger: string; older: string }> = {
  female: { younger: "21m00Tcm4TlvDq8ikWAM", older: "ThT5KcBeYPX3keUQqHPh" },
  male: { younger: "TxGEqnHWrfWFTfGW9XjX", older: "pNInz6obpgDQGcFmaJgB" },
};

/** Pick a voice id for a patient by sex + age band. */
export function voiceIdFor(sex: Sex, age: number): string {
  const bySex = VOICE[sex] ?? VOICE.male;
  return age >= 55 ? bySex.older : bySex.younger;
}

// A short silent WAV used only to unlock playback within a user gesture.
const SILENT_WAV =
  "data:audio/wav;base64,UklGRjIAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQ4AAAAAAAAAAAAAAAAAAAAAAAA=";

let el: HTMLAudioElement | null = null;
let unlocked = false;
let disabledForSession = false;

function element(): HTMLAudioElement | null {
  if (typeof Audio === "undefined") return null;
  if (!el) {
    el = new Audio();
    el.preload = "auto";
  }
  return el;
}

/**
 * Unlock audio playback — call SYNCHRONOUSLY from a user gesture (the Voice-on
 * click). Plays a silent clip on the persistent element so the browser then
 * permits programmatic playback of the fetched speech.
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
      a.muted = false;
    };
    if (p && typeof p.then === "function") p.then(done).catch(() => (a.muted = false));
    else done();
  } catch {
    /* ignore */
  }
}

/** Stop any patient audio currently playing. */
export function stopTts(): void {
  if (el) {
    try {
      el.pause();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Speak `text` in the patient's voice on the shared (unlocked) element. A new
 * call cancels the previous one. `onEnded` fires when playback finishes so the
 * caller can drive a speaking state that matches the actual audio length.
 * Returns whether audio began.
 */
export async function speakAsPatient(
  text: string,
  opts: { sex: Sex; age: number; onEnded?: () => void; signal?: AbortSignal },
): Promise<boolean> {
  const clean = text?.trim();
  const a = element();
  if (!clean || disabledForSession || !a) return false;
  stopTts();
  try {
    const res = await fetch("/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: clean, voiceId: voiceIdFor(opts.sex, opts.age) }),
      signal: opts.signal,
    });
    if (res.status === 503) {
      disabledForSession = true; // no key configured — don't hammer it again
      return false;
    }
    if (!res.ok) return false;
    const url = URL.createObjectURL(await res.blob());
    if (opts.signal?.aborted) {
      URL.revokeObjectURL(url);
      return false;
    }
    const onDone = () => {
      URL.revokeObjectURL(url);
      opts.onEnded?.();
    };
    a.onended = onDone;
    a.onerror = () => URL.revokeObjectURL(url);
    a.muted = false;
    a.src = url;
    a.currentTime = 0;
    await a.play().catch(() => {
      /* blocked despite unlock — stay silent */
    });
    return true;
  } catch {
    return false;
  }
}

/** True until the proxy has told us (via a 503) that no key is configured. */
export function ttsMaybeAvailable(): boolean {
  return !disabledForSession;
}
