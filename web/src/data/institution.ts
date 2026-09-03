/**
 * Institution ("dean's office") dashboard mock data — Journey 8,
 * docs/design/01 §8.1-8.4, requirements IN-1..IN-7.
 *
 * This is the institutional purchase-justifier. Everything here is AGGREGATE
 * and role-gated: the dean sees cohort-level competency and the *aggregate*
 * calibration signal, never a single learner's private ego-data (INV-4,
 * enforced at the RBAC / data-plane in production; here the mock simply never
 * exposes an individual calibration plot).
 *
 * Content is realistic emergency-medicine training data for a Turkish medical
 * faculty running the EM wedge in TR + EN: real competency domains, real
 * framework references (ACGME Milestones / AAMC Core EPAs / CanMEDS 2025 /
 * LCME / TEPDAD-UÇEP), κ-gated bands (a low-reliability cell is "withheld",
 * never a fabricated band), and a detect -> diagnose -> prescribe -> re-assess
 * -> document remediation loop.
 *
 * Learner rows are de-identified cohort handles (masked roster codes), not real
 * names, mirroring the de-identified export contract (IN-3).
 */

import type { Bilingual, Band, FeedbackDomainKey } from "@/data/mock";

/* -------------------------------------------------------------------------- */
/* Top KPIs — the headline institutional numbers                              */
/* -------------------------------------------------------------------------- */

/** Direction of a KPI's recent movement (never colour-only in the UI). */
export type KpiTrend = "up" | "down" | "steady";

/** Whether "up" is the good direction for this KPI, so the UI can word it. */
export type KpiPolarity = "higherBetter" | "lowerBetter" | "neutral";

export interface InstitutionKpi {
  id: string;
  labelKey: string;
  /** Pre-formatted display value (locale-agnostic digits; unit shown apart). */
  value: string;
  unit?: Bilingual;
  /** Short supporting line, e.g. the comparison window. */
  hintKey: string;
  trend: KpiTrend;
  polarity: KpiPolarity;
  /** Magnitude of change, already worded (e.g. "+4 pp"). */
  delta: string;
}

/**
 * Six KPIs the dean reads first. Encounters and active learners establish
 * scale; the wk1->wk6 competence rise is the MVP validity signal; the
 * calibration gap and safety-critical resolution rate are the quality signals;
 * remediation closure is the "money feature" health metric (IN-2).
 */
export const institutionKpis: InstitutionKpi[] = [
  {
    id: "kpi-active",
    labelKey: "institution.kpi.activeLearners",
    value: "184",
    hintKey: "institution.kpi.activeLearnersHint",
    trend: "up",
    polarity: "higherBetter",
    delta: "+12",
  },
  {
    id: "kpi-encounters",
    labelKey: "institution.kpi.encounters",
    value: "3.240",
    hintKey: "institution.kpi.encountersHint",
    trend: "up",
    polarity: "higherBetter",
    delta: "+8%",
  },
  {
    id: "kpi-competence",
    labelKey: "institution.kpi.competenceRise",
    value: "+2,1",
    unit: { en: "bands", tr: "bant" },
    hintKey: "institution.kpi.competenceRiseHint",
    trend: "up",
    polarity: "higherBetter",
    delta: "wk1 to wk6",
  },
  {
    id: "kpi-calibration",
    labelKey: "institution.kpi.calibrationGap",
    value: "19",
    unit: { en: "pp", tr: "yp" },
    hintKey: "institution.kpi.calibrationGapHint",
    trend: "down",
    polarity: "lowerBetter",
    delta: "-6 pp",
  },
  {
    id: "kpi-safety",
    labelKey: "institution.kpi.safetyResolved",
    value: "87",
    unit: { en: "%", tr: "%" },
    hintKey: "institution.kpi.safetyResolvedHint",
    trend: "up",
    polarity: "higherBetter",
    delta: "+9 pp",
  },
  {
    id: "kpi-remediation",
    labelKey: "institution.kpi.remediationClosed",
    value: "14 / 19",
    hintKey: "institution.kpi.remediationClosedHint",
    trend: "up",
    polarity: "higherBetter",
    delta: "+3",
  },
];

/* -------------------------------------------------------------------------- */
/* Cohort competency heatmap — learners x 6 domains (IN-1)                     */
/* -------------------------------------------------------------------------- */

/** The six competency domains, in the fixed dual-axis display order. */
export const HEATMAP_DOMAINS: {
  key: FeedbackDomainKey;
  axis: "clinical" | "communication";
}[] = [
  { key: "history", axis: "clinical" },
  { key: "exam", axis: "clinical" },
  { key: "reasoning", axis: "clinical" },
  { key: "management", axis: "clinical" },
  { key: "communication", axis: "communication" },
  { key: "professionalism", axis: "communication" },
];

