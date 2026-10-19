/**
 * AcuDx — treatment catalog + generic physiology fallback.
 *
 * A small set of common ED / psych agents the learner can administer, plus a
 * pure `genericEffect` that supplies a plausible physiologic response when the
 * case does not carry a bespoke `TreatmentResponse` for that agent. Effects are
 * expressed as signed vital deltas reached after an onset delay; the live
 * clinical course (src/domain/clinicalCourse.ts) ramps them in over time.
 *
 * Deliberately modest, teachable deltas — this is a decision-timing simulator,
 * not a pharmacokinetic model. Pure + deterministic: no Date.now, no
 * Math.random.
 *
 * Review 02 (docs/review/02-clinical-content-review-2026-10.md):
 *  - finding 7: adrenaline IM 0.5 mg is the anaphylaxis first line; IV
 *    adrenaline is a separate, specialist entry (Resuscitation Council UK 2021,
 *    https://www.resus.org.uk/library/additional-guidance/guidance-anaphylaxis/emergency-treatment)
 *  - finding 8: nitrate effects are gated (SBP < 90, HR < 50 or > 100, RV
 *    infarct, PDE-5 inhibitor) and only act in ischaemic chest pain / acute
 *    pulmonary oedema (ACCF/AHA 2013 STEMI, https://www.ahajournals.org/doi/10.1161/CIR.0b013e3182742cf6)
 *  - finding 36: naloxone acts only with an opioid on board or an opioid toxidrome
 *  - finding 44: paracetamol defaults to the oral route (NICE CKS analgesia,
 *    https://cks.nice.org.uk/topics/analgesia-mild-to-moderate-pain/)
 *
 * Education only. No real patient data path.
 */

import type { Bilingual } from "@/data/mock";
import { ROUTE_LABEL, type Route } from "@/domain/formulary";

/** The six tracked vital signs. */
export type VitalKey = "hr" | "systolic" | "diastolic" | "rr" | "spo2" | "tempC";

/** A signed change to one vital, fully reached `onsetMs` after administration. */
export interface VitalEffect {
  key: VitalKey;
  /** Signed delta reached after `onsetMs` (ramped linearly from 0). */
  delta: number;
  onsetMs: number;
}

export interface TreatmentOption {
  /** RxNorm-style code (or a stable synthetic id). */
  code: string;
  label: Bilingual;
  /** Pharmacologic / therapeutic class, bilingual. */
  klass: Bilingual;
  /** Display label of the default route (from the formulary route table). */
  route?: Bilingual;
  /** Machine-readable default route (matches the formulary). */
  routeCode?: Route;
  /** Adult default dose shown on the order chip (the formulary holds the range). */
  defaultDose?: { amount: number; unit: string };
}

/* -------------------------------------------------------------------------- */
/* Catalog (~16 common ED / psych agents)                                     */
/* -------------------------------------------------------------------------- */

function opt(
  code: string,
  label: Bilingual,
  klass: Bilingual,
  routeCode: Route,
  defaultDose?: { amount: number; unit: string },
): TreatmentOption {
  return { code, label, klass, route: ROUTE_LABEL[routeCode], routeCode, ...(defaultDose ? { defaultDose } : {}) };
}

