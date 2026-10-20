import { describe, it, expect } from "vitest";
import { panicDisorderCase, pulmonaryEmbolismCase, seedCases } from "@/data/seedCases";

/**
 * Review 02 seed-case findings.
 */
describe("review 02 finding 10 — panic seed case ACS rule-out timing (ESC 2023 0 h/1 h algorithm)", () => {
  it("places symptom onset more than 3 hours before the single hs-troponin draw", () => {
    const reason = panicDisorderCase.encounter.reason.en;
    const hours = Number(/(\d+(?:\.\d+)?)\s*hours?/i.exec(reason)?.[1] ?? "0");
    expect(hours).toBeGreaterThan(3);
    expect(reason).not.toMatch(/40 minutes/);
    const onset = panicDisorderCase.groundTruth.history.find((h) => h.intent === "onset");
    expect(onset?.answer.en).toMatch(/four hours/i);
  });

  it("documents the single-draw rule-out condition on the diagnosis note", () => {
    expect(panicDisorderCase.correctDiagnosis.note?.en).toMatch(/more than 3 h/);
  });
});

describe("review 02 finding 23 — PE seed case (ESC 2019 acute PE)", () => {
  it("marks D-dimer low value when PE is likely and makes CTPA the first critical order", () => {
    const ddimer = pulmonaryEmbolismCase.expectedWorkup.find((w) => w.code.coding[0]?.code === "48065-7");
    expect(ddimer?.lowValue).toBe(true);
    expect(ddimer?.critical).toBe(false);
    const first = pulmonaryEmbolismCase.expectedWorkup[0];
    expect(first.code.coding[0]?.code).toBe("ctpa");
    expect(first.critical).toBe(true);
  });

  it("sends an intermediate-high-risk PE (RV strain, raised troponin) to a monitored bed", () => {
    expect(pulmonaryEmbolismCase.disposition).not.toBe("admit-ward");
    expect(["admit-ccu", "admit-icu"]).toContain(pulmonaryEmbolismCase.disposition);
  });
});

describe("seed corpus invariants", () => {
  it("every seed case has a unique id and an allergy record", () => {
    expect(new Set(seedCases.map((c) => c.id)).size).toBe(seedCases.length);
    for (const c of seedCases) expect(c.allergies.length).toBeGreaterThan(0);
  });
});
