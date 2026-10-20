/**
 * AcuDx: typed client for the v2 case generator and the Clinical Director
 * (server/orchestration/routes.py).
 *
 *   POST /v2/case/generate/stream   -> SSE (review 06a 4.6): start, kernel, opening.delta*,
 *                                      opening.ready, layer.pending / layer.ready, judge, done
 *   GET  /v2/case/{thread_id}/events?after=<id>  -> SSE reconnect for the same thread
 *   POST /v2/case/{thread_id}/layer/{layer}      -> one layer, generated on first access
 *   POST /v2/case/generate          -> CaseGenV2Result (the staged run, core layers in)
 *   POST /v2/director/step          -> DirectorStepResult (bound to thread_id)
 *   GET  /v2/case/{thread_id}       -> CaseThreadResult (server-authoritative case state)
 *   GET  /v2/cases/mine             -> the learner's own generated encounters
 *
 * Owner decision: every learner case is generated on request by the model and
 * changes in flight. There is no template, seed or library client here; a
 * model outage is reported (503) and the UI offers Retry, nothing else.
 *
 * Follows src/lib/backend.ts: every call is bounded by an AbortController
 * timeout and resolves to `{ ok, data } | { ok: false, error, status }`, never
 * throwing into the UI. The server answers 503 `model_unreachable` when the
 * model cannot be reached and never returns a template as a generated case.
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
  /** Faculty generation constraints (never a fixed case). */
  blueprint?: { condition_id?: string | null; difficulty?: number | null; objectives?: string[] } | null;
  /** Where the request came from (telemetry only). */
  purpose?: "encounter" | "room" | "exam" | "authoring";
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
  /** "staged": opening first, layers on access or by same-thread continuation. */
  pipeline?: "staged";
  /** Generated language (one locale per call). */
  locale?: "en" | "tr";
  /** Layer name -> pending | ready | failed. */
  layers?: Record<string, string | null>;
  timings?: { t_first_text_ms?: number; t_opening_ms?: number };
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

export interface CaseThreadResult {
  thread_id: string;
  status: string | null;
  source?: "model";
  layers?: Record<string, string>;
  last_event_id?: number;
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

export interface PatientVisibleChanges {
  t_ms: number;
  vitals: DirectorVitals;
  affect: DirectorAffect;
  utterance_en: string;
  utterance_tr: string;
  new_facts: string[];
  complications_fired: string[];
  trace: TraceEvent[];
}

export interface DirectorNote {
  at_ms: number;
  note: string;
  why: string;
}

/** Opaque server-owned Director state; round-trip it unchanged between steps. */
export type DirectorCaseState = Record<string, unknown> & { t_ms: number };

export interface DirectorStepRequest {
  /** The generation thread: the server holds the case and the Director state (learners). */
  thread_id?: string | null;
  /** Faculty diagnostics only: the state from the previous step ... */
  case_state?: DirectorCaseState;
  /** ... or the spec to start a fresh encounter from. */
  spec?: CaseGenV2Spec | GeneratedCaseSpec;
  action: DirectorAction;
  learner_id?: string | null;
  /** Allow the bounded narrator model call (default true server-side). */
  use_model?: boolean;
}

export interface DirectorStepResult {
  thread_id?: string;
  case_state: DirectorCaseState;
  patient_visible_changes: PatientVisibleChanges;
  director_notes: DirectorNote[];
  /** Layers the server is still writing for this step (lazy layer, branch event). */
  layers_pending?: string[];
}

export interface CaseLayerResult {
  thread_id: string;
  layer: string;
  status: "ready";
  data: Record<string, unknown>;
  spec: CaseGenV2Spec;
}

export interface MyCaseRow {
  thread_id: string;
  source: "model";
  status: string | null;
  created_at: number;
  locale: string | null;
  complaint: string;
  age: number | null;
  sex: string | null;
  acuity_esi: number | null;
  difficulty: number | null;
  committed: boolean;
}

/* -------------------------------------------------------------------------- */
/* SSE events                                                                 */
/* -------------------------------------------------------------------------- */

export type CaseGenV2Event = (
  | { event: "start"; thread_id: string; stages?: string[]; eta_ms?: Record<string, number>; pipeline?: string[] }
  | { event: "kernel"; status: string }
  | { event: "opening.delta"; path: string; value: unknown }
  | { event: "opening.ready"; thread_id: string; opening: Record<string, unknown>; spec: CaseGenV2Spec; timings?: Record<string, number> }
  | { event: "layer.pending"; layer: string; reason: string }
  | { event: "layer.ready"; layer: string; data: Record<string, unknown>; spec: CaseGenV2Spec }
  | { event: "judge"; layer: string; decision: "accept" | "patched" | "noted" | "rejected"; issues?: string[]; spec?: CaseGenV2Spec; blocking?: boolean }
  | { event: "node"; node: string; status: string | null; trace: TraceEvent[]; council?: CouncilVerdict }
  | { event: "done"; thread_id: string; spec: CaseGenV2Spec | null; trace_summary?: TraceSummary; timings?: Record<string, number> }
  | { event: "error"; error: string; status: number; detail?: string; thread_id?: string; stage?: string; retryable?: boolean; fatal?: boolean }
) & { id?: number };

/* -------------------------------------------------------------------------- */
/* Core request helper (timeout + never-throw), as in backend.ts               */
/* -------------------------------------------------------------------------- */

const DEFAULT_TIMEOUTS = {
  // Author + three judges (+ up to two repairs) on a local model: generous. Kept
  // at the server SSE cap (SSE_MAX_DURATION_S, 600 s): at 240 s a live
  // generation with one repair was cut off (acceptance 2026-10-20).
  generate: 600_000,
  layer: 75_000,
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

/** One layer of a case, generated on first access (or awaited while the continuation writes it). */
export function readCaseLayer(
  threadId: string,
  layer: string,
  opts: RequestOptions = {},
): Promise<BackendResult<CaseLayerResult>> {
  return request<CaseLayerResult>(
    `/v2/case/${encodeURIComponent(threadId)}/layer/${encodeURIComponent(layer)}`,
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ reason: "access" }) },
    opts.timeoutMs ?? DEFAULT_TIMEOUTS.layer,
    opts.signal,
  );
}

