/**
 * AcuDx — CaseInstance ground-truth model + RevealGraph.
 *
 * A CaseInstance is the FULL clinical ground truth for a single simulated
 * encounter (docs/00-overview/04 §2.3). The EHR renders only what the student
 * has *obtained*; the RevealGraph maps each obtainable datum to the trigger (a
 * question intent, an exam maneuver, or an order code) that unlocks it.
 *
 * Nothing here reads Date.now or mutates state — this module is pure data
 * shapes + the pure `resolveReveal` resolver. Runtime disclosure lives in
 * src/state/encounterStore.ts.
 *
 * Education only. No real patient data path.
 */

import type { CaseCourseBinding } from "@/domain/clinicalCourse";
import type { Bilingual, Lang } from "@/data/schema";
import type {
  AllergyIntolerance,
  CodeableConcept,
  Condition,
  Coding,
  DiagnosticReport,
  Encounter,
  Observation,
  Patient,
  Quantity,
  ServiceRequestKind,
} from "@/domain/fhir";
import type { VitalEffect } from "@/domain/treatments";

/* -------------------------------------------------------------------------- */
/* Trigger + intent vocabularies                                              */
/* -------------------------------------------------------------------------- */

/**
 * A questionIntent is a stable, scoreable semantic tag for a history question
 * ("what a strong history covers"), independent of the exact wording the
 * student uses. History coverage in §4 is measured against expected intents.
 */
export type QuestionIntent =
  | "onset"
  | "location"
  | "character"
  | "radiation"
  | "severity"
  | "timing"
  | "aggravating"
  | "relieving"
  | "associated-symptoms"
  | "red-flags"
  | "past-medical-history"
  | "medications"
  | "allergies"
  | "family-history"
  | "social-history"
  | "risk-factors"
  | "ice"; // ideas, concerns, expectations

/** An exam maneuver the student can request; returns Observation(exam). */
export type ExamManeuver =
  | "general-inspection"
  | "vitals-recheck"
  | "cardiovascular"
  | "respiratory"
  | "abdominal"
  | "neurological"
  | "musculoskeletal"
  | "skin"
  | "ent"
  | "focused-special"; // case-specific special test (e.g. McBurney, Kernig)

/** The three kinds of reveal trigger. */
export type RevealTriggerKind = "question" | "exam" | "order";

export interface RevealTrigger {
  kind: RevealTriggerKind;
  /** questionIntent | examManeuver | orderCode (the ServiceRequest/obs code). */
  ref: string;
}

/* -------------------------------------------------------------------------- */
/* Ground-truth data items                                                    */
/* -------------------------------------------------------------------------- */

/** A history datum, keyed by the questionIntent that unlocks it. */
export interface HistoryItem {
  id: string;
  intent: QuestionIntent;
  /** The patient's answer, bilingual (persona supplies phrasing, not facts). */
  answer: Bilingual;
  /** True when this datum is a red-flag positive the student must elicit. */
  redFlag?: boolean;
  /**
   * A finer topic inside the intent ("rigors", "urinary", "travel"). A free-text
   * question that names a topic reveals only that answer (acceptance D-12).
   */
  topic?: string;
}

/** An exam finding, grouped by system and revealed by a maneuver. */
export interface ExamFinding {
  id: string;
  maneuver: ExamManeuver;
  system: Bilingual;
  finding: Bilingual;
  /** Whether the finding is abnormal (drives interpretation display). */
  abnormal: boolean;
  /** Optional structured Observation payload for the Results/Flowsheet view. */
  observation?: Observation;
}

/** A laboratory result, revealed only when the matching order is placed. */
export interface LabResult {
  id: string;
  /** Order code that unlocks it (matches OrderExpectation.code.coding). */
  orderCode: string;
  observation: Observation;
  /** Grouping report, when the lab belongs to a panel. */
  report?: DiagnosticReport;
}

