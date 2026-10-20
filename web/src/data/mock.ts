/**
 * AcuDx shared domain types + a little cited reference content — bilingual
 * (EN/TR), typed.
 *
 * This module is the schema hub: the bilingual/clinical primitives, the
 * case / transcript / vitals / feedback / dashboard shapes that the rest of the
 * app imports. The superseded single-case demo fixtures (the chest-pain case,
 * its transcript, and the static vitals series) have been REMOVED — encounters
 * now run on generated `CaseInstance`s and the live `encounterStore`. What
 * remains as a VALUE is genuinely in use: the `recommendedCases` fallback
 * rail. Citations and guidance hints moved to the verified guideline API
 * (src/lib/guidelinesApi.ts); nothing clinical is hard-coded here.
 *
 * Everything is education-only sample content. No real patient data.
 * Turkish strings use correct clinical terminology.
 */

/* -------------------------------------------------------------------------- */
/* Shared primitives                                                          */
/* -------------------------------------------------------------------------- */

export type Lang = "en" | "tr";

/** A string that exists in both supported UI languages. */
export interface Bilingual {
  en: string;
  tr: string;
}

/** Clinical semantic state — ALWAYS paired with an icon + text label in the UI. */
export type ClinicalState = "normal" | "caution" | "warning" | "critical";

/** Directional trend for a vital's short history. */
export type Trend = "rising" | "falling" | "steady";

/* -------------------------------------------------------------------------- */
/* Case                                                                       */
/* -------------------------------------------------------------------------- */

export type Sex = "male" | "female";

export interface PatientDemographics {
  age: number;
  sex: Sex;
  /** e.g. weight/comorbidity flags, kept short for the header line. */
  summary: Bilingual;
}

export interface EncounterStageMeta {
  key:
    | "history"
    | "exam"
    | "tests"
    | "ddx"
    | "diagnosis"
    | "management";
  label: Bilingual;
}

export interface ClinicalCase {
  id: string;
  title: Bilingual;
  specialty: Bilingual;
  chiefComplaint: Bilingual;
  setting: Bilingual;
  demographics: PatientDemographics;
  /** Ordered clinical stages this case walks through. */
  stages: EncounterStageMeta[];
}

/* -------------------------------------------------------------------------- */
/* Transcript                                                                 */
/* -------------------------------------------------------------------------- */

export type TranscriptRole = "doctor" | "patient";

export interface TranscriptTurn {
  id: string;
  role: TranscriptRole;
  en: string;
  tr: string;
  /** Which stage the turn belongs to (for grouping / timeline). */
  stage: EncounterStageMeta["key"];
}

/* -------------------------------------------------------------------------- */
/* Vitals series (for sparklines)                                             */
/* -------------------------------------------------------------------------- */

export type VitalKey = "hr" | "bp" | "rr" | "spo2" | "temp";

export interface VitalReading {
  key: VitalKey;
  /** i18n key suffix for the full and short labels (vitals.<labelKey>). */
  labelKey: string;
  shortKey: string;
  /** Current display value (string so BP "148/92" works). */
  value: string;
  /** i18n unit key suffix (vitals.units.<unitKey>); BP has no trailing unit. */
  unitKey?: "bpm" | "mmhg" | "brpm" | "percent" | "celsius";
  /** Short numeric history for the sparkline (systolic used for BP). */
  history: number[];
  state: ClinicalState;
  trend: Trend;
}

/* -------------------------------------------------------------------------- */
/* Guidance citations (API-backed)                                            */
/* -------------------------------------------------------------------------- */

/**
 * Citations and guidance hints are NOT authored here any more. Every clinical
 * sentence a learner sees comes from the verified GuidelineStatement store
 * (server/guidelines) through src/lib/guidelinesApi.ts, which also carries the
 * view-model types. The aliases below keep the shared schema importable from
 * this hub; `citationId` fields across the app hold verified statement ids.
 */
import type {
  CitationView as ApiCitationView,
  GuidanceHint as ApiGuidanceHint,
} from "@/lib/guidelinesApi";

