/**
 * Progress / gamification mock data (Journey 5, docs/design/01 §5.1).
 *
 * Everything here rewards MASTERY and IMPROVEMENT, never raw volume, and is
 * private by design — there is no public leaderboard and no ranking of the
 * learner against a global population (INV-4). XP is earned for closing
 * calibration gaps and moving competency bands, not for grinding cases.
 *
 * Content is realistic emergency-medicine training data: real competency
 * domains, real Turkish medical education milestones (TEPDAD/AAMC-EPA), and
 * a spaced-repetition queue seeded from actual gaps, each cited to a guideline.
 */

import type { Bilingual, Band, FeedbackDomainKey } from "@/data/mock";

/* -------------------------------------------------------------------------- */
/* Level & XP — tied to mastery / calibration, not volume                     */
/* -------------------------------------------------------------------------- */

export interface LevelState {
  /** Current level index (1-based). */
  level: number;
  /** Restrained, identity-forward title for this level. */
  title: Bilingual;
  /** XP accumulated within the current level. */
  xpIntoLevel: number;
  /** XP needed to reach the next level. */
  xpForNextLevel: number;
  /** Total lifetime XP (shown small, never as a rank). */
  xpTotal: number;
}

export const levelState: LevelState = {
  level: 6,
  title: {
    en: "Calibrating clinician",
    tr: "Kalibrasyonunu geliştiren hekim",
  },
  xpIntoLevel: 340,
  xpForNextLevel: 500,
  xpTotal: 3140,
};

/**
 * Recent XP awards — each names *why* it was earned so XP reads as competence
 * gain, not a score. Only mastery/calibration/gap-closing events award XP.
 */
export type XpReason =
  | "calibrationTightened"
  | "gapClosed"
  | "bandUp"
  | "epaEntrusted"
  | "safetyNetting";

export interface XpAward {
  id: string;
  reason: XpReason;
  amount: number;
  /** Domain or EPA this award relates to, for the plain-language line. */
  detail: Bilingual;
  daysAgo: number;
}

export const recentXp: XpAward[] = [
  {
    id: "xp-1",
    reason: "calibrationTightened",
    amount: 60,
    detail: {
      en: "Reasoning: confidence-performance gap narrowed to 17%",
      tr: "Klinik akıl yürütme: güven-performans farkı %17'ye geriledi",
    },
    daysAgo: 0,
  },
  {
    id: "xp-2",
    reason: "gapClosed",
    amount: 45,
    detail: {
      en: "Ordered a 12-lead ECG before management in 3 encounters running",
      tr: "Üst üste 3 vakada tedaviden önce 12 derivasyonlu EKG istendi",
    },
    daysAgo: 2,
  },
  {
    id: "xp-3",
    reason: "bandUp",
    amount: 80,
    detail: {
      en: "History-taking moved from Proficient to Strong",
      tr: "Anamnez alma Yeterli'den Güçlü'ye yükseldi",
    },
    daysAgo: 5,
  },
];

/* -------------------------------------------------------------------------- */
/* Forgiving streak — freeze / grace days, built for a high-burnout cohort    */
/* -------------------------------------------------------------------------- */

export interface StreakState {
  /** Current consecutive-day streak. */
  currentDays: number;
  /** Longest streak reached (personal best, never compared to peers). */
  bestDays: number;
  /** Freeze tokens remaining — a rough week never breaks the streak. */
  freezesLeft: number;
  /** Freeze tokens granted per period. */
  freezesTotal: number;
  /**
   * A grace day is currently active (yesterday was missed but automatically
   * covered). Shown supportively, never as a failure.
   */
  graceActive: boolean;
  /** Whether today's single rep is already done. */
  todayDone: boolean;
  /**
   * Last 7 days, oldest first. Each day is one of: practised, rest (planned),
   * freeze (auto-covered), or missed (only if freezes exhausted).
   */
  week: StreakDay[];
}

export type StreakDayState = "practised" | "rest" | "freeze" | "today" | "upcoming";

export interface StreakDay {
  /** Weekday label key suffix, e.g. "mon". */
  key: string;
  state: StreakDayState;
}

export const streakState: StreakState = {
  currentDays: 9,
  bestDays: 14,
  freezesLeft: 2,
  freezesTotal: 3,
  graceActive: true,
  todayDone: false,
  week: [
    { key: "mon", state: "practised" },
    { key: "tue", state: "practised" },
    { key: "wed", state: "freeze" },
    { key: "thu", state: "practised" },
    { key: "fri", state: "practised" },
    { key: "sat", state: "practised" },
    { key: "sun", state: "today" },
  ],
};

