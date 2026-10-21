/**
 * Patient interview API: POST /v2/case/{threadId}/interview (server/interview/routes.py).
 *
 * The reply contract for the generative chat UI is documented in
 * docs/architecture/20-chat-contract.md. Every typed or transcribed student message goes
 * here; the server labels it (guard), answers in character from the server-held case and,
 * with guidance on, adds suggested actions. The question list in the UI stays a list of
 * suggestions: a click sends the same message a typed question would.
 *
 * Honesty: a 503 `model_unreachable` means no patient model answered. The caller shows its
 * own labelled offline path; this client never fabricates a reply.
 */

import { BACKEND_URL, type BackendResult, type RequestOptions } from "@/lib/backend";
import { identityHeaders } from "@/lib/panelsApi";

/** Guard labels (server/interview/guard.py LABELS). */
export type GuardLabel =
  | "clinical"
  | "off_topic"
  | "meta_injection"
  | "diagnosis_request"
  | "unsafe"
  | "other_language";

/** Structured reason codes (server/interview/guard.py REASONS). */
export type GuardReason =
  | "in_scope"
  | "greeting"
  | "explanation"
  | "small_talk"
  | "instruction_override"
  | "prompt_exfiltration"
  | "role_break"
  | "diagnosis_request"
  | "answer_request"
  | "self_harm_disclosure"
  | "abuse_disclosure"
  | "abuse_toward_patient"
  | "unsupported_language";

/** The guard block: `note` is a short neutral line in the reply locale, absent for `clinical`. */
export interface InterviewGuard {
  label: GuardLabel;
  reason: GuardReason;
  note?: string;
}

export type OrderCodeSystem = "LOINC" | "RADLEX" | "local";
export type NavigateTarget = "results" | "imaging" | "orders" | "vitals" | "notes" | "diagnosis" | "guide";

export interface OrderAction {
  kind: "order";
  code: string;
  system: OrderCodeSystem;
  label: string;
}

export interface NavigateAction {
  kind: "navigate";
  target: NavigateTarget;
  ref?: string;
}

export interface AskAction {
  kind: "ask";
  text: string;
}

/** Suggested next steps (attending / tutor layer). Empty unless guidance is on. */
export type InterviewAction = OrderAction | NavigateAction | AskAction;

/** History intents a clinical question maps to (server/orchestration/staged.HISTORY_CLUSTERS). */
export type HistoryIntent =
  | "onset" | "location" | "character" | "radiation" | "severity" | "timing" | "aggravating" | "relieving"
  | "associated-symptoms" | "red-flags" | "risk-factors" | "ice"
  | "past-medical-history" | "medications" | "allergies" | "family-history" | "social-history";

export interface InterviewRequest {
  message: string;
  /** UI locale; the reply follows the language the student wrote in. */
  locale?: "en" | "tr";
  /** Guidance mode: when false the server returns no actions (never a hint of the answer). */
  guidance?: boolean;
  client_id?: string;
  /** The message came from speech-to-text. */
  voiced?: boolean;
  /** The learner's live patient video call on this thread: the server speaks the reply into it as it is written. */
  call_session_id?: string;
}

export interface InterviewMeta {
  /** "model" (persona model), "safety" (crisis resources, no model call). */
  source: "model" | "safety";
  model?: string;
  provider?: string;
  latency_ms?: number;
  total_ms?: number;
  /** "rules", "model" or "rules+model". */
  guard_source: string;
  guard_model?: string | null;
  guard_rule?: string | null;
  tutor_source?: "model" | "rules";
  /** Present when the live call already speaks the reply (the tile must not speak it again). */
  voice?: { spoken_by: "call"; session_id: string };
  /** The persona call ran next to the guard: "kept" when its prompt matched, else "restarted". */
  speculative?: "kept" | "restarted";
  /** Milliseconds from the message's arrival: guard_ms, persona_first_text_ms, persona_done_ms, ... */
  timings?: Record<string, number>;
}

export interface InterviewFlag {
  type: string;
  [key: string]: unknown;
}

export interface InterviewReply {
  thread_id: string;
  /** The patient's in-character reply (or the crisis-resource text for a disclosure). */
  reply: string;
  guard: InterviewGuard;
  actions: InterviewAction[];
  /** The history intent of a clinical question, or null. */
  intent: HistoryIntent | null;
  /** The history layer this question drew on and marked seen, or null. */
  layer: string | null;
  /** True for a clinical message: the encounter state may advance. */
  state_advance: boolean;
  flags: InterviewFlag[];
  meta: InterviewMeta;
}

export interface InterviewTurn {
  role: "doctor" | "patient";
  text: string;
  ts: number;
  label?: GuardLabel | null;
  intent?: HistoryIntent | null;
}

/** Labels that should show the guard note next to the reply. */
export function showsGuardNote(guard: InterviewGuard | null | undefined): boolean {
  return !!guard && guard.label !== "clinical" && !!guard.note;
}

const TIMEOUT_MS = 45_000;

async function call<T>(path: string, init: RequestInit, opts: RequestOptions): Promise<BackendResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? TIMEOUT_MS);
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  try {
    const headers = { ...(await identityHeaders()), ...((init.headers as Record<string, string>) ?? {}) };
    const res = await fetch(`${BACKEND_URL}${path}`, { ...init, headers, signal: controller.signal });
    if (!res.ok) {
      let code = `http_${res.status}`;
      try {
        const body = (await res.json()) as { error?: unknown };
        if (typeof body.error === "string" && body.error) code = body.error;
      } catch {
        // non-JSON error body: keep http_<status>
      }
      return { ok: false, error: code, status: res.status };
    }
    return { ok: true, data: (await res.json()) as T };
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === "AbortError";
    return { ok: false, error: aborted ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}

/** One student message to the patient of `threadId`. */
export function interviewTurn(
  threadId: string,
  req: InterviewRequest,
  opts: RequestOptions = {},
): Promise<BackendResult<InterviewReply>> {
  return call<InterviewReply>(
    `/v2/case/${encodeURIComponent(threadId)}/interview`,
    { method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(req) },
    opts,
  );
}

/** The server-held transcript of `threadId` (reload, room members). */
export function interviewLog(
  threadId: string,
  opts: RequestOptions = {},
): Promise<BackendResult<{ thread_id: string; turns: InterviewTurn[] }>> {
  return call(`/v2/case/${encodeURIComponent(threadId)}/interview`,
    { method: "GET", headers: { accept: "application/json" } }, opts);
}
