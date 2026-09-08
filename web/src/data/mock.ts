/**
 * AcuDx shared domain types + a little cited reference content — bilingual
 * (EN/TR), typed.
 *
 * This module is the schema hub: the bilingual/clinical primitives, the
 * case / transcript / vitals / feedback / dashboard shapes that the rest of the
 * app imports. The superseded single-case demo fixtures (the chest-pain case,
 * its transcript, and the static vitals series) have been REMOVED — encounters
 * now run on generated `CaseInstance`s and the live `encounterStore`. What
 * remains as VALUES is genuinely in use: the guideline `citations` (+
 * `getCitation`), the cited `guidanceHints`, and the `recommendedCases`
 * fallback rail.
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
/* Guidance hints (cited)                                                     */
/* -------------------------------------------------------------------------- */

export interface Citation {
  id: string;
  /** Short label shown in callouts, e.g. "ESC ACS 2023". */
  label: string;
  source: Bilingual;
  /** ISO date the guideline snapshot was last reviewed. */
  lastReviewed: string;
}

export interface GuidanceHint {
  id: string;
  stage: EncounterStageMeta["key"];
  text: Bilingual;
  citationId: string;
}

export const citations: Citation[] = [
  {
    id: "esc-acs-2023",
    label: "ESC ACS 2023",
    source: {
      en: "2023 ESC Guidelines for the management of acute coronary syndromes.",
      tr: "2023 ESC Akut Koroner Sendromların Yönetimi Kılavuzu.",
    },
    lastReviewed: "2024-11-02",
  },
  {
    id: "nice-ng185",
    label: "NICE NG185",
    source: {
      en: "NICE NG185: Acute coronary syndromes, diagnosis and early management.",
      tr: "NICE NG185: Akut koroner sendromlar, tanı ve erken yönetim.",
    },
    lastReviewed: "2024-09-18",
  },
  {
    id: "nice-ng228",
    label: "NICE NG228",
    source: {
      en: "NICE NG228: Subarachnoid haemorrhage caused by a ruptured aneurysm, diagnosis and management.",
      tr: "NICE NG228: Rüptüre anevrizmaya bağlı subaraknoid kanama, tanı ve yönetim.",
    },
    lastReviewed: "2025-01-20",
  },
  {
    id: "tepdad-em",
    label: "TEPDAD",
    source: {
      en: "TEPDAD national core competency framework, emergency presentations.",
      tr: "TEPDAD ulusal çekirdek yeterlilik çerçevesi, acil başvurular.",
    },
    lastReviewed: "2024-06-30",
  },
  {
    id: "titck-formulary",
    label: "TİTCK",
    source: {
      en: "TİTCK national medicines formulary, drug interaction reference.",
      tr: "TİTCK ulusal ilaç formüleri, ilaç etkileşim referansı.",
    },
    lastReviewed: "2025-03-12",
  },
];

export const guidanceHints: GuidanceHint[] = [
  {
    id: "g1",
    stage: "history",
    text: {
      en: "Characterise the pain and screen for cardiac risk factors early: onset, radiation, associated sweating or nausea.",
      tr: "Ağrıyı erken karakterize edin ve kardiyak risk faktörlerini tarayın: başlangıç, yayılım, eşlik eden terleme veya bulantı.",
    },
    citationId: "nice-ng185",
  },
  {
    id: "g2",
    stage: "tests",
    text: {
      en: "Obtain a 12-lead ECG within 10 minutes of first medical contact and repeat if the first is non-diagnostic.",
      tr: "İlk tıbbi temastan sonraki 10 dakika içinde 12 derivasyonlu EKG çekin ve ilki tanısal değilse tekrarlayın.",
    },
    citationId: "esc-acs-2023",
  },
  {
    id: "g3",
    stage: "tests",
    text: {
      en: "Use a high-sensitivity troponin 0/1-hour or 0/2-hour protocol to rule in or rule out myocardial infarction.",
      tr: "Miyokart enfarktüsünü dışlamak veya doğrulamak için yüksek duyarlıklı troponin 0/1 saat veya 0/2 saat protokolü kullanın.",
    },
    citationId: "esc-acs-2023",
  },
];

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

/* -------------------------------------------------------------------------- */
/* Convenience lookups                                                        */
/* -------------------------------------------------------------------------- */

export function getCitation(id: string): Citation | undefined {
  return citations.find((c) => c.id === id);
}

export function getCitationLabel(id: string): string {
  return getCitation(id)?.label ?? id;
}
