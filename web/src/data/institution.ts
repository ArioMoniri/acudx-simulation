/**
 * Institution ("dean's office") dashboard — Journey 8, docs/design/01 §8.1-8.4,
 * requirements IN-1..IN-7.
 *
 * HONESTY CONTRACT (audit P8): real multi-learner cohort aggregation needs a
 * backend that does not exist in this air-gapped, education-only build. So this
 * module ships NO fabricated cohort. Everything shown is DERIVED from the current
 * learner's OWN real, earned encounter history (`src/state/progressStore.ts`
 * `EncounterRecord[]`) and is clearly framed in the UI as a single-user / your-
 * own-data view with honest low-N and empty states. Panels that genuinely need a
 * multi-learner cohort (per-language fairness subgroups, the instructor-driven
 * closed remediation loop) show an explicit "connect an institution data source"
 * state rather than invented numbers.
 *
 * What remains here is structural / catalog only: metric definitions, the six
 * competency domains, the accreditation framework rows + crosswalk, and pure
 * functions that turn real records into the shapes the panels render. The former
 * 184-learner / 3,240-encounter seed arrays, the fabricated calibration topics,
 * and the invented TR/EN fairness numbers have been removed.
 */

import type { Bilingual, Band, FeedbackDomainKey } from "@/data/mock";
import type { EncounterRecord } from "@/state/progressStore";

/* -------------------------------------------------------------------------- */
/* Shared numeric helpers (deterministic)                                     */
/* -------------------------------------------------------------------------- */

const round = (x: number): number => Math.round(x);
const pct = (x: number): number => Math.round(x * 100);

/* -------------------------------------------------------------------------- */
/* The six competency domains, in the fixed dual-axis display order (IN-1)     */
/* -------------------------------------------------------------------------- */

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

/** Which axis a competency domain belongs to (clinical vs communication). */
export function axisOfDomain(
  domain: FeedbackDomainKey,
): "clinical" | "communication" {
  return domain === "communication" || domain === "professionalism"
    ? "communication"
    : "clinical";
}

/* -------------------------------------------------------------------------- */
/* Top KPIs — derived from the learner's own real records                      */
/* -------------------------------------------------------------------------- */

export type KpiTrend = "up" | "down" | "steady";
export type KpiPolarity = "higherBetter" | "lowerBetter" | "neutral";

export interface InstitutionKpi {
  id: string;
  labelKey: string;
  /** Fallback label copy (used via t(labelKey, { defaultValue })). */
  labelDefault: string;
  /** Pre-formatted display value; "—" when there is no data yet. */
  value: string;
  unit?: Bilingual;
  hintKey: string;
  hintDefault: string;
  trend: KpiTrend;
  polarity: KpiPolarity;
  /** Already-worded change, e.g. "-6 pp"; empty when there is nothing to show. */
  delta: string;
}

/**
 * Six honest headline numbers, all computed from the current learner's OWN
 * recorded encounters. With no history every value is an explicit "—" / 0, never
 * a fabricated cohort figure. Only the calibration gap carries a trend (latest
 * vs first recorded encounter), matching how the progress store reasons about
 * movement; the rest stay steady because a per-encounter delta at low N would be
 * noise dressed up as signal.
 */
