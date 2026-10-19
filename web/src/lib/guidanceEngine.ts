/**
 * AcuDx — realtime guidance engine (coverage + live grounding).
 *
 * Pure logic + one hook that power the AMBOSS-style clinical-guidance and
 * attending-tips panels. It reads ONLY what the encounter store already exposes
 * (the event-sourced log + progressive-disclosure sets) and the case's
 * guideline-anchored expectations (expectedWorkup with ideal windows +
 * citations, expected history intents, exam maneuvers, red flags). It benchmarks
 * timing against `idealWindowMs` the same way src/domain/processMetrics.ts does
 * (that module is imported and reused for the ordered-action classification).
 *
 * PROCESS ONLY — never the answer. Nothing here reads `correctDiagnosis` or
 * `differentials`, so `computeCoverage` and every derived hint coach the WORKUP,
 * not the diagnosis. `useLiveGrounding` grounds against VERIFIED guideline
 * statements served by the gateway (chief complaint / last action), never the
 * case solution. There is no local guideline text: when the backend is off or
 * unreachable the result is an explicit "guidance unavailable" state, so a
 * learner is never shown an unverified or invented hint.
 *
 * No side effects beyond the grounding fetch (bounded + abortable). Education
 * only. No real patient data path.
 */

import { useEffect, useState } from "react";

import {
  expectedIntents,
  type CaseInstance,
  type ExamManeuver,
} from "@/domain/case";
import {
  computeProcessMetrics,
  type CriticalActionStatus,
} from "@/domain/processMetrics";
import {
  getEncounterClockMs,
  type EncounterEvent,
  type EncounterState,
} from "@/state/encounterStore";
import { useLiveBackend } from "@/lib/liveBackend";
import { ground, type GroundPassage } from "@/lib/backend";
import {
  primeStatementCache,
  toCitationView,
  toGuidanceHint,
  type CitationView,
  type GuidanceHint,
  type GuidelineStatementPayload,
} from "@/lib/guidelinesApi";
import type { Bilingual, Lang } from "@/data/mock"; // watchdog: allow (shared schema hub, type only)

/* -------------------------------------------------------------------------- */
/* Coverage result shapes                                                      */
/* -------------------------------------------------------------------------- */

export type CoverageStatus = "done" | "missing";

/** Live timing verdict for an expected workup order (clock-aware). */
export type WorkupTiming = "onTime" | "late" | "pending" | "overdue";

/** A single expected history intent / exam maneuver and whether it is covered. */
export interface CoverageItem {
  /** Stable ref: a QuestionIntent, an ExamManeuver, or an order code. */
  ref: string;
  status: CoverageStatus;
  /** True when eliciting this is a red-flag positive (history only). */
  redFlag?: boolean;
}

export interface CoverageGroup {
  done: number;
  expected: number;
  items: CoverageItem[];
}

/** An expected workup order, benchmarked live against its ideal window. */
export interface WorkupItem {
  expectationId: string;
  code: string;
  labelEn: string;
  labelTr: string;
  timing: WorkupTiming;
  /** True once the order has actually been placed. */
  ordered: boolean;
  /** When first ordered (ms from start), null if not yet ordered. */
  takenAtMs: number | null;
  idealWindowMs: number;
  citationId: string;
  critical: boolean;
}

export interface WorkupGroup {
  /** Orders actually placed (onTime + late). */
  done: number;
  expected: number;
  items: WorkupItem[];
}

/** One red-flag cue and whether it has been screened yet. */
export interface RedFlagItem {
  index: number;
  text: Bilingual;
  screened: boolean;
}

export interface RedFlagGroup {
  screened: number;
  total: number;
  items: RedFlagItem[];
}

/**
 * The single most useful next step. Process-oriented and diagnosis-free: it
 * points at a missing history intent, an un-done exam maneuver, an un-ordered
 * expected investigation, or a red-flag screen — never a candidate diagnosis.
 */
export interface NextBestAction {
  kind: "workup" | "history" | "exam" | "redflag" | "complete";
  /** order code | QuestionIntent | ExamManeuver (absent for "complete"). */
  ref?: string;
  /** Bilingual label for a workup action (from the expectation). */
  labelEn?: string;
  labelTr?: string;
  citationId?: string;
  idealWindowMs?: number;
  /** True when this is safety-critical or already overdue. */
  urgent: boolean;
}

