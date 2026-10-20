/**
 * AcuDx — encounter store (progressive disclosure + event-sourced log).
 *
 * A dependency-free external store consumed via React's useSyncExternalStore.
 * Holds the current CaseInstance ground truth but exposes ONLY what the student
 * has obtained (docs/00-overview/04 §2.3): history by asking, exam by
 * maneuver, results by ordering. Every action appends an EncounterEvent with a
 * simulated timestamp, forming the event-sourced log that the process-metrics
 * layer (src/domain/processMetrics.ts) derives from (§4).
 *
 * Clock discipline: the store does NOT read Date.now at module top level. A
 * start timestamp is captured on startEncounter(); the encounter clock is
 * `now - startTs`. Callers may inject a clock for tests.
 *
 * Education only. No real patient data path.
 */

import { useSyncExternalStore } from "react";
import {
  resolveReveal,
  type CaseInstance,
  type ExamManeuver,
  type QuestionIntent,
  type RevealDatumKind,
} from "@/domain/case";
import type {
  ExamFinding,
  HistoryItem,
  ImagingResult,
  LabResult,
} from "@/domain/case";
import type { ServiceRequestKind } from "@/domain/fhir";
import { orderTiming, type OrderCategory } from "@/domain/orderCatalog";
import {
  courseStatus,
  currentVitals,
  vitalsSeries,
  type AdministeredTreatment,
  type CourseStatus,
  type CurrentVitals,
} from "@/domain/clinicalCourse";
import {
  allergyCrossCheck,
  defaultOrderFor,
  fiveRightsCheck,
  marOutcome,
  type MedicationAdministrationRecord,
  type MedicationOrder,
} from "@/domain/medicationSafety";
import { gateFor } from "@/domain/treatmentRules";
import { matchTreatmentResponse } from "@/domain/treatmentMatch";
import { inferQuestionTopic } from "@/domain/scopeGuard";
import { directorStep, type DirectorAction, type DirectorAffect, type DirectorCaseState, type DirectorStepResult } from "@/lib/caseGenV2";
import { layerForIntent, layerForManeuver, layerPending, type LayerStatus } from "@/lib/caseLayers";
import { resolveOrder as engineResolveOrder, type OrderResult } from "@/lib/resultsApi";
import {
  applyDirectorChanges,
  caseInstanceToSpec,
  overlayVitals,
  resultsCaseState,
  turnaroundLabel,
  vitalsAdjectives,
  type CaseGenerationMeta,
  type DirectorOverlay,
  type ResultSource,
} from "@/lib/liveEncounter";

/* -------------------------------------------------------------------------- */
/* Event log + state shapes                                                    */
/* -------------------------------------------------------------------------- */

export type EncounterEventType =
  | "question"
  | "exam"
  | "order"
  | "result"
  | "treatment"
  /** Medication administration record line (five rights + allergy check). */
  | "mar"
  | "diagnosis"
  | "note"
  | "stage";

export interface EncounterEvent {
  /** Monotonic sequence number (causal order, independent of the clock). */
  seq: number;
  type: EncounterEventType;
  /** questionIntent | examManeuver | orderCode | diagnosisCode | stageKey. */
  ref: string;
  /** Encounter-clock offset in ms (now - startTs). */
  at: number;
  /** Free-form metadata (e.g. reveal hit/miss, communication flags). */
  meta?: Record<string, unknown>;
}

/**
 * A single persisted free-text / voice / live dialogue turn. The natural
 * (AMBOSS-style) history-taking transcript lives in the store — NOT ephemeral
 * component state — so it survives tab-switch / remount and stays in sync with
 * the event-sourced log. Each recorded exchange also appends a `question`
 * encounter event (see {@link recordDialogue}) so Chart Review, grading, debrief
 * and progress count ALL history-taking, not just the intent chips.
 */
export interface DialogueTurn {
  id: string;
  role: "doctor" | "patient";
  en: string;
  tr: string;
  /**
   * The encounter's monotonic event `seq` for this exchange, so free-text/live
   * turns interleave with the intent-chip transcript in true chronological
   * order (the doctor + patient turn of one exchange share the same seq).
   */
  seq: number;
  /**
   * Affect label for a patient turn (e.g. the case's baseline affect). Absent
   * on doctor turns.
   */
  affect?: string;
}

/* -------------------------------------------------------------------------- */
/* Scope & Injection Guard outcomes (docs/architecture/13 §3, §6)              */
/* -------------------------------------------------------------------------- */

/**
 * Guard-outcome event types. Kept in a SEPARATE log (`guardEvents`) from the
 * clinical `EncounterEventType` union on purpose: widening that union would
 * break exhaustive consumers such as ChartReviewTab's
 * `Record<EncounterEventType, ...>`. Guard outcomes are still event-sourced
 * (shared seq + sim clock) so process metrics and audit can inherit them
 * (docs/architecture/13 §6), without polluting the clinical chart timeline.
 */
export type GuardEventType = "offtopic" | "answer-seeking" | "injection" | "unsafe";

export interface GuardEvent {
  /** Shares the encounter's monotonic seq so it interleaves with EncounterEvents. */
  seq: number;
  type: GuardEventType;
  /** Encounter-clock offset in ms (now - startTs). */
  at: number;
  /** Bounded snippet of the learner utterance, for audit / feedback citation. */
  utterance: string;
  /** Classifier confidence 0..1. */
  score: number;
  /** Short audit reason (not a chain-of-thought). */
  rationale: string;
}

export type EncounterStage =
  | "chart-review"
  | "interview"
  | "exam"
  | "orders"
  | "results"
  | "assessment"
  | "closed";

export interface PlacedOrder {
  /** Stable per-placement id (serial re-orders of one code get distinct ids). */
  id: string;
  /** The order/service code (matches OrderExpectation code + LabResult.orderCode). */
  code: string;
  /** Bilingual label captured at order time (from expectedWorkup or ad hoc). */
  labelEn: string;
  labelTr: string;
  placedAt: number;
  /** When the result becomes available (placedAt + playback turnaround). */
  resultsReadyAt: number;
  /** Realistic clinical turnaround to display (bilingual; NOT the playback time). */
  clinicalLabelEn: string;
  clinicalLabelTr: string;
  /** Turnaround category the timing was derived from (orderCatalog). */
  category: OrderCategory;
  resolved: boolean;
  /**
   * Where the result will come from once resolved. "engine" is the server
   * results engine (Live mode), "case" the authored ground truth, and
   * "offline-synthetic-normal" the labelled on-device fallback.
   */
  source?: ResultSource;
  /** The engine's own turnaround (sim ms) when it answered; drives the ETA label. */
  engineTurnaroundMs?: number;
}