export function deriveInstitutionKpis(
  records: EncounterRecord[],
): InstitutionKpi[] {
  const n = records.length;
  const first = records[0] ?? null;
  const last = records[n - 1] ?? null;

  const dxCorrect = records.filter((r) => r.diagnosisCorrect).length;
  const safeClean = records.filter((r) => !r.safetyMiss).length;

  // Mean competence across every scored domain instance.
  let compSum = 0;
  let compCount = 0;
  const scoredDomains = new Set<FeedbackDomainKey>();
  for (const r of records) {
    for (const d of r.domainScores) {
      if (!d.scored) continue;
      compSum += d.competence;
      compCount += 1;
      scoredDomains.add(d.key);
    }
  }

  const gapNow = last ? pct(last.overallGap) : null;
  let gapTrend: KpiTrend = "steady";
  let gapDelta = "";
  if (first && last && n > 1) {
    const diff = pct(last.overallGap) - pct(first.overallGap);
    if (diff < 0) {
      gapTrend = "down";
      gapDelta = `${diff} pp`;
    } else if (diff > 0) {
      gapTrend = "up";
      gapDelta = `+${diff} pp`;
    }
  }

  return [
    {
      id: "kpi-recorded",
      labelKey: "institution.kpi.recorded",
      labelDefault: "Encounters recorded",
      value: String(n),
      hintKey: "institution.kpi.recordedHint",
      hintDefault: "In your own local history",
      trend: "steady",
      polarity: "higherBetter",
      delta: "",
    },
    {
      id: "kpi-accuracy",
      labelKey: "institution.kpi.accuracy",
      labelDefault: "Diagnostic accuracy",
      value: n ? `${round((dxCorrect / n) * 100)}%` : "—",
      hintKey: "institution.kpi.accuracyHint",
      hintDefault: "Correct diagnosis committed",
      trend: "steady",
      polarity: "higherBetter",
      delta: "",
    },
    {
      id: "kpi-safety",
      labelKey: "institution.kpi.safetyClean",
      labelDefault: "Safety-clean encounters",
      value: n ? `${round((safeClean / n) * 100)}%` : "—",
      hintKey: "institution.kpi.safetyCleanHint",
      hintDefault: "No safety-critical miss",
      trend: "steady",
      polarity: "higherBetter",
      delta: "",
    },
    {
      id: "kpi-calibration",
      labelKey: "institution.kpi.calibrationGap",
      labelDefault: "Calibration gap",
      value: gapNow == null ? "—" : String(gapNow),
      unit: gapNow == null ? undefined : { en: "pp", tr: "yp" },
      hintKey: "institution.kpi.calibrationGapOwnHint",
      hintDefault: "Latest confidence minus performance",
      trend: gapTrend,
      polarity: "lowerBetter",
      delta: gapDelta,
    },
    {
      id: "kpi-competence",
      labelKey: "institution.kpi.meanCompetence",
      labelDefault: "Mean competence",
      value: compCount ? `${round((compSum / compCount) * 100)}%` : "—",
      hintKey: "institution.kpi.meanCompetenceHint",
      hintDefault: "Across scored domains",
      trend: "steady",
      polarity: "higherBetter",
      delta: "",
    },
    {
      id: "kpi-coverage",
      labelKey: "institution.kpi.coverage",
      labelDefault: "Domains scored",
      value: `${scoredDomains.size} / ${HEATMAP_DOMAINS.length}`,
      hintKey: "institution.kpi.coverageHint",
      hintDefault: "Distinct domains with evidence",
      trend: "steady",
      polarity: "higherBetter",
      delta: "",
    },
  ];
}

/* -------------------------------------------------------------------------- */
/* Competency heatmap — the learner's OWN encounters x 6 domains (IN-1)        */
/* -------------------------------------------------------------------------- */

/** Direction of a calibration point relative to the identity line. */
export type CalibrationDirection = "over" | "under" | "well";

function directionFor(gapPp: number): CalibrationDirection {
  if (gapPp > 10) return "over";
  if (gapPp < -10) return "under";
  return "well";
}

/** One domain's real readout inside a single encounter. */
export interface DomainReadout {
  band: Band;
  scored: boolean;
  /** Measured competence, 0..1. */
  competence: number;
  /** Behavioural decisiveness proxy, 0..1. */
  confidence: number;
  /** Signed confidence-minus-competence gap in pp; null when unscored. */
  gapPp: number | null;
  direction: CalibrationDirection | null;
}

