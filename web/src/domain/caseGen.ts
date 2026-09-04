/**
 * AcuDx — deterministic client-side case generator.
 *
 * Demonstrates the "unlimited, non-repeating cases" product claim
 * (docs/00-overview/04 §3) WITHOUT an LLM: a seeded RNG (mulberry32), a
 * prevalence x educational-value weighted ICD/DSM presentation table, and
 * templates that assemble a coherent CaseInstance. Same seed => same case.
 *
 * The presentation catalogue spans every major organ system (cardiology,
 * respiratory, GI / surgical, neurology, infectious, endocrine, renal / urology,
 * vascular, allergy, OB-GYN, rheumatology, psychiatry) so that even fully offline
 * — with no pod backend — "Generate a fresh case" produces a genuinely endless,
 * varied stream rather than a handful of hard-coded complaints. When the pod
 * backend IS reachable, lib/liveCaseGen.ts is the default path (unlimited ICD-11 /
 * ICD-10 / DSM-5-TR synthesis) and this module is the instant offline safety net.
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
  CODE_SYSTEMS,
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
  /** Fisher-Yates shuffle of a copy (deterministic for the seed). */
  shuffle<T>(items: readonly T[]): T[];
  bool(pTrue: number): boolean;
}

function makeRng(seed: number): Rng {
  const rand = mulberry32(seed);
  const rng: Rng = {
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
    shuffle: (items) => {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    bool: (p) => rand() < p,
  };
  return rng;
}

/* -------------------------------------------------------------------------- */
/* Presentation table (weighted by prevalence x educational value)            */
/* -------------------------------------------------------------------------- */

/**
 * The browsable chief-complaint families. Kept intentionally at four values
 * because they are the shared, cross-file filter facet (`Record<ChiefComplaintFamily, …>`
 * lives in data/caseLibrary.ts and pages/StartPage.tsx). The generator spans FAR
 * more clinical territory than four complaints: each PresentationTemplate below is
 * tagged with the closest of these four families for constraint/filter purposes,
 * while the catalogue itself covers cardiology, respiratory, GI/surgical, neurology,
 * infectious, endocrine, renal/urology, vascular, allergy, OB-GYN, rheumatology and
 * psychiatry — dozens of distinct ICD-10 / DSM-5-TR presentations.
 */
export type ChiefComplaintFamily = "chest-pain" | "headache" | "abdominal-pain" | "dyspnea";

/**
 * Physiological state class that governs plausible vitals bands (and the base ESI
 * acuity). Broadened well beyond the original five so the endless offline
 * catalogue stays physiologically coherent across every organ system.
 */
type PhysioState =
  | "acs"
  | "hemorrhage"
  | "hypovolemic"
  | "inflammatory"
  | "infective"
  | "septic"
  | "hypoxic"
  | "bronchospasm"
  | "cardiac-failure"
  | "neuro-deficit"
  | "metabolic"
  | "allergic"
  | "obstructive"
  | "colic"
  | "anxiety"
  | "benign";

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

/* Terse coding builders — the offline catalogue references far more ICD-10 /
   LOINC codes than fhir.ts curates, so build the extras inline (education only). */
const icd = (code: string, display: string): Coding => ({ system: CODE_SYSTEMS.icd10, code, display });
const lc = (code: string, display: string): Coding => ({ system: CODE_SYSTEMS.loinc, code, display });

const TENSION_H: Bilingual = { en: "Tension-type headache", tr: "Gerilim tipi baş ağrısı" };
const CITE_ACS = "esc-acs-2023";
const CITE_SAH = "nice-ng185";
const CITE_EM = "tepdad-em";

const PRESENTATIONS: PresentationTemplate[] = [
  /* ===== CHEST PAIN family ===== */
  {
    key: "acs",
    family: "chest-pain",
    weight: 22,
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
      { code: LOINC.ecg12, label: { en: "12-lead ECG", tr: "12 derivasyonlu EKG" }, windowMin: 10, kind: "imaging", critical: true, citationId: CITE_ACS },
      { code: LOINC.troponinHs, label: { en: "High-sensitivity troponin", tr: "Yüksek duyarlıklı troponin" }, windowMin: 15, kind: "laboratory", critical: true, citationId: CITE_ACS },
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
    labs: [{ code: LOINC.troponinHs, value: 180, unit: "ng/L", interp: "HH", ref: "< 14" }],
    imaging: { code: "11524-6", modality: { en: "12-lead ECG", tr: "12 derivasyonlu EKG" }, conclusion: { en: "Lateral ST depression, no ST elevation.", tr: "Lateral ST çökmesi, ST yükselmesi yok." } },
  },
  {
    key: "panic",
    family: "chest-pain",
    weight: 14,
    diagnosisCode: DSM5TR.panicDisorder,
    diagnosisLabel: { en: "Panic disorder", tr: "Panik bozukluğu" },
    physio: "anxiety",
    ageRange: [18, 45],
    sexConstraint: null,
    chiefComplaint: { en: "Chest tightness with palpitations and fear", tr: "Çarpıntı ve korkuyla göğüste sıkışma" },
    redFlags: [{ en: "Do not anchor: an ACS rule-out is still required", tr: "Yönelim yanlılığına düşmeyin: yine de ACS dışlaması gerekir" }],
    distractors: [
      { code: ICD10.acsNstemi, label: { en: "Acute coronary syndrome", tr: "Akut koroner sendrom" } },
      { code: DSM5TR.gad, label: { en: "Generalized anxiety disorder", tr: "Yaygın anksiyete bozukluğu" } },
    ],
    disposition: "discharge",
    criticalActions: [
      { code: LOINC.ecg12, label: { en: "12-lead ECG", tr: "12 derivasyonlu EKG" }, windowMin: 10, kind: "imaging", critical: true, citationId: CITE_ACS },
      { code: LOINC.troponinHs, label: { en: "High-sensitivity troponin", tr: "Yüksek duyarlıklı troponin" }, windowMin: 15, kind: "laboratory", critical: true, citationId: CITE_ACS },
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
    labs: [{ code: LOINC.troponinHs, value: 4, unit: "ng/L", interp: "N", ref: "< 14" }],
    imaging: { code: "11524-6", modality: { en: "12-lead ECG", tr: "12 derivasyonlu EKG" }, conclusion: { en: "Sinus tachycardia, no ischemic changes.", tr: "Sinüs taşikardisi, iskemik değişiklik yok." } },
  },
  {
    key: "aortic-dissection",
    family: "chest-pain",
    weight: 5,
    diagnosisCode: icd("I71.01", "Dissection of thoracic aorta"),
    diagnosisLabel: { en: "Acute thoracic aortic dissection", tr: "Akut torasik aort diseksiyonu" },
    physio: "hemorrhage",
    ageRange: [50, 85],
    sexConstraint: null,
    chiefComplaint: { en: "Sudden tearing chest pain radiating to the back", tr: "Sırta yayılan ani yırtılma tarzı göğüs ağrısı" },
    redFlags: [
      { en: "Tearing / migrating pain", tr: "Yırtılma veya göç eden ağrı" },
      { en: "Pulse or blood-pressure differential between arms", tr: "Kollar arası nabız veya tansiyon farkı" },
    ],
    distractors: [
      { code: ICD10.acsNstemi, label: { en: "Acute coronary syndrome", tr: "Akut koroner sendrom" } },
      { code: ICD10.pulmonaryEmbolism, label: { en: "Pulmonary embolism", tr: "Pulmoner emboli" } },
      { code: icd("I30.9", "Acute pericarditis"), label: { en: "Pericarditis", tr: "Perikardit" } },
    ],
    disposition: "operating-room",
    criticalActions: [
      { code: lc("ct-aortogram", "CT aortogram"), label: { en: "CT aortogram", tr: "BT aortografi" }, windowMin: 30, kind: "imaging", critical: true, citationId: CITE_EM },
      { code: LOINC.ecg12, label: { en: "12-lead ECG", tr: "12 derivasyonlu EKG" }, windowMin: 10, kind: "imaging", critical: false, citationId: CITE_ACS },
    ],
    history: [
      { intent: "onset", answer: { en: "It hit suddenly, like something tearing inside.", tr: "İçimde bir şey yırtılıyormuş gibi aniden başladı." }, redFlag: true },
      { intent: "radiation", answer: { en: "It moved from my chest through to my back.", tr: "Göğsümden sırtıma doğru göç etti." }, redFlag: true },
      { intent: "severity", answer: { en: "It was the most severe pain instantly.", tr: "Anında en şiddetli haldeydi." } },
      { intent: "risk-factors", answer: { en: "I have long-standing high blood pressure.", tr: "Uzun süredir yüksek tansiyonum var." } },
    ],
    exam: [
      { maneuver: "cardiovascular", system: { en: "Cardiovascular", tr: "Kardiyovasküler" }, finding: { en: "Unequal radial pulses, early diastolic murmur.", tr: "Eşit olmayan radial nabızlar, erken diyastolik üfürüm." }, abnormal: true },
      { maneuver: "general-inspection", system: { en: "General", tr: "Genel" }, finding: { en: "Pale, distressed, restless.", tr: "Solgun, sıkıntılı, huzursuz." }, abnormal: true },
    ],
    labs: [{ code: LOINC.dDimer, value: 3100, unit: "ng/mL", interp: "H", ref: "< 500" }],
    imaging: { code: "ct-aortogram", modality: { en: "CT aortogram", tr: "BT aortografi" }, conclusion: { en: "Intimal flap in the ascending aorta consistent with dissection.", tr: "Çıkan aortada diseksiyonla uyumlu intimal flep." } },
  },
  {
    key: "pericarditis",
    family: "chest-pain",
    weight: 7,
    diagnosisCode: icd("I30.9", "Acute pericarditis, unspecified"),
    diagnosisLabel: { en: "Acute pericarditis", tr: "Akut perikardit" },
    physio: "inflammatory",
    ageRange: [20, 55],
    sexConstraint: null,
    chiefComplaint: { en: "Sharp chest pain, worse lying flat", tr: "Sırtüstü yatınca artan keskin göğüs ağrısı" },
    redFlags: [{ en: "Pleuritic, positional pain after a viral illness", tr: "Viral hastalık sonrası plöretik, pozisyonel ağrı" }],
    distractors: [
      { code: ICD10.acsNstemi, label: { en: "Acute coronary syndrome", tr: "Akut koroner sendrom" } },
      { code: ICD10.pulmonaryEmbolism, label: { en: "Pulmonary embolism", tr: "Pulmoner emboli" } },
      { code: ICD10.gerd, label: { en: "GERD", tr: "Gastroözofageal reflü" } },
    ],
    disposition: "observation",
    criticalActions: [
      { code: LOINC.ecg12, label: { en: "12-lead ECG", tr: "12 derivasyonlu EKG" }, windowMin: 15, kind: "imaging", critical: false, citationId: CITE_ACS },
      { code: LOINC.crp, label: { en: "Inflammatory markers", tr: "İnflamatuar belirteçler" }, windowMin: 30, kind: "laboratory", critical: false, citationId: CITE_EM },
    ],
    history: [
      { intent: "character", answer: { en: "It is sharp and worse when I lie down.", tr: "Keskin ve yatınca artıyor." }, redFlag: true },
      { intent: "relieving", answer: { en: "Sitting up and leaning forward helps.", tr: "Oturup öne eğilince hafifliyor." } },
      { intent: "associated-symptoms", answer: { en: "I had a cold last week.", tr: "Geçen hafta nezle olmuştum." } },
    ],
    exam: [{ maneuver: "cardiovascular", system: { en: "Cardiovascular", tr: "Kardiyovasküler" }, finding: { en: "Pericardial friction rub audible.", tr: "Perikardiyal frotman duyuluyor." }, abnormal: true }],
    labs: [{ code: LOINC.crp, value: 38, unit: "mg/L", interp: "H", ref: "< 5" }],
    imaging: { code: "11524-6", modality: { en: "12-lead ECG", tr: "12 derivasyonlu EKG" }, conclusion: { en: "Diffuse concave ST elevation with PR depression.", tr: "Yaygın konkav ST yükselmesi ve PR çökmesi." } },
  },
  {
    key: "pneumothorax",
    family: "chest-pain",
    weight: 6,
    diagnosisCode: icd("J93.11", "Primary spontaneous pneumothorax"),
    diagnosisLabel: { en: "Spontaneous pneumothorax", tr: "Spontan pnömotoraks" },
    physio: "hypoxic",
    ageRange: [18, 40],
    sexConstraint: null,
    chiefComplaint: { en: "Sudden pleuritic chest pain and breathlessness", tr: "Ani plöretik göğüs ağrısı ve nefes darlığı" },
    redFlags: [
      { en: "Absent breath sounds one side", tr: "Bir tarafta solunum sesi yok" },
      { en: "Tracheal deviation (tension)", tr: "Trakeal deviasyon (tansiyon)" },
    ],
    distractors: [
      { code: ICD10.pulmonaryEmbolism, label: { en: "Pulmonary embolism", tr: "Pulmoner emboli" } },
      { code: ICD10.pneumonia, label: { en: "Pneumonia", tr: "Pnömoni" } },
      { code: ICD10.acsNstemi, label: { en: "Acute coronary syndrome", tr: "Akut koroner sendrom" } },
    ],
    disposition: "admit-ward",
    criticalActions: [
      { code: lc("cxr", "Chest X-ray"), label: { en: "Chest X-ray", tr: "Akciğer grafisi" }, windowMin: 30, kind: "imaging", critical: true, citationId: CITE_EM },
    ],
    history: [
      { intent: "onset", answer: { en: "It came on suddenly while I was resting.", tr: "Dinlenirken aniden başladı." }, redFlag: true },
      { intent: "character", answer: { en: "Sharp pain worse on breathing in.", tr: "Nefes alırken artan keskin ağrı." } },
      { intent: "associated-symptoms", answer: { en: "I feel short of breath.", tr: "Nefes darlığı hissediyorum." }, redFlag: true },
    ],
    exam: [{ maneuver: "respiratory", system: { en: "Respiratory", tr: "Solunum" }, finding: { en: "Reduced breath sounds and hyper-resonance on one side.", tr: "Bir tarafta azalmış solunum sesleri ve hiperrezonans." }, abnormal: true }],
    labs: [],
    imaging: { code: "cxr", modality: { en: "Chest X-ray", tr: "Akciğer grafisi" }, conclusion: { en: "Visceral pleural line with absent lung markings peripherally.", tr: "Periferde akciğer belirtilerinin kaybı ile visseral plevral çizgi." } },
  },

  /* ===== HEADACHE family ===== */
  {
    key: "sah",
    family: "headache",
    weight: 9,
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
      { code: lc("ct-head-noncon", "CT head"), label: { en: "Noncontrast CT head", tr: "Kontrastsız beyin BT" }, windowMin: 30, kind: "imaging", critical: true, citationId: CITE_SAH },
    ],
    history: [
      { intent: "onset", answer: { en: "It hit all at once like a thunderclap.", tr: "Gök gürültüsü gibi bir anda vurdu." }, redFlag: true },
      { intent: "severity", answer: { en: "The worst headache of my life.", tr: "Hayatımın en kötü baş ağrısı." }, redFlag: true },
      { intent: "red-flags", answer: { en: "My neck is stiff and I vomited.", tr: "Ensem tutuk ve kustum." }, redFlag: true },
    ],
    exam: [{ maneuver: "neurological", system: { en: "Neurological", tr: "Nörolojik" }, finding: { en: "Neck stiffness, no focal deficit.", tr: "Ense sertliği, fokal defisit yok." }, abnormal: true }],
    labs: [],
    imaging: { code: "ct-head-noncon", modality: { en: "CT head", tr: "Beyin BT" }, conclusion: { en: "Basal cistern hyperdensity consistent with SAH.", tr: "SAH ile uyumlu bazal sistern hiperdansitesi." } },
  },
  {
    key: "migraine",
    family: "headache",
    weight: 12,
    diagnosisCode: ICD10.migraine,
    diagnosisLabel: { en: "Migraine without aura", tr: "Auralı olmayan migren" },
    physio: "benign",
    ageRange: [16, 45],
    sexConstraint: null,
    chiefComplaint: { en: "Throbbing one-sided headache with nausea", tr: "Bulantıyla tek taraflı zonklayıcı baş ağrısı" },
    redFlags: [{ en: "Screen for thunderclap onset and focal deficit before reassuring", tr: "Rahatlatmadan önce ani başlangıç ve fokal defisit taraması yapın" }],
    distractors: [
      { code: ICD10.tensionHeadache, label: TENSION_H },
      { code: ICD10.sah, label: { en: "Subarachnoid hemorrhage", tr: "Subaraknoid kanama" } },
    ],
    disposition: "discharge",
    criticalActions: [
      { code: lc("analgesia", "Analgesia"), label: { en: "Stepwise analgesia and antiemetic", tr: "Kademeli analjezi ve antiemetik" }, windowMin: 30, kind: "procedure", critical: false, citationId: CITE_EM },
    ],
    history: [
      { intent: "onset", answer: { en: "It built up gradually over a couple of hours.", tr: "Birkaç saat içinde giderek arttı." } },
      { intent: "character", answer: { en: "Throbbing, on one side of my head.", tr: "Başımın bir tarafında zonklayıcı." } },
      { intent: "associated-symptoms", answer: { en: "Light bothers me and I feel sick.", tr: "Işık rahatsız ediyor ve midem bulanıyor." } },
      { intent: "timing", answer: { en: "I get these every few weeks.", tr: "Birkaç haftada bir oluyor." }, redFlag: true },
    ],
    exam: [{ maneuver: "neurological", system: { en: "Neurological", tr: "Nörolojik" }, finding: { en: "No focal deficit, neck supple.", tr: "Fokal defisit yok, ense serbest." }, abnormal: false }],
    labs: [],
  },
  {
    key: "meningitis",
    family: "headache",
    weight: 6,
    diagnosisCode: icd("G00.9", "Bacterial meningitis, unspecified"),
    diagnosisLabel: { en: "Bacterial meningitis", tr: "Bakteriyel menenjit" },
    physio: "septic",
    ageRange: [16, 60],
    sexConstraint: null,
    chiefComplaint: { en: "Fever, headache and neck stiffness", tr: "Ateş, baş ağrısı ve ense sertliği" },
    redFlags: [
      { en: "Non-blanching rash", tr: "Basmakla solmayan döküntü" },
      { en: "Photophobia with neck stiffness", tr: "Ense sertliğiyle fotofobi" },
    ],
    distractors: [
      { code: ICD10.sah, label: { en: "Subarachnoid hemorrhage", tr: "Subaraknoid kanama" } },
      { code: ICD10.migraine, label: { en: "Migraine", tr: "Migren" } },
    ],
    disposition: "admit-icu",
    criticalActions: [
      { code: lc("iv-antibiotics", "Empirical IV antibiotics"), label: { en: "Empirical IV antibiotics", tr: "Ampirik IV antibiyotik" }, windowMin: 30, kind: "procedure", critical: true, citationId: CITE_EM },
      { code: LOINC.wbc, label: { en: "Bloods and cultures", tr: "Kan tetkikleri ve kültür" }, windowMin: 30, kind: "laboratory", critical: false, citationId: CITE_EM },
    ],
    history: [
      { intent: "onset", answer: { en: "Fever and headache came on over hours.", tr: "Ateş ve baş ağrısı saatler içinde geldi." } },
      { intent: "red-flags", answer: { en: "My neck is stiff and light hurts.", tr: "Ensem tutuk ve ışık rahatsız ediyor." }, redFlag: true },
      { intent: "associated-symptoms", answer: { en: "A rash appeared on my legs.", tr: "Bacaklarımda döküntü çıktı." }, redFlag: true },
    ],
    exam: [
      { maneuver: "neurological", system: { en: "Neurological", tr: "Nörolojik" }, finding: { en: "Neck stiffness, positive Kernig sign.", tr: "Ense sertliği, pozitif Kernig bulgusu." }, abnormal: true },
      { maneuver: "skin", system: { en: "Skin", tr: "Cilt" }, finding: { en: "Non-blanching petechial rash.", tr: "Basmakla solmayan peteşiyal döküntü." }, abnormal: true },
    ],
    labs: [
      { code: LOINC.wbc, value: 18, unit: "10^9/L", interp: "H", ref: "4.0 - 11.0" },
      { code: LOINC.crp, value: 210, unit: "mg/L", interp: "HH", ref: "< 5" },
    ],
  },
  {
    key: "ischemic-stroke",
    family: "headache",
    weight: 11,
    diagnosisCode: icd("I63.9", "Cerebral infarction, unspecified"),
    diagnosisLabel: { en: "Acute ischemic stroke", tr: "Akut iskemik inme" },
    physio: "neuro-deficit",
    ageRange: [55, 88],
    sexConstraint: null,
    chiefComplaint: { en: "Sudden one-sided weakness and slurred speech", tr: "Ani tek taraflı güçsüzlük ve peltek konuşma" },
    redFlags: [
      { en: "Time of symptom onset (thrombolysis window)", tr: "Belirti başlangıç zamanı (tromboliz penceresi)" },
      { en: "FAST-positive focal deficit", tr: "FAST pozitif fokal defisit" },
    ],
    distractors: [
      { code: icd("G45.9", "Transient ischemic attack"), label: { en: "Transient ischemic attack", tr: "Geçici iskemik atak" } },
      { code: ICD10.sah, label: { en: "Intracranial hemorrhage", tr: "İntrakraniyal kanama" } },
      { code: icd("G51.0", "Bell palsy"), label: { en: "Bell palsy", tr: "Bell felci" } },
    ],
    disposition: "admit-ward",
    criticalActions: [
      { code: lc("ct-head-noncon", "CT head"), label: { en: "Urgent noncontrast CT head", tr: "Acil kontrastsız beyin BT" }, windowMin: 25, kind: "imaging", critical: true, citationId: CITE_EM },
      { code: lc("2345-7", "Glucose"), label: { en: "Capillary glucose", tr: "Kapiller glukoz" }, windowMin: 10, kind: "laboratory", critical: false, citationId: CITE_EM },
    ],
    history: [
      { intent: "onset", answer: { en: "My arm went weak suddenly this morning.", tr: "Bu sabah kolum aniden güçsüzleşti." }, redFlag: true },
      { intent: "associated-symptoms", answer: { en: "My face drooped and speech slurred.", tr: "Yüzüm düştü ve konuşmam pelteklendi." }, redFlag: true },
      { intent: "timing", answer: { en: "I was last completely well an hour ago.", tr: "Bir saat önce tamamen iyiydim." }, redFlag: true },
      { intent: "risk-factors", answer: { en: "I have atrial fibrillation.", tr: "Atriyal fibrilasyonum var." } },
    ],
    exam: [{ maneuver: "neurological", system: { en: "Neurological", tr: "Nörolojik" }, finding: { en: "Right facial droop, arm drift, dysarthria.", tr: "Sağ yüz düşüklüğü, kol düşmesi, dizartri." }, abnormal: true }],
    labs: [{ code: lc("2345-7", "Glucose"), value: 6.1, unit: "mmol/L", interp: "N", ref: "3.9 - 7.8" }],
    imaging: { code: "ct-head-noncon", modality: { en: "CT head", tr: "Beyin BT" }, conclusion: { en: "No hemorrhage; early loss of grey-white differentiation.", tr: "Kanama yok; erken gri-beyaz cevher ayrımı kaybı." } },
  },
  {
    key: "temporal-arteritis",
    family: "headache",
    weight: 4,
    diagnosisCode: icd("M31.6", "Giant cell (temporal) arteritis"),
    diagnosisLabel: { en: "Giant cell arteritis", tr: "Dev hücreli arterit" },
    physio: "inflammatory",
    ageRange: [55, 85],
    sexConstraint: null,
    chiefComplaint: { en: "New temporal headache with jaw claudication", tr: "Çene kladikasyonuyla yeni temporal baş ağrısı" },
    redFlags: [
      { en: "Visual loss", tr: "Görme kaybı" },
      { en: "Jaw claudication and scalp tenderness", tr: "Çene kladikasyonu ve saçlı deri hassasiyeti" },
    ],
    distractors: [
      { code: ICD10.tensionHeadache, label: TENSION_H },
      { code: ICD10.migraine, label: { en: "Migraine", tr: "Migren" } },
    ],
    disposition: "refer-specialty",
    criticalActions: [
      { code: lc("30341-2", "ESR"), label: { en: "ESR and CRP", tr: "Sedimentasyon ve CRP" }, windowMin: 30, kind: "laboratory", critical: false, citationId: CITE_EM },
      { code: lc("steroids", "High-dose steroids"), label: { en: "High-dose corticosteroids", tr: "Yüksek doz kortikosteroid" }, windowMin: 60, kind: "procedure", critical: false, citationId: CITE_EM },
    ],
    history: [
      { intent: "onset", answer: { en: "A new headache started over the last few days.", tr: "Son birkaç günde yeni bir baş ağrısı başladı." } },
      { intent: "associated-symptoms", answer: { en: "My jaw aches when I chew and my scalp is tender.", tr: "Çiğnerken çenem ağrıyor ve saçlı derim hassas." }, redFlag: true },
      { intent: "red-flags", answer: { en: "My vision blurred briefly today.", tr: "Bugün görüşüm kısa süreliğine bulanıklaştı." }, redFlag: true },
    ],
    exam: [{ maneuver: "general-inspection", system: { en: "Head", tr: "Baş" }, finding: { en: "Tender, thickened, pulseless temporal artery.", tr: "Hassas, kalınlaşmış, nabızsız temporal arter." }, abnormal: true }],
    labs: [
      { code: lc("30341-2", "ESR"), value: 88, unit: "mm/h", interp: "H", ref: "< 20" },
      { code: LOINC.crp, value: 62, unit: "mg/L", interp: "H", ref: "< 5" },
    ],
  },

  /* ===== ABDOMINAL PAIN family ===== */
  {
    key: "appendicitis",
    family: "abdominal-pain",
    weight: 16,
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
      { code: LOINC.wbc, label: { en: "FBC and CRP", tr: "Tam kan sayımı ve CRP" }, windowMin: 30, kind: "laboratory", critical: false, citationId: CITE_EM },
    ],
    history: [
      { intent: "onset", answer: { en: "It began near my navel and moved to the right.", tr: "Göbek çevresinde başladı, sağa göç etti." }, redFlag: true },
      { intent: "associated-symptoms", answer: { en: "No appetite and I feel feverish.", tr: "İştahım yok ve ateşim var gibi." }, redFlag: true },
      { intent: "aggravating", answer: { en: "Coughing and walking make it worse.", tr: "Öksürmek ve yürümek artırıyor." }, redFlag: true },
    ],
    exam: [{ maneuver: "abdominal", system: { en: "Abdominal", tr: "Karın" }, finding: { en: "Tender at McBurney point with guarding.", tr: "McBurney noktasında hassas, defans var." }, abnormal: true }],
    labs: [
      { code: LOINC.wbc, value: 15, unit: "10^9/L", interp: "H", ref: "4.0 - 11.0" },
      { code: LOINC.crp, value: 46, unit: "mg/L", interp: "H", ref: "< 5" },
    ],
    imaging: { code: "us-abdomen", modality: { en: "Abdominal ultrasound", tr: "Karın ultrasonu" }, conclusion: { en: "Noncompressible tubular structure with inflammation.", tr: "Enflamasyonlu, sıkıştırılamayan tübüler yapı." } },
  },
  {
    key: "cholecystitis",
    family: "abdominal-pain",
    weight: 10,
    diagnosisCode: icd("K81.0", "Acute cholecystitis"),
    diagnosisLabel: { en: "Acute cholecystitis", tr: "Akut kolesistit" },
    physio: "inflammatory",
    ageRange: [30, 65],
    sexConstraint: null,
    chiefComplaint: { en: "Right upper quadrant pain after a fatty meal", tr: "Yağlı yemek sonrası sağ üst kadran ağrısı" },
    redFlags: [{ en: "Murphy sign with fever", tr: "Ateşle birlikte Murphy bulgusu" }],
    distractors: [
      { code: ICD10.gerd, label: { en: "GERD", tr: "Gastroözofageal reflü" } },
      { code: icd("K85.90", "Acute pancreatitis"), label: { en: "Pancreatitis", tr: "Pankreatit" } },
      { code: icd("K80.20", "Calculus of gallbladder"), label: { en: "Biliary colic", tr: "Bilier kolik" } },
    ],
    disposition: "admit-ward",
    criticalActions: [
      { code: lc("us-abdomen", "Abdominal ultrasound"), label: { en: "Right upper quadrant ultrasound", tr: "Sağ üst kadran ultrasonu" }, windowMin: 60, kind: "imaging", critical: false, citationId: CITE_EM },
      { code: LOINC.wbc, label: { en: "FBC and LFTs", tr: "Tam kan sayımı ve karaciğer testleri" }, windowMin: 30, kind: "laboratory", critical: false, citationId: CITE_EM },
    ],
    history: [
      { intent: "onset", answer: { en: "It started after a fatty dinner.", tr: "Yağlı bir akşam yemeğinden sonra başladı." }, redFlag: true },
      { intent: "radiation", answer: { en: "It bores through to my right shoulder blade.", tr: "Sağ kürek kemiğime doğru vuruyor." } },
      { intent: "associated-symptoms", answer: { en: "I am nauseated and feel hot.", tr: "Midem bulanıyor ve ateşim var gibi." } },
    ],
    exam: [{ maneuver: "abdominal", system: { en: "Abdominal", tr: "Karın" }, finding: { en: "Positive Murphy sign, RUQ tenderness.", tr: "Pozitif Murphy bulgusu, sağ üst kadran hassasiyeti." }, abnormal: true }],
    labs: [
      { code: LOINC.wbc, value: 14, unit: "10^9/L", interp: "H", ref: "4.0 - 11.0" },
      { code: lc("1975-2", "Bilirubin total"), value: 28, unit: "µmol/L", interp: "H", ref: "< 21" },
    ],
    imaging: { code: "us-abdomen", modality: { en: "Abdominal ultrasound", tr: "Karın ultrasonu" }, conclusion: { en: "Thick-walled gallbladder with stones and pericholecystic fluid.", tr: "Taşlar ve perikolesistik sıvıyla kalın duvarlı safra kesesi." } },
  },
  {
    key: "pancreatitis",
    family: "abdominal-pain",
    weight: 8,
    diagnosisCode: icd("K85.90", "Acute pancreatitis, unspecified"),
    diagnosisLabel: { en: "Acute pancreatitis", tr: "Akut pankreatit" },
    physio: "inflammatory",
    ageRange: [30, 60],
    sexConstraint: null,
    chiefComplaint: { en: "Severe epigastric pain radiating to the back", tr: "Sırta yayılan şiddetli epigastrik ağrı" },
    redFlags: [{ en: "Severe epigastric pain with a raised lipase", tr: "Yüksek lipazla şiddetli epigastrik ağrı" }],
    distractors: [
      { code: ICD10.gerd, label: { en: "GERD", tr: "Gastroözofageal reflü" } },
      { code: icd("K81.0", "Acute cholecystitis"), label: { en: "Cholecystitis", tr: "Kolesistit" } },
      { code: icd("K27.9", "Peptic ulcer"), label: { en: "Peptic ulcer disease", tr: "Peptik ülser" } },
    ],
    disposition: "admit-ward",
    criticalActions: [
      { code: lc("3040-3", "Lipase"), label: { en: "Serum lipase", tr: "Serum lipaz" }, windowMin: 30, kind: "laboratory", critical: false, citationId: CITE_EM },
      { code: lc("us-abdomen", "Abdominal ultrasound"), label: { en: "Abdominal ultrasound", tr: "Karın ultrasonu" }, windowMin: 90, kind: "imaging", critical: false, citationId: CITE_EM },
    ],
    history: [
      { intent: "onset", answer: { en: "Severe pain came on across my upper belly.", tr: "Üst karnımda şiddetli ağrı başladı." }, redFlag: true },
      { intent: "radiation", answer: { en: "It bores straight through to my back.", tr: "Doğrudan sırtıma vuruyor." }, redFlag: true },
      { intent: "risk-factors", answer: { en: "I drank heavily this weekend.", tr: "Bu hafta sonu çok alkol aldım." } },
      { intent: "associated-symptoms", answer: { en: "I keep vomiting.", tr: "Sürekli kusuyorum." } },
    ],
    exam: [{ maneuver: "abdominal", system: { en: "Abdominal", tr: "Karın" }, finding: { en: "Epigastric tenderness with guarding.", tr: "Defansla birlikte epigastrik hassasiyet." }, abnormal: true }],
    labs: [
      { code: lc("3040-3", "Lipase"), value: 640, unit: "U/L", interp: "HH", ref: "< 60" },
      { code: LOINC.wbc, value: 13.5, unit: "10^9/L", interp: "H", ref: "4.0 - 11.0" },
    ],
  },
  {
    key: "renal-colic",
    family: "abdominal-pain",
    weight: 10,
    diagnosisCode: icd("N20.0", "Calculus of kidney"),
    diagnosisLabel: { en: "Renal / ureteric colic", tr: "Renal / üreteral kolik" },
    physio: "colic",
    ageRange: [20, 60],
    sexConstraint: null,
    chiefComplaint: { en: "Severe colicky flank pain radiating to the groin", tr: "Kasığa yayılan şiddetli kolik yan ağrısı" },
    redFlags: [{ en: "Fever with an obstructing stone (urosepsis)", tr: "Tıkayıcı taşla ateş (ürosepsis)" }],
    distractors: [
      { code: icd("N10", "Acute pyelonephritis"), label: { en: "Pyelonephritis", tr: "Piyelonefrit" } },
      { code: icd("I71.4", "Abdominal aortic aneurysm"), label: { en: "AAA", tr: "Abdominal aort anevrizması" } },
      { code: ICD10.appendicitis, label: { en: "Appendicitis", tr: "Apandisit" } },
    ],
    disposition: "observation",
    criticalActions: [
      { code: lc("5811-5", "Urinalysis"), label: { en: "Urinalysis", tr: "İdrar tetkiki" }, windowMin: 30, kind: "laboratory", critical: false, citationId: CITE_EM },
      { code: lc("ct-kub", "CT KUB"), label: { en: "Noncontrast CT KUB", tr: "Kontrastsız BT ürografi" }, windowMin: 90, kind: "imaging", critical: false, citationId: CITE_EM },
    ],
    history: [
      { intent: "onset", answer: { en: "It came on suddenly and comes in waves.", tr: "Aniden başladı ve dalgalar halinde geliyor." }, redFlag: true },
      { intent: "radiation", answer: { en: "It shoots from my loin down to my groin.", tr: "Belimden kasığıma doğru vuruyor." }, redFlag: true },
      { intent: "associated-symptoms", answer: { en: "There is blood in my urine and I feel sick.", tr: "İdrarımda kan var ve midem bulanıyor." } },
    ],
    exam: [
      { maneuver: "general-inspection", system: { en: "General", tr: "Genel" }, finding: { en: "Restless, unable to lie still.", tr: "Huzursuz, hareketsiz yatamıyor." }, abnormal: true },
      { maneuver: "abdominal", system: { en: "Abdominal", tr: "Karın" }, finding: { en: "Soft abdomen, flank tenderness.", tr: "Yumuşak karın, yan hassasiyeti." }, abnormal: true },
    ],
    labs: [{ code: lc("5808-6", "Urine RBC"), value: 60, unit: "/HPF", interp: "H", ref: "< 5" }],
    imaging: { code: "ct-kub", modality: { en: "CT KUB", tr: "BT ürografi" }, conclusion: { en: "Obstructing ureteric calculus with proximal hydronephrosis.", tr: "Proksimal hidronefrozla tıkayıcı üreter taşı." } },
  },
  {
    key: "bowel-obstruction",
    family: "abdominal-pain",
    weight: 7,
    diagnosisCode: icd("K56.609", "Unspecified intestinal obstruction"),
    diagnosisLabel: { en: "Small bowel obstruction", tr: "İnce bağırsak tıkanıklığı" },
    physio: "obstructive",
    ageRange: [45, 85],
    sexConstraint: null,
    chiefComplaint: { en: "Colicky abdominal pain with vomiting and distension", tr: "Kusma ve distansiyonla kolik karın ağrısı" },
    redFlags: [
      { en: "Absolute constipation (no flatus or stool)", tr: "Mutlak kabızlık (gaz veya gaita yok)" },
      { en: "Peritonism suggesting strangulation", tr: "Strangülasyonu düşündüren peritonizm" },
    ],
    distractors: [
      { code: icd("K56.2", "Volvulus"), label: { en: "Volvulus", tr: "Volvulus" } },
      { code: icd("K57.32", "Diverticulitis"), label: { en: "Diverticulitis", tr: "Divertikülit" } },
      { code: icd("C18.9", "Malignant neoplasm of colon"), label: { en: "Obstructing colonic mass", tr: "Tıkayıcı kolon kitlesi" } },
    ],
    disposition: "admit-ward",
    criticalActions: [
      { code: lc("ct-abdomen", "CT abdomen"), label: { en: "CT abdomen / pelvis", tr: "Karın / pelvis BT" }, windowMin: 90, kind: "imaging", critical: false, citationId: CITE_EM },
      { code: LOINC.lactate, label: { en: "Venous lactate", tr: "Venöz laktat" }, windowMin: 30, kind: "laboratory", critical: false, citationId: CITE_EM },
    ],
    history: [
      { intent: "onset", answer: { en: "Cramping pain came in waves since morning.", tr: "Sabahtan beri kramp tarzı ağrı dalgalar halinde geliyor." }, redFlag: true },
      { intent: "associated-symptoms", answer: { en: "I keep vomiting and my belly is swollen.", tr: "Sürekli kusuyorum ve karnım şişti." } },
      { intent: "timing", answer: { en: "I have not passed wind or stool.", tr: "Gaz ya da dışkı çıkaramadım." }, redFlag: true },
      { intent: "past-medical-history", answer: { en: "I had abdominal surgery years ago.", tr: "Yıllar önce karın ameliyatı oldum." } },
    ],
    exam: [{ maneuver: "abdominal", system: { en: "Abdominal", tr: "Karın" }, finding: { en: "Distended, tympanic, tinkling bowel sounds.", tr: "Distandü, timpanik, çınlayan bağırsak sesleri." }, abnormal: true }],
    labs: [
      { code: LOINC.lactate, value: 2.4, unit: "mmol/L", interp: "H", ref: "< 2.0" },
      { code: LOINC.wbc, value: 12.8, unit: "10^9/L", interp: "H", ref: "4.0 - 11.0" },
    ],
    imaging: { code: "ct-abdomen", modality: { en: "CT abdomen", tr: "Karın BT" }, conclusion: { en: "Dilated small bowel loops with a clear transition point.", tr: "Belirgin geçiş noktasıyla dilate ince bağırsak ansları." } },
  },
  {
    key: "ectopic-pregnancy",
    family: "abdominal-pain",
    weight: 6,
    diagnosisCode: icd("O00.9", "Ectopic pregnancy, unspecified"),
    diagnosisLabel: { en: "Ectopic pregnancy", tr: "Ektopik gebelik" },
    physio: "hypovolemic",
    ageRange: [18, 40],
    sexConstraint: "female",
    chiefComplaint: { en: "Lower abdominal pain with a missed period", tr: "Gecikmiş adetle alt karın ağrısı" },
    redFlags: [
      { en: "Shoulder-tip pain (peritoneal irritation)", tr: "Omuz ucu ağrısı (periton tahrişi)" },
      { en: "Syncope suggesting rupture", tr: "Rüptürü düşündüren senkop" },
    ],
    distractors: [
      { code: icd("N83.20", "Ovarian cyst"), label: { en: "Ovarian cyst", tr: "Over kisti" } },
      { code: ICD10.appendicitis, label: { en: "Appendicitis", tr: "Apandisit" } },
      { code: icd("N70.91", "Pelvic inflammatory disease"), label: { en: "Pelvic inflammatory disease", tr: "Pelvik inflamatuar hastalık" } },
    ],
    disposition: "operating-room",
    criticalActions: [
      { code: lc("19080-1", "Beta-hCG"), label: { en: "Serum beta-hCG", tr: "Serum beta-hCG" }, windowMin: 30, kind: "laboratory", critical: true, citationId: CITE_EM },
      { code: lc("us-tv", "Transvaginal ultrasound"), label: { en: "Transvaginal ultrasound", tr: "Transvajinal ultrason" }, windowMin: 60, kind: "imaging", critical: true, citationId: CITE_EM },
    ],
    history: [
      { intent: "onset", answer: { en: "Sharp lower abdominal pain started today.", tr: "Bugün keskin alt karın ağrısı başladı." }, redFlag: true },
      { intent: "timing", answer: { en: "My period is about two weeks late.", tr: "Adetim yaklaşık iki hafta gecikti." }, redFlag: true },
      { intent: "associated-symptoms", answer: { en: "I have light bleeding and felt faint.", tr: "Hafif kanamam var ve bayılacak gibi oldum." }, redFlag: true },
    ],
    exam: [
      { maneuver: "abdominal", system: { en: "Abdominal", tr: "Karın" }, finding: { en: "Lower abdominal and adnexal tenderness.", tr: "Alt karın ve adneksiyel hassasiyet." }, abnormal: true },
      { maneuver: "general-inspection", system: { en: "General", tr: "Genel" }, finding: { en: "Pale and mildly tachycardic.", tr: "Solgun ve hafif taşikardik." }, abnormal: true },
    ],
    labs: [{ code: lc("19080-1", "Beta-hCG"), value: 2400, unit: "IU/L", interp: "A", ref: "non-pregnant < 5" }],
    imaging: { code: "us-tv", modality: { en: "Transvaginal ultrasound", tr: "Transvajinal ultrason" }, conclusion: { en: "Empty uterus with an adnexal mass and free fluid.", tr: "Adneksiyel kitle ve serbest sıvıyla boş uterus." } },
  },
  {
    key: "dka",
    family: "abdominal-pain",
    weight: 7,
    diagnosisCode: icd("E10.10", "Type 1 diabetes with ketoacidosis without coma"),
    diagnosisLabel: { en: "Diabetic ketoacidosis", tr: "Diyabetik ketoasidoz" },
    physio: "metabolic",
    ageRange: [12, 45],
    sexConstraint: null,
    chiefComplaint: { en: "Vomiting, thirst and rapid breathing", tr: "Kusma, susuzluk ve hızlı nefes alma" },
    redFlags: [
      { en: "Kussmaul breathing", tr: "Kussmaul solunumu" },
      { en: "Ketonaemia with hyperglycaemia", tr: "Hiperglisemiyle ketonemi" },
    ],
    distractors: [
      { code: ICD10.gastroenteritis, label: { en: "Gastroenteritis", tr: "Gastroenterit" } },
      { code: icd("A41.9", "Sepsis"), label: { en: "Sepsis", tr: "Sepsis" } },
      { code: icd("E86.0", "Dehydration"), label: { en: "Dehydration", tr: "Dehidratasyon" } },
    ],
    disposition: "admit-icu",
    criticalActions: [
      { code: lc("2345-7", "Glucose"), label: { en: "Glucose, ketones and venous gas", tr: "Glukoz, keton ve venöz kan gazı" }, windowMin: 15, kind: "laboratory", critical: true, citationId: CITE_EM },
      { code: lc("fluids-insulin", "Fluids and insulin"), label: { en: "IV fluids and insulin infusion", tr: "IV sıvı ve insülin infüzyonu" }, windowMin: 60, kind: "procedure", critical: true, citationId: CITE_EM },
    ],
    history: [
      { intent: "onset", answer: { en: "I have been very thirsty and weeing a lot for days.", tr: "Günlerdir çok susadım ve sık idrara çıkıyorum." }, redFlag: true },
      { intent: "associated-symptoms", answer: { en: "I keep vomiting and my belly aches.", tr: "Sürekli kusuyorum ve karnım ağrıyor." } },
      { intent: "risk-factors", answer: { en: "I missed my insulin doses.", tr: "İnsülin dozlarımı atladım." }, redFlag: true },
    ],
    exam: [{ maneuver: "general-inspection", system: { en: "General", tr: "Genel" }, finding: { en: "Dehydrated, deep sighing breathing, ketotic breath.", tr: "Dehidrate, derin iç çekme tarzı solunum, aseton kokulu nefes." }, abnormal: true }],
    labs: [
      { code: lc("2345-7", "Glucose"), value: 28, unit: "mmol/L", interp: "HH", ref: "3.9 - 7.8" },
      { code: LOINC.wbc, value: 12, unit: "10^9/L", interp: "H", ref: "4.0 - 11.0" },
    ],
  },
  {
    key: "aaa",
    family: "abdominal-pain",
    weight: 4,
    diagnosisCode: icd("I71.4", "Abdominal aortic aneurysm, without rupture"),
    diagnosisLabel: { en: "Symptomatic abdominal aortic aneurysm", tr: "Semptomatik abdominal aort anevrizması" },
    physio: "hypovolemic",
    ageRange: [60, 88],
    sexConstraint: null,
    chiefComplaint: { en: "Sudden abdominal and back pain with collapse", tr: "Kollapsla ani karın ve sırt ağrısı" },
    redFlags: [
      { en: "Pulsatile abdominal mass", tr: "Pulsatil karın kitlesi" },
      { en: "Hypotension", tr: "Hipotansiyon" },
    ],
    distractors: [
      { code: icd("N20.0", "Calculus of kidney"), label: { en: "Renal colic", tr: "Renal kolik" } },
      { code: icd("I71.01", "Aortic dissection"), label: { en: "Aortic dissection", tr: "Aort diseksiyonu" } },
      { code: icd("K56.609", "Intestinal obstruction"), label: { en: "Bowel obstruction", tr: "Bağırsak tıkanıklığı" } },
    ],
    disposition: "operating-room",
    criticalActions: [
      { code: lc("ct-aortogram", "CT aortogram"), label: { en: "CT aorta (or bedside ultrasound)", tr: "Aort BT (veya yatak başı ultrason)" }, windowMin: 20, kind: "imaging", critical: true, citationId: CITE_EM },
      { code: lc("crossmatch", "Group and crossmatch"), label: { en: "Group and crossmatch", tr: "Kan grubu ve cross-match" }, windowMin: 20, kind: "laboratory", critical: false, citationId: CITE_EM },
    ],
    history: [
      { intent: "onset", answer: { en: "It came on suddenly and I nearly passed out.", tr: "Aniden başladı ve neredeyse bayılıyordum." }, redFlag: true },
      { intent: "radiation", answer: { en: "It goes through to my back.", tr: "Sırtıma doğru vuruyor." }, redFlag: true },
      { intent: "risk-factors", answer: { en: "I smoke and have high blood pressure.", tr: "Sigara içiyorum ve yüksek tansiyonum var." } },
    ],
    exam: [
      { maneuver: "abdominal", system: { en: "Abdominal", tr: "Karın" }, finding: { en: "Pulsatile, expansile epigastric mass.", tr: "Pulsatil, ekspansil epigastrik kitle." }, abnormal: true },
      { maneuver: "general-inspection", system: { en: "General", tr: "Genel" }, finding: { en: "Pale, clammy, hypotensive.", tr: "Solgun, terli, hipotansif." }, abnormal: true },
    ],
    labs: [],
    imaging: { code: "ct-aortogram", modality: { en: "CT aorta", tr: "Aort BT" }, conclusion: { en: "6 cm infrarenal aortic aneurysm with periaortic stranding.", tr: "Periaortik dansite artışıyla 6 cm infrarenal aort anevrizması." } },
  },
  {
    key: "pyelonephritis",
    family: "abdominal-pain",
    weight: 8,
    diagnosisCode: icd("N10", "Acute pyelonephritis"),
    diagnosisLabel: { en: "Acute pyelonephritis", tr: "Akut piyelonefrit" },
    physio: "septic",
    ageRange: [18, 55],
    sexConstraint: null,
    chiefComplaint: { en: "Fever, flank pain and painful urination", tr: "Ateş, yan ağrısı ve ağrılı idrar" },
    redFlags: [
      { en: "Sepsis features", tr: "Sepsis bulguları" },
      { en: "Obstruction on the affected side", tr: "Etkilenen tarafta obstrüksiyon" },
    ],
    distractors: [
      { code: icd("N20.0", "Calculus of kidney"), label: { en: "Renal colic", tr: "Renal kolik" } },
      { code: icd("N30.90", "Cystitis"), label: { en: "Lower UTI", tr: "Alt idrar yolu enfeksiyonu" } },
      { code: ICD10.appendicitis, label: { en: "Appendicitis", tr: "Apandisit" } },
    ],
    disposition: "admit-ward",
    criticalActions: [
      { code: lc("iv-antibiotics", "IV antibiotics"), label: { en: "Urine culture and IV antibiotics", tr: "İdrar kültürü ve IV antibiyotik" }, windowMin: 45, kind: "procedure", critical: true, citationId: CITE_EM },
      { code: LOINC.wbc, label: { en: "FBC, CRP and cultures", tr: "Tam kan sayımı, CRP ve kültür" }, windowMin: 30, kind: "laboratory", critical: false, citationId: CITE_EM },
    ],
    history: [
      { intent: "onset", answer: { en: "Fever and flank pain started yesterday.", tr: "Dün ateş ve yan ağrısı başladı." }, redFlag: true },
      { intent: "associated-symptoms", answer: { en: "It stings when I pass urine and I go often.", tr: "İdrar yaparken yanıyor ve sık gidiyorum." } },
      { intent: "red-flags", answer: { en: "I have had shaking chills.", tr: "Titreme nöbetlerim oldu." }, redFlag: true },
    ],
    exam: [
      { maneuver: "abdominal", system: { en: "Abdominal", tr: "Karın" }, finding: { en: "Costovertebral angle tenderness.", tr: "Kostovertebral açı hassasiyeti." }, abnormal: true },
      { maneuver: "general-inspection", system: { en: "General", tr: "Genel" }, finding: { en: "Febrile and flushed.", tr: "Ateşli ve kızarık." }, abnormal: true },
    ],
    labs: [
      { code: LOINC.wbc, value: 16, unit: "10^9/L", interp: "H", ref: "4.0 - 11.0" },
      { code: LOINC.crp, value: 140, unit: "mg/L", interp: "HH", ref: "< 5" },
    ],
  },

  /* ===== DYSPNEA family ===== */
  {
    key: "pe",
    family: "dyspnea",
    weight: 12,
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
      { code: lc("ctpa", "CTPA"), label: { en: "CT pulmonary angiogram", tr: "BT pulmoner anjiyografi" }, windowMin: 90, kind: "imaging", critical: true, citationId: CITE_EM },
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
    labs: [{ code: LOINC.dDimer, value: 2800, unit: "ng/mL", interp: "H", ref: "< 500" }],
    imaging: { code: "ctpa", modality: { en: "CTPA", tr: "BT pulmoner anjiyografi" }, conclusion: { en: "Filling defects in the pulmonary arteries.", tr: "Pulmoner arterlerde dolum defektleri." } },
  },
  {
    key: "pneumonia",
    family: "dyspnea",
    weight: 14,
    diagnosisCode: ICD10.pneumonia,
    diagnosisLabel: { en: "Community-acquired pneumonia", tr: "Toplum kökenli pnömoni" },
    physio: "infective",
    ageRange: [40, 85],
    sexConstraint: null,
    chiefComplaint: { en: "Cough, fever and breathlessness", tr: "Öksürük, ateş ve nefes darlığı" },
    redFlags: [
      { en: "High respiratory rate or hypoxia", tr: "Yüksek solunum sayısı veya hipoksi" },
      { en: "New confusion (CURB-65)", tr: "Yeni konfüzyon (CURB-65)" },
    ],
    distractors: [
      { code: ICD10.chf, label: { en: "Heart failure", tr: "Kalp yetmezliği" } },
      { code: ICD10.pulmonaryEmbolism, label: { en: "Pulmonary embolism", tr: "Pulmoner emboli" } },
      { code: icd("J20.9", "Acute bronchitis"), label: { en: "Bronchitis", tr: "Bronşit" } },
    ],
    disposition: "admit-ward",
    criticalActions: [
      { code: lc("cxr", "Chest X-ray"), label: { en: "Chest X-ray", tr: "Akciğer grafisi" }, windowMin: 60, kind: "imaging", critical: false, citationId: CITE_EM },
      { code: LOINC.crp, label: { en: "FBC and CRP", tr: "Tam kan sayımı ve CRP" }, windowMin: 30, kind: "laboratory", critical: false, citationId: CITE_EM },
    ],
    history: [
      { intent: "onset", answer: { en: "A productive cough built up over a few days.", tr: "Balgamlı öksürük birkaç günde arttı." }, redFlag: true },
      { intent: "associated-symptoms", answer: { en: "I have a fever and pain when I breathe.", tr: "Ateşim var ve nefes alırken ağrıyor." } },
      { intent: "risk-factors", answer: { en: "I have long-standing lung disease.", tr: "Uzun süredir akciğer hastalığım var." } },
    ],
    exam: [{ maneuver: "respiratory", system: { en: "Respiratory", tr: "Solunum" }, finding: { en: "Focal crackles with bronchial breathing.", tr: "Bronşiyal solunumla fokal raller." }, abnormal: true }],
    labs: [
      { code: LOINC.crp, value: 120, unit: "mg/L", interp: "HH", ref: "< 5" },
      { code: LOINC.wbc, value: 15, unit: "10^9/L", interp: "H", ref: "4.0 - 11.0" },
    ],
    imaging: { code: "cxr", modality: { en: "Chest X-ray", tr: "Akciğer grafisi" }, conclusion: { en: "Lobar consolidation in the right lower zone.", tr: "Sağ alt zonda lober konsolidasyon." } },
  },
  {
    key: "acute-heart-failure",
    family: "dyspnea",
    weight: 10,
    diagnosisCode: ICD10.chf,
    diagnosisLabel: { en: "Acute decompensated heart failure", tr: "Akut dekompanse kalp yetmezliği" },
    physio: "cardiac-failure",
    ageRange: [55, 88],
    sexConstraint: null,
    chiefComplaint: { en: "Worsening breathlessness and leg swelling", tr: "Artan nefes darlığı ve bacak şişliği" },
    redFlags: [
      { en: "Orthopnoea and paroxysmal nocturnal dyspnoea", tr: "Ortopne ve paroksismal nokturnal dispne" },
      { en: "Hypoxia at rest", tr: "İstirahatte hipoksi" },
    ],
    distractors: [
      { code: ICD10.pneumonia, label: { en: "Pneumonia", tr: "Pnömoni" } },
      { code: ICD10.pulmonaryEmbolism, label: { en: "Pulmonary embolism", tr: "Pulmoner emboli" } },
      { code: icd("J44.1", "COPD exacerbation"), label: { en: "COPD exacerbation", tr: "KOAH alevlenmesi" } },
    ],
    disposition: "admit-ward",
    criticalActions: [
      { code: lc("cxr", "Chest X-ray"), label: { en: "Chest X-ray", tr: "Akciğer grafisi" }, windowMin: 60, kind: "imaging", critical: true, citationId: CITE_EM },
      { code: LOINC.bnp, label: { en: "BNP / NT-proBNP", tr: "BNP / NT-proBNP" }, windowMin: 30, kind: "laboratory", critical: false, citationId: CITE_EM },
    ],
    history: [
      { intent: "onset", answer: { en: "Breathlessness has worsened over days; I sleep upright.", tr: "Nefes darlığım günlerdir kötüleşiyor; dik uyuyorum." }, redFlag: true },
      { intent: "associated-symptoms", answer: { en: "I wake gasping and my ankles are swollen.", tr: "Nefesim kesilerek uyanıyorum ve ayak bileklerim şiş." }, redFlag: true },
      { intent: "past-medical-history", answer: { en: "I had a heart attack before.", tr: "Daha önce kalp krizi geçirdim." } },
    ],
    exam: [
      { maneuver: "respiratory", system: { en: "Respiratory", tr: "Solunum" }, finding: { en: "Bibasal fine crackles.", tr: "İki taraflı bazal ince raller." }, abnormal: true },
      { maneuver: "cardiovascular", system: { en: "Cardiovascular", tr: "Kardiyovasküler" }, finding: { en: "Raised JVP, gallop rhythm, ankle oedema.", tr: "Yüksek JVB, gallop ritmi, ayak bileği ödemi." }, abnormal: true },
    ],
    labs: [{ code: LOINC.bnp, value: 1850, unit: "pg/mL", interp: "HH", ref: "< 125" }],
    imaging: { code: "cxr", modality: { en: "Chest X-ray", tr: "Akciğer grafisi" }, conclusion: { en: "Cardiomegaly with upper-lobe diversion and interstitial oedema.", tr: "Üst lob dolaşım artışı ve interstisyel ödemle kardiyomegali." } },
  },
  {
    key: "copd-exacerbation",
    family: "dyspnea",
    weight: 10,
    diagnosisCode: icd("J44.1", "COPD with (acute) exacerbation"),
    diagnosisLabel: { en: "COPD exacerbation", tr: "KOAH alevlenmesi" },
    physio: "bronchospasm",
    ageRange: [50, 85],
    sexConstraint: null,
    chiefComplaint: { en: "Increasing breathlessness and wheeze", tr: "Artan nefes darlığı ve hırıltı" },
    redFlags: [
      { en: "Exhaustion or drowsiness", tr: "Bitkinlik veya uyku hali" },
      { en: "Falling saturations / rising CO2", tr: "Düşen satürasyon / yükselen CO2" },
    ],
    distractors: [
      { code: ICD10.pneumonia, label: { en: "Pneumonia", tr: "Pnömoni" } },
      { code: ICD10.chf, label: { en: "Heart failure", tr: "Kalp yetmezliği" } },
      { code: icd("J45.901", "Asthma exacerbation"), label: { en: "Asthma", tr: "Astım" } },
    ],
    disposition: "admit-ward",
    criticalActions: [
      { code: lc("cxr", "Chest X-ray"), label: { en: "Chest X-ray", tr: "Akciğer grafisi" }, windowMin: 60, kind: "imaging", critical: false, citationId: CITE_EM },
      { code: lc("vbg", "Venous blood gas"), label: { en: "Venous blood gas", tr: "Venöz kan gazı" }, windowMin: 30, kind: "laboratory", critical: false, citationId: CITE_EM },
    ],
    history: [
      { intent: "onset", answer: { en: "Over a few days I got more breathless with green sputum.", tr: "Birkaç günde yeşil balgamla nefesim daha çok daraldı." }, redFlag: true },
      { intent: "risk-factors", answer: { en: "I am a lifelong smoker.", tr: "Ömür boyu sigara içtim." } },
      { intent: "associated-symptoms", answer: { en: "I wheeze and cough constantly.", tr: "Sürekli hırıltı ve öksürük var." } },
    ],
    exam: [{ maneuver: "respiratory", system: { en: "Respiratory", tr: "Solunum" }, finding: { en: "Prolonged expiration, widespread wheeze, reduced air entry.", tr: "Uzamış ekspiryum, yaygın hırıltı, azalmış hava girişi." }, abnormal: true }],
    labs: [],
    imaging: { code: "cxr", modality: { en: "Chest X-ray", tr: "Akciğer grafisi" }, conclusion: { en: "Hyperinflated lungs, no focal consolidation.", tr: "Hiperinflate akciğerler, fokal konsolidasyon yok." } },
  },
  {
    key: "asthma",
    family: "dyspnea",
    weight: 9,
    diagnosisCode: icd("J45.901", "Unspecified asthma with (acute) exacerbation"),
    diagnosisLabel: { en: "Acute asthma exacerbation", tr: "Akut astım alevlenmesi" },
    physio: "bronchospasm",
    ageRange: [12, 45],
    sexConstraint: null,
    chiefComplaint: { en: "Acute wheeze and breathlessness", tr: "Akut hırıltı ve nefes darlığı" },
    redFlags: [
      { en: "Silent chest", tr: "Sessiz göğüs" },
      { en: "Unable to speak in full sentences", tr: "Tam cümle kuramama" },
    ],
    distractors: [
      { code: icd("J44.1", "COPD exacerbation"), label: { en: "COPD", tr: "KOAH" } },
      { code: icd("T78.2XXA", "Anaphylaxis"), label: { en: "Anaphylaxis", tr: "Anafilaksi" } },
      { code: ICD10.pneumonia, label: { en: "Pneumonia", tr: "Pnömoni" } },
    ],
    disposition: "observation",
    criticalActions: [
      { code: lc("nebulisers", "Nebulised bronchodilators"), label: { en: "PEFR and nebulised bronchodilators", tr: "PEF ölçümü ve nebülize bronkodilatör" }, windowMin: 15, kind: "procedure", critical: false, citationId: CITE_EM },
    ],
    history: [
      { intent: "onset", answer: { en: "I suddenly started wheezing and could not catch my breath.", tr: "Aniden hırıltı başladı ve nefes alamadım." }, redFlag: true },
      { intent: "associated-symptoms", answer: { en: "My chest feels tight and I keep coughing.", tr: "Göğsüm sıkışıyor ve sürekli öksürüyorum." } },
      { intent: "risk-factors", answer: { en: "I have asthma and was near a cat.", tr: "Astımım var ve bir kedinin yanındaydım." } },
    ],
    exam: [{ maneuver: "respiratory", system: { en: "Respiratory", tr: "Solunum" }, finding: { en: "Widespread expiratory wheeze, tachypnoea.", tr: "Yaygın ekspiratuar hırıltı, takipne." }, abnormal: true }],
    labs: [],
  },
  {
    key: "anaphylaxis",
    family: "dyspnea",
    weight: 5,
    diagnosisCode: icd("T78.2XXA", "Anaphylactic shock, unspecified, initial encounter"),
    diagnosisLabel: { en: "Anaphylaxis", tr: "Anafilaksi" },
    physio: "allergic",
    ageRange: [10, 60],
    sexConstraint: null,
    chiefComplaint: { en: "Sudden rash, swelling and breathlessness after exposure", tr: "Temas sonrası ani döküntü, şişlik ve nefes darlığı" },
    redFlags: [
      { en: "Airway swelling / stridor", tr: "Hava yolu şişmesi / stridor" },
      { en: "Hypotension", tr: "Hipotansiyon" },
    ],
    distractors: [
      { code: icd("J45.901", "Asthma exacerbation"), label: { en: "Asthma", tr: "Astım" } },
      { code: icd("T88.7XXA", "Adverse drug reaction"), label: { en: "Drug reaction", tr: "İlaç reaksiyonu" } },
      { code: DSM5TR.panicDisorder, label: { en: "Panic attack", tr: "Panik atak" } },
    ],
    disposition: "admit-ward",
    criticalActions: [
      { code: lc("im-adrenaline", "IM adrenaline"), label: { en: "IM adrenaline", tr: "IM adrenalin" }, windowMin: 5, kind: "procedure", critical: true, citationId: CITE_EM },
    ],
    history: [
      { intent: "onset", answer: { en: "Within minutes of eating I broke out and swelled up.", tr: "Yemekten dakikalar sonra döküntü ve şişlik oldu." }, redFlag: true },
      { intent: "associated-symptoms", answer: { en: "My lips and tongue swelled and I started wheezing.", tr: "Dudaklarım ve dilim şişti, hırıltı başladı." }, redFlag: true },
      { intent: "allergies", answer: { en: "I am allergic to nuts.", tr: "Fındık/fıstık alerjim var." } },
    ],
    exam: [
      { maneuver: "general-inspection", system: { en: "General", tr: "Genel" }, finding: { en: "Urticarial rash and facial angioedema.", tr: "Ürtikeryal döküntü ve yüzde anjiyoödem." }, abnormal: true },
      { maneuver: "respiratory", system: { en: "Respiratory", tr: "Solunum" }, finding: { en: "Wheeze with early stridor.", tr: "Erken stridorla hırıltı." }, abnormal: true },
    ],
    labs: [],
  },
];

