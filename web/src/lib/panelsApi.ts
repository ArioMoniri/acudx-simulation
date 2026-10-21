/**
 * AcuDx - typed client for the learner / dean / faculty APIs (server/learning).
 *
 * Every call carries the person's identity: the in-memory OIDC bearer when one
 * exists (src/lib/auth.ts), otherwise the UNVERIFIED local-profile headers
 * (profileStore.localIdentityHeaders). The server answers with `X-Auth-Mode`,
 * which the client surfaces as `authMode` so panels can show "local, unverified".
 * Every function returns a discriminated result and never throws into the UI.
 */

import { BACKEND_URL } from "@/lib/backend";
import { getAdminToken } from "@/lib/adminApi";
import { bearerHeader, ensureAccessToken, hasRestorableSession, type AcuDxRole } from "@/lib/auth";
import { getProfileState, localIdentityHeaders } from "@/state/profileStore";
import type { SimClockSettings, WaitClass } from "@/domain/simClock";

/* -------------------------------------------------------------------------- */
/* Results                                                                     */
/* -------------------------------------------------------------------------- */

export type PanelsErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "validation"
  | "unavailable"
  | "timeout"
  | "network"
  | `http_${number}`
  | "unknown";

export interface PanelsOk<T> {
  ok: true;
  data: T;
  /** Server-declared auth mode from the X-Auth-Mode header. */
  authMode: "local" | "oidc";
}

export interface PanelsErr {
  ok: false;
  error: PanelsErrorCode;
  status?: number;
  detail?: unknown;
}

export type PanelsResult<T> = PanelsOk<T> | PanelsErr;

/* -------------------------------------------------------------------------- */
/* Wire shapes (mirror server/learning/routes.py + store.py)                   */
/* -------------------------------------------------------------------------- */

export type CohortWindow = "7d" | "30d" | "90d" | "all";
export type DomainKey = "history" | "exam" | "reasoning" | "communication" | "management" | "professionalism";
export type BandName = "emerging" | "developing" | "proficient" | "strong" | "exemplary";

export const COHORT_WINDOWS: readonly CohortWindow[] = ["7d", "30d", "90d", "all"] as const;
export const DOMAIN_KEYS: readonly DomainKey[] = [
  "history",
  "exam",
  "reasoning",
  "communication",
  "management",
  "professionalism",
] as const;
export const BAND_NAMES: readonly BandName[] = ["emerging", "developing", "proficient", "strong", "exemplary"] as const;

export interface EncounterEventWire {
  seq: number;
  type: string;
  ref: string;
  at: number;
  meta?: Record<string, unknown> | null;
}

export interface DomainScoreWire {
  key: DomainKey;
  axis?: string | null;
  band: BandName | "withheld";
  competence: number;
  confidence: number;
  scored: boolean;
}

export interface EncounterSummaryWire {
  title?: Record<string, string> | null;
  domain_scores: DomainScoreWire[];
  calibration?: Record<string, unknown>[];
  overall_gap?: number | null;
  brier?: number | null;
  diagnosis_correct: boolean;
  safety_miss: boolean;
  expected_intent_count?: number | null;
  metrics?: Record<string, unknown> | null;
}

export interface EncounterBatchWire {
  encounter_id: string;
  case_id: string;
  started_at?: number | null;
  ended_at?: number | null;
  events: EncounterEventWire[];
  summary: EncounterSummaryWire;
}

export interface IngestResult {
  stored: boolean;
  id: number;
  org: string;
  chain_hash: string;
  prev_hash: string;
  body_sha256: string;
  verified_identity: boolean;
}

export interface ChainStatus {
  ok: boolean;
  length: number;
  broken_at: number | null;
  head: string | null;
}

export interface CohortLearner {
  user_hash: string;
  handle: string;
  encounters: number;
  safety_misses: number;
  dx_accuracy: number;
  mean_gap: number | null;
  domains: Record<DomainKey, { band: BandName | "withheld"; competence: number | null; n: number }>;
  weakest_domain: DomainKey | null;
  at_risk: boolean;
  reasons: Array<"safety" | "competence" | "diagnosis" | "calibration">;
  last_at: number;
}

