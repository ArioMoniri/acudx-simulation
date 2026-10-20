/**
 * AcuDx — treatment appropriateness gates (pure, case-aware).
 *
 * Each gate inspects the CaseInstance (diagnosis, history, labs), the live
 * vitals and the treatments already given, and returns a verdict: whether the
 * agent may act physiologically, how the choice is scored, and a stable reason
 * key the UI translates. The clinical course consults `allowed`; the encounter
 * store records `appropriateness` + `reason` on the treatment / MAR events.
 *
 * Rules and their sources (review 02):
 *  - finding 8: nitrates — contraindicated with SBP < 90 mmHg, HR < 50 or > 100,
 *    suspected RV infarction, or a PDE-5 inhibitor in the last 24-48 h; only
 *    indicated for ischaemic chest pain or acute pulmonary oedema. ACCF/AHA 2013
 *    STEMI https://www.ahajournals.org/doi/10.1161/CIR.0b013e3182742cf6 ;
 *    nitrates have no role in haemorrhage / stroke BP control (AHA/ASA 2023
 *    SAH https://www.ahajournals.org/doi/10.1161/STR.0000000000000436)
 *  - finding 36 / 28: naloxone — only with an opioid toxidrome or a prior
 *    opioid dose; no antidote role in paracetamol or TCA overdose (MHRA
 *    https://www.gov.uk/government/publications/paracetamol-overdose-new-guidance-on-treatment-with-intravenous-acetylcysteine)
 *  - finding 31: insulin — hold when K < 3.3 mmol/L until replaced (ADA/EASD
 *    2024 https://doi.org/10.2337/dci24-0032)
 *  - finding 37: thrombolysis in ischaemic stroke only with BP < 185/110 and
 *    glucose 2.8-22 mmol/L (AHA/ASA 2019 https://doi.org/10.1161/STR.0000000000000211)
 *  - finding 7: IM adrenaline is the anaphylaxis first line; IV adrenaline
 *    outside arrest / monitored refractory anaphylaxis is contraindicated
 *    (Resuscitation Council UK 2021)
 *  - finding 28: oxygen and fluids are not universal — fluids are
 *    contraindicated in acute pulmonary oedema (ESC 2021 HF
 *    https://doi.org/10.1093/eurheartj/ehab368)
 *
 * Pure and deterministic. Education only. No real patient data path.
 */

import type { CaseInstance } from "@/domain/case";
import type { CurrentVitals, AdministeredTreatment } from "@/domain/clinicalCourse";
import { classify } from "@/domain/treatments";

export type Appropriateness = "indicated" | "contraindicated" | "neutral";

export type GateReason =
  | "ok"
  | "nitrate-hypotension"
  | "nitrate-bradycardia"
  | "nitrate-tachycardia"
  | "nitrate-rv-infarct"
  | "nitrate-pde5"
  | "nitrate-no-indication"
  | "naloxone-no-opioid"
  | "insulin-hypokalaemia"
  | "lysis-bp-above-185-110"
  | "lysis-glucose-out-of-range"
  | "lysis-no-indication"
  | "adrenaline-iv-not-first-line"
  | "fluids-pulmonary-oedema"
  | "fluids-tamponade-normovolaemic";

export interface GateVerdict {
  /** Whether the agent is allowed to act physiologically in the course engine. */
  allowed: boolean;
  appropriateness: Appropriateness;
  reason: GateReason;
}

/* -------------------------------------------------------------------------- */
/* Case feature detectors                                                      */
/* -------------------------------------------------------------------------- */

