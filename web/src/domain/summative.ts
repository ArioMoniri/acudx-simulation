/**
 * AcuDx — summative EXAM mode (GitHub #108): types + scoring + a persisted
 * attempts store.
 *
 * A summative exam is DISTINCT from free practice: a proctored run of N generated
 * cases with guidance FORCED OFF and a per-case countdown, ending in a scored
 * competency report persisted locally. This module is the pure heart of that
 * feature — configuration, the per-case scorer, the aggregate scorer, and a
 * dependency-free `useSyncExternalStore` attempts store (mirroring
 * src/state/progressStore.ts) keyed on localStorage.
 *
 * Scoring REUSES the shared process-metrics layer (src/domain/processMetrics.ts)
 * over the SAME event-sourced encounter log the live store produces — it never
 * duplicates that logic — so the grade a learner earns is exactly what their
 * actions produced. All scorers are pure (no clock reads, no I/O); timestamps are
 * stamped only when an attempt is actually saved.
 *
 * Education only. Synthetic patients. No real patient data path.
 */

import { useSyncExternalStore } from "react";

import type { Bilingual } from "@/data/schema";
import type { ChiefComplaintFamily } from "@/domain/caseGen";
import type { CaseInstance } from "@/domain/case";
import { computeProcessMetrics } from "@/domain/processMetrics";
import type { EncounterState } from "@/state/encounterStore";

/* -------------------------------------------------------------------------- */
/* Configuration                                                               */
/* -------------------------------------------------------------------------- */

/**
 * How an exam is set up: how many cases, how long per case, and which
 * chief-complaint families to draw from. `mix: "random"` draws freely across the
 * whole generator catalogue; an explicit array constrains the draw and is cycled
 * across the case sequence.
 */
export interface ExamConfig {
  /** Number of cases in the run. */
  length: number;
  /** Countdown budget for each case, in seconds. */
  perCaseSeconds: number;
  /** Draw freely ("random") or constrain to the given families (cycled). */
  mix: "random" | ChiefComplaintFamily[];
}

export const DEFAULT_EXAM_CONFIG: ExamConfig = {
  length: 5,
  perCaseSeconds: 600,
  mix: "random",
};

/** Selectable exam lengths surfaced on the intro screen. */
export const EXAM_LENGTH_CHOICES: readonly number[] = [3, 5, 8];

/** Selectable per-case time budgets (seconds) surfaced on the intro screen. */
export const EXAM_TIME_CHOICES: readonly number[] = [300, 600, 900];

/** The chief-complaint families the exam can constrain to (shared facet). */
export const EXAM_MIX_FAMILIES: readonly ChiefComplaintFamily[] = [
  "chest-pain",
  "headache",
  "abdominal-pain",
  "dyspnea",
];

/** Maximum achievable points for a single case (dx 50 + red-flags 25 + workup 25). */
export const MAX_POINTS_PER_CASE = 100;

/**
 * The chief-complaint constraint for the case at `index`, or null for a free
 * draw. An explicit mix is cycled so a 5-case run over two families alternates.
 */
export function constraintForCase(
  config: ExamConfig,
  index: number,
): ChiefComplaintFamily | null {
  if (config.mix === "random" || config.mix.length === 0) return null;
  return config.mix[index % config.mix.length];
}

/* -------------------------------------------------------------------------- */
/* Scoring result shapes                                                       */
/* -------------------------------------------------------------------------- */

/** Diagnostic outcome for one case. */
export type DxVerdict = "correct" | "near-miss" | "incorrect";

/**
 * Work-up appropriateness for one case, 0..1, with the counts that produced it.
 * `over` = orders placed that were not indicated (low-value + unmapped);
 * `under` = expected (non-low-value) actions that were never ordered.
 */
export interface WorkupAppropriateness {
  score: number;
  indicated: number;
  over: number;
  under: number;
}

/** The pure grade for a single case (no identity — the caller wraps it). */
export interface CaseScore {
  dxVerdict: DxVerdict;
  /** The diagnosis code the learner committed, or null if none. */
  committedCode: string | null;
  /** The case's correct diagnosis code. */
  correctCode: string;
  redFlagsCaught: number;
  redFlagsTotal: number;
  workupAppropriateness: WorkupAppropriateness;
  /** Wall-clock the learner spent on the case, ms. */
  timeMs: number;
  /** Time-to-diagnosis from the event log, ms (null when never committed). */
  timeToDiagnosisMs: number | null;
  /** 0..MAX_POINTS_PER_CASE. */
  points: number;
}