/** One heatmap row: a single recorded encounter across the six domains. */
export interface EncounterRow {
  id: string;
  /** De-identified per-encounter handle (masked), never a name. */
  handle: string;
  /** The case chief complaint (bilingual), shown as the row title. */
  title: Bilingual;
  /** Epoch ms the encounter was recorded. */
  at: number;
  readouts: Record<FeedbackDomainKey, DomainReadout>;
  diagnosisCorrect: boolean;
  safetyMiss: boolean;
}

function readoutFor(
  record: EncounterRecord,
  domain: FeedbackDomainKey,
): DomainReadout {
  const ds = record.domainScores.find((d) => d.key === domain);
  if (!ds || !ds.scored) {
    return {
      band: "withheld",
      scored: false,
      competence: 0,
      confidence: 0,
      gapPp: null,
      direction: null,
    };
  }
  const gapPp = pct(ds.confidence - ds.competence);
  return {
    band: ds.band,
    scored: true,
    competence: ds.competence,
    confidence: ds.confidence,
    gapPp,
    direction: directionFor(gapPp),
  };
}

/**
 * Turn the learner's real records into heatmap rows (newest first). Each row is
 * one genuine recorded encounter; a domain with too little evidence is
 * "withheld", never a guessed band — the reliability gate carried straight
 * through from the progress store.
 */
export function deriveEncounterRows(
  records: EncounterRecord[],
): EncounterRow[] {
  return records
    .map((r, i) => {
      const readouts = {} as Record<FeedbackDomainKey, DomainReadout>;
      for (const d of HEATMAP_DOMAINS) readouts[d.key] = readoutFor(r, d.key);
      return {
        id: r.id,
        handle: `ENC-${String(i + 1).padStart(2, "0")}`,
        title: r.title,
        at: r.at,
        readouts,
        diagnosisCorrect: r.diagnosisCorrect,
        safetyMiss: r.safetyMiss,
      };
    })
    .reverse();
}

/* -------------------------------------------------------------------------- */
/* Aggregate calibration — per DOMAIN, from the learner's own records (IN-4)    */
/* -------------------------------------------------------------------------- */

export interface DomainCalibration {
  domain: FeedbackDomainKey;
  axis: "clinical" | "communication";
  direction: CalibrationDirection;
  /** Signed mean gap in pp (mean confidence minus mean competence). */
  gapPct: number;
  /** Scored instances contributing to this aggregate. */
  count: number;
  meanCompetence: number;
  meanConfidence: number;
}

/**
 * Aggregate the learner's own confidence-vs-competence gap per competency
 * domain. This is the honest, single-user analogue of the cohort calibration
 * diagnostic: a domain only appears once it has scored evidence, so there are no
 * invented topics and no fabricated learner counts.
 */
export function deriveCalibrationByDomain(
  records: EncounterRecord[],
): DomainCalibration[] {
  const out: DomainCalibration[] = [];
  for (const { key, axis } of HEATMAP_DOMAINS) {
    let comp = 0;
    let conf = 0;
    let count = 0;
    for (const r of records) {
      const d = r.domainScores.find((x) => x.key === key);
      if (!d || !d.scored) continue;
      comp += d.competence;
      conf += d.confidence;
      count += 1;
    }
    if (count === 0) continue;
    const meanCompetence = comp / count;
    const meanConfidence = conf / count;
    const gapPct = pct(meanConfidence - meanCompetence);
    out.push({
      domain: key,
      axis,
      direction: directionFor(gapPct),
      gapPct,
      count,
      meanCompetence,
      meanConfidence,
    });
  }
  // Most-actionable (largest overconfidence) first.
  return out.sort((a, b) => b.gapPct - a.gapPct);
}

/* -------------------------------------------------------------------------- */
/* Remediation signals — real detected gaps from the learner's own data (IN-2) */
/* -------------------------------------------------------------------------- */

/**
 * The five stages of the closed remediation loop, kept as a catalog so the
 * honest "single-user view" note can name what an instructor-driven data source
 * would add (prescribe -> re-assess -> document).
 */