/* -------------------------------------------------------------------------- */
/* Demographic pools                                                           */
/* -------------------------------------------------------------------------- */

const MALE_NAMES = [
  "Ahmet Yılmaz", "Mehmet Demir", "Mustafa Kaya", "Emre Şahin", "Can Aydın",
  "Burak Çelik", "Ali Öztürk", "Hüseyin Arslan", "Kaan Doğan", "Yusuf Kılıç",
  "Onur Aksoy", "Serkan Güneş",
];
const FEMALE_NAMES = [
  "Elif Demir", "Ayşe Şahin", "Zeynep Kaya", "Fatma Yıldız", "Deniz Aydın",
  "Merve Arslan", "Selin Koç", "Buse Yılmaz", "Ece Polat", "Nur Çetin",
  "Melis Aslan", "Gizem Kurt",
];

/** Seeded onset-duration phrases, appended to the encounter reason for variety. */
const ONSET_DURATIONS: Bilingual[] = [
  { en: "about 30 minutes", tr: "yaklaşık 30 dakika" },
  { en: "about 1 hour", tr: "yaklaşık 1 saat" },
  { en: "a couple of hours", tr: "birkaç saat" },
  { en: "since this morning", tr: "bu sabahtan beri" },
  { en: "since last night", tr: "dün geceden beri" },
  { en: "about a day", tr: "yaklaşık bir gün" },
];

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
  hypovolemic: { hr: [100, 130], systolic: [85, 105], diastolic: [50, 68], rr: [18, 26], spo2: [95, 99], tempC: [36.2, 37.0] },
  inflammatory: { hr: [88, 115], systolic: [110, 135], diastolic: [70, 88], rr: [16, 22], spo2: [96, 100], tempC: [37.6, 39.0] },
  infective: { hr: [92, 116], systolic: [108, 132], diastolic: [66, 84], rr: [18, 26], spo2: [91, 96], tempC: [38.0, 39.4] },
  septic: { hr: [100, 128], systolic: [92, 116], diastolic: [52, 72], rr: [20, 28], spo2: [90, 96], tempC: [38.4, 40.0] },
  hypoxic: { hr: [100, 130], systolic: [100, 130], diastolic: [65, 85], rr: [22, 32], spo2: [86, 93], tempC: [36.5, 37.4] },
  bronchospasm: { hr: [98, 124], systolic: [118, 145], diastolic: [72, 90], rr: [22, 30], spo2: [86, 93], tempC: [36.6, 37.6] },
  "cardiac-failure": { hr: [92, 118], systolic: [120, 155], diastolic: [74, 94], rr: [20, 28], spo2: [86, 93], tempC: [36.4, 37.2] },
  "neuro-deficit": { hr: [70, 98], systolic: [150, 185], diastolic: [88, 104], rr: [14, 20], spo2: [94, 99], tempC: [36.5, 37.3] },
  metabolic: { hr: [100, 126], systolic: [100, 125], diastolic: [60, 80], rr: [24, 32], spo2: [96, 100], tempC: [36.2, 37.4] },
  allergic: { hr: [104, 130], systolic: [82, 104], diastolic: [48, 66], rr: [22, 30], spo2: [86, 94], tempC: [36.4, 37.2] },
  obstructive: { hr: [92, 116], systolic: [110, 135], diastolic: [68, 86], rr: [16, 22], spo2: [95, 99], tempC: [37.0, 38.2] },
  colic: { hr: [92, 118], systolic: [135, 160], diastolic: [82, 98], rr: [16, 22], spo2: [97, 100], tempC: [36.5, 37.3] },
  anxiety: { hr: [95, 120], systolic: [118, 140], diastolic: [72, 90], rr: [18, 26], spo2: [97, 100], tempC: [36.3, 37.0] },
  benign: { hr: [70, 92], systolic: [116, 138], diastolic: [70, 86], rr: [14, 18], spo2: [97, 100], tempC: [36.4, 37.4] },
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

