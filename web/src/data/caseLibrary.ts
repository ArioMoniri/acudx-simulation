/**
 * AcuDx — Case Library presentation layer (docs/design/01, docs/00-overview/04).
 *
 * Screen-specific derivations for the Cases page. A CaseInstance is the full
 * clinical ground truth (src/domain/case.ts); the library needs a few browsing
 * facets the ground truth does not store directly: a specialty, a chief-complaint
 * family (for filtering), a guideline tag, an ICD/DSM code chip, and the set of
 * languages the content is authored in. These are pure, deterministic functions
 * over the case (no state, no i18n side effects), kept out of mock.ts so the
 * library owns its own facet vocabulary.
 *
 * Education only. Synthetic patients. No real patient data.
 */

import type { Bilingual, Lang } from "@/data/mock";
import { CODE_SYSTEMS } from "@/domain/fhir";
import type { CaseInstance } from "@/domain/case";
import { cachedCitation } from "@/lib/guidelinesApi";
import { CHIEF_COMPLAINT_FAMILIES, type ChiefComplaintFamily } from "@/domain/caseGen";

/* -------------------------------------------------------------------------- */
/* Specialty facet                                                             */
/* -------------------------------------------------------------------------- */

export type Specialty =
  | "emergency"
  | "cardiology"
  | "neurology"
  | "surgery"
  | "respiratory"
  | "psychiatry";

export const SPECIALTY_LABELS: Record<Specialty, Bilingual> = {
  emergency: { en: "Emergency medicine", tr: "Acil tıp" },
  cardiology: { en: "Cardiology", tr: "Kardiyoloji" },
  neurology: { en: "Neurology", tr: "Nöroloji" },
  surgery: { en: "General surgery", tr: "Genel cerrahi" },
  respiratory: { en: "Respiratory", tr: "Göğüs hastalıkları" },
  psychiatry: { en: "Psychiatry", tr: "Psikiyatri" },
};

/**
 * Derive the teaching specialty from the confirmed diagnosis code. Every case is
 * worked in the emergency department, so the specialty here is the discipline the
 * diagnosis most naturally belongs to (used only as a browsing facet).
 */
export function specialtyOf(c: CaseInstance): Specialty {
  const coding = c.correctDiagnosis.code.coding[0];
  const code = coding?.code ?? "";
  const system = coding?.system ?? "";

  if (system === CODE_SYSTEMS.dsm5tr) return "psychiatry";

  // ICD-10 chapter prefixes → discipline.
  if (code.startsWith("I21") || code.startsWith("I20")) return "cardiology";
  if (code.startsWith("I26")) return "respiratory"; // pulmonary embolism
  if (code.startsWith("I60") || code.startsWith("G4")) return "neurology";
  if (code.startsWith("K3") || code.startsWith("K5")) return "surgery";
  if (code.startsWith("J")) return "respiratory";
  return "emergency";
}

/* -------------------------------------------------------------------------- */
/* Chief-complaint family facet (aligns with caseGen constraints)             */
/* -------------------------------------------------------------------------- */

// Derived from the generator's canonical family list so every family (all 16,
// and any future addition) always has a label — no exhaustive literal to update.
export const COMPLAINT_LABELS: Record<ChiefComplaintFamily, Bilingual> =
  Object.fromEntries(
    CHIEF_COMPLAINT_FAMILIES.map((f) => [f.id, f.label]),
  ) as Record<ChiefComplaintFamily, Bilingual>;

/**
 * Classify a case into a chief-complaint family from its diagnosis code, so the
 * library filter maps 1:1 onto the caseGen presentation families. Returns null
 * when the case does not belong to one of the four browsable families.
 */