export interface CohortReport {
  org: string;
  window: CohortWindow;
  windows: CohortWindow[];
  encounters: number;
  learner_count: number;
  kpis: { dx_accuracy: number | null; safety_miss_rate: number | null; mean_brier: number | null; at_risk: number };
  bands_by_domain: Record<DomainKey, Record<BandName | "withheld", number>>;
  calibration: {
    by_domain: Array<{ domain: DomainKey; n: number; mean_gap: number | null; over: number; under: number; well: number }>;
  };
  learners: CohortLearner[];
  activity: Array<{ bucket_start: number; encounters: number; learners: number }>;
  chain: ChainStatus;
  generated_at: number;
  verified_identity: boolean;
}

export interface ExportReport {
  org: string;
  window: CohortWindow;
  generated_at: number;
  deidentified: true;
  rows: Array<Record<string, unknown>>;
  chain: ChainStatus;
}

export interface CaseSubmission {
  id: number;
  org: string;
  case_id: string;
  title: string;
  author_sub: string;
  author_name: string | null;
  submitted_at: number;
  status: "pending" | "approved" | "returned";
  reviewer_sub: string | null;
  reviewed_at: number | null;
  note: string | null;
  payload: Record<string, unknown>;
}

export interface FlaggedEncounter {
  batch_id: number;
  org: string;
  status: "flagged" | "reviewed";
  reasons: Array<"safety_miss" | "diagnosis_incorrect">;
  flagged_at: number;
  reviewer_sub: string | null;
  reviewer_name: string | null;
  decision: "upheld" | "overridden" | null;
  note: string | null;
  overrides: Partial<Record<DomainKey, BandName>> | null;
  points: number | null;
  cosigned: boolean;
  reviewed_at: number | null;
  user_hash: string;
  user_name: string | null;
  case_id: string;
  encounter_id: string;
  summary: EncounterSummaryWire;
  received_at: number;
}

export interface FacultyQueue {
  org: string;
  cases: CaseSubmission[];
  encounters: FlaggedEncounter[];
  recent_reviews: FlaggedEncounter[];
}

export interface ReviewBody {
  decision: "upheld" | "overridden";
  note?: string;
  overrides?: Partial<Record<DomainKey, BandName>>;
  points?: number;
  cosigned: boolean;
}

export interface Assignment {
  id: number;
  org: string;
  case_id: string;
  title: string | null;
  assigned_by: string;
  assignee_sub: string;
  reason: string | null;
  due_at: number | null;
  created_at: number;
  completed_at: number | null;
}

export interface AssignBody {
  case_id: string;
  title?: string;
  assignees?: string[];
  all_learners?: boolean;
  reason?: string;
  due_at?: number;
}

export interface RosterEntry {
  sub: string;
  user_hash: string;
  name: string | null;
  email: string | null;
  roles: AcuDxRole[] | string[];
  encounters: number;
  last_at: number | null;
  open_assignments: number;
  safety_misses: number;
}

/* -------------------------------------------------------------------------- */
/* Client                                                                      */
/* -------------------------------------------------------------------------- */

export interface PanelsApiOptions {
  baseUrl?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  /** Override identity resolution (tests). */
  headers?: () => Promise<Record<string, string>>;
}

function codeForStatus(status: number): PanelsErrorCode {
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 422) return "validation";
  if (status === 503) return "unavailable";
  return `http_${status}`;
}

function reasonFor(err: unknown): PanelsErrorCode {
  if (err instanceof DOMException && err.name === "AbortError") return "timeout";
  if (err instanceof TypeError) return "network";
  return "unknown";
}

/**
 * Bearer when signed in through the IdP, else the unverified local-profile headers.
 * In local mode the server caps a header principal at resident (review 04 O2); an
 * operator who signed in to the admin console in this tab also sends X-Admin-Token so
 * the faculty and dean panels open for the role the local profile declares.
 */
export async function identityHeaders(): Promise<Record<string, string>> {
  if (hasRestorableSession()) {
    await ensureAccessToken();
    const bearer = bearerHeader();
    if (bearer.Authorization) return bearer;
  }
  const local = localIdentityHeaders(getProfileState());
  const adminToken = local["X-User-Id"] ? getAdminToken() : null;
  return adminToken ? { ...local, "X-Admin-Token": adminToken } : local;
}

