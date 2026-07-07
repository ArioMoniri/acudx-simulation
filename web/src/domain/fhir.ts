/**
 * AcuDx — lightweight FHIR-shaped domain types.
 *
 * These are deliberately minimal, teachable subsets of the FHIR R4 resource
 * shapes (Patient, Encounter, Condition, Observation, ServiceRequest,
 * MedicationRequest, DiagnosticReport, AllergyIntolerance, Procedure) used as
 * the AcuDx case data model. They follow real FHIR field names and coding
 * conventions closely enough to transfer to a Medplum/HAPI backend later, while
 * staying small enough to author and reason about on the client.
 *
 * Progressive disclosure (docs/00-overview/04 §2.3) is handled one level up in
 * the CaseInstance / RevealGraph — these types only describe the data itself.
 *
 * Education only. No real patient data path.
 */

import type { Bilingual, Lang, Sex } from "@/data/mock";

export type { Bilingual, Lang, Sex };

/* -------------------------------------------------------------------------- */
/* Coding primitives (FHIR CodeableConcept / Coding)                          */
/* -------------------------------------------------------------------------- */

/** Canonical URIs for the code systems AcuDx samples from. */
export const CODE_SYSTEMS = {
  icd10: "http://hl7.org/fhir/sid/icd-10-cm",
  icd11: "http://id.who.int/icd/release/11/mms",
  dsm5tr: "http://www.dsm5.org/dsm-5-tr",
  loinc: "http://loinc.org",
  snomed: "http://snomed.info/sct",
  rxnorm: "http://www.nlm.nih.gov/research/umls/rxnorm",
  ucum: "http://unitsofmeasure.org",
} as const;

export type CodeSystemKey = keyof typeof CODE_SYSTEMS;

/** A single FHIR Coding: one code drawn from one system. */
export interface Coding {
  system: string;
  code: string;
  /** Human display, English canonical; localize via CodeableConcept.text. */
  display: string;
}

/**
 * FHIR CodeableConcept: one or more codings plus an optional bilingual free
 * text. `text` is what we render; `coding[]` is what we ground and score.
 */
export interface CodeableConcept {
  coding: Coding[];
  /** Localized display text (preferred for the UI over coding.display). */
  text?: Bilingual;
}

/** FHIR Quantity — a numeric value with a UCUM unit. */
export interface Quantity {
  value: number;
  /** Human unit label, e.g. "mmHg", "bpm", "mg/dL". */
  unit: string;
  /** UCUM code, e.g. "mm[Hg]", "/min", "mg/dL". */
  code?: string;
  system?: string;
}

/** FHIR Period — a start/optional-end time window (epoch ms in AcuDx). */
export interface Period {
  start: number;
  end?: number;
}

/* -------------------------------------------------------------------------- */
/* Patient                                                                    */
/* -------------------------------------------------------------------------- */

/** FHIR administrative gender, mapped from the app's Sex union. */
export type AdministrativeGender = "male" | "female" | "other" | "unknown";

export interface Patient {
  resourceType: "Patient";
  id: string;
  /** Synthetic display name. */
  name: string;
  gender: AdministrativeGender;
  /** Age in years (derived; AcuDx does not model real birth dates). */
  ageYears: number;
  /** Synthetic medical record number (clearly non-clinical). */
  mrn: string;
  /** Body weight in kg, when relevant (pediatric/renal dosing checks). */
  weightKg?: number;
  active: boolean;
}

/* -------------------------------------------------------------------------- */
/* Encounter                                                                  */
/* -------------------------------------------------------------------------- */

export type EncounterClass = "emergency" | "ambulatory" | "inpatient" | "prehospital";
export type EncounterStatus = "planned" | "in-progress" | "finished" | "cancelled";

export interface Encounter {
  resourceType: "Encounter";
  id: string;
  status: EncounterStatus;
  class: EncounterClass;
  subject: string; // Patient.id reference
  /** Free-text reason / chief complaint (bilingual). */
  reason: Bilingual;
  period: Period;
}

