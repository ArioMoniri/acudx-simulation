import { describe, it, expect } from "vitest";
import {
  nitrateGate,
  naloxoneGate,
  insulinGate,
  thrombolysisGate,
  adrenalineIvGate,
  fluidsGate,
  gateFor,
  hasPde5Inhibitor,
  suspectedRvInfarct,
} from "@/domain/treatmentRules";
import { TREATMENT_CATALOG, genericEffect } from "@/domain/treatments";
import { formularyFor } from "@/domain/formulary";
import type { CaseInstance, HistoryItem, LabResult } from "@/domain/case";
import type { CurrentVitals } from "@/domain/clinicalCourse";

/**
 * Review 02 (docs/review/02-clinical-content-review-2026-10.md) — treatment
 * gates. Each test would have caught the finding it names.
 */

const V: CurrentVitals = { hr: 88, systolic: 132, diastolic: 80, rr: 18, spo2: 96, tempC: 36.9 };

function makeCase(opts: {
  dx: string;
  text?: string;
  note?: string;
  meds?: string;
  labs?: Array<{ code: string; value: number; unit: string }>;
  imagingConclusion?: string;
}): CaseInstance {
  const history: HistoryItem[] = opts.meds
    ? [{ id: "h-meds", intent: "medications", answer: { en: opts.meds, tr: opts.meds } }]
    : [];
  const labs: LabResult[] = (opts.labs ?? []).map((l, i) => ({
    id: `l-${i}`,
    orderCode: l.code,
    observation: {
      resourceType: "Observation",
      id: `o-${i}`,
      status: "final",
      category: "laboratory",
      code: { coding: [{ system: "loinc", code: l.code, display: l.code }] },
      subject: "p",
      effectiveTime: 0,
      valueQuantity: { value: l.value, unit: l.unit },
    },
  }));
  return {
    id: `case-${opts.dx}`,
    correctDiagnosis: {
      code: {
        coding: [{ system: "icd10", code: opts.dx, display: opts.text ?? "" }],
        text: { en: opts.text ?? "", tr: opts.text ?? "" },
      },
      ...(opts.note ? { note: { en: opts.note, tr: opts.note } } : {}),
    },
    chiefComplaint: { en: "", tr: "" },
    redFlags: [],
    groundTruth: {
      history,
      exam: [],
      labs,
      imaging: opts.imagingConclusion
        ? [{ id: "im", orderCode: "x", modality: { en: "", tr: "" }, report: { conclusion: { en: opts.imagingConclusion, tr: "" } } }]
        : [],
      vitalsTrajectory: [],
    },
  } as unknown as CaseInstance;
}

describe("review 02 finding 8 — nitrate gate", () => {
  const nstemi = makeCase({ dx: "I21.4", text: "Non-ST elevation myocardial infarction" });

  it("allows GTN for ischaemic chest pain with SBP >= 90 and HR 50-100", () => {
    expect(nitrateGate(nstemi, V)).toMatchObject({ allowed: true, appropriateness: "indicated" });
  });

  it("blocks GTN when systolic is below 90 mmHg (ACCF/AHA 2013 STEMI)", () => {
    const v = { ...V, systolic: 86 };
    expect(nitrateGate(nstemi, v)).toMatchObject({ allowed: false, appropriateness: "contraindicated", reason: "nitrate-hypotension" });
  });

  it("blocks GTN with bradycardia < 50 or tachycardia > 100", () => {
    expect(nitrateGate(nstemi, { ...V, hr: 44 }).reason).toBe("nitrate-bradycardia");
    expect(nitrateGate(nstemi, { ...V, hr: 118 }).reason).toBe("nitrate-tachycardia");
  });

  it("blocks GTN after a PDE-5 inhibitor and in suspected RV infarction", () => {
    const pde5 = makeCase({ dx: "I21.4", meds: "Sildenafil last night for erectile dysfunction." });
    expect(hasPde5Inhibitor(pde5)).toBe(true);
    expect(nitrateGate(pde5, V).reason).toBe("nitrate-pde5");
    const rv = makeCase({ dx: "I21.3", note: "Inferior STEMI with right ventricular involvement (ST elevation in V4R)." });
    expect(suspectedRvInfarct(rv)).toBe(true);
    expect(nitrateGate(rv, V).reason).toBe("nitrate-rv-infarct");
  });

  it("has no indication in haemorrhage or stroke (SAH BP control uses titratable agents)", () => {
    const sah = makeCase({ dx: "I60.9", text: "Subarachnoid haemorrhage" });
    const ugib = makeCase({ dx: "K92.2", text: "Upper gastrointestinal haemorrhage" });
    const stroke = makeCase({ dx: "I63.9", text: "Acute ischaemic stroke" });
    for (const c of [sah, ugib, stroke]) {
      expect(nitrateGate(c, V)).toMatchObject({ allowed: false, reason: "nitrate-no-indication" });
    }
  });

  it("allows GTN in acute pulmonary oedema even with HR > 100", () => {
    const apo = makeCase({ dx: "I50.1", text: "Acute pulmonary oedema" });
    expect(nitrateGate(apo, { ...V, hr: 112, systolic: 170 }).allowed).toBe(true);
  });

  it("generic nitro effect is inert unless the gate allowed it", () => {
    expect(genericEffect("4917", V)).toEqual([]);
    expect(genericEffect("4917", V, { nitrateAllowed: false })).toEqual([]);
    expect(genericEffect("4917", V, { nitrateAllowed: true }).some((e) => e.key === "systolic")).toBe(true);
  });
});

