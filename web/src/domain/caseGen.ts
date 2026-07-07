/**
 * AcuDx — deterministic client-side case generator.
 *
 * Demonstrates the "unlimited, non-repeating cases" product claim
 * (docs/00-overview/04 §3) WITHOUT an LLM: a seeded RNG (mulberry32), a
 * prevalence x educational-value weighted ICD/DSM presentation table, and
 * templates that assemble a coherent CaseInstance. Same seed => same case.
 *
 * MVP client demo; production = CaseGenerationService behind the Model Gateway
 * (open-weight default) with the generate -> RAG-ground -> verify -> instantiate
 * pipeline and a cross-family verifier, per docs/00-overview/04 §3.2 and
 * docs/architecture. This module implements the deterministic checks
 * (vitals ranges, age/sex plausibility, internal consistency) locally and
 * regenerates on failure, which is the same "abstain > ship-wrong" loop.
 *
 * Education only. Synthetic patients. No real patient data.
 */

import type { Bilingual, Lang } from "@/data/mock";
import {
  concept,
  DSM5TR,
  ICD10,
  LOINC,
  type AllergyIntolerance,
  type Coding,
  type Condition,
  type Encounter,
  type Observation,
  type Patient,
} from "@/domain/fhir";
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
  TriageVitals,
  VitalsTrajectoryPoint,
} from "@/domain/case";

/* -------------------------------------------------------------------------- */
/* Seeded RNG (mulberry32)                                                     */
/* -------------------------------------------------------------------------- */

/** Deterministic PRNG from a 32-bit seed. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Rng {
  next(): number;
  int(minInclusive: number, maxInclusive: number): number;
  pick<T>(items: readonly T[]): T;
  /** Weighted pick: parallel arrays of items and non-negative weights. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T;
  bool(pTrue: number): boolean;
}

function makeRng(seed: number): Rng {
  const rand = mulberry32(seed);
  return {
    next: rand,
    int: (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1)),
    pick: (items) => items[Math.floor(rand() * items.length)],
    weighted: (items, weights) => {
      const total = weights.reduce((s, w) => s + Math.max(0, w), 0);
      let r = rand() * total;
      for (let i = 0; i < items.length; i++) {
        r -= Math.max(0, weights[i]);
        if (r <= 0) return items[i];
      }
      return items[items.length - 1];
    },
    bool: (p) => rand() < p,
  };
}

/* -------------------------------------------------------------------------- */
/* Presentation table (weighted by prevalence x educational value)            */
/* -------------------------------------------------------------------------- */

export type ChiefComplaintFamily = "chest-pain" | "headache" | "abdominal-pain" | "dyspnea";

/** Physiological state class that governs plausible vitals bands. */
type PhysioState = "acs" | "hemorrhage" | "inflammatory" | "hypoxic" | "anxiety";

interface PresentationTemplate {
  key: string;
  family: ChiefComplaintFamily;
  /** prevalence x educational-value weight (higher = sampled more often). */
  weight: number;
  diagnosisCode: Coding;
  diagnosisLabel: Bilingual;
  physio: PhysioState;
  /** Plausible age band for this presentation. */
  ageRange: [number, number];
  /** null = any sex; otherwise constrained. */
  sexConstraint: Patient["gender"] | null;
  chiefComplaint: Bilingual;
  redFlags: Bilingual[];
  /** Distractor diagnoses (differentials) to include. */
  distractors: { code: Coding; label: Bilingual }[];
  disposition: Disposition;
  /** Ideal times (minutes) for the two headline critical actions. */
  criticalActions: { code: Coding; label: Bilingual; windowMin: number; kind: OrderExpectation["kind"]; critical: boolean; citationId: string }[];
  /** History intents this dx should express, with bilingual answers. */
  history: { intent: QuestionIntent; answer: Bilingual; redFlag?: boolean }[];
  /** Exam findings by maneuver. */
  exam: { maneuver: ExamManeuver; system: Bilingual; finding: Bilingual; abnormal: boolean }[];
  /** Labs keyed by LOINC-ish code with a plausible abnormal value. */
  labs: { code: Coding; value: number; unit: string; interp: Observation["interpretation"]; ref: string }[];
  /** Imaging conclusion. */
  imaging?: { code: string; modality: Bilingual; conclusion: Bilingual };
}

