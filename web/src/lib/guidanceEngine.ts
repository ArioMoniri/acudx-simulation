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
 * not the diagnosis. `useLiveGrounding` grounds against guideline passages
 * (chief complaint / last action), not the case solution, and degrades to a
 * local cited guideline map when the pod backend is off or unreachable.
 *
 * No side effects beyond the grounding fetch (bounded + abortable). Education
 * only. No real patient data path.
 */

import { useEffect, useRef, useState } from "react";

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
import { getCitation, type Bilingual, type Lang } from "@/data/mock";

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

/** A cited guideline passage rendered by the guidance panel. */
export interface GuidancePassage {
  text: string;
  /** Human source line (issuing body / council / document). */
  source: string;
  /** Short citation label (e.g. "ESC ACS 2023") or id. */
  citation: string;
  /** Deep link to the guideline, when the gateway supplied one. */
  url?: string;
}

/** The focus the guidance grounds against: chief complaint / last action. */
export interface GroundingFocus {
  /** Free-text query — the chief complaint plus the latest action phrase. */
  query: string;
  /** Locale hint forwarded to the gateway; also picks the offline language. */
  locale?: Lang;
  /** Country hint forwarded to the gateway (e.g. "TR"). */
  country?: string;
  /**
   * Citation ids to fall back to when offline — normally the case's
   * expectedWorkup citations, so the local reference stays case-relevant.
   */
  citationIds?: string[];
}

export interface GroundingResult {
  passages: GuidancePassage[];
  /** True whenever the passages came from the offline/local path, not the pod. */
  degraded: boolean;
  /** A live request is in flight. */
  loading: boolean;
}

/**
 * A small, process-oriented local guideline map. Statements coach the WORKUP
 * (timing, structure, safety) and never name a diagnosis, so the offline path
 * is safe to show verbatim.
 */
const LOCAL_GUIDELINES: Record<string, Bilingual> = {
  "esc-acs-2023": {
    en: "Record a 12-lead ECG within 10 minutes of first medical contact and apply a 0/1-hour high-sensitivity troponin protocol to rule myocardial injury in or out.",
    tr: "İlk tıbbi temastan sonraki 10 dakika içinde 12 derivasyonlu EKG çekin ve miyokart hasarını dışlamak veya doğrulamak için 0/1 saat yüksek duyarlıklı troponin protokolü uygulayın.",
  },
  "nice-ng185": {
    en: "Take a focused history early: characterise the pain (onset, radiation, character) and screen cardiac risk factors and red flags before narrowing.",
    tr: "Erken odaklı anamnez alın: ağrıyı karakterize edin (başlangıç, yayılım, nitelik) ve daraltmadan önce kardiyak risk faktörlerini ve kırmızı bayrakları tarayın.",
  },
  "tepdad-em": {
    en: "Structure the emergency work-up: stabilise first, then a focused history and examination, targeted investigations, and timely analgesia.",
    tr: "Acil iş akışını yapılandırın: önce stabilize edin, ardından odaklı anamnez ve muayene, hedefe yönelik tetkikler ve zamanında analjezi.",
  },
  "titck-formulary": {
    en: "Confirm allergies and interactions before prescribing, and document the indication and dose for every agent given.",
    tr: "Reçete etmeden önce alerjileri ve etkileşimleri doğrulayın; verilen her ajan için endikasyonu ve dozu kaydedin.",
  },
};

const DEFAULT_FALLBACK_CITATIONS = ["tepdad-em"];
const MAX_PASSAGES = 4;
const GROUND_DEBOUNCE_MS = 400;

function localPassages(citationIds: string[], lang: Lang): GuidancePassage[] {
  const ids = citationIds.length > 0 ? citationIds : DEFAULT_FALLBACK_CITATIONS;
  const seen = new Set<string>();
  const out: GuidancePassage[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const citation = getCitation(id);
    const text = LOCAL_GUIDELINES[id]?.[lang] ?? citation?.source[lang];
    if (!text) continue;
    out.push({
      text,
      source: citation?.source[lang] ?? id,
      citation: citation?.label ?? id,
    });
    if (out.length >= MAX_PASSAGES) break;
  }
  return out;
}

/** Best-effort readable string from a permissive gateway citation object. */
function citationLabel(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object") {
    const rec = raw as Record<string, unknown>;
    for (const key of ["label", "id", "source", "title"]) {
      const v = rec[key];
      if (typeof v === "string" && v.trim()) return v;
    }
  }
  return "";
}

function mapLivePassages(passages: GroundPassage[] | undefined, lang: Lang): GuidancePassage[] {
  if (!passages) return [];
  const out: GuidancePassage[] = [];
  for (const p of passages) {
    const text = (p.statement ?? "").trim();
    if (!text) continue;
    const label =
      citationLabel(p.citation) || p.council || p.topic || getCitation(String(p.id ?? ""))?.label || "";
    const source = p.council || p.country || citationLabel(p.citation) || lang.toUpperCase();
    out.push({
      text,
      source: source || label,
      citation: label || source,
      ...(p.url ? { url: p.url } : {}),
    });
    if (out.length >= MAX_PASSAGES) break;
  }
  return out;
}

/**
 * useLiveGrounding — cited guideline passages for the current focus.
 *
 * When the live pod backend is enabled it POSTs `/v1/ground` (debounced +
 * abortable) and maps the returned passages. On any failure, an empty/degraded
 * response, or when the backend is off, it falls back to the case's
 * expectedWorkup citations joined to the local guideline map and marks the
 * result `degraded` so the UI can show it is running on the offline reference.
 */
export function useLiveGrounding(focus: GroundingFocus): GroundingResult {
  const { enabled } = useLiveBackend();
  const lang: Lang = focus.locale ?? "en";
  const citationIds = focus.citationIds ?? [];
  const citationKey = citationIds.join(",");
  const fallback = (): GuidancePassage[] => localPassages(citationIds, lang);

  const [result, setResult] = useState<GroundingResult>(() => ({
    passages: fallback(),
    degraded: true,
    loading: false,
  }));

  // Keep the newest fallback available to the async effect without re-firing it.
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;

  const query = focus.query.trim();

  useEffect(() => {
    // Offline (or empty query): serve the local reference synchronously.
    if (!enabled || query.length === 0) {
      setResult({ passages: fallbackRef.current(), degraded: true, loading: false });
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setResult((prev) => ({ ...prev, loading: true }));

    const timer = setTimeout(() => {
      void (async () => {
        const res = await ground(query, focus.country, lang, { signal: controller.signal });
        if (cancelled) return;
        if (res.ok && res.data.degraded !== true) {
          const passages = mapLivePassages(res.data.passages, lang);
          if (passages.length > 0) {
            setResult({ passages, degraded: false, loading: false });
            return;
          }
        }
        // Failure, degraded, or empty -> local reference.
        setResult({ passages: fallbackRef.current(), degraded: true, loading: false });
      })();
    }, GROUND_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, query, focus.country, lang, citationKey]);

  return result;
}