export interface ResolvedResult {
  /** The PlacedOrder this result answers. */
  orderId: string;
  code: string;
  datumKind: RevealDatumKind;
  /** ids of the LabResult/ImagingResult revealed (empty for engine/offline results). */
  datumIds: string[];
  at: number;
  /** Provenance of the numbers (mirrors the result event's meta.source). */
  source: ResultSource;
  /** The server engine's full answer, present when source === "engine". */
  engine?: OrderResult;
}

/** Client view of the Clinical Director (server/orchestration/director.py). */
export interface DirectorSlice {
  /** Opaque server state, round-tripped unchanged between steps. */
  caseState: DirectorCaseState | null;
  /** Generator checkpoint thread the Director run correlates with. */
  threadId: string | null;
  overlay: DirectorOverlay | null;
  /** Steps taken so far (for the debrief and the status chip). */
  steps: number;
  status: "idle" | "busy" | "error";
  /** Last error reason (network, timeout, http_503 ...), null when healthy. */
  error: string | null;
}

export interface ProblemListEntry {
  /** Condition code the student added. */
  code: string;
  display: string;
  role: "differential" | "working" | "plan";
  /** Free text for the plan role. */
  note?: string;
  at: number;
}

export interface EncounterState {
  caseInstance: CaseInstance | null;
  /** Sim-clock start timestamp (ms). null before startEncounter. */
  startTs: number | null;
  stage: EncounterStage;
  /** ids of revealed data (history/exam/lab/imaging datum ids). */
  discovered: ReadonlySet<string>;
  orders: PlacedOrder[];
  results: ResolvedResult[];
  /** Treatments the learner has administered (drives the live vitals course). */
  treatments: AdministeredTreatment[];
  /**
   * Medication administration record: one line per attempted administration
   * with its five-rights + allergy checks and outcome (given / flagged / blocked).
   * Review 02 finding 9.
   */
  mar: MedicationAdministrationRecord[];
  problemList: ProblemListEntry[];
  events: EncounterEvent[];
  /**
   * Persisted free-text / voice / live history-taking transcript (doctor
   * utterances + patient replies), kept alongside the reveal-graph turns.
   */
  dialogue: DialogueTurn[];
  /** Scope & Injection Guard outcomes (separate from the clinical event log). */
  guardEvents: GuardEvent[];
  /** Committed diagnosis code, if any. */
  committedDiagnosis: string | null;
  /** Live mode: the gateway is reachable, so results and the Director run server-side. */
  liveEnabled: boolean;
  /** How the running case was produced (banner SimBadge provenance). */
  generation: CaseGenerationMeta | null;
  director: DirectorSlice;
  /**
   * Layer status of an on-request case (server/orchestration/staged.py): which parts
   * the server has written for this thread so far. Empty for a case that arrived whole.
   */
  caseLayers: Record<string, LayerStatus>;
}

/* -------------------------------------------------------------------------- */
/* Clock (injectable; never read at module top level)                         */
/* -------------------------------------------------------------------------- */

type Clock = () => number;
let clock: Clock = () => Date.now();

/** Override the clock (tests). Returns a restore function. */
export function __setClock(c: Clock): () => void {
  const prev = clock;
  clock = c;
  return () => {
    clock = prev;
  };
}

/* -------------------------------------------------------------------------- */
/* Store internals                                                             */
/* -------------------------------------------------------------------------- */

function initialState(): EncounterState {
  return {
    caseInstance: null,
    startTs: null,
    stage: "chart-review",
    discovered: new Set(),
    orders: [],
    results: [],
    treatments: [],
    mar: [],
    problemList: [],
    events: [],
    dialogue: [],
    guardEvents: [],
    committedDiagnosis: null,
    liveEnabled,
    generation: null,
    director: initialDirector(),
    caseLayers: {},
  };
}

function initialDirector(): DirectorSlice {
  return { caseState: null, threadId: null, overlay: null, steps: 0, status: "idle", error: null };
}

/** Module-level Live flag; survives resets so a new case starts in the right mode. */
let liveEnabled = false;

let state: EncounterState = initialState();
let seqCounter = 0;
const listeners = new Set<() => void>();
const pendingTimers = new Set<ReturnType<typeof setTimeout>>();
/** In-flight results-engine requests keyed by PlacedOrder.id (Live mode). */
const engineRequests = new Map<string, Promise<OrderResult | null>>();
/** Serialised Director chain: one step at a time, in action order. */
let directorChain: Promise<void> = Promise.resolve();
let directorPending = 0;
/** True while an "elapsed" tick is queued, so ticks never pile up. */
let directorTickQueued = false;
let directorClock: ReturnType<typeof setInterval> | null = null;
/** Sim time the Director accounts for every cadence tick. */
const DIRECTOR_TICK_MS = 60_000;

function emit(): void {
  for (const l of listeners) l();
}

function setState(next: EncounterState): void {
  state = next;
  emit();
}

function nowOffset(): number {
  return state.startTs == null ? 0 : Math.max(0, clock() - state.startTs);
}

function appendEvent(
  type: EncounterEventType,
  ref: string,
  meta?: Record<string, unknown>,
): EncounterEvent {
  return { seq: seqCounter++, type, ref, at: nowOffset(), ...(meta ? { meta } : {}) };
}

function revealDatumIds(datumIds: string[], current: ReadonlySet<string>): Set<string> {
  const next = new Set(current);
  for (const id of datumIds) next.add(id);
  return next;
}

/* -------------------------------------------------------------------------- */
/* Actions                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Switch Live mode on or off. In Live mode orders resolve through the server
 * results engine and every learner action steps the Clinical Director; off,
 * the offline reveal graph answers and the on-device synthetic normal is used,
 * labelled as such. Called by the workspace from the gateway health probe.
 */
