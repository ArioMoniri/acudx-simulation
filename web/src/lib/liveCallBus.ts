/**
 * liveCallBus: the link between the interview composer and the live patient video call.
 *
 * When the learner's call is live with the voice on, the interview request carries the call's
 * session id and the server speaks the patient's reply into the call while the persona model is still
 * writing it (docs/architecture/18 section 6.3.9). The reply then reaches the call tile as a normal
 * patient line; the tile must not speak it a second time, only measure it (speech start from the
 * moment the question was sent, lip offset). This module carries those two facts between the two
 * components: which call is live for a case thread, and which reply the server already spoke.
 */

export interface LiveCallEntry {
  threadId: string;
  sessionId: string;
  /** The voice is on right now (a muted or held call is not spoken into). */
  voiceOn: () => boolean;
}

export interface ServerSpoken {
  /** performance.now() when the learner's question was sent. */
  sentAt: number;
  sessionId: string;
}

const calls = new Map<string, LiveCallEntry>();
const spoken = new Map<string, ServerSpoken>();
const sends = new Map<string, number>();
const MAX_SPOKEN = 20;

function key(text: string): string {
  return text.normalize("NFC").replace(/\s+/g, " ").trim();
}

/** The tile registers its live call; returns the unregister function. */
export function registerLiveCall(entry: LiveCallEntry): () => void {
  calls.set(entry.threadId, entry);
  return () => {
    if (calls.get(entry.threadId) === entry) calls.delete(entry.threadId);
  };
}

/** The live call to speak into for this thread, or null (no call, or the voice is off). */
export function liveCallFor(threadId: string | null | undefined): string | null {
  if (!threadId) return null;
  const c = calls.get(threadId);
  return c && c.voiceOn() ? c.sessionId : null;
}

/** The composer sent a question on this thread (the tile measures speech start from here). */
export function markSent(threadId: string, at: number = now()): void {
  sends.set(threadId, at);
}

export function lastSent(threadId: string): number | null {
  return sends.get(threadId) ?? null;
}

/** The server spoke this reply into the call. */
export function markServerSpoken(text: string, info: ServerSpoken): void {
  spoken.set(key(text), info);
  while (spoken.size > MAX_SPOKEN) {
    const first = spoken.keys().next().value;
    if (first === undefined) break;
    spoken.delete(first);
  }
}

/** Whether the server already spoke this line (consumed once: a repeat of the same words is spoken). */
export function consumeServerSpoken(text: string): ServerSpoken | null {
  const k = key(text);
  const hit = spoken.get(k) ?? null;
  if (hit) spoken.delete(k);
  return hit;
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** Test seam: forget everything. */
export function resetLiveCallBus(): void {
  calls.clear();
  spoken.clear();
  sends.clear();
}
