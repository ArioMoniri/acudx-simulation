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
 * Education only. No real patient data path.
 */

import type { Bilingual } from "@/data/mock";

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
  route?: Bilingual;
}

/* -------------------------------------------------------------------------- */
/* Common routes                                                              */
/* -------------------------------------------------------------------------- */

const ROUTE = {
  iv: { en: "IV", tr: "İ.V." },
  im: { en: "IM", tr: "İ.M." },
  po: { en: "PO", tr: "Ağızdan" },
  sl: { en: "SL", tr: "Dilaltı" },
  inhaled: { en: "Inhaled", tr: "İnhalasyon" },
  neb: { en: "Nebulized", tr: "Nebülizatör" },
} as const satisfies Record<string, Bilingual>;

/* -------------------------------------------------------------------------- */
/* Catalog (~14 common ED / psych agents)                                     */
/* -------------------------------------------------------------------------- */

export const TREATMENT_CATALOG: TreatmentOption[] = [
  {
    code: "7806", // RxNorm: oxygen
    label: { en: "Oxygen", tr: "Oksijen" },
    klass: { en: "Oxygen therapy", tr: "Oksijen tedavisi" },
    route: ROUTE.inhaled,
  },
  {
    code: "313002", // RxNorm: sodium chloride 0.9% injectable
    label: { en: "IV fluid bolus (NS / RL)", tr: "İ.V. sıvı bolusu (SF / RL)" },
    klass: { en: "Crystalloid", tr: "Kristaloid" },
    route: ROUTE.iv,
  },
  {
    code: "1191", // RxNorm: aspirin
    label: { en: "Aspirin", tr: "Aspirin" },
    klass: { en: "Antiplatelet", tr: "Antiagregan" },
    route: ROUTE.po,
  },
  {
    code: "4917", // RxNorm: nitroglycerin
    label: { en: "Nitroglycerin", tr: "Nitrogliserin" },
    klass: { en: "Nitrate vasodilator", tr: "Nitrat vazodilatör" },
    route: ROUTE.sl,
  },
  {
    code: "7052", // RxNorm: morphine
    label: { en: "Morphine / fentanyl", tr: "Morfin / fentanil" },
    klass: { en: "Opioid analgesic", tr: "Opioid analjezik" },
    route: ROUTE.iv,
  },
  {
    code: "2193", // RxNorm: ceftriaxone
    label: { en: "Ceftriaxone", tr: "Seftriakson" },
    klass: { en: "Antibiotic (cephalosporin)", tr: "Antibiyotik (sefalosporin)" },
    route: ROUTE.iv,
  },
  {
    code: "435", // RxNorm: albuterol / salbutamol
    label: { en: "Salbutamol nebulizer", tr: "Salbutamol nebül" },
    klass: { en: "Bronchodilator (SABA)", tr: "Bronkodilatör (SABA)" },
    route: ROUTE.neb,
  },
  {
    code: "448", // RxNorm: adenosine
    label: { en: "Adenosine", tr: "Adenozin" },
    klass: { en: "Antiarrhythmic", tr: "Antiaritmik" },
    route: ROUTE.iv,
  },
  {
    code: "5856", // RxNorm: insulin regular
    label: { en: "IV insulin", tr: "İ.V. insülin" },
    klass: { en: "Insulin", tr: "İnsülin" },
    route: ROUTE.iv,
  },
  {
    code: "7242", // RxNorm: naloxone
    label: { en: "Naloxone", tr: "Nalokson" },
    klass: { en: "Opioid antagonist", tr: "Opioid antagonisti" },
    route: ROUTE.iv,
  },
  {
    code: "6470", // RxNorm: lorazepam
    label: { en: "Lorazepam", tr: "Lorazepam" },
    klass: { en: "Benzodiazepine", tr: "Benzodiazepin" },
    route: ROUTE.iv,
  },
  {
    code: "161", // RxNorm: acetaminophen / paracetamol
    label: { en: "Paracetamol", tr: "Parasetamol" },
    klass: { en: "Antipyretic / analgesic", tr: "Antipiretik / analjezik" },
    route: ROUTE.iv,
  },
  {
    code: "26225", // RxNorm: ondansetron
    label: { en: "Ondansetron", tr: "Ondansetron" },
    klass: { en: "Antiemetic (5-HT3)", tr: "Antiemetik (5-HT3)" },
    route: ROUTE.iv,
  },
  {
    code: "3992", // RxNorm: epinephrine / adrenaline
    label: { en: "Adrenaline", tr: "Adrenalin" },
    klass: { en: "Vasopressor / inotrope", tr: "Vazopresör / inotrop" },
    route: ROUTE.iv,
  },
];

/* -------------------------------------------------------------------------- */
/* Generic physiology fallback                                                */
/* -------------------------------------------------------------------------- */

type GenericClass =
  | "oxygen"
  | "fluids"
  | "antipyretic"
  | "nitro"
  | "bronchodilator"
  | "opioid"
  | "naloxone";

/** Catalog codes mapped to a generic physiologic class. */
const CLASS_BY_CODE: Record<string, GenericClass> = {
  "7806": "oxygen",
  "313002": "fluids",
  "161": "antipyretic",
  "4917": "nitro",
  "435": "bronchodilator",
  "7052": "opioid",
  "7242": "naloxone",
};

/** Classify by catalog code first, then by keyword on the code string. */
function classify(code: string): GenericClass | null {
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
  return null;
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
      // Small, careful drop in systolic pressure.
      eff.push({ key: "systolic", delta: -8, onsetMs: 90_000 });
      break;
    case "bronchodilator":
      // Relieve tachypnoea and improve oxygenation.
      if (v.rr > 20) {
        eff.push({ key: "rr", delta: -4, onsetMs: 120_000 });
        eff.push({ key: "spo2", delta: 3, onsetMs: 120_000 });
      }
      break;
    case "opioid":
      // Mild analgesic slowing of heart + respiratory rate.
      eff.push({ key: "hr", delta: -6, onsetMs: 120_000 });
      eff.push({ key: "rr", delta: -2, onsetMs: 120_000 });
      break;
    case "naloxone":
      // Reverse respiratory depression.
      eff.push({ key: "rr", delta: 4, onsetMs: 60_000 });
      eff.push({ key: "spo2", delta: 4, onsetMs: 60_000 });
      break;
    default:
      break;
  }
  return eff;
}
