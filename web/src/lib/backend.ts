/**
 * AcuDx — typed client for the AcuDx API gateway (server/app.py).
 *
 * An OPTIONAL "Live backend" path for the web app. When the learner turns Live
 * mode on (src/lib/liveBackend.tsx), the encounter routes real calls through the
 * AcuDx API gateway, configured via `VITE_BACKEND_URL` (same-origin `/api` by
 * default). Every request is bounded by a short AbortController timeout and every
 * function returns a discriminated result
 * (`{ ok: true, data } | { ok: false, error }`) so a call NEVER throws into the
 * UI. On any failure the caller falls back to the offline mock path.
 *
 * The request/response shapes mirror the FastAPI pydantic models exactly:
 *   GET  /health           -> HealthResult
 *   POST /v1/guard         { text, case_context? }              -> GuardVerdict
 *   POST /v1/patient/turn  PatientTurnRequest                   -> PatientTurnResult
 *   POST /v1/grade         { transcript, locale?, concurrency? } -> GradeResult
 *   POST /v1/ground        { query, country?, locale?, k? }     -> GroundResult
 *
 * Nothing here reads Date.now, mutates global state, or logs. Education only.
 */

/* -------------------------------------------------------------------------- */
/* Base URL                                                                    */
/* -------------------------------------------------------------------------- */

// VITE_BACKEND_URL is not part of vite/client's ImportMetaEnv, so read the env
// through a permissive record view to stay type-safe under `strict`.
const ENV = import.meta.env as unknown as Record<string, string | undefined>;

/**
 * Same-origin `/api` by default: talk to the AcuDx API gateway behind the same
 * host the app was served from, so nothing hardcodes a host or port. Override
 * with `VITE_BACKEND_URL` at build/deploy time to point at a different origin.
 */
function defaultBackendUrl(): string {
  if (typeof window !== "undefined" && window.location && window.location.origin) {
    return `${window.location.origin}/api`;
  }
  return "/api";
}

/** Resolved gateway origin. Override with `VITE_BACKEND_URL`. */
export const BACKEND_URL: string = ENV.VITE_BACKEND_URL ?? defaultBackendUrl();

/* -------------------------------------------------------------------------- */
/* Discriminated result                                                        */
/* -------------------------------------------------------------------------- */

export interface BackendOk<T> {
  ok: true;
  data: T;
}

export interface BackendError {
  ok: false;
  /** Short, non-sensitive reason: "timeout" | "network" | "http_<status>" | ... */
  error: string;
  /** HTTP status when the failure was a non-2xx response. */
  status?: number;
}

export type BackendResult<T> = BackendOk<T> | BackendError;

/** Per-call options shared by every endpoint. */
export interface RequestOptions {
  /** Abort the request early (e.g. component unmount). Composed with the timeout. */
  signal?: AbortSignal;
  /** Override the default timeout (ms). */
  timeoutMs?: number;
}

/* -------------------------------------------------------------------------- */
/* Response / request shapes (mirror server/app.py)                            */
/* -------------------------------------------------------------------------- */

/** GET /health response. */
export interface HealthResult {
  status: string;
  airgapped: boolean;
  provider: string;
  model: string;
  llm_base_url: string;
  tiers: string[];
}

/** The five guard classes the scope guard emits (server + client parity). */
export type GuardClass =
  | "in-scope"
  | "off-topic"
  | "answer-seeking"
  | "injection"
  | "unsafe";

/** POST /v1/guard response, and the `guard` block echoed by /v1/patient/turn. */
export interface GuardVerdict {
  cls: GuardClass;
  /** Fine-grained primary class id (e.g. "meta_answer_seeking"). */
  primary_class?: string;
  classes?: string[];
  score: number;
  rationale: string;
  /** Routing action, e.g. "route_normal" | "decline_in_character" | "block_deterministic". */
  action?: string;
  layers?: {
    decided_at_layer?: number;
    l0_rule_hit?: string | null;
    [key: string]: unknown;
  };
}