export function complaintFamilyOf(c: CaseInstance): ChiefComplaintFamily | null {
  const code = c.correctDiagnosis.code.coding[0]?.code ?? "";
  // Cardiac / anxiety chest-pain presentations.
  if (code.startsWith("I21") || code.startsWith("I20") || code === "300.01") {
    return "chest-pain";
  }
  if (code.startsWith("I60") || code.startsWith("G4")) return "headache";
  if (code.startsWith("K3") || code.startsWith("K5") || code.startsWith("I88")) {
    return "abdominal-pain";
  }
  if (code.startsWith("I26") || code.startsWith("J")) return "dyspnea";
  return null;
}

/* -------------------------------------------------------------------------- */
/* Code chip (ICD-10 / DSM-5-TR)                                               */
/* -------------------------------------------------------------------------- */

export interface CaseCodeChip {
  /** Short system label, e.g. "ICD-10" or "DSM-5-TR". */
  system: string;
  /** The code itself, e.g. "I21.4". */
  code: string;
}

const SYSTEM_SHORT: Record<string, string> = {
  [CODE_SYSTEMS.icd10]: "ICD-10",
  [CODE_SYSTEMS.icd11]: "ICD-11",
  [CODE_SYSTEMS.dsm5tr]: "DSM-5-TR",
};

/** The primary diagnosis code chip for a case (system short-label + code). */
export function codeChipOf(c: CaseInstance): CaseCodeChip {
  const coding = c.correctDiagnosis.code.coding[0];
  return {
    system: SYSTEM_SHORT[coding?.system ?? ""] ?? "Dx",
    code: coding?.code ?? "",
  };
}

/* -------------------------------------------------------------------------- */
/* Guideline tag                                                               */
/* -------------------------------------------------------------------------- */


/**
 * Pick the headline guideline tag: prefer the citation on the first critical
 * workup step, else the first step, else a neutral fallback.
 */
export function guidelineTagOf(c: CaseInstance): string {
  const critical = c.expectedWorkup.find((w) => w.critical);
  const source = critical ?? c.expectedWorkup[0];
  if (!source) return "";
  // The label comes from the verified statement cache (filled by the guideline
  // API); without it there is no tag rather than a hard-coded one.
  return cachedCitation(source.citationId)?.label ?? "";
}

/* -------------------------------------------------------------------------- */
/* Languages available                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Every seed and generated case authors all patient-facing text bilingually
 * (Bilingual has both `en` and `tr`), so the whole library is EN + TR. Guard by
 * checking the chief complaint carries both sides in case a datum is ever
 * single-language.
 */
export function languagesOf(c: CaseInstance): Lang[] {
  const hasEn = c.chiefComplaint.en.trim().length > 0;
  const hasTr = c.chiefComplaint.tr.trim().length > 0;
  const langs: Lang[] = [];
  if (hasEn) langs.push("en");
  if (hasTr) langs.push("tr");
  return langs.length > 0 ? langs : ["en"];
}

/* -------------------------------------------------------------------------- */
/* Difficulty band descriptor (shared with the Start dial vocabulary)         */
/* -------------------------------------------------------------------------- */

/** The 1-5 difficulty band names, matching DIFFICULTY_LABELS on the Start page. */
export const DIFFICULTY_BAND: Record<1 | 2 | 3 | 4 | 5, Bilingual> = {
  1: { en: "Gentle", tr: "Nazik" },
  2: { en: "Guided", tr: "Rehberli" },
  3: { en: "Core", tr: "Çekirdek" },
  4: { en: "Stretch", tr: "Zorlayıcı" },
  5: { en: "Expert", tr: "Uzman" },
};

/* -------------------------------------------------------------------------- */
/* Estimated minutes                                                           */
/* -------------------------------------------------------------------------- */

/**
 * A rough time estimate for browsing: base on the number of expected workup and
 * history items plus a difficulty premium. Deterministic, no clock reads.
 */
export function estMinutesOf(c: CaseInstance): number {
  const base = 8;
  const workup = c.expectedWorkup.length * 2;
  const history = Math.round(c.groundTruth.history.length / 2);
  const premium = (c.difficulty - 1) * 2;
  return Math.min(30, base + workup + history + premium);
}
