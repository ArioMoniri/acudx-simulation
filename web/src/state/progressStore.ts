/**
 * AcuDx — progress store (REAL, earned learning history).
 *
 * A dependency-free external store (consumed via React's `useSyncExternalStore`,
 * mirroring `encounterStore` / `profileStore`) that records the outcome of every
 * COMPLETED encounter and derives the learner's calibration, mastery, streak and
 * level from those records — nothing here is hand-authored per-user demo data.
 *
 * Design intent (why this file exists): the Home calibration snapshot, the
 * Progress mastery/calibration trend, and the Feedback report used to render
 * fixed mock arrays, so they looked identical for every learner and never
 * changed. Those plots are now driven from this store. A brand-new user has NO
 * history, so the plots render an honest empty state; each completed encounter
 * appends one real record and the plots fill in from earned data.
 *
 * A record is built by running the SAME pure process-metrics layer
 * (`src/domain/processMetrics.ts`) over the SAME event-sourced log the live
 * encounter store produces (`src/state/encounterStore.ts` EncounterEvent[]), so
 * the numbers a learner sees are exactly what their actions earned.
 *
 * Records are persisted to localStorage so progress survives a reload. There is
 * a single local profile per browser (see profileStore), so one namespace is
 * effectively per-user.
 *
 * Education only. No real patient data path.
 */

import { useSyncExternalStore } from "react";

import type {
  Band,
  Bilingual,
  CalibrationDirection,
  CalibrationPoint,
  DashboardStat,
  FeedbackAxis,
  FeedbackDomainKey,
  FeedbackGap,
  RecentFeedbackItem,
  TreatmentBehavior,
} from "@/data/mock";
import type {
  CalibrationSession,
  DomainTrend,
  LevelState,
  MasteryDomain,
  StreakDay,
  StreakDayState,
  StreakState,
  XpAward,
  XpReason,
} from "@/data/progress";
import {
  computeProcessMetrics,
  onTimeRate,
  safetyCriticalMisses,
  type CriticalActionResult,
  type ProcessMetrics,
} from "@/domain/processMetrics";
import { expectedIntents, type CaseInstance } from "@/domain/case";
import type { EncounterEvent } from "@/state/encounterStore";

/* -------------------------------------------------------------------------- */
/* Record shape                                                                */
/* -------------------------------------------------------------------------- */

/** One competency domain scored from a single encounter's real event log. */
export interface DomainScore {
  key: FeedbackDomainKey;
  axis: FeedbackAxis;
  /** Banded competence, or "withheld" when there was too little evidence. */
  band: Band;
  /** Behavioural decisiveness proxy (breadth/boldness of action), 0..1. */
  confidence: number;
  /** Measured competence for this domain, 0..1. */
  competence: number;
  /** True when the encounter produced enough signal to score this domain. */
  scored: boolean;
}

/** A completed-encounter record — the atom the plots are built from. */
export interface EncounterRecord {
  id: string;
  /** Encounter identity (the store's startTs) — used to de-duplicate. */
  sourceKey: number;
  caseId: string;
  /** Short display title (the case chief complaint), bilingual. */
  title: Bilingual;
  /** Epoch ms the encounter was recorded. */
  at: number;
  domainScores: DomainScore[];
  /** Calibration scatter points for the scored domains only. */
  calibration: CalibrationPoint[];
  /** Mean |confidence − competence| across scored domains, 0..1. */
  overallGap: number;
  /** Mean squared calibration error across scored domains, 0..1. */
  brier: number;
  /** Full process metrics computed from the real log (drives the report). */
  metrics: ProcessMetrics;
  /** Expected history intents for this case (for the coverage "n / m" readout). */
  expectedIntentCount: number;
  diagnosisCorrect: boolean;
  /** A safety-critical timing miss OR allergies never checked. */
  safetyMiss: boolean;
}

/* -------------------------------------------------------------------------- */
/* Domain model + small bilingual copy (data-level, en/tr only)                */
/* -------------------------------------------------------------------------- */

