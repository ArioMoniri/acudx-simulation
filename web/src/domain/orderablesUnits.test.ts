import { describe, it, expect } from "vitest";
import { getOrderableByCode, syntheticResultAt, sexSpecificSpec } from "@/domain/orderables";
import { chestPainNstemiCase, pulmonaryEmbolismCase } from "@/data/seedCases";

/**
 * Review 02 finding 21 (sex-specific Hb / Hct) and finding 22 (one unit system
 * per analyte project-wide: glucose in mmol/L).
 */
describe("review 02 finding 22 — glucose is reported in mmol/L everywhere", () => {
  it("BMP and POC glucose use mmol/L with a 3.9-6.1 reference", () => {
    for (const code of ["2160-0", "poc-glucose", "istat"]) {
      const r = syntheticResultAt(getOrderableByCode(code)!, chestPainNstemiCase);
      const glu = r.observations.find((o) => ["2345-7", "2339-0"].includes(o.code.coding[0]?.code ?? ""));
      expect(glu, code).toBeDefined();
      expect(glu!.valueQuantity?.unit).toBe("mmol/L");
      expect(glu!.referenceRange).toBe("3.9 - 6.1");
      expect(glu!.valueQuantity!.value).toBeLessThan(10);
    }
  });
});

describe("review 02 finding 21 — haemoglobin / haematocrit intervals follow the patient's sex", () => {
  it("sexSpecificSpec gives men 13.5-17.5 g/dL and women 12.0-15.5 g/dL", () => {
    const hb = { code: "718-7", system: "loinc", label: { en: "Hb", tr: "Hb" }, ref: "12.0 - 16.0", band: [12.5, 15.5] as [number, number] };
    expect(sexSpecificSpec(hb, "male").ref).toBe("13.5 - 17.5");
    expect(sexSpecificSpec(hb, "female").ref).toBe("12.0 - 15.5");
    const hct = { ...hb, code: "4544-3" };
    expect(sexSpecificSpec(hct, "male").ref).toBe("41 - 50");
    expect(sexSpecificSpec(hct, "female").ref).toBe("36 - 44");
    expect(sexSpecificSpec({ ...hb, code: "777-3" }, "male").ref).toBe("12.0 - 16.0");
  });

  it("the CBC panel carries the sex-specific interval for the case patient", () => {
    const cbc = getOrderableByCode("6690-2")!;
    const male = syntheticResultAt(cbc, chestPainNstemiCase); // Ahmet, male
    const female = syntheticResultAt(cbc, pulmonaryEmbolismCase); // Ayşe, female
    const hbM = male.observations.find((o) => o.code.coding[0]?.code === "718-7")!;
    const hbF = female.observations.find((o) => o.code.coding[0]?.code === "718-7")!;
    expect(hbM.referenceRange).toBe("13.5 - 17.5");
    expect(hbF.referenceRange).toBe("12.0 - 15.5");
    expect(hbM.valueQuantity!.value).toBeGreaterThanOrEqual(13.5);
    expect(hbF.valueQuantity!.value).toBeLessThanOrEqual(15.5);
  });
});