function haystack(c: CaseInstance): string {
  return [
    c.correctDiagnosis?.code.coding[0]?.code,
    c.correctDiagnosis?.code.coding[0]?.display,
    c.correctDiagnosis?.code.text?.en,
    c.correctDiagnosis?.code.text?.tr,
    c.correctDiagnosis?.note?.en,
    c.chiefComplaint?.en,
    c.chiefComplaint?.tr,
    ...(c.redFlags ?? []).flatMap((r) => [r.en, r.tr]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function dxCode(c: CaseInstance): string {
  return c.correctDiagnosis?.code.coding[0]?.code ?? "";
}

/** Acute coronary syndrome / ischaemic chest pain (I20-I21, STEMI/NSTEMI/angina). */
export function isIschaemicChestPain(c: CaseInstance): boolean {
  const code = dxCode(c);
  if (/^i2[01]/i.test(code)) return true;
  const hay = haystack(c);
  return /myocardial infarction|nstemi|stemi|angina|acute coronary|miyokart|koroner|anjina/.test(hay);
}

/** Acute heart failure / pulmonary oedema (I50, J81). */
export function isAcutePulmonaryOedema(c: CaseInstance): boolean {
  const code = dxCode(c);
  if (/^(i50|j81)/i.test(code)) return true;
  return /pulmonary oedema|pulmonary edema|heart failure|kalp yetmez|akciğer ödemi/.test(haystack(c));
}

/** Opioid toxidrome (T40.0-T40.4 / T40.6, or opioid / heroin keywords). */
export function isOpioidToxidrome(c: CaseInstance): boolean {
  const code = dxCode(c);
  if (/^t40\.[0-46]/i.test(code)) return true;
  return /opioid|heroin|opiate|pinpoint|eroin|opiyat/.test(haystack(c));
}

/** Anaphylaxis (T78.2 / T80.5 / T88.6). */
export function isAnaphylaxis(c: CaseInstance): boolean {
  const code = dxCode(c);
  if (/^(t78\.2|t80\.5|t88\.6)/i.test(code)) return true;
  return /anaphyla|anafilaks/.test(haystack(c));
}

/** Acute ischaemic stroke (I63). */
export function isIschaemicStroke(c: CaseInstance): boolean {
  const code = dxCode(c);
  if (/^i63/i.test(code)) return true;
  return /ischaemic stroke|ischemic stroke|iskemik inme/.test(haystack(c));
}

/** Cardiac tamponade (I31.4). */
export function isTamponade(c: CaseInstance): boolean {
  return /^i31\.4/i.test(dxCode(c)) || /tamponade|tamponad/.test(haystack(c));
}

/** Any history answer naming a PDE-5 inhibitor. */
export function hasPde5Inhibitor(c: CaseInstance): boolean {
  const meds = c.groundTruth.history
    .filter((h) => h.intent === "medications" || h.intent === "social-history")
    .map((h) => `${h.answer.en} ${h.answer.tr}`.toLowerCase())
    .join(" ");
  return /sildenafil|tadalafil|vardenafil|avanafil|viagra|cialis|levitra/.test(meds);
}

/** Suspected right-ventricular infarction (inferior STEMI with RV involvement). */
export function suspectedRvInfarct(c: CaseInstance): boolean {
  const texts = [
    c.correctDiagnosis?.note?.en,
    ...c.groundTruth.imaging.map((im) => im.report.conclusion?.en),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /right ventric|rv infarct|rv involvement|inferior stemi|v4r/.test(texts);
}

/** Latest authored potassium (LOINC 2823-3) in mmol/L, if the case carries one. */
export function latestPotassium(c: CaseInstance): number | null {
  const k = c.groundTruth.labs
    .filter((l) => l.observation.code.coding[0]?.code === "2823-3")
    .map((l) => l.observation.valueQuantity?.value)
    .filter((v): v is number => typeof v === "number");
  return k.length ? k[k.length - 1] : null;
}

/** Latest authored glucose (LOINC 2345-7 / 2339-0) converted to mmol/L. */
export function latestGlucoseMmol(c: CaseInstance): number | null {
  const g = c.groundTruth.labs
    .filter((l) => ["2345-7", "2339-0"].includes(l.observation.code.coding[0]?.code ?? ""))
    .map((l) => l.observation.valueQuantity)
    .filter((q): q is { value: number; unit: string } => !!q && typeof q.value === "number");
  if (!g.length) return null;
  const q = g[g.length - 1];
  return /mg/i.test(q.unit) ? q.value / 18 : q.value;
}

/* -------------------------------------------------------------------------- */
/* Gates                                                                       */
/* -------------------------------------------------------------------------- */

const OK: GateVerdict = { allowed: true, appropriateness: "indicated", reason: "ok" };
const block = (reason: GateReason): GateVerdict => ({ allowed: false, appropriateness: "contraindicated", reason });

/** Review 02 finding 8. */
export function nitrateGate(c: CaseInstance, v: CurrentVitals): GateVerdict {
  if (!(isIschaemicChestPain(c) || isAcutePulmonaryOedema(c))) return block("nitrate-no-indication");
  if (v.systolic < 90) return block("nitrate-hypotension");
  if (v.hr < 50) return block("nitrate-bradycardia");
  if (v.hr > 100 && !isAcutePulmonaryOedema(c)) return block("nitrate-tachycardia");
  if (suspectedRvInfarct(c)) return block("nitrate-rv-infarct");
  if (hasPde5Inhibitor(c)) return block("nitrate-pde5");
  return OK;
}

/** Review 02 finding 36 / 28. */
export function naloxoneGate(c: CaseInstance, treatments: AdministeredTreatment[], at: number): GateVerdict {
  const priorOpioid = treatments.some((t) => t.at <= at && classify(t.code) === "opioid");
  if (isOpioidToxidrome(c) || priorOpioid) return OK;
  return { allowed: false, appropriateness: "neutral", reason: "naloxone-no-opioid" };
}

/** Review 02 finding 31. */
export function insulinGate(c: CaseInstance): GateVerdict {
  const k = latestPotassium(c);
  if (k != null && k < 3.3) return block("insulin-hypokalaemia");
  return OK;
}

/** Review 02 finding 37. */
export function thrombolysisGate(c: CaseInstance, v: CurrentVitals): GateVerdict {
  if (!isIschaemicStroke(c)) {
    // Thrombolysis for high-risk PE is authored on the case; anything else is
    // not an indication for this entry.
    return /^i26/i.test(dxCode(c)) ? OK : block("lysis-no-indication");
  }
  if (v.systolic >= 185 || v.diastolic >= 110) return block("lysis-bp-above-185-110");
  const glu = latestGlucoseMmol(c);
  if (glu != null && (glu < 2.8 || glu > 22)) return block("lysis-glucose-out-of-range");
  return OK;
}

/** Review 02 finding 7: IV adrenaline is not the first line outside arrest. */
export function adrenalineIvGate(c: CaseInstance, v: CurrentVitals): GateVerdict {
  if (isAnaphylaxis(c) && v.systolic >= 60) return block("adrenaline-iv-not-first-line");
  return { allowed: true, appropriateness: "neutral", reason: "ok" };
}

/** Review 02 finding 28: fluids are not a universal rescue. */
export function fluidsGate(c: CaseInstance): GateVerdict {
  if (isAcutePulmonaryOedema(c)) return block("fluids-pulmonary-oedema");
  if (isTamponade(c)) return { allowed: true, appropriateness: "neutral", reason: "fluids-tamponade-normovolaemic" };
  return OK;
}

/**
 * The gate for a treatment code, or null when no rule applies (the case's
 * bespoke response or the generic fallback decides).
 */
export function gateFor(
  code: string,
  c: CaseInstance,
  v: CurrentVitals,
  treatments: AdministeredTreatment[],
  at: number,
): GateVerdict | null {
  switch (code) {
    case "4917":
      return nitrateGate(c, v);
    case "7242":
      return naloxoneGate(c, treatments, at);
    case "5856":
      return insulinGate(c);
    case "8410":
      return thrombolysisGate(c, v);
    case "3992":
      return adrenalineIvGate(c, v);
    case "3992-im":
      return isAnaphylaxis(c) ? OK : { allowed: true, appropriateness: "neutral", reason: "ok" };
    case "313002":
      return fluidsGate(c);
    default:
      return null;
  }
}
