import { describe, it, expect } from "vitest";
import {
  allergyCrossCheck,
  fiveRightsCheck,
  marOutcome,
  defaultOrderFor,
  type MedicationOrder,
  type MedicationAdministrationRecord,
} from "@/domain/medicationSafety";
import { FORMULARY, formularyFor } from "@/domain/formulary";
import { TREATMENT_CATALOG } from "@/domain/treatments";
import type { AllergyIntolerance } from "@/domain/fhir";

/**
 * Review 02 finding 9 (critical): five rights + allergy check before any
 * administration (Joint Commission NPSG.03.06.01; AHRQ PSNet medication
 * administration errors primer).
 */

const NKDA: AllergyIntolerance = {
  resourceType: "AllergyIntolerance",
  id: "nkda",
  type: "allergy",
  criticality: "low",
  code: { coding: [{ system: "snomed", code: "409137002", display: "No known drug allergy" }], text: { en: "No known drug allergies", tr: "Bilinen ilaç alerjisi yok" } },
  patient: "p1",
};

const PENICILLIN: AllergyIntolerance = {
  resourceType: "AllergyIntolerance",
  id: "pen",
  type: "allergy",
  criticality: "high",
  code: { coding: [{ system: "snomed", code: "419199007", display: "Allergy to substance" }], text: { en: "Penicillin — anaphylaxis as a child", tr: "Penisilin — çocukken anafilaksi" } },
  patient: "p1",
  reaction: { en: "anaphylaxis", tr: "anafilaksi" },
};

const ASPIRIN_ALLERGY: AllergyIntolerance = {
  ...PENICILLIN,
  id: "asa",
  code: { coding: [{ system: "snomed", code: "419199007", display: "Allergy to substance" }], text: { en: "Aspirin and ibuprofen — wheeze and facial swelling.", tr: "Aspirin ve ibuprofen" } },
  reaction: { en: "bronchospasm", tr: "bronkospazm" },
};

function order(over: Partial<MedicationOrder> & { drug: string }): MedicationOrder {
  const d = defaultOrderFor(over.drug)!;
  return { ...d, ...over };
}

function ctx(allergies: AllergyIntolerance[], priorMar: MedicationAdministrationRecord[] = [], nowMs = 10 * 60_000) {
  return { orderedForPatientId: "p1", bedsidePatientId: "p1", allergies, weightKg: 80, priorMar, nowMs };
}

function mar(o: MedicationOrder, at: number): MedicationAdministrationRecord {
  return {
    id: `m-${at}`,
    order: o,
    patientId: "p1",
    administeredBy: "nurse",
    at,
    checks: { ok: true, rights: { patient: true, drug: true, dose: true, route: true, time: true }, failures: [] },
    allergy: { conflict: false },
    outcome: "given",
  };
}

