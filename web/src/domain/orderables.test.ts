import { describe, it, expect } from "vitest";

import {
  ORDERABLES,
  ORDERABLES_BY_GROUP,
  ORDER_GROUPS,
  getOrderableByCode,
  hasGroundTruthResult,
  isPanelOrder,
  syntheticNormalResult,
  syntheticResultAt,
  type OrderCategory,
  type Orderable,
} from "@/domain/orderables";
import {
  chestPainNstemiCase,
  pulmonaryEmbolismCase,
  appendicitisCase,
  panicDisorderCase,
} from "@/data/seedCases";
import { currentVitals, type AdministeredTreatment } from "@/domain/clinicalCourse";
import type { Observation } from "@/domain/fhir";

/** The set of analyte LOINC codes a synthetic panel expands to. */
function analyteCodesOf(o: Orderable): Set<string> {
  const { observations } = syntheticNormalResult(o, chestPainNstemiCase);
  return new Set(observations.map((obs) => obs.code.coding[0]?.code ?? ""));
}

/** Assert an observation is a complete analyte row: value + unit or qualitative,
 *  a reference range, and a normal interpretation. */
function expectCompleteAnalyte(o: Observation): void {
  expect(o.interpretation).toBe("N");
  expect(o.referenceRange && o.referenceRange.length > 0).toBe(true);
  const numeric = typeof o.valueQuantity?.value === "number";
  const qualitative = !!o.valueString && o.valueString.en.length > 0;
  expect(numeric || qualitative).toBe(true);
}

/**
 * orderables — the comprehensive order catalog + synthetic WNL results.
 *
 * Three product invariants: (1) the catalog spans every ordering group so a
 * student can order anything; (2) a synthetic result for a non-ground-truth
 * order is deterministic AND within reference limits; (3) authored ground truth
 * takes precedence — the synthetic path must be gated behind hasGroundTruthResult.
 */

/** Assert an observation reads as within-normal-limits against its own range. */
function expectWithinNormal(o: Observation): void {
  expect(o.interpretation).toBe("N");
  if (o.valueString) {
    // Qualitative normal (e.g. "Negative") — value present, no number needed.
    expect(o.valueString.en.length).toBeGreaterThan(0);
    return;
  }
  const v = o.valueQuantity?.value;
  expect(typeof v).toBe("number");
  const ref = o.referenceRange ?? "";
  const rangeMatch = ref.match(/(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)/);
  const upperOnly = ref.match(/^<\s*(-?\d+(?:\.\d+)?)/);
  if (rangeMatch) {
    const lo = Number(rangeMatch[1]);
    const hi = Number(rangeMatch[2]);
    expect(v!).toBeGreaterThanOrEqual(lo);
    expect(v!).toBeLessThanOrEqual(hi);
  } else if (upperOnly) {
    expect(v!).toBeLessThan(Number(upperOnly[1]));
  }
}

describe("orderables — catalog coverage", () => {
  it("covers every ordering group with at least one orderable", () => {
    for (const group of ORDER_GROUPS) {
      expect(ORDERABLES_BY_GROUP[group as OrderCategory].length).toBeGreaterThan(0);
    }
  });

  it("includes the load-bearing tests across labs, micro, imaging and POC", () => {
    const codes = new Set(ORDERABLES.map((o) => o.code));
    // labs
    for (const c of ["6690-2", "2160-0", "67151-1", "48065-7", "1988-5", "2524-7", "ua"]) {
      expect(codes.has(c)).toBe(true);
    }
    // blood gas
    expect(codes.has("vbg")).toBe(true);
    expect(codes.has("abg")).toBe(true);
    // micro cultures
    expect(codes.has("blood-culture")).toBe(true);
    expect(codes.has("urine-culture")).toBe(true);
    // imaging
    for (const c of ["cxr", "ct-head-noncon", "ctpa", "us-abdomen", "mri-brain"]) {
      expect(codes.has(c)).toBe(true);
    }
    // POC
    expect(codes.has("poc-glucose")).toBe(true);
    expect(codes.has("11524-6")).toBe(true);
  });

  it("marks imaging + ECG as imaging kind so a real image is rendered", () => {
    expect(getOrderableByCode("cxr")?.kind).toBe("imaging");
    expect(getOrderableByCode("11524-6")?.kind).toBe("imaging");
    expect(getOrderableByCode("6690-2")?.kind).toBe("laboratory");
  });
});