describe("review 02 findings 28 / 36 — naloxone is opioid-gated", () => {
  it("acts in an opioid toxidrome or after a prior opioid dose", () => {
    const od = makeCase({ dx: "T40.2X1A", text: "Opioid overdose" });
    expect(naloxoneGate(od, [], 0).allowed).toBe(true);
    const chest = makeCase({ dx: "I21.4" });
    expect(naloxoneGate(chest, [{ code: "7052", at: 0 }], 60_000).allowed).toBe(true);
  });

  it("does nothing in paracetamol or TCA overdose (no antidote role; MHRA)", () => {
    const para = makeCase({ dx: "T39.1X1A", text: "Paracetamol overdose" });
    const tca = makeCase({ dx: "T43.011A", text: "Tricyclic antidepressant overdose" });
    for (const c of [para, tca]) {
      const g = naloxoneGate(c, [], 0);
      expect(g.allowed).toBe(false);
      expect(g.reason).toBe("naloxone-no-opioid");
    }
    expect(genericEffect("7242", V, { opioidOnBoard: false })).toEqual([]);
    expect(genericEffect("7242", V, { opioidOnBoard: true }).length).toBeGreaterThan(0);
  });
});

describe("review 02 finding 31 — DKA potassium gate (ADA/EASD 2024)", () => {
  it("holds insulin when the latest potassium is below 3.3 mmol/L", () => {
    const low = makeCase({ dx: "E10.10", labs: [{ code: "2823-3", value: 3.0, unit: "mmol/L" }] });
    expect(insulinGate(low)).toMatchObject({ allowed: false, appropriateness: "contraindicated", reason: "insulin-hypokalaemia" });
    const ok = makeCase({ dx: "E10.10", labs: [{ code: "2823-3", value: 5.3, unit: "mmol/L" }] });
    expect(insulinGate(ok).allowed).toBe(true);
  });
});

describe("review 02 finding 37 — stroke thrombolysis BP + glucose gate (AHA/ASA 2019)", () => {
  const stroke = makeCase({ dx: "I63.9", labs: [{ code: "2345-7", value: 6.8, unit: "mmol/L" }] });

  it("blocks alteplase at BP >= 185/110", () => {
    expect(thrombolysisGate(stroke, { ...V, systolic: 192, diastolic: 100 }).reason).toBe("lysis-bp-above-185-110");
    expect(thrombolysisGate(stroke, { ...V, systolic: 170, diastolic: 112 }).reason).toBe("lysis-bp-above-185-110");
    expect(thrombolysisGate(stroke, { ...V, systolic: 170, diastolic: 96 }).allowed).toBe(true);
  });

  it("blocks alteplase with glucose outside 2.8-22 mmol/L (mg/dL converted)", () => {
    const hypo = makeCase({ dx: "I63.9", labs: [{ code: "2345-7", value: 40, unit: "mg/dL" }] });
    expect(thrombolysisGate(hypo, V).reason).toBe("lysis-glucose-out-of-range");
    const hyper = makeCase({ dx: "I63.9", labs: [{ code: "2345-7", value: 24.5, unit: "mmol/L" }] });
    expect(thrombolysisGate(hyper, V).reason).toBe("lysis-glucose-out-of-range");
  });

  it("is not an indication outside ischaemic stroke / PE", () => {
    expect(thrombolysisGate(makeCase({ dx: "I61.9", text: "Intracerebral haemorrhage" }), V).reason).toBe("lysis-no-indication");
  });
});

describe("review 02 finding 7 — adrenaline IM is the anaphylaxis first line (RCUK 2021)", () => {
  it("catalogues IM adrenaline 0.5 mg with dose and route fields", () => {
    const im = TREATMENT_CATALOG.find((t) => t.code === "3992-im");
    expect(im).toBeDefined();
    expect(im?.routeCode).toBe("IM");
    expect(im?.defaultDose).toEqual({ amount: 0.5, unit: "mg" });
    const f = formularyFor("3992-im");
    expect(f?.dose.max).toBe(0.5);
    expect(f?.routes).toEqual(["IM"]);
    expect(f?.sources[0]?.url).toContain("resus.org.uk");
  });

  it("scores IV adrenaline as contraindicated in anaphylaxis with a pulse", () => {
    const ana = makeCase({ dx: "T78.2XXA", text: "Anaphylaxis" });
    expect(adrenalineIvGate(ana, { ...V, systolic: 84 }).reason).toBe("adrenaline-iv-not-first-line");
    expect(gateFor("3992-im", ana, V, [], 0)).toMatchObject({ allowed: true, appropriateness: "indicated" });
    const eff = genericEffect("3992-im", { ...V, systolic: 80 }, { anaphylaxis: true });
    expect(eff.find((e) => e.key === "systolic")?.delta).toBeGreaterThan(0);
  });
});

describe("review 02 finding 28 — fluids are not a universal rescue", () => {
  it("are contraindicated in acute pulmonary oedema and neutral in tamponade", () => {
    expect(fluidsGate(makeCase({ dx: "I50.1", text: "Acute pulmonary oedema" }))).toMatchObject({ allowed: false, appropriateness: "contraindicated" });
    expect(fluidsGate(makeCase({ dx: "I31.4", text: "Cardiac tamponade" })).appropriateness).toBe("neutral");
    expect(fluidsGate(makeCase({ dx: "A41.9", text: "Sepsis" })).appropriateness).toBe("indicated");
  });
});

describe("review 02 finding 44 — paracetamol defaults to the oral route", () => {
  it("catalogue and formulary default route is PO", () => {
    expect(TREATMENT_CATALOG.find((t) => t.code === "161")?.routeCode).toBe("PO");
    expect(formularyFor("161")?.defaultRoute).toBe("PO");
  });
});
