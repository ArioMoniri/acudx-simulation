/**
 * AcuDx — liveCaseGen: the wire spec of a case generated on request by the model
 * (server/orchestration/staged.py, `GeneratedCaseSpec` shape) and its adapter to the
 * client CaseInstance model.
 *
 * `specToCaseInstance` maps the wire spec to a fully-valid `CaseInstance` reusing
 * the fhir.ts / caseGen.ts helpers (concept, curated codings, validateCase). Items of a
 * staged case carry a stable `uid` (for example `history.presenting.1`), so a datum keeps
 * its id when later layers of the same thread are merged into a running encounter.
 *
 * The retired v1 case client (template overlay, on-device fallback) is gone:
 * every learner case comes from `POST /v2/case/generate/stream` (src/lib/caseSession.ts).
 *
 * Education only. Synthetic patients. No real patient data path.
 */

import type { Bilingual, Lang } from "@/data/schema";
import {
  concept,
  CODE_SYSTEMS,
  DSM5TR,
  ICD10,
  LOINC,
  type AdministrativeGender,
  type AllergyIntolerance,
  type Coding,
  type Condition,
  type DiagnosticReport,
  type Encounter,
  type Observation,
  type ObservationCategory,
  type ObservationInterpretation,
  type Patient,
} from "@/domain/fhir";
import { validateCase } from "@/domain/caseGen";
import { hashSeed, pickProfileForCase } from "@/domain/patientProfiles";
import { catalogCodeFor } from "@/domain/orderables";
import type {
  CaseInstance,
  Disposition,
  ExamFinding,
  ExamManeuver,
  HistoryItem,
  ImagingResult,
  LabResult,
  OrderExpectation,
  QuestionIntent,
  TreatmentResponse,
  TriageVitals,
  VitalsTrajectoryPoint,
} from "@/domain/case";
import type { VitalEffect, VitalKey } from "@/domain/treatments";
import { courseBindingFromSpec, type CourseSpecLike } from "@/domain/clinicalCourse";

/* -------------------------------------------------------------------------- */
/* Wire shape — GeneratedCaseSpec (server staged v2 spec)                   */
/* -------------------------------------------------------------------------- */

export interface SpecCondition {
  icd11?: string;
  icd10?: string;
  dsm5tr?: string;
  label_en: string;
  label_tr: string;
  /** Which coded system is the primary one (drives facet ordering). */
  system?: string;
}

export interface SpecDemographics {
  age?: number;
  sex?: string;
  name_hint?: string;
  /** Optional; the results engine uses it for volume kinetics. */
  weight_kg?: number;
}

export interface SpecHpi {
  /** Stable id of an item of a staged case (kept across layer merges). */
  uid?: string;
  intent: string;
  answer_en: string;
  answer_tr: string;
  red_flag?: boolean;
  /** Finer topic inside the intent ("rigors", "travel"; acceptance D-12). */
  topic?: string;
}

export interface SpecExam {
  uid?: string;
  maneuver: string;
  system_en: string;
  system_tr: string;
  finding_en: string;
  finding_tr: string;
  abnormal?: boolean;
}

export interface SpecVitals {
  hr: number;
  systolic: number;
  diastolic: number;
  rr: number;
  spo2: number;
  tempC: number;
}

export interface SpecTrajectoryPoint extends SpecVitals {
  atMs: number;
}

export interface SpecLab {
  uid?: string;
  code: string;
  label_en: string;
  label_tr: string;
  value: number | string;
  unit: string;
  ref_low?: number | null;
  ref_high?: number | null;
  flag?: string;
  category?: string;
  /** Qualitative result word (dipstick, xanthochromia) — review 02 finding 39. */
  qualitative?: string | null;
  /** Hours since ingestion for nomogram-interpreted levels — review 02 finding 38. */
  hours_post_ingestion?: number | null;
}

/** A structured red flag: who can know it (review 02 finding 3). */
export interface SpecRedFlag {
  en: string;
  tr: string;
  channel?: "patient" | "clinician" | string;
}

export interface SpecImaging {
  uid?: string;
  code: string;
  modality_en: string;
  modality_tr: string;
  findings_en: string;
  findings_tr: string;
  image_query_en?: string;
  image_query_tr?: string;
}

export interface SpecTreatmentEffect {
  key: string;
  delta: number;
  onsetMs: number;
}

export interface SpecTreatment {
  code: string;
  label_en: string;
  label_tr: string;
  appropriateness?: string;
  effects?: SpecTreatmentEffect[];
  narrative_en?: string;
  narrative_tr?: string;
}

export interface SpecGuidelineAnchor {
  statement_en?: string;
  statement_tr?: string;
  source?: string;
  citation?: string;
  /** Verified GuidelineStatement id (acceptance D-11). */
  statement_id?: string;
  /** Order codes the statement supports (cultures, films, imaging). */
  codes?: string[];
}