/** One heatmap cell: a κ-gated band plus the evidence behind it. */
export interface HeatmapCell {
  band: Band;
  /** Graded encounters behind this cell (drives the κ / reliability copy). */
  encounters: number;
}

export interface CohortLearner {
  id: string;
  /** De-identified roster handle (masked), never a real name (IN-3). */
  handle: string;
  /** Study year / section label suffix key, e.g. "y4". */
  sectionKey: string;
  /** Primary learning locale, for the fairness read-out. */
  locale: "tr" | "en";
  /** Band per domain, keyed by FeedbackDomainKey. */
  cells: Record<FeedbackDomainKey, HeatmapCell>;
  /** True when this learner is on the at-risk list (row affordance). */
  atRisk: boolean;
}

function cells(
  spec: Record<FeedbackDomainKey, [Band, number]>,
): Record<FeedbackDomainKey, HeatmapCell> {
  return {
    history: { band: spec.history[0], encounters: spec.history[1] },
    exam: { band: spec.exam[0], encounters: spec.exam[1] },
    reasoning: { band: spec.reasoning[0], encounters: spec.reasoning[1] },
    management: { band: spec.management[0], encounters: spec.management[1] },
    communication: {
      band: spec.communication[0],
      encounters: spec.communication[1],
    },
    professionalism: {
      band: spec.professionalism[0],
      encounters: spec.professionalism[1],
    },
  };
}

/**
 * Twelve de-identified learner rows. The spread is realistic: most are
 * developing/proficient, a few are strong/exemplary, and three carry recurring
 * gaps that put them on the at-risk list. Reasoning and management are the
 * cohort's soft spots (mirrored by the aggregate calibration signal below),
 * and a couple of cells are "withheld" because there is not yet enough
 * reliable evidence to display a band (κ-gating extended to the aggregate).
 */
export const cohortLearners: CohortLearner[] = [
  {
    id: "l-01",
    handle: "EM-2481",
    sectionKey: "y5",
    locale: "tr",
    atRisk: false,
    cells: cells({
      history: ["strong", 14],
      exam: ["proficient", 12],
      reasoning: ["strong", 13],
      management: ["proficient", 11],
      communication: ["exemplary", 12],
      professionalism: ["strong", 9],
    }),
  },
  {
    id: "l-02",
    handle: "EM-2493",
    sectionKey: "y5",
    locale: "en",
    atRisk: false,
    cells: cells({
      history: ["proficient", 11],
      exam: ["proficient", 10],
      reasoning: ["developing", 12],
      management: ["proficient", 9],
      communication: ["strong", 10],
      professionalism: ["proficient", 8],
    }),
  },
  {
    id: "l-03",
    handle: "EM-2507",
    sectionKey: "y4",
    locale: "tr",
    atRisk: true,
    cells: cells({
      history: ["developing", 9],
      exam: ["developing", 8],
      reasoning: ["emerging", 10],
      management: ["emerging", 7],
      communication: ["proficient", 9],
      professionalism: ["developing", 5],
    }),
  },
  {
    id: "l-04",
    handle: "EM-2512",
    sectionKey: "y4",
    locale: "tr",
    atRisk: false,
    cells: cells({
      history: ["proficient", 10],
      exam: ["developing", 9],
      reasoning: ["developing", 11],
      management: ["developing", 8],
      communication: ["proficient", 9],
      professionalism: ["proficient", 6],
    }),
  },
  {
    id: "l-05",
    handle: "EM-2528",
    sectionKey: "y5",
    locale: "en",
    atRisk: false,
    cells: cells({
      history: ["strong", 13],
      exam: ["strong", 12],
      reasoning: ["proficient", 12],
      management: ["proficient", 10],
      communication: ["proficient", 11],
      professionalism: ["strong", 8],
    }),
  },
  {
    id: "l-06",
    handle: "EM-2534",
    sectionKey: "y4",
    locale: "tr",
    atRisk: true,
    cells: cells({
      history: ["developing", 8],
      exam: ["emerging", 7],
      reasoning: ["emerging", 9],
      management: ["developing", 6],
      communication: ["developing", 8],
      professionalism: ["withheld", 3],
    }),
  },
  {
    id: "l-07",
    handle: "EM-2549",
    sectionKey: "y5",
    locale: "tr",
    atRisk: false,
    cells: cells({
      history: ["proficient", 12],
      exam: ["proficient", 11],
      reasoning: ["proficient", 12],
      management: ["developing", 9],
      communication: ["strong", 10],
      professionalism: ["proficient", 7],
    }),
  },
  {
    id: "l-08",
    handle: "EM-2553",
    sectionKey: "y4",
    locale: "en",
    atRisk: false,
    cells: cells({
      history: ["developing", 9],
      exam: ["proficient", 10],
      reasoning: ["developing", 10],
      management: ["developing", 8],
      communication: ["proficient", 9],
      professionalism: ["developing", 5],
    }),
  },
  {
    id: "l-09",
    handle: "EM-2561",
    sectionKey: "y6",
    locale: "tr",
    atRisk: false,
    cells: cells({
      history: ["exemplary", 15],
      exam: ["strong", 13],
      reasoning: ["strong", 14],
      management: ["strong", 12],
      communication: ["strong", 12],
      professionalism: ["exemplary", 10],
    }),
  },
  {
    id: "l-10",
    handle: "EM-2574",
    sectionKey: "y6",
    locale: "en",
    atRisk: false,
    cells: cells({
      history: ["strong", 14],
      exam: ["proficient", 12],
      reasoning: ["strong", 13],
      management: ["proficient", 11],
      communication: ["proficient", 11],
      professionalism: ["strong", 9],
    }),
  },
  {
    id: "l-11",
    handle: "EM-2588",
    sectionKey: "y4",
    locale: "tr",
    atRisk: true,
    cells: cells({
      history: ["emerging", 7],
      exam: ["developing", 8],
      reasoning: ["emerging", 8],
      management: ["emerging", 6],
      communication: ["developing", 7],
      professionalism: ["developing", 4],
    }),
  },
  {
    id: "l-12",
    handle: "EM-2596",
    sectionKey: "y5",
    locale: "en",
    atRisk: false,
    cells: cells({
      history: ["proficient", 11],
      exam: ["developing", 9],
      reasoning: ["developing", 10],
      management: ["proficient", 9],
      communication: ["strong", 10],
      professionalism: ["proficient", 6],
    }),
  },
];

