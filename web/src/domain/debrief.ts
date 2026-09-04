/**
 * AcuDx — Attending debrief (after-action, process-aware feedback).
 *
 * A PURE builder that turns a COMPLETED encounter (one with a committed working
 * diagnosis) into a structured debrief grading the CLINICAL PROCESS, not just the
 * final answer (docs/00-overview/04 §4):
 *   - diagnosis verdict vs the case ground truth (correct / near-miss / incorrect);
 *   - red-flag danger signs the learner elicited vs missed (from the reveal state);
 *   - work-up appropriateness (indicated orders vs over-/under-ordering) benchmarked
 *     against the case's expectedWorkup;
 *   - time-to-decision (commit) read from the event-sourced sim clock; and
 *   - 1-3 concise teaching points derived from the gaps.
 *
 * It REUSES the shared process-metrics layer (src/domain/processMetrics.ts) for
 * timing / coverage / order-appropriateness / safety — it does not recompute those.
 * Everything here is deterministic and defensive: each field degrades gracefully
 * when a case omits data. Labels are returned as stable ids + Bilingual values (or
 * i18n token keys), resolved to the active language in DebriefReport.
 *
 * `buildDebrief` returns null until a working diagnosis has been committed.
 *
 * Education only. No real patient data path.
 */

import type { Bilingual } from "@/data/mock";
import type { CaseInstance } from "@/domain/case";
import type { CodeableConcept } from "@/domain/fhir";
import type { EncounterState } from "@/state/encounterStore";
import {
  computeProcessMetrics,
  safetyCriticalMisses,
} from "@/domain/processMetrics";
import { getDiagnosis } from "@/domain/diagnosisCatalog";

/* -------------------------------------------------------------------------- */
/* Result shapes                                                               */
/* -------------------------------------------------------------------------- */

export type DxVerdict = "correct" | "near-miss" | "incorrect";

/** A graded red-flag danger sign. `label` is the case's own evidence, resolved
 *  to the active language in the component. */
export interface RedFlagItem {
  /** Ground-truth history-item id the capture was graded from (stable React key). */
  id: string;
  label: Bilingual;
}

/** An over-/under-ordered work-up test. */
export interface WorkupItem {
  /** Order / service code. */
  code: string;
  label: Bilingual;
}

/** A single teaching point, kept i18n-friendly: `key` selects the copy under
 *  `debrief.teaching.*`, `count` / `label` are interpolation params resolved in
 *  the component (so the builder stays language-agnostic). */
export interface TeachingPoint {
  /** Stable id for React keys. */
  id: string;
  /** i18n key suffix under `debrief.teaching.*`. */
  key: string;
  count?: number;
  label?: Bilingual;
}

