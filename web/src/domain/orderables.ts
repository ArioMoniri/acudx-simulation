/**
 * AcuDx — comprehensive orderable catalog + synthetic within-normal-limits
 * results.
 *
 * OFFLINE PATH ONLY for the synthetic values: when the gateway is reachable the
 * encounter store resolves every order through the server results engine
 * (src/lib/resultsApi.ts, docs/architecture/14) and these generators are not
 * consulted. When it is not, the Results surface labels every value built here
 * "offline synthetic normal" (meta.source = "offline-synthetic-normal").
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
  type ObservationInterpretation,
  type ServiceRequestKind,
} from "@/domain/fhir";
import {
  currentVitals,
  type AdministeredTreatment,
  type CurrentVitals,
} from "@/domain/clinicalCourse";

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
const NONE_DETECTED: Bilingual = { en: "None detected", tr: "Saptanmadı" };

/** A qualitative analyte (dipstick, tox screen) whose normal value is a word. */
const Q = (code: string, label: Bilingual, value: Bilingual, ref = "Negative"): AnalyteSpec =>
  A(code, label, ref, undefined, undefined, { qualitative: value });

/* --- shared chemistry analytes (reused across BMP / CMP / iSTAT) ---------- */

const NA = A("2951-2", { en: "Sodium", tr: "Sodyum" }, "135 - 145", [136, 143], "mmol/L");
const K = A("2823-3", { en: "Potassium", tr: "Potasyum" }, "3.5 - 5.1", [3.7, 4.9], "mmol/L", { decimals: 1 });
const CL = A("2075-0", { en: "Chloride", tr: "Klorür" }, "98 - 107", [99, 106], "mmol/L");
const HCO3 = A("1963-8", { en: "Bicarbonate", tr: "Bikarbonat" }, "22 - 29", [23, 28], "mmol/L");
const BUN = A("3094-0", { en: "Urea nitrogen (BUN)", tr: "Üre azotu (BUN)" }, "7 - 20", [8, 18], "mg/dL");
const CR = A("2160-0", { en: "Creatinine", tr: "Kreatinin" }, "0.7 - 1.3", [0.8, 1.2], "mg/dL", { decimals: 2 });
// Review 02 finding 22: ONE unit system for glucose project-wide. The server
// fixtures and the client case generator report glucose in mmol/L, so the
// synthetic panels do too (70-110 mg/dL = 3.9-6.1 mmol/L).
const GLU = A("2345-7", { en: "Glucose", tr: "Glukoz" }, "3.9 - 6.1", [4.3, 5.9], "mmol/L", { decimals: 1 });
const GLU_POC = A("2339-0", { en: "Glucose (POC)", tr: "Glukoz (yatak başı)" }, "3.9 - 6.1", [4.3, 5.9], "mmol/L", { decimals: 1 });
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
  // Serum β-hydroxybutyrate (ketone); rises markedly in DKA (tuned up for DKA).
  bhb: [A("6873-4", { en: "β-hydroxybutyrate", tr: "β-hidroksibutirat" }, "< 0.6", [0.0, 0.4], "mmol/L", { decimals: 1 })],
  // Serum osmolality.
  osmo: [A("2692-2", { en: "Osmolality, serum", tr: "Ozmolalite, serum" }, "275 - 295", [278, 293], "mOsm/kg")],
  // Ammonia (venous/arterial plasma).
  ammonia: [A("16362-6", { en: "Ammonia", tr: "Amonyak" }, "11 - 45", [14, 42], "µmol/L")],
  // Ferritin.
  ferritin: [A("2276-4", { en: "Ferritin", tr: "Ferritin" }, "30 - 300", [45, 280], "ng/mL")],
  // Lactate dehydrogenase.
  ldh: [A("14804-9", { en: "LDH", tr: "LDH" }, "140 - 280", [160, 260], "U/L")],
  // Uric acid (urate). Adult reference ~3.5-7.2 mg/dL (sex-pooled band).
  "uric-acid": [A("3084-1", { en: "Uric acid (urate)", tr: "Ürik asit (ürat)" }, "3.5 - 7.2", [3.9, 6.8], "mg/dL", { decimals: 1 })],

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
  // Quantitative serum β-hCG (non-pregnant baseline).
  "bhcg-quant": [A("21198-7", { en: "β-hCG, quantitative", tr: "β-hCG, kantitatif" }, "< 5", [0.0, 3.0], "mIU/mL", { decimals: 1 })],
  // Urine toxicology screen.
  utox: [
    Q("19343-7", { en: "Amphetamines", tr: "Amfetaminler" }, NEG),
    Q("19270-2", { en: "Benzodiazepines", tr: "Benzodiazepinler" }, NEG),
    Q("3397-7", { en: "Cocaine metabolite", tr: "Kokain metaboliti" }, NEG),
    Q("19295-9", { en: "Opiates", tr: "Opiyatlar" }, NEG),
    Q("18282-8", { en: "Cannabinoids (THC)", tr: "Kannabinoidler (THC)" }, NEG),
    Q("18365-1", { en: "Barbiturates", tr: "Barbitüratlar" }, NEG),
  ],

  /* ---- Serum toxicology / therapeutic levels ---------------------------- */
  // Serum acetaminophen (therapeutic 10-30 mg/L; hepatotoxicity per Rumack-Matthew).
  acetaminophen: [Q("3297-9", { en: "Acetaminophen (serum)", tr: "Asetaminofen (serum)" }, NONE_DETECTED, "Not detected (therapeutic 10 - 30 mg/L)")],
  // Serum salicylate (therapeutic 15-30 mg/dL; toxic > 40-50 mg/dL).
  salicylate: [Q("4024-6", { en: "Salicylate (serum)", tr: "Salisilat (serum)" }, NONE_DETECTED, "Not detected (therapeutic 15 - 30 mg/dL)")],
  // Serum ethanol (sober baseline: none detected).
  ethanol: [Q("20470-1", { en: "Ethanol (serum)", tr: "Etanol (serum)" }, NONE_DETECTED, "Not detected")],

  /* ---- Blood bank ------------------------------------------------------- */
  // Type & screen: ABO/Rh typing + antibody screen (narrative/qualitative).
  "type-screen": [
    Q("883-9", { en: "ABO group", tr: "ABO grubu" }, { en: "Group O", tr: "0 grubu" }, "—"),
    Q("10331-7", { en: "Rh(D) type", tr: "Rh(D) tipi" }, { en: "Positive", tr: "Pozitif" }, "—"),
    Q("890-4", { en: "Antibody screen", tr: "Antikor taraması" }, NEG),
  ],

  /* ---- Point-of-care ---------------------------------------------------- */
  "poc-glucose": [GLU_POC],
  // iSTAT bedside chemistry / gas panel.
  istat: [
    NA,
    K,
    A("1994-3", { en: "Calcium, ionised", tr: "İyonize kalsiyum" }, "1.12 - 1.32", [1.15, 1.30], "mmol/L", { decimals: 2 }),
    GLU_POC,
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
    lab("bhb", { en: "β-hydroxybutyrate (serum ketone)", tr: "β-hidroksibutirat (serum keton)" }),
    lab("osmo", { en: "Serum osmolality", tr: "Serum ozmolalitesi" }),
    lab("ammonia", { en: "Ammonia", tr: "Amonyak" }),
    lab("ferritin", { en: "Ferritin", tr: "Ferritin" }),
    lab("ldh", { en: "Lactate dehydrogenase (LDH)", tr: "Laktat dehidrogenaz (LDH)" }),
    lab("uric-acid", { en: "Uric acid (urate)", tr: "Ürik asit (ürat)" }),
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
    lab("bhcg-quant", { en: "β-hCG, quantitative (serum)", tr: "β-hCG, kantitatif (serum)" }),
    lab("urine-hcg", { en: "β-hCG, urine (pregnancy)", tr: "β-hCG, idrar (gebelik)" }),
    lab("utox", { en: "Urine toxicology screen", tr: "İdrar toksikoloji taraması" }),
    // Serum toxicology / therapeutic levels
    lab("acetaminophen", { en: "Acetaminophen level (serum)", tr: "Asetaminofen düzeyi (serum)" }),
    lab("salicylate", { en: "Salicylate level (serum)", tr: "Salisilat düzeyi (serum)" }),
    lab("ethanol", { en: "Ethanol level (serum)", tr: "Etanol düzeyi (serum)" }),
    // Blood bank
    lab("type-screen", { en: "Type & screen (ABO/Rh + antibody screen)", tr: "Kan grubu tayini + antikor taraması" }),
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
    img("ct-chest", { en: "CT chest (contrast)", tr: "Toraks BT (kontrastlı)" }),
    img("ctpa", { en: "CT chest / pulmonary angiogram (CTPA)", tr: "Toraks BT / pulmoner anjiyografi (BTPA)" }),
    img("cta-chest", { en: "CT angiogram chest (CTA)", tr: "Toraks BT anjiyografi (CTA)" }),
    img("ct-aorta", { en: "CT aorta (dissection protocol)", tr: "Aort BT (diseksiyon protokolü)" }),
    img("ct-abdo-pelvis", { en: "CT abdomen / pelvis (contrast)", tr: "Batın / pelvis BT (kontrastlı)" }),
    img("ct-kub", { en: "CT KUB (non-contrast, renal colic / stone protocol)", tr: "BT KUB (kontrastsız, taş protokolü)" }),
    img("us-abdomen", { en: "Ultrasound abdomen", tr: "Batın ultrasonu" }),
    img("us-ruq", { en: "Ultrasound RUQ (biliary)", tr: "Sağ üst kadran ultrasonu (bilier)" }),
    img("us-pelvis", { en: "Ultrasound pelvis / transvaginal (± Doppler)", tr: "Pelvik / transvajinal ultrason (± Doppler)" }),
    img("us-renal", { en: "Renal / bladder ultrasound", tr: "Renal / mesane ultrasonu" }),
    img("us-dvt", { en: "Lower-limb venous Doppler (DVT)", tr: "Alt ekstremite venöz Doppler (DVT)" }),
    img("us-fast", { en: "FAST ultrasound (trauma)", tr: "FAST ultrason (travma)" }),
    img("echo", { en: "Echocardiogram (TTE) / POCUS", tr: "Ekokardiyografi (TTE) / POCUS" }),
    img("mri-brain", { en: "MRI brain", tr: "Beyin MR" }),
    img("mri-cspine", { en: "MRI cervical spine", tr: "Servikal vertebra MR" }),
    img("mri-lspine", { en: "MRI lumbar spine", tr: "Lomber vertebra MR" }),
    img("mri-mrcp", { en: "MRI abdomen / MRCP", tr: "Batın MR / MRCP" }),
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

/* -------------------------------------------------------------------------- */
/* Condition-specific + time-dynamic synthesis                                 */
/* -------------------------------------------------------------------------- */

/**
 * Options steering how a synthetic result is synthesised. With `dynamic` FALSE
 * (the default) the output is the pure within-normal-limits panel used as a
 * deterministic baseline (and asserted by the unit tests). With `dynamic` TRUE
 * the result is tuned to THIS case's condition AND to the live clinical course
 * at the draw time — so a cardiac marker rises across serial troponins, a
 * lactate falls after resuscitation, and a repeat gas improves after treatment.
 */
export interface SyntheticContext {
  /** Sim-clock time the sample was drawn (order.placedAt), ms. Default 0. */
  drawMs?: number;
  /** Treatments administered so far (drives perfusion / clearance responses). */
  treatments?: AdministeredTreatment[];
  /** Apply condition tuning + time dynamics. Default false → pure WNL baseline. */
  dynamic?: boolean;
  /** 0-based serial draw index (0 = first draw carries authored truth). */
  drawIndex?: number;
}

export interface SyntheticResult {
  observations: Observation[];
  report?: DiagnosticReport;
  /** True when the (dynamic) synthetic reads abnormal for the case's condition. */
  abnormal?: boolean;
}

function clampNum(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Every modelled analyte spec, indexed by its code (first definition wins). */
const ANALYTE_INDEX: Map<string, AnalyteSpec> = (() => {
  const m = new Map<string, AnalyteSpec>();
  for (const specs of Object.values(PANELS)) {
    for (const s of specs) if (!m.has(s.code)) m.set(s.code, s);
  }
  return m;
})();

/** How an abnormal analyte moves over clinical time + treatment. */
type Kinetics = "rise" | "perfusion" | "inflammatory" | "glucose" | "static";

const KINETICS_BY_CODE: Record<string, Kinetics> = {
  "67151-1": "rise",
  "2157-6": "rise",
  "13969-1": "rise",
  "2524-7": "perfusion",
  "2703-7": "perfusion",
  "2019-8": "perfusion",
  "2708-6": "perfusion",
  "1925-7": "perfusion",
  "2744-1": "perfusion",
  "1963-8": "perfusion",
  "1863-0": "perfusion",
  "6690-2": "inflammatory",
  "770-8": "inflammatory",
  "1988-5": "inflammatory",
  "33959-8": "inflammatory",
  "4537-7": "inflammatory",
  "2345-7": "glucose",
  "2339-0": "glucose",
  "6873-4": "glucose",
};
function kineticsOf(code: string): Kinetics {
  return KINETICS_BY_CODE[code] ?? "static";
}

/* --- condition → abnormal analyte targets (presentation magnitudes) -------- */

type ConditionTag =
  | "acs"
  | "pe"
  | "chf"
  | "sepsis"
  | "pneumonia"
  | "appendicitis"
  | "pancreatitis"
  | "hepatic"
  | "renal"
  | "dka"
  | "uti"
  | "anemia"
  | "thyrotoxic"
  | "meningitis";

interface AnalyteTarget {
  code: string;
  /** Presentation-time magnitude (absolute), for numeric analytes. */
  value?: number;
  /** Qualitative positive value, for dipstick / micro-style analytes. */
  qual?: Bilingual;
  interp: ObservationInterpretation;
}
const nT = (code: string, value: number, interp: ObservationInterpretation): AnalyteTarget => ({ code, value, interp });
const qT = (code: string, qual: Bilingual, interp: ObservationInterpretation = "A"): AnalyteTarget => ({ code, qual, interp });

const POS: Bilingual = { en: "Positive", tr: "Pozitif" };
const MANY_BACT: Bilingual = { en: "Many", tr: "Çok sayıda" };

const CONDITION_TARGETS: Record<ConditionTag, AnalyteTarget[]> = {
  acs: [nT("67151-1", 55, "HH"), nT("2157-6", 340, "H"), nT("13969-1", 12, "H")],
  pe: [nT("48065-7", 2400, "H"), nT("2703-7", 68, "L"), nT("2019-8", 31, "L"), nT("2708-6", 91, "L"), nT("2524-7", 2.4, "H")],
  chf: [nT("30934-4", 780, "H"), nT("33762-6", 3200, "H")],
  sepsis: [nT("6690-2", 17.5, "H"), nT("770-8", 86, "H"), nT("1988-5", 140, "H"), nT("33959-8", 6.5, "H"), nT("2524-7", 3.6, "H")],
  pneumonia: [nT("6690-2", 15.5, "H"), nT("770-8", 82, "H"), nT("1988-5", 110, "H"), nT("33959-8", 1.8, "H")],
  appendicitis: [nT("6690-2", 15, "H"), nT("770-8", 80, "H"), nT("1988-5", 45, "H")],
  pancreatitis: [nT("3040-3", 920, "H"), nT("1798-8", 340, "H"), nT("6690-2", 13.5, "H")],
  hepatic: [nT("1920-8", 180, "H"), nT("1742-6", 210, "H"), nT("6768-6", 160, "H"), nT("1975-2", 3.2, "H"), nT("2324-2", 120, "H")],
  renal: [nT("2160-0", 2.8, "H"), nT("3094-0", 52, "H"), nT("2823-3", 5.4, "H"), nT("1963-8", 18, "L")],
  dka: [nT("2345-7", 24.4, "H"), nT("2339-0", 24.4, "H"), nT("6873-4", 4.8, "HH"), nT("1963-8", 12, "L"), nT("1863-0", 24, "H"), nT("2823-3", 5.2, "H"), nT("2744-1", 7.22, "L"), qT("5797-6", POS), qT("5792-7", POS)],
  uti: [qT("5799-2", POS), qT("5802-4", POS), nT("5821-4", 40, "H"), qT("25145-4", MANY_BACT)],
  anemia: [nT("718-7", 8.5, "L"), nT("4544-3", 27, "L"), nT("789-8", 3.1, "L")],
  thyrotoxic: [nT("3016-3", 0.02, "L"), nT("3024-7", 3.2, "H")],
  meningitis: [nT("6690-2", 14, "H")],
};

/** Derive coarse condition tags from the case's diagnosis + presentation. */
function conditionTagsFor(c: CaseInstance): Set<ConditionTag> {
  const dxCode = c.correctDiagnosis.code.coding[0]?.code ?? "";
  const hay = [
    dxCode,
    c.correctDiagnosis.code.coding[0]?.display,
    c.correctDiagnosis.code.text?.en,
    c.correctDiagnosis.code.text?.tr,
    c.chiefComplaint.en,
    c.chiefComplaint.tr,
    ...c.expectedWorkup.map((w) => w.label.en),
    ...c.redFlags.map((r) => r.en),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const kw = (...ks: string[]) => ks.some((k) => hay.includes(k));
  const tags = new Set<ConditionTag>();
  if (/^i2[01]/.test(dxCode) || kw("myocardial", "coronary", "nstemi", "stemi", "angina", "miyokart", "koroner")) tags.add("acs");
  if (/^i26/.test(dxCode) || kw("pulmonary embolism", "emboli", "pulmoner emb")) tags.add("pe");
  if (/^i50/.test(dxCode) || kw("heart failure", "kalp yetmez", "pulmonary oedema", "pulmonary edema")) tags.add("chf");
  if (kw("sepsis", "septic", "sepsi", "septik")) tags.add("sepsis");
  if (/^j18/.test(dxCode) || kw("pneumonia", "pnömoni", "pnomoni")) tags.add("pneumonia");
  if (/^k35/.test(dxCode) || kw("appendicitis", "apandisit")) tags.add("appendicitis");
  if (kw("pancreatitis", "pankreatit")) tags.add("pancreatitis");
  if (kw("hepatitis", "hepatic", "cholangitis", "karaciğer", "kolanjit")) tags.add("hepatic");
  if (kw("renal failure", "kidney injury", "acute kidney", "böbrek yetmez", "nephritis", "nefrit")) tags.add("renal");
  if (kw("ketoacidosis", "ketoasidoz", "diabetic keto", "hyperglycaem", "hyperglycem")) tags.add("dka");
  if (kw("urinary tract", "pyelonephritis", "cystitis", "idrar yolu", "piyelonefrit", "sistit")) tags.add("uti");
  if (kw("anaemia", "anemia", "anemi", "melena", "melaena", "hematemesis", "gi bleed", "gastrointestinal bleed")) tags.add("anemia");
  if (kw("thyrotox", "hyperthyroid", "tirotoksik", "hipertiroid", "thyroid storm", "tiroid fırtına")) tags.add("thyrotoxic");
  if (kw("meningitis", "menenjit", "encephalitis", "ensefalit")) tags.add("meningitis");
  return tags;
}

const TAGS_CACHE = new Map<string, Set<ConditionTag>>();
function cachedTags(c: CaseInstance): Set<ConditionTag> {
  let x = TAGS_CACHE.get(c.id);
  if (!x) {
    x = conditionTagsFor(c);
    TAGS_CACHE.set(c.id, x);
  }
  return x;
}

const TARGETS_CACHE = new Map<string, Map<string, AnalyteTarget>>();
/** The union of abnormal analyte targets implied by the case's condition. */
function conditionTargets(c: CaseInstance): Map<string, AnalyteTarget> {
  let m = TARGETS_CACHE.get(c.id);
  if (m) return m;
  m = new Map<string, AnalyteTarget>();
  for (const tag of cachedTags(c)) {
    for (const tg of CONDITION_TARGETS[tag]) if (!m.has(tg.code)) m.set(tg.code, tg);
  }
  TARGETS_CACHE.set(c.id, m);
  return m;
}

/* --- course-driven modulation --------------------------------------------- */

/** A coarse abnormality score for a vitals snapshot (higher = sicker). */
function severityScore(v: CurrentVitals): number {
  let s = 0;
  if (v.spo2 < 94) s += 94 - v.spo2;
  if (v.systolic < 100) s += (100 - v.systolic) * 0.5;
  if (v.hr > 100) s += (v.hr - 100) * 0.3;
  if (v.hr < 50) s += (50 - v.hr) * 0.3;
  if (v.rr > 20) s += (v.rr - 20) * 0.5;
  if (v.tempC > 38) s += (v.tempC - 38) * 2;
  return s;
}

/** Sickness at draw time relative to encounter start (1 = same, <1 = better). */
function illnessRatio(c: CaseInstance, drawMs: number, treatments: AdministeredTreatment[]): number {
  const t = Math.max(0, drawMs);
  const sevT = severityScore(currentVitals(c, t, treatments));
  const sev0 = severityScore(currentVitals(c, 0, []));
  return clampNum((sevT + 1.5) / (sev0 + 1.5), 0.15, 1.3);
}

const isAbxCode = (code: string) => code === "2193" || /cef|penem|cillin|floxacin|micin|antibio|tazo/i.test(code);
const isInsulinCode = (code: string) => code === "5856" || /insulin|insülin/i.test(code);

/** Earliest administration time (≤ drawMs) of a matching treatment, or null. */
function earliestDoseBefore(
  treatments: AdministeredTreatment[],
  drawMs: number,
  pred: (code: string) => boolean,
): number | null {
  let earliest: number | null = null;
  for (const tr of treatments) {
    if (tr.at > drawMs || !pred(tr.code)) continue;
    earliest = earliest == null ? tr.at : Math.min(earliest, tr.at);
  }
  return earliest;
}

/** The multiplier applied to an analyte's presentation magnitude at draw time. */
function kineticsFactor(
  kin: Kinetics,
  _c: CaseInstance,
  drawMs: number,
  treatments: AdministeredTreatment[],
  ratio: number,
): number {
  const hours = Math.max(0, drawMs) / 3_600_000;
  switch (kin) {
    case "rise":
      // Release markers climb with time from onset (independent of treatment).
      return clampNum(1 + 0.55 * hours, 1, 3);
    case "perfusion":
      // Track the live course: improve as vitals recover (e.g. after fluids/O2).
      return ratio;
    case "inflammatory": {
      const abxAt = earliestDoseBefore(treatments, drawMs, isAbxCode);
      const decline = abxAt == null ? 1 : clampNum(1 - 0.12 * ((drawMs - abxAt) / 3_600_000), 0.6, 1);
      return clampNum(ratio * decline, 0.4, 1.2);
    }
    case "glucose": {
      const insAt = earliestDoseBefore(treatments, drawMs, isInsulinCode);
      return insAt == null ? 1 : clampNum(1 - 0.25 * ((drawMs - insAt) / 3_600_000), 0.25, 1);
    }
    default:
      return 1;
  }
}

function midOf(spec: AnalyteSpec | undefined, fallback: number): number {
  if (spec?.band) return (spec.band[0] + spec.band[1]) / 2;
  return fallback;
}

/** Move a presentation magnitude toward normal (or up, for rise markers). */
function modelValue(
  base: number,
  spec: AnalyteSpec | undefined,
  kin: Kinetics,
  factor: number,
  seedKey: string,
  decimals: number,
): number {
  const mid = midOf(spec, base);
  let raw = kin === "rise" ? base * factor : mid + (base - mid) * factor;
  // Deterministic ± jitter so serial identical-time draws still vary a little.
  const j = rand01(hashStr(`${seedKey}::j`)) - 0.5;
  const bandSpan = spec?.band ? spec.band[1] - spec.band[0] : 0;
  raw += j * (Math.abs(base - mid) * 0.04 + bandSpan * 0.03);
  const f = 10 ** decimals;
  return Math.round(raw * f) / f;
}

/** Interpretation flag derived from where the value sits in its normal band. */
function interpFromBand(
  value: number,
  spec: AnalyteSpec | undefined,
  fallback: ObservationInterpretation,
): ObservationInterpretation {
  if (!spec?.band) return fallback;
  const [lo, hi] = spec.band;
  const span = hi - lo || 1;
  if (value > hi) return value > hi + span * 2 ? "HH" : "H";
  if (value < lo) return value < lo - span * 2 ? "LL" : "L";
  return "N";
}

/** One dynamic panel analyte: condition target modulated by course, else WNL. */
function dynamicObservation(
  spec: AnalyteSpec,
  subject: string,
  seedKey: string,
  c: CaseInstance,
  ctx: SyntheticContext,
  target: AnalyteTarget | undefined,
): Observation {
  const drawIndex = ctx.drawIndex ?? 0;
  const base: Observation = {
    resourceType: "Observation",
    id: `syn-${seedKey}-d${drawIndex}`,
    status: "final",
    category: "laboratory",
    code: { coding: [coding(spec.code, spec.system, spec.label.en)], text: spec.label },
    subject,
    effectiveTime: Math.max(0, ctx.drawMs ?? 0),
    interpretation: "N",
    referenceRange: spec.ref,
  };
  // Qualitative analyte: condition positive, else its normal word.
  if (spec.qualitative || target?.qual) {
    if (target?.qual) return { ...base, interpretation: target.interp, valueString: target.qual };
    return { ...base, valueString: spec.qualitative ?? GENERIC_WNL };
  }
  const treatments = ctx.treatments ?? [];
  const drawMs = Math.max(0, ctx.drawMs ?? 0);
  if (target && typeof target.value === "number") {
    const kin = kineticsOf(spec.code);
    const ratio = illnessRatio(c, drawMs, treatments);
    const factor = kineticsFactor(kin, c, drawMs, treatments, ratio);
    const value = modelValue(target.value, spec, kin, factor, seedKey, spec.decimals ?? 0);
    return { ...base, valueQuantity: { value, unit: spec.unit ?? "" }, interpretation: interpFromBand(value, spec, target.interp) };
  }
  // No condition target → a normal value with a small per-draw variation.
  const value = spec.band ? sample(`${seedKey}-d${drawIndex}`, spec.band, spec.decimals ?? 0) : 0;
  return { ...base, valueQuantity: { value, unit: spec.unit ?? "" } };
}

/**
 * Sex-specific haemoglobin / haematocrit reference intervals. Review 02
 * finding 21 (major): one pooled 12.0-16.0 g/dL interval flagged a man with Hb
 * 12.6 as normal. Men ~13.5-17.5 g/dL (Hct 41-50%), women ~12.0-15.5 g/dL
 * (Hct 36-44%): MedlinePlus https://medlineplus.gov/ency/article/003645.htm
 */
export function sexSpecificSpec(spec: AnalyteSpec, gender: string | undefined): AnalyteSpec {
  const male = gender === "male";
  if (spec.code === "718-7") {
    return male
      ? { ...spec, ref: "13.5 - 17.5", band: [14.0, 17.0] }
      : { ...spec, ref: "12.0 - 15.5", band: [12.4, 15.2] };
  }
  if (spec.code === "4544-3") {
    return male ? { ...spec, ref: "41 - 50", band: [42, 49] } : { ...spec, ref: "36 - 44", band: [37, 43] };
  }
  return spec;
}

function decimalsOf(v: number): number {
  const s = String(v);
  const i = s.indexOf(".");
  return i < 0 ? 0 : s.length - i - 1;
}

/** Fabricate a minimal spec (band parsed from the reference range) off-panel. */
function bandSpecFrom(anchor: Observation): AnalyteSpec | undefined {
  const ref = anchor.referenceRange;
  if (!ref) return undefined;
  const range = ref.match(/(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)/);
  const upper = ref.match(/^<\s*(-?\d+(?:\.\d+)?)/);
  let band: [number, number] | undefined;
  if (range) band = [Number(range[1]), Number(range[2])];
  else if (upper) band = [0, Number(upper[1])];
  if (!band) return undefined;
  return {
    code: anchor.code.coding[0]?.code ?? "",
    system: L,
    label: anchor.code.text ?? { en: "", tr: "" },
    ref,
    band,
  };
}

/**
 * Evolve an authored ground-truth observation for a LATER serial draw: the
 * authored value anchors the first draw, and each repeat draw is re-derived
 * from the same kinetics + live course so a re-ordered test trends (e.g. a
 * serial troponin keeps climbing, a repeat lactate falls after fluids).
 */
export function evolveAnchor(anchor: Observation, c: CaseInstance, ctx: SyntheticContext): Observation {
  const q = anchor.valueQuantity;
  if (!q || typeof q.value !== "number") return anchor;
  const code = anchor.code.coding[0]?.code ?? "";
  const spec = ANALYTE_INDEX.get(code) ?? bandSpecFrom(anchor);
  const kin = kineticsOf(code);
  const drawMs = Math.max(0, ctx.drawMs ?? 0);
  const treatments = ctx.treatments ?? [];
  const ratio = illnessRatio(c, drawMs, treatments);
  const factor = kineticsFactor(kin, c, drawMs, treatments, ratio);
  const decimals = spec?.decimals ?? decimalsOf(q.value);
  const seedKey = `${c.id}::evolve::${code}::${ctx.drawIndex ?? 0}`;
  const value = modelValue(q.value, spec, kin, factor, seedKey, decimals);
  return {
    ...anchor,
    id: `${anchor.id}-d${ctx.drawIndex ?? 0}`,
    valueQuantity: { ...q, value },
    interpretation: interpFromBand(value, spec, anchor.interpretation ?? "N"),
  };
}

/* --- condition-tuned narrative reports (micro / imaging) ------------------- */

/** CSF study text, condition-tuned + deterministically varied (synthetic). */
function csfSynthetic(c: CaseInstance, abnormal: boolean): Bilingual {
  const n = (k: string, lo: number, hi: number, d = 0) => sample(`${c.id}::csf::${k}`, [lo, hi], d);
  if (abnormal) {
    const wbc = n("wbc", 800, 1600);
    const prot = n("prot", 150, 220);
    const glu = n("glu", 18, 34);
    return {
      en: `Turbid; WBC ${wbc} /µL (neutrophil-predominant), protein ${prot} mg/dL, glucose ${glu} mg/dL; Gram stain: organisms seen; culture pending.`,
      tr: `Bulanık; lökosit ${wbc} /µL (nötrofil baskın), protein ${prot} mg/dL, glukoz ${glu} mg/dL; Gram boyama: organizma görüldü; kültür beklemede.`,
    };
  }
  const wbc = n("wbc", 0, 4);
  const prot = n("prot", 20, 42);
  const glu = n("glu", 50, 72);
  return {
    en: `Clear and colourless; WBC ${wbc} /µL, RBC 0 /µL, protein ${prot} mg/dL, glucose ${glu} mg/dL; Gram stain: no organisms; culture pending.`,
    tr: `Berrak ve renksiz; lökosit ${wbc} /µL, eritrosit 0 /µL, protein ${prot} mg/dL, glukoz ${glu} mg/dL; Gram boyama: organizma yok; kültür beklemede.`,
  };
}

function microResult(code: string, c: CaseInstance, dynamic: boolean): { conclusion: Bilingual; abnormal: boolean } {
  if (!dynamic) return { conclusion: microConclusion(code), abnormal: false };
  if (code === "csf-studies") {
    const abnormal = cachedTags(c).has("meningitis");
    return { conclusion: csfSynthetic(c, abnormal), abnormal };
  }
  return { conclusion: microConclusion(code), abnormal: false };
}

/** Modality-specific NORMAL impressions (real pathology imaging is out of scope). */
const IMAGING_NORMAL: Record<string, Bilingual> = {
  ct: {
    en: "No acute abnormality on this study. Representative teaching image; not this patient.",
    tr: "Bu incelemede akut anormallik yok. Temsili eğitim görüntüsü; bu hastaya ait değildir.",
  },
  xray: {
    en: "Clear lung fields, no acute abnormality; normal cardiomediastinal contour. Representative teaching image; not this patient.",
    tr: "Akciğer alanları temiz, akut anormallik yok; normal kardiyomediastinal kontur. Temsili eğitim görüntüsü; bu hastaya ait değildir.",
  },
  us: {
    en: "No acute abnormality; no free fluid or focal collection. Representative teaching image; not this patient.",
    tr: "Akut anormallik yok; serbest sıvı veya fokal koleksiyon yok. Temsili eğitim görüntüsü; bu hastaya ait değildir.",
  },
  mri: {
    en: "No acute abnormality or restricted diffusion. Representative teaching image; not this patient.",
    tr: "Akut anormallik veya difüzyon kısıtlılığı yok. Temsili eğitim görüntüsü; bu hastaya ait değildir.",
  },
};
function imagingModalityKey(code: string): string {
  if (/^ct|ctpa/.test(code)) return "ct";
  if (/^mri/.test(code)) return "mri";
  if (/^us|echo/.test(code)) return "us";
  if (/xr|cxr|axr/.test(code)) return "xray";
  return "";
}
function imagingConclusion(orderable: Orderable, dynamic: boolean): Bilingual {
  if (!dynamic) return NO_ACUTE;
  return IMAGING_NORMAL[imagingModalityKey(orderable.code)] ?? NO_ACUTE;
}

/* -------------------------------------------------------------------------- */
/* Synthetic result (baseline WNL + condition/time-dynamic)                    */
/* -------------------------------------------------------------------------- */

/**
 * A plausible, deterministic result for an order the case carries NO
 * ground-truth datum for. In the DEFAULT (non-dynamic) mode this is a pure
 * within-normal-limits panel / "no acute abnormality" report / "no growth"
 * report — the baseline the Results surface layers authored ground truth on top
 * of (same case + code → same numbers).
 *
 * With `ctx.dynamic` the panel is tuned to THIS case's condition (an un-authored
 * troponin/CRP/lactate/gas reads case-appropriately, still clearly synthetic)
 * AND to the clinical course at `ctx.drawMs` + `ctx.treatments`, so re-ordering
 * later yields a DIFFERENT, trajectory-consistent value.
 *
 * Callers still apply {@link hasGroundTruthResult} per-analyte: a case's
 * authored datum takes precedence over the matching synthetic value.
 */
export function syntheticResultAt(
  orderable: Orderable,
  caseInstance: CaseInstance,
  ctx: SyntheticContext = {},
): SyntheticResult {
  const subject = caseInstance.patient.id;
  const seedBase = `${caseInstance.id}::${orderable.code}`;
  const dynamic = !!ctx.dynamic;

  // ECG (imaging-kind POC) — a normal tracing report + representative image.
  if (orderable.code === "11524-6") {
    return { observations: [], report: report(orderable.code, subject, "cardiology", orderable.label, ECG_NORMAL) };
  }

  // Imaging — a "no acute abnormality" report; the UI attaches a real image.
  if (orderable.kind === "imaging" || orderable.category === "imaging") {
    return { observations: [], report: report(orderable.code, subject, "imaging", orderable.label, imagingConclusion(orderable, dynamic)) };
  }

  // Micro — a normal (or condition-tuned) culture / panel report.
  if (orderable.category === "micro") {
    const { conclusion, abnormal } = microResult(orderable.code, caseInstance, dynamic);
    return { observations: [], report: report(orderable.code, subject, "laboratory", orderable.label, conclusion), abnormal };
  }

  // Labs / blood gas / POC — the full analyte panel (Hb / Hct reference
  // intervals are sex-specific — review 02 finding 21).
  const rawPanel = PANELS[orderable.code];
  const panel = rawPanel ? rawPanel.map((spec) => sexSpecificSpec(spec, caseInstance.patient.gender)) : undefined;
  if (panel && panel.length > 0) {
    if (!dynamic) {
      return { observations: panel.map((spec) => normalObservation(spec, subject, `${seedBase}::${spec.code}`)) };
    }
    const targets = conditionTargets(caseInstance);
    const observations = panel.map((spec) =>
      dynamicObservation(spec, subject, `${seedBase}::${spec.code}`, caseInstance, ctx, targets.get(spec.code)),
    );
    return { observations, abnormal: observations.some((o) => o.interpretation && o.interpretation !== "N") };
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

/**
 * Backwards-compatible WITHIN-NORMAL-LIMITS synthesiser — a thin default over
 * {@link syntheticResultAt}. Same case + code → identical numbers, every analyte
 * within reference limits: the deterministic baseline the Results surface layers
 * authored ground truth and (via {@link syntheticResultAt}) condition tuning on.
 */
export function syntheticNormalResult(
  orderable: Orderable,
  caseInstance: CaseInstance,
): { observations: Observation[]; report?: DiagnosticReport } {
  const r = syntheticResultAt(orderable, caseInstance);
  return r.report ? { observations: r.observations, report: r.report } : { observations: r.observations };
}