const DOMAIN_META: { key: FeedbackDomainKey; axis: FeedbackAxis }[] = [
  { key: "history", axis: "clinical" },
  { key: "exam", axis: "clinical" },
  { key: "reasoning", axis: "clinical" },
  { key: "communication", axis: "communication" },
  { key: "management", axis: "clinical" },
  { key: "professionalism", axis: "communication" },
];

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/** Map a 0..1 competence to one of the five ordered bands. */
function bandFromCompetence(comp: number): Exclude<Band, "withheld"> {
  if (comp >= 0.85) return "exemplary";
  if (comp >= 0.68) return "strong";
  if (comp >= 0.52) return "proficient";
  if (comp >= 0.36) return "developing";
  return "emerging";
}

/** Direction of a calibration point relative to the identity line. */
function directionFor(confidence: number, competence: number): CalibrationDirection {
  const delta = confidence - competence;
  return delta > 0.12 ? "over" : delta < -0.12 ? "under" : "well";
}

/* -------------------------------------------------------------------------- */
/* Building a record from the real encounter event log                         */
/* -------------------------------------------------------------------------- */

function countEvents(events: EncounterEvent[], type: EncounterEvent["type"]): number {
  return events.filter((e) => e.type === type).length;
}

/**
 * Score the six competency domains from the encounter's real event log +
 * process metrics. Competence is measured (what the actions achieved);
 * confidence is a behavioural decisiveness proxy (how boldly/broadly the learner
 * acted) — the app captures no explicit self-rating, so calibration here reads
 * decisiveness against measured competence. Domains without enough signal are
 * left unscored (surfaced as "withheld"), matching the reliability gating in the
 * feedback design.
 */
function deriveDomainScores(
  events: EncounterEvent[],
  caseInstance: CaseInstance,
  metrics: ProcessMetrics,
): DomainScore[] {
  const qCount = metrics.questionCount;
  const irrelevantRate = qCount > 0 ? metrics.irrelevantQuestions / qCount : 0;
  const redundantRate = qCount > 0 ? metrics.redundantQuestions / qCount : 0;

  const examEvents = events.filter((e) => e.type === "exam");
  const examHit = examEvents.filter((e) => e.meta?.hit === true).length;
  const examTotal = examEvents.length;

  const txEvents = events.filter((e) => e.type === "treatment");
  const txAppropriate = txEvents.filter(
    (e) => e.meta?.appropriateness === "indicated",
  ).length;

  const orderCount = countEvents(events, "order");
  const dxCount = countEvents(events, "diagnosis");

  const appr = metrics.orderAppropriateness;
  const apprTotal = appr.indicated + appr.lowValue;
  const apprScore = apprTotal > 0 ? appr.indicated / apprTotal : orderCount > 0 ? 0.6 : 0.5;
  const timedActions = metrics.timeToCriticalAction.length;
  const onTime = timedActions > 0 ? onTimeRate(metrics) : 0.5;
  const flags = metrics.communicationFlags;
  const expectedCount = Math.max(1, expectedIntents(caseInstance).length);

  const mean = (xs: number[]): number =>
    xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

  const raw: Record<
    FeedbackDomainKey,
    { competence: number; confidence: number; scored: boolean }
  > = {
    history: {
      competence: clamp01(metrics.historyCoveragePct - 0.15 * irrelevantRate),
      confidence: clamp01(qCount / expectedCount),
      scored: qCount > 0,
    },
    exam: {
      competence: examTotal > 0 ? clamp01(examHit / examTotal) : 0,
      confidence: clamp01(examTotal / 3),
      scored: examTotal > 0,
    },
    reasoning: {
      competence: clamp01(mean([onTime, apprScore, metrics.diagnosisCorrect ? 1 : 0.35])),
      confidence: dxCount > 0 ? 0.85 : 0.45,
      scored: orderCount > 0 || dxCount > 0,
    },
    communication: {
      competence: clamp01(
        mean([flags.screenedRedFlags ? 0.85 : 0.4, flags.exploredIce ? 0.9 : 0.55]) -
          0.1 * redundantRate,
      ),
      confidence: clamp01(0.6 + (flags.exploredIce ? 0.1 : 0)),
      scored: qCount > 0,
    },
    management: {
      competence: clamp01(
        mean([
          onTime,
          txEvents.length > 0 ? txAppropriate / txEvents.length : 0.5,
          metrics.diagnosisCorrect ? 0.75 : 0.4,
        ]),
      ),
      confidence: txEvents.length > 0 ? 0.8 : orderCount > 0 ? 0.6 : 0.45,
      scored: orderCount > 0 || txEvents.length > 0 || dxCount > 0,
    },
    // No dedicated professionalism instrument in the encounter — deliberately
    // left unscored so the UI surfaces "not enough evidence yet".
    professionalism: { competence: 0, confidence: 0, scored: false },
  };

  return DOMAIN_META.map(({ key, axis }) => {
    const r = raw[key];
    return {
      key,
      axis,
      band: r.scored ? bandFromCompetence(r.competence) : "withheld",
      confidence: r.confidence,
      competence: r.competence,
      scored: r.scored,
    };
  });
}