/* -------------------------------------------------------------------------- */
/* Condition (problem / diagnosis / differential)                             */
/* -------------------------------------------------------------------------- */

export type ConditionCategory = "problem-list-item" | "encounter-diagnosis" | "differential";
export type ConditionClinicalStatus = "active" | "recurrence" | "relapse" | "inactive" | "resolved";
export type ConditionVerificationStatus =
  | "unconfirmed"
  | "provisional"
  | "differential"
  | "confirmed"
  | "refuted";

export interface Condition {
  resourceType: "Condition";
  id: string;
  category: ConditionCategory;
  clinicalStatus: ConditionClinicalStatus;
  verificationStatus: ConditionVerificationStatus;
  code: CodeableConcept;
  subject: string; // Patient.id
  /** Bilingual clinician-facing note (rationale, one-liner). */
  note?: Bilingual;
  recordedAt?: number;
}

/* -------------------------------------------------------------------------- */
/* Observation (vital-sign | exam | laboratory)                               */
/* -------------------------------------------------------------------------- */

export type ObservationCategory = "vital-signs" | "exam" | "laboratory" | "imaging";
export type ObservationStatus = "registered" | "preliminary" | "final" | "amended";

/** Simple interpretation flag mirroring FHIR ObservationInterpretation. */
export type ObservationInterpretation = "N" | "L" | "H" | "LL" | "HH" | "A";

export interface Observation {
  resourceType: "Observation";
  id: string;
  status: ObservationStatus;
  category: ObservationCategory;
  code: CodeableConcept;
  subject: string; // Patient.id
  effectiveTime: number; // epoch ms
  /** Exactly one of the value[x] variants is set. */
  valueQuantity?: Quantity;
  /** Free-text value (exam findings, qualitative results), bilingual. */
  valueString?: Bilingual;
  /** Coded value (e.g. a positive finding concept). */
  valueCodeableConcept?: CodeableConcept;
  interpretation?: ObservationInterpretation;
  /** Reference interval display, e.g. "3.5 - 5.1". */
  referenceRange?: string;
  /** Body system / component grouping for exam findings, bilingual. */
  bodySystem?: Bilingual;
}

/* -------------------------------------------------------------------------- */
/* ServiceRequest (lab / imaging / consult order)                             */
/* -------------------------------------------------------------------------- */

export type ServiceRequestKind = "laboratory" | "imaging" | "consult" | "procedure";
export type ServiceRequestStatus = "draft" | "active" | "completed" | "revoked";
export type ServiceRequestPriority = "routine" | "urgent" | "asap" | "stat";

export interface ServiceRequest {
  resourceType: "ServiceRequest";
  id: string;
  kind: ServiceRequestKind;
  status: ServiceRequestStatus;
  priority: ServiceRequestPriority;
  code: CodeableConcept;
  subject: string; // Patient.id
  authoredOn: number;
  /** Simulated turnaround time in ms until a result is ready. */
  turnaroundMs: number;
}

/* -------------------------------------------------------------------------- */
/* MedicationRequest                                                          */
/* -------------------------------------------------------------------------- */

export type MedicationRequestStatus = "active" | "on-hold" | "cancelled" | "completed";
export type MedicationRequestIntent = "proposal" | "plan" | "order";

export interface Dosage {
  /** Human dose text, bilingual, e.g. "300 mg orally, once". */
  text: Bilingual;
  doseQuantity?: Quantity;
  route?: Bilingual;
}

export interface MedicationRequest {
  resourceType: "MedicationRequest";
  id: string;
  status: MedicationRequestStatus;
  intent: MedicationRequestIntent;
  medication: CodeableConcept;
  subject: string; // Patient.id
  authoredOn: number;
  dosage?: Dosage;
}

/* -------------------------------------------------------------------------- */
/* DiagnosticReport (grouped labs / imaging report)                           */
/* -------------------------------------------------------------------------- */

export type DiagnosticReportStatus = "registered" | "partial" | "preliminary" | "final";