export type Citation = ApiCitationView;
export type GuidanceHint = ApiGuidanceHint;

/* -------------------------------------------------------------------------- */
/* Feedback report                                                            */
/* -------------------------------------------------------------------------- */

export type Band =
  | "emerging"
  | "developing"
  | "proficient"
  | "strong"
  | "exemplary"
  | "withheld";

export type FeedbackDomainKey =
  | "history"
  | "exam"
  | "reasoning"
  | "communication"
  | "management"
  | "professionalism";

/** Which orthogonal axis a domain belongs to (clinical vs communication). */
export type FeedbackAxis = "clinical" | "communication";

export interface FeedbackDomain {
  key: FeedbackDomainKey;
  axis: FeedbackAxis;
  band: Band;
  /** Model confidence in this band, 0-1 (drives the "withheld" gating). */
  confidence: number;
  /** Measured competence, 0-1 — plotted on the calibration chart. */
  competence: number;
  /** Learner's self-rated confidence, 0-1 — the other calibration axis. */
  selfConfidence: number;
}

/**
 * NOTE (real-data migration): the fabricated per-domain band arrays,
 * calibration points/trajectory, feedback fixtures, dashboard stats and recent
 * feedback that used to live here have been REMOVED. Those plots are now driven
 * from real, earned session history in `src/state/progressStore.ts` (empty by
 * default for a new user). Only the TYPES and shared helpers remain here so the
 * rest of the app keeps compiling. See progressStore for the live data.
 */

export interface FeedbackGap {
  id: string;
  domain: FeedbackDomainKey;
  title: Bilingual;
  /** The exact learner utterance this gap is anchored to (evidence span). */
  evidenceQuote: Bilingual;
  /** What to do differently, with a citation. */
  remediation: Bilingual;
  citationId: string;
  /** True for a safety-critical miss (the single flagged item here). */
  safetyCritical: boolean;
  /** How many times this pattern recurred recently. */
  recurrence: number;
}

/** Direction a domain sits relative to the identity (calibration) line. */
export type CalibrationDirection = "over" | "under" | "well";

export interface CalibrationPoint {
  domain: FeedbackDomainKey;
  confidence: number; // x-axis, 0-1
  competence: number; // y-axis, 0-1
  direction: CalibrationDirection;
}

/**
 * The report bundle shape (kept for typing). The live report is assembled per
 * encounter in `src/pages/FeedbackPage.tsx` from a real progressStore record —
 * there is no fixed `feedbackReport` constant any more.
 */
export interface FeedbackReport {
  caseId: string;
  mode: Bilingual;
  version: string;
  domains: FeedbackDomain[];
  gaps: FeedbackGap[];
  calibration: CalibrationPoint[];
  trajectory: number[];
  citations: Citation[];
}

/* -------------------------------------------------------------------------- */
/* Process-aware assessment fixture type (docs/00-overview/04 §4)             */
/* -------------------------------------------------------------------------- */

/**
 * Structural shape of an event-sourced encounter step. Kept as a type only; the
 * feedback report now runs `computeProcessMetrics` over the REAL encounter log
 * (src/state/encounterStore.ts), not a hand-authored fixture.
 */
export interface ProcessEventFixture {
  seq: number;
  type:
    | "question"
    | "exam"
    | "order"
    | "result"
    | "diagnosis"
    | "note"
    | "stage";
  ref: string;
  at: number;
  meta?: Record<string, unknown>;
}

/**
 * A treatment / safety behavior, each anchored to what happened and cited to a
 * guideline. Kept as a type; the live report derives these per encounter from
 * the real communication flags (see `deriveTreatmentBehaviors` in progressStore).
 */
export interface TreatmentBehavior {
  id: string;
  kind: "communication" | "safety";
  label: Bilingual;
  /** What the student did (or did not do) — the evidence anchor. */
  anchor: Bilingual;
  met: boolean;
  citationId: string;
  /** Safety-critical when unmet is a hard miss (allergy check, etc.). */
  critical: boolean;
}