/* -------------------------------------------------------------------------- */
/* Mastery map — 6 competency domains x banded level, with per-domain trend   */
/* -------------------------------------------------------------------------- */

/** The five ordered mastery bands (mirrors DomainBand BAND_SCALE). */
export const MASTERY_BANDS: Exclude<Band, "withheld">[] = [
  "emerging",
  "developing",
  "proficient",
  "strong",
  "exemplary",
];

export interface MasteryDomain {
  key: FeedbackDomainKey;
  axis: "clinical" | "communication";
  /** Current band, or "withheld" when reliability is below threshold. */
  band: Band;
  /** Band delta vs last week: +1 up a band, -1 down, 0 steady. */
  deltaBand: -1 | 0 | 1;
  /** Number of graded encounters behind this band (drives reliability copy). */
  evidenceCount: number;
}

export const masteryDomains: MasteryDomain[] = [
  {
    key: "history",
    axis: "clinical",
    band: "strong",
    deltaBand: 1,
    evidenceCount: 12,
  },
  {
    key: "exam",
    axis: "clinical",
    band: "proficient",
    deltaBand: 0,
    evidenceCount: 9,
  },
  {
    key: "reasoning",
    axis: "clinical",
    band: "developing",
    deltaBand: 1,
    evidenceCount: 11,
  },
  {
    key: "communication",
    axis: "communication",
    band: "strong",
    deltaBand: 0,
    evidenceCount: 10,
  },
  {
    key: "management",
    axis: "clinical",
    band: "developing",
    deltaBand: 0,
    evidenceCount: 8,
  },
  {
    key: "professionalism",
    axis: "communication",
    // Below the reliability threshold — surfaced as "not enough data yet".
    band: "withheld",
    deltaBand: 0,
    evidenceCount: 3,
  },
];

/* -------------------------------------------------------------------------- */
/* EPAs — entrustable professional activities, entrustment level, not scored  */
/* -------------------------------------------------------------------------- */

/**
 * Entrustment scale (Chen / AAMC Core EPAs), abbreviated:
 *   1 observe, 2 direct supervision, 3 indirect supervision,
 *   4 distant supervision (entrusted), 5 supervise others.
 * We surface "entrusted" at level >= 4. This is formative and private.
 */
export type EntrustmentLevel = 1 | 2 | 3 | 4 | 5;

export interface EpaProgress {
  id: string;
  /** Short EPA code shown as a mono chip, e.g. "EPA 10". */
  code: string;
  title: Bilingual;
  level: EntrustmentLevel;
  /** Reps of demonstrated behaviour behind the current level. */
  demonstrations: number;
  citationId: string;
}

export const epaProgress: EpaProgress[] = [
  {
    id: "epa-10",
    code: "EPA 10",
    title: {
      en: "Recognise and initiate management of the deteriorating patient",
      tr: "Kötüleşen hastayı tanıma ve yönetimini başlatma",
    },
    level: 4,
    demonstrations: 5,
    citationId: "tepdad-em",
  },
  {
    id: "epa-3",
    code: "EPA 3",
    title: {
      en: "Recommend and interpret common diagnostic tests",
      tr: "Sık kullanılan tanısal testleri önerme ve yorumlama",
    },
    level: 3,
    demonstrations: 8,
    citationId: "esc-acs-2023",
  },
  {
    id: "epa-6",
    code: "EPA 6",
    title: {
      en: "Provide an oral presentation of a clinical encounter",
      tr: "Klinik karşılaşmanın sözlü sunumunu yapma",
    },
    level: 4,
    demonstrations: 6,
    citationId: "tepdad-em",
  },
  {
    id: "epa-9",
    code: "EPA 9",
    title: {
      en: "Collaborate as a member of an interprofessional team",
      tr: "Meslekler arası ekibin bir üyesi olarak iş birliği yapma",
    },
    level: 3,
    demonstrations: 4,
    citationId: "tepdad-em",
  },
];

/* -------------------------------------------------------------------------- */
/* Badges — competency + EPA-entrusted milestones, identity-reinforcing       */
/* -------------------------------------------------------------------------- */

export type BadgeIcon =
  | "heartbeat"
  | "chatCentered"
  | "shieldCheck"
  | "target"
  | "handshake"
  | "eye";

