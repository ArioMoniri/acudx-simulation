/** Acceptance 2026-10-20 D-22: values were glued to raw UCUM units ("16.810*9/L"). */
import { describe, expect, it } from "vitest";
import { displayUnit, withUnit } from "@/lib/units";

describe("displayUnit / withUnit", () => {
  it("renders UCUM powers of ten as x10 with a superscript", () => {
    expect(displayUnit("10*9/L")).toBe("×10⁹/L");
    expect(displayUnit("10*12/L")).toBe("×10¹²/L");
    expect(displayUnit("10^6/L")).toBe("×10⁶/L");
    expect(displayUnit("mmol/L")).toBe("mmol/L");
    expect(displayUnit("")).toBe("");
  });

  it("separates the value from the unit with a real space", () => {
    expect(withUnit(16.8, "10*9/L")).toBe("16.8 ×10⁹/L");
    expect(withUnit(239, "10*9/L")).not.toContain("23910");
    expect(withUnit("positive", "")).toBe("positive");
  });
});
