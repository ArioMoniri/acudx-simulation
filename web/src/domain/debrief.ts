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

import type { Bilingual } from "@/data/schema";
import type { CaseInstance } from "@/domain/case";
import type { CodeableConcept } from "@/domain/fhir";
import type { EncounterState } from "@/state/encounterStore";
import type { GradeBand, GradeResult } from "@/lib/backend";
import {
  computeProcessMetrics,
  safetyCriticalMisses,
} from "@/domain/processMetrics";
import { getDiagnosis } from "@/domain/diagnosisCatalog";

/* -------------------------------------------------------------------------- */
/* Result shapes                                                               */
/* -------------------------------------------------------------------------- */

export type DxVerdict = "correct" | "near-miss" | "incorrect";

/**
 * Why a committed diagnosis was judged a near-miss — drives the case-specific
 * "why" copy and lets the A&P panel and the debrief explain the miss the same
 * way. Refines the old raw "same top-level system" test:
 *   - `listed-differential`: an alternative the case author explicitly listed;
 *   - `same-category`: shares the correct dx's ICD-10 3-char family (e.g.
 *     STEMI I21.3 vs NSTEMI I21.4) — a strong, same-disease near-miss;
 *   - `same-system`: same organ system AND same ICD-10 chapter (weaker).
 */
export type NearMissReason =
  | "listed-differential"
  | "same-category"
  | "same-system"
  | null;

/**
 * The distilled, display-ready slice of a pod /v1/grade result. The overall band
 * folds in process domains (communication, professionalism) a reconstructed
 * transcript can't evidence, so consumers headline `reasoningBand` (the
 * clinical-reasoning competency) + a real, verified evidence quote instead.
 */
export interface GradeInsight {
  overallBand: GradeBand;
  /** clinical_reasoning domain band — the diagnosis-reasoning competency. */
  reasoningBand: GradeBand;
  /** A verified verbatim quote evidencing the learner's reasoning, if any. */
  reasoningEvidence?: string;
  /** The grader graded ≥1 item (not fully degraded / empty transcript). */
  graded: boolean;
  model?: string | null;
}

/**
 * A diagnosis verdict shared by the A&P `VerdictPanel` and the attending
 * debrief, so both agree and both can carry the real pod grade when present.
 */
export interface DxAssessment {
  verdict: DxVerdict;
  /** The case's correct-diagnosis code, so the panel can reveal it on a miss. */
  correctCode: string;
  /** For a near-miss, how the commit relates to the ground truth. */
  nearMissReason: NearMissReason;
  /** Real pod-graded rubric insight, when a live grade was obtained. */
  grade?: GradeInsight;
}

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
  /** Real pod rubric insight, when the A&P obtained a live grade (optional). */
  grade?: GradeInsight;
  /**
   * Clinical Director notes logged during the encounter (Live mode): what the
   * Director changed and why, in sim-clock order. Empty offline.
   */
  directorNotes: DirectorNoteItem[];
}