export interface SpecMeta {
  /** Catalogue condition id (the Director's course rule key). */
  condition_id?: string;
  source?: string;
  model?: string;
  latency_ms?: number;
  degraded?: boolean;
}

/** Generator spec meta. Fields are optional-tolerant on the client. */
export interface GeneratedCaseSpec {
  seed?: number | string;
  locale?: string;
  condition: SpecCondition;
  demographics?: SpecDemographics;
  chief_complaint_en?: string;
  chief_complaint_tr?: string;
  acuity_esi?: number;
  difficulty?: number;
  hpi?: SpecHpi[];
  pmh_en?: string | string[];
  pmh_tr?: string | string[];
  meds_en?: string | string[];
  meds_tr?: string | string[];
  allergies_en?: string | string[];
  allergies_tr?: string | string[];
  exam?: SpecExam[];
  triage_vitals?: SpecVitals;
  vitals_trajectory?: SpecTrajectoryPoint[];
  labs?: SpecLab[];
  imaging?: SpecImaging[];
  treatments?: SpecTreatment[];
  disposition?: string;
  guideline_anchors?: SpecGuidelineAnchor[];
  red_flags?: SpecRedFlag[];
  meta?: SpecMeta;
}

/* -------------------------------------------------------------------------- */
/* Controlled vocabularies (coerce untrusted wire strings to unions)          */
/* -------------------------------------------------------------------------- */

const QUESTION_INTENTS: readonly QuestionIntent[] = [
  "onset",
  "location",
  "character",
  "radiation",
  "severity",
  "timing",
  "aggravating",
  "relieving",
  "associated-symptoms",
  "red-flags",
  "past-medical-history",
  "medications",
  "allergies",
  "family-history",
  "social-history",
  "risk-factors",
  "ice",
];

const EXAM_MANEUVERS: readonly ExamManeuver[] = [
  "general-inspection",
  "vitals-recheck",
  "cardiovascular",
  "respiratory",
  "abdominal",
  "neurological",
  "musculoskeletal",
  "skin",
  "ent",
  "focused-special",
];

const DISPOSITIONS: readonly Disposition[] = [
  "admit-ccu",
  "admit-ward",
  "admit-icu",
  "operating-room",
  "observation",
  "discharge",
  "refer-specialty",
];

const VITAL_KEYS: readonly VitalKey[] = [
  "hr",
  "systolic",
  "diastolic",
  "rr",
  "spo2",
  "tempC",
];

const OBS_CATEGORIES: readonly ObservationCategory[] = [
  "vital-signs",
  "exam",
  "laboratory",
  "imaging",
];

const MIN = 60_000;

function asIntent(v: string): QuestionIntent {
  return (QUESTION_INTENTS as readonly string[]).includes(v)
    ? (v as QuestionIntent)
    : "associated-symptoms";
}

function asManeuver(v: string): ExamManeuver {
  return (EXAM_MANEUVERS as readonly string[]).includes(v)
    ? (v as ExamManeuver)
    : "general-inspection";
}

function asDisposition(v: string | undefined): Disposition {
  return v && (DISPOSITIONS as readonly string[]).includes(v)
    ? (v as Disposition)
    : "observation";
}

function asVitalKey(v: string): VitalKey | null {
  return (VITAL_KEYS as readonly string[]).includes(v) ? (v as VitalKey) : null;
}

function asObsCategory(v: string | undefined): ObservationCategory {
  return v && (OBS_CATEGORIES as readonly string[]).includes(v)
    ? (v as ObservationCategory)
    : "laboratory";
}

function asLang(v: string | undefined): Lang {
  return v === "tr" ? "tr" : "en";
}

function asDifficulty(v: number | undefined): CaseInstance["difficulty"] {
  const n = Math.round(Number.isFinite(v) ? (v as number) : 3);
  return Math.min(5, Math.max(1, n)) as CaseInstance["difficulty"];
}

function asAcuity(v: number | undefined): CaseInstance["acuityESI"] {
  const n = Math.round(Number.isFinite(v) ? (v as number) : 3);
  return Math.min(5, Math.max(1, n)) as CaseInstance["acuityESI"];
}

function asGender(sex: string | undefined): AdministrativeGender {
  if (sex === "male" || sex === "female" || sex === "other" || sex === "unknown") {
    return sex;
  }
  return "unknown";
}

function asAppropriateness(v: string | undefined): TreatmentResponse["appropriateness"] {
  return v === "indicated" || v === "contraindicated" || v === "neutral"
    ? v
    : "neutral";
}

