/**
 * AcuDx: pure helpers that let the encounter store run on the real services.
 *
 *   caseInstanceToSpec       CaseInstance -> wire spec (GeneratedCaseSpec shape)
 *                            accepted by POST /v1/results/resolve (case_state)
 *                            and POST /v2/director/step (spec)
 *   resultsCaseState         the spec plus treatments_given for the engine
 *   applyDirectorChanges     fold one patient_visible_changes payload into the
 *                            client overlay, with the server's hard bounds
 *   overlayVitals            local course vitals + director overlay, clamped
 *   vitalsAdjectives         "tachycardic", "hypotensive", ... for the persona
 *   engineObservationToFhir  engine Observation -> FHIR Observation for the
 *                            Results panel renderers
 *
 * Nothing here reads Date.now, fetches, or touches React. Education only.
 */

/** Minimal bilingual label, kept local so this module stays dependency-light. */
type Bilingual = { en: string; tr: string };
import type { CaseInstance } from "@/domain/case";
import type { AdministeredTreatment, CurrentVitals } from "@/domain/clinicalCourse";
import { CODE_SYSTEMS, type Observation as FhirObservation } from "@/domain/fhir";
import type { GeneratedCaseSpec, SpecLab, SpecTreatment } from "@/lib/liveCaseGen";
import type {
  DirectorAffect,
  DirectorVitals,
  PatientVisibleChanges,
} from "@/lib/caseGenV2";
import type { Observation as EngineObservation, ResultsCaseState, TreatmentGiven } from "@/lib/resultsApi";

/* -------------------------------------------------------------------------- */
/* Provenance vocabulary                                                       */
/* -------------------------------------------------------------------------- */

/** How the running case was produced; shown by the banner SimBadge. */
export type CaseSource = "model" | "template" | "offline" | "seed" | "published";

export interface CaseGenerationMeta {
  source: CaseSource;
  /** Checkpoint thread of the v2 generator run (Director correlation). */
  threadId: string | null;
  council: { decision: "accept" | "repair" | null; vetoed: boolean; repairs: number } | null;
  degraded: boolean;
  model: string | null;
  note: string | null;
}

/**
 * i18n key for the provenance word on the case-meta line under the banner
 * ("Difficulty 3/5 · <provenance>"). The generation source wins over the
 * CaseInstance's coarse `provenance` ("seed" | "generated"): the acceptance run
 * of 2026-10-20 saw a template case labelled "Generated case" there while the
 * banner said "template (not model generated)".
 */
export function caseMetaProvenanceKey(
  generation: Pick<CaseGenerationMeta, "source"> | null | undefined,
  caseProvenance: string,
): string {
  return generation ? `live2.source.${generation.source}` : `ehr.provenance.${caseProvenance}`;
}

/**
 * Where a resolved result's numbers came from. Every `result` event carries
 * one of these in `meta.source` so a reviewer can tell measured-by-engine from
 * authored-by-case from the offline synthetic normal.
 */
export type ResultSource = "engine" | "case" | "offline-synthetic-normal";

/* -------------------------------------------------------------------------- */
/* CaseInstance -> wire spec                                                   */
/* -------------------------------------------------------------------------- */

function codeOf(c: CaseInstance, system: string): string | undefined {
  return c.correctDiagnosis.code.coding.find((k) => k.system === system)?.code;
}

function text(b: Bilingual | undefined, lang: "en" | "tr"): string {
  return b ? b[lang] : "";
}