export interface DirectorNoteItem {
  /** Sim-clock offset (ms) when the note was logged. */
  atMs: number;
  note: string;
  why: string;
  /** Set when the note records a fired complication rather than a narration. */
  complication?: string;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** Primary code string of a CodeableConcept, without importing the EHR layer. */
function primaryCode(concept: CodeableConcept): string {
  return concept.coding[0]?.code ?? "";
}

/** ICD-10 3-char category root, e.g. "I21.3" -> "I21", "T78.2XXA" -> "T78". */
function icdRoot(code: string): string {
  return (code || "").toUpperCase().replace(/[^A-Z0-9].*$/, "").slice(0, 3);
}

/** ICD-10 chapter letter, e.g. "I21.3" -> "I". */
function icdChapter(code: string): string {
  return (code || "").toUpperCase().charAt(0);
}

/** Upper case, no dot: "i21.09" -> "I2109". */
function icdKey(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** An ICD-10(-CM) shaped code: a letter, two digits or a digit and a letter, then up to four characters. */
function isIcd10(key: string): boolean {
  return /^[A-Z][0-9][0-9A-Z][0-9A-Z]{0,4}$/.test(key);
}

/**
 * Classify the committed diagnosis against the case ground truth — THE shared
 * comparison the A&P `VerdictPanel` and the debrief both use, so the two never
 * disagree. Exact match is correct; anything else is graded by relationship:
 *   - a more specific ICD-10-CM descendant of the correct code -> correct;
 *   - a listed differential -> near-miss (`listed-differential`);
 *   - sharing the correct dx's ICD-10 3-char family -> near-miss (`same-category`,
 *     e.g. STEMI I21.3 vs NSTEMI I21.4) — caught even when NOT listed;
 *   - same clinical system AND same ICD-10 chapter -> near-miss (`same-system`);
 *   - otherwise incorrect.
 *
 * This is stricter than the old raw same-top-level-system test: a same-system
 * commit in a different ICD chapter (e.g. syncope R55 for STEMI I21) is no
 * longer auto-credited as a near-miss. Codes are resolved to catalogue entries
 * first so an ICD-11/DSM-coded case still compares on canonical ICD-10 roots.
 */
export function classifyDiagnosis(
  committed: string,
  correctCode: string,
  differentialCodes: ReadonlySet<string>,
): DxAssessment {
  if (committed === correctCode) {
    return { verdict: "correct", correctCode, nearMissReason: null };
  }
  // Review 2026-10-21: the picker now searches the whole ICD-10-CM FY2027
  // release, so a learner can commit a more specific code than the case's
  // (I21.09 for I21.0). A descendant code is the same diagnosis, coded more
  // precisely, and is credited (server/terminology/icd.py relate_icd10).
  const a = icdKey(committed);
  const b = icdKey(correctCode);
  if (isIcd10(a) && isIcd10(b) && a.length > b.length && a.startsWith(b)) {
    return { verdict: "correct", correctCode, nearMissReason: null };
  }
  if (differentialCodes.has(committed)) {
    return { verdict: "near-miss", correctCode, nearMissReason: "listed-differential" };
  }
  const correctEntry = getDiagnosis(correctCode);
  const committedEntry = getDiagnosis(committed);
  if ((!correctEntry || !committedEntry) && isIcd10(a) && isIcd10(b) && a.slice(0, 3) === b.slice(0, 3)) {
    // A code outside the curated catalogue still earns the same-category near miss.
    return { verdict: "near-miss", correctCode, nearMissReason: "same-category" };
  }
  if (correctEntry && committedEntry) {
    if (icdRoot(correctEntry.icd10) === icdRoot(committedEntry.icd10)) {
      return { verdict: "near-miss", correctCode, nearMissReason: "same-category" };
    }
    if (
      correctEntry.system === committedEntry.system &&
      icdChapter(correctEntry.icd10) === icdChapter(committedEntry.icd10)
    ) {
      return { verdict: "near-miss", correctCode, nearMissReason: "same-system" };
    }
  }
  return { verdict: "incorrect", correctCode, nearMissReason: null };
}

/**
 * Distil a raw pod /v1/grade result into the display-ready `GradeInsight` shared
 * by the A&P panel and the debrief. Pure + defensive: a degraded / empty grade
 * yields `graded: false` so callers can fall back to the local verdict alone.
 */
export function summariseGrade(grade: GradeResult): GradeInsight {
  const reasoning = grade.domains.find((d) => d.domain === "clinical_reasoning");
  const evidenceItem =
    reasoning?.items.find((it) => it.met && it.evidence) ??
    reasoning?.items.find((it) => it.evidence);
  const gradedCount = grade.meta?.graded_count ?? 0;
  return {
    overallBand: grade.overall_band,
    reasoningBand: reasoning?.band ?? "ungraded",
    ...(evidenceItem?.evidence ? { reasoningEvidence: evidenceItem.evidence } : {}),
    graded: gradedCount > 0 && grade.overall_band !== "ungraded",
    model: grade.meta?.model ?? null,
  };
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
 *
 * `assessment` (optional) lets the A&P surface hand in the verdict it already
 * computed — including the real pod grade — so the debrief and the A&P agree and
 * both carry the backend grade when present. When omitted, the verdict is
 * derived from the same shared `classifyDiagnosis` helper, so the two paths are
 * always consistent.
 */
export function buildDebrief(
  state: EncounterState,
  caseInstance: CaseInstance,
  assessment?: DxAssessment,
): Debrief | null {
  const committed = state.committedDiagnosis;
  if (!committed) return null;

  const metrics = computeProcessMetrics(state.events, caseInstance);

  /* ---- Diagnosis verdict (shared with the A&P VerdictPanel) --------------- */
  const correctCode = primaryCode(caseInstance.correctDiagnosis.code);
  const differentialCodes = new Set(
    caseInstance.differentials.map((c) => primaryCode(c.code)),
  );
  const resolved =
    assessment ?? classifyDiagnosis(committed, correctCode, differentialCodes);
  const dxVerdict = resolved.verdict;
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

  const directorNotes: DirectorNoteItem[] = state.events
    .filter((e) => e.meta?.director === true)
    .map((e) => ({
      atMs: e.at,
      note: typeof e.meta?.note === "string" ? e.meta.note : typeof e.meta?.complication === "string" ? e.meta.complication : e.ref,
      why: typeof e.meta?.why === "string" ? e.meta.why : "",
      ...(typeof e.meta?.complication === "string" ? { complication: e.meta.complication } : {}),
    }));

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
    ...(resolved.grade ? { grade: resolved.grade } : {}),
    directorNotes,
  };
}