export const TREATMENT_CATALOG: TreatmentOption[] = [
  opt("7806", { en: "Oxygen", tr: "Oksijen" }, { en: "Oxygen therapy", tr: "Oksijen tedavisi" }, "INH", { amount: 4, unit: "L/min" }),
  opt("313002", { en: "IV fluid bolus (NS / RL)", tr: "İ.V. sıvı bolusu (SF / RL)" }, { en: "Crystalloid", tr: "Kristaloid" }, "IV", { amount: 500, unit: "mL" }),
  opt("1191", { en: "Aspirin", tr: "Aspirin" }, { en: "Antiplatelet", tr: "Antiagregan" }, "PO", { amount: 300, unit: "mg" }),
  opt("4917", { en: "Nitroglycerin (GTN)", tr: "Nitrogliserin (GTN)" }, { en: "Nitrate vasodilator", tr: "Nitrat vazodilatör" }, "SL", { amount: 0.4, unit: "mg" }),
  opt("7052", { en: "Morphine", tr: "Morfin" }, { en: "Opioid analgesic", tr: "Opioid analjezik" }, "IV", { amount: 2.5, unit: "mg" }),
  opt("2193", { en: "Ceftriaxone", tr: "Seftriakson" }, { en: "Antibiotic (cephalosporin)", tr: "Antibiyotik (sefalosporin)" }, "IV", { amount: 2000, unit: "mg" }),
  opt("435", { en: "Salbutamol nebuliser", tr: "Salbutamol nebül" }, { en: "Bronchodilator (SABA)", tr: "Bronkodilatör (SABA)" }, "NEB", { amount: 5, unit: "mg" }),
  opt("448", { en: "Adenosine", tr: "Adenozin" }, { en: "Antiarrhythmic", tr: "Antiaritmik" }, "IV", { amount: 6, unit: "mg" }),
  opt("5856", { en: "Insulin infusion (fixed rate)", tr: "İnsülin infüzyonu (sabit hız)" }, { en: "Insulin", tr: "İnsülin" }, "IV", { amount: 0.1, unit: "units/kg/h" }),
  opt("7242", { en: "Naloxone", tr: "Nalokson" }, { en: "Opioid antagonist", tr: "Opioid antagonisti" }, "IV", { amount: 0.4, unit: "mg" }),
  opt("6470", { en: "Lorazepam", tr: "Lorazepam" }, { en: "Benzodiazepine", tr: "Benzodiazepin" }, "IV", { amount: 4, unit: "mg" }),
  // Review 02 finding 44: oral first line; IV only when nil by mouth / vomiting.
  opt("161", { en: "Paracetamol", tr: "Parasetamol" }, { en: "Antipyretic / analgesic", tr: "Antipiretik / analjezik" }, "PO", { amount: 1000, unit: "mg" }),
  opt("26225", { en: "Ondansetron", tr: "Ondansetron" }, { en: "Antiemetic (5-HT3)", tr: "Antiemetik (5-HT3)" }, "IV", { amount: 4, unit: "mg" }),
  // Review 02 finding 7: IM adrenaline 0.5 mg is the anaphylaxis first line.
  opt("3992-im", { en: "Adrenaline IM 0.5 mg (anaphylaxis)", tr: "Adrenalin İ.M. 0.5 mg (anafilaksi)" }, { en: "Anaphylaxis first line", tr: "Anafilaksi birinci basamak" }, "IM", { amount: 0.5, unit: "mg" }),
  opt("3992", { en: "Adrenaline IV (arrest / refractory anaphylaxis infusion)", tr: "Adrenalin İ.V. (arrest / dirençli anafilaksi infüzyonu)" }, { en: "Vasopressor / inotrope", tr: "Vazopresör / inotrop" }, "IV", { amount: 1, unit: "mg" }),
  opt("8410", { en: "Alteplase (thrombolysis)", tr: "Alteplaz (tromboliz)" }, { en: "Thrombolytic", tr: "Trombolitik" }, "IV", { amount: 0.9, unit: "mg/kg" }),
];

/* -------------------------------------------------------------------------- */
/* Generic physiology fallback                                                */
/* -------------------------------------------------------------------------- */

export type GenericClass =
  | "oxygen"
  | "fluids"
  | "antipyretic"
  | "nitro"
  | "bronchodilator"
  | "opioid"
  | "naloxone"
  | "adrenaline_im"
  | "adrenaline_iv";

/** Catalog codes mapped to a generic physiologic class. */
const CLASS_BY_CODE: Record<string, GenericClass> = {
  "7806": "oxygen",
  "313002": "fluids",
  "161": "antipyretic",
  "4917": "nitro",
  "435": "bronchodilator",
  "7052": "opioid",
  "7242": "naloxone",
  "3992-im": "adrenaline_im",
  "3992": "adrenaline_iv",
};

/** Classify by catalog code first, then by keyword on the code string. */
export function classify(code: string): GenericClass | null {
  const known = CLASS_BY_CODE[code];
  if (known) return known;
  const c = code.toLowerCase();
  if (c.includes("oxygen") || /\bo2\b/.test(c)) return "oxygen";
  if (c.includes("saline") || c.includes("salin") || c.includes("ringer") || c.includes("fluid") || c.includes("bolus"))
    return "fluids";
  if (c.includes("acetamin") || c.includes("paracetam") || c.includes("antipyr")) return "antipyretic";
  if (c.includes("nitro")) return "nitro";
  if (c.includes("salbut") || c.includes("albuter") || c.includes("bronch")) return "bronchodilator";
  if (c.includes("morphin") || c.includes("fentan") || c.includes("opioid")) return "opioid";
  if (c.includes("naloxon")) return "naloxone";
  if (c.includes("adrenal") || c.includes("epineph")) return "adrenaline_iv";
  return null;
}

/**
 * Context the gates need. Supplied by clinicalCourse / treatmentRules; when
 * absent (bare call) the fallback stays permissive EXCEPT for the two agents
 * whose indiscriminate effect the review flagged: nitrates and naloxone, which
 * then require an explicit allow.
 */
export interface EffectContext {
  /** Nitrate gate verdict from treatmentRules.nitrateGate (undefined = not gated). */
  nitrateAllowed?: boolean;
  /** An opioid is on board (prior dose) or the case is an opioid toxidrome. */
  opioidOnBoard?: boolean;
  /** The case is an anaphylaxis (IM adrenaline raises BP and relieves bronchospasm). */
  anaphylaxis?: boolean;
}