export function setLiveEnabled(enabled: boolean): void {
  if (liveEnabled === enabled) return;
  liveEnabled = enabled;
  setState({ ...state, liveEnabled: enabled });
  if (enabled && state.caseInstance) startDirectorClock();
  if (!enabled) stopDirectorClock();
}

export interface StartEncounterOptions {
  /** Provenance of the case (model, template, offline, seed, published). */
  generation?: CaseGenerationMeta;
}

/**
 * Provenance guard (owner decision): a learner encounter starts only from a case
 * generated on request by the model, bound to its generation thread. Learner pages
 * call this; {@link startEncounter} stays for unit-test fixtures of the store.
 */
export function startGeneratedEncounter(
  caseInstance: CaseInstance,
  generation: CaseGenerationMeta,
  layers: Record<string, LayerStatus> = {},
): void {
  if (generation.source !== "model" || !generation.threadId) {
    throw new Error(
      `learner cases must be generated on request by the model (source "${generation.source}", thread ${generation.threadId ?? "none"})`,
    );
  }
  startEncounter(caseInstance, { generation });
  setState({ ...state, caseLayers: { ...layers } });
}

/** Ask the case session for a layer the learner just reached (set by caseSession.ts). */
let layerRequester: ((layer: string) => void) | null = null;

/** Register who fetches a missing layer for the running thread (null to clear). */
export function setLayerRequester(fn: ((layer: string) => void) | null): void {
  layerRequester = fn;
}

function requestLayer(layer: string | null): void {
  if (layer && layerRequester && layerPending(state.caseLayers, layer)) layerRequester(layer);
}

/** Retry one layer of the running thread (the strip's Retry; the failed layer only). */
export function retryCaseLayer(layer: string): void {
  if (layerRequester) layerRequester(layer);
}

/** The layer statuses of the running thread. */
export function getCaseLayers(s: EncounterState): Record<string, LayerStatus> {
  return s.caseLayers;
}

/** Mark layer statuses of the running thread (layer.pending / layer.ready / error events). */
export function setCaseLayers(threadId: string, layers: Record<string, LayerStatus>): void {
  if (!state.caseInstance || state.generation?.threadId !== threadId) return;
  setState({ ...state, caseLayers: { ...state.caseLayers, ...layers } });
}

/**
 * Fold newly written layers of the SAME thread into the running encounter without
 * restarting it: the case content grows (stable datum ids), the log, clock, orders
 * and Director state are kept, and questions or exams that were waiting for the
 * layer are answered now.
 */
export function mergeGeneratedCase(
  threadId: string,
  next: CaseInstance,
  layers: Record<string, LayerStatus> = {},
): void {
  const c = state.caseInstance;
  if (!c || state.generation?.threadId !== threadId) return;
  let discovered = state.discovered;
  const events = state.events.map((ev) => {
    if (ev.meta?.awaiting !== true) return ev;
    if (ev.type !== "question" && ev.type !== "exam") return ev;
    const resolved = resolveReveal(next, { kind: ev.type, ref: ev.ref } as Parameters<typeof resolveReveal>[1]);
    const want = ev.type === "question" ? "history" : "exam";
    if (resolved?.datumKind !== want || resolved.datumIds.length === 0) return ev;
    const ids =
      ev.type === "question"
        ? selectByTopic(next, resolved.datumIds, typeof ev.meta?.utterance === "string" ? ev.meta.utterance : undefined)
        : resolved.datumIds;
    discovered = revealDatumIds(ids, discovered);
    return { ...ev, meta: { ...ev.meta, awaiting: false, hit: true, revealed: ids } };
  });
  setState({
    ...state,
    caseInstance: { ...next, id: c.id },
    discovered,
    events,
    caseLayers: { ...state.caseLayers, ...layers },
  });
}

/** Start (or restart) an encounter with a case. Captures the sim-clock start. */
export function startEncounter(caseInstance: CaseInstance, opts: StartEncounterOptions = {}): void {
  for (const t of pendingTimers) clearTimeout(t);
  pendingTimers.clear();
  engineRequests.clear();
  stopDirectorClock();
  directorTickQueued = false;
  seqCounter = 0;
  const generation: CaseGenerationMeta =
    opts.generation ??
    {
      source: caseInstance.provenance === "seed" ? "seed" : "offline",
      threadId: null,
      council: null,
      degraded: false,
      model: null,
      note: null,
    };
  state = {
    ...initialState(),
    caseInstance,
    startTs: clock(),
    stage: "interview",
    generation,
    director: { ...initialDirector(), threadId: generation.threadId },
  };
  // Log the start as a stage event so timing metrics have an anchor.
  const ev = appendEvent("stage", "interview", { started: true, source: generation.source });
  state = { ...state, events: [ev] };
  emit();
  if (liveEnabled) startDirectorClock();
}

/**
 * Acceptance 2026-10-20 D-12: an intent such as "associated symptoms" now holds
 * several fever topics (rigors, urinary, cough, neck). A question that names a
 * topic reveals that answer; a question that names none reveals the general
 * answers (or everything when the intent has only topic items).
 */
function selectByTopic(c: CaseInstance, ids: string[], utterance?: string): string[] {
  const byId = new Map(c.groundTruth.history.map((h) => [h.id, h] as const));
  const items = ids.map((id) => byId.get(id)).filter((h): h is NonNullable<typeof h> => Boolean(h));
  if (!items.some((h) => h.topic)) return ids;
  const named = utterance ? inferQuestionTopic(utterance) : null;
  if (named) {
    const hit = items.filter((h) => h.topic === named.topic).map((h) => h.id);
    if (hit.length > 0) return hit;
  }
  const general = items.filter((h) => !h.topic).map((h) => h.id);
  return general.length > 0 ? general : ids;
}

/**
 * Ask a history question by intent. Reveals matching history + logs the event.
 * `utterance` carries the learner's own words when the intent was inferred from
 * free text (offline guard path), so the transcript can show what they typed.
 */