export interface Badge {
  id: string;
  icon: BadgeIcon;
  title: Bilingual;
  /** What earned it, in plain, identity-forward language. */
  description: Bilingual;
  earned: boolean;
  /** For unearned badges: how far along, 0-1. */
  progress?: number;
  /** For unearned badges: the concrete next step to earn it. */
  nextStep?: Bilingual;
}

export const badges: Badge[] = [
  {
    id: "badge-deterioration",
    icon: "heartbeat",
    title: {
      en: "Caught deterioration early",
      tr: "Kötüleşmeyi erken yakaladı",
    },
    description: {
      en: "Recognised a deteriorating patient and escalated in time, three times over.",
      tr: "Kötüleşen hastayı üç kez zamanında tanıyıp yükseltti.",
    },
    earned: true,
  },
  {
    id: "badge-difficult-conversation",
    icon: "chatCentered",
    title: {
      en: "Held a difficult conversation",
      tr: "Zor bir görüşmeyi yürüttü",
    },
    description: {
      en: "Stayed calm and clear with an anxious, distressed patient without losing the clinical thread.",
      tr: "Endişeli ve sıkıntılı bir hastayla klinik akışı kaybetmeden sakin ve net kaldı.",
    },
    earned: true,
  },
  {
    id: "badge-safety-netting",
    icon: "shieldCheck",
    title: {
      en: "Safety-netted every discharge",
      tr: "Her taburcuda güvenlik ağı kurdu",
    },
    description: {
      en: "Gave clear return-warning advice on five consecutive discharges.",
      tr: "Üst üste beş taburcuda net geri dönüş uyarı önerisi verdi.",
    },
    earned: true,
  },
  {
    id: "badge-calibrated",
    icon: "target",
    title: {
      en: "Calibrated reasoning",
      tr: "Kalibre klinik akıl yürütme",
    },
    description: {
      en: "Kept your confidence within one band of your measured reasoning for a full week.",
      tr: "Bir hafta boyunca güveninizi ölçülen akıl yürütmenizin bir bandı içinde tuttunuz.",
    },
    earned: false,
    progress: 0.6,
    nextStep: {
      en: "Two more well-calibrated reasoning encounters to unlock this.",
      tr: "Bunu açmak için iki iyi kalibre edilmiş akıl yürütme karşılaşması daha.",
    },
  },
  {
    id: "badge-handover",
    icon: "handshake",
    title: {
      en: "Clean handover",
      tr: "Temiz devir teslim",
    },
    description: {
      en: "Delivered a complete, structured handover under time pressure.",
      tr: "Zaman baskısı altında eksiksiz, yapılandırılmış bir devir teslim yaptı.",
    },
    earned: false,
    progress: 0.3,
    nextStep: {
      en: "Complete a team room encounter as the leader to make progress.",
      tr: "İlerlemek için ekip odası karşılaşmasını lider olarak tamamlayın.",
    },
  },
];

/* -------------------------------------------------------------------------- */
/* Calibration trajectory — OCI / Brier shrinking over sessions               */
/* -------------------------------------------------------------------------- */

export interface CalibrationSession {
  /** Session label, e.g. "S-12" or a short date. */
  label: string;
  /** Overconfidence index (self-confidence minus competence), 0-1. Lower is better. */
  gap: number;
  /** Brier score for that session, 0-1. Lower is better. */
  brier: number;
}

/**
 * Eight recent sessions. Both the gap and the Brier score trend downward,
 * which is the core private "dopamine" of the screen (docs §5.1).
 */
export const calibrationSessions: CalibrationSession[] = [
  { label: "S-1", gap: 0.34, brier: 0.29 },
  { label: "S-2", gap: 0.31, brier: 0.27 },
  { label: "S-3", gap: 0.29, brier: 0.26 },
  { label: "S-4", gap: 0.26, brier: 0.24 },
  { label: "S-5", gap: 0.24, brier: 0.22 },
  { label: "S-6", gap: 0.22, brier: 0.21 },
  { label: "S-7", gap: 0.19, brier: 0.19 },
  { label: "S-8", gap: 0.17, brier: 0.18 },
];

/** Per-domain calibration gap trend (each a small-multiple sparkline). */
export interface DomainTrend {
  domain: FeedbackDomainKey;
  /** Calibration gap per session, oldest first. Lower is better. */
  gaps: number[];
}

