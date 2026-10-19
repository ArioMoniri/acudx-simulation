/**
 * AcuDx: typed client for the results and imaging engine (server/results_routes.py).
 *
 * Follows the conventions of src/lib/backend.ts: same base URL, bounded
 * AbortController timeout, and a discriminated `BackendResult<T>` so no call
 * ever throws into the UI. The shapes mirror the pydantic models exactly:
 *   POST /v1/results/resolve           ResolveRequest        -> OrderResult
 *   POST /v1/results/ecg               EcgRequest            -> EcgResult
 *   GET  /v1/results/reference-ranges  ?loinc&sex&age        -> ReferenceRangesTable | AnalyteLookup
 *   GET  /v1/imaging/resolve           ImagingResolveQuery   -> ImagingResolveResult
 *
 * The server never calls a model from these routes; `narrative` is null until
 * the LLM layer fills it. Nothing here reads Date.now or logs. Education only.
 */

import { BACKEND_URL, type BackendResult, type RequestOptions } from "@/lib/backend";

/* -------------------------------------------------------------------------- */
/* Request / response shapes (mirror server/results_routes.py)                 */
/* -------------------------------------------------------------------------- */

/** A treatment the learner has given, as the engine expects it in case_state. */
export interface TreatmentGiven {
  /** Free text or catalogue code; mapped server-side onto the kinetics vocabulary. */
  code?: string;
  label?: string;
  /** Simulation ms since arrival when it was started. */
  at_ms: number;
  /** Dose when relevant: litres of crystalloid, units of PRBC, FiO2 (0.21..1). */
  amount?: number;
  note?: string;
}

/** GeneratedCaseSpec plus the engine's optional extras. */
export interface ResultsCaseState {
  seed?: number;
  condition?: { icd10?: string; icd11?: string; label_en?: string; label_tr?: string; system?: string };
  condition_id?: string;
  demographics?: { age?: number; sex?: string; name_hint?: string; weight_kg?: number };
  acuity_esi?: number;
  difficulty?: number;
  labs?: Array<Record<string, unknown>>;
  imaging?: Array<Record<string, unknown>>;
  triage_vitals?: Record<string, number>;
  vitals_trajectory?: Array<Record<string, number>>;
  treatments_given?: TreatmentGiven[];
  /** Hours from symptom onset to arrival; defaults to the condition profile. */
  onset_h?: number;
  [key: string]: unknown;
}

export interface ResolveRequest {
  case_state: ResultsCaseState;
  order_code: string;
  sim_time_ms?: number;
  /** Earlier OrderResults for the same encounter (delta computation). */
  prior?: OrderResult[] | null;
  seed?: number | null;
}

export type ResultFlag = "N" | "L" | "H" | "LL" | "HH" | "A";

export interface ObservationDelta {
  prior_value: number;
  prior_sim_time_ms: number | null;
  change: number;
  pct: number | null;
}

export interface Observation {
  loinc: string;
  name: string;
  short?: string | null;
  value: number | string;
  unit: string;
  qualitative: boolean;
  ref_low: number | null;
  ref_high: number | null;
  flag: ResultFlag;
  critical: boolean;
  interpretation: string;
  delta: ObservationDelta | null;
  /** Kinetics model that produced the value (e.g. "troponin"), or null when static. */
  kinetics: string | null;
  /** True when the case authored this datum (ground truth took precedence). */
  ground_truth: boolean;
  /** URL of the reference-range source for this analyte. */
  source: string;
  reviewed_at: string;
  note?: string | null;
}

export interface Turnaround {
  category: string;
  minutes: number;
  ms: number;
  source: string;
}

export interface ImageProvenance {
  source_bank: string;
  source_page: string;
  source_title?: string | null;
  license: string;
  license_url: string;
  attribution: string;
  attribution_text: string;
  verified_at: string;
  is_synthetic: boolean;
  modifications: string;
  representative: boolean;
  note: string;
}

export interface ImageRef {
  id: string;
  url: string;
  local_path: string | null;
  caption_en: string;
  view: string;
  modality: string;
  region: string;
  finding: string;
  laterality: string;
}

export interface StructuredFinding {
  finding: string;
  laterality: string;
  text: string;
}

export interface ImagingReport {
  modality: string;
  region: string;
  finding: string;
  laterality: string;
  findings: StructuredFinding[];
  impression: string;
  ground_truth: boolean;
  image: ImageRef | null;
  provenance: ImageProvenance | null;
  image_status: "ok" | "unavailable";
  image_reason?: string | null;
}