/** A scored case plus its identity + timeout flag — one row of the report. */
export interface CaseResult extends CaseScore {
  /** Zero-based position in the run. */
  index: number;
  caseId: string;
  /** Chief-complaint title, bilingual (for the report row). */
  title: Bilingual;
  /** True when the countdown expired and the case auto-submitted. */
  timedOut: boolean;
}

/** Aggregate competency roll-up across every case of an attempt. */
export interface ExamAggregate {
  cases: number;
  correct: number;
  nearMiss: number;
  /** Strict diagnostic accuracy: correct / cases, 0..1. */
  accuracy: number;
  /** Red flags caught / red flags present across the run, 0..1 (1 when none). */
  redFlagCapturePct: number;
  /** Mean per-case work-up appropriateness, 0..1. */
  workupAppropriateness: number;
  /** Mean time-to-diagnosis across committed cases, ms (null when none). */
  meanTimeToDiagnosisMs: number | null;
  /** Mean total time spent per case, ms. */
  meanTimeMs: number;
  points: number;
  maxPoints: number;
}

/* -------------------------------------------------------------------------- */
/* Scoring (pure)                                                              */
/* -------------------------------------------------------------------------- */

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

function primaryCodeOf(coding: { coding: { code: string }[] }): string {
  return coding.coding[0]?.code ?? "";
}

/**
 * scoreCase — grade a single completed exam case from the live encounter state.
 * Pure: derives the diagnosis verdict, red-flag capture, and work-up
 * appropriateness (via the shared process-metrics layer) and rolls them into a
 * 0..100 points total. `elapsedMs` is the wall-clock the learner spent on the
 * case (drives `timeMs`); time-to-diagnosis comes from the event log.
 */
export function scoreCase(
  state: EncounterState,
  caseInstance: CaseInstance,
  elapsedMs: number,
): CaseScore {
  const correctCode = primaryCodeOf(caseInstance.correctDiagnosis.code);
  const committedCode = state.committedDiagnosis;

  let dxVerdict: DxVerdict;
  if (committedCode && committedCode === correctCode) {
    dxVerdict = "correct";
  } else if (
    committedCode &&
    caseInstance.differentials.some((d) => primaryCodeOf(d.code) === committedCode)
  ) {
    // Committed a plausible differential — close, but not the answer.
    dxVerdict = "near-miss";
  } else {
    dxVerdict = "incorrect";
  }

  // Red flags: the red-flagged history features the learner should have screened,
  // measured against those actually elicited (revealed) during the encounter.
  const redFlagItems = caseInstance.groundTruth.history.filter((h) => h.redFlag);
  const redFlagsTotal = redFlagItems.length;
  const redFlagsCaught = redFlagItems.filter((h) => state.discovered.has(h.id)).length;

  // Work-up appropriateness from the shared metrics: indicated vs over/under.
  const metrics = computeProcessMetrics(state.events, caseInstance);
  const appr = metrics.orderAppropriateness;
  const indicated = appr.indicated;
  const over = appr.lowValue + appr.unmapped;
  const under = metrics.timeToCriticalAction.filter((a) => a.status === "missed").length;
  const denom = indicated + over + under;
  const workupScore = denom === 0 ? 1 : clamp01(indicated / denom);
  const workupAppropriateness: WorkupAppropriateness = {
    score: workupScore,
    indicated,
    over,
    under,
  };

  const dxPoints = dxVerdict === "correct" ? 50 : dxVerdict === "near-miss" ? 25 : 0;
  const rfRatio = redFlagsTotal > 0 ? redFlagsCaught / redFlagsTotal : 1;
  const rfPoints = 25 * rfRatio;
  const workupPoints = 25 * workupScore;
  const points = Math.round(dxPoints + rfPoints + workupPoints);

  return {
    dxVerdict,
    committedCode: committedCode ?? null,
    correctCode,
    redFlagsCaught,
    redFlagsTotal,
    workupAppropriateness,
    timeMs: Math.max(0, Math.round(elapsedMs)),
    timeToDiagnosisMs: metrics.timeToDiagnosisMs,
    points,
  };
}

/**
 * scoreAggregate — roll per-case results into the competency summary that the
 * final report renders (accuracy, red-flag capture %, work-up appropriateness,
 * mean time-to-diagnosis, and the total points). Pure.
 */
