/**
 * Progress / gamification TYPES + CATALOGS (Journey 5, docs/design/01 §5.1).
 *
 * Everything here rewards MASTERY and IMPROVEMENT, never raw volume, and is
 * private by design — there is no public leaderboard and no ranking of the
 * learner against a global population (INV-4). XP is earned for closing
 * calibration gaps and moving competency bands, not for grinding cases.
 *
 * This module now holds only shared TYPES, static CATALOGS (the EPA activity
 * list, the badge definitions) and the pure FSRS scheduler. It carries NO
 * per-learner state: EPA levels, badge earned-state, the mastery drill-down, the
 * spaced-repetition queue and the self-comparison are all DERIVED from the
 * learner's real recorded encounters in `src/state/progressStore.ts`, so a
 * brand-new learner sees honest empty / emerging states instead of demo data.
 */

import type { Bilingual, Band, FeedbackDomainKey } from "@/data/schema";

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

/**
 * Level/XP is now DERIVED from real recorded encounters — see
 * `useLevelState()` in `src/state/progressStore.ts`. A new learner starts at
 * level 1 with no XP; the type stays here for the derivation to satisfy.
 */

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

/** Recent XP awards are derived from real records — see `useRecentXp()`. */

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

/** The streak is derived from real recorded encounter dates — see `useStreakState()`. */

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

/** The mastery map is derived from real records — see `useMasteryDomains()`. */

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

/**
 * A learner's entrustment on one EPA, DERIVED from their real recorded
 * encounters (see `useEpaProgress()` in `src/state/progressStore.ts`). `level`,
 * `demonstrations` and `assessed` all come from earned evidence — a brand-new
 * learner is `assessed: false` at level 1 with zero demonstrations, never a
 * fabricated "entrusted" level.
 */
export interface EpaProgress {
  id: string;
  /** Short EPA code shown as a mono chip, e.g. "EPA 10". */
  code: string;
  title: Bilingual;
  level: EntrustmentLevel;
  /** Reps of demonstrated behaviour behind the current level (real count). */
  demonstrations: number;
  citationId: string;
  /** False until at least one graded encounter maps to this EPA. */
  assessed: boolean;
}

/**
 * The EPA CATALOG — labels, definitions and the competency domains whose real
 * evidence entrusts each activity. This is a static reference (the AAMC/TEPDAD
 * activity list), NOT per-learner state: entrustment levels are computed from
 * the learner's own EncounterRecords. An empty `domains` list marks an activity
 * the encounter has no instrument for yet (e.g. oral presentation, teamwork) —
 * it stays honestly "not yet assessed" rather than showing an invented level.
 */
export interface EpaCatalogEntry {
  id: string;
  /** Short EPA code shown as a mono chip, e.g. "EPA 10". */
  code: string;
  title: Bilingual;
  citationId: string;
  /** Competency domains whose real evidence entrusts this EPA (empty = not yet derivable). */
  domains: FeedbackDomainKey[];
}