export function askQuestion(intent: QuestionIntent, opts?: { utterance?: string; voiced?: boolean }): void {
  const c = state.caseInstance;
  if (!c) return;
  const resolved = resolveReveal(c, { kind: "question", ref: intent });
  const hit = resolved?.datumKind === "history";
  const datumIds = hit ? selectByTopic(c, resolved!.datumIds, opts?.utterance) : [];
  const alreadyKnown = datumIds.every((id) => state.discovered.has(id));
  const utterance = opts?.utterance?.trim();
  const layer = layerForIntent(intent);
  // The history layer for this intent is still being written for this patient:
  // the question waits for it instead of answering "nothing to say".
  const awaiting = !hit && layerPending(state.caseLayers, layer) && Object.keys(state.caseLayers).length > 0;
  const ev = appendEvent("question", intent, {
    hit,
    redundant: hit && alreadyKnown,
    revealed: datumIds,
    ...(utterance ? { utterance: utterance.slice(0, 280) } : {}),
    ...(opts?.voiced ? { voiced: true } : {}),
    ...(awaiting ? { awaiting: true } : {}),
  });
  setState({
    ...state,
    discovered: hit ? revealDatumIds(datumIds, state.discovered) : state.discovered,
    events: [...state.events, ev],
  });
  if (awaiting) requestLayer(layer);
  queueDirector({ kind: "question", ref: intent }, { seq: ev.seq, voiced: Boolean(opts?.voiced) });
}

/**
 * Record a free-text / voice / live patient exchange (doctor utterance + patient
 * reply) as BOTH a persisted transcript entry AND an encounter EVENT.
 *
 * The natural history-taking that does not map to a question-intent chip — live
 * backend replies, offline canned greetings / clarifications, and in-scope
 * free-text — is otherwise invisible to the process layer. It is logged here as
 * a `question` event with the utterance in `meta` and NO `hit`/`redundant`
 * flags, so it never counts as history coverage, a redundant question, or an
 * irrelevant question (those consumers key off `meta.hit`), yet it DOES flow into
 * Chart Review's activity counts + timeline, grading, debrief and progress in
 * real time. Reusing `question` (rather than widening the event-type union)
 * keeps exhaustive consumers such as ChartReviewTab intact. The transcript is
 * stored so it survives remounts; `source` records the reply's provenance.
 */
export function recordDialogue(input: {
  doctorText: string;
  patient: { en: string; tr: string };
  affect: string;
  /** Provenance of the reply: the live model, or the offline fallback. Kept for
   * metrics only — never surfaced to the learner. */
  source?: "live" | "offline";
}): void {
  if (!state.caseInstance) return;
  const utterance = input.doctorText.trim();
  const ev = appendEvent("question", utterance.slice(0, 80) || "dialogue", {
    dialogue: true,
    utterance: utterance.slice(0, 200),
    source: input.source ?? "offline",
  });
  const doctorTurn: DialogueTurn = {
    id: `dlg-${ev.seq}-d`,
    role: "doctor",
    en: input.doctorText,
    tr: input.doctorText,
    seq: ev.seq,
  };
  const patientTurn: DialogueTurn = {
    id: `dlg-${ev.seq}-p`,
    role: "patient",
    en: input.patient.en,
    tr: input.patient.tr,
    seq: ev.seq,
    affect: input.affect,
  };
  setState({
    ...state,
    dialogue: [...state.dialogue, doctorTurn, patientTurn],
    events: [...state.events, ev],
  });
}

/** Request an exam maneuver. Reveals matching findings + logs the event. */
export function requestExam(maneuver: ExamManeuver): void {
  const c = state.caseInstance;
  if (!c) return;
  const resolved = resolveReveal(c, { kind: "exam", ref: maneuver });
  const hit = resolved?.datumKind === "exam";
  const datumIds = hit ? resolved!.datumIds : [];
  const alreadyKnown = datumIds.every((id) => state.discovered.has(id));
  const layer = layerForManeuver(maneuver);
  const awaiting = !hit && layerPending(state.caseLayers, layer) && Object.keys(state.caseLayers).length > 0;
  const ev = appendEvent("exam", maneuver, {
    hit,
    redundant: hit && alreadyKnown,
    revealed: datumIds,
    ...(awaiting ? { awaiting: true } : {}),
  });
  if (awaiting) requestLayer(layer);
  setState({
    ...state,
    discovered: hit ? revealDatumIds(datumIds, state.discovered) : state.discovered,
    stage: state.stage === "interview" ? "exam" : state.stage,
    events: [...state.events, ev],
  });
  queueDirector({ kind: "exam", ref: maneuver }, { seq: ev.seq });
}

/**
 * Place an order by code. Logs immediately and schedules the result after a
 * PER-TEST simulated turnaround (orderCatalog: POC fast, cultures much later).
 * When the timer fires, the result is resolved (data revealed) and a `result`
 * event is appended.
 *
 * Live mode: the server results engine is asked at placement time (sim time =
 * placedAt, with the treatments given so far and the earlier results of the
 * same encounter as `prior`), so its turnaround drives the ETA the learner sees
 * while the local playback timer stays the scheduler that reveals the answer.
 */