export const REMEDIATION_STAGES = [
  "detect",
  "diagnose",
  "prescribe",
  "reassess",
  "document",
] as const;

export type RemediationStage = (typeof REMEDIATION_STAGES)[number];

export type RemediationSignalKind =
  | "safety"
  | "diagnosis"
  | "timing"
  | "lowValue";

export interface RemediationSignal {
  id: string;
  kind: RemediationSignalKind;
  domain: FeedbackDomainKey;
  detail: Bilingual;
  /** Encounters (or actions) in which this gap recurred. */
  recurrence: number;
}

const SIGNAL_SAFETY: Bilingual = {
  en: "Safety-critical step missed (timing or allergy check)",
  tr: "Güvenlik açısından kritik adım atlandı (zamanlama veya alerji kontrolü)",
};
const SIGNAL_DIAGNOSIS: Bilingual = {
  en: "Correct diagnosis not reached on the available evidence",
  tr: "Mevcut kanıtlarla doğru tanıya ulaşılamadı",
};
const SIGNAL_LOWVALUE: Bilingual = {
  en: "Low-value orders placed that do not change management",
  tr: "Yönetimi değiştirmeyen düşük değerli istemler yapıldı",
};

/**
 * Detect real, recurring gaps across the learner's own recorded encounters.
 * These are the honest "detect" evidence for a remediation loop; the later
 * loop stages (prescribe, re-assess, document) are an instructor workflow the
 * UI flags as needing a connected data source. Empty when there is nothing to
 * remediate.
 */
export function deriveRemediationSignals(
  records: EncounterRecord[],
): RemediationSignal[] {
  const signals: RemediationSignal[] = [];

  const safetyCount = records.filter((r) => r.safetyMiss).length;
  if (safetyCount > 0) {
    signals.push({
      id: "sig-safety",
      kind: "safety",
      domain: "management",
      detail: SIGNAL_SAFETY,
      recurrence: safetyCount,
    });
  }

  const dxMissCount = records.filter((r) => !r.diagnosisCorrect).length;
  if (dxMissCount > 0) {
    signals.push({
      id: "sig-diagnosis",
      kind: "diagnosis",
      domain: "reasoning",
      detail: SIGNAL_DIAGNOSIS,
      recurrence: dxMissCount,
    });
  }

  // Late / missed critical actions, aggregated by their guideline label.
  const timing = new Map<string, { labelEn: string; labelTr: string; count: number }>();
  for (const r of records) {
    for (const a of r.metrics?.timeToCriticalAction ?? []) {
      if (a.status === "onTime") continue;
      const cur = timing.get(a.expectationId) ?? {
        labelEn: a.labelEn,
        labelTr: a.labelTr,
        count: 0,
      };
      cur.count += 1;
      timing.set(a.expectationId, cur);
    }
  }
  for (const [id, v] of timing) {
    signals.push({
      id: `sig-timing-${id}`,
      kind: "timing",
      domain: "reasoning",
      detail: {
        en: `${v.labelEn} ordered late or not at all`,
        tr: `${v.labelTr} geç istendi veya hiç istenmedi`,
      },
      recurrence: v.count,
    });
  }

  const lowValueCount = records.filter(
    (r) => (r.metrics?.orderAppropriateness?.lowValue ?? 0) > 0,
  ).length;
  if (lowValueCount > 0) {
    signals.push({
      id: "sig-lowvalue",
      kind: "lowValue",
      domain: "reasoning",
      detail: SIGNAL_LOWVALUE,
      recurrence: lowValueCount,
    });
  }

  return signals.sort((a, b) => b.recurrence - a.recurrence);
}

/* -------------------------------------------------------------------------- */
/* Accreditation frameworks (IN-3 / IN-6) — catalog + crosswalk                */
/* -------------------------------------------------------------------------- */

