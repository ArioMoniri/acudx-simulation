/**
 * AcuDx — comprehensive orderable catalog + synthetic within-normal-limits
 * results.
 *
 * The encounter's expected work-up (docs §4) only names the handful of tests a
 * strong clinician SHOULD order for that case. A real order-entry surface must
 * let the student order ANYTHING — a CBC, a blood gas, a culture, a CT — and get
 * a sensible, timed result back even when the case ground truth has no bespoke
 * datum for it. This module supplies:
 *
 *   1. `ORDERABLES` / `ORDERABLES_BY_GROUP` — a broad, grouped catalog of labs,
 *      blood gases, micro, imaging and point-of-care tests, each with a stable
 *      order code (aligned to the seed/generated ground-truth codes where one
 *      exists, so ordering the indicated test reveals the REAL result).
 *   2. `syntheticNormalResult(orderable, case)` — a plausible, deterministic
 *      WITHIN-NORMAL-LIMITS result for an order that the case does NOT carry a
 *      ground-truth datum for, so any order still resolves to something.
 *   3. `hasGroundTruthResult(case, code)` — the precedence gate: when a case
 *      authors an (abnormal / relevant) lab or imaging datum for a code, that
 *      ground truth ALWAYS wins over the synthetic normal.
 *
 * Pure + deterministic: no Date.now, no Math.random. Synthetic values are seeded
 * from the case id + order code + analyte, so the same order in the same case
 * always yields the same numbers.
 *
 * Education only. No real patient data path.
 */

import type { Bilingual } from "@/data/mock";
import type { CaseInstance } from "@/domain/case";
import {
  CODE_SYSTEMS,
  LOINC,
  type Coding,
  type DiagnosticReport,
  type Observation,
  type ServiceRequestKind,
} from "@/domain/fhir";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/** Broad ordering group for the catalog UI (distinct from turnaround class). */
export type OrderCategory = "labs" | "bloodgas" | "micro" | "imaging" | "poc";

export interface Orderable {
  /** Stable order code (aligned to ground-truth codes where one exists). */
  code: string;
  label: Bilingual;
  /** FHIR service kind — drives result rendering (imaging shows an image). */
  kind: ServiceRequestKind;
  /** Catalog group for the order-entry surface. */
  category: OrderCategory;
  /** Optional short panel name, bilingual-agnostic (e.g. "CBC", "BMP"). */
  panel?: string;
}

/** One measurand within a synthetic panel, with its within-normal band. */
interface AnalyteSpec {
  code: string;
  system: string;
  label: Bilingual;
  unit?: string;
  /** Reference-range display, e.g. "3.5 - 5.1". */
  ref: string;
  /** Inclusive normal band [lo, hi] to sample a deterministic value from. */
  band?: [number, number];
  /** Rounding for the sampled value (default 0 decimals). */
  decimals?: number;
  /** A qualitative normal value (e.g. "Negative") instead of a number. */
  qualitative?: Bilingual;
}

/* -------------------------------------------------------------------------- */
/* Deterministic PRNG (local, self-contained — no external state)             */
/* -------------------------------------------------------------------------- */

