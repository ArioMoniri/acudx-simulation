// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  __setClock,
  startEncounter,
  administerMedication,
  administerTreatment,
  resetEncounter,
  useEncounterState,
  getTreatments,
  getMar,
  type EncounterState,
} from "@/state/encounterStore";
import { generateCase } from "@/domain/caseGen";
import type { CaseInstance } from "@/domain/case";
import type { AllergyIntolerance } from "@/domain/fhir";

/**
 * Review 02 finding 9 (critical): administration requires dose + route, runs the
 * allergy cross-check and the five rights, and writes a MAR line (event type
 * "mar") before any effect reaches the live course.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function penicillinAllergy(patientId: string): AllergyIntolerance {
  return {
    resourceType: "AllergyIntolerance",
    id: `alg-${patientId}-pen`,
    type: "allergy",
    criticality: "high",
    code: {
      coding: [{ system: "http://snomed.info/sct", code: "419199007", display: "Allergy to substance" }],
      text: { en: "Penicillin — anaphylaxis", tr: "Penisilin — anafilaksi" },
    },
    patient: patientId,
    reaction: { en: "anaphylaxis", tr: "anafilaksi" },
  };
}

function makeCase(seed: number, allergic = false): CaseInstance {
  const c = generateCase({ seedMode: "constrained", chiefComplaint: "chest-pain", locale: "en", seed });
  return allergic ? { ...c, allergies: [penicillinAllergy(c.patient.id)] } : c;
}

let root: Root | null = null;
let snapshot: EncounterState;
let restoreClock: () => void;
let now = 0;

function Probe() {
  snapshot = useEncounterState();
  return null;
}

function run(fn: () => void): void {
  act(() => {
    fn();
  });
}

/** Run a store mutation inside act() and return its result. */
function capture<T>(fn: () => T): T {
  let out!: T;
  act(() => {
    out = fn();
  });
  return out;
}

beforeEach(() => {
  now = 0;
  restoreClock = __setClock(() => now);
  const container = document.createElement("div");
  act(() => {
    root = createRoot(container);
    root.render(createElement(Probe));
  });
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  resetEncounter();
  restoreClock();
});

describe("encounterStore — administerMedication (five rights + allergy check + MAR)", () => {
  it("blocks ceftriaxone for a penicillin-allergic patient and applies no effect", () => {
    run(() => startEncounter(makeCase(121, true)));
    const rec = capture(() => administerMedication({ drug: "2193", dose: 2000, unit: "mg", route: "IV", frequency: "once daily", indication: "sepsis" }));
    expect(rec?.outcome).toBe("blocked");
    expect(rec?.allergy.conflict).toBe(true);
    const marEv = snapshot.events.find((e) => e.type === "mar" && e.ref === "2193");
    expect(marEv?.meta?.outcome).toBe("blocked");
    expect((marEv?.meta?.failures as string[]) ?? []).toContain("allergy-conflict");
    expect(snapshot.events.some((e) => e.type === "treatment" && e.ref === "2193")).toBe(false);
    expect(getTreatments(snapshot)).toEqual([]);
    expect(getMar(snapshot)).toHaveLength(1);
  });

  it("refuses an order without a dose or route", () => {
    run(() => startEncounter(makeCase(121)));
    const rec = capture(() => administerMedication({ drug: "7052", dose: Number.NaN, unit: "mg", route: "IV", frequency: "", indication: "pain" }));
    expect(rec?.outcome).toBe("blocked");
    expect(rec?.checks.failures.map((f) => f.code)).toContain("missing-dose");
    expect(getTreatments(snapshot)).toEqual([]);
  });

  it("gives a complete in-range order, writes MAR + treatment events and shifts the course", () => {
    run(() => startEncounter(makeCase(121)));
    const rec = capture(() => administerMedication({ drug: "1191", dose: 300, unit: "mg", route: "PO", frequency: "once", indication: "suspected ACS" }));
    expect(rec?.outcome).toBe("given");
    expect(rec?.checks.rights).toEqual({ patient: true, drug: true, dose: true, route: true, time: true });
    const types = snapshot.events.filter((e) => e.ref === "1191").map((e) => e.type);
    expect(types).toEqual(["mar", "treatment"]);
    expect(getTreatments(snapshot)).toHaveLength(1);
  });

  it("blocks a dose above the ceiling (IM adrenaline 1 mg) and flags opioid stacking inside 5 min", () => {
    run(() => startEncounter(makeCase(121)));
    const high = capture(() => administerMedication({ drug: "3992-im", dose: 1, unit: "mg", route: "IM", frequency: "", indication: "anaphylaxis" }));
    expect(high?.outcome).toBe("blocked");
    expect(high?.checks.failures.map((f) => f.code)).toContain("dose-above-max");

    run(() => administerMedication({ drug: "7052", dose: 2.5, unit: "mg", route: "IV", frequency: "", indication: "pain" }));
    now = 2 * 60_000;
    const second = capture(() => administerMedication({ drug: "7052", dose: 2.5, unit: "mg", route: "IV", frequency: "", indication: "pain" }));
    expect(second?.outcome).toBe("flagged");
    expect(second?.checks.failures.map((f) => f.code)).toContain("repeat-too-soon");
    expect(getTreatments(snapshot).filter((t) => t.code === "7052")).toHaveLength(2);
  });

  it("legacy one-click administerTreatment fills the formulary default and still runs the checks", () => {
    run(() => startEncounter(makeCase(121, true)));
    const rec = capture(() => administerTreatment("2193", { en: "Ceftriaxone", tr: "Seftriakson" }));
    expect(rec?.outcome).toBe("blocked");
    expect(rec?.order.dose).toBe(2000);
    expect(rec?.order.route).toBe("IV");
  });
});