/** Gateway telemetry attached to a model-backed patient turn. */
export interface PatientTurnMeta {
  model?: string;
  provider?: string;
  latency_ms?: number;
  finish_reason?: string;
  had_reasoning?: boolean;
}

/** POST /v1/patient/turn request (aliases accepted server-side; canonical here). */
export interface PatientTurnRequest {
  learner_msg: string;
  case_state?: Record<string, unknown>;
  persona?: Record<string, unknown> | null;
  history?: Array<{ role: string; content: string }>;
  case_context?: Record<string, unknown> | null;
  max_tokens?: number;
  temperature?: number;
}

/** POST /v1/patient/turn response. */
export interface PatientTurnResult {
  utterance: string;
  routed_as: string;
  state_advance: boolean;
  guard: GuardVerdict;
  flags: Array<Record<string, unknown>>;
  meta: PatientTurnMeta | null;
}

/** A single grounded guideline passage returned by /v1/ground. */
export interface GroundPassage {
  id?: string;
  statement?: string;
  citation?: Record<string, unknown>;
  url?: string;
  council?: string;
  country?: string;
  topic?: string;
  score?: number;
}

/** POST /v1/ground response (grounding is sibling-owned; shape is permissive). */
export interface GroundResult {
  passages?: GroundPassage[];
  grounded?: boolean;
  degraded?: boolean;
  mode?: string;
  query?: string;
  country?: string;
  locale?: string;
  detail?: string;
  [key: string]: unknown;
}

/* ---- /v1/grade — decomposed, evidence-forced rubric grading -------------- */

/**
 * A transcript turn as sent to /v1/grade. The server accepts `role` OR `speaker`
 * and `content` OR `text`; we send the canonical `{ role, content }` (see
 * server.rubric.normalize_transcript, which labels assistant/patient -> PATIENT
 * and user/clinician/learner/doctor -> CLINICIAN).
 */
export interface GradeTurn {
  role: string;
  content: string;
}

/**
 * POST /v1/grade request. `transcript` is a flat string OR a list of turns
 * (mirrors GradeRequest's `transcript`/`history`/`turns` aliases). `locale` is
 * echoed into the result meta (the grader itself always reasons in English);
 * `concurrency` optionally overrides the server's per-item grading fan-out.
 */
export interface GradeRequest {
  transcript: string | GradeTurn[];
  locale?: string;
  concurrency?: number;
}

/** Competency bands (best -> worst) + the `ungraded` degraded/empty sentinel. */
export type GradeBand =
  | "strong"
  | "adequate"
  | "developing"
  | "insufficient"
  | "ungraded";

/** Coarse per-item confidence band (the server never leaks raw decimals). */
export type GradeConfidenceBand = "high" | "medium" | "low";

/** One graded rubric item: met + a forced verbatim evidence quote + a band. */
export interface GradeItem {
  id: string;
  criterion: string;
  /** Counted met: the model claimed met AND the quote verified AND conf>=min. */
  met: boolean;
  /** Confidence band, or null when the item could not be graded (degraded). */
  confidence: GradeConfidenceBand | null;
  /** Verified verbatim quote from the transcript ("" when unmet/unverified). */
  evidence: string;
  /** Degraded reason / fabricated-quote flag, when present. */
  note?: string;
}

/** One rubric domain aggregated to a band (bands + integer counts only). */
export interface GradeDomain {
  domain: string;
  title: { en: string; tr: string };
  band: GradeBand;
  met_count: number;
  item_count: number;
  graded_count: number;
  items: GradeItem[];
}

/** Telemetry attached to a grade result (all optional / defensive). */
export interface GradeMeta {
  locale?: string;
  item_count?: number;
  graded_count?: number;
  degraded_count?: number;
  temperature?: number;
  tier?: string;
  model?: string | null;
  empty_transcript?: boolean;
}

/** POST /v1/grade response (bands only — never raw scores or decimals). */
export interface GradeResult {
  overall_band: GradeBand;
  domains: GradeDomain[];
  meta: GradeMeta | null;
}

/* -------------------------------------------------------------------------- */
/* Core request helper (timeout + never-throw)                                 */
/* -------------------------------------------------------------------------- */