const TENSION_H: Bilingual = { en: "Tension-type headache", tr: "Gerilim tipi baş ağrısı" };

const PRESENTATIONS: PresentationTemplate[] = [
  {
    key: "acs",
    family: "chest-pain",
    weight: 30,
    diagnosisCode: ICD10.acsNstemi,
    diagnosisLabel: { en: "Non-ST elevation myocardial infarction", tr: "ST yükselmesiz miyokart enfarktüsü" },
    physio: "acs",
    ageRange: [48, 82],
    sexConstraint: null,
    chiefComplaint: { en: "Central chest pain radiating to the arm", tr: "Kola yayılan orta hat göğüs ağrısı" },
    redFlags: [
      { en: "Ongoing chest pain with diaphoresis", tr: "Terlemeyle süren göğüs ağrısı" },
      { en: "Ischemic ECG changes", tr: "İskemik EKG değişiklikleri" },
    ],
    distractors: [
      { code: ICD10.unstableAngina, label: { en: "Unstable angina", tr: "Kararsız angina" } },
      { code: ICD10.gerd, label: { en: "GERD", tr: "Gastroözofageal reflü" } },
      { code: ICD10.costochondritis, label: { en: "Costochondritis", tr: "Kostokondrit" } },
    ],
    disposition: "admit-ccu",
    criticalActions: [
      { code: LOINC.ecg12, label: { en: "12-lead ECG", tr: "12 derivasyonlu EKG" }, windowMin: 10, kind: "imaging", critical: true, citationId: "esc-acs-2023" },
      { code: LOINC.troponinHs, label: { en: "High-sensitivity troponin", tr: "Yüksek duyarlıklı troponin" }, windowMin: 15, kind: "laboratory", critical: true, citationId: "esc-acs-2023" },
    ],
    history: [
      { intent: "onset", answer: { en: "It started at rest about an hour ago.", tr: "Yaklaşık bir saat önce dinlenirken başladı." } },
      { intent: "character", answer: { en: "A heavy pressure like a weight.", tr: "Ağırlık gibi ağır bir baskı." } },
      { intent: "radiation", answer: { en: "It spreads to my left arm.", tr: "Sol koluma yayılıyor." }, redFlag: true },
      { intent: "associated-symptoms", answer: { en: "I am sweaty and nauseated.", tr: "Terliyorum ve midem bulanıyor." }, redFlag: true },
      { intent: "risk-factors", answer: { en: "High blood pressure and past smoking.", tr: "Yüksek tansiyon ve geçmişte sigara." } },
    ],
    exam: [
      { maneuver: "general-inspection", system: { en: "General", tr: "Genel" }, finding: { en: "Anxious and diaphoretic.", tr: "Anksiyöz ve terli." }, abnormal: true },
      { maneuver: "cardiovascular", system: { en: "Cardiovascular", tr: "Kardiyovasküler" }, finding: { en: "Regular rhythm, no murmur.", tr: "Düzenli ritim, üfürüm yok." }, abnormal: false },
    ],
    labs: [
      { code: LOINC.troponinHs, value: 180, unit: "ng/L", interp: "HH", ref: "< 14" },
    ],
    imaging: { code: "11524-6", modality: { en: "12-lead ECG", tr: "12 derivasyonlu EKG" }, conclusion: { en: "Lateral ST depression, no ST elevation.", tr: "Lateral ST çökmesi, ST yükselmesi yok." } },
  },
  {
    key: "sah",
    family: "headache",
    weight: 12,
    diagnosisCode: ICD10.sah,
    diagnosisLabel: { en: "Subarachnoid hemorrhage", tr: "Subaraknoid kanama" },
    physio: "hemorrhage",
    ageRange: [35, 70],
    sexConstraint: null,
    chiefComplaint: { en: "Sudden worst-ever headache", tr: "Aniden başlayan en şiddetli baş ağrısı" },
    redFlags: [
      { en: "Thunderclap onset", tr: "Gök gürültüsü başlangıç" },
      { en: "Neck stiffness or photophobia", tr: "Ense sertliği veya fotofobi" },
    ],
    distractors: [
      { code: ICD10.migraine, label: { en: "Migraine", tr: "Migren" } },
      { code: ICD10.tensionHeadache, label: TENSION_H },
    ],
    disposition: "admit-icu",
    criticalActions: [
      { code: { system: LOINC.ecg12.system, code: "ct-head-noncon", display: "CT head" }, label: { en: "Noncontrast CT head", tr: "Kontrastsız beyin BT" }, windowMin: 30, kind: "imaging", critical: true, citationId: "nice-ng185" },
    ],
    history: [
      { intent: "onset", answer: { en: "It hit all at once like a thunderclap.", tr: "Gök gürültüsü gibi bir anda vurdu." }, redFlag: true },
      { intent: "severity", answer: { en: "The worst headache of my life.", tr: "Hayatımın en kötü baş ağrısı." }, redFlag: true },
      { intent: "red-flags", answer: { en: "My neck is stiff and I vomited.", tr: "Ensem tutuk ve kustum." }, redFlag: true },
    ],
    exam: [
      { maneuver: "neurological", system: { en: "Neurological", tr: "Nörolojik" }, finding: { en: "Neck stiffness, no focal deficit.", tr: "Ense sertliği, fokal defisit yok." }, abnormal: true },
    ],
    labs: [],
    imaging: { code: "ct-head-noncon", modality: { en: "CT head", tr: "Beyin BT" }, conclusion: { en: "Basal cistern hyperdensity consistent with SAH.", tr: "SAH ile uyumlu bazal sistern hiperdansitesi." } },
  },
  {
    key: "appendicitis",
    family: "abdominal-pain",
    weight: 22,
    diagnosisCode: ICD10.appendicitis,
    diagnosisLabel: { en: "Acute appendicitis", tr: "Akut apandisit" },
    physio: "inflammatory",
    ageRange: [12, 45],
    sexConstraint: null,
    chiefComplaint: { en: "Right lower quadrant abdominal pain", tr: "Sağ alt kadran karın ağrısı" },
    redFlags: [
      { en: "Peritonism or guarding", tr: "Peritonizm veya defans" },
      { en: "Rising fever with localized tenderness", tr: "Lokalize hassasiyetle yükselen ateş" },
    ],
    distractors: [
      { code: ICD10.gastroenteritis, label: { en: "Gastroenteritis", tr: "Gastroenterit" } },
      { code: ICD10.mesentericAdenitis, label: { en: "Mesenteric adenitis", tr: "Mezenterik adenit" } },
    ],
    disposition: "operating-room",
    criticalActions: [
      { code: LOINC.wbc, label: { en: "FBC and CRP", tr: "Tam kan sayımı ve CRP" }, windowMin: 30, kind: "laboratory", critical: false, citationId: "tepdad-em" },
    ],
    history: [
      { intent: "onset", answer: { en: "It began near my navel and moved to the right.", tr: "Göbek çevresinde başladı, sağa göç etti." }, redFlag: true },
      { intent: "associated-symptoms", answer: { en: "No appetite and I feel feverish.", tr: "İştahım yok ve ateşim var gibi." }, redFlag: true },
      { intent: "aggravating", answer: { en: "Coughing and walking make it worse.", tr: "Öksürmek ve yürümek artırıyor." }, redFlag: true },
    ],
    exam: [
      { maneuver: "abdominal", system: { en: "Abdominal", tr: "Karın" }, finding: { en: "Tender at McBurney point with guarding.", tr: "McBurney noktasında hassas, defans var." }, abnormal: true },
    ],
    labs: [
      { code: LOINC.wbc, value: 15, unit: "10^9/L", interp: "H", ref: "4.0 - 11.0" },
      { code: LOINC.crp, value: 46, unit: "mg/L", interp: "H", ref: "< 5" },
    ],
    imaging: { code: "us-abdomen", modality: { en: "Abdominal ultrasound", tr: "Karın ultrasonu" }, conclusion: { en: "Noncompressible tubular structure with inflammation.", tr: "Enflamasyonlu, sıkıştırılamayan tübüler yapı." } },
  },
  {
    key: "pe",
    family: "dyspnea",
    weight: 16,
    diagnosisCode: ICD10.pulmonaryEmbolism,
    diagnosisLabel: { en: "Pulmonary embolism", tr: "Pulmoner emboli" },
    physio: "hypoxic",
    ageRange: [40, 80],
    sexConstraint: null,
    chiefComplaint: { en: "Sudden breathlessness and pleuritic pain", tr: "Ani nefes darlığı ve plöretik ağrı" },
    redFlags: [
      { en: "Hypoxia with tachycardia", tr: "Taşikardiyle hipoksi" },
      { en: "Unilateral leg swelling", tr: "Tek taraflı bacak şişliği" },
    ],
    distractors: [
      { code: ICD10.chf, label: { en: "Heart failure", tr: "Kalp yetmezliği" } },
      { code: ICD10.pneumonia, label: { en: "Pneumonia", tr: "Pnömoni" } },
    ],
    disposition: "admit-ward",
    criticalActions: [
      { code: { system: LOINC.ecg12.system, code: "ctpa", display: "CTPA" }, label: { en: "CT pulmonary angiogram", tr: "BT pulmoner anjiyografi" }, windowMin: 90, kind: "imaging", critical: true, citationId: "tepdad-em" },
    ],
    history: [
      { intent: "onset", answer: { en: "I became breathless very suddenly.", tr: "Çok ani nefes darlığım oldu." }, redFlag: true },
      { intent: "risk-factors", answer: { en: "I had a long flight two days ago.", tr: "İki gün önce uzun bir uçuşum vardı." }, redFlag: true },
      { intent: "associated-symptoms", answer: { en: "My right calf is swollen and sore.", tr: "Sağ baldırım şiş ve ağrılı." }, redFlag: true },
    ],
    exam: [
      { maneuver: "general-inspection", system: { en: "General", tr: "Genel" }, finding: { en: "Tachypneic, mildly cyanosed.", tr: "Takipneik, hafif siyanotik." }, abnormal: true },
      { maneuver: "musculoskeletal", system: { en: "Lower limb", tr: "Alt ekstremite" }, finding: { en: "Right calf swollen and tender.", tr: "Sağ baldır şiş ve hassas." }, abnormal: true },
    ],
    labs: [
      { code: LOINC.dDimer, value: 2800, unit: "ng/mL", interp: "H", ref: "< 500" },
    ],
    imaging: { code: "ctpa", modality: { en: "CTPA", tr: "BT pulmoner anjiyografi" }, conclusion: { en: "Filling defects in the pulmonary arteries.", tr: "Pulmoner arterlerde dolum defektleri." } },
  },
  {
    key: "panic",
    family: "chest-pain",
    weight: 20,
    diagnosisCode: DSM5TR.panicDisorder,
    diagnosisLabel: { en: "Panic disorder", tr: "Panik bozukluğu" },
    physio: "anxiety",
    ageRange: [18, 45],
    sexConstraint: null,
    chiefComplaint: { en: "Chest tightness with palpitations and fear", tr: "Çarpıntı ve korkuyla göğüste sıkışma" },
    redFlags: [
      { en: "Do not anchor: an ACS rule-out is still required", tr: "Yönelim yanlılığına düşmeyin: yine de ACS dışlaması gerekir" },
    ],
    distractors: [
      { code: ICD10.acsNstemi, label: { en: "Acute coronary syndrome", tr: "Akut koroner sendrom" } },
      { code: DSM5TR.gad, label: { en: "Generalized anxiety disorder", tr: "Yaygın anksiyete bozukluğu" } },
    ],
    disposition: "discharge",
    criticalActions: [
      { code: LOINC.ecg12, label: { en: "12-lead ECG", tr: "12 derivasyonlu EKG" }, windowMin: 10, kind: "imaging", critical: true, citationId: "esc-acs-2023" },
      { code: LOINC.troponinHs, label: { en: "High-sensitivity troponin", tr: "Yüksek duyarlıklı troponin" }, windowMin: 15, kind: "laboratory", critical: true, citationId: "esc-acs-2023" },
    ],
    history: [
      { intent: "onset", answer: { en: "It peaked within minutes while sitting.", tr: "Otururken dakikalar içinde en şiddetli hale ulaştı." } },
      { intent: "radiation", answer: { en: "No, it does not spread to my arm.", tr: "Hayır, koluma yayılmıyor." } },
      { intent: "timing", answer: { en: "This has happened several times this month.", tr: "Bu ay birkaç kez oldu." }, redFlag: true },
      { intent: "ice", answer: { en: "I fear I am having a heart attack.", tr: "Kalp krizi geçirdiğimden korkuyorum." } },
    ],
    exam: [
      { maneuver: "general-inspection", system: { en: "General", tr: "Genel" }, finding: { en: "Anxious and hyperventilating.", tr: "Anksiyöz ve hiperventile." }, abnormal: true },
      { maneuver: "cardiovascular", system: { en: "Cardiovascular", tr: "Kardiyovasküler" }, finding: { en: "Tachycardic but regular.", tr: "Taşikardik ancak düzenli." }, abnormal: false },
    ],
    labs: [
      { code: LOINC.troponinHs, value: 4, unit: "ng/L", interp: "N", ref: "< 14" },
    ],
    imaging: { code: "11524-6", modality: { en: "12-lead ECG", tr: "12 derivasyonlu EKG" }, conclusion: { en: "Sinus tachycardia, no ischemic changes.", tr: "Sinüs taşikardisi, iskemik değişiklik yok." } },
  },
];

