import { describe, expect, it } from "vitest";

import { ORDERABLES, getOrderableByCode } from "@/domain/orderables";
import { catalogLab, catalogTurnaround, formatSimMinutes, SERVER_CATALOG } from "@/domain/serverCatalog";
import { orderTiming } from "@/domain/orderCatalog";
import en from "@/i18n/features/results3.en.json";
import labs2 from "@/i18n/features/labs2.en.json";

/**
 * Review 2026-10-21: the order list is completed from the server catalogue and
 * every entry carries its LOINC code and realistic sim turnaround; no web order
 * lacks a server result path (the server test checks resolution end to end).
 */
describe("server order catalogue in the web order list", () => {
  it("offers every catalogue lab and imaging procedure", () => {
    for (const l of SERVER_CATALOG.labs) expect(getOrderableByCode(l.code), l.code).toBeDefined();
    for (const p of SERVER_CATALOG.imaging) expect(getOrderableByCode(p.code), p.code).toBeDefined();
    expect(ORDERABLES.length).toBeGreaterThanOrEqual(140);
  });

  it("has no web order outside the server catalogue", () => {
    const known = new Set([...SERVER_CATALOG.labs.map((l) => l.code), ...SERVER_CATALOG.imaging.map((p) => p.code)]);
    const orphans = ORDERABLES.map((o) => o.code).filter((c) => !known.has(c));
    expect(orphans).toEqual([]);
  });

  it("stamps LDH with its LOINC code and a stat chemistry turnaround", () => {
    const ldh = getOrderableByCode("ldh")!;
    expect(ldh.loinc).toBe("14804-9");
    expect(ldh.turnaroundMinutes).toBe(50);
    expect(catalogLab("ldh")?.members).toEqual(["14804-9"]);
    expect(orderTiming("ldh", "laboratory").clinicalLabel.en).toBe("~50 min");
  });

  it("gives cultures and CT a preliminary report before the final", () => {
    const bc = catalogTurnaround("blood-culture")!;
    expect(bc.preliminaryMinutes).toBe(1440);
    expect(bc.minutes).toBeGreaterThan(bc.preliminaryMinutes!);
    const ct = catalogTurnaround("ct-chest")!;
    expect(ct.preliminaryMinutes).toBeLessThan(ct.minutes);
  });

  it("formats sim durations for the learner", () => {
    expect(formatSimMinutes(50)).toBe("50 min");
    expect(formatSimMinutes(250)).toBe("4.2 h");
    expect(formatSimMinutes(7200)).toBe("5 d");
    expect(formatSimMinutes(1440, "tr")).toBe("24 sa");
  });

  it("pluralises the analyte count", () => {
    expect(labs2.labs2.results.analytes).toContain("{{count}}");
    expect(en.labs2.results.analytes_one).toBe("{{count}} analyte");
    expect(en.labs2.results.analytes_other).toBe("{{count}} analytes");
  });
});