export function placeOrder(
  code: string,
  label?: { en: string; tr: string },
): void {
  const c = state.caseInstance;
  if (!c) return;

  // Derive the FHIR kind from whether the code resolves to an imaging datum.
  const resolvesToImaging = c.groundTruth.imaging.some((im) => im.orderCode === code);
  const kind: ServiceRequestKind = resolvesToImaging ? "imaging" : "laboratory";

  // Resolve the label from expected workup if not supplied.
  const expectation = c.expectedWorkup.find((w) => w.code.coding[0]?.code === code);
  const labelEn = label?.en ?? expectation?.label.en ?? code;
  const labelTr = label?.tr ?? expectation?.label.tr ?? code;

  // Per-test turnaround: playback drives the timer, clinicalLabel is displayed.
  const timing = orderTiming(code, kind, { en: labelEn, tr: labelTr });

  const placedAt = nowOffset();
  const hasGroundTruth =
    c.groundTruth.labs.some((l) => l.orderCode === code) || resolvesToImaging;
  const order: PlacedOrder = {
    id: `ord-${seqCounter}-${state.orders.length}`,
    code,
    labelEn,
    labelTr,
    placedAt,
    resultsReadyAt: placedAt + timing.playbackMs,
    clinicalLabelEn: timing.clinicalLabel.en,
    clinicalLabelTr: timing.clinicalLabel.tr,
    category: timing.category,
    resolved: false,
    source: liveEnabled ? "engine" : hasGroundTruth ? "case" : "offline-synthetic-normal",
  };
  const indicated = c.expectedWorkup.some((w) => w.code.coding[0]?.code === code);
  const lowValue = c.expectedWorkup.some((w) => w.code.coding[0]?.code === code && w.lowValue);
  const ev = appendEvent("order", code, { indicated, lowValue, category: timing.category, orderId: order.id });
  setState({ ...state, orders: [...state.orders, order], stage: "orders", events: [...state.events, ev] });

  if (liveEnabled) requestEngineResult(order);

  const timer = setTimeout(() => {
    pendingTimers.delete(timer);
    resolveOrder(order.id);
  }, timing.playbackMs);
  pendingTimers.add(timer);
  queueDirector({ kind: "order", ref: code });
}

/** Ask the server results engine for one placed order (Live mode). Never throws. */
function requestEngineResult(order: PlacedOrder): void {
  const c = state.caseInstance;
  if (!c) return;
  const prior = state.results
    .filter((r) => r.engine)
    .map((r) => r.engine as OrderResult);
  const labels: Record<string, string> = {};
  for (const ev of state.events) {
    if (ev.type === "treatment" && typeof ev.meta?.display === "string") labels[ev.ref] = ev.meta.display;
  }
  const req = engineResolveOrder({
    case_state: resultsCaseState(c, state.treatments, labels, state.director.overlay?.results ?? null),
    order_code: order.code,
    sim_time_ms: order.placedAt,
    prior: prior.length ? prior : null,
    seed: c.seed,
  }).then((res) => {
    if (!res.ok) return null;
    const data = res.data;
    // The engine's turnaround is the clinical ETA the learner sees.
    const eta = turnaroundLabel(data.turnaround.minutes);
    if (state.orders.some((o) => o.id === order.id && !o.resolved)) {
      setState({
        ...state,
        orders: state.orders.map((o) =>
          o.id === order.id
            ? { ...o, clinicalLabelEn: eta.en, clinicalLabelTr: eta.tr, engineTurnaroundMs: data.turnaround.ms }
            : o,
        ),
      });
    }
    return data;
  });
  engineRequests.set(order.id, req);
}

/**
 * Resolve a placed order: reveal its result datum and append a `result` event.
 * Accepts a PlacedOrder id, or an order code (the earliest unresolved placement
 * of that code). Every resolution appends a result event whose `meta.source`
 * says where the numbers came from (engine, case, offline-synthetic-normal).
 */
function resolveOrder(idOrCode: string): void {
  const c = state.caseInstance;
  if (!c) return;
  const order =
    state.orders.find((o) => o.id === idOrCode && !o.resolved) ??
    state.orders.find((o) => o.code === idOrCode && !o.resolved);
  if (!order) return;

  const pending = engineRequests.get(order.id);
  if (liveEnabled && pending) {
    // Live: wait for the engine answer (usually already here), then reveal.
    void pending.then((engine) => {
      engineRequests.delete(order.id);
      if (!state.orders.some((o) => o.id === order.id && !o.resolved)) return;
      if (engine) finalizeOrder(order, "engine", engine);
      else finalizeOrder(order, hasCaseTruth(c, order.code) ? "case" : "offline-synthetic-normal");
    });
    return;
  }
  finalizeOrder(order, hasCaseTruth(c, order.code) ? "case" : "offline-synthetic-normal");
}

function hasCaseTruth(c: CaseInstance, code: string): boolean {
  return resolveReveal(c, { kind: "order", ref: code }) != null;
}

function finalizeOrder(order: PlacedOrder, source: ResultSource, engine?: OrderResult): void {
  const c = state.caseInstance;
  if (!c) return;
  const resolved = resolveReveal(c, { kind: "order", ref: order.code });
  const datumKind: RevealDatumKind =
    resolved?.datumKind ??
    (engine?.kind === "imaging" || engine?.kind === "ecg" || order.category.startsWith("imaging") ? "imaging" : "lab");
  // Authored case data stays revealed even when the engine answered: the engine
  // already treats the authored value as ground truth at arrival.
  const datumIds = resolved?.datumIds ?? [];
  const ev = appendEvent("result", order.code, {
    datumKind,
    revealed: datumIds,
    source,
    orderId: order.id,
    ...(engine
      ? {
          engineKind: engine.kind,
          abnormal: Boolean(engine.abnormal),
          critical: Boolean(engine.critical),
          degraded: engine.meta.degraded,
          status: engine.status,
        }
      : {}),
  });
  const result: ResolvedResult = {
    orderId: order.id,
    code: order.code,
    datumKind,
    datumIds,
    at: nowOffset(),
    source,
    ...(engine ? { engine } : {}),
  };
  setState({
    ...state,
    discovered: datumIds.length ? revealDatumIds(datumIds, state.discovered) : state.discovered,
    orders: state.orders.map((o) => (o.id === order.id ? { ...o, resolved: true, source } : o)),
    results: [...state.results, result],
    stage: "results",
    events: [...state.events, ev],
  });
}

/**
 * Administer a complete medication order.
 *
 * Review 02 finding 9 (critical): every administration first passes the
 * five-rights check (patient, drug, dose, route, time) and the allergy
 * cross-check against `caseInstance.allergies`. A `mar` event is ALWAYS
 * appended with the checks and outcome. Only when nothing blocks does the
 * treatment enter the live course (a `treatment` event with the case-derived
 * or gate-derived appropriateness, so a nitrate at SBP 86 is scored as a
 * contraindicated choice — review 02 finding 8). Advances the stage to
 * "orders" if still pre-orders, otherwise keeps the current stage.
 *
 * Returns the MAR line so the UI can show why an order was blocked / flagged.
 */