/** The learner's own history of generated encounters (summaries, never a case). */
export function listMyCases(opts: RequestOptions = {}): Promise<BackendResult<{ cases: MyCaseRow[] }>> {
  return request<{ cases: MyCaseRow[] }>(
    "/v2/cases/mine",
    { method: "GET", headers: { accept: "application/json" } },
    opts.timeoutMs ?? DEFAULT_TIMEOUTS.read,
    opts.signal,
  );
}

/** Read the server-held case state of a thread. */
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
    let id: number | undefined;
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) name = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
      else if (line.startsWith("id:")) {
        const n = Number(line.slice(3).trim());
        if (Number.isFinite(n)) id = n;
      }
    }
    if (!name || dataLines.length === 0) continue;
    try {
      const payload = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
      events.push({ ...payload, event: name, ...(id !== undefined ? { id } : {}) } as CaseGenV2Event);
    } catch {
      // A malformed data line is dropped; the stream keeps going.
    }
  }
  return { events, rest };
}

export interface StreamOptions extends RequestOptions {
  /** Called for every event in order, including the ones after the opening. */
  onEvent: (event: CaseGenV2Event) => void;
  /** Reconnect attempts after a dropped stream (GET .../events?after=<last id>). */
  reconnects?: number;
}

/** The first playable case of a request: the opening (staged) or a finished case. */
export interface CaseStreamOpening {
  thread_id: string;
  spec: CaseGenV2Spec | null;
  trace_summary?: TraceSummary;
  /** Resolves when the thread is complete (done), failed, aborted or the reconnects ran out. */
  finished: Promise<"done" | "error" | "aborted" | "dropped">;
}

type Failure = { ok: false; error: string; status?: number };

async function errorOf(res: Response): Promise<Failure> {
  let code = `http_${res.status}`;
  try {
    const body = (await res.json()) as Partial<CaseGenV2Error>;
    if (typeof body.error === "string" && body.error) code = body.error;
  } catch {
    // keep http_<status>
  }
  return { ok: false, error: code, status: res.status };
}

/**
 * Stream one on-request case (POST, so EventSource cannot be used). Resolves as
 * soon as the case is playable: on `opening.ready`, or on `done` for a server
 * that sends the whole case at once. The stream keeps being read after that
 * (layers, judge patches, done) and every event reaches `onEvent`; a dropped
 * connection reconnects to `GET /v2/case/{thread_id}/events?after=<last id>`.
 * Resolves to an error when the server answered non-2xx, the stream sent a
 * fatal `error` before the opening, or the connection failed. Never throws.
 */
