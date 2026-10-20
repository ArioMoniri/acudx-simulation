import { describe, expect, it } from "vitest";
import { seedCases } from "@/data/seedCases";
import { estMinutesOf, SPECIALTY_LABELS, specialtyOf } from "@/data/caseLibrary";
import { nextSort, sortCases, type CaseSort } from "./caseSort";

const byKey = (s: CaseSort) => sortCases(seedCases, s, "en");

describe("sortCases", () => {
  it("returns a new array and leaves the input untouched", () => {
    const before = [...seedCases];
    const out = byKey({ key: "difficulty", dir: "asc" });
    expect(out).not.toBe(seedCases);
    expect(seedCases).toEqual(before);
    expect(out).toHaveLength(seedCases.length);
  });

  it("sorts by difficulty ascending and descending", () => {
    const asc = byKey({ key: "difficulty", dir: "asc" }).map((c) => c.difficulty);
    const desc = byKey({ key: "difficulty", dir: "desc" }).map((c) => c.difficulty);
    expect(asc).toEqual([...asc].sort((a, b) => a - b));
    expect(desc).toEqual([...desc].sort((a, b) => b - a));
  });

  it("sorts by acuity (ESI 1 first when ascending)", () => {
    const asc = byKey({ key: "acuity", dir: "asc" }).map((c) => c.acuityESI);
    expect(asc).toEqual([...asc].sort((a, b) => a - b));
  });

  it("sorts by estimated minutes", () => {
    const asc = byKey({ key: "minutes", dir: "asc" }).map(estMinutesOf);
    expect(asc).toEqual([...asc].sort((a, b) => a - b));
  });

  it("sorts by case title using the active language", () => {
    const asc = byKey({ key: "case", dir: "asc" }).map((c) => c.chiefComplaint.en);
    expect(asc).toEqual([...asc].sort((a, b) => a.localeCompare(b, "en")));
    const tr = sortCases(seedCases, { key: "case", dir: "asc" }, "tr").map((c) => c.chiefComplaint.tr);
    expect(tr).toEqual([...tr].sort((a, b) => a.localeCompare(b, "tr")));
  });

  it("sorts by specialty label", () => {
    const asc = byKey({ key: "specialty", dir: "asc" }).map((c) => SPECIALTY_LABELS[specialtyOf(c)].en);
    expect(asc).toEqual([...asc].sort((a, b) => a.localeCompare(b, "en")));
  });

  it("is stable for equal keys", () => {
    const ids = seedCases.map((c) => c.id);
    const sorted = byKey({ key: "difficulty", dir: "asc" });
    // Among cases with the same difficulty, original order is preserved.
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i - 1].difficulty === sorted[i].difficulty) {
        expect(ids.indexOf(sorted[i - 1].id)).toBeLessThan(ids.indexOf(sorted[i].id));
      }
    }
  });
});

describe("nextSort", () => {
  it("starts a new column ascending", () => {
    expect(nextSort(null, "difficulty")).toEqual({ key: "difficulty", dir: "asc" });
    expect(nextSort({ key: "case", dir: "asc" }, "difficulty")).toEqual({ key: "difficulty", dir: "asc" });
  });

  it("flips the same column to descending, then clears it", () => {
    expect(nextSort({ key: "difficulty", dir: "asc" }, "difficulty")).toEqual({ key: "difficulty", dir: "desc" });
    expect(nextSort({ key: "difficulty", dir: "desc" }, "difficulty")).toBeNull();
  });
});
