/**
 * tts — real patient voice via the dev-server ElevenLabs proxy (POST /tts).
 *
 * The API key lives only in the Node dev server (see vite.config.ts); the
 * browser just POSTs text + a voice id and plays the returned audio. Everything
 * degrades gracefully: if the proxy is unconfigured (503) or unreachable, the
 * patient simply stays text-only and we stop retrying for the session.
 *
 * Voices are ElevenLabs premade voices (available on every account), chosen by
 * the patient's sex so the voice matches the person on screen.
 */

type Sex = "male" | "female";

// ElevenLabs premade voice ids (stable across accounts).
const VOICE: Record<Sex, { younger: string; older: string }> = {
  // Rachel (warm) / Dorothy (older, softer)
  female: { younger: "21m00Tcm4TlvDq8ikWAM", older: "ThT5KcBeYPX3keUQqHPh" },
  // Josh (younger) / Adam (older, deeper)
  male: { younger: "TxGEqnHWrfWFTfGW9XjX", older: "pNInz6obpgDQGcFmaJgB" },
};

/** Pick a voice id for a patient by sex + age band. */
export function voiceIdFor(sex: Sex, age: number): string {
  const bySex = VOICE[sex] ?? VOICE.male;
  return age >= 55 ? bySex.older : bySex.younger;
}

let current: HTMLAudioElement | null = null;
let disabledForSession = false;

/** Stop any patient audio currently playing. */
export function stopTts(): void {
  if (current) {
    try {
      current.pause();
      current.src = "";
    } catch {
      /* ignore */
    }
    current = null;
  }
}

/**
 * Speak `text` in the patient's voice. Resolves when playback starts (or
 * silently no-ops if TTS is unavailable). A new call cancels the previous one.
 * Returns whether audio actually began, so the caller can drive a speaking state.
 */
export async function speakAsPatient(
  text: string,
  opts: { sex: Sex; age: number; onEnded?: () => void; signal?: AbortSignal },
): Promise<boolean> {
  const clean = text?.trim();
  if (!clean || disabledForSession) return false;
  stopTts();
  try {
    const res = await fetch("/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: clean,
        voiceId: voiceIdFor(opts.sex, opts.age),
      }),
      signal: opts.signal,
    });
    if (res.status === 503) {
      // Proxy has no key configured — don't hammer it again this session.
      disabledForSession = true;
      return false;
    }
    if (!res.ok) return false;
    const blob = await res.blob();
    if (opts.signal?.aborted) return false;
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    current = audio;
    const cleanup = () => {
      URL.revokeObjectURL(url);
      if (current === audio) current = null;
    };
    audio.addEventListener("ended", () => {
      cleanup();
      opts.onEnded?.();
    });
    audio.addEventListener("error", cleanup);
    await audio.play().catch(() => {
      /* autoplay blocked or interrupted — stay silent */
      cleanup();
    });
    return current === audio;
  } catch {
    return false;
  }
}

/** True until the proxy has told us (via a 503) that no key is configured. */
export function ttsMaybeAvailable(): boolean {
  return !disabledForSession;
}