export interface EcgMeasurements {
  rate_bpm: number;
  rhythm: string;
  regular: boolean;
  pr_ms: number | null;
  qrs_ms: number;
  qt_ms: number;
  qtc_ms: number;
  axis_deg: number;
  st_deviation_mv: Record<string, number>;
  t_inversion_leads: string[];
  atrial_rate_bpm: number | null;
  pattern: string;
  interpretation: string;
}

export interface EcgSummary {
  pattern: string;
  rate_bpm: number;
  measurements: EcgMeasurements;
  /** Parameters to pass to `ecgStrip` to fetch the waveform or SVG. */
  request: { pattern: string; rate_bpm: number | null; seed: number };
  reference_image: { url: string; local_path: string | null; caption_en: string; provenance: ImageProvenance } | null;
  is_synthetic: true;
}

export interface OrderResult {
  order_code: string;
  kind: "lab" | "imaging" | "ecg" | "micro" | "unknown";
  status: "ok" | "unavailable";
  sim_time_ms: number;
  t_since_onset_h: number;
  condition_id: string | null;
  severity: number;
  turnaround: Turnaround;
  /** Simulation ms at which the result becomes visible (sim_time_ms + turnaround.ms). */
  available_at_ms: number;
  observations?: Observation[];
  abnormal?: boolean;
  critical?: boolean;
  report?: ImagingReport;
  ecg?: EcgSummary;
  treatments_applied: Array<{ code: string; t_h: number; amount: number | null; note: string }>;
  /** Left null by the engine; the LLM layer writes the prose from the structured state. */
  narrative: string | null;
  meta: { source: "engine"; seed: number; reference_ranges_version: string; degraded: boolean; is_synthetic_patient: boolean };
  reason?: string;
}

export type EcgPattern =
  | "normal" | "sinus_tachycardia" | "sinus_bradycardia"
  | "stemi_anterior" | "stemi_inferior" | "stemi_lateral" | "stemi_posterior"
  | "nstemi" | "atrial_fibrillation" | "svt" | "vt" | "complete_heart_block"
  | "hyperkalemia" | "pericarditis" | "pulmonary_embolism" | "wpw" | "long_qt";

export interface EcgRequest {
  pattern: EcgPattern;
  rate_bpm?: number | null;
  seed?: number;
  include_samples?: boolean;
  include_svg?: boolean;
  px_per_mm?: number;
}

export interface EcgResult {
  fs: number;
  duration_s: number;
  pattern: string;
  seed: number;
  measurements: EcgMeasurements;
  beats: { r_peak_s: number[] };
  calibration: { paper_speed_mm_s: number; gain_mm_mV: number };
  is_synthetic: boolean;
  generator: string;
  /** Lead name -> mV samples at `fs` Hz (omitted when include_samples is false). */
  leads?: Record<string, number[]>;
  /** 25 mm/s, 10 mm/mV 3x4 + rhythm strip SVG (present when include_svg is true). */
  svg?: string;
}

export interface ReferenceRangeRow {
  sex: "any" | "male" | "female";
  age_min: number;
  age_max: number;
  low: number;
  high: number;
  note?: string;
  age_adjusted_rule?: string;
}

export interface ReferenceAnalyte {
  loinc: string;
  name: string;
  short?: string;
  unit: string;
  category: string;
  decimals?: number;
  ranges?: ReferenceRangeRow[];
  qualitative?: boolean;
  normal_value?: string;
  critical_low?: number;
  critical_high?: number;
  critical_source?: string;
  source: string;
  source_key: string;
  reviewed_at: string;
}

export interface ReferenceRangesTable {
  schema_version: number;
  generated_at: string;
  unit_system: string;
  code_system: string;
  notes: string[];
  sources: Record<string, { title: string; url: string; accessed: string; [key: string]: unknown }>;
  panels: Record<string, string[]>;
  analytes: ReferenceAnalyte[];
}

export interface AnalyteLookup {
  analyte: ReferenceAnalyte;
  resolved_range: { low: number; high: number; note?: string | null } | null;
  sources: Record<string, unknown>;
}

export interface ImagingResolveQuery {
  modality?: string;
  region?: string;
  finding?: string;
  laterality?: "left" | "right" | "bilateral" | "none";
  view?: string;
  order_code?: string;
  condition_id?: string;
}