function asInterpretation(flag: string | undefined): ObservationInterpretation | undefined {
  if (!flag) return undefined;
  const f = flag.trim().toUpperCase();
  const direct: readonly ObservationInterpretation[] = ["N", "L", "H", "LL", "HH", "A"];
  if ((direct as readonly string[]).includes(f)) return f as ObservationInterpretation;
  switch (f) {
    case "NORMAL":
      return "N";
    case "LOW":
      return "L";
    case "HIGH":
      return "H";
    case "CRITICAL LOW":
    case "CRITICAL-LOW":
    case "CRIT LOW":
      return "LL";
    case "CRITICAL HIGH":
    case "CRITICAL-HIGH":
    case "CRIT HIGH":
      return "HH";
    case "ABNORMAL":
      return "A";
    default:
      return "A";
  }
}

/* -------------------------------------------------------------------------- */
/* Small pure helpers                                                          */
/* -------------------------------------------------------------------------- */

/** Build a bilingual value, filling each side from the other when one is empty. */
function bi(en: string | undefined, tr: string | undefined): Bilingual {
  const e = (en ?? "").trim();
  const t = (tr ?? "").trim();
  return { en: e || t, tr: t || e };
}

/** Coerce a string | string[] wire field to a single joined string. */
function textOf(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v.filter((s) => s && s.trim()).join("; ");
  return (v ?? "").trim();
}

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.round(clamp(v, lo, hi));
}

function safeNumber(v: number, fallback = 0): number {
  return Number.isFinite(v) ? v : fallback;
}

function refRange(low: number | undefined, high: number | undefined): string | undefined {
  const hasLow = typeof low === "number" && Number.isFinite(low);
  const hasHigh = typeof high === "number" && Number.isFinite(high);
  if (hasLow && hasHigh) return `${low} - ${high}`;
  if (hasHigh) return `< ${high}`;
  if (hasLow) return `> ${low}`;
  return undefined;
}

/** Rough, deterministic body weight for dosing checks (no clock read). */
function estWeight(age: number, seed: number): number {
  if (age < 1) return 8;
  if (age < 12) return Math.round(clamp(age * 3 + 7, 6, 45));
  return 58 + (hashSeed(`w:${seed}`) % 36); // 58..93 kg
}

/* -------------------------------------------------------------------------- */
/* Diagnosis codings + differentials (from the curated fhir.ts vocabularies)  */
/* -------------------------------------------------------------------------- */

const SYSTEM_KEY: Record<string, string> = {
  icd10: CODE_SYSTEMS.icd10,
  icd11: CODE_SYSTEMS.icd11,
  dsm5tr: CODE_SYSTEMS.dsm5tr,
};

/**
 * Build the diagnosis coding list, ordered so the primary system leads (the
 * library facets — specialtyOf / complaintFamilyOf / codeChipOf — read coding[0]).
 */
function diagnosisCodings(cond: SpecCondition): Coding[] {
  const display = (cond.label_en || cond.label_tr || "Diagnosis").trim();
  const entries: Array<{ key: string; system: string; code?: string }> = [
    { key: "icd10", system: CODE_SYSTEMS.icd10, code: cond.icd10 },
    { key: "icd11", system: CODE_SYSTEMS.icd11, code: cond.icd11 },
    { key: "dsm5tr", system: CODE_SYSTEMS.dsm5tr, code: cond.dsm5tr },
  ];
  const present = entries
    .filter((e) => e.code && e.code.trim().length > 0)
    .map((e) => ({ key: e.key, system: e.system, code: (e.code as string).trim() }));

  const primaryKey =
    cond.system && SYSTEM_KEY[cond.system] ? cond.system : "icd10";
  present.sort((a, b) => (a.key === primaryKey ? -1 : b.key === primaryKey ? 1 : 0));

  if (present.length === 0) {
    // Gap-fill: a valid but unspecified ICD-10 coding so facets still resolve.
    return [{ system: CODE_SYSTEMS.icd10, code: "R69", display }];
  }
  return present.map((e) => ({ system: e.system, code: e.code, display }));
}

/** Chief-complaint family hint (for the avatar profile + differential pool). */
function complaintHint(codings: Coding[]): string {
  const primary = codings[0];
  const code = primary?.code ?? "";
  const system = primary?.system ?? "";
  if (system === CODE_SYSTEMS.dsm5tr) return "psychiatric";
  if (code.startsWith("I21") || code.startsWith("I20") || code === "300.01") {
    return "chest-pain";
  }
  if (code.startsWith("I60") || code.startsWith("G4")) return "headache";
  // Acceptance 2026-10-20 D-25: a malaria case was offered "Gastroenteritis,
  // GERD" as differentials; febrile infections get a febrile pool.
  if (/^(A[0-9]|B[0-9]|G0[0-4]|N10|N39|N41|N7[0-3]|L03|M00|K83|D70|U07|J09|J1[0-1]|R50)/.test(code)) return "fever";
  if (code.startsWith("K3") || code.startsWith("K5") || code.startsWith("I88")) {
    return "abdominal-pain";
  }
  if (code.startsWith("I26") || code.startsWith("J")) return "dyspnea";
  return "";
}