/* -------------------------------------------------------------------------- */
/* At-risk & remediation closed loop (IN-2)                                   */
/* -------------------------------------------------------------------------- */

/**
 * The five stages of the remediation loop, in order. The loop is the
 * renewal-driving "money feature": every at-risk learner moves
 * detect -> diagnose -> prescribe -> re-assess -> document, and the record is
 * exportable. Stage state is what makes the loop *closed* rather than a to-do.
 */
export const REMEDIATION_STAGES = [
  "detect",
  "diagnose",
  "prescribe",
  "reassess",
  "document",
] as const;

export type RemediationStage = (typeof REMEDIATION_STAGES)[number];

/** Per-stage status: done, the stage currently in progress, or not yet started. */
export type RemediationStageStatus = "done" | "active" | "pending";

export interface RemediationRecord {
  id: string;
  /** The at-risk learner (de-identified handle). */
  learnerHandle: string;
  sectionKey: string;
  /** Why they surfaced: recurring safety miss vs stalled competency. */
  triggerKey: string;
  /** The diagnosed gaps (which domains / behaviours). */
  gaps: {
    domain: FeedbackDomainKey;
    detail: Bilingual;
    /** Times this gap recurred recently. */
    recurrence: number;
  }[];
  /** The prescribed remediation (assigned cases / reviews). */
  prescription: Bilingual;
  citationId: string;
  /** How far around the loop this learner is. */
  status: Record<RemediationStage, RemediationStageStatus>;
  /** Re-assessment outcome once available, else null (still in progress). */
  reassessOutcome: Bilingual | null;
  /** Days since the loop opened. */
  openedDaysAgo: number;
}

