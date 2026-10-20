/**
 * AcuDx: map a formulary drug to the case's own treatment row.
 *
 * Acceptance 2026-10-20 D-20: the formulary sends RxNorm-style codes ("2193",
 * "11124") while a case authors abstract rows ("abx", "iv_abx_fluids",
 * "immediate_ceftriaxone"), and the encounter store matched them by exact code,
 * so an indicated antibiotic scored "neutral". This is the client mirror of
 * `match_treatment_row` in server/orchestration/director.py (D-09); the two
 * stem tables are kept identical by
 * server/tests/test_acceptance_fever.py.
 *
 * Rules: an exact code match wins; otherwise a formulary drug matches a
 * non-contraindicated row whose code or label carries one of its stems; a
 * culture, test, drainage or referral row is never satisfied by a drug; a
 * combined "antibiotics + fluids" row is satisfied only by an antimicrobial.
 *
 * Pure. Education only.
 */

import type { CaseInstance, TreatmentResponse } from "@/domain/case";

/** Formulary antimicrobials (any of them satisfies an "antibiotics" row). */
export const ANTIBIOTIC_CODES: ReadonlySet<string> = new Set([
  "2193", "11124", "82122", "21212", "3640", "4413", "2582", "29561", "6922", "2348", "pip-tazo",
]);

const ABX = ["antibiot", "abx", "antimicrob"];

export const FORMULARY_ROW_STEMS: Record<string, string[]> = {
  "2193": ["antibiot", "abx", "ceftriax"],
  "11124": [...ABX, "vancomy"],
  "82122": [...ABX, "levoflox", "fluoroquin", "quinolon"],
  "21212": [...ABX, "clarithro", "macrolid"],
  "3640": [...ABX, "doxycyc"],
  "4413": [...ABX, "gentamic", "aminoglyc"],
  "2582": [...ABX, "clindamy"],
  "29561": [...ABX, "merope", "carbapen"],
  "6922": [...ABX, "metronid"],
  "2348": [...ABX, "chloramph"],
  "pip-tazo": [...ABX, "pipera", "tazobac"],
  artesunate: ["artesun", "antimalar"],
  "260101": ["oseltam", "antivir"],
  "3264": ["dexameth", "steroid", "corticost"],
  "313002": ["fluid", "crystalloid", "saline"],
  "7806": ["oxygen"],
  "161": ["analges", "antipyr", "paracetam"],
  "7052": ["analges", "opioid", "morphin"],
  "435": ["bronchodil", "salbut", "saba"],
  "3992-im": ["adrenaline", "epinephrine"],
  "7242": ["naloxon"],
  "5856": ["insulin"],
  "1191": ["aspirin", "antiplatelet"],
};

/** Rows that are tests or procedures: never satisfied by giving a drug. */
export const DIAGNOSTIC_ROW_STEMS = [
  "culture", "film", "test", "aspirat", "swab", "mark ", "look for", "drain", "washout", "ercp", "decompress",
  "referral", "source control",
];

/**
 * Contraindicated rows that describe NOT acting ("Delay antibiotics"): scored
 * by the target timer, never administered (review 06b F09). Mirror of
 * OMISSION_ROW_STEMS in server/orchestration/director.py.
 */
export const OMISSION_ROW_STEMS = [
  "delay", "withhold", "wait", "await", "watchful", "discharge", "safety-net", "safety net", "continue nephrotoxins",
  "single oral",
];

/** True for a contraindicated omission row (mirror of director.row_role "omission"). */
export function isOmissionRow(row: TreatmentResponse): boolean {
  if (row.appropriateness !== "contraindicated") return false;
  const lead = (row.label?.en ?? "").toLowerCase();
  const head = ` ${lead.slice(0, 30)}`;
  return OMISSION_ROW_STEMS.some((s) => lead.startsWith(s) || head.includes(` ${s}`));
}

function isDiagnosticRow(label: string): boolean {
  const lead = label.toLowerCase();
  const head = ` ${lead.slice(0, 40)}`;
  return DIAGNOSTIC_ROW_STEMS.some((s) => lead.startsWith(s) || head.includes(` ${s}`));
}

/** The case row an administered code stands for, or undefined. */
export function matchTreatmentResponse(c: CaseInstance, code: string): TreatmentResponse | undefined {
  const rows = c.treatmentResponses ?? [];
  const exact = rows.find((r) => r.treatmentCode === code);
  if (exact) return exact;
  const stems = FORMULARY_ROW_STEMS[code];
  if (!stems) return undefined;
  for (const row of rows) {
    if (row.appropriateness === "contraindicated") continue;
    const label = row.label?.en ?? "";
    if (isDiagnosticRow(label)) continue;
    const hay = `${row.treatmentCode} ${label}`.toLowerCase();
    if (!ANTIBIOTIC_CODES.has(code) && FORMULARY_ROW_STEMS["2193"].some((s) => hay.includes(s))) continue;
    if (stems.some((s) => hay.includes(s))) return row;
  }
  return undefined;
}