/** An imaging / diagnostic result revealed by its order. */
export interface ImagingResult {
  id: string;
  orderCode: string;
  modality: Bilingual;
  report: DiagnosticReport;
  /**
   * A representative-image search phrase (bilingual), e.g.
   * {en:"lobar pneumonia chest x-ray", tr:"lober pnömoni akciğer grafisi"}. Lets
   * the UI surface a teaching illustration without shipping a real patient film.
   */
  imageQuery?: Bilingual;
  /** Optional direct URL to a representative teaching image (open-licensed). */
  imageUrl?: string;
  /** Attribution / license line for `imageUrl`, when supplied. */
  imageAttribution?: string;
}

/** A point on the vitals trajectory (baseline + evolution over sim time). */
export interface VitalsTrajectoryPoint {
  /** Offset from encounter start, in ms. */
  atMs: number;
  hr: number;
  systolic: number;
  diastolic: number;
  rr: number;
  spo2: number;
  tempC: number;
}

/** Structured triage vitals given at encounter start (with the banner). */
export interface TriageVitals {
  hr: number;
  systolic: number;
  diastolic: number;
  rr: number;
  spo2: number;
  tempC: number;
}

/* -------------------------------------------------------------------------- */
/* Expected workup (rubric anchors for §4 process metrics)                    */
/* -------------------------------------------------------------------------- */

/**
 * A single expected work-up action with an ideal time window and a guideline
 * citation. `timeToFirst` is measured against `idealWindowMs` in §4 to classify
 * on-time / late / missed. `lowValue: true` marks an order that is NOT indicated
 * (over-ordering trap) so appropriateness can be scored both ways.
 */
export interface OrderExpectation {
  id: string;
  kind: ServiceRequestKind;
  code: CodeableConcept;
  /** Short human label, bilingual (e.g. "12-lead ECG"). */
  label: Bilingual;
  /** Ideal max time from encounter start, in ms (e.g. ECG <= 10 min). */
  idealWindowMs: number;
  /** Whether skipping this is a safety-critical miss. */
  critical: boolean;
  /** True when this is a low-value / not-indicated order for the case. */
  lowValue?: boolean;
  /** Citation id (matches src/data/schema.ts citations[].id). */
  citationId: string;
}

/**
 * A case-specific response to a treatment. When present it OVERRIDES the generic
 * physiology fallback for that agent (src/domain/treatments.ts genericEffect):
 * `effects` drive the live vitals course, `appropriateness` scores the choice,
 * and `narrative` is the bilingual clinical note shown to the learner.
 */
export interface TreatmentResponse {
  /** Treatment code (matches TreatmentOption.code / the administered code). */
  treatmentCode: string;
  appropriateness: "indicated" | "contraindicated" | "neutral";
  effects: VitalEffect[];
  narrative: Bilingual;
  /** The row's label (lets a formulary drug match an abstract row; D-20). */
  label?: Bilingual;
}

export type Disposition =
  | "admit-ccu"
  | "admit-ward"
  | "admit-icu"
  | "operating-room"
  | "observation"
  | "discharge"
  | "refer-specialty";

/* -------------------------------------------------------------------------- */
/* CaseInstance                                                                */
/* -------------------------------------------------------------------------- */

export interface CaseGroundTruth {
  history: HistoryItem[];
  exam: ExamFinding[];
  labs: LabResult[];
  imaging: ImagingResult[];
  vitalsTrajectory: VitalsTrajectoryPoint[];
}

export interface CaseInstance {
  id: string;
  /** Numeric seed that produced the case (reproducibility). */
  seed: number;
  locale: Lang;
  chiefComplaint: Bilingual;
  /** FHIR-shaped patient + encounter + allergy context. */
  patient: Patient;
  encounter: Encounter;
  allergies: AllergyIntolerance[];
  triageVitals: TriageVitals;
  /** Difficulty tier 1 (foundation) .. 5 (expert). */
  difficulty: 1 | 2 | 3 | 4 | 5;
  /** Emergency Severity Index acuity 1 (most) .. 5 (least). */
  acuityESI: 1 | 2 | 3 | 4 | 5;
  correctDiagnosis: Condition;
  differentials: Condition[];
  /** Red-flag descriptions the student must screen for, bilingual. */
  redFlags: Bilingual[];
  groundTruth: CaseGroundTruth;
  expectedWorkup: OrderExpectation[];
  disposition: Disposition;
  /**
   * Optional case-specific treatment responses. When absent for an administered
   * agent, the live course falls back to genericEffect (src/domain/treatments.ts).
   */
  treatmentResponses?: TreatmentResponse[];
  /** Provenance: 'seed' (curated) or 'generated' (caseGen). */
  provenance: "seed" | "generated";
  /**
   * Review 06b: binding to the shared course model (condition rule, arrival
   * bedside state, patient factors, seed). Set from the generated spec; absent
   * for cases whose condition has no course rule.
   */
  course?: CaseCourseBinding;
}