export const remediationRecords: RemediationRecord[] = [
  {
    id: "rem-01",
    learnerHandle: "EM-2588",
    sectionKey: "y4",
    triggerKey: "institution.remediation.trigger.safety",
    gaps: [
      {
        domain: "reasoning",
        detail: {
          en: "No 12-lead ECG ordered before committing management in suspected ACS",
          tr: "AKS şüphesinde tedaviye geçmeden 12 derivasyonlu EKG istenmedi",
        },
        recurrence: 4,
      },
      {
        domain: "management",
        detail: {
          en: "Aspirin not given during initial management of chest pain",
          tr: "Göğüs ağrısının ilk yönetiminde aspirin verilmedi",
        },
        recurrence: 3,
      },
    ],
    prescription: {
      en: "Two blind-spot ACS cases plus an ECG-timing spaced-repetition set, faculty check-in at re-assessment.",
      tr: "İki kör-nokta AKS vakası ve EKG zamanlaması aralıklı tekrar seti, yeniden değerlendirmede öğretim üyesi görüşmesi.",
    },
    citationId: "esc-acs-2023",
    status: {
      detect: "done",
      diagnose: "done",
      prescribe: "done",
      reassess: "active",
      document: "pending",
    },
    reassessOutcome: null,
    openedDaysAgo: 11,
  },
  {
    id: "rem-02",
    learnerHandle: "EM-2534",
    sectionKey: "y4",
    triggerKey: "institution.remediation.trigger.stalled",
    gaps: [
      {
        domain: "exam",
        detail: {
          en: "Focused cardiorespiratory examination steps repeatedly skipped",
          tr: "Odaklı kardiyorespiratuvar muayene adımları tekrar tekrar atlandı",
        },
        recurrence: 5,
      },
    ],
    prescription: {
      en: "Guided examination drills with scaffolding on, one review card per missed step.",
      tr: "Rehberli muayene alıştırmaları (destek açık), atlanan her adım için bir tekrar kartı.",
    },
    citationId: "nice-ng185",
    status: {
      detect: "done",
      diagnose: "done",
      prescribe: "active",
      reassess: "pending",
      document: "pending",
    },
    reassessOutcome: null,
    openedDaysAgo: 6,
  },
  {
    id: "rem-03",
    learnerHandle: "EM-2507",
    sectionKey: "y4",
    triggerKey: "institution.remediation.trigger.stalled",
    gaps: [
      {
        domain: "reasoning",
        detail: {
          en: "Differential narrowed prematurely without red-flag screening",
          tr: "Kırmızı bayrak taraması yapılmadan ayırıcı tanı erken daraltıldı",
        },
        recurrence: 3,
      },
      {
        domain: "management",
        detail: {
          en: "Safety-netting advice omitted on low-risk discharge",
          tr: "Düşük riskli taburcuda güvenlik ağı önerisi atlandı",
        },
        recurrence: 2,
      },
    ],
    prescription: {
      en: "A reasoning-structure case set and a safety-netting review, re-assessed on a held-out case.",
      tr: "Muhakeme yapısı vaka seti ve güvenlik ağı tekrarı, ayrı tutulan bir vakada yeniden değerlendirme.",
    },
    citationId: "tepdad-em",
    status: {
      detect: "done",
      diagnose: "done",
      prescribe: "done",
      reassess: "done",
      document: "done",
    },
    reassessOutcome: {
      en: "Reasoning moved Emerging to Developing; red-flag screening now consistent across three cases.",
      tr: "Muhakeme Başlangıç'tan Gelişmekte'ye yükseldi; kırmızı bayrak taraması artık üç vakada tutarlı.",
    },
    openedDaysAgo: 21,
  },
];

/* -------------------------------------------------------------------------- */
/* Aggregate calibration — systematic over/under-confidence by topic (IN-4)   */
/* -------------------------------------------------------------------------- */

/** Direction of the cohort's systematic miscalibration on a topic. */
export type CalibrationDirection = "over" | "under" | "well";

export interface AggregateCalibrationTopic {
  id: string;
  topic: Bilingual;
  /** Which domain this curriculum topic maps to. */
  domain: FeedbackDomainKey;
  direction: CalibrationDirection;
  /**
   * Signed cohort gap in percentage points (self-confidence minus competence).
   * Positive = overconfident, negative = underconfident. This is an AGGREGATE,
   * never an individual's number (INV-4).
   */
  gapPct: number;
  /** Learners contributing to this aggregate (de-identified count). */
  learners: number;
  /** The curriculum action this signal implies. */
  signal: Bilingual;
  citationId: string;
}

/**
 * The curriculum diagnostic. The cohort is systematically OVERconfident on ECG
 * interpretation and management timing (the dangerous direction, a teaching
 * priority) and UNDERconfident on communication (common for the TR/ESL cohort,
 * an imposter-effect signal to reframe). History-taking is well-calibrated.
 */