export function administerMedication(
  order: MedicationOrder,
  opts: { label?: { en: string; tr: string }; administeredBy?: string } = {},
): MedicationAdministrationRecord | null {
  const c = state.caseInstance;
  if (!c) return null;
  const at = nowOffset();
  const checks = fiveRightsCheck(order, {
    orderedForPatientId: c.patient.id,
    bedsidePatientId: c.patient.id,
    allergies: c.allergies,
    weightKg: order.weightKg ?? c.patient.weightKg,
    priorMar: state.mar,
    nowMs: at,
  });
  const allergy = allergyCrossCheck(order.drug, c.allergies);
  const outcome = marOutcome(checks);
  const record: MedicationAdministrationRecord = {
    id: `mar-${seqCounter}`,
    order,
    patientId: c.patient.id,
    administeredBy: opts.administeredBy ?? "doctor",
    at,
    checks,
    allergy,
    outcome,
  };
  const marEv = appendEvent("mar", order.drug, {
    outcome,
    dose: order.dose,
    unit: order.unit,
    route: order.route,
    indication: order.indication,
    administeredBy: record.administeredBy,
    failures: checks.failures.map((f) => f.code),
    allergyConflict: allergy.conflict,
    ...(opts.label ? { display: opts.label.en } : {}),
  });

  if (outcome === "blocked") {
    setState({ ...state, mar: [...state.mar, record], events: [...state.events, marEv] });
    return record;
  }

  // Appropriateness: the case's bespoke response wins; otherwise the gate on the
  // live vitals (review 02 finding 8); otherwise neutral.
  // Acceptance 2026-10-20 D-20: a formulary code maps to the case's own row.
  const resp = matchTreatmentResponse(c, order.drug);
  const vitals = currentVitals(c, at, state.treatments);
  const gate = resp ? null : gateFor(order.drug, c, vitals, state.treatments, at);
  const appropriateness = resp?.appropriateness ?? gate?.appropriateness ?? "neutral";
  const ev = appendEvent("treatment", order.drug, {
    appropriateness,
    ...(gate ? { reason: gate.reason, effective: gate.allowed } : {}),
    dose: order.dose,
    unit: order.unit,
    route: order.route,
    ...(outcome === "flagged" ? { flagged: checks.failures.map((f) => f.code) } : {}),
    ...(opts.label ? { display: opts.label.en } : {}),
  });
  const prePlan =
    state.stage === "chart-review" || state.stage === "interview" || state.stage === "exam";
  setState({
    ...state,
    treatments: [...state.treatments, { code: order.drug, at }],
    mar: [...state.mar, record],
    stage: prePlan ? "orders" : state.stage,
    events: [...state.events, marEv, ev],
  });
  queueDirector({ kind: "treatment", ref: order.drug });
  return record;
}

/**
 * Administer a treatment by code using the formulary's adult default dose and
 * route (a protocol-default order). Kept for the one-click paths; it runs the
 * same five-rights + allergy check as {@link administerMedication}. Codes
 * absent from the formulary are blocked (an order without dose/route cannot be
 * administered — review 02 finding 9).
 */
export function administerTreatment(
  code: string,
  label?: { en: string; tr: string },
): MedicationAdministrationRecord | null {
  const c = state.caseInstance;
  if (!c) return null;
  const order = defaultOrderFor(code, c.patient.weightKg) ?? {
    drug: code,
    dose: Number.NaN,
    unit: "",
    route: "IV" as const,
    frequency: "",
    indication: "",
  };
  return administerMedication(order, { label });
}

/** Commit a working diagnosis by code + display. */
export function commitDiagnosis(code: string, display: string): void {
  const c = state.caseInstance;
  if (!c) return;
  const correct = c.correctDiagnosis.code.coding[0]?.code === code;
  const ev = appendEvent("diagnosis", code, { correct, display });
  setState({
    ...state,
    committedDiagnosis: code,
    problemList: [
      ...state.problemList.filter((p) => p.role !== "working"),
      { code, display, role: "working", at: nowOffset() },
    ],
    stage: "assessment",
    events: [...state.events, ev],
  });
}

/** Add a differential/working/plan entry to the student's problem list. */
export function addProblem(entry: Omit<ProblemListEntry, "at">): void {
  if (!state.caseInstance) return;
  const ev = appendEvent("note", entry.code || entry.role, { role: entry.role });
  setState({
    ...state,
    problemList: [...state.problemList, { ...entry, at: nowOffset() }],
    events: [...state.events, ev],
  });
}

/**
 * Log a Scope & Injection Guard outcome (docs/architecture/13 §3). Called for
 * the non-in-scope classes only — an in-scope utterance advances state through
 * askQuestion and needs no guard event. Injection payloads are logged here but
 * are NEVER routed to the dialogue engine. Does not advance the clinical stage.
 */
export function logGuardOutcome(input: {
  type: GuardEventType;
  utterance: string;
  score: number;
  rationale: string;
}): void {
  if (!state.caseInstance) return;
  const ev: GuardEvent = {
    seq: seqCounter++,
    type: input.type,
    at: nowOffset(),
    utterance: input.utterance.slice(0, 200),
    score: input.score,
    rationale: input.rationale.slice(0, 400),
  };
  setState({ ...state, guardEvents: [...state.guardEvents, ev] });
}

/** Advance / set the encounter stage. */
export function setStage(stage: EncounterStage): void {
  if (!state.caseInstance && stage !== "chart-review") return;
  const ev = appendEvent("stage", stage);
  setState({ ...state, stage, events: [...state.events, ev] });
}

/** Reset the store (e.g. leaving the encounter). */
export function resetEncounter(): void {
  for (const t of pendingTimers) clearTimeout(t);
  pendingTimers.clear();
  engineRequests.clear();
  stopDirectorClock();
  directorTickQueued = false;
  seqCounter = 0;
  setState(initialState());
}

/* -------------------------------------------------------------------------- */
/* Clinical Director (Live mode)                                               */
/* -------------------------------------------------------------------------- */

/**
 * Queue one Director step for a learner action. Steps are serialised (one
 * request at a time, in action order) and never block the UI: the store is
 * updated when the answer lands. An "elapsed" tick is coalesced so a slow
 * gateway never accumulates a backlog of cadence steps. Inert off Live mode.
 */
