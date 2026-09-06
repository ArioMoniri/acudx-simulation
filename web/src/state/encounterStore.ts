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

/* -------------------------------------------------------------------------- */
/* Event log + state shapes                                                    */
/* -------------------------------------------------------------------------- */

export type EncounterEventType =
  | "question"
  | "exam"
  | "order"
  | "result"
  | "treatment"
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
}

export interface ResolvedResult {
  code: string;
  datumKind: RevealDatumKind;
  /** ids of the LabResult/ImagingResult revealed. */
  datumIds: string[];
  at: number;
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
    problemList: [],
    events: [],
    dialogue: [],
    guardEvents: [],
    committedDiagnosis: null,
  };
}

let state: EncounterState = initialState();
let seqCounter = 0;
const listeners = new Set<() => void>();
const pendingTimers = new Set<ReturnType<typeof setTimeout>>();

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

/** Start (or restart) an encounter with a case. Captures the sim-clock start. */
export function startEncounter(caseInstance: CaseInstance): void {
  for (const t of pendingTimers) clearTimeout(t);
  pendingTimers.clear();
  seqCounter = 0;
  state = {
    ...initialState(),
    caseInstance,
    startTs: clock(),
    stage: "interview",
  };
  // Log the start as a stage event so timing metrics have an anchor.
  const ev = appendEvent("stage", "interview", { started: true });
  state = { ...state, events: [ev] };
  emit();
}

/** Ask a history question by intent. Reveals matching history + logs the event. */
export function askQuestion(intent: QuestionIntent): void {
  const c = state.caseInstance;
  if (!c) return;
  const resolved = resolveReveal(c, { kind: "question", ref: intent });
  const hit = resolved?.datumKind === "history";
  const datumIds = hit ? resolved!.datumIds : [];
  const alreadyKnown = datumIds.every((id) => state.discovered.has(id));
  const ev = appendEvent("question", intent, {
    hit,
    redundant: hit && alreadyKnown,
    revealed: datumIds,
  });
  setState({
    ...state,
    discovered: hit ? revealDatumIds(datumIds, state.discovered) : state.discovered,
    events: [...state.events, ev],
  });
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
  };
  const patientTurn: DialogueTurn = {
    id: `dlg-${ev.seq}-p`,
    role: "patient",
    en: input.patient.en,
    tr: input.patient.tr,
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
  const ev = appendEvent("exam", maneuver, {
    hit,
    redundant: hit && alreadyKnown,
    revealed: datumIds,
  });
  setState({
    ...state,
    discovered: hit ? revealDatumIds(datumIds, state.discovered) : state.discovered,
    stage: state.stage === "interview" ? "exam" : state.stage,
    events: [...state.events, ev],
  });
}

/**
 * Place an order by code. Logs immediately and schedules the result after a
 * PER-TEST simulated turnaround (orderCatalog: POC fast, cultures much later).
 * When the timer fires, the result is resolved (data revealed) and a `result`
 * event is appended.
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
  const order: PlacedOrder = {
    code,
    labelEn,
    labelTr,
    placedAt,
    resultsReadyAt: placedAt + timing.playbackMs,
    clinicalLabelEn: timing.clinicalLabel.en,
    clinicalLabelTr: timing.clinicalLabel.tr,
    category: timing.category,
    resolved: false,
  };
  const indicated = c.expectedWorkup.some((w) => w.code.coding[0]?.code === code);
  const lowValue = c.expectedWorkup.some((w) => w.code.coding[0]?.code === code && w.lowValue);
  const ev = appendEvent("order", code, { indicated, lowValue, category: timing.category });
  setState({ ...state, orders: [...state.orders, order], stage: "orders", events: [...state.events, ev] });

  const timer = setTimeout(() => {
    pendingTimers.delete(timer);
    resolveOrder(code);
  }, timing.playbackMs);
  pendingTimers.add(timer);
}

/** Resolve a placed order: reveal its result datum and append a result event. */
function resolveOrder(code: string): void {
  const c = state.caseInstance;
  if (!c) return;
  const resolved = resolveReveal(c, { kind: "order", ref: code });
  if (!resolved) return;
  const ev = appendEvent("result", code, {
    datumKind: resolved.datumKind,
    revealed: resolved.datumIds,
  });
  const result: ResolvedResult = {
    code,
    datumKind: resolved.datumKind,
    datumIds: resolved.datumIds,
    at: nowOffset(),
  };
  setState({
    ...state,
    discovered: revealDatumIds(resolved.datumIds, state.discovered),
    orders: state.orders.map((o) => (o.code === code ? { ...o, resolved: true } : o)),
    results: [...state.results, result],
    stage: "results",
    events: [...state.events, ev],
  });
}

/**
 * Administer a treatment by code. Appends a `treatment` event (with the
 * case-derived appropriateness) and records it so the live vitals course
 * (src/domain/clinicalCourse.ts) applies its effect from now on. Advances the
 * stage to "orders" if still pre-orders, otherwise keeps the current stage.
 */
export function administerTreatment(
  code: string,
  label?: { en: string; tr: string },
): void {
  const c = state.caseInstance;
  if (!c) return;
  const resp = c.treatmentResponses?.find((r) => r.treatmentCode === code);
  const appropriateness = resp?.appropriateness ?? "neutral";
  const at = nowOffset();
  const ev = appendEvent("treatment", code, {
    appropriateness,
    ...(label ? { display: label.en } : {}),
  });
  const prePlan =
    state.stage === "chart-review" || state.stage === "interview" || state.stage === "exam";
  setState({
    ...state,
    treatments: [...state.treatments, { code, at }],
    stage: prePlan ? "orders" : state.stage,
    events: [...state.events, ev],
  });
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
  seqCounter = 0;
  setState(initialState());
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

/** The patient's effective vitals right now (baseline + treatment ramps). */
export function getCurrentVitals(s: EncounterState): CurrentVitals | null {
  if (!s.caseInstance) return null;
  return currentVitals(s.caseInstance, getEncounterClockMs(s), s.treatments);
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
  return vitalsSeries(s.caseInstance, getEncounterClockMs(s), s.treatments);
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