/* -------------------------------------------------------------------------- */
/* Demographic pools                                                           */
/* -------------------------------------------------------------------------- */

const MALE_NAMES = ["Ahmet Yılmaz", "Mehmet Demir", "Mustafa Kaya", "Emre Şahin", "Can Aydın", "Burak Çelik"];
const FEMALE_NAMES = ["Elif Demir", "Ayşe Şahin", "Zeynep Kaya", "Fatma Yıldız", "Deniz Aydın", "Merve Arslan"];

/* -------------------------------------------------------------------------- */
/* Physiological vitals bands (deterministic-check target)                     */
/* -------------------------------------------------------------------------- */

interface VitalsBand {
  hr: [number, number];
  systolic: [number, number];
  diastolic: [number, number];
  rr: [number, number];
  spo2: [number, number];
  tempC: [number, number];
}

const PHYSIO_BANDS: Record<PhysioState, VitalsBand> = {
  acs: { hr: [88, 118], systolic: [130, 165], diastolic: [80, 100], rr: [16, 22], spo2: [93, 98], tempC: [36.4, 37.2] },
  hemorrhage: { hr: [70, 110], systolic: [150, 190], diastolic: [90, 110], rr: [14, 22], spo2: [95, 99], tempC: [36.6, 37.6] },
  inflammatory: { hr: [88, 115], systolic: [110, 135], diastolic: [70, 88], rr: [16, 22], spo2: [96, 100], tempC: [37.6, 39.0] },
  hypoxic: { hr: [100, 130], systolic: [100, 130], diastolic: [65, 85], rr: [22, 32], spo2: [86, 93], tempC: [36.5, 37.4] },
  anxiety: { hr: [95, 120], systolic: [118, 140], diastolic: [72, 90], rr: [18, 26], spo2: [97, 100], tempC: [36.3, 37.0] },
};