export interface Debrief {
  dxVerdict: DxVerdict;
  /** The committed working-diagnosis display (student-authored label) + its code. */
  dxDisplay: string;
  dxCode: string;
  redFlags: { caught: RedFlagItem[]; missed: RedFlagItem[] };
  workup: {
    /** Distinct indicated (expected, non-low-value) tests actually ordered. */
    appropriate: number;
    /** Distinct expected (non-low-value) tests for this case. */
    expected: number;
    overOrdered: WorkupItem[];
    underOrdered: WorkupItem[];
  };
  /** Time from encounter start to the working-diagnosis commit, in ms. */
  timeToCommitMs: number;
  /** Distinct expected history intents covered, 0..1 (reused from process metrics). */
  historyCoveragePct: number;
  /** A safety-critical timing miss occurred, OR allergies were never checked
   *  before ordering (mirrors the progress-store safety gate). */
  safetyMiss: boolean;
  /** The case's own red-flag descriptions, for a teaching reference block. */
  redFlagReference: Bilingual[];
  teachingPoints: TeachingPoint[];
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** Primary code string of a CodeableConcept, without importing the EHR layer. */
function primaryCode(concept: CodeableConcept): string {
  return concept.coding[0]?.code ?? "";
}

/**
 * Classify the committed diagnosis against the case ground truth — the SAME
 * comparison the A&P VerdictPanel uses: exact match is correct; a listed
 * differential (or a diagnosis in the same clinical system) is a near-miss;
 * anything else is incorrect.
 */
function classifyDx(
  committed: string,
  correctCode: string,
  differentialCodes: ReadonlySet<string>,
): DxVerdict {
  if (committed === correctCode) return "correct";
  if (differentialCodes.has(committed)) return "near-miss";
  const correctSystem = getDiagnosis(correctCode)?.system;
  const committedSystem = getDiagnosis(committed)?.system;
  if (correctSystem && committedSystem && correctSystem === committedSystem) {
    return "near-miss";
  }
  return "incorrect";
}

/** Sim-clock offset (ms) at which the committed diagnosis was set. */
function commitTimeMs(state: EncounterState, code: string): number | null {
  let at: number | null = null;
  for (const e of state.events) {
    if (e.type === "diagnosis" && e.ref === code) at = e.at;
  }
  if (at != null) return at;
  const working = [...state.problemList].reverse().find((p) => p.role === "working");
  return working ? working.at : null;
}

interface TeachingInput {
  dxVerdict: DxVerdict;
  missedRedFlags: RedFlagItem[];
  underOrdered: WorkupItem[];
  overOrdered: WorkupItem[];
  safetyMiss: boolean;
  coverage: number;
}

/**
 * Derive 1-3 priority-ordered teaching points from the process gaps. Safety and
 * missed danger signs come first; a clean encounter yields a single positive
 * point. Deterministic and capped so the report stays scannable.
 */
function buildTeachingPoints(input: TeachingInput): TeachingPoint[] {
  const points: TeachingPoint[] = [];

  if (input.safetyMiss) {
    points.push({ id: "tp-safety", key: "safety" });
  }
  if (input.missedRedFlags.length > 0) {
    points.push({
      id: "tp-redflags",
      key: "redFlags",
      count: input.missedRedFlags.length,
      label: input.missedRedFlags[0].label,
    });
  }
  if (input.underOrdered.length > 0) {
    points.push({
      id: "tp-workup-gap",
      key: "workupGap",
      count: input.underOrdered.length,
      label: input.underOrdered[0].label,
    });
  }
  if (input.dxVerdict === "incorrect") {
    points.push({ id: "tp-dx-incorrect", key: "dxIncorrect" });
  } else if (input.dxVerdict === "near-miss") {
    points.push({ id: "tp-dx-near", key: "dxNear" });
  }
  if (input.overOrdered.length > 0) {
    points.push({
      id: "tp-over-order",
      key: "overOrder",
      count: input.overOrdered.length,
    });
  }
  if (input.coverage < 0.6) {
    points.push({ id: "tp-coverage", key: "coverage" });
  }

  if (points.length === 0) {
    points.push({ id: "tp-clean", key: "clean" });
  }
  return points.slice(0, 3);
}

/* -------------------------------------------------------------------------- */
/* Main                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Build the attending debrief for a completed encounter. Pure — reads only the
 * event-sourced state + the case ground truth. Returns null until a working
 * diagnosis is committed.
 */
export function buildDebrief(
  state: EncounterState,
  caseInstance: CaseInstance,
): Debrief | null {
  const committed = state.committedDiagnosis;
  if (!committed) return null;

  const metrics = computeProcessMetrics(state.events, caseInstance);

  /* ---- Diagnosis verdict -------------------------------------------------- */
  const correctCode = primaryCode(caseInstance.correctDiagnosis.code);
  const differentialCodes = new Set(
    caseInstance.differentials.map((c) => primaryCode(c.code)),
  );
  const dxVerdict = classifyDx(committed, correctCode, differentialCodes);
  const workingEntry = [...state.problemList]
    .reverse()
    .find((p) => p.role === "working");
  const dxDisplay = workingEntry?.display ?? committed;

  /* ---- Red flags: danger-sign history the learner should elicit ----------- */
  const redFlagHistory = caseInstance.groundTruth.history.filter(
    (h) => h.redFlag === true,
  );
  const caught: RedFlagItem[] = [];
  const missed: RedFlagItem[] = [];
  for (const h of redFlagHistory) {
    const item: RedFlagItem = { id: h.id, label: h.answer };
    (state.discovered.has(h.id) ? caught : missed).push(item);
  }

  /* ---- Work-up appropriateness ------------------------------------------- */
  const expectedCodes = new Set(
    caseInstance.expectedWorkup.map((w) => primaryCode(w.code)),
  );
  const lowValueCodes = new Set(
    caseInstance.expectedWorkup
      .filter((w) => w.lowValue)
      .map((w) => primaryCode(w.code)),
  );
  const expectedCount = caseInstance.expectedWorkup.filter(
    (w) => !w.lowValue,
  ).length;

  // Under-ordered = expected (non-low-value) actions the metrics graded "missed".
  const underOrdered: WorkupItem[] = metrics.timeToCriticalAction
    .filter((a) => a.status === "missed")
    .map((a) => ({ code: a.code, label: { en: a.labelEn, tr: a.labelTr } }));

  // Over-ordered = distinct placed orders that were low-value or not indicated;
  // indicated distinct = expected non-low-value codes the learner actually placed.
  const overSeen = new Set<string>();
  const overOrdered: WorkupItem[] = [];
  const indicatedDistinct = new Set<string>();
  for (const o of state.orders) {
    const isLowValue = lowValueCodes.has(o.code);
    const isIndicated = expectedCodes.has(o.code) && !isLowValue;
    if (isIndicated) {
      indicatedDistinct.add(o.code);
    } else if (!overSeen.has(o.code)) {
      overSeen.add(o.code);
      overOrdered.push({ code: o.code, label: { en: o.labelEn, tr: o.labelTr } });
    }
  }

  /* ---- Timing + safety ---------------------------------------------------- */
  const timeToCommitMs =
    commitTimeMs(state, committed) ??
    metrics.timeToDiagnosisMs ??
    metrics.totalTimeMs;

  const hadOrders = state.orders.length > 0;
  const allergiesUnchecked = !metrics.communicationFlags.checkedAllergies;
  const safetyMiss =
    safetyCriticalMisses(metrics).length > 0 || (hadOrders && allergiesUnchecked);

  /* ---- Teaching points ---------------------------------------------------- */
  const teachingPoints = buildTeachingPoints({
    dxVerdict,
    missedRedFlags: missed,
    underOrdered,
    overOrdered,
    safetyMiss,
    coverage: metrics.historyCoveragePct,
  });

  return {
    dxVerdict,
    dxDisplay,
    dxCode: committed,
    redFlags: { caught, missed },
    workup: {
      appropriate: indicatedDistinct.size,
      expected: expectedCount,
      overOrdered,
      underOrdered,
    },
    timeToCommitMs,
    historyCoveragePct: metrics.historyCoveragePct,
    safetyMiss,
    redFlagReference: caseInstance.redFlags,
    teachingPoints,
  };
}