export interface Coverage {
  history: CoverageGroup;
  exam: CoverageGroup;
  workup: WorkupGroup;
  redFlags: RedFlagGroup;
  nextBestAction: NextBestAction | null;
  /** Overall completeness across history + exam + workup, 0..1 (for the meter). */
  overallPct: number;
}

/* -------------------------------------------------------------------------- */
/* Coverage helpers                                                            */
/* -------------------------------------------------------------------------- */

/** Distinct question intents the learner has actually elicited (meta.hit). */
function askedIntentSet(events: EncounterEvent[]): Set<string> {
  return new Set(
    events
      .filter((e) => e.type === "question" && e.meta?.hit === true)
      .map((e) => e.ref),
  );
}

/** Distinct exam maneuvers the learner has actually performed (meta.hit). */
function performedManeuverSet(events: EncounterEvent[]): Set<string> {
  return new Set(
    events
      .filter((e) => e.type === "exam" && e.meta?.hit === true)
      .map((e) => e.ref),
  );
}

/** Expected exam maneuvers = the distinct maneuvers this case rewards. */
function expectedManeuvers(caseInstance: CaseInstance): ExamManeuver[] {
  return Array.from(
    new Set(caseInstance.groundTruth.exam.map((e) => e.maneuver)),
  );
}

function historyCoverage(
  state: EncounterState,
  caseInstance: CaseInstance,
): CoverageGroup {
  const asked = askedIntentSet(state.events);
  const redFlagIntents = new Set(
    caseInstance.groundTruth.history.filter((h) => h.redFlag).map((h) => h.intent),
  );
  const items: CoverageItem[] = expectedIntents(caseInstance).map((intent) => ({
    ref: intent,
    status: asked.has(intent) ? "done" : "missing",
    ...(redFlagIntents.has(intent) ? { redFlag: true } : {}),
  }));
  return {
    items,
    expected: items.length,
    done: items.filter((i) => i.status === "done").length,
  };
}

function examCoverage(
  state: EncounterState,
  caseInstance: CaseInstance,
): CoverageGroup {
  const done = performedManeuverSet(state.events);
  const items: CoverageItem[] = expectedManeuvers(caseInstance).map((m) => ({
    ref: m,
    status: done.has(m) ? "done" : "missing",
  }));
  return {
    items,
    expected: items.length,
    done: items.filter((i) => i.status === "done").length,
  };
}

/**
 * Workup coverage. Reuses computeProcessMetrics for the ordered-action
 * classification (onTime / late / missed vs idealWindowMs), then refines the
 * not-yet-ordered case with the live clock into pending (still in window) vs
 * overdue (window elapsed) so the coaching layer can nudge in time.
 */
function workupCoverage(
  state: EncounterState,
  caseInstance: CaseInstance,
  clockMs: number,
): WorkupGroup {
  const metrics = computeProcessMetrics(state.events, caseInstance);
  const items: WorkupItem[] = metrics.timeToCriticalAction.map((a) => {
    const ordered = a.takenAtMs != null;
    let timing: WorkupTiming;
    if (ordered) {
      timing = (a.status as CriticalActionStatus) === "onTime" ? "onTime" : "late";
    } else {
      timing = clockMs > a.idealWindowMs ? "overdue" : "pending";
    }
    return {
      expectationId: a.expectationId,
      code: a.code,
      labelEn: a.labelEn,
      labelTr: a.labelTr,
      timing,
      ordered,
      takenAtMs: a.takenAtMs,
      idealWindowMs: a.idealWindowMs,
      citationId: a.citationId,
      critical: a.critical,
    };
  });
  return {
    items,
    expected: items.length,
    done: items.filter((i) => i.ordered).length,
  };
}

/**
 * Red-flag screening. The case supplies textual red-flag cues (`redFlags`) and,
 * separately, red-flag-tagged history data. We tie the visible fill to real
 * progress: a cue reads "screened" once the learner has elicited that many
 * red-flag history positives, without claiming a false 1:1 mapping.
 */