const MIN = 60_000;

function bandValue(rng: Rng, band: [number, number], decimals = 0): number {
  const [lo, hi] = band;
  const v = lo + rng.next() * (hi - lo);
  return decimals ? Number(v.toFixed(decimals)) : Math.round(v);
}

function generateVitals(rng: Rng, physio: PhysioState): TriageVitals {
  const b = PHYSIO_BANDS[physio];
  return {
    hr: bandValue(rng, b.hr),
    systolic: bandValue(rng, b.systolic),
    diastolic: bandValue(rng, b.diastolic),
    rr: bandValue(rng, b.rr),
    spo2: bandValue(rng, b.spo2),
    tempC: bandValue(rng, b.tempC, 1),
  };
}

/* -------------------------------------------------------------------------- */
/* Validity checks (deterministic; regenerate on failure)                     */
/* -------------------------------------------------------------------------- */

export interface ValidityResult {
  ok: boolean;
  reasons: string[];
}

/** Internal-consistency + plausibility checks (docs §3.2 step 3, local subset). */
export function validateCase(c: CaseInstance): ValidityResult {
  const reasons: string[] = [];
  const v = c.triageVitals;
  // Vitals physiological sanity (independent of the source band).
  if (v.hr < 30 || v.hr > 200) reasons.push("hr out of physiological range");
  if (v.systolic < 60 || v.systolic > 260) reasons.push("systolic out of range");
  if (v.diastolic < 30 || v.diastolic >= v.systolic) reasons.push("diastolic implausible vs systolic");
  if (v.rr < 6 || v.rr > 45) reasons.push("rr out of range");
  if (v.spo2 < 60 || v.spo2 > 100) reasons.push("spo2 out of range");
  if (v.tempC < 33 || v.tempC > 42) reasons.push("temp out of range");
  // Age/sex plausibility.
  if (c.patient.ageYears < 1 || c.patient.ageYears > 105) reasons.push("age implausible");
  // Internal consistency: at least one history + one workup item + a diagnosis.
  if (c.groundTruth.history.length === 0) reasons.push("no history items");
  if (c.expectedWorkup.length === 0) reasons.push("no expected workup");
  if (!c.correctDiagnosis) reasons.push("missing diagnosis");
  // A safety-critical presentation must have at least one critical action.
  if (c.acuityESI <= 2 && !c.expectedWorkup.some((w) => w.critical)) {
    reasons.push("high-acuity case without a critical action");
  }
  return { ok: reasons.length === 0, reasons };
}

