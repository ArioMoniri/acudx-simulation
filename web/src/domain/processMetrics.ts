/**
 * AcuDx — process-aware assessment metrics (docs/00-overview/04 §4).
 *
 * Pure functions that derive process metrics from the event-sourced encounter
 * log (src/state/encounterStore.ts EncounterEvent[]) and benchmark them against
 * the case's guideline-derived expectations (CaseInstance.expectedWorkup with
 * ideal time windows + citations). No side effects, no clock reads.
 *
 * Every timing verdict carries the citation id it was measured against so the
 * feedback layer can render "target <= 10 min - ESC ACS 2023" (§4.2).
 *
 * WORKED EXAMPLE (seed case em-acs-001, see src/data/seedCases.ts):
 *   Events (at = ms from start):
 *     question onset       @  5_000
 *     order   11524-6 ECG  @ 240_000  (4 min)   -> onTime  (window 600_000)
 *     order   67151-1 trop @ 540_000  (9 min)   -> onTime  (window 900_000)
 *     diagnosis I21.4      @ 900_000  (correct)
 *   computeProcessMetrics(events, chestPainNstemiCase) yields:
 *     timeToFirstQuestionMs = 5_000
 *     criticalActions: ECG onTime, troponin onTime
 *     diagnosisCorrect = true, timeToDiagnosisMs = 900_000
 *     historyCoveragePct = askedIntents / expectedIntents
 *
 * Education only.
 */

import { expectedIntents, type CaseInstance, type OrderExpectation } from "@/domain/case";
import type { EncounterEvent } from "@/state/encounterStore";

/* -------------------------------------------------------------------------- */
/* Result shapes                                                               */
/* -------------------------------------------------------------------------- */

export type CriticalActionStatus = "onTime" | "late" | "missed";

export interface CriticalActionResult {
  expectationId: string;
  /** Order code measured. */
  code: string;
  labelEn: string;
  labelTr: string;
  status: CriticalActionStatus;
  /** When the action was first taken (ms from start), null if missed. */
  takenAtMs: number | null;
  /** The guideline ideal window (ms). */
  idealWindowMs: number;
  citationId: string;
  /** True for a safety-critical expectation (surfaced separately, §4.2 AS-8). */
  critical: boolean;
}

export interface OrderAppropriateness {
  /** Count of placed orders that were indicated by the expected workup. */
  indicated: number;
  /** Count of placed orders that were low-value / not indicated. */
  lowValue: number;
  /** Count of placed orders with no mapping (neither indicated nor low-value). */
  unmapped: number;
  /** Distinct order codes flagged low-value (for the feedback list). */
  lowValueCodes: string[];
}

export interface CommunicationFlags {
  /** Whether the student explored ideas/concerns/expectations (from event meta). */
  exploredIce: boolean;
  /** Whether a red-flag screening question was asked. */
  screenedRedFlags: boolean;
  /** Whether allergies were checked (asked or via banner interaction). */
  checkedAllergies: boolean;
}

export interface ProcessMetrics {
  totalTimeMs: number;
  timeToFirstQuestionMs: number | null;
  questionCount: number;
  /** Distinct expected intents asked / total expected, 0..1. */
  historyCoveragePct: number;
  /** Questions that hit a datum already discovered (duplicates). */
  redundantQuestions: number;
  /** Questions that hit nothing relevant (off-target). */
  irrelevantQuestions: number;
  /** Per critical/expected action: on-time / late / missed vs its window. */
  timeToCriticalAction: CriticalActionResult[];
  orderAppropriateness: OrderAppropriateness;
  diagnosisCorrect: boolean;
  timeToDiagnosisMs: number | null;
  communicationFlags: CommunicationFlags;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function metaBool(ev: EncounterEvent, key: string): boolean {
  return ev.meta?.[key] === true;
}

/** First event of a type (by causal seq), or undefined. */
function firstOfType(events: EncounterEvent[], type: EncounterEvent["type"]): EncounterEvent | undefined {
  return [...events].sort((a, b) => a.seq - b.seq).find((e) => e.type === type);
}

/** Earliest `order` event for a given code, or undefined. */
function firstOrderFor(events: EncounterEvent[], code: string): EncounterEvent | undefined {
  return [...events]
    .filter((e) => e.type === "order" && e.ref === code)
    .sort((a, b) => a.at - b.at)[0];
}

function classifyAction(
  expectation: OrderExpectation,
  orderEvent: EncounterEvent | undefined,
): CriticalActionResult {
  let status: CriticalActionStatus;
  let takenAtMs: number | null;
  if (!orderEvent) {
    status = "missed";
    takenAtMs = null;
  } else {
    takenAtMs = orderEvent.at;
    status = orderEvent.at <= expectation.idealWindowMs ? "onTime" : "late";
  }
  return {
    expectationId: expectation.id,
    code: expectation.code.coding[0]?.code ?? "",
    labelEn: expectation.label.en,
    labelTr: expectation.label.tr,
    status,
    takenAtMs,
    idealWindowMs: expectation.idealWindowMs,
    citationId: expectation.citationId,
    critical: expectation.critical,
  };
}

/* -------------------------------------------------------------------------- */
/* Main                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * computeProcessMetrics — derive the §4 metrics from the event log.
 * Pure. `caseInstance` supplies the expected intents + workup windows + labels.
 */
export function computeProcessMetrics(
  events: EncounterEvent[],
  caseInstance: CaseInstance,
): ProcessMetrics {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);