function redFlagCoverage(
  state: EncounterState,
  caseInstance: CaseInstance,
): RedFlagGroup {
  const redFlagHistory = caseInstance.groundTruth.history.filter((h) => h.redFlag);
  const screenedCues = redFlagHistory.filter((h) => state.discovered.has(h.id)).length;
  const items: RedFlagItem[] = caseInstance.redFlags.map((text, index) => ({
    index,
    text,
    screened: index < screenedCues,
  }));
  return {
    items,
    total: items.length,
    screened: items.filter((i) => i.screened).length,
  };
}

/* -------------------------------------------------------------------------- */
/* Next best action                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Pick the single most useful next step. Priority walks safety first:
 *   1. an overdue expected order (critical ones first),
 *   2. a pending critical order still inside its window,
 *   3. an un-screened red-flag history intent,
 *   4. any other missing expected history intent,
 *   5. a missing expected exam maneuver,
 *   6. a remaining non-critical order,
 *   7. otherwise nothing outstanding — consolidate.
 * Never references the diagnosis.
 */
function pickNextBestAction(
  history: CoverageGroup,
  exam: CoverageGroup,
  workup: WorkupGroup,
): NextBestAction {
  const byWindow = (a: WorkupItem, b: WorkupItem) => a.idealWindowMs - b.idealWindowMs;

  const overdue = workup.items
    .filter((w) => !w.ordered && w.timing === "overdue")
    .sort((a, b) => Number(b.critical) - Number(a.critical) || byWindow(a, b));
  if (overdue.length > 0) return workupAction(overdue[0], true);

  const pendingCritical = workup.items
    .filter((w) => !w.ordered && w.critical && w.timing === "pending")
    .sort(byWindow);
  if (pendingCritical.length > 0) return workupAction(pendingCritical[0], true);

  const missingRedFlagIntent = history.items.find(
    (i) => i.status === "missing" && i.redFlag,
  );
  if (missingRedFlagIntent) {
    return { kind: "history", ref: missingRedFlagIntent.ref, urgent: true };
  }

  const missingHistory = history.items.find((i) => i.status === "missing");
  if (missingHistory) {
    return { kind: "history", ref: missingHistory.ref, urgent: false };
  }

  const missingExam = exam.items.find((i) => i.status === "missing");
  if (missingExam) {
    return { kind: "exam", ref: missingExam.ref, urgent: false };
  }

  const remainingOrder = workup.items
    .filter((w) => !w.ordered)
    .sort((a, b) => Number(b.critical) - Number(a.critical) || byWindow(a, b))[0];
  if (remainingOrder) return workupAction(remainingOrder, remainingOrder.critical);

  return { kind: "complete", urgent: false };
}

function workupAction(w: WorkupItem, urgent: boolean): NextBestAction {
  return {
    kind: "workup",
    ref: w.code,
    labelEn: w.labelEn,
    labelTr: w.labelTr,
    citationId: w.citationId,
    idealWindowMs: w.idealWindowMs,
    urgent,
  };
}

/* -------------------------------------------------------------------------- */
/* computeCoverage                                                             */
/* -------------------------------------------------------------------------- */

/**
 * computeCoverage — which expected history intents, exam maneuvers, and workup
 * orders are DONE vs MISSING, with clock-aware timing, red-flag screening, and
 * the single next-best action. Pure (reads the injected sim clock only). NEVER
 * returns or references the diagnosis.
 */
export function computeCoverage(
  state: EncounterState,
  caseInstance: CaseInstance,
): Coverage {
  const clockMs = getEncounterClockMs(state);
  const history = historyCoverage(state, caseInstance);
  const exam = examCoverage(state, caseInstance);
  const workup = workupCoverage(state, caseInstance, clockMs);
  const redFlags = redFlagCoverage(state, caseInstance);

  const doneTotal = history.done + exam.done + workup.done;
  const expectedTotal = history.expected + exam.expected + workup.expected;
  const overallPct = expectedTotal === 0 ? 0 : doneTotal / expectedTotal;

  return {
    history,
    exam,
    workup,
    redFlags,
    nextBestAction: pickNextBestAction(history, exam, workup),
    overallPct,
  };
}

/* -------------------------------------------------------------------------- */
/* Live grounding                                                              */
/* -------------------------------------------------------------------------- */

