/**
 * AcuDx mock domain data — bilingual (EN/TR), typed.
 *
 * A single acute chest-pain emergency-medicine case with a chat transcript,
 * a live vitals series (for sparklines), cited guidance hints, and a
 * feedback report (6 domains + calibration + evidence-anchored gaps).
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

export const chestPainCase: ClinicalCase = {
  id: "em-acs-001",
  title: {
    en: "Acute chest pain in a 58-year-old",
    tr: "58 yaşında akut göğüs ağrısı",
  },
  specialty: {
    en: "Emergency medicine",
    tr: "Acil tıp",
  },
  chiefComplaint: {
    en: "Central chest pain radiating to the left arm",
    tr: "Sol kola yayılan orta hat göğüs ağrısı",
  },
  setting: {
    en: "Emergency department, 40 minutes after symptom onset.",
    tr: "Acil servis, semptom başlangıcından 40 dakika sonra.",
  },
  demographics: {
    age: 58,
    sex: "male",
    summary: {
      en: "Hypertension, ex-smoker, no prior cardiac history.",
      tr: "Hipertansiyon, eski sigara içicisi, bilinen kalp hastalığı yok.",
    },
  },
  stages: [
    {
      key: "history",
      label: { en: "History", tr: "Anamnez" },
    },
    {
      key: "exam",
      label: { en: "Examination", tr: "Muayene" },
    },
    {
      key: "tests",
      label: { en: "Investigations", tr: "Tetkikler" },
    },
    {
      key: "ddx",
      label: { en: "Differential", tr: "Ayırıcı tanı" },
    },
    {
      key: "diagnosis",
      label: { en: "Diagnosis", tr: "Tanı" },
    },
    {
      key: "management",
      label: { en: "Management", tr: "Tedavi yönetimi" },
    },
  ],
};

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

export const transcript: TranscriptTurn[] = [
  {
    id: "t1",
    role: "doctor",
    stage: "history",
    en: "Hello, I'm the doctor seeing you today. Can you tell me what brought you in?",
    tr: "Merhaba, bugün sizi görecek olan doktorum. Sizi buraya getiren şikayeti anlatabilir misiniz?",
  },
  {
    id: "t2",
    role: "patient",
    stage: "history",
    en: "About an hour ago I got this heavy pressure in the middle of my chest. It spread to my left arm.",
    tr: "Yaklaşık bir saat önce göğsümün ortasında ağır bir baskı hissettim. Sol koluma yayıldı.",
  },
  {
    id: "t3",
    role: "doctor",
    stage: "history",
    en: "On a scale of zero to ten, how severe is the pain, and is it constant or does it come and go?",
    tr: "Sıfırdan ona kadar bir ölçekte ağrı ne kadar şiddetli ve sürekli mi yoksa gelip geçici mi?",
  },
  {
    id: "t4",
    role: "patient",
    stage: "history",
    en: "It's an eight. It has not eased since it started. I also feel sweaty and a bit sick.",
    tr: "Sekiz gibi. Başladığından beri hiç azalmadı. Ayrıca terliyorum ve biraz bulantım var.",
  },
  {
    id: "t5",
    role: "doctor",
    stage: "exam",
    en: "I'd like to examine you and get some observations. I'm putting you on the monitor now.",
    tr: "Sizi muayene etmek ve bazı ölçümler almak istiyorum. Şimdi sizi monitöre bağlıyorum.",
  },
  {
    id: "t6",
    role: "patient",
    stage: "exam",
    en: "Okay. My father had a heart attack at around my age, if that helps.",
    tr: "Tamam. Babam benim yaşlarımda kalp krizi geçirmişti, faydası olur mu bilmem.",
  },
];

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

export const vitals: VitalReading[] = [
  {
    key: "hr",
    labelKey: "hr",
    shortKey: "hrShort",
    value: "104",
    unitKey: "bpm",
    history: [88, 90, 93, 97, 99, 101, 104],
    state: "caution",
    trend: "rising",
  },
  {
    key: "bp",
    labelKey: "bp",
    shortKey: "bpShort",
    value: "148/92",
    history: [132, 136, 139, 142, 145, 147, 148],
    state: "caution",
    trend: "rising",
  },
  {
    key: "rr",
    labelKey: "rr",
    shortKey: "rrShort",
    value: "20",
    unitKey: "brpm",
    history: [16, 17, 18, 18, 19, 19, 20],
    state: "normal",
    trend: "steady",
  },
  {
    key: "spo2",
    labelKey: "spo2",
    shortKey: "spo2Short",
    value: "95",
    unitKey: "percent",
    history: [98, 98, 97, 97, 96, 96, 95],
    state: "normal",
    trend: "falling",
  },
  {
    key: "temp",
    labelKey: "temp",
    shortKey: "tempShort",
    value: "36.8",
    unitKey: "celsius",
    history: [36.7, 36.7, 36.8, 36.8, 36.8, 36.8, 36.8],
    state: "normal",
    trend: "steady",
  },
];

/** Seconds since the monitor last refreshed (for the "updated Xs ago" line). */
export const vitalsUpdatedSecondsAgo = 3;

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