interface DirectorStepContext {
  /** Event seq of the learner action, so the patient's line lands right after it. */
  seq?: number;
  /** The persona already voiced the reply to this action: do not add the narrator's line. */
  voiced?: boolean;
}

function queueDirector(action: DirectorAction, ctx: DirectorStepContext = {}): void {
  if (!liveEnabled || !state.caseInstance) return;
  if (action.kind === "elapsed") {
    if (directorTickQueued) return;
    directorTickQueued = true;
  }
  const caseId = state.caseInstance.id;
  directorPending += 1;
  directorChain = directorChain
    .then(() => runDirectorStep(action, caseId, ctx))
    .catch(() => {
      /* runDirectorStep never throws; this keeps the chain alive regardless */
    })
    .finally(() => {
      directorPending -= 1;
      if (action.kind === "elapsed") directorTickQueued = false;
    });
}

async function runDirectorStep(action: DirectorAction, caseId: string, ctx: DirectorStepContext = {}): Promise<void> {
  const c = state.caseInstance;
  if (!c || c.id !== caseId || !liveEnabled) return;
  if (state.director.status !== "busy") {
    setState({ ...state, director: { ...state.director, status: "busy" } });
  }
  const prevState = state.director.caseState;
  const threadId = state.generation?.threadId ?? null;
  // An on-request case is stepped by its thread: the server holds the case and the
  // Director state (CaseStore). A fixture-only encounter (unit tests) sends the spec.
  const res = await directorStep({
    ...(threadId
      ? { thread_id: threadId }
      : prevState
        ? { case_state: prevState }
        : { spec: caseInstanceToSpec(c) }),
    action: { ...action, locale: c.locale },
    use_model: true,
  });
  // The encounter may have changed under us; never apply a stale answer.
  if (!state.caseInstance || state.caseInstance.id !== caseId) return;
  // Live was switched off while the step was in flight (review 04 O7): the encounter is
  // offline now, so the answer is dropped and the Director is left idle, not busy.
  if (!liveEnabled) {
    if (state.director.status === "busy") setState({ ...state, director: { ...state.director, status: "idle" } });
    return;
  }
  if (!res.ok) {
    setState({ ...state, director: { ...state.director, status: "error", error: res.error } });
    return;
  }
  applyDirectorStep(res.data, action, ctx);
  for (const layer of res.data.layers_pending ?? []) {
    if (layerRequester) layerRequester(layer);
  }
}

/** Fold a Director answer into the store: overlay, facts, notes, complications. */
function applyDirectorStep(data: DirectorStepResult, action?: DirectorAction, ctx: DirectorStepContext = {}): void {
  const c = state.caseInstance;
  if (!c) return;
  const at = nowOffset();
  const localNow = currentVitals(c, at, state.treatments);
  const overlay = applyDirectorChanges(state.director.overlay, data.patient_visible_changes, localNow, at);
  const events = [...state.events];
  for (const note of data.director_notes ?? []) {
    events.push(
      appendEvent("note", "director", {
        director: true,
        note: note.note,
        why: note.why,
        directorAtMs: note.at_ms,
      }),
    );
  }
  const before = new Set(state.director.overlay?.complications ?? []);
  for (const comp of overlay.complications) {
    if (before.has(comp)) continue;
    events.push(appendEvent("stage", "director-complication", { director: true, complication: comp }));
  }
  // The patient's bedside line for this action (Director narrator), unless the live
  // persona already answered it: deterioration and relief are heard, not only read.
  const pv = data.patient_visible_changes;
  const line = { en: (pv?.utterance_en ?? "").trim(), tr: (pv?.utterance_tr ?? "").trim() };
  let dialogue = state.dialogue;
  if (action && (action.kind === "question" || action.kind === "exam" || action.kind === "treatment") && !ctx.voiced && (line.en || line.tr)) {
    const seq = ctx.seq ?? (events[events.length - 1]?.seq ?? 0);
    dialogue = [
      ...dialogue,
      {
        id: `dir-${seq}-${state.director.steps}`,
        role: "patient",
        en: line.en || line.tr,
        tr: line.tr || line.en,
        seq,
        ...(pv.affect ? { affect: pv.affect.mood_en } : {}),
      },
    ];
  }
  setState({
    ...state,
    events,
    dialogue,
    director: {
      ...state.director,
      caseState: data.case_state,
      overlay,
      steps: state.director.steps + 1,
      status: "idle",
      error: null,
    },
  });
}

function startDirectorClock(): void {
  stopDirectorClock();
  // Sim-time cadence: every 60 s the Director advances physiology and checks
  // deadlines even when the learner does nothing. This schedules a real server
  // call; it does not simulate one.
  directorClock = setInterval(() => {
    queueDirector({ kind: "elapsed", elapsed_ms: DIRECTOR_TICK_MS });
  }, DIRECTOR_TICK_MS);
}

function stopDirectorClock(): void {
  if (directorClock != null) clearInterval(directorClock);
  directorClock = null;
}

/** Wait for every queued Director step and engine request to settle (tests). */
export async function __flushLive(): Promise<void> {
  for (let i = 0; i < 8 && (directorPending > 0 || engineRequests.size > 0); i += 1) {
    await directorChain;
    await Promise.all(Array.from(engineRequests.values()));
    await new Promise<void>((r) => queueMicrotask(r));
  }
  await directorChain;
}

/* -------------------------------------------------------------------------- */
/* Store subscription + hooks                                                  */
/* -------------------------------------------------------------------------- */

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): EncounterState {
  return state;
}

/** The current encounter state, non-reactively (event handlers, effects). */
export function getEncounterSnapshot(): EncounterState {
  return state;
}

/** Read the whole encounter state reactively. */
export function useEncounterState(): EncounterState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Read a derived slice reactively. Selector must be referentially stable. */
export function useEncounterSelector<T>(selector: (s: EncounterState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(state),
  );
}

/* -------------------------------------------------------------------------- */
/* Progressive-disclosure selectors (expose ONLY revealed data)               */
/* -------------------------------------------------------------------------- */