interface DiffEntry {
  code: Coding;
  label: Bilingual;
}

/** Reasonable differentials by presentation family, from the same code systems. */
const DIFF_POOL: Record<string, DiffEntry[]> = {
  "chest-pain": [
    { code: ICD10.unstableAngina, label: { en: "Unstable angina", tr: "Kararsız angina" } },
    { code: ICD10.gerd, label: { en: "GERD", tr: "Gastroözofageal reflü" } },
    { code: ICD10.costochondritis, label: { en: "Costochondritis", tr: "Kostokondrit" } },
    { code: ICD10.acsNstemi, label: { en: "Acute coronary syndrome", tr: "Akut koroner sendrom" } },
  ],
  headache: [
    { code: ICD10.migraine, label: { en: "Migraine", tr: "Migren" } },
    { code: ICD10.tensionHeadache, label: { en: "Tension-type headache", tr: "Gerilim tipi baş ağrısı" } },
    { code: ICD10.sah, label: { en: "Subarachnoid hemorrhage", tr: "Subaraknoid kanama" } },
  ],
  "abdominal-pain": [
    { code: ICD10.gastroenteritis, label: { en: "Gastroenteritis", tr: "Gastroenterit" } },
    { code: ICD10.mesentericAdenitis, label: { en: "Mesenteric adenitis", tr: "Mezenterik adenit" } },
    { code: ICD10.appendicitis, label: { en: "Acute appendicitis", tr: "Akut apandisit" } },
  ],
  dyspnea: [
    { code: ICD10.chf, label: { en: "Heart failure", tr: "Kalp yetmezliği" } },
    { code: ICD10.pneumonia, label: { en: "Pneumonia", tr: "Pnömoni" } },
    { code: ICD10.pulmonaryEmbolism, label: { en: "Pulmonary embolism", tr: "Pulmoner emboli" } },
  ],
  psychiatric: [
    { code: DSM5TR.gad, label: { en: "Generalized anxiety disorder", tr: "Yaygın anksiyete bozukluğu" } },
    { code: DSM5TR.somaticSymptom, label: { en: "Somatic symptom disorder", tr: "Somatik belirti bozukluğu" } },
    { code: ICD10.acsNstemi, label: { en: "Acute coronary syndrome (rule out)", tr: "Akut koroner sendrom (dışla)" } },
  ],
};

const icd = (code: string, display: string): Coding => ({ system: CODE_SYSTEMS.icd10, code, display });
DIFF_POOL.fever = [
  { code: icd("A41.9", "Sepsis, unspecified organism"), label: { en: "Sepsis (source to be found)", tr: "Sepsis (kaynak aranacak)" } },
  { code: icd("N10", "Acute pyelonephritis"), label: { en: "Acute pyelonephritis", tr: "Akut piyelonefrit" } },
  { code: icd("J18.9", "Pneumonia, unspecified organism"), label: { en: "Pneumonia", tr: "Pnömoni" } },
  { code: icd("B54", "Unspecified malaria"), label: { en: "Malaria (after travel)", tr: "Sıtma (seyahat sonrası)" } },
  { code: icd("J11.1", "Influenza with other respiratory manifestations"), label: { en: "Viral illness (influenza)", tr: "Viral hastalık (influenza)" } },
  { code: icd("G00.9", "Bacterial meningitis, unspecified"), label: { en: "Bacterial meningitis", tr: "Bakteriyel menenjit" } },
];

const GENERIC_DIFF: DiffEntry[] = [
  { code: ICD10.gerd, label: { en: "GERD", tr: "Gastroözofageal reflü" } },
  { code: ICD10.gastroenteritis, label: { en: "Gastroenteritis", tr: "Gastroenterit" } },
];

function buildDifferentials(
  pid: string,
  hint: string,
  correctCode: string,
  difficulty: number,
): Condition[] {
  const pool = (DIFF_POOL[hint] ?? GENERIC_DIFF).filter(
    (d) => d.code.code !== correctCode,
  );
  const want = Math.min(pool.length, Math.max(2, Math.min(4, difficulty)));
  return pool.slice(0, want).map((d, i) => ({
    resourceType: "Condition",
    id: `ddx-${pid}-${i}`,
    category: "differential",
    clinicalStatus: "active",
    verificationStatus: "differential",
    code: concept(d.code, d.label),
    subject: pid,
  }));
}

/* -------------------------------------------------------------------------- */
/* Section builders                                                            */
/* -------------------------------------------------------------------------- */

