/**
 * AcuDx — curated seed CaseInstances (5 fully specified EM cases).
 *
 * Reuses the FHIR-shaped domain model (src/domain/fhir.ts) and the CaseInstance
 * ground-truth model (src/domain/case.ts). Extends the existing chestPainCase
 * shape from src/data/mock.ts into the full EHR-workable ground truth.
 *
 * Cases:
 *   1. em-acs-001    Chest pain / NSTEMI            (ESC ACS 2023)
 *   2. em-sah-002    Thunderclap headache / SAH     (NICE, AHA/ASA)
 *   3. em-appy-003   RLQ abdominal pain / appendicitis (NICE, Alvarado)
 *   4. em-pe-004     Dyspnea / pulmonary embolism   (ESC, Wells/PERC)
 *   5. em-panic-005  Chest pain, panic vs ACS mimic (DSM-5-TR / ESC rule-out)
 *
 * Citation ids match src/data/mock.ts citations[].id where possible and add a
 * few case-specific ids consumed by the feedback layer in a later stage.
 *
 * Education only. Synthetic patients. No real patient data.
 */

import type { Bilingual } from "@/data/mock";
import {
  concept,
  DSM5TR,
  ICD10,
  LOINC,
  type AllergyIntolerance,
  type Coding,
  type Condition,
  type DiagnosticReport,
  type Encounter,
  type Observation,
  type Patient,
} from "@/domain/fhir";
import type {
  CaseInstance,
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
/* Local builder helpers (keep the seed data terse and consistent)            */
/* -------------------------------------------------------------------------- */

const MIN = 60_000;

function patient(
  id: string,
  name: string,
  gender: Patient["gender"],
  ageYears: number,
  extra: Partial<Patient> = {},
): Patient {
  return {
    resourceType: "Patient",
    id,
    name,
    gender,
    ageYears,
    mrn: `SIM-${id.toUpperCase()}`,
    active: true,
    ...extra,
  };
}

function encounter(id: string, subject: string, reason: Bilingual): Encounter {
  return {
    resourceType: "Encounter",
    id: `enc-${id}`,
    status: "in-progress",
    class: "emergency",
    subject,
    reason,
    period: { start: 0 },
  };
}

function dx(
  id: string,
  code: Coding,
  text: Bilingual,
  opts: {
    category?: Condition["category"];
    verification?: Condition["verificationStatus"];
    note?: Bilingual;
    subject: string;
  },
): Condition {
  return {
    resourceType: "Condition",
    id,
    category: opts.category ?? "encounter-diagnosis",
    clinicalStatus: "active",
    verificationStatus: opts.verification ?? "confirmed",
    code: concept(code, text),
    subject: opts.subject,
    ...(opts.note ? { note: opts.note } : {}),
  };
}

function hx(
  id: string,
  intent: QuestionIntent,
  answer: Bilingual,
  redFlag = false,
): HistoryItem {
  return { id, intent, answer, ...(redFlag ? { redFlag } : {}) };
}

function exam(
  id: string,
  maneuver: ExamManeuver,
  system: Bilingual,
  finding: Bilingual,
  abnormal: boolean,
): ExamFinding {
  return { id, maneuver, system, finding, abnormal };
}

function labObs(
  id: string,
  subject: string,
  code: Coding,
  value: number,
  unit: string,
  interpretation: Observation["interpretation"],
  referenceRange: string,
  atMs = 0,
): Observation {
  return {
    resourceType: "Observation",
    id: `obs-${id}`,
    status: "final",
    category: "laboratory",
    code: concept(code),
    subject,
    effectiveTime: atMs,
    valueQuantity: { value, unit },
    interpretation,
    referenceRange,
  };
}

function lab(
  id: string,
  orderCode: string,
  observation: Observation,
): LabResult {
  return { id, orderCode, observation };
}

function report(
  id: string,
  subject: string,
  code: Coding,
  category: DiagnosticReport["category"],
  conclusion: Bilingual,
  result: string[] = [],
): DiagnosticReport {
  return {
    resourceType: "DiagnosticReport",
    id: `rep-${id}`,
    status: "final",
    category,
    code: concept(code),
    subject,
    issued: 0,
    result,
    conclusion,
  };
}

function imaging(
  id: string,
  orderCode: string,
  modality: Bilingual,
  rep: DiagnosticReport,
): ImagingResult {
  return { id, orderCode, modality, report: rep };
}

function order(
  id: string,
  kind: OrderExpectation["kind"],
  code: Coding,
  label: Bilingual,
  idealWindowMin: number,
  critical: boolean,
  citationId: string,
  lowValue = false,
): OrderExpectation {
  return {
    id,
    kind,
    code: concept(code),
    label,
    idealWindowMs: idealWindowMin * MIN,
    critical,
    citationId,
    ...(lowValue ? { lowValue } : {}),
  };
}

function allergyNKDA(patientId: string): AllergyIntolerance[] {
  return [
    {
      resourceType: "AllergyIntolerance",
      id: `alg-${patientId}-nkda`,
      type: "allergy",
      criticality: "low",
      code: concept(
        { system: "http://snomed.info/sct", code: "409137002", display: "No known drug allergy" },
        { en: "No known drug allergies", tr: "Bilinen ilaç alerjisi yok" },
      ),
      patient: patientId,
    },
  ];
}

/** Build a simple deteriorating/steady vitals trajectory over 30 sim minutes. */
function trajectory(base: TriageVitals, drift: Partial<TriageVitals> = {}): VitalsTrajectoryPoint[] {
  const steps = [0, 5, 10, 15, 20, 30];
  return steps.map((min) => {
    const f = min / 30;
    return {
      atMs: min * MIN,
      hr: Math.round(base.hr + (drift.hr ?? 0) * f),
      systolic: Math.round(base.systolic + (drift.systolic ?? 0) * f),
      diastolic: Math.round(base.diastolic + (drift.diastolic ?? 0) * f),
      rr: Math.round(base.rr + (drift.rr ?? 0) * f),
      spo2: Math.round(base.spo2 + (drift.spo2 ?? 0) * f),
      tempC: Number((base.tempC + (drift.tempC ?? 0) * f).toFixed(1)),
    };
  });
}

/* ========================================================================== */
/* Case 1 — Chest pain / NSTEMI                                               */
/* ========================================================================== */

const p1 = patient("acs-001", "Ahmet Yılmaz", "male", 58, { weightKg: 84 });
const acsTriage: TriageVitals = { hr: 104, systolic: 148, diastolic: 92, rr: 20, spo2: 95, tempC: 36.8 };

const chestPainNstemiCase: CaseInstance = {
  id: "em-acs-001",
  seed: 100_001,
  locale: "en",
  chiefComplaint: { en: "Central chest pain radiating to the left arm", tr: "Sol kola yayılan orta hat göğüs ağrısı" },
  patient: p1,
  encounter: encounter("acs-001", p1.id, {
    en: "Central chest pain, 1 hour",
    tr: "Orta hat göğüs ağrısı, 1 saat",
  }),
  allergies: allergyNKDA(p1.id),
  triageVitals: acsTriage,
  difficulty: 3,
  acuityESI: 2,
  correctDiagnosis: dx("dx-acs-001", ICD10.acsNstemi,
    { en: "Non-ST elevation myocardial infarction", tr: "ST yükselmesiz miyokart enfarktüsü" },
    { subject: p1.id, note: { en: "Rising hs-troponin with ischemic ECG changes.", tr: "İskemik EKG değişiklikleriyle yükselen hs-troponin." } }),
  differentials: [
    dx("ddx-acs-ua", ICD10.unstableAngina, { en: "Unstable angina", tr: "Kararsız angina" }, { category: "differential", verification: "differential", subject: p1.id }),
    dx("ddx-acs-gerd", ICD10.gerd, { en: "GERD", tr: "Gastroözofageal reflü" }, { category: "differential", verification: "differential", subject: p1.id }),
    dx("ddx-acs-costo", ICD10.costochondritis, { en: "Costochondritis", tr: "Kostokondrit" }, { category: "differential", verification: "differential", subject: p1.id }),
    dx("ddx-acs-pe", ICD10.pulmonaryEmbolism, { en: "Pulmonary embolism", tr: "Pulmoner emboli" }, { category: "differential", verification: "differential", subject: p1.id }),
  ],
  redFlags: [
    { en: "Ongoing chest pain with diaphoresis and radiation", tr: "Terleme ve yayılımla süren göğüs ağrısı" },
    { en: "Ischemic changes on ECG", tr: "EKG'de iskemik değişiklikler" },
  ],
  groundTruth: {
    history: [
      hx("h-acs-onset", "onset", { en: "It started about an hour ago while I was resting.", tr: "Yaklaşık bir saat önce dinlenirken başladı." }),
      hx("h-acs-char", "character", { en: "It is a heavy pressure, like a weight on my chest.", tr: "Göğsüme ağırlık binmiş gibi ağır bir baskı." }),
      hx("h-acs-rad", "radiation", { en: "It spreads into my left arm and jaw.", tr: "Sol koluma ve çeneme yayılıyor." }, true),
      hx("h-acs-sev", "severity", { en: "About eight out of ten and it has not eased.", tr: "On üzerinden sekiz gibi ve hiç azalmadı." }),
      hx("h-acs-assoc", "associated-symptoms", { en: "I feel sweaty and a little sick to my stomach.", tr: "Terliyorum ve biraz midem bulanıyor." }, true),
      hx("h-acs-rf", "risk-factors", { en: "I have high blood pressure and I used to smoke.", tr: "Yüksek tansiyonum var ve eskiden sigara içerdim." }),
      hx("h-acs-fh", "family-history", { en: "My father had a heart attack at around my age.", tr: "Babam benim yaşlarımda kalp krizi geçirmişti." }, true),
      hx("h-acs-pmh", "past-medical-history", { en: "Hypertension, otherwise well.", tr: "Hipertansiyon, başka bir sorun yok." }),
      hx("h-acs-meds", "medications", { en: "Only a blood pressure tablet each morning.", tr: "Sadece her sabah bir tansiyon hapı." }),
      hx("h-acs-ice", "ice", { en: "I am scared this is my heart, like my father.", tr: "Babam gibi kalbimden korkuyorum." }),
    ],
    exam: [
      exam("e-acs-gen", "general-inspection", { en: "General", tr: "Genel" }, { en: "Anxious, diaphoretic, clutching chest.", tr: "Anksiyöz, terli, göğsünü tutuyor." }, true),
      exam("e-acs-cvs", "cardiovascular", { en: "Cardiovascular", tr: "Kardiyovasküler" }, { en: "Regular rhythm, no murmur, no added sounds.", tr: "Düzenli ritim, üfürüm yok, ek ses yok." }, false),
      exam("e-acs-resp", "respiratory", { en: "Respiratory", tr: "Solunum" }, { en: "Chest clear, equal air entry.", tr: "Akciğerler temiz, eşit hava girişi." }, false),
    ],
    labs: [
      lab("l-acs-trop0", "67151-1", labObs("acs-trop0", p1.id, LOINC.troponinHs, 62, "ng/L", "H", "< 14", 0)),
      lab("l-acs-trop1", "67151-1-1h", labObs("acs-trop1", p1.id, LOINC.troponinHs, 210, "ng/L", "HH", "< 14", 60 * MIN)),
      lab("l-acs-cr", "2160-0", labObs("acs-cr", p1.id, LOINC.creatinine, 0.9, "mg/dL", "N", "0.7 - 1.3", 0)),
    ],
    imaging: [
      imaging("i-acs-ecg", "11524-6", { en: "12-lead ECG", tr: "12 derivasyonlu EKG" },
        report("acs-ecg", p1.id, LOINC.ecg12, "cardiology",
          { en: "ST depression and T-wave inversion in the lateral leads. No ST elevation.", tr: "Lateral derivasyonlarda ST çökmesi ve T dalga inversiyonu. ST yükselmesi yok." })),
    ],
    vitalsTrajectory: trajectory(acsTriage, { hr: 12, spo2: -2 }),
  },
  expectedWorkup: [
    order("w-acs-ecg", "imaging", LOINC.ecg12, { en: "12-lead ECG", tr: "12 derivasyonlu EKG" }, 10, true, "gs_nice_ng185_nstemi_assessment"),
    order("w-acs-trop", "laboratory", LOINC.troponinHs, { en: "High-sensitivity troponin (0/1 h)", tr: "Yüksek duyarlıklı troponin (0/1 s)" }, 15, true, "gs_nice_ng185_nstemi_assessment"),
    order("w-acs-cr", "laboratory", LOINC.creatinine, { en: "Renal function", tr: "Böbrek fonksiyonu" }, 30, false, "gs_nice_ng185_nstemi_assessment"),
  ],
  disposition: "admit-ccu",
  provenance: "seed",
};

/* ========================================================================== */
/* Case 2 — Thunderclap headache / SAH                                        */
/* ========================================================================== */

const p2 = patient("sah-002", "Elif Demir", "female", 47, { weightKg: 68 });
const sahTriage: TriageVitals = { hr: 96, systolic: 172, diastolic: 98, rr: 18, spo2: 98, tempC: 37.1 };

const sahCase: CaseInstance = {
  id: "em-sah-002",
  seed: 100_002,
  locale: "en",
  chiefComplaint: { en: "Sudden worst-ever headache", tr: "Aniden başlayan hayatının en şiddetli baş ağrısı" },
  patient: p2,
  encounter: encounter("sah-002", p2.id, { en: "Thunderclap headache, 2 hours", tr: "Gök gürültüsü baş ağrısı, 2 saat" }),
  allergies: allergyNKDA(p2.id),
  triageVitals: sahTriage,
  difficulty: 4,
  acuityESI: 2,
  correctDiagnosis: dx("dx-sah-002", ICD10.sah,
    { en: "Nontraumatic subarachnoid hemorrhage", tr: "Travmatik olmayan subaraknoid kanama" },
    { subject: p2.id, note: { en: "Thunderclap onset; blood on noncontrast CT head.", tr: "Gök gürültüsü başlangıç; kontrastsız beyin BT'de kan." } }),
  differentials: [
    dx("ddx-sah-migraine", ICD10.migraine, { en: "Migraine", tr: "Migren" }, { category: "differential", verification: "differential", subject: p2.id }),
    dx("ddx-sah-tension", ICD10.tensionHeadache, { en: "Tension-type headache", tr: "Gerilim tipi baş ağrısı" }, { category: "differential", verification: "differential", subject: p2.id }),
  ],
  redFlags: [
    { en: "Thunderclap onset, maximal within seconds", tr: "Saniyeler içinde en şiddetli hale gelen ani başlangıç" },
    { en: "Neck stiffness or photophobia", tr: "Ense sertliği veya fotofobi" },
    { en: "Worst headache of life", tr: "Hayatının en şiddetli baş ağrısı" },
  ],
  groundTruth: {
    history: [
      hx("h-sah-onset", "onset", { en: "It hit me all at once, like a thunderclap, two hours ago.", tr: "İki saat önce gök gürültüsü gibi bir anda vurdu." }, true),
      hx("h-sah-sev", "severity", { en: "It is the worst headache of my life, a ten.", tr: "Hayatımın en kötü baş ağrısı, on üzerinden on." }, true),
      hx("h-sah-loc", "location", { en: "It is across the back of my head.", tr: "Başımın arka tarafında." }),
      hx("h-sah-assoc", "associated-symptoms", { en: "I feel sick and the light hurts my eyes.", tr: "Midem bulanıyor ve ışık gözlerimi acıtıyor." }, true),
      hx("h-sah-red", "red-flags", { en: "My neck feels stiff and I vomited once.", tr: "Ensem tutuk ve bir kez kustum." }, true),
      hx("h-sah-pmh", "past-medical-history", { en: "I have well-controlled high blood pressure.", tr: "Kontrol altında yüksek tansiyonum var." }),
      hx("h-sah-social", "social-history", { en: "I smoke about ten cigarettes a day.", tr: "Günde yaklaşık on sigara içiyorum." }),
    ],
    exam: [
      exam("e-sah-gen", "general-inspection", { en: "General", tr: "Genel" }, { en: "In distress, photophobic, lying still.", tr: "Sıkıntılı, fotofobik, hareketsiz yatıyor." }, true),
      exam("e-sah-neuro", "neurological", { en: "Neurological", tr: "Nörolojik" }, { en: "Neck stiffness on flexion, no focal deficit, GCS 15.", tr: "Fleksiyonda ense sertliği, fokal defisit yok, GKS 15." }, true),
    ],
    labs: [],
    imaging: [
      imaging("i-sah-ct", "ct-head-noncon", { en: "CT head without contrast", tr: "Kontrastsız beyin BT" },
        report("sah-ct", p2.id,
          { system: LOINC.ecg12.system, code: "30799-1", display: "CT head" }, "imaging",
          { en: "Hyperdensity in the basal cisterns consistent with subarachnoid hemorrhage.", tr: "Bazal sisternlerde subaraknoid kanama ile uyumlu hiperdansite." })),
    ],
    vitalsTrajectory: trajectory(sahTriage, { systolic: 10, hr: 6 }),
  },
  expectedWorkup: [
    order("w-sah-ct", "imaging", { system: LOINC.ecg12.system, code: "ct-head-noncon", display: "CT head" },
      { en: "Noncontrast CT head", tr: "Kontrastsız beyin BT" }, 30, true, "gs_nice_ng228_thunderclap"),
    order("w-sah-bp", "laboratory", LOINC.creatinine, { en: "Baseline bloods and renal function", tr: "Bazal kan tetkikleri ve böbrek fonksiyonu" }, 45, false, "tepdad-em"),
  ],
  disposition: "admit-icu",
  provenance: "seed",
};

/* ========================================================================== */
/* Case 3 — RLQ abdominal pain / appendicitis                                 */
/* ========================================================================== */

const p3 = patient("appy-003", "Mert Kaya", "male", 24, { weightKg: 72 });
const appyTriage: TriageVitals = { hr: 98, systolic: 124, diastolic: 78, rr: 18, spo2: 99, tempC: 38.1 };

const appendicitisCase: CaseInstance = {
  id: "em-appy-003",
  seed: 100_003,
  locale: "en",
  chiefComplaint: { en: "Right lower quadrant abdominal pain", tr: "Sağ alt kadran karın ağrısı" },
  patient: p3,
  encounter: encounter("appy-003", p3.id, { en: "Migratory RLQ pain, 18 hours", tr: "Göç eden sağ alt kadran ağrısı, 18 saat" }),
  allergies: allergyNKDA(p3.id),
  triageVitals: appyTriage,
  difficulty: 2,
  acuityESI: 3,
  correctDiagnosis: dx("dx-appy-003", ICD10.appendicitis,
    { en: "Acute appendicitis", tr: "Akut apandisit" },
    { subject: p3.id, note: { en: "Migratory RLQ pain, McBurney tenderness, leukocytosis.", tr: "Göç eden sağ alt kadran ağrısı, McBurney hassasiyeti, lökositoz." } }),
  differentials: [
    dx("ddx-appy-gastro", ICD10.gastroenteritis, { en: "Gastroenteritis", tr: "Gastroenterit" }, { category: "differential", verification: "differential", subject: p3.id }),
    dx("ddx-appy-mesen", ICD10.mesentericAdenitis, { en: "Mesenteric adenitis", tr: "Mezenterik adenit" }, { category: "differential", verification: "differential", subject: p3.id }),
  ],
  redFlags: [
    { en: "Peritonism or guarding", tr: "Peritonizm veya defans" },
    { en: "Rising fever with localized tenderness", tr: "Lokalize hassasiyetle yükselen ateş" },
  ],
  groundTruth: {
    history: [
      hx("h-appy-onset", "onset", { en: "It began around my belly button yesterday and moved down and to the right.", tr: "Dün göbek çevresinde başladı, sonra sağ alta indi." }, true),
      hx("h-appy-char", "character", { en: "It is a constant dull ache that is getting sharper.", tr: "Giderek keskinleşen sürekli künt bir ağrı." }),
      hx("h-appy-assoc", "associated-symptoms", { en: "I have no appetite and I feel feverish.", tr: "İştahım yok ve ateşim var gibi." }, true),
      hx("h-appy-agg", "aggravating", { en: "Coughing and walking make it worse.", tr: "Öksürmek ve yürümek ağrıyı artırıyor." }, true),
      hx("h-appy-pmh", "past-medical-history", { en: "I am usually healthy.", tr: "Genelde sağlıklıyım." }),
    ],
    exam: [
      exam("e-appy-abd", "abdominal", { en: "Abdominal", tr: "Karın" }, { en: "Tender at McBurney point with guarding.", tr: "McBurney noktasında hassas, defans mevcut." }, true),
      exam("e-appy-special", "focused-special", { en: "Special tests", tr: "Özel testler" }, { en: "Rovsing sign positive; rebound tenderness present.", tr: "Rovsing bulgusu pozitif; rebaund hassasiyet var." }, true),
    ],
    labs: [
      lab("l-appy-wbc", "6690-2", labObs("appy-wbc", p3.id, LOINC.wbc, 15.2, "10^9/L", "H", "4.0 - 11.0")),
      lab("l-appy-crp", "1988-5", labObs("appy-crp", p3.id, LOINC.crp, 48, "mg/L", "H", "< 5")),
    ],
    imaging: [
      imaging("i-appy-us", "us-abdomen", { en: "Abdominal ultrasound", tr: "Karın ultrasonu" },
        report("appy-us", p3.id, { system: LOINC.ecg12.system, code: "us-abdomen", display: "US abdomen" }, "imaging",
          { en: "Noncompressible blind-ending tubular structure, 9 mm, with surrounding inflammation.", tr: "9 mm, çevresel enflamasyonlu, sıkıştırılamayan kör sonlanan tübüler yapı." })),
    ],
    vitalsTrajectory: trajectory(appyTriage, { hr: 8, tempC: 0.4 }),
  },
  expectedWorkup: [
    order("w-appy-bloods", "laboratory", LOINC.wbc, { en: "FBC and CRP", tr: "Tam kan sayımı ve CRP" }, 30, false, "gs_wses2020_appy_scores"),
    order("w-appy-us", "imaging", { system: LOINC.ecg12.system, code: "us-abdomen", display: "US abdomen" },
      { en: "Abdominal ultrasound", tr: "Karın ultrasonu" }, 60, false, "gs_wses2020_appy_tailored"),
    order("w-appy-analgesia", "procedure", { system: LOINC.ecg12.system, code: "analgesia", display: "Analgesia" },
      { en: "Timely analgesia", tr: "Zamanında analjezi" }, 30, false, "tepdad-em"),
  ],
  disposition: "operating-room",
  provenance: "seed",
};

/* ========================================================================== */
/* Case 4 — Dyspnea / pulmonary embolism                                      */
/* ========================================================================== */

const p4 = patient("pe-004", "Ayşe Şahin", "female", 63, { weightKg: 79 });
const peTriage: TriageVitals = { hr: 112, systolic: 118, diastolic: 74, rr: 24, spo2: 91, tempC: 37.0 };

const pulmonaryEmbolismCase: CaseInstance = {
  id: "em-pe-004",
  seed: 100_004,
  locale: "en",
  chiefComplaint: { en: "Sudden breathlessness and pleuritic chest pain", tr: "Ani nefes darlığı ve plöretik göğüs ağrısı" },
  patient: p4,
  encounter: encounter("pe-004", p4.id, { en: "Acute dyspnea, 3 hours", tr: "Akut nefes darlığı, 3 saat" }),
  allergies: allergyNKDA(p4.id),
  triageVitals: peTriage,
  difficulty: 4,
  acuityESI: 2,
  correctDiagnosis: dx("dx-pe-004", ICD10.pulmonaryEmbolism,
    { en: "Pulmonary embolism", tr: "Pulmoner emboli" },
    { subject: p4.id, note: { en: "Tachycardia, hypoxia, raised D-dimer, filling defect on CTPA.", tr: "Taşikardi, hipoksi, yüksek D-dimer, BT anjiyografide dolum defekti." } }),
  differentials: [
    dx("ddx-pe-chf", ICD10.chf, { en: "Heart failure", tr: "Kalp yetmezliği" }, { category: "differential", verification: "differential", subject: p4.id }),
    dx("ddx-pe-pneu", ICD10.pneumonia, { en: "Pneumonia", tr: "Pnömoni" }, { category: "differential", verification: "differential", subject: p4.id }),
    dx("ddx-pe-acs", ICD10.acsNstemi, { en: "Acute coronary syndrome", tr: "Akut koroner sendrom" }, { category: "differential", verification: "differential", subject: p4.id }),
  ],
  redFlags: [
    { en: "Hypoxia with tachycardia", tr: "Taşikardiyle birlikte hipoksi" },
    { en: "Recent immobility or long travel", tr: "Yakın zamanda hareketsizlik veya uzun yolculuk" },
    { en: "Unilateral leg swelling", tr: "Tek taraflı bacak şişliği" },
  ],
  groundTruth: {
    history: [
      hx("h-pe-onset", "onset", { en: "I became short of breath very suddenly three hours ago.", tr: "Üç saat önce çok ani nefes darlığım oldu." }, true),
      hx("h-pe-char", "character", { en: "There is a sharp pain when I breathe in.", tr: "Nefes alırken keskin bir ağrı oluyor." }, true),
      hx("h-pe-rf", "risk-factors", { en: "I flew back from a long trip two days ago.", tr: "İki gün önce uzun bir yolculuktan uçakla döndüm." }, true),
      hx("h-pe-assoc", "associated-symptoms", { en: "My right calf has been swollen and sore.", tr: "Sağ baldırım şiş ve ağrılı." }, true),
      hx("h-pe-pmh", "past-medical-history", { en: "I had breast cancer treated two years ago.", tr: "İki yıl önce tedavi edilen meme kanserim vardı." }, true),
      hx("h-pe-meds", "medications", { en: "No blood thinners, just occasional paracetamol.", tr: "Kan sulandırıcı yok, ara sıra parasetamol." }),
    ],
    exam: [
      exam("e-pe-gen", "general-inspection", { en: "General", tr: "Genel" }, { en: "Tachypneic, mildly cyanosed lips.", tr: "Takipneik, dudaklarda hafif siyanoz." }, true),
      exam("e-pe-resp", "respiratory", { en: "Respiratory", tr: "Solunum" }, { en: "Clear chest, no crackles or wheeze.", tr: "Akciğerler temiz, ral veya hırıltı yok." }, false),
      exam("e-pe-leg", "musculoskeletal", { en: "Lower limb", tr: "Alt ekstremite" }, { en: "Right calf swollen and tender, warm to touch.", tr: "Sağ baldır şiş, hassas ve sıcak." }, true),
    ],
    labs: [
      lab("l-pe-ddimer", "48065-7", labObs("pe-ddimer", p4.id, LOINC.dDimer, 3200, "ng/mL", "H", "< 500")),
      lab("l-pe-trop", "67151-1", labObs("pe-trop", p4.id, LOINC.troponinHs, 22, "ng/L", "H", "< 14")),
    ],
    imaging: [
      imaging("i-pe-ctpa", "ctpa", { en: "CT pulmonary angiogram", tr: "BT pulmoner anjiyografi" },
        report("pe-ctpa", p4.id, { system: LOINC.ecg12.system, code: "ctpa", display: "CTPA" }, "imaging",
          { en: "Filling defects in the right and left main pulmonary arteries. Right heart strain.", tr: "Sağ ve sol ana pulmoner arterlerde dolum defektleri. Sağ kalp yüklenmesi." })),
    ],
    vitalsTrajectory: trajectory(peTriage, { hr: 10, spo2: -4, rr: 4 }),
  },
  expectedWorkup: [
    order("w-pe-ecg", "imaging", LOINC.ecg12, { en: "12-lead ECG", tr: "12 derivasyonlu EKG" }, 15, false, "gs_nice_ng185_nstemi_assessment"),
    order("w-pe-ddimer", "laboratory", LOINC.dDimer, { en: "D-dimer (age-adjusted)", tr: "D-dimer (yaşa göre ayarlı)" }, 30, false, "gs_nice_ng158_pe_unlikely_ddimer"),
    order("w-pe-ctpa", "imaging", { system: LOINC.ecg12.system, code: "ctpa", display: "CTPA" },
      { en: "CT pulmonary angiogram", tr: "BT pulmoner anjiyografi" }, 90, true, "gs_nice_ng158_pe_ctpa"),
  ],
  disposition: "admit-ward",
  provenance: "seed",
};

/* ========================================================================== */
/* Case 5 — Chest pain, panic disorder vs ACS mimic (DSM-5-TR)               */
/* ========================================================================== */

const p5 = patient("panic-005", "Deniz Aydın", "female", 29, { weightKg: 61 });
const panicTriage: TriageVitals = { hr: 108, systolic: 128, diastolic: 80, rr: 22, spo2: 99, tempC: 36.7 };

const panicDisorderCase: CaseInstance = {
  id: "em-panic-005",
  seed: 100_005,
  locale: "en",
  chiefComplaint: { en: "Chest tightness with palpitations and fear", tr: "Çarpıntı ve korkuyla birlikte göğüste sıkışma" },
  patient: p5,
  encounter: encounter("panic-005", p5.id, { en: "Recurrent chest tightness, 40 minutes", tr: "Tekrarlayan göğüste sıkışma, 40 dakika" }),
  allergies: allergyNKDA(p5.id),
  triageVitals: panicTriage,
  difficulty: 3,
  acuityESI: 3,
  correctDiagnosis: dx("dx-panic-005", DSM5TR.panicDisorder,
    { en: "Panic disorder", tr: "Panik bozukluğu" },
    { subject: p5.id, note: { en: "Recurrent unexpected panic attacks; ACS ruled out with normal ECG and troponin.", tr: "Tekrarlayan beklenmedik panik atakları; normal EKG ve troponinle ACS dışlandı." } }),
  differentials: [
    dx("ddx-panic-acs", ICD10.acsNstemi, { en: "Acute coronary syndrome", tr: "Akut koroner sendrom" }, { category: "differential", verification: "differential", subject: p5.id }),
    dx("ddx-panic-gad", DSM5TR.gad, { en: "Generalized anxiety disorder", tr: "Yaygın anksiyete bozukluğu" }, { category: "differential", verification: "differential", subject: p5.id }),
    dx("ddx-panic-gerd", ICD10.gerd, { en: "GERD", tr: "Gastroözofageal reflü" }, { category: "differential", verification: "differential", subject: p5.id }),
  ],
  redFlags: [
    { en: "Do not anchor: an ACS rule-out is still required", tr: "Yönelim yanlılığına düşmeyin: yine de ACS dışlaması gerekir" },
    { en: "Exertional or radiating pain would change the pathway", tr: "Efor veya yayılan ağrı yolağı değiştirir" },
  ],
  groundTruth: {
    history: [
      hx("h-panic-onset", "onset", { en: "It came on suddenly while I was sitting, peaking in minutes.", tr: "Otururken aniden geldi, dakikalar içinde en şiddetli hale ulaştı." }),
      hx("h-panic-char", "character", { en: "My chest feels tight and my heart is racing.", tr: "Göğsüm sıkışıyor ve kalbim hızlı atıyor." }),
      hx("h-panic-assoc", "associated-symptoms", { en: "My hands tingle and I feel like I cannot breathe.", tr: "Ellerim karıncalanıyor ve nefes alamıyormuş gibi hissediyorum." }),
      hx("h-panic-rad", "radiation", { en: "No, it does not spread to my arm or jaw.", tr: "Hayır, koluma veya çeneme yayılmıyor." }),
      hx("h-panic-timing", "timing", { en: "This has happened several times this month, out of nowhere.", tr: "Bu ay birkaç kez, durup dururken oldu." }, true),
      hx("h-panic-ice", "ice", { en: "I keep thinking I am having a heart attack and might die.", tr: "Sürekli kalp krizi geçirdiğimi ve ölebileceğimi düşünüyorum." }),
      hx("h-panic-social", "social-history", { en: "Work has been extremely stressful lately.", tr: "İş son zamanlarda aşırı stresli." }),
      hx("h-panic-pmh", "past-medical-history", { en: "No heart problems that I know of.", tr: "Bildiğim kadarıyla kalp sorunum yok." }),
    ],
    exam: [
      exam("e-panic-gen", "general-inspection", { en: "General", tr: "Genel" }, { en: "Anxious and hyperventilating, otherwise well.", tr: "Anksiyöz ve hiperventile, aksi halde iyi." }, true),
      exam("e-panic-cvs", "cardiovascular", { en: "Cardiovascular", tr: "Kardiyovasküler" }, { en: "Tachycardic but regular, no murmur.", tr: "Taşikardik ancak düzenli, üfürüm yok." }, false),
    ],
    labs: [
      lab("l-panic-trop", "67151-1", labObs("panic-trop", p5.id, LOINC.troponinHs, 4, "ng/L", "N", "< 14")),
    ],
    imaging: [
      imaging("i-panic-ecg", "11524-6", { en: "12-lead ECG", tr: "12 derivasyonlu EKG" },
        report("panic-ecg", p5.id, LOINC.ecg12, "cardiology",
          { en: "Sinus tachycardia, no ischemic changes.", tr: "Sinüs taşikardisi, iskemik değişiklik yok." })),
    ],
    vitalsTrajectory: trajectory(panicTriage, { hr: -18, rr: -4 }),
  },
  expectedWorkup: [
    order("w-panic-ecg", "imaging", LOINC.ecg12, { en: "12-lead ECG", tr: "12 derivasyonlu EKG" }, 10, true, "gs_nice_ng185_nstemi_assessment"),
    order("w-panic-trop", "laboratory", LOINC.troponinHs, { en: "High-sensitivity troponin", tr: "Yüksek duyarlıklı troponin" }, 15, true, "gs_nice_ng185_nstemi_assessment"),
    order("w-panic-ddimer", "laboratory", LOINC.dDimer, { en: "D-dimer", tr: "D-dimer" }, 30, false, "tepdad-em", true),
  ],
  disposition: "discharge",
  provenance: "seed",
};

/* -------------------------------------------------------------------------- */
/* Registry                                                                    */
/* -------------------------------------------------------------------------- */

export const seedCases: CaseInstance[] = [
  chestPainNstemiCase,
  sahCase,
  appendicitisCase,
  pulmonaryEmbolismCase,
  panicDisorderCase,
];

export {
  chestPainNstemiCase,
  sahCase,
  appendicitisCase,
  pulmonaryEmbolismCase,
  panicDisorderCase,
};

/** Look up a seed case by id. */
export function getSeedCase(id: string): CaseInstance | undefined {
  return seedCases.find((c) => c.id === id);
}

/** Additional case-specific citation ids used by seed workups. */
export const seedCitationIds = [
  "gs_nice_ng185_nstemi_assessment",
  "gs_nice_ng228_thunderclap",
  "gs_nice_ng158_pe_ctpa",
  "gs_nice_ng158_pe_unlikely_ddimer",
  "gs_wses2020_appy_scores",
  "gs_wses2020_appy_tailored",
  "tepdad-em",
] as const;