export interface AccreditationFramework {
  id: string;
  /** Short label shown on the export chip, e.g. "ACGME". */
  label: string;
  name: Bilingual;
  /** How many of this framework's elements the crosswalk covers. */
  mappedElements: number;
  totalElements: number;
  /** The crosswalk version stamped into the export. */
  crosswalkVersion: string;
}

/**
 * A representative crosswalk: which element of each framework a competency
 * domain maps to. Crosswalk of the SAME evidence, never a re-grade (IN-6).
 *
 * This is the single source of truth for crosswalk COVERAGE: the framework
 * catalog below derives its `mappedElements` count straight from this map, so
 * the "measured coverage" numerator shown in the UI can never drift from the
 * real crosswalk.
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

/**
 * Count the DISTINCT framework elements the crosswalk covers for a framework,
 * derived from {@link FRAMEWORK_DOMAIN_TAG}. Distinct because several competency
 * domains can map onto the same element (e.g. CanMEDS "Medical Expert" covers
 * four domains but is one element). Empty tags never count.
 */
export function mappedElementCount(frameworkId: string): number {
  const tags = FRAMEWORK_DOMAIN_TAG[frameworkId];
  if (!tags) return 0;
  return new Set(Object.values(tags).filter((v) => v.trim() !== "")).size;
}

/** Catalog metadata for a framework, minus the derived coverage numerator. */
type FrameworkCatalogEntry = Omit<AccreditationFramework, "mappedElements">;

/**
 * The frameworks the export can tag to (IN-3 / IN-6). A crosswalk of the SAME
 * evidence onto LCME / ACGME / CanMEDS 2025 / AAMC Core EPAs / TEPDAD-UÇEP,
 * never a re-grade. `totalElements` is static catalog metadata — the framework's
 * own full element count, external to AcuDx, not a per-learner measurement.
 */
const FRAMEWORK_CATALOG: FrameworkCatalogEntry[] = [
  {
    id: "acgme",
    label: "ACGME",
    name: {
      en: "ACGME Milestones (6 core competencies)",
      tr: "ACGME Milestones (6 temel yetkinlik)",
    },
    totalElements: 6,
    crosswalkVersion: "v2025.1",
  },
  {
    id: "canmeds",
    label: "CanMEDS",
    name: {
      en: "CanMEDS 2025 (7 physician roles)",
      tr: "CanMEDS 2025 (7 hekim rolü)",
    },
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
    totalElements: 21,
    crosswalkVersion: "v2024.1",
  },
];

/**
 * The framework rows shown in the export builder. `mappedElements` is DERIVED
 * from {@link FRAMEWORK_DOMAIN_TAG} (distinct crosswalk elements) so it stays in
 * lock-step with the real crosswalk and can never be a stale hardcoded value.
 */
export const accreditationFrameworks: AccreditationFramework[] =
  FRAMEWORK_CATALOG.map((f) => ({
    ...f,
    mappedElements: mappedElementCount(f.id),
  }));

/** Options for the export scope selector. */
export interface ExportScopeOption {
  id: string;
  labelKey: string;
  /** Fallback label (used via t(labelKey, { defaultValue })). */
  labelDefault: string;
  /** Preselected in the builder. */
  selected: boolean;
}

export const exportScopeOptions: ExportScopeOption[] = [
  {
    id: "own",
    labelKey: "institution.export.scope.own",
    labelDefault: "Your recorded encounters",
    selected: true,
  },
  {
    id: "window",
    labelKey: "institution.export.scope.window",
    labelDefault: "This assessment window",
    selected: true,
  },
  {
    id: "deidentified",
    labelKey: "institution.export.scope.deidentified",
    labelDefault: "De-identified",
    selected: true,
  },
  {
    id: "fairness",
    labelKey: "institution.export.scope.fairness",
    labelDefault: "Include fairness audit",
    selected: false,
  },
];

/* -------------------------------------------------------------------------- */
/* Accreditation export builder (IN-3) — real, de-identified, downloadable     */
/* -------------------------------------------------------------------------- */