export const domainTrends: DomainTrend[] = [
  { domain: "history", gaps: [0.22, 0.2, 0.17, 0.14, 0.11] },
  { domain: "exam", gaps: [0.19, 0.2, 0.18, 0.17, 0.16] },
  { domain: "reasoning", gaps: [0.34, 0.31, 0.27, 0.23, 0.19] },
  { domain: "communication", gaps: [0.16, 0.14, 0.13, 0.12, 0.1] },
  { domain: "management", gaps: [0.3, 0.29, 0.27, 0.26, 0.24] },
];

/* -------------------------------------------------------------------------- */
/* Spaced-repetition queue — FSRS-style due cards from past gaps, each cited   */
/* -------------------------------------------------------------------------- */

export type ReviewState = "due" | "learning" | "scheduled";

export interface ReviewCard {
  id: string;
  /** Domain this gap sits in. */
  domain: FeedbackDomainKey;
  /** The knowledge gap, phrased as a retrieval prompt. */
  prompt: Bilingual;
  /** FSRS retrievability at review time, 0-1 (drives the "recall" hint). */
  retrievability: number;
  /** FSRS stability in days (how durable the memory currently is). */
  stabilityDays: number;
  /** Days until (or since, if negative/0) due. */
  dueInDays: number;
  state: ReviewState;
  citationId: string;
}

/**
 * The queue is seeded from real encounter gaps (e.g. the NSTEMI ECG-timing
 * miss). Cards surface oldest-weakest first; each carries its guideline
 * citation so a review is always traceable back to the source of truth.
 */
export const reviewQueue: ReviewCard[] = [
  {
    id: "rev-ecg-timing",
    domain: "reasoning",
    prompt: {
      en: "In suspected ACS, what is the target time to a 12-lead ECG from first medical contact?",
      tr: "AKS şüphesinde, ilk tıbbi temastan 12 derivasyonlu EKG'ye kadarki hedef süre nedir?",
    },
    retrievability: 0.62,
    stabilityDays: 4,
    dueInDays: 0,
    state: "due",
    citationId: "esc-acs-2023",
  },
  {
    id: "rev-troponin",
    domain: "exam",
    prompt: {
      en: "Which high-sensitivity troponin protocol rules in or out MI, and at what intervals?",
      tr: "Hangi yüksek duyarlıklı troponin protokolü MI'yı dışlar veya doğrular ve hangi aralıklarla?",
    },
    retrievability: 0.55,
    stabilityDays: 6,
    dueInDays: 0,
    state: "due",
    citationId: "esc-acs-2023",
  },
  {
    id: "rev-risk-factors",
    domain: "history",
    prompt: {
      en: "Which cardiac risk factors should be screened during the initial history for chest pain?",
      tr: "Göğüs ağrısı için ilk anamnez sırasında hangi kardiyak risk faktörleri taranmalı?",
    },
    retrievability: 0.78,
    stabilityDays: 9,
    dueInDays: 1,
    state: "learning",
    citationId: "nice-ng185",
  },
  {
    id: "rev-safety-netting",
    domain: "communication",
    prompt: {
      en: "What return-warning advice must a low-risk chest-pain discharge include?",
      tr: "Düşük riskli göğüs ağrısı taburcusu hangi geri dönüş uyarı önerilerini içermeli?",
    },
    retrievability: 0.71,
    stabilityDays: 12,
    dueInDays: 3,
    state: "scheduled",
    citationId: "nice-ng185",
  },
];

/** Count of cards due now, for the queue header. */
export const dueNowCount = reviewQueue.filter((c) => c.state === "due").length;

/* -------------------------------------------------------------------------- */
/* Cohort comparison — opt-in, ranked ONLY on personal improvement            */
/* -------------------------------------------------------------------------- */

/**
 * An explicitly opt-in, cohort-only view. It is NOT a global leaderboard and
 * never ranks raw competence: the only quantity shown is *your own*
 * improvement (calibration-gap reduction) placed against an anonymised,
 * de-identified cohort band. No names, no global ranks, no peer ego-data.
 */
export interface CohortComparison {
  /** Whether the learner has opted in (default off). */
  optedIn: boolean;
  /** Your calibration-gap improvement this month, in percentage points. */
  yourImprovementPct: number;
  /** Cohort median improvement, for a private, formative reference band. */
  cohortMedianImprovementPct: number;
  /** Anonymised cohort size (de-identified aggregate). */
  cohortSize: number;
  /** Your improvement percentile within the cohort (improvement only). */
  improvementPercentile: number;
}

export const cohortComparison: CohortComparison = {
  optedIn: false,
  yourImprovementPct: 11,
  cohortMedianImprovementPct: 6,
  cohortSize: 48,
  improvementPercentile: 72,
};