export function createPanelsApi(opts: PanelsApiOptions = {}) {
  const baseUrl = opts.baseUrl ?? BACKEND_URL;
  const fetchFn = opts.fetchFn ?? ((input, init) => fetch(input, init));
  const timeoutMs = opts.timeoutMs ?? 12_000;
  const headersFor = opts.headers ?? identityHeaders;

  async function request<T>(
    path: string,
    init: { method?: string; body?: unknown; query?: Record<string, string | number | boolean | undefined> } = {},
  ): Promise<PanelsResult<T>> {
    const qs = init.query
      ? Object.entries(init.query)
          .filter(([, v]) => v !== undefined && v !== "")
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join("&")
      : "";
    const url = `${baseUrl}${path}${qs ? `?${qs}` : ""}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchFn(url, {
        method: init.method ?? "GET",
        headers: {
          accept: "application/json",
          ...(await headersFor()),
          ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: controller.signal,
      });
      const authMode = res.headers.get("x-auth-mode") === "oidc" ? "oidc" : "local";
      if (!res.ok) {
        let detail: unknown;
        try {
          detail = ((await res.json()) as { detail?: unknown }).detail;
        } catch {
          detail = undefined;
        }
        return { ok: false, error: codeForStatus(res.status), status: res.status, detail };
      }
      if (res.status === 204) return { ok: true, data: undefined as T, authMode };
      return { ok: true, data: (await res.json()) as T, authMode };
    } catch (err) {
      return { ok: false, error: reasonFor(err) };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    /* learner */
    postEncounter: (body: EncounterBatchWire) =>
      request<IngestResult>("/v1/events/encounter", { method: "POST", body }),
    myAssignments: () => request<{ assignments: Assignment[] }>("/v1/me/assignments"),
    /* dean */
    cohort: (window: CohortWindow, org?: string) =>
      request<CohortReport>("/v1/dean/cohort", { query: { window, org } }),
    exportReport: (window: CohortWindow, org?: string) =>
      request<ExportReport>("/v1/dean/export", { query: { window, org } }),
    chain: (org?: string) => request<ChainStatus & { org: string }>("/v1/dean/chain", { query: { org } }),
    /* faculty */
    queue: () => request<FacultyQueue>("/v1/faculty/queue"),
    review: (batchId: number, body: ReviewBody) =>
      request<FlaggedEncounter>(`/v1/faculty/review/${batchId}`, { method: "POST", body }),
    submitCase: (body: { case_id: string; title: string; payload?: Record<string, unknown> }) =>
      request<CaseSubmission>("/v1/faculty/cases/submit", { method: "POST", body }),
    decideCase: (id: number, body: { status: "approved" | "returned"; note?: string }) =>
      request<CaseSubmission>(`/v1/faculty/cases/${id}/decide`, { method: "POST", body }),
    assign: (body: AssignBody) =>
      request<{ assigned: number; assignments: Assignment[] }>("/v1/faculty/assign", { method: "POST", body }),
    assignments: (openOnly = false) =>
      request<{ assignments: Assignment[] }>("/v1/faculty/assignments", { query: { open_only: openOnly } }),
    roster: () => request<{ org: string; roster: RosterEntry[] }>("/v1/faculty/roster"),
    /* course encounter clock (docs/architecture/14 section 10) */
    mySimClock: () => request<SimClockCourse>("/v1/me/sim-clock"),
    facultySimClock: () => request<SimClockCourse>("/v1/faculty/sim-clock"),
    setFacultySimClock: (body: SimClockSettings) =>
      request<SimClockCourse>("/v1/faculty/sim-clock", { method: "PUT", body }),
    resetFacultySimClock: () => request<SimClockCourse>("/v1/faculty/sim-clock", { method: "DELETE" }),
  };
}

/** GET /v1/me/sim-clock and /v1/faculty/sim-clock (server/learning/routes.py). */
export interface SimClockCourse {
  org: string | null;
  settings: SimClockSettings;
  defaults: SimClockSettings;
  source: "course" | "default";
  updated_by: string | null;
  updated_at: number | null;
  preview: { class: WaitClass; turnaround_min: number; preliminary_min: number | null; first_report_s: number; final_s: number }[];
  bounds: { scale: [number, number]; wait_cap_s: [number, number] };
}

export type PanelsApi = ReturnType<typeof createPanelsApi>;

export const panelsApi: PanelsApi = createPanelsApi();