/* -------------------------------------------------------------------------- */
/* Home dashboard content                                                     */
/* -------------------------------------------------------------------------- */

/** A learner-facing stat tile on the home dashboard. */
export interface DashboardStat {
  key: "completed" | "streak" | "gap";
  value: string;
  /** Supporting line — a forgiving-streak note, a trend caption, etc. */
  caption: Bilingual;
  /** Directional trend for the small caret badge (null = no trend shown). */
  trend: "up" | "down" | null;
  /** Whether "up" reads as good for this metric (drives the accent). */
  upIsGood: boolean;
}

/** Difficulty tier for a recommended case. */
export type CaseDifficulty = "foundation" | "core" | "advanced";

/**
 * Map the generator's 1-5 difficulty onto the three browsing tiers a
 * {@link RecommendedCase} row shows. Pure; shared by the Home rail mapper.
 */
export function difficultyToTier(difficulty: number): CaseDifficulty {
  if (difficulty <= 2) return "foundation";
  if (difficulty >= 4) return "advanced";
  return "core";
}

/** A recommended EM case row (the shape the Home rail renders). */
export interface RecommendedCase {
  id: string;
  title: Bilingual;
  chiefComplaint: Bilingual;
  setting: Bilingual;
  ageSex: Bilingual;
  difficulty: CaseDifficulty;
  /** Short guideline tag shown as a pill, e.g. "ESC ACS 2023". */
  guidelineTag: string;
  /** Estimated minutes for the encounter. */
  estMinutes: number;
  /** Languages the case content is available in. */
  languages: Lang[];
}

/**
 * Static FALLBACK rail — used ONLY when the client case generator throws while
 * building the Home "Recommended for you" set. The live rail is drawn fresh each
 * session from `generateCase` and weighted toward the learner's weakest domains
 * (see `HomePage`), so these hard-coded rows are never the always-on content.
 */
export const recommendedCases: RecommendedCase[] = [
  {
    id: "em-acs-001",
    title: {
      en: "Central chest pain, radiating",
      tr: "Yayılan orta hat göğüs ağrısı",
    },
    chiefComplaint: { en: "Chest pain", tr: "Göğüs ağrısı" },
    setting: { en: "Emergency", tr: "Acil" },
    ageSex: { en: "58M", tr: "58E" },
    difficulty: "core",
    guidelineTag: "ESC ACS 2023",
    estMinutes: 12,
    languages: ["en", "tr"],
  },
  {
    id: "em-sepsis-002",
    title: {
      en: "Fever and confusion in an older adult",
      tr: "Yaşlı bir hastada ateş ve konfüzyon",
    },
    chiefComplaint: { en: "Sepsis screen", tr: "Sepsis taraması" },
    setting: { en: "Emergency", tr: "Acil" },
    ageSex: { en: "74F", tr: "74K" },
    difficulty: "advanced",
    guidelineTag: "NICE NG51",
    estMinutes: 15,
    languages: ["en", "tr"],
  },
  {
    id: "em-asthma-003",
    title: {
      en: "Acute breathlessness in a young adult",
      tr: "Genç bir erişkinde akut nefes darlığı",
    },
    chiefComplaint: { en: "Breathlessness", tr: "Nefes darlığı" },
    setting: { en: "Emergency", tr: "Acil" },
    ageSex: { en: "23F", tr: "23K" },
    difficulty: "foundation",
    guidelineTag: "BTS/SIGN",
    estMinutes: 10,
    languages: ["en", "tr"],
  },
];

/** A recent-feedback row on the home dashboard. */
export interface RecentFeedbackItem {
  id: string;
  caseTitle: Bilingual;
  /** The single headline takeaway for the encounter. */
  takeaway: Bilingual;
  /** Highest band reached, for a small pill. */
  topBand: Band;
  /** Whether the encounter had a flagged safety-critical miss. */
  hadSafetyMiss: boolean;
  /** Relative time key handled in the UI. */
  daysAgo: number;
}