export const epaCatalog: EpaCatalogEntry[] = [
  {
    id: "epa-10",
    code: "EPA 10",
    title: {
      en: "Recognise and initiate management of the deteriorating patient",
      tr: "Kötüleşen hastayı tanıma ve yönetimini başlatma",
    },
    citationId: "tepdad-em",
    domains: ["reasoning", "management"],
  },
  {
    id: "epa-3",
    code: "EPA 3",
    title: {
      en: "Recommend and interpret common diagnostic tests",
      tr: "Sık kullanılan tanısal testleri önerme ve yorumlama",
    },
    citationId: "gs_nice_ng185_nstemi_assessment",
    domains: ["reasoning", "exam"],
  },
  {
    id: "epa-6",
    code: "EPA 6",
    title: {
      en: "Provide an oral presentation of a clinical encounter",
      tr: "Klinik karşılaşmanın sözlü sunumunu yapma",
    },
    citationId: "tepdad-em",
    // No oral-presentation instrument in the encounter — stays not-yet-assessed.
    domains: [],
  },
  {
    id: "epa-9",
    code: "EPA 9",
    title: {
      en: "Collaborate as a member of an interprofessional team",
      tr: "Meslekler arası ekibin bir üyesi olarak iş birliği yapma",
    },
    citationId: "tepdad-em",
    // No interprofessional-teamwork instrument yet — stays not-yet-assessed.
    domains: [],
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

/**
 * A badge as shown to the learner. `earned` and `progress` are DERIVED from real
 * recorded encounters (see `useBadges()` in `src/state/progressStore.ts`) — none
 * are earned at zero history. The catalog below carries only the identity-forward
 * copy; the store decides whether the threshold has actually been met.
 */
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

export type BadgeId =
  | "badge-deterioration"
  | "badge-difficult-conversation"
  | "badge-safety-netting"
  | "badge-calibrated"
  | "badge-handover";

/**
 * A badge DEFINITION — the copy plus the earning rule. `threshold` is the number
 * of qualifying encounters needed to earn it (and drives the progress bar);
 * `threshold: null` marks a badge the encounter has no instrument for yet, so it
 * can never be falsely awarded and always reads "not yet available". The concrete
 * qualifying predicate lives in the store, keyed by `id`, because it needs real
 * EncounterRecords.
 */
export interface BadgeDef {
  id: BadgeId;
  icon: BadgeIcon;
  title: Bilingual;
  description: Bilingual;
  nextStep: Bilingual;
  threshold: number | null;
}

export const badgeCatalog: BadgeDef[] = [
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
    nextStep: {
      en: "Finish encounters with strong, on-time management and no safety-critical miss to earn this.",
      tr: "Bunu kazanmak için güçlü, zamanında yönetim ve güvenlik açısından kritik eksik olmadan karşılaşmaları tamamlayın.",
    },
    threshold: 3,
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
    nextStep: {
      en: "Reach a strong communication band by exploring concerns and screening red flags in your encounters.",
      tr: "Karşılaşmalarınızda endişeleri araştırıp alarm bulgularını tarayarak güçlü bir iletişim bandına ulaşın.",
    },
    threshold: 3,
  },
  {
    id: "badge-safety-netting",
    icon: "shieldCheck",
    title: {
      en: "Safety-netted every discharge",
      tr: "Her taburcuda güvenlik ağı kurdu",
    },
    description: {
      en: "Closed five consecutive encounters with no safety-critical miss.",
      tr: "Güvenlik açısından kritik bir eksik olmadan üst üste beş karşılaşmayı tamamladı.",
    },
    nextStep: {
      en: "String together five encounters in a row with no safety-critical miss.",
      tr: "Güvenlik açısından kritik eksik olmadan üst üste beş karşılaşma tamamlayın.",
    },
    threshold: 5,
  },
  {
    id: "badge-calibrated",
    icon: "target",
    title: {
      en: "Calibrated reasoning",
      tr: "Kalibre klinik akıl yürütme",
    },
    description: {
      en: "Kept your confidence within one band of your measured reasoning across three encounters.",
      tr: "Üç karşılaşma boyunca güveninizi ölçülen akıl yürütmenizin bir bandı içinde tuttunuz.",
    },
    nextStep: {
      en: "Keep your reasoning calibration gap tight (under ~12%) across three encounters.",
      tr: "Üç karşılaşma boyunca akıl yürütme kalibrasyon farkınızı dar (%12 altında) tutun.",
    },
    threshold: 3,
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
    nextStep: {
      en: "Structured handover is not yet measured in the encounter — this badge unlocks when it is.",
      tr: "Yapılandırılmış devir teslim henüz karşılaşmada ölçülmüyor — bu rozet ölçüldüğünde açılacak.",
    },
    // No handover instrument yet — never falsely awarded.
    threshold: null,
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
 * The per-session gap + Brier series is derived from real recorded encounters —
 * see `useCalibrationSessions()`. Empty until the first encounter is completed.
 */

/** Per-domain calibration gap trend (each a small-multiple sparkline). */
export interface DomainTrend {
  domain: FeedbackDomainKey;
  /** Calibration gap per session, oldest first. Lower is better. */
  gaps: number[];
}

/** Per-domain gap trends are derived from real records — see `useDomainTrends()`. */

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
 * There is NO static seed queue. The live review queue is DERIVED from the
 * learner's real encounter gaps (`deriveFeedbackGaps` over their
 * EncounterRecords) with a persisted FSRS schedule — see `useReviewQueue()`,
 * `enqueueReview()` and `gradeReview()` in `src/state/progressStore.ts`. A
 * brand-new learner with no history has an empty queue.
 */

/* -------------------------------------------------------------------------- */
/* Self-comparison — your own trend, never a cohort/percentile fabrication     */
/* -------------------------------------------------------------------------- */

/**
 * A private, self-referential comparison: the learner measured only against
 * their OWN earlier performance (calibration-gap reduction across their
 * sessions). A real de-identified COHORT comparison would need a backend that
 * does not exist in this air-gapped build, so no cohort median, size or
 * percentile is ever fabricated — see `useSelfComparison()` in
 * `src/state/progressStore.ts`. Empty (`hasBaseline: false`) until there are at
 * least two recorded sessions to compare.
 */
export interface SelfComparison {
  /** True once there are ≥2 sessions to compare against a baseline. */
  hasBaseline: boolean;
  /** Number of recorded sessions behind the comparison. */
  sessionCount: number;
  /** Calibration gap at the first tracked session, in percentage points (0-100). */
  baselineGapPct: number;
  /** Calibration gap at the latest session, in percentage points (0-100). */
  latestGapPct: number;
  /** Improvement = baseline − latest, in percentage points (positive = tighter). */
  improvementPct: number;
}

/* -------------------------------------------------------------------------- */
/* Mastery detail — evidence + trajectory behind each band (progressive reveal) */
/* -------------------------------------------------------------------------- */

/** One graded encounter that counts as evidence behind a domain's band. */
export interface MasteryEvidence {
  id: string;
  /** Short encounter title. */
  case: Bilingual;
  /** What was demonstrated (or missed), in plain language. */
  note: Bilingual;
  daysAgo: number;
}

/**
 * The detail behind a mastery band, revealed when a learner opens a domain.
 * Everything is formative and specific: what moved the band, the concrete
 * criterion for the next band, the recent band trajectory, and the encounters
 * that count as evidence. A domain may link a spaced-review card so the learner
 * can practise the exact gap.
 */
export interface MasteryDetail {
  /** What moved this band recently. */
  movedBy: Bilingual;
  /** The concrete behaviour that reaches the next band. */
  nextStep: Bilingual;
  /** Recent band per graded window, oldest first (mini trajectory). */
  bandHistory: Exclude<Band, "withheld">[];
  /** Encounters behind the current band. */
  evidence: MasteryEvidence[];
  /** Optional linked spaced-review card to practise the gap. */
  reviewCardId?: string;
}

/**
 * The detail behind a mastery band is DERIVED per domain from the learner's
 * real recorded encounters — see `useMasteryDetail()` in
 * `src/state/progressStore.ts`. Every evidence row keys to an encounter the
 * learner actually did (no invented cases), and a domain with no evidence shows
 * an honest empty state. Only the TYPE remains here.
 */

/* -------------------------------------------------------------------------- */
/* Spaced-repetition scheduler — a compact, faithful FSRS forgetting model     */
/* -------------------------------------------------------------------------- */

/**
 * The four FSRS recall grades. They describe *how retrieval felt*, not a score:
 *   again — you blanked, hard — effortful, good — recalled, easy — instant.
 */
export type ReviewGrade = "again" | "hard" | "good" | "easy";

/** Grade order for the review UI (worst to best), left to right. */
export const REVIEW_GRADE_ORDER: ReviewGrade[] = [
  "again",
  "hard",
  "good",
  "easy",
];

/**
 * FSRS-4.5 forgetting-curve constants. Retrievability decays as a power law of
 * elapsed time over stability: R(t, S) = (1 + FACTOR * t / S) ^ DECAY.
 * With DECAY = -0.5, an interval equal to S yields exactly 90% retrievability.
 */
const FSRS_DECAY = -0.5;
const FSRS_FACTOR = 19 / 81; // = 0.9^(1 / DECAY) - 1
/** Target retention when scheduling the next review. */
export const FSRS_TARGET_RETENTION = 0.9;

/** Predicted retrievability after `days` given memory `stabilityDays`. */
export function retrievabilityAfter(
  days: number,
  stabilityDays: number,
): number {
  const s = Math.max(stabilityDays, 0.1);
  return Math.pow(1 + FSRS_FACTOR * (days / s), FSRS_DECAY);
}

/**
 * Days for retrievability to fall to `retention` given `stabilityDays`.
 * This is the next-review interval FSRS would pick for a target retention.
 */
export function forgettingInterval(
  stabilityDays: number,
  retention: number = FSRS_TARGET_RETENTION,
): number {
  const s = Math.max(stabilityDays, 0.1);
  return (s / FSRS_FACTOR) * (Math.pow(retention, 1 / FSRS_DECAY) - 1);
}

/** Stability multiplier per grade for a successful review. */
const STABILITY_GAIN: Record<Exclude<ReviewGrade, "again">, number> = {
  hard: 1.2,
  good: 1.9,
  easy: 2.8,
};

/** The result of grading a card: the card's next scheduling state. */
export interface ReviewSchedule {
  /** New memory stability, in days. */
  stabilityDays: number;
  /** Days until the next review (0 means later in this same session). */
  intervalDays: number;
  /** Predicted retrievability at the moment shown. */
  retrievability: number;
  state: ReviewState;
}

/**
 * scheduleReview — grade a card and compute its next FSRS schedule.
 *
 * A lapse (`again`) collapses stability toward a short relearning value and
 * returns the card later in the same session. A successful grade grows
 * stability with diminishing returns, so already-durable memories are not
 * pushed out to unrealistic intervals. Deterministic and pure.
 */
export function scheduleReview(
  card: Pick<ReviewCard, "stabilityDays">,
  grade: ReviewGrade,
): ReviewSchedule {
  const prior = Math.max(card.stabilityDays, 0.5);

  if (grade === "again") {
    const stability = Math.round(Math.max(0.5, prior * 0.4) * 10) / 10;
    return {
      stabilityDays: stability,
      intervalDays: 0,
      retrievability: 0.45,
      state: "learning",
    };
  }

  // Diminishing returns: the gain shrinks as the memory is already durable.
  const saturation = 0.6 + 0.4 / (1 + prior / 10);
  const stability =
    Math.round(prior * STABILITY_GAIN[grade] * saturation * 10) / 10;
  const intervalDays = Math.max(1, Math.round(forgettingInterval(stability)));

  return {
    stabilityDays: stability,
    intervalDays,
    retrievability: 0.98,
    state: intervalDays >= 14 ? "scheduled" : "learning",
  };
}