export async function streamCaseGenV2(
  req: CaseGenV2Request,
  opts: StreamOptions,
): Promise<BackendResult<CaseStreamOpening>> {
  const { signal, clear } = composeSignal(opts.timeoutMs ?? DEFAULT_TIMEOUTS.generate, opts.signal);
  let resolveOpening: (r: BackendResult<CaseStreamOpening>) => void = () => undefined;
  const opening = new Promise<BackendResult<CaseStreamOpening>>((r) => {
    resolveOpening = r;
  });
  let settled = false;
  let resolveFinished: (v: "done" | "error" | "aborted" | "dropped") => void = () => undefined;
  const finished = new Promise<"done" | "error" | "aborted" | "dropped">((r) => {
    resolveFinished = r;
  });
  let threadId = "";
  let lastId = 0;
  let ended: "done" | "error" | null = null;

  const settle = (r: BackendResult<CaseStreamOpening>) => {
    if (settled) return;
    settled = true;
    resolveOpening(r);
  };

  const handle = (ev: CaseGenV2Event) => {
    if (typeof ev.id === "number") lastId = Math.max(lastId, ev.id);
    if (ev.event === "start" && ev.thread_id) threadId = ev.thread_id;
    opts.onEvent(ev);
    if (ev.event === "opening.ready") {
      threadId = ev.thread_id || threadId;
      settle({ ok: true, data: { thread_id: threadId, spec: ev.spec, finished } });
    } else if (ev.event === "done") {
      ended = "done";
      threadId = ev.thread_id || threadId;
      settle({
        ok: true,
        data: { thread_id: threadId, spec: ev.spec, ...(ev.trace_summary ? { trace_summary: ev.trace_summary } : {}), finished },
      });
    } else if (ev.event === "error" && (!settled || ev.fatal)) {
      ended = "error";
      settle({ ok: false, error: ev.error, status: ev.status });
    }
  };

  const pump = async (res: Response): Promise<void> => {
    if (!res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const parsed = parseSseBuffer(buffer);
      buffer = parsed.rest;
      for (const ev of parsed.events) handle(ev);
      if (ended) break;
    }
    if (!ended) for (const ev of parseSseBuffer(`${buffer}\n\n`).events) handle(ev);
  };

  void (async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/v2/case/generate/stream`, {
        method: "POST",
        headers: { ...(await identityHeaders()), "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify(withLearnerId(req)),
        signal,
      });
      if (!res.ok) {
        settle(await errorOf(res));
        resolveFinished("error");
        return;
      }
      if (!res.body) {
        settle({ ok: false, error: "no_body" });
        resolveFinished("error");
        return;
      }
      await pump(res);
      // Same-thread reconnects (the continuation keeps writing layers server-side).
      let tries = opts.reconnects ?? 3;
      while (!ended && threadId && tries > 0 && !signal.aborted) {
        tries -= 1;
        const again = await fetch(
          `${BACKEND_URL}/v2/case/${encodeURIComponent(threadId)}/events?after=${lastId}`,
          { headers: { ...(await identityHeaders()), accept: "text/event-stream" }, signal },
        );
        if (!again.ok) break;
        await pump(again);
      }
      if (!settled) settle({ ok: false, error: "stream_incomplete" });
      resolveFinished(ended ?? (signal.aborted ? "aborted" : "dropped"));
    } catch (err) {
      settle({ ok: false, error: reasonFor(err) });
      resolveFinished(signal.aborted ? "aborted" : "dropped");
    } finally {
      clear();
    }
  })();
  return opening;
}

/** Provenance guard (owner decision): a learner case must be model-generated on request. */
export class NotModelGeneratedError extends Error {
  constructor(source: string) {
    super(`learner cases must be generated on request by the model (got source "${source}")`);
    this.name = "NotModelGeneratedError";
  }
}

export function assertModelSpec(spec: Pick<CaseGenV2Spec, "meta"> | null | undefined): void {
  const source = spec?.meta?.source ?? "none";
  if (source !== "model") throw new NotModelGeneratedError(source);
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