export function scoreAggregate(results: CaseResult[]): ExamAggregate {
  const cases = results.length;
  const correct = results.filter((r) => r.dxVerdict === "correct").length;
  const nearMiss = results.filter((r) => r.dxVerdict === "near-miss").length;

  const totalRF = results.reduce((s, r) => s + r.redFlagsTotal, 0);
  const caughtRF = results.reduce((s, r) => s + r.redFlagsCaught, 0);

  const dxTimes = results
    .map((r) => r.timeToDiagnosisMs)
    .filter((x): x is number => x != null);

  return {
    cases,
    correct,
    nearMiss,
    accuracy: cases === 0 ? 0 : correct / cases,
    redFlagCapturePct: totalRF > 0 ? caughtRF / totalRF : 1,
    workupAppropriateness:
      cases === 0
        ? 0
        : results.reduce((s, r) => s + r.workupAppropriateness.score, 0) / cases,
    meanTimeToDiagnosisMs:
      dxTimes.length > 0
        ? Math.round(dxTimes.reduce((a, b) => a + b, 0) / dxTimes.length)
        : null,
    meanTimeMs: cases === 0 ? 0 : Math.round(results.reduce((s, r) => s + r.timeMs, 0) / cases),
    points: results.reduce((s, r) => s + r.points, 0),
    maxPoints: cases * MAX_POINTS_PER_CASE,
  };
}

/* -------------------------------------------------------------------------- */
/* Formatting helper (shared by timer + report)                               */
/* -------------------------------------------------------------------------- */

/** Format a millisecond duration as `M:SS` (clamped at zero). */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/* -------------------------------------------------------------------------- */
/* Attempt model                                                               */
/* -------------------------------------------------------------------------- */

/** A completed exam attempt — the atom persisted to localStorage. */
export interface ExamAttempt {
  id: string;
  /** ISO timestamp, stamped at save time (never at module load). */
  at: string;
  config: ExamConfig;
  perCase: CaseResult[];
  aggregate: ExamAggregate;
}

/** Stable-ish id generated at call time (never at module load). */
function makeAttemptId(): string {
  return `exam-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Build an {@link ExamAttempt} from a finished run. Stamps `id` + `at` at CALL
 * time (per #108: no Date.now at module load) and computes the aggregate.
 */
export function buildExamAttempt(config: ExamConfig, results: CaseResult[]): ExamAttempt {
  return {
    id: makeAttemptId(),
    at: new Date().toISOString(),
    config,
    perCase: results,
    aggregate: scoreAggregate(results),
  };
}

/* -------------------------------------------------------------------------- */
/* Persistence (dependency-free external store, mirrors progressStore)         */
/* -------------------------------------------------------------------------- */

const STORAGE_KEY = "acudx-exam-attempts";

interface AttemptsState {
  attempts: ExamAttempt[];
}

function isAttempt(v: unknown): v is ExamAttempt {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.at === "string" &&
    typeof o.config === "object" &&
    o.config !== null &&
    Array.isArray(o.perCase) &&
    typeof o.aggregate === "object" &&
    o.aggregate !== null
  );
}

/** Newest first (ISO strings sort chronologically). */
function byNewest(a: ExamAttempt, b: ExamAttempt): number {
  return a.at < b.at ? 1 : a.at > b.at ? -1 : 0;
}

function loadState(): AttemptsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { attempts: [] };
    const parsed = JSON.parse(raw) as unknown;
    const attempts = Array.isArray(parsed) ? parsed.filter(isAttempt) : [];
    attempts.sort(byNewest);
    return { attempts };
  } catch {
    return { attempts: [] };
  }
}

function persist(next: AttemptsState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next.attempts));
  } catch {
    /* storage unavailable — keep in-memory only */
  }
}

let state: AttemptsState = loadState();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function setState(next: AttemptsState): void {
  state = next;
  persist(next);
  emit();
}

/* -------------------------------------------------------------------------- */
/* Actions                                                                     */
/* -------------------------------------------------------------------------- */

/** Persist a completed attempt (newest first). De-duplicates by id. */
export function saveAttempt(attempt: ExamAttempt): void {
  if (state.attempts.some((a) => a.id === attempt.id)) return;
  const attempts = [attempt, ...state.attempts].sort(byNewest);
  setState({ attempts });
}

/** Clear every stored attempt (dev / account reset). */
export function clearExamAttempts(): void {
  setState({ attempts: [] });
}

/** Read attempts without subscribing (module consumers, tests). */
export function getExamAttempts(): ExamAttempt[] {
  return state.attempts;
}

/* -------------------------------------------------------------------------- */
/* Subscription + hooks                                                        */
/* -------------------------------------------------------------------------- */

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ExamAttempt[] {
  return state.attempts;
}

/** All persisted exam attempts, newest first. */
export function useExamAttempts(): ExamAttempt[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