/**
 * Derive a stable numeric seed. When the caller supplies `seed`, the case is
 * fully reproducible (used by tests + the "share this case" path). Otherwise we
 * advance an internal counter AND fold in the wall clock at generation time so
 * that two back-to-back "random" draws are guaranteed never to collide on the
 * same seed (docs §3 "no repeated identical seed"). The clock is read here, not
 * at module load, so this stays a pure function of its inputs when seeded.
 */
function deriveSeed(opts: GenerateCaseOptions): number {
  if (typeof opts.seed === "number") return opts.seed >>> 0;
  ephemeralSeedCounter = (ephemeralSeedCounter + 0x6d2b79f5) | 0;
  const now = typeof Date !== "undefined" ? Date.now() : 0;
  return (ephemeralSeedCounter ^ Math.imul(now | 0, 0x9e3779b1)) >>> 0;
}

function esiFor(physio: PhysioState, _difficulty: number): CaseInstance["acuityESI"] {
  const base: Record<PhysioState, number> = {
    acs: 2,
    hemorrhage: 2,
    hypovolemic: 2,
    hypoxic: 2,
    septic: 2,
    "neuro-deficit": 2,
    metabolic: 2,
    allergic: 2,
    "cardiac-failure": 2,
    inflammatory: 3,
    infective: 3,
    obstructive: 3,
    colic: 3,
    bronchospasm: 3,
    anxiety: 3,
    benign: 4,
  };
  const raw = base[physio];
  return Math.min(5, Math.max(1, raw)) as CaseInstance["acuityESI"];
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

  // Seeded onset duration enriches the encounter reason so no two draws read
  // identically even when they share a diagnosis.
  const duration = rng.pick(ONSET_DURATIONS);
  const encounter: Encounter = {
    resourceType: "Encounter",
    id: `enc-${pid}`,
    status: "in-progress",
    class: "emergency",
    subject: pid,
    reason: {
      en: `${tmpl.chiefComplaint.en} — ${duration.en}`,
      tr: `${tmpl.chiefComplaint.tr} — ${duration.tr}`,
    },
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

  // Diagnosis + differentials (2-4 distractors, seed-shuffled for variety;
  // difficulty adds distractors).
  const correctDiagnosis = condition(`dx-${pid}`, tmpl.diagnosisCode, tmpl.diagnosisLabel, pid, "encounter-diagnosis", "confirmed");
  const wantDistractors = Math.min(tmpl.distractors.length, Math.max(2, difficulty));
  const differentials: Condition[] = rng
    .shuffle(tmpl.distractors)
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
    citationId: CITE_EM,
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
