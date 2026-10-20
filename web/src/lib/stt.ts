/**
 * stt: microphone dictation for the learner through the gateway
 * (POST /api/v1/voice/stt). Records the mic with MediaRecorder, sends the clip,
 * and returns the transcript. The gateway picks the provider from the admin
 * registry (Deepgram Nova-3, ElevenLabs Scribe, the GPU worker's speaches with
 * faster-whisper large-v3-turbo); keys stay server-side.
 *
 * Everything degrades gracefully: no mic permission / unsupported / no provider
 * (503) returns null and the composer stays typed-only.
 */

import { voiceApi, type SttResponse, type VoiceApi } from "@/lib/voiceApi";

export const sttSupported =
  typeof navigator !== "undefined" &&
  !!navigator.mediaDevices?.getUserMedia &&
  typeof MediaRecorder !== "undefined";

let stream: MediaStream | null = null;
let recorder: MediaRecorder | null = null;
let chunks: BlobPart[] = [];
let api: VoiceApi = voiceApi;
let disabledForSession = false;
let lastResult: SttResponse | null = null;

/** Swap the gateway client (tests). */
export function configureStt(client: VoiceApi): void {
  api = client;
}

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

/** Transcribe an already recorded clip (shared by the mic path and tests). */
export async function transcribeBlob(blob: Blob, lang?: string): Promise<string | null> {
  if (!blob.size || disabledForSession) return null;
  const res = await api.transcribe(blob, { lang });
  if (!res.ok) {
    if (res.status === 503) disabledForSession = true;
    return null;
  }
  lastResult = res.data;
  const text = res.data.text?.trim();
  return text ? text : null;
}

/** Stop recording, transcribe via the gateway, and return the text (or null). */
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
  try {
    return await transcribeBlob(blob, lang);
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

/** Provider, language and confidence of the last transcript (for captions / telemetry). */
export function lastSttResult(): SttResponse | null {
  return lastResult;
}

/** True until the gateway has answered 503 (no provider can serve) this session. */
export function sttMaybeAvailable(): boolean {
  return !disabledForSession;
}
