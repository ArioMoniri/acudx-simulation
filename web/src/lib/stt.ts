/**
 * stt — microphone dictation for the learner, via the dev-server ElevenLabs
 * speech-to-text proxy (POST /stt). Records the mic with MediaRecorder, sends
 * the audio to the proxy (key stays server-side, see vite.config.ts), and
 * returns the transcript. Replaces the flaky browser Web Speech API.
 *
 * Everything degrades gracefully: no mic permission / unsupported / proxy
 * unconfigured (503) → returns null and the composer stays typed-only.
 */

export const sttSupported =
  typeof navigator !== "undefined" &&
  !!navigator.mediaDevices?.getUserMedia &&
  typeof MediaRecorder !== "undefined";

let stream: MediaStream | null = null;
let recorder: MediaRecorder | null = null;
let chunks: BlobPart[] = [];

function cleanup(): void {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  recorder = null;
  chunks = [];
}

/** Begin recording the mic. Returns false if unsupported or permission denied. */
export async function startRecording(): Promise<boolean> {
  if (!sttSupported || recorder) return false;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    const mime = MediaRecorder.isTypeSupported("audio/webm")
      ? "audio/webm"
      : MediaRecorder.isTypeSupported("audio/mp4")
        ? "audio/mp4"
        : "";
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size) chunks.push(e.data);
    };
    recorder.start();
    return true;
  } catch {
    cleanup();
    return false;
  }
}

export function isRecording(): boolean {
  return !!recorder && recorder.state === "recording";
}

/** Stop recording, transcribe via /stt, and return the text (or null). */
export async function stopAndTranscribe(lang?: string): Promise<string | null> {
  const rec = recorder;
  if (!rec) return null;
  const type = rec.mimeType || "audio/webm";
  const blob: Blob = await new Promise((resolve) => {
    rec.onstop = () => resolve(new Blob(chunks, { type }));
    try {
      rec.stop();
    } catch {
      resolve(new Blob(chunks, { type }));
    }
  });
  cleanup();
  if (!blob.size) return null;
  try {
    const fd = new FormData();
    fd.append("file", blob, "dictation." + (type.includes("mp4") ? "mp4" : "webm"));
    fd.append("model_id", "scribe_v1");
    if (lang) fd.append("language_code", lang);
    const res = await fetch("/stt", { method: "POST", body: fd });
    if (!res.ok) return null;
    const j = (await res.json().catch(() => null)) as { text?: string } | null;
    return j && typeof j.text === "string" ? j.text.trim() : null;
  } catch {
    return null;
  }
}

/** Abort an in-progress recording without transcribing. */
export function cancelRecording(): void {
  if (recorder && recorder.state !== "inactive") {
    try {
      recorder.stop();
    } catch {
      /* ignore */
    }
  }
  cleanup();
}