export const aggregateCalibration: AggregateCalibrationTopic[] = [
  {
    id: "cal-ecg",
    topic: { en: "ECG interpretation", tr: "EKG yorumu" },
    domain: "reasoning",
    direction: "over",
    gapPct: 24,
    learners: 96,
    signal: {
      en: "Add a targeted ECG-interpretation block; the cohort commits with more confidence than the evidence supports.",
      tr: "Hedefli bir EKG yorumu bloğu ekleyin; kohort, kanıtın desteklediğinden daha yüksek güvenle karar veriyor.",
    },
    citationId: "esc-acs-2023",
  },
  {
    id: "cal-mgmt",
    topic: { en: "Time-critical management", tr: "Zaman kritik yönetim" },
    domain: "management",
    direction: "over",
    gapPct: 18,
    learners: 88,
    signal: {
      en: "Reinforce door-to-treatment timing in the ACS curriculum; overconfidence concentrates on first-dose timing.",
      tr: "AKS müfredatında kapı-tedavi süresini pekiştirin; aşırı güven ilk doz zamanlamasında yoğunlaşıyor.",
    },
    citationId: "esc-acs-2023",
  },
  {
    id: "cal-comm",
    topic: { en: "Breaking difficult news", tr: "Zor haber verme" },
    domain: "communication",
    direction: "under",
    gapPct: -14,
    learners: 74,
    signal: {
      en: "Performance exceeds self-rating, most strongly in the TR-primary group; reframe to counter the imposter effect.",
      tr: "Performans öz-değerlendirmenin üzerinde, en belirgin şekilde Türkçe-birincil grupta; sahtekârlık etkisini gidermek için yeniden çerçeveleyin.",
    },
    citationId: "tepdad-em",
  },
  {
    id: "cal-history",
    topic: { en: "Focused history-taking", tr: "Odaklı anamnez alma" },
    domain: "history",
    direction: "well",
    gapPct: 4,
    learners: 102,
    signal: {
      en: "Well-calibrated across the cohort; no curriculum action needed this window.",
      tr: "Kohort genelinde iyi kalibre; bu dönem müfredat eylemi gerekmiyor.",
    },
    citationId: "nice-ng185",
  },
  {
    id: "cal-consent",
    topic: { en: "Shared decision and consent", tr: "Ortak karar ve onam" },
    domain: "professionalism",
    direction: "under",
    gapPct: -11,
    learners: 69,
    signal: {
      en: "Self-rating trails observed practice on consent conversations; name the skill so the cohort recognises it.",
      tr: "Onam görüşmelerinde öz-değerlendirme gözlenen uygulamanın gerisinde; kohortun bunu fark etmesi için beceriyi adlandırın.",
    },
    citationId: "tepdad-em",
  },
  {
    id: "cal-exam",
    topic: { en: "Focused physical examination", tr: "Odaklı fizik muayene" },
    domain: "exam",
    direction: "well",
    gapPct: 5,
    learners: 91,
    signal: {
      en: "Confidence tracks competence on examination; keep the current teaching approach this window.",
      tr: "Muayenede güven yeterlilikle örtüşüyor; bu dönem mevcut öğretim yaklaşımını sürdürün.",
    },
    citationId: "nice-ng185",
  },
];

/* -------------------------------------------------------------------------- */
/* Accreditation export (IN-3) — framework-tagged, de-identified              */
/* -------------------------------------------------------------------------- */

export interface AccreditationFramework {
  id: string;
  /** Short label shown on the export chip, e.g. "ACGME". */
  label: string;
  name: Bilingual;
  /** How many of this framework's elements the current scope maps to. */
  mappedElements: number;
  totalElements: number;
  /** The crosswalk version stamped into the export. */
  crosswalkVersion: string;
}

/**
 * The frameworks the one-click export can tag to (IN-3 / IN-6). A crosswalk,
 * never a re-grading: the same evidence maps to LCME / ACGME / CanMEDS 2025 /
 * AAMC Core EPAs, plus TEPDAD-UÇEP for the Turkish national accreditation body.
 */
export const accreditationFrameworks: AccreditationFramework[] = [
  {
    id: "acgme",
    label: "ACGME",
    name: {
      en: "ACGME Milestones (6 core competencies)",
      tr: "ACGME Milestones (6 temel yetkinlik)",
    },
    mappedElements: 22,
    totalElements: 24,
    crosswalkVersion: "v2025.1",
  },
  {
    id: "canmeds",
    label: "CanMEDS",
    name: {
      en: "CanMEDS 2025 (7 physician roles)",
      tr: "CanMEDS 2025 (7 hekim rolü)",
    },
    mappedElements: 6,
    totalElements: 7,
    crosswalkVersion: "v2025.0",
  },
  {
    id: "epa",
    label: "AAMC EPA",
    name: {
      en: "AAMC Core Entrustable Professional Activities",
      tr: "AAMC Temel Emanet Edilebilir Profesyonel Faaliyetler",
    },
    mappedElements: 11,
    totalElements: 13,
    crosswalkVersion: "v2024.2",
  },
  {
    id: "lcme",
    label: "LCME",
    name: {
      en: "LCME accreditation elements",
      tr: "LCME akreditasyon unsurları",
    },
    mappedElements: 8,
    totalElements: 12,
    crosswalkVersion: "v2025.1",
  },
  {
    id: "tepdad",
    label: "TEPDAD",
    name: {
      en: "TEPDAD / UÇEP national core outcomes",
      tr: "TEPDAD / UÇEP ulusal çekirdek çıktıları",
    },
    mappedElements: 19,
    totalElements: 21,
    crosswalkVersion: "v2024.1",
  },
];

/** Options for the export scope selector (all de-identified). */
export interface ExportScopeOption {
  id: string;
  labelKey: string;
  /** Whether this option is preselected in the mock builder. */
  selected: boolean;
}