export const feedbackDomains: FeedbackDomain[] = [
  {
    key: "history",
    axis: "clinical",
    band: "strong",
    confidence: 0.86,
    competence: 0.78,
    selfConfidence: 0.7,
  },
  {
    key: "exam",
    axis: "clinical",
    band: "proficient",
    confidence: 0.81,
    competence: 0.64,
    selfConfidence: 0.75,
  },
  {
    key: "reasoning",
    axis: "clinical",
    band: "developing",
    confidence: 0.79,
    competence: 0.52,
    selfConfidence: 0.82,
  },
  {
    key: "communication",
    axis: "communication",
    band: "strong",
    confidence: 0.84,
    competence: 0.8,
    selfConfidence: 0.68,
  },
  {
    key: "management",
    axis: "clinical",
    band: "developing",
    confidence: 0.74,
    competence: 0.49,
    selfConfidence: 0.71,
  },
  {
    key: "professionalism",
    axis: "communication",
    // Below the reliability threshold — surfaced as "withheld" in the UI.
    band: "withheld",
    confidence: 0.41,
    competence: 0.6,
    selfConfidence: 0.6,
  },
];

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

export const feedbackGaps: FeedbackGap[] = [
  {
    id: "gap-ecg",
    domain: "reasoning",
    title: {
      en: "No ECG requested before moving to management",
      tr: "Tedaviye geçmeden önce EKG istenmedi",
    },
    evidenceQuote: {
      en: "Let's start aspirin and get you comfortable while we wait.",
      tr: "Beklerken aspirin başlayalım ve sizi rahatlatalım.",
    },
    remediation: {
      en: "For suspected acute coronary syndrome, obtain a 12-lead ECG within 10 minutes before committing to a management plan.",
      tr: "Akut koroner sendrom şüphesinde, tedavi planına geçmeden önce 10 dakika içinde 12 derivasyonlu EKG çekin.",
    },
    citationId: "esc-acs-2023",
    safetyCritical: true,
    recurrence: 2,
  },
  {
    id: "gap-risk",
    domain: "history",
    title: {
      en: "Family history captured late in the encounter",
      tr: "Aile öyküsü görüşmenin geç bir aşamasında alındı",
    },
    evidenceQuote: {
      en: "On a scale of zero to ten, how severe is the pain?",
      tr: "Sıfırdan ona kadar bir ölçekte ağrı ne kadar şiddetli?",
    },
    remediation: {
      en: "Screen for cardiac risk factors, including family history of early coronary disease, during the initial history.",
      tr: "Erken koroner hastalık aile öyküsü dahil kardiyak risk faktörlerini ilk anamnez sırasında tarayın.",
    },
    citationId: "nice-ng185",
    safetyCritical: false,
    recurrence: 1,
  },
];

/** Direction a domain sits relative to the identity (calibration) line. */
export type CalibrationDirection = "over" | "under" | "well";

export interface CalibrationPoint {
  domain: FeedbackDomainKey;
  confidence: number; // x-axis, 0-1
  competence: number; // y-axis, 0-1
  direction: CalibrationDirection;
}

/** Derive a calibration point from a domain (single source of truth). */
function toCalibrationPoint(d: FeedbackDomain): CalibrationPoint {
  const delta = d.selfConfidence - d.competence;
  const direction: CalibrationDirection =
    delta > 0.12 ? "over" : delta < -0.12 ? "under" : "well";
  return {
    domain: d.key,
    confidence: d.selfConfidence,
    competence: d.competence,
    direction,
  };
}

export const calibrationPoints: CalibrationPoint[] = feedbackDomains
  .filter((d) => d.band !== "withheld")
  .map(toCalibrationPoint);

/** Recent per-encounter calibration gap (self-confidence minus competence). */
export const calibrationTrajectory: number[] = [0.28, 0.24, 0.22, 0.19, 0.17];

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

export const feedbackReport: FeedbackReport = {
  caseId: chestPainCase.id,
  mode: {
    en: "Guided practice",
    tr: "Rehberli pratik",
  },
  version: "2026.07",
  domains: feedbackDomains,
  gaps: feedbackGaps,
  calibration: calibrationPoints,
  trajectory: calibrationTrajectory,
  citations,
};