describe("orderables — synthetic within-normal-limits results", () => {
  it("returns a normal panel for a lab not in the case ground truth", () => {
    const cbc = getOrderableByCode("6690-2")!;
    // The ACS seed case has no CBC ground truth → synthetic applies.
    expect(hasGroundTruthResult(chestPainNstemiCase, "6690-2")).toBe(false);
    const { observations, report } = syntheticNormalResult(cbc, chestPainNstemiCase);
    expect(report).toBeUndefined();
    expect(observations.length).toBeGreaterThan(0);
    for (const o of observations) expectWithinNormal(o);
  });

  it("keeps every catalogued lab/POC panel within reference limits", () => {
    for (const o of ORDERABLES) {
      if (o.kind === "imaging" || o.category === "micro" || o.category === "imaging") continue;
      const { observations } = syntheticNormalResult(o, chestPainNstemiCase);
      expect(observations.length).toBeGreaterThan(0);
      for (const obs of observations) expectWithinNormal(obs);
    }
  });

  it("returns a report (no observations) for imaging and micro orders", () => {
    const cxr = syntheticNormalResult(getOrderableByCode("cxr")!, chestPainNstemiCase);
    expect(cxr.observations).toHaveLength(0);
    expect(cxr.report?.conclusion?.en).toMatch(/no acute abnormality/i);

    const bc = syntheticNormalResult(getOrderableByCode("blood-culture")!, chestPainNstemiCase);
    expect(bc.observations).toHaveLength(0);
    expect(bc.report?.conclusion?.en).toMatch(/no growth/i);
  });

  it("is deterministic — same case + code yields identical values", () => {
    const bmp = getOrderableByCode("2160-0")!;
    const a = syntheticNormalResult(bmp, chestPainNstemiCase);
    const b = syntheticNormalResult(bmp, chestPainNstemiCase);
    expect(a.observations.map((o) => o.valueQuantity?.value)).toEqual(
      b.observations.map((o) => o.valueQuantity?.value),
    );
  });
});

describe("orderables — ground-truth precedence", () => {
  it("reports ground truth for authored lab/imaging codes and not for others", () => {
    // ACS seed authors hs-troponin (67151-1) and a 12-lead ECG (11524-6).
    expect(hasGroundTruthResult(chestPainNstemiCase, "67151-1")).toBe(true);
    expect(hasGroundTruthResult(chestPainNstemiCase, "11524-6")).toBe(true);
    // No TSH / MRI authored → synthetic normal is allowed.
    expect(hasGroundTruthResult(chestPainNstemiCase, "tsh")).toBe(false);
    expect(hasGroundTruthResult(chestPainNstemiCase, "mri-brain")).toBe(false);
  });
});