export const exportScopeOptions: ExportScopeOption[] = [
  { id: "cohort", labelKey: "institution.export.scope.cohort", selected: true },
  { id: "window", labelKey: "institution.export.scope.window", selected: true },
  { id: "deidentified", labelKey: "institution.export.scope.deidentified", selected: true },
  { id: "fairness", labelKey: "institution.export.scope.fairness", selected: true },
];

/* -------------------------------------------------------------------------- */
/* Fairness audit (IN-7, DC-2) — TR vs EN language subgroup                    */
/* -------------------------------------------------------------------------- */

/** A per-locale fairness metric, broken out TR vs EN (DC-2). */
export interface FairnessMetric {
  id: string;
  labelKey: string;
  /** Value for the TR-primary subgroup (pre-formatted). */
  tr: string;
  /** Value for the EN-primary subgroup (pre-formatted). */
  en: string;
  /** Whether the gap between subgroups is within tolerance. */
  withinTolerance: boolean;
}

/**
 * The mandatory fairness read-out (IN-7). The headline invariant: the CLINICAL
 * axis must not correlate with language. Here the clinical-band distributions
 * are within tolerance across TR and EN (accent / L2 form never scores), while
 * the STT-fallback rate is legitimately higher for the TR voice path and is
 * shown transparently, not hidden.
 */
export const fairnessMetrics: FairnessMetric[] = [
  {
    id: "fair-clinical",
    labelKey: "institution.fairness.metric.clinicalBand",
    tr: "Developing +",
    en: "Developing +",
    withinTolerance: true,
  },
  {
    id: "fair-comm",
    labelKey: "institution.fairness.metric.commBand",
    tr: "Proficient +",
    en: "Proficient +",
    withinTolerance: true,
  },
  {
    id: "fair-refusal",
    labelKey: "institution.fairness.metric.refusalRate",
    tr: "1,1%",
    en: "0,9%",
    withinTolerance: true,
  },
  {
    id: "fair-stt",
    labelKey: "institution.fairness.metric.sttFallback",
    tr: "6,4%",
    en: "3,8%",
    withinTolerance: true,
  },
];

/** The de-identified subgroup sizes behind the fairness read-out. */
export const fairnessCohort = {
  trLearners: 108,
  enLearners: 76,
};

/* -------------------------------------------------------------------------- */
/* Heatmap drill-down evidence (IN-1) — cohort -> learner -> domain -> span    */
/* -------------------------------------------------------------------------- */

/** Which axis a competency domain belongs to (clinical vs communication). */
export function axisOfDomain(
  domain: FeedbackDomainKey,
): "clinical" | "communication" {
  return domain === "communication" || domain === "professionalism"
    ? "communication"
    : "clinical";
}

/** Coarse performance level a band maps to, for representative evidence. */
export type EvidenceLevel = "weak" | "mid" | "strong";

/** Bucket a band into a coarse evidence level; withheld has none. */
export function bandLevel(band: Band): EvidenceLevel | null {
  switch (band) {
    case "emerging":
    case "developing":
      return "weak";
    case "proficient":
      return "mid";
    case "strong":
    case "exemplary":
      return "strong";
    case "withheld":
      return null;
  }
}

export interface DomainEvidence {
  /** Verbatim encounter span, shown in the learner's OWN language (never re-scored). */
  quote: Bilingual;
  /** The grader's process-aware read, shown in the UI language. */
  take: Bilingual;
}

/**
 * Representative evidence spans per domain and performance level. The quote is
 * a de-identified encounter span (learner or patient voice); the take is the
 * grader's read. Content is realistic emergency-medicine practice; no names,
 * only the clinical behaviour behind the band.
 */
export const DOMAIN_EVIDENCE: Record<
  FeedbackDomainKey,
  Record<EvidenceLevel, DomainEvidence>
