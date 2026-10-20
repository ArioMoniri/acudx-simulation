/**
 * AcuDx: typed client for the v2 case generator and the Clinical Director
 * (server/orchestration/routes.py).
 *
 *   POST /v2/case/generate          -> CaseGenV2Result (spec + trace summary)
 *   POST /v2/case/generate/stream   -> SSE, one `node` event per graph node
 *   POST /v2/case/template          -> deterministic template, meta.source="template"
 *   POST /v2/director/step          -> DirectorStepResult
 *   GET  /v2/case/{thread_id}       -> CaseThreadResult (checkpoint read)
 *
 * Follows src/lib/backend.ts: every call is bounded by an AbortController
 * timeout and resolves to `{ ok, data } | { ok: false, error, status }`, never
 * throwing into the UI. The server answers 503 `model_unreachable` when the
 * model cannot be reached and never returns a template as a generated case;
 * the caller decides whether to show the template route's output as degraded.
 *
 * The spec is adapted to a CaseInstance with the existing `specToCaseInstance`
 * from src/lib/liveCaseGen.ts (re-exported here, not duplicated).
 *
 * Nothing here reads Date.now, mutates global state, or logs. Education only.
 */

import { BACKEND_URL, type BackendResult, type RequestOptions } from "@/lib/backend";
import { specToCaseInstance, type GeneratedCaseSpec } from "@/lib/liveCaseGen";
import type { CaseInstance } from "@/domain/case";
import { identityHeaders } from "@/lib/panelsApi";
import { getProfileState, selectLearnerId } from "@/state/profileStore";

export { specToCaseInstance };

/* -------------------------------------------------------------------------- */
/* Wire shapes (mirror server/orchestration)                                  */
/* -------------------------------------------------------------------------- */

export interface CaseGenV2Request {
  system?: string | null;
  difficulty?: 1 | 2 | 3 | 4 | 5 | null;
  complaint?: string | null;
  locale?: "en" | "tr";
  seed?: number | null;
  learner_id?: string | null;
  session_id?: string | null;
  thread_id?: string | null;
}

/** One OTel-style record per graph node (server/orchestration/trace.py). */
export interface TraceEvent {
  node: string;
  status: "ok" | "fail" | "skipped" | string;
  ts: number;
  latency_ms: number;
  model: string | null;
  model_requested: string | null;
  provider: string | null;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number | null;
  /** "token_table" or "gpu_hour_amortised" (self-hosted worker share of the GPU hour). */
  cost_basis?: string | null;
  price_table_version: string;
  attributes: Record<string, unknown>;
  note: string | null;
}

export interface TraceSummary {
  nodes: string[];
  model_calls: number;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
  /** Wall clock of the run (the parallel judges overlap, so it is below latency_ms). */
  wall_ms?: number;
  cost_usd: number | null;
  cost_basis?: string[];
  unpriced_models: string[];
  price_table_version: string;
}

export interface CouncilVerdict {
  round: number;
  votes: number;
  passes: number;
  vetoed: boolean;
  decision: "accept" | "repair";
  issues: string[];
  repair_hints: string[];
  /** Model opinions that cited no evidence: shown, never a veto. */
  notes?: string[];
}

/** Guideline anchor as attached by the `ground` node: always carries an id. */
export interface GroundedAnchor {
  statement_id: string;
  statement_en: string;
  statement_tr: string;
  source: string;
  citation: string;
}

export interface CaseGenV2Meta {
  source: "model" | "template";
  generator: "v2";
  model: string | string[] | null;
  models?: string[];
  condition_id: string;
  thread_id?: string;
  council?: {
    decision: "accept" | "repair" | null;
    rounds: number;
    repairs: number;
    vetoed: boolean;
    issues: string[];
    notes?: string[];
  };
  /** Fields the model left empty that the server filled from the condition fixture. */
  gap_filled?: string[];
  normalization?: string[];
  degraded: boolean;
  note: string | null;
  latency_ms: number;
  trace_summary?: TraceSummary;
}

/** The v2 spec: the v1 wire shape plus id-bearing anchors and richer meta. */
export type CaseGenV2Spec = Omit<GeneratedCaseSpec, "guideline_anchors" | "meta"> & {
  guideline_anchors?: GroundedAnchor[];
  meta: CaseGenV2Meta;
};