/** Map a CaseInstance back onto the generator wire shape the services consume. */
export function caseInstanceToSpec(c: CaseInstance): GeneratedCaseSpec {
  const dx = c.correctDiagnosis.code;
  const labs: SpecLab[] = c.groundTruth.labs.map((l) => {
    const obs = l.observation;
    const q = obs.valueQuantity;
    return {
      code: obs.code.coding[0]?.code ?? l.orderCode,
      label_en: text(obs.code.text, "en") || obs.code.coding[0]?.display || l.orderCode,
      label_tr: text(obs.code.text, "tr") || obs.code.coding[0]?.display || l.orderCode,
      value: q ? q.value : (obs.valueString?.en ?? ""),
      unit: q?.unit ?? "",
      flag: obs.interpretation ?? "N",
      category: "laboratory",
    };
  });
  const treatments: SpecTreatment[] = (c.treatmentResponses ?? []).map((r) => ({
    code: r.treatmentCode,
    label_en: r.narrative.en,
    label_tr: r.narrative.tr,
    appropriateness: r.appropriateness,
    effects: r.effects.map((e) => ({ key: e.key, delta: e.delta, onsetMs: e.onsetMs })),
    narrative_en: r.narrative.en,
    narrative_tr: r.narrative.tr,
  }));

  return {
    seed: c.seed,
    locale: c.locale,
    condition: {
      icd10: codeOf(c, CODE_SYSTEMS.icd10),
      icd11: codeOf(c, CODE_SYSTEMS.icd11),
      dsm5tr: codeOf(c, CODE_SYSTEMS.dsm5tr),
      label_en: text(dx.text, "en") || dx.coding[0]?.display || "",
      label_tr: text(dx.text, "tr") || dx.coding[0]?.display || "",
    },
    demographics: {
      age: c.patient.ageYears,
      sex: c.patient.gender === "female" ? "female" : "male",
      name_hint: c.patient.name,
      ...(c.patient.weightKg != null ? { weight_kg: c.patient.weightKg } : {}),
    },
    chief_complaint_en: c.chiefComplaint.en,
    chief_complaint_tr: c.chiefComplaint.tr,
    acuity_esi: c.acuityESI,
    difficulty: c.difficulty,
    hpi: c.groundTruth.history.map((h) => ({
      intent: h.intent,
      answer_en: h.answer.en,
      answer_tr: h.answer.tr,
      ...(h.redFlag ? { red_flag: true } : {}),
    })),
    exam: c.groundTruth.exam.map((e) => ({
      maneuver: e.maneuver,
      system_en: e.system.en,
      system_tr: e.system.tr,
      finding_en: e.finding.en,
      finding_tr: e.finding.tr,
      abnormal: e.abnormal,
    })),
    triage_vitals: { ...c.triageVitals },
    vitals_trajectory: c.groundTruth.vitalsTrajectory.map((p) => ({ ...p })),
    labs,
    imaging: c.groundTruth.imaging.map((im) => ({
      code: im.orderCode,
      modality_en: im.modality.en,
      modality_tr: im.modality.tr,
      findings_en: im.report.conclusion?.en ?? "",
      findings_tr: im.report.conclusion?.tr ?? "",
      ...(im.imageQuery ? { image_query_en: im.imageQuery.en, image_query_tr: im.imageQuery.tr } : {}),
    })),
    treatments,
    disposition: c.disposition,
    red_flags: c.redFlags.map((rf) => ({ en: rf.en, tr: rf.tr, channel: "clinician" })),
  };
}

/** The engine's case_state: the spec plus the treatments given so far. */
export function resultsCaseState(
  c: CaseInstance,
  treatments: AdministeredTreatment[],
  labels: Record<string, string> = {},
): ResultsCaseState {
  const given: TreatmentGiven[] = treatments.map((t) => ({
    code: t.code,
    label: labels[t.code] ?? t.code,
    at_ms: t.at,
  }));
  return { ...(caseInstanceToSpec(c) as ResultsCaseState), treatments_given: given };
}

/* -------------------------------------------------------------------------- */
/* Director overlay                                                            */
/* -------------------------------------------------------------------------- */

/** Hard physiological bounds, identical to server/orchestration/director.py. */
export const DIRECTOR_BOUNDS: Record<keyof DirectorVitals, { min: number; max: number }> = {
  hr: { min: 20, max: 250 },
  systolic: { min: 40, max: 260 },
  diastolic: { min: 20, max: 160 },
  rr: { min: 0, max: 60 },
  spo2: { min: 0, max: 100 },
  tempC: { min: 30, max: 43 },
};

const VITAL_KEYS = ["hr", "systolic", "diastolic", "rr", "spo2", "tempC"] as const;