function buildTriageVitals(v: SpecVitals | undefined): TriageVitals {
  const src: SpecVitals =
    v ?? { hr: 88, systolic: 128, diastolic: 78, rr: 18, spo2: 97, tempC: 37 };
  const systolic = clampInt(src.systolic, 70, 250);
  let diastolic = clampInt(src.diastolic, 35, 200);
  if (diastolic >= systolic) diastolic = Math.max(35, systolic - 30);
  return {
    hr: clampInt(src.hr, 35, 195),
    systolic,
    diastolic,
    rr: clampInt(src.rr, 8, 44),
    spo2: clampInt(src.spo2, 60, 100),
    tempC: Number(clamp(src.tempC, 33.5, 41.5).toFixed(1)),
  };
}

function buildTrajectory(
  points: SpecTrajectoryPoint[] | undefined,
  triage: TriageVitals,
): VitalsTrajectoryPoint[] {
  if (points && points.length > 0) {
    return points.map((p) => ({
      atMs: Math.max(0, Math.round(safeNumber(p.atMs))),
      hr: clampInt(safeNumber(p.hr, triage.hr), 30, 200),
      systolic: clampInt(safeNumber(p.systolic, triage.systolic), 60, 260),
      diastolic: clampInt(safeNumber(p.diastolic, triage.diastolic), 30, 250),
      rr: clampInt(safeNumber(p.rr, triage.rr), 6, 45),
      spo2: clampInt(safeNumber(p.spo2, triage.spo2), 60, 100),
      tempC: Number(clamp(safeNumber(p.tempC, triage.tempC), 33, 42).toFixed(1)),
    }));
  }
  return [{ atMs: 0, ...triage }];
}

function buildAllergies(
  pid: string,
  spec: GeneratedCaseSpec,
): AllergyIntolerance[] {
  const label = bi(textOf(spec.allergies_en), textOf(spec.allergies_tr));
  const combined = `${label.en} ${label.tr}`.toLowerCase();
  const none =
    label.en.trim() === "" ||
    /no known|nkda|bilinen.*yok|alerji yok|yok/.test(combined);
  if (none) {
    return [
      {
        resourceType: "AllergyIntolerance",
        id: `alg-${pid}`,
        type: "allergy",
        criticality: "low",
        code: concept(
          {
            system: CODE_SYSTEMS.snomed,
            code: "409137002",
            display: "No known drug allergy",
          },
          { en: "No known drug allergies", tr: "Bilinen ilaç alerjisi yok" },
        ),
        patient: pid,
      },
    ];
  }
  const high = /anaphyla|anafil|angio-?edema|anjiyo|shock|şok/.test(combined);
  return [
    {
      resourceType: "AllergyIntolerance",
      id: `alg-${pid}`,
      type: "allergy",
      criticality: high ? "high" : "low",
      code: concept(
        {
          system: CODE_SYSTEMS.snomed,
          code: "419199007",
          display: "Allergy to substance",
        },
        label,
      ),
      patient: pid,
      reaction: label,
    },
  ];
}

function buildHistory(pid: string, spec: GeneratedCaseSpec): HistoryItem[] {
  const items: HistoryItem[] = [];
  (spec.hpi ?? []).forEach((h, i) => {
    items.push({
      id: `h-${pid}-${h.uid ?? i}`,
      intent: asIntent(h.intent),
      answer: bi(h.answer_en, h.answer_tr),
      ...(h.red_flag ? { redFlag: true } : {}),
      ...(h.topic ? { topic: h.topic } : {}),
    });
  });

  // The template already voices PMH, medications and allergies as hpi items;
  // adding them again rendered a second, unlabelled line (acceptance C3).
  const said = new Set(items.map((h) => h.answer.en.trim()));
  const pmh = bi(textOf(spec.pmh_en), textOf(spec.pmh_tr));
  if (pmh.en && !said.has(pmh.en.trim())) {
    items.push({ id: `h-${pid}-pmh`, intent: "past-medical-history", answer: pmh });
  }
  const meds = bi(textOf(spec.meds_en), textOf(spec.meds_tr));
  if (meds.en && !said.has(meds.en.trim())) {
    items.push({ id: `h-${pid}-meds`, intent: "medications", answer: meds });
  }
  const alg = bi(textOf(spec.allergies_en), textOf(spec.allergies_tr));
  if (alg.en && !said.has(alg.en.trim())) {
    items.push({ id: `h-${pid}-alg`, intent: "allergies", answer: alg });
  }

  if (items.length === 0) {
    items.push({
      id: `h-${pid}-0`,
      intent: "onset",
      answer: {
        en: "Symptoms began recently.",
        tr: "Belirtiler yakın zamanda başladı.",
      },
    });
  }
  return items;
}