export interface ImagingBankEntry extends ImageRef {
  order_codes: string[];
  conditions: string[];
  license: string;
  license_url: string;
  license_text: string;
  attribution: string;
  source_page: string;
  source_bank: string;
  verified_at: string;
  is_synthetic: false;
}

export interface ImagingResolveResult {
  status: "ok" | "unavailable";
  entry?: ImagingBankEntry | null;
  provenance?: ImageProvenance | null;
  findings: StructuredFinding[];
  reason?: string | null;
  score?: number;
}

/* -------------------------------------------------------------------------- */
/* Request helper (same contract as backend.ts: timeout + never-throw)         */
/* -------------------------------------------------------------------------- */

const DEFAULT_TIMEOUTS = {
  resolve: 12_000,
  // 12 leads x 5000 samples is a ~500 KB JSON body; allow a little longer.
  ecg: 20_000,
  referenceRanges: 8_000,
  imaging: 8_000,
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

async function request<T>(
  path: string,
  init: RequestInit,
  timeoutMs: number,
  external?: AbortSignal,
): Promise<BackendResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", () => controller.abort(), { once: true });
  }
  try {
    const res = await fetch(`${BACKEND_URL}${path}`, { ...init, signal: controller.signal });
    if (!res.ok) return { ok: false, error: `http_${res.status}`, status: res.status };
    const data = (await res.json()) as T;
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: reasonFor(err) };
  } finally {
    clearTimeout(timer);
  }
}

function query(params: Record<string, string | number | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") q.set(key, String(value));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Resolve one order against the server engine: case truth first, then kinetics
 * at `sim_time_ms` under the treatments in `case_state.treatments_given`, flagged
 * against sourced reference ranges. Pass earlier results as `prior` for deltas.
 */
export function resolveOrder(
  req: ResolveRequest,
  opts: RequestOptions = {},
): Promise<BackendResult<OrderResult>> {
  return request<OrderResult>(
    "/v1/results/resolve",
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(req) },
    opts.timeoutMs ?? DEFAULT_TIMEOUTS.resolve,
    opts.signal,
  );
}

/**
 * Synthesize a 12-lead strip (500 Hz, 10 s) and optionally its SVG printout at
 * 25 mm/s and 10 mm/mV. Deterministic for (pattern, rate_bpm, seed).
 */
export function ecgStrip(
  req: EcgRequest,
  opts: RequestOptions = {},
): Promise<BackendResult<EcgResult>> {
  return request<EcgResult>(
    "/v1/results/ecg",
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(req) },
    opts.timeoutMs ?? DEFAULT_TIMEOUTS.ecg,
    opts.signal,
  );
}

/** The whole sourced reference-range table. */
export function referenceRanges(
  opts: RequestOptions = {},
): Promise<BackendResult<ReferenceRangesTable>> {
  return request<ReferenceRangesTable>(
    "/v1/results/reference-ranges",
    { method: "GET", headers: { accept: "application/json" } },
    opts.timeoutMs ?? DEFAULT_TIMEOUTS.referenceRanges,
    opts.signal,
  );
}

/** One analyte with the range resolved for a sex and age. */
export function referenceRange(
  loinc: string,
  sex: "any" | "male" | "female" = "any",
  age = 45,
  opts: RequestOptions = {},
): Promise<BackendResult<AnalyteLookup>> {
  return request<AnalyteLookup>(
    `/v1/results/reference-ranges${query({ loinc, sex, age })}`,
    { method: "GET", headers: { accept: "application/json" } },
    opts.timeoutMs ?? DEFAULT_TIMEOUTS.referenceRanges,
    opts.signal,
  );
}

/**
 * Best license-clean bank image for a structured imaging request. The server
 * never flips laterality: a sided request only matches a same-sided, bilateral
 * or non-sided entry, otherwise `status: "unavailable"` with the findings only.
 */
export function resolveImaging(
  q: ImagingResolveQuery,
  opts: RequestOptions = {},
): Promise<BackendResult<ImagingResolveResult>> {
  return request<ImagingResolveResult>(
    `/v1/imaging/resolve${query(q as Record<string, string | undefined>)}`,
    { method: "GET", headers: { accept: "application/json" } },
    opts.timeoutMs ?? DEFAULT_TIMEOUTS.imaging,
    opts.signal,
  );
}