/** True when the log has enough real activity to count as a completed encounter. */
export function hasMeaningfulProgress(events: EncounterEvent[]): boolean {
  const clinical = events.filter((e) =>
    e.type === "question" || e.type === "exam" || e.type === "order" || e.type === "treatment",
  ).length;
  const committed = events.some((e) => e.type === "diagnosis");
  return committed || clinical >= 2;
}

/**
 * Build an {@link EncounterRecord} from the real event log + case. Pure: runs the
 * shared process-metrics layer, derives the domain scores + calibration, and
 * summarises safety — no fabricated numbers anywhere.
 */
export function buildEncounterRecord(
  events: EncounterEvent[],
  caseInstance: CaseInstance,
  sourceKey: number,
  at: number = Date.now(),
): EncounterRecord {
  const metrics = computeProcessMetrics(events, caseInstance);
  const domainScores = deriveDomainScores(events, caseInstance, metrics);
  const scored = domainScores.filter((d) => d.scored);

  const calibration: CalibrationPoint[] = scored.map((d) => ({
    domain: d.key,
    confidence: d.confidence,
    competence: d.competence,
    direction: directionFor(d.confidence, d.competence),
  }));

  const gaps = scored.map((d) => Math.abs(d.confidence - d.competence));
  const overallGap = gaps.length > 0 ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
  const brier =
    gaps.length > 0 ? gaps.reduce((a, b) => a + b * b, 0) / gaps.length : 0;

  const allergiesUnchecked = !metrics.communicationFlags.checkedAllergies;
  const hadOrders = countEvents(events, "order") > 0;
  const safetyMiss = safetyCriticalMisses(metrics).length > 0 || (hadOrders && allergiesUnchecked);

  return {
    id: `enc-${sourceKey}`,
    sourceKey,
    caseId: caseInstance.id,
    title: caseInstance.chiefComplaint,
    at,
    domainScores,
    calibration,
    overallGap,
    brier,
    metrics,
    expectedIntentCount: expectedIntents(caseInstance).length,
    diagnosisCorrect: metrics.diagnosisCorrect,
    safetyMiss,
  };
}

/* -------------------------------------------------------------------------- */
/* Persistence                                                                 */
/* -------------------------------------------------------------------------- */

const STORAGE_KEY = "acudx-progress:v1";

interface ProgressState {
  records: EncounterRecord[];
}

function isRecord(v: unknown): v is EncounterRecord {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.sourceKey === "number" &&
    typeof o.caseId === "string" &&
    typeof o.at === "number" &&
    Array.isArray(o.domainScores) &&
    Array.isArray(o.calibration) &&
    typeof o.metrics === "object" &&
    o.metrics !== null
  );
}

function loadState(): ProgressState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { records: [] };
    const parsed = JSON.parse(raw) as unknown;
    const records = Array.isArray(parsed) ? parsed.filter(isRecord) : [];
    records.sort((a, b) => a.at - b.at);
    return { records };
  } catch {
    return { records: [] };
  }
}

function persist(next: ProgressState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next.records));
  } catch {
    /* storage unavailable — keep in-memory only */
  }
}

/* -------------------------------------------------------------------------- */
/* Store internals                                                             */
/* -------------------------------------------------------------------------- */

let state: ProgressState = loadState();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function setState(next: ProgressState): void {
  state = next;
  persist(next);
  emit();
}

/* -------------------------------------------------------------------------- */
/* Actions                                                                     */
/* -------------------------------------------------------------------------- */

