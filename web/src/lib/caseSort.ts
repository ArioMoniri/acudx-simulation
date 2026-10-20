import { estMinutesOf, SPECIALTY_LABELS, specialtyOf } from "@/data/caseLibrary";
import type { Lang } from "@/data/schema";
import type { CaseInstance } from "@/domain/case";

/** Sortable columns of the case catalogue table. */
export type CaseSortKey = "case" | "specialty" | "code" | "difficulty" | "acuity" | "minutes";
export type SortDir = "asc" | "desc";
export interface CaseSort {
  key: CaseSortKey;
  dir: SortDir;
}

export const CASE_SORT_KEYS: readonly CaseSortKey[] = [
  "case",
  "specialty",
  "code",
  "difficulty",
  "acuity",
  "minutes",
];

function codeOf(c: CaseInstance): string {
  return c.correctDiagnosis?.code?.coding?.[0]?.code ?? "";
}

function compareFor(key: CaseSortKey, lang: Lang): (a: CaseInstance, b: CaseInstance) => number {
  switch (key) {
    case "case":
      return (a, b) => a.chiefComplaint[lang].localeCompare(b.chiefComplaint[lang], lang);
    case "specialty":
      return (a, b) => SPECIALTY_LABELS[specialtyOf(a)].en.localeCompare(SPECIALTY_LABELS[specialtyOf(b)].en, "en");
    case "code":
      return (a, b) => codeOf(a).localeCompare(codeOf(b), "en", { numeric: true });
    case "difficulty":
      return (a, b) => a.difficulty - b.difficulty;
    case "acuity":
      return (a, b) => a.acuityESI - b.acuityESI;
    case "minutes":
      return (a, b) => estMinutesOf(a) - estMinutesOf(b);
  }
}

/**
 * Sort a case list by one column. Pure and stable: equal keys keep their
 * incoming order (so a generated case stays above the seed with the same
 * difficulty), and the input array is never mutated.
 */
export function sortCases(cases: readonly CaseInstance[], sort: CaseSort | null, lang: Lang): CaseInstance[] {
  if (!sort) return [...cases];
  const cmp = compareFor(sort.key, lang);
  const sign = sort.dir === "asc" ? 1 : -1;
  return cases
    .map((c, i) => ({ c, i }))
    .sort((x, y) => sign * cmp(x.c, y.c) || x.i - y.i)
    .map(({ c }) => c);
}

/**
 * The next sort state when a column header is activated: a new column starts
 * ascending; the same column flips to descending; a third activation clears it.
 */
export function nextSort(current: CaseSort | null, key: CaseSortKey): CaseSort | null {
  if (!current || current.key !== key) return { key, dir: "asc" };
  if (current.dir === "asc") return { key, dir: "desc" };
  return null;
}