/** A cited, VERIFIED guideline passage rendered by the guidance panel. */
export interface GuidancePassage {
  text: string;
  /** Human source line (issuing body and edition). */
  source: string;
  /** Short citation label (e.g. "NICE NG185"). */
  citation: string;
  /** Deep link to the guideline (source URL or DOI). */
  url?: string;
  /** Full citation view for chips / tooltips. */
  citationView: CitationView;
  /** Statement id in the verified store. */
  statementId: string;
  /** The passage as a GuidanceCard hint. */
  hint: GuidanceHint;
}

/** The focus the guidance grounds against: chief complaint / last action. */
export interface GroundingFocus {
  /** Free-text query — the chief complaint plus the latest action phrase. */
  query: string;
  /** Locale hint forwarded to the gateway. */
  locale?: Lang;
  /** Country hint forwarded to the gateway (e.g. "TR"). */
  country?: string;
}

export interface GroundingResult {
  passages: GuidancePassage[];
  /** True whenever no verified passage could be served (backend off, error, empty). */
  unavailable: boolean;
  /** Kept for callers that branch on the old name; equals `unavailable`. */
  degraded: boolean;
  /** A live request is in flight. */
  loading: boolean;
}

const MAX_PASSAGES = 4;
const GROUND_DEBOUNCE_MS = 400;

const UNAVAILABLE: GroundingResult = { passages: [], unavailable: true, degraded: true, loading: false };

/**
 * Map a /v1/ground passage (verified store projection) to the panel shape. A
 * passage without text or without a resolving source is dropped: no citation,
 * no hint.
 */
function toPayload(p: GroundPassage): GuidelineStatementPayload | null {
  const text = (p.statement ?? "").trim();
  const c = p.citation ?? {};
  const url = String(c.url ?? p.url ?? "").trim();
  const doi = String(c.doi ?? "").trim();
  if (!text || !p.id || (!url && !doi)) return null;
  return {
    id: String(p.id),
    statement: text,
    statement_en: text,
    statement_tr: text,
    source_body: String(c.body ?? p.council ?? ""),
    source_title: String(c.title ?? ""),
    source_url: url,
    doi,
    edition_or_version: String(c.edition ?? c.reference ?? ""),
    published_date: String(c.pub_date ?? ""),
    verified_at: String(c.verified_at ?? ""),
    verification_method: "",
    verification_quote: "",
    license_tag: "",
    scope: {},
    condition_codes: [],
    topic: String(p.topic ?? ""),
    status: "verified",
  };
}

export function mapLivePassages(passages: GroundPassage[] | undefined): GuidancePassage[] {
  if (!passages) return [];
  const out: GuidancePassage[] = [];
  for (const p of passages) {
    const payload = toPayload(p);
    if (!payload) continue;
    primeStatementCache(payload);
    const citationView = toCitationView(payload);
    out.push({
      text: payload.statement,
      source: [citationView.body, citationView.edition].filter(Boolean).join(" · "),
      citation: citationView.label,
      ...(citationView.url ? { url: citationView.url } : {}),
      citationView,
      statementId: payload.id,
      hint: toGuidanceHint(payload),
    });
    if (out.length >= MAX_PASSAGES) break;
  }
  return out;
}

/**
 * useLiveGrounding — verified guideline passages for the current focus.
 *
 * When the gateway is reachable it POSTs `/v1/ground` (debounced + abortable)
 * and maps the returned VERIFIED passages. On any failure, an empty response,
 * or when the backend is off, it returns `unavailable: true` with no passages.
 * There is deliberately no offline guideline text.
 */
export function useLiveGrounding(focus: GroundingFocus): GroundingResult {
  const { enabled } = useLiveBackend();
  const lang: Lang = focus.locale ?? "en";
  const [result, setResult] = useState<GroundingResult>(UNAVAILABLE);
  const query = focus.query.trim();

  useEffect(() => {
    if (!enabled || query.length === 0) {
      setResult(UNAVAILABLE);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setResult((prev) => ({ ...prev, loading: true }));

    const timer = setTimeout(() => {
      void (async () => {
        const res = await ground(query, focus.country, lang, { signal: controller.signal });
        if (cancelled) return;
        if (res.ok) {
          const passages = mapLivePassages(res.data.passages);
          if (passages.length > 0) {
            setResult({ passages, unavailable: false, degraded: false, loading: false });
            return;
          }
        }
        setResult(UNAVAILABLE);
      })();
    }, GROUND_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [enabled, query, focus.country, lang]);

  return result;
}
