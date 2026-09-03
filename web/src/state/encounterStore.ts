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

/* -------------------------------------------------------------------------- */
/* Event log + state shapes                                                    */
/* -------------------------------------------------------------------------- */

export type EncounterEventType =
  | "question"
  | "exam"
  | "order"
  | "result"
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
  /** When the result becomes available (placedAt + turnaround). */
  resultsReadyAt: number;
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
  problemList: ProblemListEntry[];
  events: EncounterEvent[];
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

const LAB_SIM_MS = 20_000; // labs return in ~20s of sim time
const IMAGING_SIM_MS = 45_000; // imaging returns in ~45s

function initialState(): EncounterState {
  return {
    caseInstance: null,
    startTs: null,
    stage: "chart-review",
    discovered: new Set(),
    orders: [],
    results: [],
    problemList: [],
    events: [],
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
 * simulated turnaround (labs ~20s, imaging ~45s). When the timer fires, the
 * result is resolved (data revealed) and a `result` event is appended.
 */
export function placeOrder(
  code: string,
  label?: { en: string; tr: string },
): void {
  const c = state.caseInstance;
  if (!c) return;

  // Determine turnaround + whether this order maps to a lab or imaging datum.
  const resolvesToImaging = c.groundTruth.imaging.some((im) => im.orderCode === code);
  const turnaround = resolvesToImaging ? IMAGING_SIM_MS : LAB_SIM_MS;

  // Resolve the label from expected workup if not supplied.
  const expectation = c.expectedWorkup.find((w) => w.code.coding[0]?.code === code);
  const labelEn = label?.en ?? expectation?.label.en ?? code;
  const labelTr = label?.tr ?? expectation?.label.tr ?? code;

  const placedAt = nowOffset();
  const order: PlacedOrder = {
    code,
    labelEn,
    labelTr,
    placedAt,
    resultsReadyAt: placedAt + turnaround,
    resolved: false,
  };
  const indicated = c.expectedWorkup.some((w) => w.code.coding[0]?.code === code);
  const lowValue = c.expectedWorkup.some((w) => w.code.coding[0]?.code === code && w.lowValue);
  const ev = appendEvent("order", code, { indicated, lowValue });
  setState({ ...state, orders: [...state.orders, order], stage: "orders", events: [...state.events, ev] });

  const timer = setTimeout(() => {
    pendingTimers.delete(timer);
    resolveOrder(code);
  }, turnaround);
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

/** Current encounter-clock reading in ms (0 before start). */
export function getEncounterClockMs(s: EncounterState): number {
  return s.startTs == null ? 0 : Math.max(0, clock() - s.startTs);
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