export interface DiagnosticReport {
  resourceType: "DiagnosticReport";
  id: string;
  status: DiagnosticReportStatus;
  category: "laboratory" | "imaging" | "cardiology";
  code: CodeableConcept;
  subject: string; // Patient.id
  issued: number;
  /** Observation.id references contained in this report. */
  result: string[];
  /** Narrative impression / conclusion, bilingual. */
  conclusion?: Bilingual;
}

/* -------------------------------------------------------------------------- */
/* AllergyIntolerance                                                         */
/* -------------------------------------------------------------------------- */

export type AllergyCriticality = "low" | "high" | "unable-to-assess";
export type AllergyType = "allergy" | "intolerance";

export interface AllergyIntolerance {
  resourceType: "AllergyIntolerance";
  id: string;
  type: AllergyType;
  criticality: AllergyCriticality;
  code: CodeableConcept;
  patient: string; // Patient.id
  /** Reaction manifestation, bilingual (e.g. "anaphylaxis", "rash"). */
  reaction?: Bilingual;
}

/* -------------------------------------------------------------------------- */
/* Procedure                                                                  */
/* -------------------------------------------------------------------------- */

export type ProcedureStatus = "preparation" | "in-progress" | "completed" | "not-done";

export interface Procedure {
  resourceType: "Procedure";
  id: string;
  status: ProcedureStatus;
  code: CodeableConcept;
  subject: string; // Patient.id
  performedAt?: number;
  /** Outcome / note, bilingual. */
  outcome?: Bilingual;
}

/* -------------------------------------------------------------------------- */
/* Sample coded concepts (ICD-10 / ICD-11 / DSM-5-TR / LOINC)                 */
/* -------------------------------------------------------------------------- */

/** Small curated set of ICD-10-CM diagnosis codes used by the seed cases. */
export const ICD10 = {
  acsStemi: { system: CODE_SYSTEMS.icd10, code: "I21.3", display: "ST elevation myocardial infarction, unspecified site" },
  acsNstemi: { system: CODE_SYSTEMS.icd10, code: "I21.4", display: "Non-ST elevation (NSTEMI) myocardial infarction" },
  unstableAngina: { system: CODE_SYSTEMS.icd10, code: "I20.0", display: "Unstable angina" },
  sah: { system: CODE_SYSTEMS.icd10, code: "I60.9", display: "Nontraumatic subarachnoid hemorrhage, unspecified" },
  migraine: { system: CODE_SYSTEMS.icd10, code: "G43.909", display: "Migraine, unspecified, not intractable, without status migrainosus" },
  appendicitis: { system: CODE_SYSTEMS.icd10, code: "K35.80", display: "Unspecified acute appendicitis" },
  mesentericAdenitis: { system: CODE_SYSTEMS.icd10, code: "I88.0", display: "Nonspecific mesenteric lymphadenitis" },
  pulmonaryEmbolism: { system: CODE_SYSTEMS.icd10, code: "I26.99", display: "Other pulmonary embolism without acute cor pulmonale" },
  chf: { system: CODE_SYSTEMS.icd10, code: "I50.9", display: "Heart failure, unspecified" },
  gastroenteritis: { system: CODE_SYSTEMS.icd10, code: "K52.9", display: "Noninfective gastroenteritis and colitis, unspecified" },
  pneumonia: { system: CODE_SYSTEMS.icd10, code: "J18.9", display: "Pneumonia, unspecified organism" },
  costochondritis: { system: CODE_SYSTEMS.icd10, code: "M94.0", display: "Chondrocostal junction syndrome (Tietze)" },
  gerd: { system: CODE_SYSTEMS.icd10, code: "K21.9", display: "Gastro-esophageal reflux disease without esophagitis" },
  tensionHeadache: { system: CODE_SYSTEMS.icd10, code: "G44.209", display: "Tension-type headache, unspecified, not intractable" },
  ovarianTorsion: { system: CODE_SYSTEMS.icd10, code: "N83.51", display: "Torsion of right ovary and ovarian pedicle" },
} as const satisfies Record<string, Coding>;

