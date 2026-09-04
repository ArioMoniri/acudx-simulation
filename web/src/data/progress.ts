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
 * Detail keyed by competency domain. Content is realistic emergency-medicine
 * evidence. The withheld domain (professionalism) carries only a next-step so
 * the learner knows exactly what unlocks a reliable band.
 */
export const masteryDetail: Partial<Record<FeedbackDomainKey, MasteryDetail>> = {
  history: {
    movedBy: {
      en: "Your histories now open with a structured presenting-complaint frame and screen red flags before you close.",
      tr: "Anamnezleriniz artık yapılandırılmış bir yakınma çerçevesiyle başlıyor ve kapatmadan önce alarm bulgularını tarıyor.",
    },
    nextStep: {
      en: "Reach Exemplary by eliciting ideas, concerns and expectations in every encounter, not only when prompted.",
      tr: "Örnek düzeye ulaşmak için hastanın düşünce, endişe ve beklentilerini yalnızca sorulduğunda değil her karşılaşmada öğrenin.",
    },
    bandHistory: ["proficient", "proficient", "strong"],
    evidence: [
      {
        id: "ev-h1",
        case: {
          en: "58-year-old with central chest pain",
          tr: "Santral göğüs ağrısı olan 58 yaşında hasta",
        },
        note: {
          en: "Screened cardiac risk factors and red flags before examining.",
          tr: "Muayeneden önce kardiyak risk faktörleri ve alarm bulguları tarandı.",
        },
        daysAgo: 1,
      },
      {
        id: "ev-h2",
        case: {
          en: "Young adult with palpitations",
          tr: "Çarpıntı ile başvuran genç erişkin",
        },
        note: {
          en: "Built a structured history with a clear symptom timeline.",
          tr: "Net bir semptom zaman çizelgesiyle yapılandırılmış öykü alındı.",
        },
        daysAgo: 4,
      },
    ],
    reviewCardId: "rev-risk-factors",
  },
  exam: {
    movedBy: {
      en: "Hypothesis-driven examination is consistent; a full secondary survey is still sometimes skipped under time pressure.",
      tr: "Hipoteze dayalı muayene tutarlı; zaman baskısı altında tam ikincil bakı hâlâ zaman zaman atlanıyor.",
    },
    nextStep: {
      en: "Reach Strong by completing a focused secondary survey on every high-acuity presentation.",
      tr: "Güçlü düzeye ulaşmak için her yüksek aciliyetli başvuruda odaklı bir ikincil bakı tamamlayın.",
    },
    bandHistory: ["developing", "proficient", "proficient"],
    evidence: [
      {
        id: "ev-e1",
        case: {
          en: "Breathlessness in an older patient",
          tr: "Yaşlı hastada nefes darlığı",
        },
        note: {
          en: "Focused cardiorespiratory examination guided by the differential.",
          tr: "Ayırıcı tanıya göre yönlendirilmiş odaklı kardiyorespiratuvar muayene.",
        },
        daysAgo: 2,
      },
      {
        id: "ev-e2",
        case: {
          en: "Abdominal pain, query surgical",
          tr: "Karın ağrısı, cerrahi şüphesi",
        },
        note: {
          en: "Elicited peritonism but deferred a full secondary survey.",
          tr: "Peritonizm saptandı ancak tam ikincil bakı ertelendi.",
        },
        daysAgo: 6,
      },
    ],
    reviewCardId: "rev-troponin",
  },
  reasoning: {
    movedBy: {
      en: "You now commit to a leading diagnosis with a stated differential instead of an open-ended list.",
      tr: "Artık açık uçlu bir liste yerine belirtilen bir ayırıcı tanıyla öncelikli tanıya karar veriyorsunuz.",
    },
    nextStep: {
      en: "Reach Proficient by ordering the key rule-out test before starting empirical management.",
      tr: "Yeterli düzeye ulaşmak için ampirik tedaviye başlamadan önce temel dışlama testini isteyin.",
    },
    bandHistory: ["emerging", "emerging", "developing"],
    evidence: [
      {
        id: "ev-r1",
        case: {
          en: "Suspected acute coronary syndrome",
          tr: "Akut koroner sendrom şüphesi",
        },
        note: {
          en: "Committed to a leading diagnosis with a clear differential.",
          tr: "Net bir ayırıcı tanıyla öncelikli tanıya karar verildi.",
        },
        daysAgo: 0,
      },
      {
        id: "ev-r2",
        case: {
          en: "Headache with red flags",
          tr: "Alarm bulgulu baş ağrısı",
        },
        note: {
          en: "Ordered the key rule-out test late in the encounter.",
          tr: "Temel dışlama testi karşılaşmanın geç aşamasında istendi.",
        },
        daysAgo: 3,
      },
    ],
    reviewCardId: "rev-ecg-timing",
  },
  communication: {
    movedBy: {
      en: "Clear, jargon-free explanations and consistent safety-netting on discharge.",
      tr: "Net, tıbbi jargon içermeyen açıklamalar ve taburculukta tutarlı güvenlik ağı.",
    },
    nextStep: {
      en: "Reach Exemplary by checking understanding with teach-back on every discharge.",
      tr: "Örnek düzeye ulaşmak için her taburculukta geri anlatma yöntemiyle hastanın anlayışını doğrulayın.",
    },
    bandHistory: ["strong", "strong", "strong"],
    evidence: [
      {
        id: "ev-c1",
        case: {
          en: "Discharge after low-risk chest pain",
          tr: "Düşük riskli göğüs ağrısı sonrası taburculuk",
        },
        note: {
          en: "Gave clear, specific return-warning advice.",
          tr: "Net ve belirgin geri dönüş uyarı önerileri verildi.",
        },
        daysAgo: 1,
      },
      {
        id: "ev-c2",
        case: {
          en: "Anxious patient, uncertain diagnosis",
          tr: "Endişeli hasta, belirsiz tanı",
        },
        note: {
          en: "Explained the uncertainty without alarming the patient.",
          tr: "Hastayı tedirgin etmeden belirsizlik açıklandı.",
        },
        daysAgo: 5,
      },
    ],
    reviewCardId: "rev-safety-netting",
  },
  management: {
    movedBy: {
      en: "Initial management is appropriate, but escalation and senior review are sometimes late.",
      tr: "İlk tedavi uygun ancak yükseltme ve kıdemli değerlendirmesi zaman zaman geç kalıyor.",
    },
    nextStep: {
      en: "Reach Proficient by stating explicit escalation criteria and a time-to-review for unstable patients.",
      tr: "Yeterli düzeye ulaşmak için stabil olmayan hastalar için açık yükseltme ölçütleri ve bir yeniden değerlendirme süresi belirtin.",
    },
    bandHistory: ["developing", "developing", "developing"],
    evidence: [
      {
        id: "ev-m1",
        case: {
          en: "Sepsis of unclear source",
          tr: "Kaynağı belirsiz sepsis",
        },
        note: {
          en: "Started the sepsis bundle but escalated to seniors late.",
          tr: "Sepsis paketi başlatıldı ancak kıdemlilere yükseltme geç yapıldı.",
        },
        daysAgo: 2,
      },
      {
        id: "ev-m2",
        case: {
          en: "Acute asthma exacerbation",
          tr: "Akut astım alevlenmesi",
        },
        note: {
          en: "Appropriate first-line treatment with timely reassessment.",
          tr: "Zamanında yeniden değerlendirmeyle uygun ilk basamak tedavi.",
        },
        daysAgo: 4,
      },
    ],
    reviewCardId: "rev-ecg-timing",
  },
  professionalism: {
    movedBy: {
      en: "Not enough graded encounters yet to show a reliable band.",
      tr: "Güvenilir bir bant göstermek için henüz yeterli değerlendirilmiş karşılaşma yok.",
    },
    nextStep: {
      en: "Three more graded encounters are needed before a reliable band appears.",
      tr: "Güvenilir bir bant görünmeden önce üç değerlendirilmiş karşılaşma daha gerekiyor.",
    },
    bandHistory: [],
    evidence: [],
  },
};

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