/** FNV-1a 32-bit string hash → seed. */
function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — one float in [0,1) from a 32-bit seed. */
function rand01(seed: number): number {
  let a = seed >>> 0;
  a = (a + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Deterministic sample within [lo,hi] seeded from a string key. */
function sample(key: string, band: [number, number], decimals = 0): number {
  const r = rand01(hashStr(key));
  const v = band[0] + r * (band[1] - band[0]);
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

/* -------------------------------------------------------------------------- */
/* Analyte panels (within-normal reference bands)                             */
/* -------------------------------------------------------------------------- */

const L = CODE_SYSTEMS.loinc;

const A = (
  code: string,
  label: Bilingual,
  ref: string,
  band: [number, number] | undefined,
  unit?: string,
  extra: Partial<AnalyteSpec> = {},
): AnalyteSpec => ({ code, system: L, label, ref, band, unit, ...extra });

const NEG: Bilingual = { en: "Negative", tr: "Negatif" };

/** Panels keyed by order code. Absent code → generic single WNL observation. */
const PANELS: Record<string, AnalyteSpec[]> = {
  // CBC / full blood count.
  "6690-2": [
    A("6690-2", { en: "White cell count", tr: "Lökosit" }, "4.0 - 11.0", [4.5, 10.5], "10^9/L", { decimals: 1 }),
    A("718-7", { en: "Haemoglobin", tr: "Hemoglobin" }, "12.0 - 16.0", [12.5, 15.5], "g/dL", { decimals: 1 }),
    A("777-3", { en: "Platelets", tr: "Trombosit" }, "150 - 400", [180, 360], "10^9/L"),
  ],
  // BMP / renal panel (creatinine code aligns to ground-truth reveals).
  "2160-0": [
    A("2951-2", { en: "Sodium", tr: "Sodyum" }, "135 - 145", [136, 143], "mmol/L"),
    A("2823-3", { en: "Potassium", tr: "Potasyum" }, "3.5 - 5.1", [3.7, 4.9], "mmol/L", { decimals: 1 }),
    A("2075-0", { en: "Chloride", tr: "Klorür" }, "98 - 107", [99, 106], "mmol/L"),
    A("2160-0", { en: "Creatinine", tr: "Kreatinin" }, "0.7 - 1.3", [0.8, 1.2], "mg/dL", { decimals: 2 }),
    A("3094-0", { en: "Urea", tr: "Üre" }, "15 - 45", [18, 42], "mg/dL"),
  ],
  // CMP — BMP plus hepatic panel.
  cmp: [
    A("2951-2", { en: "Sodium", tr: "Sodyum" }, "135 - 145", [136, 143], "mmol/L"),
    A("2823-3", { en: "Potassium", tr: "Potasyum" }, "3.5 - 5.1", [3.7, 4.9], "mmol/L", { decimals: 1 }),
    A("2160-0", { en: "Creatinine", tr: "Kreatinin" }, "0.7 - 1.3", [0.8, 1.2], "mg/dL", { decimals: 2 }),
    A("1742-6", { en: "ALT", tr: "ALT" }, "7 - 56", [12, 48], "U/L"),
    A("1920-8", { en: "AST", tr: "AST" }, "10 - 40", [14, 36], "U/L"),
    A("1975-2", { en: "Bilirubin, total", tr: "Total bilirubin" }, "0.1 - 1.2", [0.2, 1.0], "mg/dL", { decimals: 1 }),
  ],
  // Liver function tests.
  lft: [
    A("1742-6", { en: "ALT", tr: "ALT" }, "7 - 56", [12, 48], "U/L"),
    A("1920-8", { en: "AST", tr: "AST" }, "10 - 40", [14, 36], "U/L"),
    A("6768-6", { en: "Alkaline phosphatase", tr: "ALP" }, "44 - 147", [60, 130], "U/L"),
    A("1975-2", { en: "Bilirubin, total", tr: "Total bilirubin" }, "0.1 - 1.2", [0.2, 1.0], "mg/dL", { decimals: 1 }),
    A("1751-7", { en: "Albumin", tr: "Albümin" }, "3.5 - 5.0", [3.8, 4.8], "g/dL", { decimals: 1 }),
  ],
  // Coagulation.
  "coag-inr": [
    A("6301-6", { en: "INR", tr: "INR" }, "0.8 - 1.1", [0.9, 1.1], undefined, { decimals: 2 }),
    A("5902-2", { en: "Prothrombin time", tr: "Protrombin zamanı" }, "11 - 13.5", [11.5, 13.2], "s", { decimals: 1 }),
    A("14979-9", { en: "aPTT", tr: "aPTT" }, "25 - 35", [27, 34], "s"),
  ],
  // High-sensitivity troponin (code aligns to ground-truth reveals).
  "67151-1": [
    A("67151-1", { en: "hs-troponin T", tr: "hs-troponin T" }, "< 14", [2, 11], "ng/L"),
  ],
  // D-dimer (code aligns to ground-truth reveals).
  "48065-7": [
    A("48065-7", { en: "D-dimer", tr: "D-dimer" }, "< 500", [120, 440], "ng/mL"),
  ],
  // NT-proBNP.
  "33762-6": [
    A("33762-6", { en: "NT-proBNP", tr: "NT-proBNP" }, "< 125", [15, 95], "pg/mL"),
  ],
  // Lactate.
  "2524-7": [
    A("2524-7", { en: "Lactate", tr: "Laktat" }, "0.5 - 2.0", [0.6, 1.8], "mmol/L", { decimals: 1 }),
  ],
  // Lipase + amylase.
  lipase: [
    A("3040-3", { en: "Lipase", tr: "Lipaz" }, "10 - 140", [22, 120], "U/L"),
    A("1798-8", { en: "Amylase", tr: "Amilaz" }, "30 - 110", [38, 100], "U/L"),
  ],
  // Urinalysis (qualitative).
  ua: [
    A("5799-2", { en: "Leukocyte esterase", tr: "Lökosit esteraz" }, "Negative", undefined, undefined, { qualitative: NEG }),
    A("5802-4", { en: "Nitrite", tr: "Nitrit" }, "Negative", undefined, undefined, { qualitative: NEG }),
    A("5794-3", { en: "Blood", tr: "Kan" }, "Negative", undefined, undefined, { qualitative: NEG }),
    A("5804-0", { en: "Protein", tr: "Protein" }, "Negative", undefined, undefined, { qualitative: NEG }),
  ],
  // β-hCG (qualitative).
  bhcg: [
    A("2106-3", { en: "β-hCG, qualitative", tr: "β-hCG, kalitatif" }, "Negative", undefined, undefined, { qualitative: NEG }),
  ],
  // TSH.
  tsh: [
    A("3016-3", { en: "TSH", tr: "TSH" }, "0.4 - 4.0", [0.6, 3.6], "mIU/L", { decimals: 2 }),
  ],
  // CRP (code aligns to ground-truth reveals).
  "1988-5": [
    A("1988-5", { en: "C-reactive protein", tr: "C-reaktif protein" }, "< 5", [0.4, 4.2], "mg/L", { decimals: 1 }),
  ],
  // Venous blood gas.
  vbg: [
    A("2744-1", { en: "pH", tr: "pH" }, "7.32 - 7.43", [7.34, 7.42], undefined, { decimals: 2 }),
    A("2019-8", { en: "pCO2", tr: "pCO2" }, "38 - 50", [40, 48], "mmHg"),
    A("1963-8", { en: "Bicarbonate", tr: "Bikarbonat" }, "22 - 29", [23, 28], "mmol/L"),
    A("2524-7", { en: "Lactate", tr: "Laktat" }, "0.5 - 2.0", [0.6, 1.8], "mmol/L", { decimals: 1 }),
  ],
  // Arterial blood gas.
  abg: [
    A("2744-1", { en: "pH", tr: "pH" }, "7.35 - 7.45", [7.37, 7.44], undefined, { decimals: 2 }),
    A("2019-8", { en: "pCO2", tr: "pCO2" }, "35 - 45", [37, 44], "mmHg"),
    A("2703-7", { en: "pO2", tr: "pO2" }, "80 - 100", [85, 98], "mmHg"),
    A("1963-8", { en: "Bicarbonate", tr: "Bikarbonat" }, "22 - 26", [23, 26], "mmol/L"),
  ],
  // Point-of-care glucose.
  "poc-glucose": [
    A("2339-0", { en: "Glucose (POC)", tr: "Glukoz (yatak başı)" }, "70 - 110", [78, 106], "mg/dL"),
  ],
};

/* -------------------------------------------------------------------------- */
/* Catalog                                                                     */
/* -------------------------------------------------------------------------- */

const lab = (code: string, label: Bilingual, panel?: string): Orderable => ({
  code,
  label,
  kind: "laboratory",
  category: "labs",
  ...(panel ? { panel } : {}),
});

const gas = (code: string, label: Bilingual): Orderable => ({
  code,
  label,
  kind: "laboratory",
  category: "bloodgas",
});

const micro = (code: string, label: Bilingual): Orderable => ({
  code,
  label,
  kind: "laboratory",
  category: "micro",
});

const img = (code: string, label: Bilingual): Orderable => ({
  code,
  label,
  kind: "imaging",
  category: "imaging",
});

/** The full, grouped orderable catalog. */
export const ORDERABLES_BY_GROUP: Record<OrderCategory, Orderable[]> = {
  labs: [
    lab("6690-2", { en: "Complete blood count (CBC)", tr: "Tam kan sayımı (Hemogram)" }, "CBC"),
    lab("2160-0", { en: "Basic metabolic panel (BMP)", tr: "Temel metabolik panel (BMP)" }, "BMP"),
    lab("cmp", { en: "Comprehensive metabolic panel (CMP)", tr: "Geniş metabolik panel (CMP)" }, "CMP"),
    lab("lft", { en: "Liver function tests (LFTs)", tr: "Karaciğer fonksiyon testleri" }, "LFT"),
    lab("coag-inr", { en: "Coagulation (INR / PT / PTT)", tr: "Koagülasyon (INR / PT / PTT)" }, "COAG"),
    lab("67151-1", { en: "High-sensitivity troponin", tr: "Yüksek duyarlıklı troponin" }),
    lab("48065-7", { en: "D-dimer", tr: "D-dimer" }),
    lab("33762-6", { en: "NT-proBNP", tr: "NT-proBNP" }),
    lab("2524-7", { en: "Lactate", tr: "Laktat" }),
    lab("lipase", { en: "Lipase / amylase", tr: "Lipaz / amilaz" }),
    lab("ua", { en: "Urinalysis", tr: "İdrar tahlili" }),
    lab("bhcg", { en: "β-hCG (pregnancy)", tr: "β-hCG (gebelik)" }),
    lab("tsh", { en: "TSH", tr: "TSH" }),
    lab("1988-5", { en: "C-reactive protein (CRP)", tr: "C-reaktif protein (CRP)" }),
  ],
  bloodgas: [
    gas("vbg", { en: "Venous blood gas (VBG)", tr: "Venöz kan gazı (VKG)" }),
    gas("abg", { en: "Arterial blood gas (ABG)", tr: "Arteriyel kan gazı (AKG)" }),
  ],
  micro: [
    micro("blood-culture", { en: "Blood culture", tr: "Kan kültürü" }),
    micro("urine-culture", { en: "Urine culture", tr: "İdrar kültürü" }),
    micro("resp-viral-panel", { en: "Respiratory viral panel", tr: "Solunum viral paneli" }),
  ],
  imaging: [
    img("cxr", { en: "Chest X-ray (CXR)", tr: "Akciğer grafisi (PA)" }),
    img("axr", { en: "Abdominal X-ray (AXR)", tr: "Ayakta direkt karın grafisi" }),
    img("ct-head-noncon", { en: "CT head (non-contrast)", tr: "Beyin BT (kontrastsız)" }),
    img("ctpa", { en: "CT chest / pulmonary angiogram", tr: "Toraks BT / pulmoner anjiyografi" }),
    img("ct-abdo-pelvis", { en: "CT abdomen / pelvis", tr: "Batın / pelvis BT" }),
    img("us-abdomen", { en: "Ultrasound abdomen", tr: "Batın ultrasonu" }),
    img("us-pelvis", { en: "Ultrasound pelvis", tr: "Pelvik ultrason" }),
    img("echo", { en: "Echocardiogram / POCUS", tr: "Ekokardiyografi / POCUS" }),
    img("mri-brain", { en: "MRI brain", tr: "Beyin MR" }),
  ],
  poc: [
    { code: "poc-glucose", label: { en: "Point-of-care glucose", tr: "Yatak başı glukoz" }, kind: "laboratory", category: "poc" },
    { code: "11524-6", label: { en: "12-lead ECG", tr: "12 derivasyonlu EKG" }, kind: "imaging", category: "poc" },
  ],
};

/** The catalog as a flat list. */
export const ORDERABLES: Orderable[] = Object.values(ORDERABLES_BY_GROUP).flat();

const ORDERABLE_BY_CODE: Map<string, Orderable> = new Map(
  ORDERABLES.map((o) => [o.code, o]),
);

/** The canonical group order for rendering. */
export const ORDER_GROUPS: OrderCategory[] = [
  "labs",
  "bloodgas",
  "micro",
  "imaging",
  "poc",
];

/** Look up a catalog orderable by its code (undefined if not catalogued). */
export function getOrderableByCode(code: string): Orderable | undefined {
  return ORDERABLE_BY_CODE.get(code);
}

/* -------------------------------------------------------------------------- */
/* Ground-truth precedence                                                     */
/* -------------------------------------------------------------------------- */

/**
 * True when the case authors a ground-truth lab or imaging datum for `code`.
 * Such a datum (typically the abnormal / diagnostic result) ALWAYS takes
 * precedence over a synthetic normal — callers must NOT synthesize for a code
 * this returns true for; the encounter store reveals the real datum on order.
 */
export function hasGroundTruthResult(
  caseInstance: CaseInstance,
  code: string,
): boolean {
  const gt = caseInstance.groundTruth;
  return (
    gt.labs.some((l) => l.orderCode === code) ||
    gt.imaging.some((im) => im.orderCode === code)
  );
}

/* -------------------------------------------------------------------------- */
/* Synthetic within-normal-limits results                                     */
/* -------------------------------------------------------------------------- */

function coding(code: string, system: string, display: string): Coding {
  return { system, code, display };
}

function normalObservation(
  spec: AnalyteSpec,
  subject: string,
  seedKey: string,
): Observation {
  const base: Observation = {
    resourceType: "Observation",
    id: `syn-${seedKey}`,
    status: "final",
    category: "laboratory",
    code: { coding: [coding(spec.code, spec.system, spec.label.en)], text: spec.label },
    subject,
    effectiveTime: 0,
    interpretation: "N",
    referenceRange: spec.ref,
  };
  if (spec.qualitative) {
    return { ...base, valueString: spec.qualitative };
  }
  const value = spec.band ? sample(seedKey, spec.band, spec.decimals ?? 0) : 0;
  return { ...base, valueQuantity: { value, ...(spec.unit ? { unit: spec.unit } : {}) } };
}

const NO_ACUTE: Bilingual = {
  en: "No acute abnormality identified. Representative teaching image; not this patient.",
  tr: "Akut anormallik saptanmadı. Temsili eğitim görüntüsü; bu hastaya ait değildir.",
};

const ECG_NORMAL: Bilingual = {
  en: "Normal sinus rhythm; no acute ischaemic changes.",
  tr: "Normal sinüs ritmi; akut iskemik değişiklik yok.",
};

const CULTURE_NORMAL: Bilingual = {
  en: "No growth after 48 hours (final).",
  tr: "48 saat sonunda üreme yok (nihai).",
};

const CULTURE_URINE_NORMAL: Bilingual = {
  en: "No significant growth (< 10^4 CFU/mL).",
  tr: "Anlamlı üreme yok (< 10^4 KOB/mL).",
};

const VIRAL_NEG: Bilingual = {
  en: "No respiratory viruses detected.",
  tr: "Solunum virüsü saptanmadı.",
};

function microConclusion(code: string): Bilingual {
  if (code === "urine-culture") return CULTURE_URINE_NORMAL;
  if (code === "resp-viral-panel") return VIRAL_NEG;
  return CULTURE_NORMAL;
}

function report(
  id: string,
  subject: string,
  category: DiagnosticReport["category"],
  label: Bilingual,
  conclusion: Bilingual,
): DiagnosticReport {
  return {
    resourceType: "DiagnosticReport",
    id: `syn-rep-${id}`,
    status: "final",
    category,
    code: { coding: [coding(id, L, label.en)], text: label },
    subject,
    issued: 0,
    result: [],
    conclusion,
  };
}

const GENERIC_WNL: Bilingual = {
  en: "Within normal limits.",
  tr: "Normal sınırlar içinde.",
};

/**
 * A plausible, deterministic WITHIN-NORMAL-LIMITS result for an order the case
 * carries NO ground-truth datum for. Labs/POC/blood-gas return a panel of normal
 * observations; imaging returns a "no acute abnormality" report; micro returns a
 * "no growth / not detected" report. Same case + code → same numbers.
 *
 * Callers gate this behind {@link hasGroundTruthResult}: a case's authored
 * (abnormal / relevant) datum always takes precedence over this synthetic value.
 */
export function syntheticNormalResult(
  orderable: Orderable,
  caseInstance: CaseInstance,
): { observations: Observation[]; report?: DiagnosticReport } {
  const subject = caseInstance.patient.id;
  const seedBase = `${caseInstance.id}::${orderable.code}`;

  // ECG (imaging-kind POC) — a normal tracing report + representative image.
  if (orderable.code === "11524-6") {
    return {
      observations: [],
      report: report(orderable.code, subject, "cardiology", orderable.label, ECG_NORMAL),
    };
  }

  // Imaging — a "no acute abnormality" report; the UI attaches a real image.
  if (orderable.kind === "imaging" || orderable.category === "imaging") {
    return {
      observations: [],
      report: report(orderable.code, subject, "imaging", orderable.label, NO_ACUTE),
    };
  }

  // Micro — a normal culture / panel report (no numeric observations).
  if (orderable.category === "micro") {
    return {
      observations: [],
      report: report(orderable.code, subject, "laboratory", orderable.label, microConclusion(orderable.code)),
    };
  }

  // Labs / blood gas / POC — a panel of normal observations.
  const panel = PANELS[orderable.code];
  if (panel && panel.length > 0) {
    return {
      observations: panel.map((spec) =>
        normalObservation(spec, subject, `${seedBase}::${spec.code}`),
      ),
    };
  }

  // Unknown code — a single generic "within normal limits" observation so ANY
  // ordered test still resolves to something sensible.
  const generic: AnalyteSpec = {
    code: orderable.code,
    system: L,
    label: orderable.label,
    ref: "—",
    qualitative: GENERIC_WNL,
  };
  return { observations: [normalObservation(generic, subject, seedBase)] };
}