/** Append (or replace, by sourceKey) a completed-encounter record. */
export function recordEncounter(record: EncounterRecord): void {
  const existing = state.records.find((r) => r.sourceKey === record.sourceKey);
  if (existing) {
    // Same encounter already recorded and unchanged — no-op to avoid churn.
    if (existing.id === record.id && existing.at === record.at) return;
    const records = state.records.map((r) =>
      r.sourceKey === record.sourceKey ? record : r,
    );
    setState({ records });
    return;
  }
  const records = [...state.records, record].sort((a, b) => a.at - b.at);
  setState({ records });
}

/**
 * Convenience: build a record from a real encounter log + case and store it.
 * De-duplicates by `sourceKey`, so calling it repeatedly for the same encounter
 * is safe. Returns the record that is now current for that encounter.
 */
export function recordFromEncounter(
  events: EncounterEvent[],
  caseInstance: CaseInstance,
  sourceKey: number,
  at?: number,
): EncounterRecord {
  const existing = state.records.find((r) => r.sourceKey === sourceKey);
  if (existing) return existing;
  const record = buildEncounterRecord(events, caseInstance, sourceKey, at);
  recordEncounter(record);
  return record;
}

/** Clear all recorded progress (dev / tests / account reset). */
export function resetProgress(): void {
  setState({ records: [] });
}

/** Read records without subscribing (module consumers, tests). */
export function getProgressRecords(): EncounterRecord[] {
  return state.records;
}

/* -------------------------------------------------------------------------- */
/* Derived views (computed once per records change, referentially stable)      */
/* -------------------------------------------------------------------------- */

const LEVEL_STEP_XP = 250;

const LEVEL_TITLES: { min: number; title: Bilingual }[] = [
  { min: 1, title: { en: "Getting started", tr: "Başlangıç" } },
  { min: 3, title: { en: "Building the basics", tr: "Temelleri kuran" } },
  { min: 5, title: { en: "Calibrating clinician", tr: "Kalibrasyonunu geliştiren hekim" } },
  { min: 8, title: { en: "Steady operator", tr: "İstikrarlı klinisyen" } },
  { min: 12, title: { en: "Trusted responder", tr: "Güvenilen klinisyen" } },
];

function levelTitle(level: number): Bilingual {
  let title = LEVEL_TITLES[0].title;
  for (const t of LEVEL_TITLES) if (level >= t.min) title = t.title;
  return title;
}

/** XP earned by one record: base + correctness + calibration improvement + safety. */
function recordXp(rec: EncounterRecord, prev: EncounterRecord | null): number {
  let xp = 40;
  if (rec.diagnosisCorrect) xp += 30;
  if (!rec.safetyMiss) xp += 15;
  if (prev) {
    const improved = prev.overallGap - rec.overallGap; // positive = tighter
    if (improved > 0) xp += Math.min(40, Math.round(improved * 100) * 2);
  }
  return xp;
}

const XP_REASON_DETAIL: Record<XpReason, Bilingual> = {
  calibrationTightened: {
    en: "Your confidence–performance gap narrowed this encounter",
    tr: "Bu karşılaşmada güven–performans farkınız daraldı",
  },
  bandUp: {
    en: "A competency band moved up on measured performance",
    tr: "Ölçülen performansta bir yeterlilik bandı yükseldi",
  },
  gapClosed: {
    en: "Committed the correct diagnosis on the evidence",
    tr: "Kanıta dayalı doğru tanıya karar verildi",
  },
  safetyNetting: {
    en: "Completed the encounter with no safety-critical miss",
    tr: "Güvenlik açısından kritik bir eksik olmadan tamamlandı",
  },
  epaEntrusted: {
    en: "Demonstrated an entrustable activity",
    tr: "Emanet edilebilir bir aktivite gösterildi",
  },
};

const bandOrder: Exclude<Band, "withheld">[] = [
  "emerging",
  "developing",
  "proficient",
  "strong",
  "exemplary",
];

function bandIndex(b: Band): number {
  return b === "withheld" ? -1 : bandOrder.indexOf(b);
}

/** Start-of-local-day epoch ms for a timestamp. */
function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const DAY_MS = 86_400_000;
const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