/** Small curated set of ICD-11 MMS codes (crosswalk anchors). */
export const ICD11 = {
  acs: { system: CODE_SYSTEMS.icd11, code: "BA41.Z", display: "Acute myocardial infarction, unspecified" },
  sah: { system: CODE_SYSTEMS.icd11, code: "8B00", display: "Subarachnoid haemorrhage" },
  appendicitis: { system: CODE_SYSTEMS.icd11, code: "DC10", display: "Acute appendicitis" },
  pulmonaryEmbolism: { system: CODE_SYSTEMS.icd11, code: "BB00", display: "Pulmonary embolism" },
  panicDisorder: { system: CODE_SYSTEMS.icd11, code: "6B01", display: "Panic disorder" },
} as const satisfies Record<string, Coding>;

/** Small curated set of DSM-5-TR codes used by the psych seed case. */
export const DSM5TR = {
  panicDisorder: { system: CODE_SYSTEMS.dsm5tr, code: "300.01", display: "Panic Disorder" },
  gad: { system: CODE_SYSTEMS.dsm5tr, code: "300.02", display: "Generalized Anxiety Disorder" },
  somaticSymptom: { system: CODE_SYSTEMS.dsm5tr, code: "300.82", display: "Somatic Symptom Disorder" },
  acuteStress: { system: CODE_SYSTEMS.dsm5tr, code: "308.3", display: "Acute Stress Disorder" },
} as const satisfies Record<string, Coding>;

/** Small curated set of LOINC lab / observation codes. */
export const LOINC = {
  troponinHs: { system: CODE_SYSTEMS.loinc, code: "67151-1", display: "Troponin T.cardiac [Mass/volume] high sensitivity" },
  dDimer: { system: CODE_SYSTEMS.loinc, code: "48065-7", display: "Fibrin D-dimer FEU [Mass/volume]" },
  bnp: { system: CODE_SYSTEMS.loinc, code: "33762-6", display: "Natriuretic peptide B prohormone N-Terminal [Mass/volume]" },
  wbc: { system: CODE_SYSTEMS.loinc, code: "6690-2", display: "Leukocytes [#/volume] in Blood" },
  crp: { system: CODE_SYSTEMS.loinc, code: "1988-5", display: "C reactive protein [Mass/volume] in Serum or Plasma" },
  lactate: { system: CODE_SYSTEMS.loinc, code: "2524-7", display: "Lactate [Moles/volume] in Serum or Plasma" },
  creatinine: { system: CODE_SYSTEMS.loinc, code: "2160-0", display: "Creatinine [Mass/volume] in Serum or Plasma" },
  ecg12: { system: CODE_SYSTEMS.loinc, code: "11524-6", display: "EKG study" },
  hr: { system: CODE_SYSTEMS.loinc, code: "8867-4", display: "Heart rate" },
  sbp: { system: CODE_SYSTEMS.loinc, code: "8480-6", display: "Systolic blood pressure" },
  dbp: { system: CODE_SYSTEMS.loinc, code: "8462-4", display: "Diastolic blood pressure" },
  rr: { system: CODE_SYSTEMS.loinc, code: "9279-1", display: "Respiratory rate" },
  spo2: { system: CODE_SYSTEMS.loinc, code: "59408-5", display: "Oxygen saturation in Arterial blood by Pulse oximetry" },
  temp: { system: CODE_SYSTEMS.loinc, code: "8310-5", display: "Body temperature" },
} as const satisfies Record<string, Coding>;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** Wrap a single Coding into a CodeableConcept with optional bilingual text. */
export function concept(coding: Coding, text?: Bilingual): CodeableConcept {
  return { coding: [coding], ...(text ? { text } : {}) };
}

/** Map the app's Sex union to a FHIR administrative gender. */
export function toGender(sex: Sex): AdministrativeGender {
  return sex;
}
