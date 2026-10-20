/**
 * Acceptance test 2026-10-20 (docs/review/05), second pass: D-17, D-19, D-20.
 */
import { describe, expect, it } from "vitest";
import type { AllergyIntolerance } from "@/domain/fhir";
import type { CaseInstance, TreatmentResponse } from "@/domain/case";
import { allergySafeAlternatives, formularyCodes, formularyFor } from "@/domain/formulary";
import { allergyCrossCheck, fiveRightsCheck } from "@/domain/medicationSafety";
import { TREATMENT_CATALOG } from "@/domain/treatments";
import { generateCase } from "@/domain/caseGen";
import { CHIEF_COMPLAINT_OPTIONS } from "@/data/startOptions";
import { ANTIBIOTIC_CODES, matchTreatmentResponse } from "@/domain/treatmentMatch";

const PEN_ANAPHYLAXIS: AllergyIntolerance = {
  resourceType: "AllergyIntolerance",
  id: "a1",
  patient: "p1",
  code: { coding: [{ system: "x", code: "pen", display: "Penicillin" }], text: { en: "Penicillin — anaphylaxis as a child", tr: "Penisilin — anafilaksi" } },
  criticality: "high",
} as unknown as AllergyIntolerance;

const ctx = (allergies: AllergyIntolerance[]) => ({
  orderedForPatientId: "p1",
  bedsidePatientId: "p1",
  allergies,
  weightKg: 70,
  priorMar: [],
  nowMs: 0,
});

const order = (drug: string) => {
  const e = formularyFor(drug)!;
  return { drug, dose: e.dose.default, unit: e.dose.unit, route: e.defaultRoute, frequency: "", indication: "sepsis", weightKg: 70 };
};

describe("D-17 non-beta-lactam antibiotics", () => {
  it("adds vancomycin, levofloxacin, doxycycline, gentamicin, clindamycin, meropenem and metronidazole with sources", () => {
    for (const code of ["11124", "82122", "3640", "4413", "2582", "29561", "6922", "21212", "2348"]) {
      const e = formularyFor(code);
      expect(e, code).toBeDefined();
      expect(e!.sources.length, code).toBeGreaterThan(0);
      expect(e!.sources.every((s) => s.url.startsWith("https://")), code).toBe(true);
      expect(e!.group).toBe("antibacterial");
    }
  });

  it("every catalogue item has a formulary entry and vice versa", () => {
    expect(new Set(TREATMENT_CATALOG.map((t) => t.code))).toEqual(new Set(formularyCodes()));
  });

  it("blocks ceftriaxone in penicillin anaphylaxis but lets vancomycin and levofloxacin through", () => {
    expect(fiveRightsCheck(order("2193"), ctx([PEN_ANAPHYLAXIS])).ok).toBe(false);
    expect(fiveRightsCheck(order("11124"), ctx([PEN_ANAPHYLAXIS])).ok).toBe(true);
    expect(fiveRightsCheck(order("82122"), ctx([PEN_ANAPHYLAXIS])).ok).toBe(true);
  });

  it("meropenem in penicillin allergy is a caution, not a block (AAAAI/ACAAI 2022)", () => {
    const m = allergyCrossCheck("29561", [PEN_ANAPHYLAXIS]);
    expect(m.conflict).toBe(false);
    expect(m.caution).toBe(true);
    expect(fiveRightsCheck(order("29561"), ctx([PEN_ANAPHYLAXIS])).ok).toBe(true);
  });

  it("suggests the guideline alternatives for the diagnosis", () => {
    const texts = ["Penicillin — anaphylaxis as a child"];
    const men = allergySafeAlternatives("2193", texts, "G00.9").alternatives.map((a) => a.entry.code);
    expect(men[0]).toBe("2348"); // NICE NG240: chloramphenicol
    const cap = allergySafeAlternatives("2193", texts, "J18.9").alternatives.map((a) => a.entry.code);
    expect(cap[0]).toBe("82122"); // NICE NG250: levofloxacin
    const sepsis = allergySafeAlternatives("pip-tazo", texts, "A41.9");
    expect(sepsis.alternatives[0].entry.code).toBe("29561");
    expect(sepsis.alternatives[0].caution).toBe(true);
    expect(sepsis.alternatives.map((a) => a.entry.code)).toContain("11124");
    // Never suggests another beta-lactam that conflicts.
    expect(sepsis.alternatives.map((a) => a.entry.code)).not.toContain("2193");
  });
});

function caseWith(rows: TreatmentResponse[]): CaseInstance {
  return { treatmentResponses: rows } as unknown as CaseInstance;
}

const row = (code: string, en: string, appropriateness: TreatmentResponse["appropriateness"] = "indicated"): TreatmentResponse => ({
  treatmentCode: code,
  appropriateness,
  effects: [],
  narrative: { en: "", tr: "" },
  label: { en, tr: en },
});

describe("D-20 formulary drugs map to the case's own rows", () => {
  const sepsis = caseWith([
    row("cultures", "Blood cultures (2 sets) before antibiotics"),
    row("abx", "Broad-spectrum IV antibiotics within 1 hour"),
    row("iv_fluids", "IV crystalloid 500 mL bolus, reassess"),
    row("antipyretic", "Paracetamol 1 g for fever and discomfort"),
    row("delay_abx", "Delay antibiotics until all results are back", "contraindicated"),
  ]);

  it("every formulary antibiotic is the antibiotic row, never cultures or the contraindicated row", () => {
    for (const code of ANTIBIOTIC_CODES) expect(matchTreatmentResponse(sepsis, code)?.treatmentCode, code).toBe("abx");
  });

  it("fluids and paracetamol map to their rows", () => {
    expect(matchTreatmentResponse(sepsis, "313002")?.treatmentCode).toBe("iv_fluids");
    expect(matchTreatmentResponse(sepsis, "161")?.treatmentCode).toBe("antipyretic");
  });

  it("fluids never satisfy a combined antibiotics + fluids row", () => {
    const pyelo = caseWith([row("iv_abx_fluids", "IV antibiotics + fluids (ceftriaxone or cefuroxime)")]);
    expect(matchTreatmentResponse(pyelo, "313002")).toBeUndefined();
    expect(matchTreatmentResponse(pyelo, "4413")?.treatmentCode).toBe("iv_abx_fluids");
  });
});

describe("D-01 a Fever tile on the Start page", () => {
  it("lists Fever among the families, EN and TR", () => {
    const fever = CHIEF_COMPLAINT_OPTIONS.find((o) => o.id === "fever");
    expect(fever?.label).toEqual({ en: "Fever", tr: "Ateş" });
    expect(fever?.icon).toBe("Thermometer");
  });

  it("offline, the fever family yields febrile presentations", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const c = generateCase({ seedMode: "constrained", chiefComplaint: "fever", locale: "en", seed });
      expect(c.triageVitals.tempC, c.correctDiagnosis.code.coding[0]?.code).toBeGreaterThanOrEqual(37.8);
    }
  });
});