function buildExam(pid: string, spec: GeneratedCaseSpec): ExamFinding[] {
  return (spec.exam ?? []).map((e, i) => {
    const maneuver = asManeuver(e.maneuver);
    const system = bi(e.system_en, e.system_tr);
    const finding = bi(e.finding_en, e.finding_tr);
    const abnormal = Boolean(e.abnormal);
    const observation: Observation = {
      resourceType: "Observation",
      id: `obs-exam-${pid}-${e.uid ?? i}`,
      status: "final",
      category: "exam",
      code: concept(
        {
          system: CODE_SYSTEMS.snomed,
          code: `exam-${maneuver}`,
          display: system.en || maneuver,
        },
        system,
      ),
      subject: pid,
      effectiveTime: 0,
      valueString: finding,
      interpretation: abnormal ? "A" : "N",
      bodySystem: system,
    };
    return { id: `e-${pid}-${e.uid ?? i}`, maneuver, system, finding, abnormal, observation };
  });
}

function buildLabs(pid: string, spec: GeneratedCaseSpec): LabResult[] {
  return (spec.labs ?? []).map((l, i) => {
    // D-19: the catalogue code of the same test, so ordering it scores.
    const code = catalogCodeFor((l.code ?? `lab-${i}`).trim() || `lab-${i}`, l.label_en);
    const label = bi(l.label_en, l.label_tr);
    const interpretation = asInterpretation(l.flag);
    const range = refRange(l.ref_low ?? undefined, l.ref_high ?? undefined);
    const observation: Observation = {
      resourceType: "Observation",
      id: `obs-${pid}-${l.uid ?? i}`,
      status: "final",
      category: asObsCategory(l.category),
      code: concept(
        { system: CODE_SYSTEMS.loinc, code, display: label.en || code },
        label,
      ),
      subject: pid,
      effectiveTime: 0,
      // Review 02 finding 39: a qualitative result (dipstick "2+", "positive")
      // renders as a word, not a number with the word as its unit.
      ...(l.qualitative || typeof l.value === "string"
        ? { valueString: bi(String(l.qualitative ?? l.value), String(l.qualitative ?? l.value)) }
        : { valueQuantity: { value: safeNumber(l.value), unit: (l.unit ?? "").trim() } }),
      ...(interpretation ? { interpretation } : {}),
      ...(range ? { referenceRange: range } : {}),
      // Review 02 finding 38: keep the time since ingestion on the reference line
      // so the learner can plot a timed level against the nomogram.
      ...(typeof l.hours_post_ingestion === "number"
        ? { referenceRange: `${range ?? ""}${range ? " · " : ""}${l.hours_post_ingestion} h post-ingestion` }
        : {}),
    };
    return { id: `l-${pid}-${l.uid ?? i}`, orderCode: code, observation };
  });
}

function buildImaging(pid: string, spec: GeneratedCaseSpec): ImagingResult[] {
  return (spec.imaging ?? []).map((im, i) => {
    const code = catalogCodeFor((im.code ?? `img-${i}`).trim() || `img-${i}`, im.modality_en);
    const modality = bi(im.modality_en, im.modality_tr);
    const isCardiac = /ecg|ekg|cardio|kardiy/i.test(`${code} ${modality.en}`);
    const report: DiagnosticReport = {
      resourceType: "DiagnosticReport",
      id: `rep-${pid}-${im.uid ?? i}`,
      status: "final",
      category: isCardiac ? "cardiology" : "imaging",
      code: concept(
        { system: CODE_SYSTEMS.loinc, code, display: modality.en || code },
        modality,
      ),
      subject: pid,
      issued: 0,
      result: [],
      conclusion: bi(im.findings_en, im.findings_tr),
    };
    const imageQuery =
      im.image_query_en || im.image_query_tr
        ? bi(im.image_query_en, im.image_query_tr)
        : undefined;
    return {
      id: `i-${pid}-${im.uid ?? i}`,
      orderCode: code,
      modality,
      report,
      ...(imageQuery ? { imageQuery } : {}),
    };
  });
}

function isCriticalLab(l: SpecLab | undefined): boolean {
  if (!l) return false;
  const flag = asInterpretation(l.flag);
  return flag === "HH" || flag === "LL";
}