/* -------------------------------------------------------------------------- */
/* Generator                                                                   */
/* -------------------------------------------------------------------------- */

export interface GenerateCaseOptions {
  seedMode: "random" | "constrained";
  /** Constrain to a chief-complaint family (constrained mode). */
  chiefComplaint?: ChiefComplaintFamily;
  difficulty?: 1 | 2 | 3 | 4 | 5;
  locale: Lang;
  /** Explicit numeric seed for reproducibility; else derived from Math-free counter. */
  seed?: number;
}

let ephemeralSeedCounter = 0x9e3779b9;

/** Derive a stable numeric seed without reading Date.now at module top level. */
function deriveSeed(opts: GenerateCaseOptions): number {
  if (typeof opts.seed === "number") return opts.seed >>> 0;
  // Deterministic within a session run order; callers pass an explicit seed for
  // true reproducibility across runs.
  ephemeralSeedCounter = (ephemeralSeedCounter + 0x6d2b79f5) | 0;
  return ephemeralSeedCounter >>> 0;
}

function esiFor(physio: PhysioState, difficulty: number): CaseInstance["acuityESI"] {
  const base: Record<PhysioState, number> = { acs: 2, hemorrhage: 2, hypoxic: 2, inflammatory: 3, anxiety: 3 };
  const raw = base[physio];
  return Math.min(5, Math.max(1, raw - (difficulty >= 5 ? 0 : 0))) as CaseInstance["acuityESI"];
}