export interface CaseGenV2Result {
  thread_id: string;
  spec: CaseGenV2Spec;
  trace_summary: TraceSummary;
  trace: TraceEvent[];
  council: CouncilVerdict | null;
}

export interface CaseTemplateResult {
  spec: CaseGenV2Spec;
  trace_summary: null;
}

export interface CaseThreadResult {
  thread_id: string;
  status: string | null;
  spec: CaseGenV2Spec | null;
  council: CouncilVerdict | null;
  condition: Record<string, unknown> | null;
  trace_summary: TraceSummary;
  trace: TraceEvent[];
  next: string[];
}

/** Server error body for 5xx/4xx answers from /v2 (e.g. model_unreachable). */
export interface CaseGenV2Error {
  error: string;
  detail: string;
  [key: string]: unknown;
}

/* ---- Director ------------------------------------------------------------ */

export type DirectorActionKind = "question" | "exam" | "order" | "treatment" | "elapsed";

export interface DirectorAction {
  kind: DirectorActionKind;
  /** questionIntent | examManeuver | order code | treatment code. */
  ref?: string;
  /** Sim time this action consumes; server default per kind when omitted. */
  elapsed_ms?: number;
  utterance?: string;
  locale?: "en" | "tr";
}

export interface DirectorVitals {
  hr: number;
  systolic: number;
  diastolic: number;
  rr: number;
  spo2: number;
  tempC: number;
}

export interface DirectorAffect {
  pain: number;
  anxiety: number;
  dyspnea: number;
  consciousness: "alert" | "drowsy" | "unresponsive";
  mood_en: string;
  mood_tr: string;
}

/** Bedside state the Director derives every step (review 06b section 4.1). */
export interface DirectorBedside {
  map: number;
  gcs: number;
  avpu: string;
  cbg: number;
  k: number;
  lactate: number;
  crt_s: number;
  mottling: number;
  skin: string;
  urine_ml_h: number;
  pain: number;
  airway: string;
  rhythm: string;
  /** False in cardiac arrest: the vitals then read zero (no pulse, no trace). */
  pulse: boolean;
  fluid_in_ml: number;
  o2: boolean;
  news2: number;
}

export interface PatientVisibleChanges {
  t_ms: number;
  vitals: DirectorVitals;
  affect: DirectorAffect;
  utterance_en: string;
  utterance_tr: string;
  new_facts: string[];
  complications_fired: string[];
  trace: TraceEvent[];
  bedside?: DirectorBedside;
  phase?: "stable" | "improving" | "deteriorating" | "peri_arrest" | "arrest";
  severity?: number;
  active_diagnoses?: string[];
  /** Targets met or breached, harms, branches, arrest and ROSC this step, each with why. */
  events?: Array<{ id: string; kind: string; at_ms: number; reason: string; say_en?: string; say_tr?: string }>;
  targets?: Array<Record<string, unknown>>;
  /** What the results engine should read from the live Director (06b F19). */
  results?: Record<string, unknown>;
}

export interface DirectorNote {
  at_ms: number;
  note: string;
  why: string;
}

/** Opaque server-owned Director state; round-trip it unchanged between steps. */
export type DirectorCaseState = Record<string, unknown> & { t_ms: number };

export interface DirectorStepRequest {
  /** Either the state from the previous step ... */
  case_state?: DirectorCaseState;
  /** ... or the spec to start a fresh encounter from. */
  spec?: CaseGenV2Spec | GeneratedCaseSpec;
  action: DirectorAction;
  learner_id?: string | null;
  /** Allow the bounded narrator model call (default true server-side). */
  use_model?: boolean;
}

export interface DirectorStepResult {
  case_state: DirectorCaseState;
  patient_visible_changes: PatientVisibleChanges;
  director_notes: DirectorNote[];
}

/* -------------------------------------------------------------------------- */
/* SSE events                                                                 */
/* -------------------------------------------------------------------------- */

export type CaseGenV2Event =
  | { event: "start"; thread_id: string; pipeline: string[] }
  | { event: "node"; node: string; status: string | null; trace: TraceEvent[]; council?: CouncilVerdict }
  | { event: "done"; thread_id: string; spec: CaseGenV2Spec | null; trace_summary: TraceSummary }
  | { event: "error"; error: string; status: number; detail: string; thread_id?: string };