function buildWorkup(
  pid: string,
  spec: GeneratedCaseSpec,
  labs: LabResult[],
  imaging: ImagingResult[],
  acuity: number,
): OrderExpectation[] {
  const anchors = spec.guideline_anchors ?? [];
  // Acceptance 2026-10-20 D-11: cite the verified statement id, preferring the
  // anchor that names this order code; a free-text citation never resolves, so
  // it rendered "Source unavailable".
  const verified = anchors.filter((a) => (a.statement_id ?? "").startsWith("gs_"));
  const citationFor = (code: string, i: number): string => {
    const byCode = verified.find((a) => (a.codes ?? []).includes(code));
    if (byCode?.statement_id) return byCode.statement_id;
    if (verified.length > 0) return verified[i % verified.length].statement_id as string;
    const a = anchors.length > 0 ? anchors[i % anchors.length] : undefined;
    return (a?.statement_id || a?.citation || a?.source || "tepdad-em").toString();
  };
  const citationAt = (i: number, code = ""): string => citationFor(code, i);

  const workup: OrderExpectation[] = [];
  labs.forEach((l, i) => {
    const spl = spec.labs?.[i];
    workup.push({
      id: `w-lab-${pid}-${i}`,
      kind: "laboratory",
      code: l.observation.code,
      label: bi(spl?.label_en || l.orderCode, spl?.label_tr),
      idealWindowMs: 30 * MIN,
      critical: isCriticalLab(spl),
      citationId: citationAt(i, l.orderCode),
    });
  });
  imaging.forEach((im, i) => {
    workup.push({
      id: `w-img-${pid}-${i}`,
      kind: "imaging",
      code: im.report.code,
      label: im.modality,
      idealWindowMs: (i === 0 ? 30 : 90) * MIN,
      // The lead imaging study is the decisive, time-critical test.
      critical: i === 0,
      citationId: citationAt(labs.length + i, im.orderCode),
    });
  });

  if (workup.length === 0) {
    workup.push({
      id: `w-${pid}-baseline`,
      kind: "laboratory",
      code: concept(LOINC.creatinine),
      label: { en: "Renal function", tr: "Böbrek fonksiyonu" },
      idealWindowMs: 30 * MIN,
      critical: acuity <= 2,
      citationId: "tepdad-em",
    });
  }

  // A high-acuity presentation MUST carry a critical action (validateCase).
  if (acuity <= 2 && !workup.some((w) => w.critical)) {
    workup[0] = { ...workup[0], critical: true };
  }
  return workup;
}

function mapEffect(e: SpecTreatmentEffect): VitalEffect | null {
  const key = asVitalKey(e.key);
  if (!key) return null;
  return {
    key,
    delta: safeNumber(e.delta),
    onsetMs: Math.max(0, Math.round(safeNumber(e.onsetMs))),
  };
}

function buildTreatmentResponses(
  spec: GeneratedCaseSpec,
): TreatmentResponse[] | undefined {
  // Live finding 2026-10-20: a model left every code empty. An uncoded response
  // can never match an order (encounterStore matches on order.drug), so it is
  // dropped here; the server maps codes before a case is returned.
  const list = (spec.treatments ?? []).filter((t) => (t.code ?? "").trim().length > 0);
  if (list.length === 0) return undefined;
  return list.map((t) => ({
    treatmentCode: (t.code ?? "").trim(),
    appropriateness: asAppropriateness(t.appropriateness),
    effects: (t.effects ?? [])
      .map(mapEffect)
      .filter((e): e is VitalEffect => e !== null),
    narrative: bi(t.narrative_en, t.narrative_tr),
    ...(t.label_en ? { label: bi(t.label_en, t.label_tr) } : {}),
  }));
}

function buildRedFlags(spec: GeneratedCaseSpec): Bilingual[] {
  const flags: Bilingual[] = [];
  // Review 02 finding 3: structured red flags (clinician-observed signs/results
  // + the lay patient symptom) are the source of truth when the server sends them.
  (spec.red_flags ?? []).forEach((rf) => {
    if (rf && typeof rf.en === "string" && rf.en.trim()) flags.push(bi(rf.en, rf.tr));
  });
  if (flags.length > 0) return flags;
  (spec.hpi ?? []).forEach((h) => {
    if (h.red_flag) flags.push(bi(h.answer_en, h.answer_tr));
  });
  if (flags.length === 0) {
    flags.push({
      en: "Watch for evolving red-flag features.",
      tr: "Gelişen kırmızı bayrak bulgularına dikkat edin.",
    });
  }
  return flags;
}

/* -------------------------------------------------------------------------- */
/* specToCaseInstance                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Map a wire `GeneratedCaseSpec` to a fully-valid `CaseInstance`. Reuses the
 * fhir.ts helpers (concept, curated codings) and gap-fills so the result always
 * passes `validateCase`. Pure — no clock reads, no I/O.
 */