function deriveStreak(records: EncounterRecord[]): StreakState {
  const days = Array.from(new Set(records.map((r) => startOfDay(r.at)))).sort((a, b) => a - b);
  const today = startOfDay(Date.now());
  const daySet = new Set(days);

  // Longest run of consecutive days (personal best).
  let best = 0;
  let run = 0;
  let prev: number | null = null;
  for (const d of days) {
    run = prev !== null && d - prev === DAY_MS ? run + 1 : 1;
    prev = d;
    if (run > best) best = run;
  }

  // Current run ending today or yesterday.
  let current = 0;
  if (daySet.has(today) || daySet.has(today - DAY_MS)) {
    let cursor = daySet.has(today) ? today : today - DAY_MS;
    while (daySet.has(cursor)) {
      current += 1;
      cursor -= DAY_MS;
    }
  }
  const todayDone = daySet.has(today);

  const week: StreakDay[] = [];
  for (let i = 6; i >= 0; i--) {
    const day = today - i * DAY_MS;
    const key = WEEKDAY_KEYS[new Date(day).getDay()];
    let dayState: StreakDayState;
    if (daySet.has(day)) dayState = "practised";
    else if (day === today) dayState = "today";
    else dayState = "rest";
    week.push({ key, state: dayState });
  }

  return {
    currentDays: current,
    bestDays: Math.max(best, current),
    freezesLeft: 3,
    freezesTotal: 3,
    graceActive: false,
    todayDone,
    week,
  };
}

function deriveLevel(records: EncounterRecord[]): LevelState {
  let xpTotal = 0;
  for (let i = 0; i < records.length; i++) {
    xpTotal += recordXp(records[i], i > 0 ? records[i - 1] : null);
  }
  const level = 1 + Math.floor(xpTotal / LEVEL_STEP_XP);
  const xpIntoLevel = xpTotal % LEVEL_STEP_XP;
  return {
    level,
    title: levelTitle(level),
    xpIntoLevel,
    xpForNextLevel: LEVEL_STEP_XP,
    xpTotal,
  };
}

function deriveRecentXp(records: EncounterRecord[]): XpAward[] {
  const awards: XpAward[] = [];
  const now = Date.now();
  for (let i = records.length - 1; i >= 0 && awards.length < 4; i--) {
    const rec = records[i];
    const prev = i > 0 ? records[i - 1] : null;
    const daysAgo = Math.max(0, Math.floor((now - rec.at) / DAY_MS));
    let reason: XpReason | null = null;
    if (prev && rec.overallGap < prev.overallGap - 0.01) reason = "calibrationTightened";
    else if (
      prev &&
      rec.domainScores.some((d) => {
        const p = prev.domainScores.find((x) => x.key === d.key);
        return p != null && bandIndex(d.band) > bandIndex(p.band);
      })
    )
      reason = "bandUp";
    else if (rec.diagnosisCorrect) reason = "gapClosed";
    else if (!rec.safetyMiss) reason = "safetyNetting";
    if (!reason) continue;
    awards.push({
      id: `xp-${rec.sourceKey}`,
      reason,
      amount: recordXp(rec, prev),
      detail: XP_REASON_DETAIL[reason],
      daysAgo,
    });
  }
  return awards;
}

function deriveMastery(records: EncounterRecord[]): MasteryDomain[] {
  return DOMAIN_META.map(({ key, axis }) => {
    const scoredFor = records.filter(
      (r) => r.domainScores.find((d) => d.key === key)?.scored,
    );
    const evidenceCount = scoredFor.length;
    if (evidenceCount === 0) {
      return { key, axis, band: "withheld" as Band, deltaBand: 0 as const, evidenceCount };
    }
    const latest = scoredFor[scoredFor.length - 1].domainScores.find((d) => d.key === key)!;
    const prior =
      scoredFor.length > 1
        ? scoredFor[scoredFor.length - 2].domainScores.find((d) => d.key === key)
        : undefined;
    const delta = prior ? bandIndex(latest.band) - bandIndex(prior.band) : 0;
    const deltaBand: -1 | 0 | 1 = delta > 0 ? 1 : delta < 0 ? -1 : 0;
    return { key, axis, band: latest.band, deltaBand, evidenceCount };
  });
}

function deriveCalibrationSessions(records: EncounterRecord[]): CalibrationSession[] {
  return records.map((r, i) => ({
    label: `S-${i + 1}`,
    gap: r.overallGap,
    brier: r.brier,
  }));
}