/* -------------------------------------------------------------------------- */
/* Core request helper (timeout + never-throw), as in backend.ts               */
/* -------------------------------------------------------------------------- */

const DEFAULT_TIMEOUTS = {
  // Author + three judges (+ up to two repairs) on a local model: generous. Kept
  // at the server SSE cap (SSE_MAX_DURATION_S, 600 s): at 240 s a live
  // generation with one repair was cut off (acceptance 2026-10-20).
  generate: 600_000,
  template: 8_000,
  director: 20_000,
  read: 8_000,
} as const;

const JSON_HEADERS: Record<string, string> = {
  "content-type": "application/json",
  accept: "application/json",
};

function reasonFor(err: unknown): string {
  if (err instanceof DOMException && err.name === "AbortError") return "timeout";
  if (err instanceof TypeError) return "network";
  if (err instanceof Error && err.message) return err.message.slice(0, 120);
  return "unknown";
}

function composeSignal(timeoutMs: number, external?: AbortSignal): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

async function request<T>(
  path: string,
  init: RequestInit,
  timeoutMs: number,
  external?: AbortSignal,
): Promise<BackendResult<T>> {
  const { signal, clear } = composeSignal(timeoutMs, external);
  try {
    // The server binds learner memory and checkpoints to the caller (review 04 O3), so every
    // call carries the same identity the panels use: the bearer, else the local headers.
    const headers = { ...(await identityHeaders()), ...((init.headers as Record<string, string>) ?? {}) };
    const res = await fetch(`${BACKEND_URL}${path}`, { ...init, headers, signal });
    if (!res.ok) {
      // Surface the server's error code (model_unreachable, thread_not_found, ...)
      // when it sent one, so the UI can explain instead of guessing.
      let code = `http_${res.status}`;
      try {
        const body = (await res.json()) as Partial<CaseGenV2Error>;
        if (typeof body.error === "string" && body.error) code = body.error;
      } catch {
        // non-JSON error body: keep the http_<status> reason
      }
      return { ok: false, error: code, status: res.status };
    }
    const data = (await res.json()) as T;
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: reasonFor(err) };
  } finally {
    clear();
  }
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Fill `learner_id` from the active profile when the caller left it undefined,
 * so the Director memory is written for the signed-in or local learner
 * (architecture 15 section 10). An explicit value, including null, is kept:
 * a faculty preview can opt out of writing a learner's memory.
 */
export function withLearnerId<T extends { learner_id?: string | null }>(req: T): T {
  if (req.learner_id !== undefined) return req;
  const id = selectLearnerId(getProfileState());
  return id ? { ...req, learner_id: id } : req;
}

/** Run the full generator graph and wait for the finished case. */
export function generateCaseV2(
  req: CaseGenV2Request,
  opts: RequestOptions = {},
): Promise<BackendResult<CaseGenV2Result>> {
  return request<CaseGenV2Result>(
    "/v2/case/generate",
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(withLearnerId(req)) },
    opts.timeoutMs ?? DEFAULT_TIMEOUTS.generate,
    opts.signal,
  );
}

/** The deterministic template, honestly labelled (meta.source === "template"). */
export function templateCaseV2(
  req: CaseGenV2Request,
  opts: RequestOptions = {},
): Promise<BackendResult<CaseTemplateResult>> {
  return request<CaseTemplateResult>(
    "/v2/case/template",
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(req) },
    opts.timeoutMs ?? DEFAULT_TIMEOUTS.template,
    opts.signal,
  );
}

/** Read a checkpointed run by its thread id. */
export function readCaseThread(
  threadId: string,
  opts: RequestOptions = {},
): Promise<BackendResult<CaseThreadResult>> {
  return request<CaseThreadResult>(
    `/v2/case/${encodeURIComponent(threadId)}`,
    { method: "GET", headers: { accept: "application/json" } },
    opts.timeoutMs ?? DEFAULT_TIMEOUTS.read,
    opts.signal,
  );
}

/** One Clinical Director step for a learner action. */
export function directorStep(
  req: DirectorStepRequest,
  opts: RequestOptions = {},
): Promise<BackendResult<DirectorStepResult>> {
  return request<DirectorStepResult>(
    "/v2/director/step",
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(withLearnerId(req)) },
    opts.timeoutMs ?? DEFAULT_TIMEOUTS.director,
    opts.signal,
  );
}