> = {
  history: {
    weak: {
      quote: {
        en: "So when did the pain start? Okay. Anything else? No? Right, let's move on.",
        tr: "Peki ağrı ne zaman başladı? Tamam. Başka bir şey? Yok mu? Peki, devam edelim.",
      },
      take: {
        en: "History closed early; radiation, exertion, and cardiac risk factors were not explored before narrowing.",
        tr: "Anamnez erken kapatıldı; daraltmadan önce yayılım, efor ve kardiyak risk faktörleri sorgulanmadı.",
      },
    },
    mid: {
      quote: {
        en: "Does the pain go anywhere, and does anything make it worse?",
        tr: "Ağrı bir yere yayılıyor mu ve herhangi bir şey onu artırıyor mu?",
      },
      take: {
        en: "Covered the core cardinal features; missed prior episodes and family history.",
        tr: "Temel ayırt edici özellikleri sordu; geçmiş ataklar ve aile öyküsü atlandı.",
      },
    },
    strong: {
      quote: {
        en: "Any pain into the jaw or left arm, sweating, or breathlessness alongside it?",
        tr: "Çeneye ya da sol kola vuran ağrı, terleme veya buna eşlik eden nefes darlığı var mı?",
      },
      take: {
        en: "Structured, hypothesis-driven history; screened red flags before narrowing the differential.",
        tr: "Yapılandırılmış, hipotez odaklı anamnez; ayırıcı tanıyı daraltmadan önce kırmızı bayrakları taradı.",
      },
    },
  },
  exam: {
    weak: {
      quote: {
        en: "I'll just listen to the chest quickly.",
        tr: "Göğsü hızlıca bir dinleyeyim.",
      },
      take: {
        en: "Auscultation only; vitals were not interpreted and focused cardiovascular steps were skipped.",
        tr: "Yalnızca oskültasyon; vitaller yorumlanmadı ve odaklı kardiyovasküler adımlar atlandı.",
      },
    },
    mid: {
      quote: {
        en: "Heart sounds are normal, chest is clear; I'll check the pulses too.",
        tr: "Kalp sesleri normal, akciğerler temiz; nabızlara da bakayım.",
      },
      take: {
        en: "Reasonable focused examination; findings were not reconciled with the vitals trend.",
        tr: "Makul, odaklı muayene; bulgular vital seyriyle ilişkilendirilmedi.",
      },
    },
    strong: {
      quote: {
        en: "Blood pressure is equal in both arms, no murmurs, calves are soft, and the JVP is not raised.",
        tr: "Tansiyon iki kolda eşit, üfürüm yok, baldırlar yumuşak ve JVP artmamış.",
      },
      take: {
        en: "Complete, targeted examination that actively ruled competing diagnoses in and out.",
        tr: "Rakip tanıları etkin biçimde dışlayıp doğrulayan eksiksiz, hedefli muayene.",
      },
    },
  },
  reasoning: {
    weak: {
      quote: {
        en: "It's probably just muscular, no need for an ECG.",
        tr: "Muhtemelen sadece kas ağrısı, EKG'ye gerek yok.",
      },
      take: {
        en: "Anchored on a benign cause and committed before any red-flag screening.",
        tr: "İyi huylu bir nedene sabitlendi ve herhangi bir kırmızı bayrak taraması yapmadan karar verdi.",
      },
    },
    mid: {
      quote: {
        en: "Could be reflux, but I want to rule out a cardiac cause first.",
        tr: "Reflü olabilir ama önce kardiyak bir nedeni dışlamak istiyorum.",
      },
      take: {
        en: "Held a safe differential; the ordering sequence lagged behind the working diagnosis.",
        tr: "Güvenli bir ayırıcı tanı tuttu; tetkik isteme sırası çalışma tanısının gerisinde kaldı.",
      },
    },
    strong: {
      quote: {
        en: "Given the risk factors I'll treat this as ACS until the ECG and troponin say otherwise.",
        tr: "Risk faktörlerini göz önünde tutarak, EKG ve troponin aksini gösterene dek bunu AKS olarak ele alacağım.",
      },
      take: {
        en: "Explicit, safety-first reasoning with a clear must-not-miss and a review plan.",
        tr: "Kaçırılmaması gerekeni ve bir yeniden değerlendirme planını içeren açık, güvenlik öncelikli muhakeme.",
      },
    },
  },
  management: {
    weak: {
      quote: {
        en: "Let's give something for the pain and see how it goes.",
        tr: "Ağrı için bir şeyler verelim, nasıl gideceğine bakalım.",
      },
      take: {
        en: "No time-critical first steps; aspirin and ECG timing were not addressed.",
        tr: "Zaman kritik ilk adımlar yok; aspirin ve EKG zamanlaması ele alınmadı.",
      },
    },
    mid: {
      quote: {
        en: "Aspirin now, get the ECG, and I'll reassess in ten minutes.",
        tr: "Şimdi aspirin, EKG çekilsin ve on dakika sonra yeniden değerlendireceğim.",
      },
      take: {
        en: "Correct first moves; the safety-netting and disposition plan were thin.",
        tr: "İlk adımlar doğru; güvenlik ağı ve taburculuk planı zayıftı.",
      },
    },
    strong: {
      quote: {
        en: "Aspirin, serial ECGs, cardiology referral, and clear return advice if the pain recurs.",
        tr: "Aspirin, seri EKG'ler, kardiyoloji konsültasyonu ve ağrı tekrarlarsa net dönüş önerisi.",
      },
      take: {
        en: "Complete, guideline-concordant management with explicit safety-netting.",
        tr: "Açık güvenlik ağıyla eksiksiz, kılavuza uygun yönetim.",
      },
    },
  },
  communication: {
    weak: {
      quote: {
        en: "The results are fine, you can go home.",
        tr: "Sonuçlar iyi, eve gidebilirsiniz.",
      },
      take: {
        en: "Information delivered without checking understanding or inviting questions.",
        tr: "Anlayış kontrol edilmeden ve soru sorma fırsatı verilmeden bilgi aktarıldı.",
      },
    },
    mid: {
      quote: {
        en: "So this looks like reflux; does that fit with how you've been feeling?",
        tr: "Bu reflü gibi görünüyor; bu, kendinizi nasıl hissettiğinizle örtüşüyor mu?",
      },
      take: {
        en: "Checked the patient's frame once; did not close the loop on the plan.",
        tr: "Hastanın bakış açısını bir kez kontrol etti; plan üzerinde döngüyü kapatmadı.",
      },
    },
    strong: {
      quote: {
        en: "I want to be sure I explained this well; can you tell me what you'll watch for at home?",
        tr: "Bunu iyi anlattığımdan emin olmak istiyorum; evde neye dikkat edeceğinizi söyleyebilir misiniz?",
      },
      take: {
        en: "Teach-back used to confirm understanding; empathic and clearly structured.",
        tr: "Anlayışı doğrulamak için geri-öğretim kullanıldı; empatik ve net biçimde yapılandırılmış.",
      },
    },
  },
  professionalism: {
    weak: {
      quote: {
        en: "I didn't get time to write it up, I'll remember the details.",
        tr: "Yazmaya vakit bulamadım, ayrıntıları hatırlarım.",
      },
      take: {
        en: "Documentation deferred; the handover would not be reconstructable from the record.",
        tr: "Belgeleme ertelendi; devir teslim kayıttan yeniden oluşturulamazdı.",
      },
    },
    mid: {
      quote: {
        en: "I've noted the plan; I'll flag the allergy to the nurse.",
        tr: "Planı not ettim; alerjiyi hemşireye ileteceğim.",
      },
      take: {
        en: "Dependable core habits; the shared-decision documentation was light.",
        tr: "Güvenilir temel alışkanlıklar; ortak karar belgelemesi hafif kaldı.",
      },
    },
    strong: {
      quote: {
        en: "I documented consent, the safety-net advice, and who to contact, and confirmed the allergy.",
        tr: "Onamı, güvenlik ağı önerisini ve iletişim kişisini belgeledim ve alerjiyi doğruladım.",
      },
      take: {
        en: "Thorough, accountable record-keeping that closes the loop for the next clinician.",
        tr: "Bir sonraki klinisyen için döngüyü kapatan titiz, hesap verebilir kayıt tutma.",
      },
    },
  },
};

