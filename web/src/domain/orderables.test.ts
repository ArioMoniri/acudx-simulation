import { describe, it, expect } from "vitest";

import {
  ORDERABLES,
  ORDERABLES_BY_GROUP,
  ORDER_GROUPS,
  getOrderableByCode,
  hasGroundTruthResult,
  syntheticNormalResult,
  type OrderCategory,
} from "@/domain/orderables";
import { chestPainNstemiCase } from "@/data/seedCases";
import type { Observation } from "@/domain/fhir";

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