  // Total time = latest event offset (0 if none).
  const totalTimeMs = sorted.reduce((max, e) => Math.max(max, e.at), 0);

  // Timing: first question.
  const firstQ = firstOfType(sorted, "question");
  const timeToFirstQuestionMs = firstQ ? firstQ.at : null;

  // Question counting + coverage/redundancy.
  const questionEvents = sorted.filter((e) => e.type === "question");
  const questionCount = questionEvents.length;
  const askedIntents = new Set(
    questionEvents.filter((e) => metaBool(e, "hit")).map((e) => e.ref),
  );
  const expected = expectedIntents(caseInstance);
  const covered = expected.filter((i) => askedIntents.has(i)).length;
  const historyCoveragePct = expected.length === 0 ? 0 : covered / expected.length;
  const redundantQuestions = questionEvents.filter((e) => metaBool(e, "redundant")).length;
  const irrelevantQuestions = questionEvents.filter((e) => e.meta?.hit === false).length;

  // Critical / expected actions vs their windows.
  const timeToCriticalAction: CriticalActionResult[] = caseInstance.expectedWorkup
    .filter((w) => !w.lowValue) // low-value expectations are graded in appropriateness, not timing
    .map((w) => classifyAction(w, firstOrderFor(sorted, w.code.coding[0]?.code ?? "")));

  // Order appropriateness.
  const orderEvents = sorted.filter((e) => e.type === "order");
  let indicated = 0;
  let lowValue = 0;
  let unmapped = 0;
  const lowValueCodes: string[] = [];
  for (const e of orderEvents) {
    if (metaBool(e, "lowValue")) {
      lowValue++;
      if (!lowValueCodes.includes(e.ref)) lowValueCodes.push(e.ref);
    } else if (metaBool(e, "indicated")) {
      indicated++;
    } else {
      unmapped++;
    }
  }
  const orderAppropriateness: OrderAppropriateness = {
    indicated,
    lowValue,
    unmapped,
    lowValueCodes,
  };

  // Diagnosis.
  const dxEvents = sorted.filter((e) => e.type === "diagnosis");
  const firstCorrectDx = dxEvents.find((e) => metaBool(e, "correct"));
  const diagnosisCorrect = Boolean(firstCorrectDx);
  const timeToDiagnosisMs = firstCorrectDx
    ? firstCorrectDx.at
    : dxEvents.length > 0
      ? dxEvents[dxEvents.length - 1].at
      : null;

  // Communication flags (placeholder, derived from event meta only; assessment
  // never infers the learner's emotion, docs §4.1 / arch/09).
  const communicationFlags: CommunicationFlags = {
    exploredIce: questionEvents.some((e) => e.ref === "ice" && metaBool(e, "hit")),
    screenedRedFlags: questionEvents.some(
      (e) => (e.ref === "red-flags" || e.ref === "risk-factors") && metaBool(e, "hit"),
    ),
    checkedAllergies: questionEvents.some((e) => e.ref === "allergies"),
  };

  return {
    totalTimeMs,
    timeToFirstQuestionMs,
    questionCount,
    historyCoveragePct,
    redundantQuestions,
    irrelevantQuestions,
    timeToCriticalAction,
    orderAppropriateness,
    diagnosisCorrect,
    timeToDiagnosisMs,
    communicationFlags,
  };
}

/* -------------------------------------------------------------------------- */
/* Convenience derivations for the feedback UI (later stage)                   */
/* -------------------------------------------------------------------------- */

/** Safety-critical process misses, surfaced separately and always (§4.2). */
export function safetyCriticalMisses(m: ProcessMetrics): CriticalActionResult[] {
  return m.timeToCriticalAction.filter((a) => a.critical && a.status === "missed");
}

/** Overall on-time rate across expected actions (0..1). */
export function onTimeRate(m: ProcessMetrics): number {
  const total = m.timeToCriticalAction.length;
  if (total === 0) return 0;
  const onTime = m.timeToCriticalAction.filter((a) => a.status === "onTime").length;
  return onTime / total;
}