/** History items the student has actually elicited. */
export function getDiscoveredHistory(s: EncounterState): HistoryItem[] {
  if (!s.caseInstance) return [];
  return s.caseInstance.groundTruth.history.filter((h) => s.discovered.has(h.id));
}

/** Exam findings the student has actually obtained via maneuvers. */
export function getDiscoveredExam(s: EncounterState): ExamFinding[] {
  if (!s.caseInstance) return [];
  return s.caseInstance.groundTruth.exam.filter((e) => s.discovered.has(e.id));
}

/** Lab results returned for orders the student placed. */
export function getDiscoveredLabs(s: EncounterState): LabResult[] {
  if (!s.caseInstance) return [];
  return s.caseInstance.groundTruth.labs.filter((l) => s.discovered.has(l.id));
}

/** Imaging results returned for orders the student placed. */
export function getDiscoveredImaging(s: EncounterState): ImagingResult[] {
  if (!s.caseInstance) return [];
  return s.caseInstance.groundTruth.imaging.filter((im) => s.discovered.has(im.id));
}

/** All discovered results (labs + imaging) as a flat convenience view. */
export function getDiscoveredResults(s: EncounterState): {
  labs: LabResult[];
  imaging: ImagingResult[];
} {
  return { labs: getDiscoveredLabs(s), imaging: getDiscoveredImaging(s) };
}

/** The student's current problem list (differentials + working dx + plan). */
export function getProblemList(s: EncounterState): ProblemListEntry[] {
  return s.problemList;
}

/** The persisted free-text / voice / live history-taking transcript. */
export function getDialogue(s: EncounterState): DialogueTurn[] {
  return s.dialogue;
}

/** Current encounter-clock reading in ms (0 before start). */
export function getEncounterClockMs(s: EncounterState): number {
  return s.startTs == null ? 0 : Math.max(0, clock() - s.startTs);
}

/* -------------------------------------------------------------------------- */
/* Live clinical-course selectors (vitals from trajectory + treatments)        */
/* -------------------------------------------------------------------------- */

/** Treatments the learner has administered so far. */
export function getTreatments(s: EncounterState): AdministeredTreatment[] {
  return s.treatments;
}

/** The medication administration record (every attempted administration). */
export function getMar(s: EncounterState): MedicationAdministrationRecord[] {
  return s.mar;
}

/**
 * The patient's effective vitals right now: baseline + treatment ramps, plus
 * the Clinical Director's overlay in Live mode (deterioration or recovery the
 * server decided), clamped to physiological bounds.
 */
export function getCurrentVitals(s: EncounterState): CurrentVitals | null {
  if (!s.caseInstance) return null;
  const local = currentVitals(s.caseInstance, getEncounterClockMs(s), s.treatments);
  return overlayVitals(local, s.director.overlay);
}

/** Coarse trend classification of the current course. */
export function getCourseStatus(s: EncounterState): CourseStatus | null {
  if (!s.caseInstance) return null;
  return courseStatus(s.caseInstance, getEncounterClockMs(s), s.treatments);
}

/** Sampled effective-vitals series from 0..now for the trend monitor. */
export function getVitalsSeries(
  s: EncounterState,
): Array<{ atMs: number } & CurrentVitals> {
  if (!s.caseInstance) return [];
  const series = vitalsSeries(s.caseInstance, getEncounterClockMs(s), s.treatments);
  const overlay = s.director.overlay;
  if (!overlay) return series;
  return series.map((p) => (p.atMs >= overlay.atMs ? { atMs: p.atMs, ...overlayVitals(p, overlay) } : p));
}

/* -------------------------------------------------------------------------- */
/* Live-mode selectors (generation provenance, Director, persona context)      */
/* -------------------------------------------------------------------------- */

/** Provenance of the running case (null before an encounter starts). */
export function getGeneration(s: EncounterState): CaseGenerationMeta | null {
  return s.generation;
}

/** The Clinical Director slice. */
export function getDirector(s: EncounterState): DirectorSlice {
  return s.director;
}

/** The engine's answer for one placed order, when it resolved through the engine. */
export function getEngineResult(s: EncounterState, orderId: string): OrderResult | null {
  return s.results.find((r) => r.orderId === orderId)?.engine ?? null;
}

export interface PersonaLiveContext {
  /** Facts the Director has sanctioned so far (what the patient may volunteer). */
  sanctioned_facts: string[];
  /** Plain adjectives for the current vitals so the persona voices the trend. */
  vitals_adjectives: string[];
  vitals: CurrentVitals | null;
  affect: DirectorAffect | null;
  complications: string[];
}

/**
 * What a persona turn must carry so the patient reflects deterioration or
 * improvement: the Director's sanctioned facts, the current vitals and their
 * adjectives, affect and fired complications. Empty-but-valid off Live mode.
 */
export function getPersonaLiveContext(s: EncounterState): PersonaLiveContext {
  const vitals = getCurrentVitals(s);
  const overlay = s.director.overlay;
  return {
    sanctioned_facts: overlay?.sanctionedFacts ?? [],
    vitals_adjectives: vitals ? vitalsAdjectives(vitals, overlay?.affect ?? null) : [],
    vitals,
    affect: overlay?.affect ?? null,
    complications: overlay?.complications ?? [],
  };
}

/* -------------------------------------------------------------------------- */
/* Guard-outcome selectors (focus / on-task signal, docs/architecture/13 §6)   */
/* -------------------------------------------------------------------------- */

/** All Scope & Injection Guard outcomes for this encounter. */
export function getGuardEvents(s: EncounterState): GuardEvent[] {
  return s.guardEvents;
}

/** Count guard events, optionally of one type. */
export function getGuardEventCount(s: EncounterState, type?: GuardEventType): number {
  return type ? s.guardEvents.filter((g) => g.type === type).length : s.guardEvents.length;
}

/**
 * Off-task move count — the focus / staying-on-task signal (docs §6). Counts
 * off-topic + answer-seeking turns; injection/unsafe are security/safety, not a
 * focus lapse, so they are excluded from this indicator.
 */
export function getOffTaskCount(s: EncounterState): number {
  return s.guardEvents.filter(
    (g) => g.type === "offtopic" || g.type === "answer-seeking",
  ).length;
}