/**
 * A plausible, clinically-modest physiologic response for a treatment when the
 * case carries no bespoke `TreatmentResponse`. Effects are gated on the current
 * vitals so, e.g., oxygen only lifts a low SpO2. Returns [] for agents without
 * a generic mapping (their response, if any, must be authored on the case).
 */
export function genericEffect(
  code: string,
  v: { spo2: number; systolic: number; hr: number; tempC: number; rr: number; diastolic: number },
  ctx: EffectContext = {},
): VitalEffect[] {
  const cls = classify(code);
  const eff: VitalEffect[] = [];
  switch (cls) {
    case "oxygen":
      // Lift SpO2 toward ~97 when hypoxic.
      if (v.spo2 < 94) eff.push({ key: "spo2", delta: Math.min(97 - v.spo2, 6), onsetMs: 120_000 });
      break;
    case "fluids":
      // Support pressure when hypotensive.
      if (v.systolic < 100) {
        eff.push({ key: "systolic", delta: 12, onsetMs: 180_000 });
        eff.push({ key: "diastolic", delta: 6, onsetMs: 180_000 });
      }
      break;
    case "antipyretic":
      // Bring temperature down when febrile.
      if (v.tempC > 38) eff.push({ key: "tempC", delta: -0.8, onsetMs: 300_000 });
      break;
    case "nitro":
      // Review 02 finding 8: no effect unless the nitrate gate explicitly allows
      // (ischaemic pain / APO, SBP >= 90, HR 50-100, no RV infarct, no PDE-5i).
      if (ctx.nitrateAllowed === true) {
        eff.push({ key: "systolic", delta: -8, onsetMs: 90_000 });
      }
      break;
    case "bronchodilator":
      // Relieve tachypnoea and improve oxygenation.
      if (v.rr > 20) {
        eff.push({ key: "rr", delta: -4, onsetMs: 120_000 });
        eff.push({ key: "spo2", delta: 3, onsetMs: 120_000 });
      }
      break;
    case "opioid":
      // Analgesic slowing of heart + respiratory rate; each repeat dose stacks
      // (review 02 finding 36: cumulative respiratory depression).
      eff.push({ key: "hr", delta: -6, onsetMs: 120_000 });
      eff.push({ key: "rr", delta: -2, onsetMs: 120_000 });
      eff.push({ key: "spo2", delta: -1, onsetMs: 300_000 });
      break;
    case "naloxone":
      // Review 02 finding 36: naloxone reverses an opioid; it does nothing to a
      // patient with no opioid on board.
      if (ctx.opioidOnBoard === true) {
        eff.push({ key: "rr", delta: 4, onsetMs: 60_000 });
        eff.push({ key: "spo2", delta: 4, onsetMs: 60_000 });
      }
      break;
    case "adrenaline_im":
      // Review 02 finding 7: IM adrenaline restores pressure and eases
      // bronchospasm in anaphylaxis over ~5 min.
      if (ctx.anaphylaxis === true || v.systolic < 100) {
        eff.push({ key: "systolic", delta: 20, onsetMs: 300_000 });
        eff.push({ key: "diastolic", delta: 10, onsetMs: 300_000 });
        eff.push({ key: "spo2", delta: 4, onsetMs: 300_000 });
        eff.push({ key: "rr", delta: -4, onsetMs: 300_000 });
      }
      eff.push({ key: "hr", delta: 8, onsetMs: 180_000 });
      break;
    case "adrenaline_iv":
      eff.push({ key: "systolic", delta: 25, onsetMs: 60_000 });
      eff.push({ key: "hr", delta: 20, onsetMs: 60_000 });
      break;
    default:
      break;
  }
  return eff;
}

/**
 * The adverse physiologic consequence of a treatment the case has authored as
 * CONTRAINDICATED but whose fixture carries no explicit effects (review 02
 * finding 28: contraindicated items must act negatively, never as a rescue).
 * Fluids in pulmonary oedema: SpO2 falls, RR rises (ESC 2021 heart failure,
 * https://doi.org/10.1093/eurheartj/ehab368). Nitrates when contraindicated
 * drop the pressure further; opioids depress breathing.
 */
export function adverseEffectForContraindicated(code: string): VitalEffect[] {
  switch (classify(code)) {
    case "fluids":
      return [
        { key: "spo2", delta: -4, onsetMs: 300_000 },
        { key: "rr", delta: 4, onsetMs: 300_000 },
      ];
    case "nitro":
      return [{ key: "systolic", delta: -15, onsetMs: 90_000 }, { key: "hr", delta: 10, onsetMs: 90_000 }];
    case "opioid":
      return [{ key: "rr", delta: -3, onsetMs: 120_000 }, { key: "spo2", delta: -2, onsetMs: 300_000 }];
    default:
      return [];
  }
}