describe("formulary completeness (protocol rule 2: every clinical fact cites a source)", () => {
  it("covers every treatment catalogue code with dose, route and a resolving source URL", () => {
    for (const tx of TREATMENT_CATALOG) {
      const f = formularyFor(tx.code);
      expect(f, `no formulary entry for ${tx.code}`).toBeDefined();
      expect(f!.dose.default).toBeGreaterThan(0);
      expect(f!.dose.min).toBeLessThanOrEqual(f!.dose.default);
      expect(f!.dose.max).toBeGreaterThanOrEqual(f!.dose.default);
      expect(f!.routes).toContain(f!.defaultRoute);
      expect(f!.sources.length).toBeGreaterThan(0);
      for (const s of f!.sources) expect(s.url).toMatch(/^https:\/\//);
    }
    expect(new Set(FORMULARY.map((f) => f.code)).size).toBe(FORMULARY.length);
  });
});

describe("allergy cross-check", () => {
  it("flags ceftriaxone for a documented penicillin allergy (beta-lactam cross-reactivity)", () => {
    const r = allergyCrossCheck("2193", [PENICILLIN]);
    expect(r.conflict).toBe(true);
    expect(r.keyword).toBe("penicillin");
    expect(r.criticality).toBe("high");
  });

  it("flags aspirin for an NSAID / aspirin allergy and never conflicts on NKDA", () => {
    expect(allergyCrossCheck("1191", [ASPIRIN_ALLERGY]).conflict).toBe(true);
    expect(allergyCrossCheck("1191", [NKDA]).conflict).toBe(false);
    expect(allergyCrossCheck("2193", [NKDA]).conflict).toBe(false);
    expect(allergyCrossCheck("7806", [PENICILLIN, ASPIRIN_ALLERGY]).conflict).toBe(false);
  });
});

describe("five rights", () => {
  it("passes a complete, in-range order for the right patient", () => {
    const r = fiveRightsCheck(order({ drug: "161" }), ctx([NKDA]));
    expect(r.ok).toBe(true);
    expect(r.failures).toEqual([]);
    expect(marOutcome(r)).toBe("given");
  });

  it("blocks when the dose or route is missing (review 02 finding 9)", () => {
    const noDose = fiveRightsCheck(order({ drug: "7052", dose: Number.NaN }), ctx([NKDA]));
    expect(noDose.ok).toBe(false);
    expect(noDose.failures.map((f) => f.code)).toContain("missing-dose");
    const noRoute = fiveRightsCheck({ ...order({ drug: "7052" }), route: "" as unknown as "IV" }, ctx([NKDA]));
    expect(noRoute.failures.map((f) => f.code)).toContain("missing-route");
    expect(noRoute.rights.route).toBe(false);
  });

  it("blocks an order against a documented allergy", () => {
    const r = fiveRightsCheck(order({ drug: "2193" }), ctx([PENICILLIN]));
    expect(r.ok).toBe(false);
    expect(r.rights.drug).toBe(false);
    expect(r.failures.find((f) => f.code === "allergy-conflict")?.blocking).toBe(true);
    expect(marOutcome(r)).toBe("blocked");
  });

  it("blocks a dose above the single-dose ceiling and flags one below the usual range", () => {
    const high = fiveRightsCheck(order({ drug: "3992-im", dose: 1 }), ctx([NKDA]));
    expect(high.failures.map((f) => f.code)).toContain("dose-above-max");
    expect(high.ok).toBe(false);
    const low = fiveRightsCheck(order({ drug: "7052", dose: 0.5 }), ctx([NKDA]));
    expect(low.ok).toBe(true);
    expect(low.failures.map((f) => f.code)).toContain("dose-below-range");
    expect(marOutcome(low)).toBe("flagged");
  });

  it("blocks when the cumulative 24 h dose would exceed the daily maximum (paracetamol 4 g)", () => {
    const prior = [0, 1, 2, 3].map((i) => mar(order({ drug: "161", dose: 1000 }), i * 5 * 3_600_000));
    const r = fiveRightsCheck(order({ drug: "161", dose: 1000 }), ctx([NKDA], prior, 20 * 3_600_000));
    expect(r.failures.map((f) => f.code)).toContain("dose-exceeds-daily-max");
    expect(r.ok).toBe(false);
  });

  it("flags a repeat before the minimum interval (opioid stacking, review 02 finding 36)", () => {
    const prior = [mar(order({ drug: "7052" }), 8 * 60_000)];
    const r = fiveRightsCheck(order({ drug: "7052" }), ctx([NKDA], prior, 10 * 60_000));
    expect(r.rights.time).toBe(false);
    expect(r.failures.map((f) => f.code)).toContain("repeat-too-soon");
    expect(r.ok).toBe(true); // flagged, not blocked
  });

  it("blocks the wrong patient", () => {
    const r = fiveRightsCheck(order({ drug: "161" }), { ...ctx([NKDA]), bedsidePatientId: "p2" });
    expect(r.rights.patient).toBe(false);
    expect(r.ok).toBe(false);
  });

  it("checks weight-based ceilings (lorazepam 0.1 mg/kg)", () => {
    const r = fiveRightsCheck(order({ drug: "6470", dose: 4 }), { ...ctx([NKDA]), weightKg: 30 });
    expect(r.failures.map((f) => f.code)).toContain("dose-above-max");
  });
});