function finite(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Clamp a vitals record to the Director bounds; diastolic stays below systolic. */
export function clampDirectorVitals(v: DirectorVitals | CurrentVitals): CurrentVitals {
  const out = {} as CurrentVitals;
  for (const k of VITAL_KEYS) {
    const b = DIRECTOR_BOUNDS[k];
    out[k] = Math.min(b.max, Math.max(b.min, finite(v[k], b.min)));
  }
  if (out.diastolic >= out.systolic) out.diastolic = Math.max(DIRECTOR_BOUNDS.diastolic.min, out.systolic - 10);
  out.tempC = Math.round(out.tempC * 10) / 10;
  for (const k of VITAL_KEYS) if (k !== "tempC") out[k] = Math.round(out[k]);
  return out;
}

/**
 * The client-side memory of what the Director changed. `delta` is the gap
 * between the Director's vitals and the local course at the moment of the
 * step, so local treatment ramps keep running underneath while deterioration
 * or recovery the Director decided stays applied.
 */
export interface DirectorOverlay {
  /** Sim time of the Director step this overlay came from. */
  atMs: number;
  delta: CurrentVitals;
  /** The Director's own vitals at `atMs` (what the server computed). */
  vitals: CurrentVitals;
  affect: DirectorAffect | null;
  sanctionedFacts: string[];
  complications: string[];
  /** Last in-character line (persona colour, never a clinical fact). */
  utterance: { en: string; tr: string } | null;
}

/**
 * Fold one `patient_visible_changes` payload into the overlay. Facts and
 * complications accumulate; vitals and affect are replaced by the latest step.
 * Deltas are bounded so one bad payload can never push a vital outside the
 * physiological range the server itself enforces.
 */
export function applyDirectorChanges(
  prev: DirectorOverlay | null,
  changes: PatientVisibleChanges,
  localAtStep: CurrentVitals,
  atMs: number,
): DirectorOverlay {
  const vitals = clampDirectorVitals(changes.vitals ?? localAtStep);
  const delta = {} as CurrentVitals;
  for (const k of VITAL_KEYS) {
    const b = DIRECTOR_BOUNDS[k];
    const span = b.max - b.min;
    const raw = vitals[k] - finite(localAtStep[k], vitals[k]);
    delta[k] = Math.min(span, Math.max(-span, raw));
  }
  const facts = new Set(prev?.sanctionedFacts ?? []);
  for (const f of changes.new_facts ?? []) if (typeof f === "string" && f.trim()) facts.add(f.trim());
  const comps = new Set(prev?.complications ?? []);
  for (const c of changes.complications_fired ?? []) if (typeof c === "string" && c) comps.add(c);
  const utterance =
    changes.utterance_en || changes.utterance_tr
      ? { en: changes.utterance_en ?? "", tr: changes.utterance_tr ?? "" }
      : prev?.utterance ?? null;
  return {
    atMs,
    delta,
    vitals,
    affect: changes.affect ?? prev?.affect ?? null,
    sanctionedFacts: Array.from(facts),
    complications: Array.from(comps),
    utterance,
  };
}

/** Local course vitals with the Director overlay applied and clamped. */
export function overlayVitals(local: CurrentVitals, overlay: DirectorOverlay | null): CurrentVitals {
  if (!overlay) return local;
  const merged = {} as CurrentVitals;
  for (const k of VITAL_KEYS) merged[k] = local[k] + overlay.delta[k];
  return clampDirectorVitals(merged);
}

/* -------------------------------------------------------------------------- */
/* Persona context                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Plain clinical adjectives the persona prompt can use so the patient voices
 * deterioration or improvement. Thresholds follow the Director's affect rules
 * (drowsy below SBP 85 or SpO2 86) and common adult vital-sign cut-offs.
 */
export function vitalsAdjectives(v: CurrentVitals, affect: DirectorAffect | null = null): string[] {
  const out: string[] = [];
  if (v.hr > 100) out.push("tachycardic");
  if (v.hr < 50) out.push("bradycardic");
  if (v.systolic < 90) out.push("hypotensive");
  if (v.systolic > 180) out.push("hypertensive");
  if (v.rr > 20) out.push("tachypnoeic");
  if (v.rr < 10 && v.rr > 0) out.push("bradypnoeic");
  if (v.spo2 < 94) out.push("hypoxic");
  if (v.spo2 < 86) out.push("severely hypoxic");
  if (v.tempC >= 38) out.push("febrile");
  if (v.tempC < 35) out.push("hypothermic");
  if (affect) {
    if (affect.consciousness === "drowsy") out.push("drowsy");
    if (affect.consciousness === "unresponsive") out.push("unresponsive");
    if (affect.dyspnea >= 6) out.push("short of breath");
    if (affect.pain >= 7) out.push("in severe pain");
    if (affect.anxiety >= 7) out.push("very anxious");
  }
  if (out.length === 0) out.push("vitals within usual limits");
  return out;
}

/* -------------------------------------------------------------------------- */
/* Engine observation -> FHIR                                                  */
/* -------------------------------------------------------------------------- */

/** Adapt one engine observation to the FHIR Observation the Results panel renders. */
export function engineObservationToFhir(
  obs: EngineObservation,
  patientId: string,
  effectiveTime: number,
  idPrefix: string,
): FhirObservation {
  const display = obs.short?.trim() || obs.name;
  const base: FhirObservation = {
    resourceType: "Observation",
    id: `${idPrefix}-${obs.loinc}`,
    status: "final",
    category: "laboratory",
    code: {
      coding: [{ system: CODE_SYSTEMS.loinc, code: obs.loinc, display: obs.name }],
      text: { en: display, tr: display },
    },
    subject: patientId,
    effectiveTime,
    interpretation: obs.flag,
    ...(obs.ref_low != null && obs.ref_high != null
      ? { referenceRange: `${obs.ref_low} - ${obs.ref_high}` }
      : obs.ref_high != null
        ? { referenceRange: `< ${obs.ref_high}` }
        : obs.ref_low != null
          ? { referenceRange: `> ${obs.ref_low}` }
          : {}),
  };
  if (typeof obs.value === "number") {
    return { ...base, valueQuantity: { value: obs.value, unit: obs.unit } };
  }
  const s = String(obs.value);
  return { ...base, valueString: { en: s, tr: s } };
}

/** Format an engine turnaround for the order tracker, bilingual. */
export function turnaroundLabel(minutes: number): Bilingual {
  if (minutes >= 60) {
    const h = Math.round((minutes / 60) * 10) / 10;
    return { en: `${h} h`, tr: `${h} sa` };
  }
  return { en: `${Math.round(minutes)} min`, tr: `${Math.round(minutes)} dk` };
}