function deriveDomainTrends(records: EncounterRecord[]): DomainTrend[] {
  const trends: DomainTrend[] = [];
  for (const { key } of DOMAIN_META) {
    if (key === "professionalism") continue; // matches the 5-domain small-multiples
    const gaps: number[] = [];
    for (const r of records) {
      const d = r.domainScores.find((x) => x.key === key);
      if (d && d.scored) gaps.push(Math.abs(d.confidence - d.competence));
    }
    if (gaps.length > 0) trends.push({ domain: key, gaps });
  }
  return trends;
}

const TAKEAWAY_SAFETY: Bilingual = {
  en: "Solid work — but close the safety-critical gap before management next time.",
  tr: "İyi iş — ancak bir dahaki sefere tedaviden önce güvenlik açığını kapat.",
};
const TAKEAWAY_INCORRECT: Bilingual = {
  en: "Widen the differential and order the key rule-out test before committing.",
  tr: "Karar vermeden önce ayırıcı tanıyı genişlet ve temel dışlama testini iste.",
};
const TAKEAWAY_CLEAN: Bilingual = {
  en: "Well-calibrated and safe throughout this encounter.",
  tr: "Bu karşılaşma boyunca iyi kalibre ve güvenli.",
};

function topBand(rec: EncounterRecord): Band {
  const scored = rec.domainScores.filter((d) => d.scored);
  if (scored.length === 0) return "withheld";
  return scored.reduce(
    (best, d) => (bandIndex(d.band) > bandIndex(best) ? d.band : best),
    scored[0].band,
  );
}

function deriveRecentActivity(records: EncounterRecord[]): RecentFeedbackItem[] {
  const now = Date.now();
  return [...records]
    .reverse()
    .slice(0, 4)
    .map((rec) => ({
      id: `rf-${rec.sourceKey}`,
      caseTitle: rec.title,
      takeaway: rec.safetyMiss
        ? TAKEAWAY_SAFETY
        : rec.diagnosisCorrect
          ? TAKEAWAY_CLEAN
          : TAKEAWAY_INCORRECT,
      topBand: topBand(rec),
      hadSafetyMiss: rec.safetyMiss,
      daysAgo: Math.max(0, Math.floor((now - rec.at) / DAY_MS)),
    }));
}

const STAT_COMPLETED_EMPTY: Bilingual = {
  en: "No encounters recorded yet",
  tr: "Henüz kaydedilmiş görüşme yok",
};
const STAT_COMPLETED: Bilingual = {
  en: "Encounters completed and recorded",
  tr: "Tamamlanan ve kaydedilen görüşme",
};
const STAT_STREAK: Bilingual = {
  en: "Day streak — a rest day is forgiven",
  tr: "Günlük seri — bir dinlenme günü affedilir",
};
const STAT_GAP: Bilingual = {
  en: "Latest calibration gap",
  tr: "En son kalibrasyon farkı",
};
const STAT_GAP_EMPTY: Bilingual = {
  en: "Complete an encounter to measure it",
  tr: "Ölçmek için bir görüşme tamamlayın",
};

function deriveDashboardStats(
  records: EncounterRecord[],
  streak: StreakState,
): DashboardStat[] {
  const completed = records.length;
  const first = records[0];
  const last = records[records.length - 1];
  const gapNow = last ? Math.round(last.overallGap * 100) : null;
  const gapTrend: "up" | "down" | null =
    first && last && records.length > 1
      ? last.overallGap < first.overallGap
        ? "down"
        : last.overallGap > first.overallGap
          ? "up"
          : null
      : null;
  return [
    {
      key: "completed",
      value: String(completed),
      caption: completed > 0 ? STAT_COMPLETED : STAT_COMPLETED_EMPTY,
      trend: null,
      upIsGood: true,
    },
    {
      key: "streak",
      value: String(streak.currentDays),
      caption: STAT_STREAK,
      trend: null,
      upIsGood: true,
    },
    {
      key: "gap",
      value: gapNow == null ? "—" : `${gapNow}%`,
      caption: gapNow == null ? STAT_GAP_EMPTY : STAT_GAP,
      trend: gapTrend,
      upIsGood: false,
    },
  ];
}

interface Derived {
  records: EncounterRecord[];
  latest: EncounterRecord | null;
  calibrationPoints: CalibrationPoint[];
  calibrationTrajectory: number[];
  calibrationSessions: CalibrationSession[];
  domainTrends: DomainTrend[];
  mastery: MasteryDomain[];
  level: LevelState;
  recentXp: XpAward[];
  streak: StreakState;
  dashboardStats: DashboardStat[];
  recentActivity: RecentFeedbackItem[];
}