const DEFAULT_TIMEOUTS = {
  health: 4_000,
  guard: 8_000,
  // The local model can take a few seconds; keep it bounded but generous.
  patientTurn: 22_000,
  ground: 15_000,
  // Grading fans out one model call per rubric item (24) at temperature 0; even
  // batched it can run tens of seconds on the gateway's model — bounded, wide.
  grade: 45_000,
} as const;

const JSON_HEADERS: Record<string, string> = {
  "content-type": "application/json",
  accept: "application/json",
};

/** Reason string for an aborted / failed fetch, without leaking internals. */
function reasonFor(err: unknown): string {
  if (err instanceof DOMException && err.name === "AbortError") return "timeout";
  if (err instanceof TypeError) return "network";
  if (err instanceof Error && err.message) return err.message.slice(0, 120);
  return "unknown";
}

async function request<T>(
  path: string,
  init: RequestInit,
  timeoutMs: number,
  external?: AbortSignal,
): Promise<BackendResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Compose an externally-supplied signal (unmount / cancel) with the timeout.
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    const res = await fetch(`${BACKEND_URL}${path}`, {
      ...init,
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, error: `http_${res.status}`, status: res.status };
    }
    const data = (await res.json()) as T;
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: reasonFor(err) };
  } finally {
    clearTimeout(timer);
  }
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

/** Liveness probe. Used to decide whether Live mode is even available. */
export function health(opts: RequestOptions = {}): Promise<BackendResult<HealthResult>> {
  return request<HealthResult>(
    "/health",
    { method: "GET", headers: { accept: "application/json" } },
    opts.timeoutMs ?? DEFAULT_TIMEOUTS.health,
    opts.signal,
  );
}

/**
 * Scope & Injection Guard. Classifies a learner utterance BEFORE any model sees
 * it. `caseContext` carries the case scope (e.g. `{ scope_terms: [...] }`).
 */
export function guard(
  text: string,
  caseContext?: Record<string, unknown> | null,
  opts: RequestOptions = {},
): Promise<BackendResult<GuardVerdict>> {
  return request<GuardVerdict>(
    "/v1/guard",
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ text, case_context: caseContext ?? null }),
    },
    opts.timeoutMs ?? DEFAULT_TIMEOUTS.guard,
    opts.signal,
  );
}

/**
 * One patient roleplay turn: guard -> route-by-class -> persona + gateway ->
 * FactAssertionGate, all server-side. Returns the real patient utterance.
 */
export function patientTurn(
  req: PatientTurnRequest,
  opts: RequestOptions = {},
): Promise<BackendResult<PatientTurnResult>> {
  return request<PatientTurnResult>(
    "/v1/patient/turn",
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(req) },
    opts.timeoutMs ?? DEFAULT_TIMEOUTS.patientTurn,
    opts.signal,
  );
}

/**
 * Decomposed rubric grading. Sends the encounter transcript to the gateway's
 * evidence-forced grader (server/rubric.py): each of the fixed rubric's items is
 * graded independently at temperature 0 and returns {met, evidence, confidence},
 * aggregated code-side into per-domain + overall competency BANDS (never raw
 * scores). Never throws — the caller falls back to the local heuristic on any
 * `{ ok: false }`.
 */
export function grade(
  req: GradeRequest,
  opts: RequestOptions = {},
): Promise<BackendResult<GradeResult>> {
  return request<GradeResult>(
    "/v1/grade",
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(req) },
    opts.timeoutMs ?? DEFAULT_TIMEOUTS.grade,
    opts.signal,
  );
}

/**
 * Guideline grounding (embed + rerank over the local seed corpus). Sibling-owned
 * on the server; the response shape is permissive here.
 */
export function ground(
  query: string,
  country?: string,
  locale?: string,
  opts: RequestOptions = {},
): Promise<BackendResult<GroundResult>> {
  return request<GroundResult>(
    "/v1/ground",
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ query, country, locale }),
    },
    opts.timeoutMs ?? DEFAULT_TIMEOUTS.ground,
    opts.signal,
  );
}