function condition(
  id: string,
  code: Coding,
  text: Bilingual,
  subject: string,
  category: Condition["category"],
  verification: Condition["verificationStatus"],
  note?: Bilingual,
): Condition {
  return {
    resourceType: "Condition",
    id,
    category,
    clinicalStatus: "active",
    verificationStatus: verification,
    code: concept(code, text),
    subject,
    ...(note ? { note } : {}),
  };
}

function generateOnce(seed: number, opts: GenerateCaseOptions): CaseInstance {
  const rng = makeRng(seed);

  // 1) Sample a target presentation (weighted; family-constrained if asked).
  const pool =
    opts.seedMode === "constrained" && opts.chiefComplaint
      ? PRESENTATIONS.filter((p) => p.family === opts.chiefComplaint)
      : PRESENTATIONS;
  const candidates = pool.length > 0 ? pool : PRESENTATIONS;
  const tmpl = rng.weighted(candidates, candidates.map((p) => p.weight));

  const difficulty = (opts.difficulty ?? (rng.int(2, 4) as 1 | 2 | 3 | 4 | 5));

  // 2) Randomize demographics within plausible bands.
  const gender: Patient["gender"] =
    tmpl.sexConstraint ?? (rng.bool(0.5) ? "male" : "female");
  const age = rng.int(tmpl.ageRange[0], tmpl.ageRange[1]);
  const name = gender === "male" ? rng.pick(MALE_NAMES) : rng.pick(FEMALE_NAMES);
  const weightKg = rng.int(52, 98);
  const pid = `gen-${seed.toString(36)}`;

  const patient: Patient = {
    resourceType: "Patient",
    id: pid,
    name,
    gender,
    ageYears: age,
    mrn: `SIM-GEN-${seed.toString(36).toUpperCase()}`,
    weightKg,
    active: true,
  };

  const encounter: Encounter = {
    resourceType: "Encounter",
    id: `enc-${pid}`,
    status: "in-progress",
    class: "emergency",
    subject: pid,
    reason: tmpl.chiefComplaint,
    period: { start: 0 },
  };

  const allergies: AllergyIntolerance[] = [
    {
      resourceType: "AllergyIntolerance",
      id: `alg-${pid}`,
      type: "allergy",
      criticality: "low",
      code: concept(
        { system: "http://snomed.info/sct", code: "409137002", display: "No known drug allergy" },
        { en: "No known drug allergies", tr: "Bilinen ilaç alerjisi yok" },
      ),
      patient: pid,
    },
  ];

  // 3) Vitals within physiological range for the state.
  const triageVitals = generateVitals(rng, tmpl.physio);

  // 4) History / exam / labs / imaging consistent with the dx.
  const history: HistoryItem[] = tmpl.history.map((h, i) => ({
    id: `h-${pid}-${i}`,
    intent: h.intent,
    answer: h.answer,
    ...(h.redFlag ? { redFlag: true } : {}),
  }));
  // Add a couple of generic-but-consistent history intents for depth.
  history.push({ id: `h-${pid}-pmh`, intent: "past-medical-history", answer: { en: "Otherwise generally well.", tr: "Aksi halde genelde iyi." } });

  const exam: ExamFinding[] = tmpl.exam.map((e, i) => ({
    id: `e-${pid}-${i}`,
    maneuver: e.maneuver,
    system: e.system,
    finding: e.finding,
    abnormal: e.abnormal,
  }));

  const labs: LabResult[] = tmpl.labs.map((l, i) => {
    const obs: Observation = {
      resourceType: "Observation",
      id: `obs-${pid}-${i}`,
      status: "final",
      category: "laboratory",
      code: concept(l.code),
      subject: pid,
      effectiveTime: 0,
      valueQuantity: { value: l.value, unit: l.unit },
      interpretation: l.interp,
      referenceRange: l.ref,
    };
    return { id: `l-${pid}-${i}`, orderCode: l.code.code, observation: obs };
  });

  const imaging: ImagingResult[] = tmpl.imaging
    ? [
        {
          id: `i-${pid}`,
          orderCode: tmpl.imaging.code,
          modality: tmpl.imaging.modality,
          report: {
            resourceType: "DiagnosticReport",
            id: `rep-${pid}`,
            status: "final",
            category: tmpl.family === "chest-pain" && tmpl.physio === "acs" ? "cardiology" : "imaging",
            code: concept({ system: LOINC.ecg12.system, code: tmpl.imaging.code, display: tmpl.imaging.modality.en }),
            subject: pid,
            issued: 0,
            result: [],
            conclusion: tmpl.imaging.conclusion,
          },
        },
      ]
    : [];

  // Vitals trajectory: deteriorate for high acuity, settle for anxiety.
  const drift = tmpl.physio === "anxiety" ? { hr: -16, rr: -4 } : { hr: 8, spo2: tmpl.physio === "hypoxic" ? -4 : -1 };
  const vitalsTrajectory: VitalsTrajectoryPoint[] = [0, 5, 10, 15, 20, 30].map((min) => {
    const f = min / 30;
    return {
      atMs: min * MIN,
      hr: Math.round(triageVitals.hr + (drift.hr ?? 0) * f),
      systolic: triageVitals.systolic,
      diastolic: triageVitals.diastolic,
      rr: Math.round(triageVitals.rr + ((drift as { rr?: number }).rr ?? 0) * f),
      spo2: Math.round(triageVitals.spo2 + (drift.spo2 ?? 0) * f),
      tempC: triageVitals.tempC,
    };
  });

  // Diagnosis + differentials (2-4 distractors; difficulty adds distractors).
  const correctDiagnosis = condition(`dx-${pid}`, tmpl.diagnosisCode, tmpl.diagnosisLabel, pid, "encounter-diagnosis", "confirmed");
  const wantDistractors = Math.min(tmpl.distractors.length, Math.max(2, difficulty));
  const differentials: Condition[] = tmpl.distractors
    .slice(0, wantDistractors)
    .map((d, i) => condition(`ddx-${pid}-${i}`, d.code, d.label, pid, "differential", "differential"));

  // Expected workup from critical actions + one renal/baseline non-critical.
  const expectedWorkup: OrderExpectation[] = tmpl.criticalActions.map((a, i) => ({
    id: `w-${pid}-${i}`,
    kind: a.kind,
    code: concept(a.code),
    label: a.label,
    idealWindowMs: a.windowMin * MIN,
    critical: a.critical,
    citationId: a.citationId,
  }));
  expectedWorkup.push({
    id: `w-${pid}-renal`,
    kind: "laboratory",
    code: concept(LOINC.creatinine),
    label: { en: "Renal function", tr: "Böbrek fonksiyonu" },
    idealWindowMs: 30 * MIN,
    critical: false,
    citationId: "tepdad-em",
  });

  return {
    id: `gen-${seed.toString(36)}`,
    seed,
    locale: opts.locale,
    chiefComplaint: tmpl.chiefComplaint,
    patient,
    encounter,
    allergies,
    triageVitals,
    difficulty,
    acuityESI: esiFor(tmpl.physio, difficulty),
    correctDiagnosis,
    differentials,
    redFlags: tmpl.redFlags,
    groundTruth: { history, exam, labs, imaging, vitalsTrajectory },
    expectedWorkup,
    disposition: tmpl.disposition,
    provenance: "generated",
  };
}

/**
 * generateCase — deterministic entrypoint. Same seed => same case.
 * Runs the internal validity check and regenerates (with a derived seed) on
 * failure, up to a small bound (the local analogue of the verify -> loop step).
 */
export function generateCase(opts: GenerateCaseOptions): CaseInstance {
  let seed = deriveSeed(opts);
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = generateOnce(seed, opts);
    if (validateCase(candidate).ok) return candidate;
    // Perturb the seed deterministically and retry.
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  }
  // Last resort: return the final candidate (bands guarantee plausibility).
  return generateOnce(seed, opts);
}