/** One drill-down datum: the cell's band, its evidence weight, and the span. */
export interface DrillDatum {
  band: Band;
  encounters: number;
  /** Representative evidence, or null when the band is withheld (κ-gated). */
  evidence: DomainEvidence | null;
}

/** Resolve the drill-down datum for a learner in one competency domain. */
export function drillDatum(
  learner: CohortLearner,
  domain: FeedbackDomainKey,
): DrillDatum {
  const cell = learner.cells[domain];
  const level = bandLevel(cell.band);
  return {
    band: cell.band,
    encounters: cell.encounters,
    evidence: level ? DOMAIN_EVIDENCE[domain][level] : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Accreditation crosswalk tags (IN-3 / IN-6) — domain -> framework element    */
/* -------------------------------------------------------------------------- */

/**
 * A representative crosswalk: which element of each framework a competency
 * domain maps to. This is a crosswalk of the SAME evidence, never a re-grade
 * (IN-6). Used by the export preview to show the framework tags a de-identified
 * row would carry.
 */
export const FRAMEWORK_DOMAIN_TAG: Record<
  string,
  Record<FeedbackDomainKey, string>
> = {
  acgme: {
    history: "PC1",
    exam: "PC2",
    reasoning: "MK1",
    management: "PC3",
    communication: "ICS1",
    professionalism: "PROF1",
  },
  canmeds: {
    history: "Medical Expert",
    exam: "Medical Expert",
    reasoning: "Medical Expert",
    management: "Medical Expert",
    communication: "Communicator",
    professionalism: "Professional",
  },
  epa: {
    history: "EPA 1",
    exam: "EPA 3",
    reasoning: "EPA 2",
    management: "EPA 10",
    communication: "EPA 6",
    professionalism: "EPA 5",
  },
  lcme: {
    history: "7.4",
    exam: "7.3",
    reasoning: "7.1",
    management: "7.6",
    communication: "7.8",
    professionalism: "3.5",
  },
  tepdad: {
    history: "UÇEP A1",
    exam: "UÇEP A2",
    reasoning: "UÇEP B1",
    management: "UÇEP B2",
    communication: "UÇEP C1",
    professionalism: "UÇEP D1",
  },
};