export function specToCaseInstance(spec: GeneratedCaseSpec): CaseInstance {
  const locale = asLang(spec.locale);
  const seedNum =
    typeof spec.seed === "number" && Number.isFinite(spec.seed)
      ? spec.seed >>> 0
      : hashSeed(String(spec.seed ?? spec.condition?.label_en ?? "acudx-ai"));
  const caseId = `gen-ai-${seedNum.toString(36)}`;
  const pid = `${caseId}-p`;

  const codings = diagnosisCodings(spec.condition);
  const hint = complaintHint(codings);

  // Demographics from the spec, backfilled from the patientProfiles library.
  const profile = pickProfileForCase(hint, seedNum);
  const age = clampInt(spec.demographics?.age ?? profile.age, 1, 105);
  const gender = asGender(spec.demographics?.sex ?? profile.sexAtBirth);
  const name =
    (spec.demographics?.name_hint ?? "").trim() ||
    profile.name[locale] ||
    profile.name.en;

  const patient: Patient = {
    resourceType: "Patient",
    id: pid,
    name,
    gender,
    ageYears: age,
    mrn: `SIM-AI-${seedNum.toString(36).toUpperCase()}`,
    weightKg: estWeight(age, seedNum),
    active: true,
  };

  const ccBi = bi(spec.chief_complaint_en, spec.chief_complaint_tr);
  const chiefComplaint: Bilingual = ccBi.en
    ? ccBi
    : bi(spec.condition.label_en, spec.condition.label_tr);

  const encounter: Encounter = {
    resourceType: "Encounter",
    id: `enc-${pid}`,
    status: "in-progress",
    class: "emergency",
    subject: pid,
    reason: chiefComplaint,
    period: { start: 0 },
  };

  const triageVitals = buildTriageVitals(spec.triage_vitals);
  const acuityESI = asAcuity(spec.acuity_esi);
  const difficulty = asDifficulty(spec.difficulty);

  const labs = buildLabs(pid, spec);
  const imaging = buildImaging(pid, spec);

  const correctDiagnosis: Condition = {
    resourceType: "Condition",
    id: `dx-${pid}`,
    category: "encounter-diagnosis",
    clinicalStatus: "active",
    verificationStatus: "confirmed",
    code: {
      coding: codings,
      text: bi(spec.condition.label_en, spec.condition.label_tr),
    },
    subject: pid,
  };

  const treatmentResponses = buildTreatmentResponses(spec);

  const candidate: CaseInstance = {
    id: caseId,
    seed: seedNum,
    locale,
    chiefComplaint,
    patient,
    encounter,
    allergies: buildAllergies(pid, spec),
    triageVitals,
    difficulty,
    acuityESI,
    correctDiagnosis,
    differentials: buildDifferentials(pid, hint, codings[0].code, difficulty),
    redFlags: buildRedFlags(spec),
    groundTruth: {
      history: buildHistory(pid, spec),
      exam: buildExam(pid, spec),
      labs,
      imaging,
      vitalsTrajectory: buildTrajectory(spec.vitals_trajectory, triageVitals),
    },
    expectedWorkup: buildWorkup(pid, spec, labs, imaging, acuityESI),
    disposition: asDisposition(spec.disposition),
    ...(treatmentResponses ? { treatmentResponses } : {}),
    provenance: "generated",
  };
  // Review 06b: bind the case to the shared course model when its condition has a rule.
  const course = courseBindingFromSpec(spec as CourseSpecLike);
  if (course) candidate.course = course;

  return gapFill(candidate);
}

/** Repair any residual validateCase failures so the instance always passes. */
function gapFill(c: CaseInstance): CaseInstance {
  if (validateCase(c).ok) return c;

  const fixed: CaseInstance = {
    ...c,
    triageVitals: buildTriageVitals(c.triageVitals),
    groundTruth: { ...c.groundTruth },
  };

  if (fixed.patient.ageYears < 1 || fixed.patient.ageYears > 105) {
    fixed.patient = { ...fixed.patient, ageYears: clampInt(fixed.patient.ageYears, 1, 105) };
  }
  if (fixed.groundTruth.history.length === 0) {
    fixed.groundTruth.history = [
      {
        id: `${fixed.id}-h0`,
        intent: "onset",
        answer: {
          en: "Symptoms began recently.",
          tr: "Belirtiler yakın zamanda başladı.",
        },
      },
    ];
  }
  if (fixed.expectedWorkup.length === 0) {
    fixed.expectedWorkup = [
      {
        id: `${fixed.id}-w0`,
        kind: "laboratory",
        code: concept(LOINC.creatinine),
        label: { en: "Renal function", tr: "Böbrek fonksiyonu" },
        idealWindowMs: 30 * MIN,
        critical: fixed.acuityESI <= 2,
        citationId: "tepdad-em",
      },
    ];
  }
  if (fixed.acuityESI <= 2 && !fixed.expectedWorkup.some((w) => w.critical)) {
    fixed.expectedWorkup = fixed.expectedWorkup.map((w, i) =>
      i === 0 ? { ...w, critical: true } : w,
    );
  }
  return fixed;
}