describe("orderables — comprehensive catalog", () => {
  it("spans the full ED/IM catalog across every group", () => {
    const codes = new Set(ORDERABLES.map((o) => o.code));
    const required = [
      // haematology
      "6690-2", "retic", "esr",
      // chemistry
      "2160-0", "cmp", "lft", "lipase", "mg", "phos", "ca", "ck",
      // cardiac
      "67151-1", "bnp", "33762-6", "48065-7",
      // coag / endocrine / inflammatory
      "coag-inr", "tsh", "hba1c", "cortisol", "1988-5", "pct", "2524-7",
      // urine
      "ua", "bhcg", "urine-hcg", "utox",
      // blood gas
      "vbg", "abg",
      // micro + serology
      "blood-culture", "urine-culture", "sputum-culture", "gram-stain",
      "resp-viral-panel", "csf-studies", "hepatitis-panel", "hiv", "monospot",
      // imaging
      "cxr", "axr", "xr-extremity", "ct-head-noncon", "ct-cspine", "ctpa",
      "ct-abdo-pelvis", "us-abdomen", "us-pelvis", "us-renal", "us-dvt",
      "echo", "mri-brain",
      // point of care
      "poc-glucose", "istat", "11524-6",
    ];
    for (const c of required) expect(codes.has(c), `missing ${c}`).toBe(true);
    // A genuinely broad catalog, not a stub.
    expect(ORDERABLES.length).toBeGreaterThanOrEqual(45);
  });

  it("assigns unique order codes across the flat catalog", () => {
    const codes = ORDERABLES.map((o) => o.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe("orderables — complete multi-analyte panels", () => {
  it("expands CBC to a full count + differential", () => {
    const codes = analyteCodesOf(getOrderableByCode("6690-2")!);
    // WBC, Hgb, Hct, Platelets + a differential member.
    for (const c of ["6690-2", "718-7", "4544-3", "777-3", "770-8"]) {
      expect(codes.has(c), `CBC missing ${c}`).toBe(true);
    }
    expect(codes.size).toBeGreaterThanOrEqual(8);
  });

  it("expands BMP to Na/K/Cl/HCO3/BUN/Cr/glucose", () => {
    const codes = analyteCodesOf(getOrderableByCode("2160-0")!);
    for (const c of ["2951-2", "2823-3", "2075-0", "1963-8", "3094-0", "2160-0", "2345-7"]) {
      expect(codes.has(c), `BMP missing ${c}`).toBe(true);
    }
  });

  it("expands LFTs to AST/ALT/ALP/bilirubin/albumin", () => {
    const codes = analyteCodesOf(getOrderableByCode("lft")!);
    for (const c of ["1920-8", "1742-6", "6768-6", "1975-2", "1751-7"]) {
      expect(codes.has(c), `LFT missing ${c}`).toBe(true);
    }
  });

  it("expands a blood gas to a full panel (pH, pCO2, HCO3)", () => {
    const codes = analyteCodesOf(getOrderableByCode("abg")!);
    for (const c of ["2744-1", "2019-8", "1963-8"]) {
      expect(codes.has(c), `ABG missing ${c}`).toBe(true);
    }
    expect(codes.size).toBeGreaterThanOrEqual(5);
  });

  it("renders each panel analyte with value + unit/qualitative, range and flag", () => {
    for (const o of ORDERABLES) {
      if (o.kind === "imaging" || o.category === "micro" || o.category === "imaging") continue;
      const { observations } = syntheticNormalResult(o, chestPainNstemiCase);
      expect(observations.length).toBeGreaterThan(0);
      for (const obs of observations) expectCompleteAnalyte(obs);
    }
  });

  it("flags the major panels as multi-analyte via isPanelOrder", () => {
    for (const c of ["6690-2", "2160-0", "cmp", "lft", "coag-inr", "ua", "vbg", "abg", "istat"]) {
      expect(isPanelOrder(c), `${c} should be a panel`).toBe(true);
    }
    // An unknown / bespoke code is not a modelled panel.
    expect(isPanelOrder("not-a-real-code")).toBe(false);
  });
});

describe("orderables — micro & imaging narrative reports", () => {
  it("returns a normal narrative report for every micro / serology order", () => {
    for (const o of ORDERABLES_BY_GROUP.micro) {
      const { observations, report } = syntheticNormalResult(o, chestPainNstemiCase);
      expect(observations).toHaveLength(0);
      expect(report?.conclusion?.en.length ?? 0).toBeGreaterThan(0);
      expect(report?.conclusion?.tr.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("returns a 'no acute abnormality' report for every imaging order", () => {
    for (const o of ORDERABLES_BY_GROUP.imaging) {
      const { observations, report } = syntheticNormalResult(o, chestPainNstemiCase);
      expect(observations).toHaveLength(0);
      expect(report?.conclusion?.en).toMatch(/no acute abnormality/i);
    }
  });
});

describe("orderables — expanded catalog (imaging + labs)", () => {
  it("adds the commonly-ordered ED studies the search was missing", () => {
    const codes = new Set(ORDERABLES.map((o) => o.code));
    for (const c of [
      // CT: plain chest + non-contrast stone protocol
      "ct-chest", "ct-kub",
      // MRI (the search that only surfaced 'MRI brain')
      "mri-cspine", "mri-lspine", "mri-mrcp",
      // Ultrasound: RUQ (biliary) + FAST
      "us-ruq", "us-fast",
      // Labs
      "uric-acid",
    ]) {
      expect(codes.has(c), `missing ${c}`).toBe(true);
    }
  });

  it("marks the new CT/MRI/US studies as imaging kind", () => {
    for (const c of ["ct-chest", "ct-kub", "mri-cspine", "mri-lspine", "mri-mrcp", "us-ruq", "us-fast"]) {
      expect(getOrderableByCode(c)?.kind).toBe("imaging");
    }
  });

  it("resolves uric acid to a single within-normal analyte", () => {
    const o = getOrderableByCode("uric-acid")!;
    const { observations, report } = syntheticNormalResult(o, chestPainNstemiCase);
    expect(report).toBeUndefined();
    expect(observations).toHaveLength(1);
    expectWithinNormal(observations[0]);
    expect(isPanelOrder("uric-acid")).toBe(true);
  });

  it("returns a normal impression for each new imaging order", () => {
    for (const c of ["ct-chest", "ct-kub", "mri-cspine", "mri-lspine", "mri-mrcp", "us-ruq", "us-fast"]) {
      const { observations, report } = syntheticNormalResult(getOrderableByCode(c)!, chestPainNstemiCase);
      expect(observations).toHaveLength(0);
      expect(report?.conclusion?.en).toMatch(/no acute abnormality/i);
    }
  });
});

/**
 * Job B — results/vitals respond to what the student does + elapsed time,
 * deterministically. The clinical-course engine is the source of truth: an
 * untreated time-critical case drifts past its ideal action window, and a
 * timely rescue keeps it better. All numbers stay bounded + reproducible; none
 * are model/LLM-generated.
 */
describe("orderables/course — status- + timing-responsive results (Job B)", () => {
  const MIN = 60_000;
  const acs = chestPainNstemiCase;

  it("deteriorates an untreated time-critical case past its ideal window", () => {
    const none = currentVitals(acs, 45 * MIN, []);
    const early = currentVitals(acs, 45 * MIN, [{ code: "1191", at: 5 * MIN }]);
    // Untreated tachycardia + hypoxia are worse than when the key drug was on time.
    expect(none.hr).toBeGreaterThan(early.hr);
    expect(none.spo2).toBeLessThanOrEqual(early.spo2);
  });

  it("orders the trajectory by treatment timing: early < late < never", () => {
    const at = 45 * MIN;
    const hrEarly = currentVitals(acs, at, [{ code: "1191", at: 5 * MIN }]).hr;
    const hrLate = currentVitals(acs, at, [{ code: "1191", at: 40 * MIN }]).hr;
    const hrNone = currentVitals(acs, at, []).hr;
    expect(hrEarly).toBeLessThan(hrLate);
    expect(hrLate).toBeLessThanOrEqual(hrNone);
  });

  it("leaves low-acuity cases without a deterioration path stable", () => {
    for (const c of [panicDisorderCase, appendicitisCase]) {
      const plain = currentVitals(c, 45 * MIN, []);
      const withTx = currentVitals(c, 45 * MIN, [{ code: "unrelated-000", at: 0 }]);
      expect(plain).toEqual(withTx); // no deterioration overlay engaged
    }
  });

  it("rises a serial synthetic troponin with draw time (rise kinetics)", () => {
    const trop = getOrderableByCode("67151-1")!;
    const value = (t: number) =>
      syntheticResultAt(trop, acs, { dynamic: true, drawMs: t, drawIndex: 1 }).observations[0]?.valueQuantity?.value ?? 0;
    expect(value(2 * 60 * MIN)).toBeGreaterThan(value(0));
  });

  it("keeps the dynamic synthetic path deterministic under the overlay", () => {
    const lactate = getOrderableByCode("2524-7")!;
    const ctx = { dynamic: true, drawMs: 40 * MIN, treatments: [] as AdministeredTreatment[], drawIndex: 1 };
    const a = syntheticResultAt(lactate, pulmonaryEmbolismCase, ctx).observations.map((o) => o.valueQuantity?.value);
    const b = syntheticResultAt(lactate, pulmonaryEmbolismCase, ctx).observations.map((o) => o.valueQuantity?.value);
    expect(a).toEqual(b);
  });
});