/* -------------------------------------------------------------------------- */
/* Process-aware assessment fixture (docs/00-overview/04 §4)                  */
/* -------------------------------------------------------------------------- */

/**
 * A representative event-sourced encounter run against the seed chest-pain /
 * NSTEMI case (src/data/seedCases.ts chestPainNstemiCase). Feeding this to
 * computeProcessMetrics (src/domain/processMetrics.ts) yields a realistic,
 * teachable process report:
 *   - ECG ordered LATE at 18 min (guideline target <= 10 min, ESC ACS 2023)
 *   - Troponin (0/1 h) on time at 9 min; renal function on time at 12 min
 *   - History coverage 8 / 10 expected intents (family history + ICE missed)
 *   - 1 redundant question, 1 off-target question
 *   - 1 low-value order (D-dimer, not indicated for this presentation)
 *   - Correct diagnosis committed at 24 min
 *   - Allergies NOT checked before prescribing -> safety-critical, surfaced
 *     separately and always (§4.2, AS-8)
 *
 * Timestamps are encounter-clock offsets in ms. `meta` mirrors what the live
 * encounter store (src/state/encounterStore.ts) records, so the same pure
 * metrics function runs over mock and live logs identically.
 *
 * Typed structurally (not importing EncounterEvent) to avoid a data -> state
 * import edge; the shape is validated by computeProcessMetrics at the call site.
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

const MIN_MS = 60_000;

export const feedbackEncounterEvents: ProcessEventFixture[] = [
  { seq: 0, type: "stage", ref: "interview", at: 0, meta: { started: true } },
  // History — 8 of 10 expected intents elicited; family-history + ice omitted.
  { seq: 1, type: "question", ref: "onset", at: 0.4 * MIN_MS, meta: { hit: true, redundant: false } },
  { seq: 2, type: "question", ref: "character", at: 1.1 * MIN_MS, meta: { hit: true, redundant: false } },
  { seq: 3, type: "question", ref: "radiation", at: 1.8 * MIN_MS, meta: { hit: true, redundant: false } },
  { seq: 4, type: "question", ref: "severity", at: 2.3 * MIN_MS, meta: { hit: true, redundant: false } },
  { seq: 5, type: "question", ref: "severity", at: 3.0 * MIN_MS, meta: { hit: true, redundant: true } },
  { seq: 6, type: "question", ref: "associated-symptoms", at: 3.6 * MIN_MS, meta: { hit: true, redundant: false } },
  { seq: 7, type: "question", ref: "travel", at: 4.4 * MIN_MS, meta: { hit: false } },
  { seq: 8, type: "question", ref: "risk-factors", at: 5.2 * MIN_MS, meta: { hit: true, redundant: false } },
  { seq: 9, type: "question", ref: "past-medical-history", at: 6.0 * MIN_MS, meta: { hit: true, redundant: false } },
  { seq: 10, type: "question", ref: "medications", at: 6.8 * MIN_MS, meta: { hit: true, redundant: false } },
  // Exam.
  { seq: 11, type: "exam", ref: "general-inspection", at: 7.5 * MIN_MS, meta: { hit: true } },
  { seq: 12, type: "exam", ref: "cardiovascular", at: 8.2 * MIN_MS, meta: { hit: true } },
  // Troponin on time (window 15 min).
  { seq: 13, type: "order", ref: "67151-1", at: 9.0 * MIN_MS, meta: { indicated: true, lowValue: false } },
  // Renal function on time (window 30 min).
  { seq: 14, type: "order", ref: "2160-0", at: 12.0 * MIN_MS, meta: { indicated: true, lowValue: false } },
  // Low-value D-dimer for a clear cardiac presentation (over-ordering).
  { seq: 15, type: "order", ref: "48065-7", at: 14.0 * MIN_MS, meta: { indicated: false, lowValue: true } },
  // ECG ordered LATE at 18 min (target <= 10 min).
  { seq: 16, type: "order", ref: "11524-6", at: 18.0 * MIN_MS, meta: { indicated: true, lowValue: false } },
  { seq: 17, type: "result", ref: "67151-1", at: 20.0 * MIN_MS, meta: {} },
  { seq: 18, type: "result", ref: "11524-6", at: 22.0 * MIN_MS, meta: {} },
  // Correct diagnosis committed at 24 min.
  { seq: 19, type: "diagnosis", ref: "I21.4", at: 24.0 * MIN_MS, meta: { correct: true, display: "NSTEMI" } },
];

/**
 * A treatment / safety behavior, each anchored to what happened and cited to a
 * guideline. "How the patient was treated" (§4.1): communication + safety.
 * `met` is derived from the run; `critical: true` marks a safety behavior that
 * is surfaced separately and always when unmet (§4.2, AS-8).
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

export const treatmentBehaviors: TreatmentBehavior[] = [
  {
    id: "tb-concern",
    kind: "communication",
    label: {
      en: "Addressed the patient's stated concern",
      tr: "Hastanın dile getirdiği endişeyi ele aldı",
    },
    anchor: {
      en: "Acknowledged the fear of a heart attack and explained the next steps.",
      tr: "Kalp krizi korkusunu kabul etti ve sonraki adımları açıkladı.",
    },
    met: true,
    citationId: "tepdad-em",
    critical: false,
  },
  {
    id: "tb-open",
    kind: "communication",
    label: {
      en: "Used open questions before narrowing",
      tr: "Daraltmadan önce açık uçlu sorular kullandı",
    },
    anchor: {
      en: "Opened with an invitation to describe the problem in the patient's own words.",
      tr: "Sorunu hastanın kendi ifadesiyle anlatması için açık bir davetle başladı.",
    },
    met: true,
    citationId: "tepdad-em",
    critical: false,
  },
  {
    id: "tb-redflag",
    kind: "safety",
    label: {
      en: "Screened cardiac red flags",
      tr: "Kardiyak kırmızı bayrakları taradı",
    },
    anchor: {
      en: "Elicited radiation, diaphoresis and nausea during the history.",
      tr: "Anamnezde yayılım, terleme ve bulantıyı sorguladı.",
    },
    met: true,
    citationId: "nice-ng185",
    critical: false,
  },
  {
    id: "tb-allergy",
    kind: "safety",
    label: {
      en: "Checked allergies before prescribing",
      tr: "Reçete etmeden önce alerjileri kontrol etti",
    },
    anchor: {
      en: "Aspirin was started without confirming the allergy status on the banner.",
      tr: "Alerji durumu banttan doğrulanmadan aspirin başlandı.",
    },
    met: false,
    citationId: "esc-acs-2023",
    critical: true,
  },
];

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

export const dashboardStats: DashboardStat[] = [
  {
    key: "completed",
    value: "24",
    caption: {
      en: "Encounters completed this term",
      tr: "Bu dönem tamamlanan görüşme",
    },
    trend: "up",
    upIsGood: true,
  },
  {
    key: "streak",
    value: "6",
    caption: {
      en: "Day streak - one rest day is forgiven",
      tr: "Günlük seri - bir dinlenme günü affedilir",
    },
    trend: null,
    upIsGood: true,
  },
  {
    key: "gap",
    value: "17%",
    caption: {
      en: "Average calibration gap, trending down",
      tr: "Ortalama kalibrasyon farkı, düşüyor",
    },
    trend: "down",
    upIsGood: false,
  },
];

/** Difficulty tier for a recommended case. */
export type CaseDifficulty = "foundation" | "core" | "advanced";