/* -------------------------------------------------------------------------- */
/* SSE consumer                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Parse complete SSE blocks out of a text buffer. Returns the parsed events
 * and the unconsumed remainder (a partial block still being received). Pure.
 */
export function parseSseBuffer(buffer: string): { events: CaseGenV2Event[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const blocks = normalized.split("\n\n");
  const rest = blocks.pop() ?? "";
  const events: CaseGenV2Event[] = [];
  for (const block of blocks) {
    let name = "";
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) name = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (!name || dataLines.length === 0) continue;
    try {
      const payload = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
      events.push({ ...payload, event: name } as CaseGenV2Event);
    } catch {
      // A malformed data line is dropped; the stream keeps going.
    }
  }
  return { events, rest };
}

export interface StreamOptions extends RequestOptions {
  /** Called for every event in order (start, node..., done | error). */
  onEvent: (event: CaseGenV2Event) => void;
}

/**
 * Stream the generator run as SSE (POST, so EventSource cannot be used). The
 * returned result is the final `done` payload, or an error when the server
 * answered with a non-2xx status, the stream sent an `error` event, or the
 * connection failed. Never throws.
 */
export async function streamCaseGenV2(
  req: CaseGenV2Request,
  opts: StreamOptions,
): Promise<BackendResult<{ thread_id: string; spec: CaseGenV2Spec | null; trace_summary: TraceSummary }>> {
  const { signal, clear } = composeSignal(opts.timeoutMs ?? DEFAULT_TIMEOUTS.generate, opts.signal);
  try {
    const res = await fetch(`${BACKEND_URL}/v2/case/generate/stream`, {
      method: "POST",
      headers: { ...(await identityHeaders()), "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify(withLearnerId(req)),
      signal,
    });
    if (!res.ok) {
      let code = `http_${res.status}`;
      try {
        const body = (await res.json()) as Partial<CaseGenV2Error>;
        if (typeof body.error === "string" && body.error) code = body.error;
      } catch {
        // keep http_<status>
      }
      return { ok: false, error: code, status: res.status };
    }
    if (!res.body) return { ok: false, error: "no_body" };
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let done: { thread_id: string; spec: CaseGenV2Spec | null; trace_summary: TraceSummary } | null = null;
    let failure: BackendResult<never> | null = null;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const parsed = parseSseBuffer(buffer);
      buffer = parsed.rest;
      for (const ev of parsed.events) {
        opts.onEvent(ev);
        if (ev.event === "done") done = { thread_id: ev.thread_id, spec: ev.spec, trace_summary: ev.trace_summary };
        if (ev.event === "error") failure = { ok: false, error: ev.error, status: ev.status };
      }
    }
    const tail = parseSseBuffer(`${buffer}\n\n`);
    for (const ev of tail.events) {
      opts.onEvent(ev);
      if (ev.event === "done") done = { thread_id: ev.thread_id, spec: ev.spec, trace_summary: ev.trace_summary };
      if (ev.event === "error") failure = { ok: false, error: ev.error, status: ev.status };
    }
    if (failure) return failure;
    if (!done) return { ok: false, error: "stream_incomplete" };
    return { ok: true, data: done };
  } catch (err) {
    return { ok: false, error: reasonFor(err) };
  } finally {
    clear();
  }
}

/* -------------------------------------------------------------------------- */
/* Adapter                                                                    */
/* -------------------------------------------------------------------------- */

/** Provenance of a v2 case as the UI should label it. */
export type CaseGenV2Source = "ai" | "template";

export interface CaseGenV2Instance {
  case: CaseInstance;
  source: CaseGenV2Source;
  degraded: boolean;
  meta: CaseGenV2Meta;
}

/**
 * Adapt a v2 spec to a CaseInstance via the shared `specToCaseInstance`. The
 * id-bearing anchors are a superset of the v1 anchor shape, so the spec passes
 * through unchanged. `source` is "template" only when the server said so.
 */
export function v2SpecToCaseInstance(spec: CaseGenV2Spec): CaseGenV2Instance {
  const instance = specToCaseInstance(spec as unknown as GeneratedCaseSpec);
  return {
    case: instance,
    source: spec.meta.source === "template" ? "template" : "ai",
    degraded: Boolean(spec.meta.degraded),
    meta: spec.meta,
  };
}