/* -------------------------------------------------------------------------- */
/* RevealGraph                                                                 */
/* -------------------------------------------------------------------------- */

/** What kind of datum a reveal unlocks. */
export type RevealDatumKind = "history" | "exam" | "lab" | "imaging";

export interface RevealEdge {
  trigger: RevealTrigger;
  datumKind: RevealDatumKind;
  /** id of the HistoryItem | ExamFinding | LabResult | ImagingResult. */
  datumId: string;
}

/** Maps each trigger to the datum it unlocks (docs §2.3 reveal graph). */
export interface RevealGraph {
  edges: RevealEdge[];
}

/** Build the reveal graph deterministically from a case's ground truth. */
export function buildRevealGraph(caseInstance: CaseInstance): RevealGraph {
  const edges: RevealEdge[] = [];
  const { history, exam, labs, imaging } = caseInstance.groundTruth;

  for (const h of history) {
    edges.push({
      trigger: { kind: "question", ref: h.intent },
      datumKind: "history",
      datumId: h.id,
    });
  }
  for (const e of exam) {
    edges.push({
      trigger: { kind: "exam", ref: e.maneuver },
      datumKind: "exam",
      datumId: e.id,
    });
  }
  for (const l of labs) {
    edges.push({
      trigger: { kind: "order", ref: l.orderCode },
      datumKind: "lab",
      datumId: l.id,
    });
  }
  for (const im of imaging) {
    edges.push({
      trigger: { kind: "order", ref: im.orderCode },
      datumKind: "imaging",
      datumId: im.id,
    });
  }
  return { edges };
}

/** Result of resolving a trigger against a case. */
export interface ResolvedReveal {
  datumKind: RevealDatumKind;
  datumIds: string[];
}

/**
 * resolveReveal — given a case and a trigger, return the datum ids it unlocks.
 * Pure. A trigger may map to more than one datum (e.g. one order returning a
 * panel of labs). Returns an empty list for an irrelevant trigger (which the
 * process metrics count as a redundant / low-value action, §4).
 */
export function resolveReveal(
  caseInstance: CaseInstance,
  trigger: RevealTrigger,
): ResolvedReveal | null {
  const graph = buildRevealGraph(caseInstance);
  const matches = graph.edges.filter(
    (e) => e.trigger.kind === trigger.kind && e.trigger.ref === trigger.ref,
  );
  if (matches.length === 0) return null;
  return {
    datumKind: matches[0].datumKind,
    datumIds: matches.map((m) => m.datumId),
  };
}

/* -------------------------------------------------------------------------- */
/* Small helpers                                                               */
/* -------------------------------------------------------------------------- */

/** The set of questionIntents a strong history for this case should cover. */
export function expectedIntents(caseInstance: CaseInstance): QuestionIntent[] {
  return Array.from(new Set(caseInstance.groundTruth.history.map((h) => h.intent)));
}

/** Extract the first ServiceRequest-style order code string from a concept. */
export function primaryCode(concept: CodeableConcept | Coding): string {
  if ("coding" in concept) return concept.coding[0]?.code ?? "";
  return concept.code;
}

/** Build a numeric Quantity vital Observation payload (shared by generators). */
export function quantity(value: number, unit: string, code?: string): Quantity {
  return { value, unit, ...(code ? { code } : {}) };
}
