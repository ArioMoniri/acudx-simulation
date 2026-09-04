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
 *      ground-truth datum for, so any order still resolves to something. A panel
 *      order (CBC, BMP, LFTs, blood gas, UA …) expands to its FULL set of
 *      individual analytes — each with a value, unit and reference range — not a
 *      single line.
 *   3. `hasGroundTruthResult(case, code)` — the precedence gate: when a case
 *      authors an (abnormal / relevant) lab or imaging datum for a code, that
 *      ground truth ALWAYS wins over the synthetic normal. Precedence is applied
 *      per-analyte by the Results surface, so an authored abnormal (e.g. a raised
 *      creatinine on a BMP) sits inside an otherwise-complete normal panel.
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
export interface AnalyteSpec {
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
const NONE_SEEN: Bilingual = { en: "None seen", tr: "Görülmedi" };

/** A qualitative analyte (dipstick, tox screen) whose normal value is a word. */
const Q = (code: string, label: Bilingual, value: Bilingual, ref = "Negative"): AnalyteSpec =>
  A(code, label, ref, undefined, undefined, { qualitative: value });

/* --- shared chemistry analytes (reused across BMP / CMP / iSTAT) ---------- */

const NA = A("2951-2", { en: "Sodium", tr: "Sodyum" }, "135 - 145", [136, 143], "mmol/L");
const K = A("2823-3", { en: "Potassium", tr: "Potasyum" }, "3.5 - 5.1", [3.7, 4.9], "mmol/L", { decimals: 1 });
const CL = A("2075-0", { en: "Chloride", tr: "Klorür" }, "98 - 107", [99, 106], "mmol/L");
const HCO3 = A("1963-8", { en: "Bicarbonate", tr: "Bikarbonat" }, "22 - 29", [23, 28], "mmol/L");
const BUN = A("3094-0", { en: "Urea nitrogen (BUN)", tr: "Üre azotu (BUN)" }, "15 - 45", [18, 42], "mg/dL");
const CR = A("2160-0", { en: "Creatinine", tr: "Kreatinin" }, "0.7 - 1.3", [0.8, 1.2], "mg/dL", { decimals: 2 });
const GLU = A("2345-7", { en: "Glucose", tr: "Glukoz" }, "70 - 110", [78, 106], "mg/dL");
const CA = A("17861-6", { en: "Calcium", tr: "Kalsiyum" }, "8.5 - 10.2", [8.7, 10.0], "mg/dL", { decimals: 1 });
const AGAP = A("1863-0", { en: "Anion gap", tr: "Anyon açığı" }, "8 - 16", [9, 14], "mmol/L");

const TP = A("2885-2", { en: "Total protein", tr: "Total protein" }, "6.0 - 8.3", [6.3, 8.0], "g/dL", { decimals: 1 });
const ALB = A("1751-7", { en: "Albumin", tr: "Albümin" }, "3.5 - 5.0", [3.8, 4.8], "g/dL", { decimals: 1 });
const AST = A("1920-8", { en: "AST", tr: "AST" }, "10 - 40", [14, 36], "U/L");
const ALT = A("1742-6", { en: "ALT", tr: "ALT" }, "7 - 56", [12, 48], "U/L");
const ALP = A("6768-6", { en: "Alkaline phosphatase", tr: "ALP" }, "44 - 147", [60, 130], "U/L");
const TBILI = A("1975-2", { en: "Bilirubin, total", tr: "Total bilirubin" }, "0.1 - 1.2", [0.2, 1.0], "mg/dL", { decimals: 1 });

const LACTATE = A("2524-7", { en: "Lactate", tr: "Laktat" }, "0.5 - 2.0", [0.6, 1.8], "mmol/L", { decimals: 1 });
const PH_ART = A("2744-1", { en: "pH", tr: "pH" }, "7.35 - 7.45", [7.37, 7.44], undefined, { decimals: 2 });

/**
 * Panels keyed by order code. Absent code → generic single WNL observation.
 * Each panel is the FULL individual-analyte set for that test, so a resulted
 * panel renders as a complete report rather than a single line.
 */
const PANELS: Record<string, AnalyteSpec[]> = {
  /* ---- Haematology ------------------------------------------------------ */
  // CBC with differential.
  "6690-2": [
    A("6690-2", { en: "White cell count", tr: "Lökosit" }, "4.0 - 11.0", [4.5, 10.5], "10^9/L", { decimals: 1 }),
    A("789-8", { en: "Red cell count", tr: "Eritrosit" }, "4.2 - 5.9", [4.4, 5.7], "10^12/L", { decimals: 1 }),
    A("718-7", { en: "Haemoglobin", tr: "Hemoglobin" }, "12.0 - 16.0", [12.5, 15.5], "g/dL", { decimals: 1 }),
    A("4544-3", { en: "Haematocrit", tr: "Hematokrit" }, "36 - 48", [38, 46], "%"),
    A("787-2", { en: "MCV", tr: "MCV" }, "80 - 100", [82, 98], "fL"),
    A("785-6", { en: "MCH", tr: "MCH" }, "27 - 33", [28, 32], "pg", { decimals: 1 }),
    A("788-0", { en: "RDW", tr: "RDW" }, "11.5 - 14.5", [11.8, 14.2], "%", { decimals: 1 }),
    A("777-3", { en: "Platelets", tr: "Trombosit" }, "150 - 400", [180, 360], "10^9/L"),
    A("770-8", { en: "Neutrophils", tr: "Nötrofil" }, "40 - 70", [45, 65], "%"),
    A("736-9", { en: "Lymphocytes", tr: "Lenfosit" }, "20 - 45", [24, 42], "%"),
    A("5905-5", { en: "Monocytes", tr: "Monosit" }, "2 - 10", [3, 9], "%"),
    A("713-8", { en: "Eosinophils", tr: "Eozinofil" }, "1 - 4", [1, 4], "%"),
    A("706-2", { en: "Basophils", tr: "Bazofil" }, "0 - 1", [0, 1], "%"),
  ],
  // Reticulocyte count.
  retic: [
    A("17849-1", { en: "Reticulocytes", tr: "Retikülosit" }, "0.5 - 2.5", [0.6, 2.3], "%", { decimals: 1 }),
    A("60474-5", { en: "Reticulocyte, absolute", tr: "Retikülosit, mutlak" }, "25 - 75", [30, 70], "10^9/L"),
  ],
  // Erythrocyte sedimentation rate.
  esr: [
    A("4537-7", { en: "ESR", tr: "Sedimentasyon (ESR)" }, "0 - 20", [2, 18], "mm/h"),
  ],

  /* ---- Chemistry -------------------------------------------------------- */
  // BMP / renal panel (creatinine code aligns to ground-truth reveals).
  "2160-0": [NA, K, CL, HCO3, BUN, CR, GLU, CA, AGAP],
  // CMP — BMP plus hepatic panel.
  cmp: [NA, K, CL, HCO3, BUN, CR, GLU, CA, TP, ALB, AST, ALT, ALP, TBILI],
  // Liver function tests.
  lft: [
    AST,
    ALT,
    ALP,
    A("2324-2", { en: "GGT", tr: "GGT" }, "9 - 48", [12, 44], "U/L"),
    TBILI,
    A("1968-7", { en: "Bilirubin, direct", tr: "Direkt bilirubin" }, "0.0 - 0.3", [0.05, 0.25], "mg/dL", { decimals: 2 }),
    ALB,
    TP,
  ],
  // Lipase + amylase.
  lipase: [
    A("3040-3", { en: "Lipase", tr: "Lipaz" }, "10 - 140", [22, 120], "U/L"),
    A("1798-8", { en: "Amylase", tr: "Amilaz" }, "30 - 110", [38, 100], "U/L"),
  ],
  // Magnesium.
  mg: [A("2601-3", { en: "Magnesium", tr: "Magnezyum" }, "1.7 - 2.2", [1.8, 2.1], "mg/dL", { decimals: 1 })],
  // Phosphate.
  phos: [A("2777-1", { en: "Phosphate", tr: "Fosfat" }, "2.5 - 4.5", [2.7, 4.3], "mg/dL", { decimals: 1 })],
  // Calcium (total + ionised).
  ca: [
    CA,
    A("1994-3", { en: "Calcium, ionised", tr: "İyonize kalsiyum" }, "1.12 - 1.32", [1.15, 1.30], "mmol/L", { decimals: 2 }),
  ],
  // Creatine kinase.
  ck: [A("2157-6", { en: "Creatine kinase (CK)", tr: "Kreatin kinaz (CK)" }, "30 - 200", [45, 180], "U/L")],
  // CK-MB.
  ckmb: [A("13969-1", { en: "CK-MB", tr: "CK-MB" }, "0 - 5", [0.5, 4.5], "ng/mL", { decimals: 1 })],

  /* ---- Cardiac markers -------------------------------------------------- */
  // High-sensitivity troponin (code aligns to ground-truth reveals).
  "67151-1": [
    A("67151-1", { en: "hs-troponin T", tr: "hs-troponin T" }, "< 14", [2, 11], "ng/L"),
  ],
  // BNP.
  bnp: [A("30934-4", { en: "BNP", tr: "BNP" }, "< 100", [10, 80], "pg/mL")],
  // NT-proBNP.
  "33762-6": [
    A("33762-6", { en: "NT-proBNP", tr: "NT-proBNP" }, "< 125", [15, 95], "pg/mL"),
  ],
  // D-dimer (code aligns to ground-truth reveals).
  "48065-7": [
    A("48065-7", { en: "D-dimer", tr: "D-dimer" }, "< 500", [120, 440], "ng/mL"),
  ],

  /* ---- Coagulation ------------------------------------------------------ */
  "coag-inr": [
    A("6301-6", { en: "INR", tr: "INR" }, "0.8 - 1.1", [0.9, 1.1], undefined, { decimals: 2 }),
    A("5902-2", { en: "Prothrombin time", tr: "Protrombin zamanı" }, "11 - 13.5", [11.5, 13.2], "s", { decimals: 1 }),
    A("14979-9", { en: "aPTT", tr: "aPTT" }, "25 - 35", [27, 34], "s"),
    A("3255-7", { en: "Fibrinogen", tr: "Fibrinojen" }, "200 - 400", [230, 370], "mg/dL"),
  ],

  /* ---- Endocrine -------------------------------------------------------- */
  tsh: [
    A("3016-3", { en: "TSH", tr: "TSH" }, "0.4 - 4.0", [0.6, 3.6], "mIU/L", { decimals: 2 }),
    A("3024-7", { en: "Free T4", tr: "Serbest T4" }, "0.8 - 1.8", [0.9, 1.7], "ng/dL", { decimals: 1 }),
  ],
  hba1c: [A("4548-4", { en: "HbA1c", tr: "HbA1c" }, "4.0 - 5.6", [4.8, 5.5], "%", { decimals: 1 })],
  cortisol: [A("2143-6", { en: "Cortisol (AM)", tr: "Kortizol (sabah)" }, "5 - 25", [7, 22], "µg/dL", { decimals: 1 })],

  /* ---- Inflammatory ----------------------------------------------------- */
  // CRP (code aligns to ground-truth reveals).
  "1988-5": [
    A("1988-5", { en: "C-reactive protein", tr: "C-reaktif protein" }, "< 5", [0.4, 4.2], "mg/L", { decimals: 1 }),
  ],
  // Procalcitonin.
  pct: [A("33959-8", { en: "Procalcitonin", tr: "Prokalsitonin" }, "< 0.5", [0.02, 0.4], "ng/mL", { decimals: 2 })],
  // Lactate (code aligns to ground-truth reveals).
  "2524-7": [LACTATE],

  /* ---- Blood gas -------------------------------------------------------- */
  // Venous blood gas.
  vbg: [
    A("2744-1", { en: "pH", tr: "pH" }, "7.32 - 7.43", [7.34, 7.42], undefined, { decimals: 2 }),
    A("2019-8", { en: "pCO2", tr: "pCO2" }, "38 - 50", [40, 48], "mmHg"),
    A("2703-7", { en: "pO2", tr: "pO2" }, "30 - 50", [35, 48], "mmHg"),
    HCO3,
    A("1925-7", { en: "Base excess", tr: "Baz fazlalığı" }, "-2.0 - 2.0", [-1.5, 1.5], "mmol/L", { decimals: 1 }),
    LACTATE,
  ],
  // Arterial blood gas.
  abg: [
    PH_ART,
    A("2019-8", { en: "pCO2", tr: "pCO2" }, "35 - 45", [37, 44], "mmHg"),
    A("2703-7", { en: "pO2", tr: "pO2" }, "80 - 100", [85, 98], "mmHg"),
    A("1963-8", { en: "Bicarbonate", tr: "Bikarbonat" }, "22 - 26", [23, 26], "mmol/L"),
    A("1925-7", { en: "Base excess", tr: "Baz fazlalığı" }, "-2.0 - 2.0", [-1.5, 1.5], "mmol/L", { decimals: 1 }),
    A("2708-6", { en: "O2 saturation", tr: "O2 saturasyonu" }, "95 - 100", [96, 99], "%"),
    LACTATE,
  ],

  /* ---- Urine ------------------------------------------------------------ */
  // Urinalysis with microscopy.
  ua: [
    Q("5778-6", { en: "Colour", tr: "Renk" }, { en: "Yellow", tr: "Sarı" }, "—"),
    Q("32167-9", { en: "Clarity", tr: "Berraklık" }, { en: "Clear", tr: "Berrak" }, "—"),
    A("5811-5", { en: "Specific gravity", tr: "Dansite" }, "1.005 - 1.030", [1.008, 1.025], undefined, { decimals: 3 }),
    A("5803-2", { en: "pH", tr: "pH" }, "5.0 - 8.0", [5.5, 7.5], undefined, { decimals: 1 }),
    Q("5799-2", { en: "Leukocyte esterase", tr: "Lökosit esteraz" }, NEG),
    Q("5802-4", { en: "Nitrite", tr: "Nitrit" }, NEG),
    Q("5804-0", { en: "Protein", tr: "Protein" }, NEG),
    Q("5792-7", { en: "Glucose", tr: "Glukoz" }, NEG),
    Q("5797-6", { en: "Ketones", tr: "Keton" }, NEG),
    Q("5794-3", { en: "Blood", tr: "Kan" }, NEG),
    Q("5770-3", { en: "Bilirubin", tr: "Bilirubin" }, NEG),
    A("5818-0", { en: "Urobilinogen", tr: "Ürobilinojen" }, "0.2 - 1.0", [0.2, 0.9], "mg/dL", { decimals: 1 }),
    A("5821-4", { en: "WBC (microscopy)", tr: "Lökosit (mikroskopi)" }, "0 - 5", [0, 4], "/HPF"),
    A("5808-1", { en: "RBC (microscopy)", tr: "Eritrosit (mikroskopi)" }, "0 - 3", [0, 2], "/HPF"),
    Q("25145-4", { en: "Bacteria", tr: "Bakteri" }, NONE_SEEN, "—"),
  ],
  // Pregnancy test (qualitative β-hCG).
  bhcg: [Q("2106-3", { en: "β-hCG (serum)", tr: "β-hCG (serum)" }, NEG)],
  "urine-hcg": [Q("2110-5", { en: "β-hCG (urine)", tr: "β-hCG (idrar)" }, NEG)],
  // Urine toxicology screen.
  utox: [
    Q("19343-7", { en: "Amphetamines", tr: "Amfetaminler" }, NEG),
    Q("19270-2", { en: "Benzodiazepines", tr: "Benzodiazepinler" }, NEG),
    Q("3397-7", { en: "Cocaine metabolite", tr: "Kokain metaboliti" }, NEG),
    Q("19295-9", { en: "Opiates", tr: "Opiyatlar" }, NEG),
    Q("18282-8", { en: "Cannabinoids (THC)", tr: "Kannabinoidler (THC)" }, NEG),
    Q("18365-1", { en: "Barbiturates", tr: "Barbitüratlar" }, NEG),
  ],

  /* ---- Point-of-care ---------------------------------------------------- */
  "poc-glucose": [
    A("2339-0", { en: "Glucose (POC)", tr: "Glukoz (yatak başı)" }, "70 - 110", [78, 106], "mg/dL"),
  ],
  // iSTAT bedside chemistry / gas panel.
  istat: [
    NA,
    K,
    A("1994-3", { en: "Calcium, ionised", tr: "İyonize kalsiyum" }, "1.12 - 1.32", [1.15, 1.30], "mmol/L", { decimals: 2 }),
    A("2339-0", { en: "Glucose (POC)", tr: "Glukoz (yatak başı)" }, "70 - 110", [78, 106], "mg/dL"),
    A("4544-3", { en: "Haematocrit", tr: "Hematokrit" }, "36 - 48", [38, 46], "%"),
    PH_ART,
    LACTATE,
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
    // Haematology
    lab("6690-2", { en: "Complete blood count (CBC) with differential", tr: "Tam kan sayımı (Hemogram) + formül" }, "CBC"),
    lab("retic", { en: "Reticulocyte count", tr: "Retikülosit sayımı" }),
    lab("esr", { en: "ESR (sedimentation rate)", tr: "Sedimentasyon (ESR)" }),
    // Chemistry
    lab("2160-0", { en: "Basic metabolic panel (BMP)", tr: "Temel metabolik panel (BMP)" }, "BMP"),
    lab("cmp", { en: "Comprehensive metabolic panel (CMP)", tr: "Geniş metabolik panel (CMP)" }, "CMP"),
    lab("lft", { en: "Liver function tests (LFTs)", tr: "Karaciğer fonksiyon testleri" }, "LFT"),
    lab("lipase", { en: "Lipase / amylase", tr: "Lipaz / amilaz" }),
    lab("mg", { en: "Magnesium", tr: "Magnezyum" }),
    lab("phos", { en: "Phosphate", tr: "Fosfat" }),
    lab("ca", { en: "Calcium (total + ionised)", tr: "Kalsiyum (total + iyonize)" }),
    lab("ck", { en: "Creatine kinase (CK)", tr: "Kreatin kinaz (CK)" }),
    lab("ckmb", { en: "CK-MB", tr: "CK-MB" }),
    // Cardiac
    lab("67151-1", { en: "High-sensitivity troponin (serial)", tr: "Yüksek duyarlıklı troponin (seri)" }),
    lab("bnp", { en: "BNP", tr: "BNP" }),
    lab("33762-6", { en: "NT-proBNP", tr: "NT-proBNP" }),
    lab("48065-7", { en: "D-dimer", tr: "D-dimer" }),
    // Coagulation
    lab("coag-inr", { en: "Coagulation (PT / INR / aPTT / fibrinogen)", tr: "Koagülasyon (PT / INR / aPTT / fibrinojen)" }, "COAG"),
    // Endocrine
    lab("tsh", { en: "Thyroid (TSH / free T4)", tr: "Tiroid (TSH / serbest T4)" }),
    lab("hba1c", { en: "HbA1c", tr: "HbA1c" }),
    lab("cortisol", { en: "Cortisol (AM)", tr: "Kortizol (sabah)" }),
    // Inflammatory
    lab("1988-5", { en: "C-reactive protein (CRP)", tr: "C-reaktif protein (CRP)" }),
    lab("pct", { en: "Procalcitonin", tr: "Prokalsitonin" }),
    lab("2524-7", { en: "Lactate", tr: "Laktat" }),
    // Urine
    lab("ua", { en: "Urinalysis with microscopy", tr: "İdrar tahlili + mikroskopi" }),
    lab("bhcg", { en: "β-hCG, serum (pregnancy)", tr: "β-hCG, serum (gebelik)" }),
    lab("urine-hcg", { en: "β-hCG, urine (pregnancy)", tr: "β-hCG, idrar (gebelik)" }),
    lab("utox", { en: "Urine toxicology screen", tr: "İdrar toksikoloji taraması" }),
  ],
  bloodgas: [
    gas("vbg", { en: "Venous blood gas (VBG)", tr: "Venöz kan gazı (VKG)" }),
    gas("abg", { en: "Arterial blood gas (ABG)", tr: "Arteriyel kan gazı (AKG)" }),
  ],
  micro: [
    micro("blood-culture", { en: "Blood culture (×2) + Gram stain", tr: "Kan kültürü (×2) + Gram boyama" }),
    micro("urine-culture", { en: "Urine culture", tr: "İdrar kültürü" }),
    micro("sputum-culture", { en: "Sputum culture + Gram stain", tr: "Balgam kültürü + Gram boyama" }),
    micro("gram-stain", { en: "Gram stain", tr: "Gram boyama" }),
    micro("resp-viral-panel", { en: "Respiratory viral panel (PCR)", tr: "Solunum viral paneli (PCR)" }),
    micro("csf-studies", { en: "CSF studies (cell count / protein / glucose / culture)", tr: "BOS incelemesi (hücre / protein / glukoz / kültür)" }),
    micro("hepatitis-panel", { en: "Hepatitis serology panel", tr: "Hepatit serolojisi paneli" }),
    micro("hiv", { en: "HIV Ag/Ab (4th-gen)", tr: "HIV Ag/Ab (4. jenerasyon)" }),
    micro("monospot", { en: "Monospot (EBV heterophile)", tr: "Monospot (EBV heterofil)" }),
  ],
  imaging: [
    img("cxr", { en: "Chest X-ray (CXR)", tr: "Akciğer grafisi (PA)" }),
    img("axr", { en: "Abdominal X-ray (AXR / KUB)", tr: "Ayakta direkt karın grafisi (KUB)" }),
    img("xr-extremity", { en: "Extremity X-ray", tr: "Ekstremite grafisi" }),
    img("ct-head-noncon", { en: "CT head (non-contrast)", tr: "Beyin BT (kontrastsız)" }),
    img("ct-cspine", { en: "CT cervical spine", tr: "Servikal vertebra BT" }),
    img("ctpa", { en: "CT chest / pulmonary angiogram (CTPA)", tr: "Toraks BT / pulmoner anjiyografi (BTPA)" }),
    img("ct-abdo-pelvis", { en: "CT abdomen / pelvis (contrast)", tr: "Batın / pelvis BT (kontrastlı)" }),
    img("us-abdomen", { en: "Ultrasound abdomen", tr: "Batın ultrasonu" }),
    img("us-pelvis", { en: "Ultrasound pelvis (± Doppler)", tr: "Pelvik ultrason (± Doppler)" }),
    img("us-renal", { en: "Renal / bladder ultrasound", tr: "Renal / mesane ultrasonu" }),
    img("us-dvt", { en: "Lower-limb venous Doppler (DVT)", tr: "Alt ekstremite venöz Doppler (DVT)" }),
    img("echo", { en: "Echocardiogram / POCUS", tr: "Ekokardiyografi / POCUS" }),
    img("mri-brain", { en: "MRI brain", tr: "Beyin MR" }),
  ],
  poc: [
    { code: "poc-glucose", label: { en: "Point-of-care glucose", tr: "Yatak başı glukoz" }, kind: "laboratory", category: "poc" },
    { code: "istat", label: { en: "iSTAT bedside panel", tr: "iSTAT yatak başı panel" }, kind: "laboratory", category: "poc" },
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

/** True when a catalogued lab/POC/blood-gas order expands to a multi-analyte
 *  panel (as opposed to a single generic observation for an unknown code). */
export function isPanelOrder(code: string): boolean {
  const panel = PANELS[code];
  return !!panel && panel.length > 0;
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
  return { ...base, valueQuantity: { value, unit: spec.unit ?? "" } };
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
  en: "No growth after 48 hours (final). Gram stain: no organisms seen.",
  tr: "48 saat sonunda üreme yok (nihai). Gram boyama: organizma görülmedi.",
};

const CULTURE_URINE_NORMAL: Bilingual = {
  en: "No significant growth (< 10^4 CFU/mL).",
  tr: "Anlamlı üreme yok (< 10^4 KOB/mL).",
};

const SPUTUM_NORMAL: Bilingual = {
  en: "Normal respiratory flora. Gram stain: mixed flora, no predominant organism.",
  tr: "Normal solunum florası. Gram boyama: karışık flora, baskın organizma yok.",
};

const GRAM_NORMAL: Bilingual = {
  en: "No organisms seen; occasional epithelial cells.",
  tr: "Organizma görülmedi; nadir epitel hücresi.",
};

const VIRAL_NEG: Bilingual = {
  en: "No respiratory viruses detected (influenza A/B, RSV, SARS-CoV-2 not detected).",
  tr: "Solunum virüsü saptanmadı (influenza A/B, RSV, SARS-CoV-2 negatif).",
};

const CSF_NORMAL: Bilingual = {
  en: "Clear and colourless; WBC 2 /µL, RBC 0 /µL, protein 32 mg/dL, glucose 60 mg/dL; Gram stain: no organisms; culture pending.",
  tr: "Berrak ve renksiz; lökosit 2 /µL, eritrosit 0 /µL, protein 32 mg/dL, glukoz 60 mg/dL; Gram boyama: organizma yok; kültür beklemede.",
};

const HEP_NEG: Bilingual = {
  en: "HBsAg negative; anti-HBs positive (immune); anti-HCV non-reactive; anti-HAV IgM negative.",
  tr: "HBsAg negatif; anti-HBs pozitif (bağışık); anti-HCV negatif; anti-HAV IgM negatif.",
};

const HIV_NEG: Bilingual = {
  en: "HIV Ag/Ab (4th-generation) non-reactive.",
  tr: "HIV Ag/Ab (4. jenerasyon) negatif.",
};

const MONOSPOT_NEG: Bilingual = {
  en: "Heterophile antibody (Monospot) negative.",
  tr: "Heterofil antikor (Monospot) negatif.",
};

const MICRO_CONCLUSIONS: Record<string, Bilingual> = {
  "urine-culture": CULTURE_URINE_NORMAL,
  "sputum-culture": SPUTUM_NORMAL,
  "gram-stain": GRAM_NORMAL,
  "resp-viral-panel": VIRAL_NEG,
  "csf-studies": CSF_NORMAL,
  "hepatitis-panel": HEP_NEG,
  hiv: HIV_NEG,
  monospot: MONOSPOT_NEG,
};

function microConclusion(code: string): Bilingual {
  return MICRO_CONCLUSIONS[code] ?? CULTURE_NORMAL;
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
 * observations (the FULL individual-analyte set); imaging returns a "no acute
 * abnormality" report; micro returns a "no growth / not detected" report. Same
 * case + code → same numbers.
 *
 * Callers apply {@link hasGroundTruthResult} per-analyte: a case's authored
 * (abnormal / relevant) datum always takes precedence over the matching
 * synthetic value, while the rest of the panel stays complete and normal.
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

  // Labs / blood gas / POC — the full panel of normal observations.
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