export interface ExportBuildOptions {
  frameworkIds: string[];
  scopeIds: string[];
  deidentified: boolean;
  fairnessIncluded: boolean;
}

/** The assembled export payload: real serialized JSON + CSV plus a row count. */
export interface ExportResult {
  /** Suggested filename stem (no extension). */
  filenameBase: string;
  json: string;
  csv: string;
  /** De-identified encounter rows in the export (0 for an honest empty export). */
  rowCount: number;
}

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The "assessment window" scope id — time-scopes the export to a recent block. */
export const WINDOW_SCOPE_ID = "window";

/**
 * Length of "this assessment window" in days. The window is a recent block of
 * practice — a rotation / OSCE block analogue — so the export can be scoped to
 * it rather than the learner's entire history.
 */
export const ASSESSMENT_WINDOW_DAYS = 30;

/**
 * The assessment-window `[start, end]` epoch-ms range for a record set. It is
 * anchored to the NEWEST recorded encounter (not wall-clock "now"), so a fixed
 * record set always yields the same window: `end` = the latest encounter,
 * `start` = end − {@link ASSESSMENT_WINDOW_DAYS}. Returns null when there are no
 * records (nothing to window).
 */
export function assessmentWindowRange(
  records: EncounterRecord[],
): { start: number; end: number } | null {
  if (records.length === 0) return null;
  let end = records[0].at;
  for (const r of records) if (r.at > end) end = r.at;
  const start = end - ASSESSMENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return { start, end };
}

/**
 * Apply the "assessment window" scope: when the `window` toggle is active, keep
 * only the encounters that fall inside {@link assessmentWindowRange}; otherwise
 * pass records through untouched. This is what makes the window toggle real —
 * the filtered set flows into every downstream derivation, so `rowCount`, the
 * rows, and the calibration all actually change when it is on.
 */
export function applyExportScope(
  records: EncounterRecord[],
  scopeIds: string[],
): EncounterRecord[] {
  if (!scopeIds.includes(WINDOW_SCOPE_ID)) return records;
  const range = assessmentWindowRange(records);
  if (!range) return records;
  return records.filter((r) => r.at >= range.start && r.at <= range.end);
}

/**
 * Build a genuine, de-identified, framework-tagged export from the learner's
 * OWN real records. Serializes to both JSON (structured) and CSV (one tidy row
 * per encounter x scored domain). Calibration is derived from the same real
 * data; the fairness section, when requested, is an honest "insufficient data"
 * note because a single local learner has no language subgroups to compare.
 *
 * When the "assessment window" scope is active the records are time-scoped to
 * the recent window BEFORE any derivation, so the row count genuinely reflects
 * the window (not the whole history). The "own" scope is definitional here —
 * the export is always single-user own-data, there is no other source to add.
 *
 * Pure and deterministic apart from the `generatedAt` stamp on the export
 * envelope (expected metadata for an export artifact).
 */