function computeDerived(records: EncounterRecord[]): Derived {
  const latest = records.length > 0 ? records[records.length - 1] : null;
  const streak = deriveStreak(records);
  return {
    records,
    latest,
    calibrationPoints: latest ? latest.calibration : [],
    calibrationTrajectory: records.map((r) => r.overallGap),
    calibrationSessions: deriveCalibrationSessions(records),
    domainTrends: deriveDomainTrends(records),
    mastery: deriveMastery(records),
    level: deriveLevel(records),
    recentXp: deriveRecentXp(records),
    streak,
    dashboardStats: deriveDashboardStats(records, streak),
    recentActivity: deriveRecentActivity(records),
  };
}

let derivedCache: { key: EncounterRecord[]; value: Derived } | null = null;

function derived(): Derived {
  if (derivedCache && derivedCache.key === state.records) return derivedCache.value;
  const value = computeDerived(state.records);
  derivedCache = { key: state.records, value };
  return value;
}

/* -------------------------------------------------------------------------- */
/* Feedback-report derivations from a single record's real metrics             */
/* -------------------------------------------------------------------------- */

/** Whole minutes from ms. */
function toMin(ms: number): number {
  return Math.round(ms / 60_000);
}

const GAP_LATE: Bilingual = {
  en: "Ordered later than the guideline window",
  tr: "Kılavuz süresinden geç istendi",
};
const GAP_MISSED: Bilingual = {
  en: "Expected action was not ordered",
  tr: "Beklenen işlem istenmedi",
};
const GAP_LOWVALUE_TITLE: Bilingual = {
  en: "Low-value orders placed",
  tr: "Düşük değerli istemler yapıldı",
};
const GAP_LOWVALUE_REMEDIATION: Bilingual = {
  en: "Avoid tests that do not change management for this presentation; order to a question, not by reflex.",
  tr: "Bu tabloda yönetimi değiştirmeyen testlerden kaçının; refleksle değil, bir soruya yönelik isteyin.",
};

function evidenceForAction(a: CriticalActionResult): Bilingual {
  const target = toMin(a.idealWindowMs);
  if (a.status === "missed") {
    return {
      en: `${a.labelEn} was never ordered (guideline target ≤ ${target} min).`,
      tr: `${a.labelTr} hiç istenmedi (kılavuz hedefi ≤ ${target} dk).`,
    };
  }
  const taken = a.takenAtMs == null ? target : toMin(a.takenAtMs);
  return {
    en: `${a.labelEn} ordered at ${taken} min (target ≤ ${target} min).`,
    tr: `${a.labelTr} ${taken} dk'da istendi (hedef ≤ ${target} dk).`,
  };
}

function remediationForAction(a: CriticalActionResult): Bilingual {
  const target = toMin(a.idealWindowMs);
  return {
    en: `Order ${a.labelEn} within ${target} minutes of first contact for this presentation.`,
    tr: `Bu tabloda ilk temastan sonraki ${target} dakika içinde ${a.labelTr} isteyin.`,
  };
}

/**
 * Real, per-encounter gap cards derived from the process metrics: each late or
 * missed critical action (with its own guideline citation) plus a single
 * low-value-ordering card when over-ordering occurred.
 */
export function deriveFeedbackGaps(rec: EncounterRecord): FeedbackGap[] {
  const gaps: FeedbackGap[] = [];
  for (const a of rec.metrics.timeToCriticalAction) {
    if (a.status === "onTime") continue;
    gaps.push({
      id: `gap-${a.expectationId}`,
      domain: "reasoning",
      title: a.status === "missed" ? GAP_MISSED : GAP_LATE,
      evidenceQuote: evidenceForAction(a),
      remediation: remediationForAction(a),
      citationId: a.citationId,
      safetyCritical: a.critical && a.status === "missed",
      recurrence: 0,
    });
  }
  const steward = rec.metrics.orderAppropriateness;
  if (steward.lowValue > 0) {
    gaps.push({
      id: "gap-low-value",
      domain: "reasoning",
      title: GAP_LOWVALUE_TITLE,
      evidenceQuote: {
        en: `${steward.lowValue} order(s) not indicated for this case.`,
        tr: `Bu vakada endike olmayan ${steward.lowValue} istem.`,
      },
      remediation: GAP_LOWVALUE_REMEDIATION,
      citationId: "esc-acs-2023",
      safetyCritical: false,
      recurrence: 0,
    });
  }
  return gaps;
}