/** A recommended EM case shown on the home grid. */
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

export const recentFeedback: RecentFeedbackItem[] = [
  {
    id: "rf-1",
    caseTitle: {
      en: "Central chest pain, radiating",
      tr: "Yayılan orta hat göğüs ağrısı",
    },
    takeaway: {
      en: "Strong history-taking; order the ECG before management next time.",
      tr: "Güçlü anamnez; bir dahaki sefere tedaviden önce EKG iste.",
    },
    topBand: "strong",
    hadSafetyMiss: true,
    daysAgo: 1,
  },
  {
    id: "rf-2",
    caseTitle: {
      en: "Acute breathlessness in a young adult",
      tr: "Genç bir erişkinde akut nefes darlığı",
    },
    takeaway: {
      en: "Clear safety-netting and well-calibrated confidence throughout.",
      tr: "Net güvenlik ağı ve baştan sona iyi kalibre edilmiş güven.",
    },
    topBand: "exemplary",
    hadSafetyMiss: false,
    daysAgo: 3,
  },
  {
    id: "rf-3",
    caseTitle: {
      en: "Fever and confusion in an older adult",
      tr: "Yaşlı bir hastada ateş ve konfüzyon",
    },
    takeaway: {
      en: "Reasoning developing; widen the differential before committing.",
      tr: "Muhakeme gelişiyor; karar vermeden önce ayırıcı tanıyı genişlet.",
    },
    topBand: "developing",
    hadSafetyMiss: false,
    daysAgo: 6,
  },
];

/* -------------------------------------------------------------------------- */
/* Convenience lookups                                                        */
/* -------------------------------------------------------------------------- */

export function getCitation(id: string): Citation | undefined {
  return citations.find((c) => c.id === id);
}

export function getCitationLabel(id: string): string {
  return getCitation(id)?.label ?? id;
}