export function buildAccreditationExport(
  records: EncounterRecord[],
  options: ExportBuildOptions,
): ExportResult {
  const frameworks = accreditationFrameworks.filter((f) =>
    options.frameworkIds.includes(f.id),
  );
  // Time-scope the records first, so rows + calibration reflect the window.
  const scopedRecords = applyExportScope(records, options.scopeIds);
  const windowActive = options.scopeIds.includes(WINDOW_SCOPE_ID);
  const windowRange = windowActive ? assessmentWindowRange(records) : null;
  const rows = deriveEncounterRows(scopedRecords);
  const calibration = deriveCalibrationByDomain(scopedRecords);

  const meta = {
    product: "AcuDx",
    kind: "accreditation-export",
    provenance:
      "Single-user local view. Derived from this device's own recorded encounters; not a multi-learner cohort.",
    generatedAt: new Date().toISOString(),
    deidentified: options.deidentified,
    scopes: options.scopeIds,
    // The applied assessment window, when the window scope is on (else null).
    window: windowRange
      ? {
          days: ASSESSMENT_WINDOW_DAYS,
          start: new Date(windowRange.start).toISOString(),
          end: new Date(windowRange.end).toISOString(),
        }
      : null,
    frameworks: frameworks.map((f) => ({
      id: f.id,
      label: f.label,
      crosswalkVersion: f.crosswalkVersion,
      mappedElements: f.mappedElements,
      totalElements: f.totalElements,
    })),
    encounterCount: rows.length,
  };

  const jsonRows = rows.map((row) => ({
    handle: row.handle,
    recordedAt: new Date(row.at).toISOString(),
    // Case template id is not personal; the chief complaint is only included
    // when the operator has explicitly turned de-identification off.
    ...(options.deidentified ? {} : { caseTitle: row.title.en }),
    diagnosisCorrect: row.diagnosisCorrect,
    safetyMiss: row.safetyMiss,
    domains: HEATMAP_DOMAINS.map((d) => {
      const r = row.readouts[d.key];
      return {
        domain: d.key,
        scored: r.scored,
        band: r.band,
        competencePct: r.scored ? pct(r.competence) : null,
        confidencePct: r.scored ? pct(r.confidence) : null,
        frameworkTags: Object.fromEntries(
          frameworks.map((f) => [f.id, FRAMEWORK_DOMAIN_TAG[f.id]?.[d.key] ?? ""]),
        ),
      };
    }),
  }));

  const calibrationSummary = calibration.map((c) => ({
    domain: c.domain,
    direction: c.direction,
    gapPct: c.gapPct,
    scoredInstances: c.count,
    meanCompetencePct: pct(c.meanCompetence),
    meanConfidencePct: pct(c.meanConfidence),
  }));

  const fairness = options.fairnessIncluded
    ? {
        status: "insufficient_data",
        note:
          "Language-subgroup fairness (TR vs EN) needs a multi-learner cohort from a connected institution data source. A single local learner provides no subgroup to compare, so no fairness metric is asserted.",
      }
    : undefined;

  const payload = {
    meta,
    records: jsonRows,
    calibration: calibrationSummary,
    ...(fairness ? { fairness } : {}),
    ...(rows.length === 0
      ? {
          note:
            "No encounters recorded yet. This is an honest empty export: complete an encounter and the framework-tagged rows will populate.",
        }
      : {}),
  };

  const json = JSON.stringify(payload, null, 2);

  // CSV: one tidy row per (encounter, domain), with a framework-tag column per
  // selected framework.
  const header = [
    "handle",
    "recordedAt",
    ...(options.deidentified ? [] : ["caseTitle"]),
    "domain",
    "band",
    "scored",
    "competencePct",
    "confidencePct",
    "diagnosisCorrect",
    "safetyMiss",
    ...frameworks.map((f) => `tag_${f.id}`),
  ];
  const csvLines: string[] = [header.map(csvCell).join(",")];
  for (const row of rows) {
    for (const d of HEATMAP_DOMAINS) {
      const r = row.readouts[d.key];
      const cells: (string | number)[] = [
        row.handle,
        new Date(row.at).toISOString(),
        ...(options.deidentified ? [] : [row.title.en]),
        d.key,
        r.band,
        r.scored ? "true" : "false",
        r.scored ? pct(r.competence) : "",
        r.scored ? pct(r.confidence) : "",
        row.diagnosisCorrect ? "true" : "false",
        row.safetyMiss ? "true" : "false",
        ...frameworks.map((f) => FRAMEWORK_DOMAIN_TAG[f.id]?.[d.key] ?? ""),
      ];
      csvLines.push(cells.map(csvCell).join(","));
    }
  }
  const csv = csvLines.join("\n");

  return {
    filenameBase: "acudx-accreditation-export",
    json,
    csv,
    rowCount: rows.length,
  };
}