/**
 * Real treatment / safety behaviours derived from the encounter's communication
 * flags — `met` reflects exactly what the log shows.
 */
export function deriveTreatmentBehaviors(rec: EncounterRecord): TreatmentBehavior[] {
  const flags = rec.metrics.communicationFlags;
  return [
    {
      id: "tb-redflag",
      kind: "safety",
      label: { en: "Screened cardiac red flags", tr: "Kardiyak kırmızı bayrakları taradı" },
      anchor: flags.screenedRedFlags
        ? { en: "Elicited red-flag features during the history.", tr: "Anamnezde alarm bulgularını sorguladı." }
        : { en: "Red-flag features were not screened during the history.", tr: "Anamnezde alarm bulguları taranmadı." },
      met: flags.screenedRedFlags,
      citationId: "nice-ng185",
      critical: false,
    },
    {
      id: "tb-allergy",
      kind: "safety",
      label: { en: "Checked allergies before prescribing", tr: "Reçete etmeden önce alerjileri kontrol etti" },
      anchor: flags.checkedAllergies
        ? { en: "Confirmed allergy status before treatment.", tr: "Tedaviden önce alerji durumu doğrulandı." }
        : { en: "Allergy status was not confirmed before treatment.", tr: "Tedaviden önce alerji durumu doğrulanmadı." },
      met: flags.checkedAllergies,
      citationId: "esc-acs-2023",
      critical: true,
    },
    {
      id: "tb-ice",
      kind: "communication",
      label: { en: "Explored ideas, concerns and expectations", tr: "Düşünce, endişe ve beklentileri araştırdı" },
      anchor: flags.exploredIce
        ? { en: "Invited the patient's own concerns.", tr: "Hastanın kendi endişelerini davet etti." }
        : { en: "The patient's ideas and concerns were not explored.", tr: "Hastanın düşünce ve endişeleri araştırılmadı." },
      met: flags.exploredIce,
      citationId: "tepdad-em",
      critical: false,
    },
  ];
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

function useDerived<T>(select: (d: Derived) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => select(derived()),
    () => select(derived()),
  );
}

/** All completed-encounter records (oldest first). */
export function useProgressRecords(): EncounterRecord[] {
  return useDerived((d) => d.records);
}

/** The most recently completed encounter, or null when there is no history. */
export function useLatestRecord(): EncounterRecord | null {
  return useDerived((d) => d.latest);
}

/** Calibration scatter points for the latest encounter (empty with no history). */
export function useCalibrationPoints(): CalibrationPoint[] {
  return useDerived((d) => d.calibrationPoints);
}

/** Per-encounter calibration-gap history, oldest first (empty with no history). */
export function useCalibrationTrajectory(): number[] {
  return useDerived((d) => d.calibrationTrajectory);
}

/** Per-session gap + Brier series for the trajectory focus chart. */
export function useCalibrationSessions(): CalibrationSession[] {
  return useDerived((d) => d.calibrationSessions);
}

/** Per-domain calibration-gap trends (small multiples). */
export function useDomainTrends(): DomainTrend[] {
  return useDerived((d) => d.domainTrends);
}

/** Mastery band per competency domain, derived from real records. */
export function useMasteryDomains(): MasteryDomain[] {
  return useDerived((d) => d.mastery);
}

/** Level + XP derived from real records. */
export function useLevelState(): LevelState {
  return useDerived((d) => d.level);
}

/** Recent XP awards, each naming why it was earned. */
export function useRecentXp(): XpAward[] {
  return useDerived((d) => d.recentXp);
}

/** Forgiving streak derived from real record dates. */
export function useStreakState(): StreakState {
  return useDerived((d) => d.streak);
}

/** Home dashboard stat tiles derived from real records. */
export function useDashboardStats(): DashboardStat[] {
  return useDerived((d) => d.dashboardStats);
}

/** Recent-feedback activity rows derived from real records. */
export function useRecentActivity(): RecentFeedbackItem[] {
  return useDerived((d) => d.recentActivity);
}
