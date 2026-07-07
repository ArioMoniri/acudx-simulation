/**
 * AcuDx EHR — small presentation helpers shared across the workspace panels.
 *
 * Pure, tokenless helpers: pull the active-language string out of a Bilingual,
 * format the encounter sim-clock, map an ESI acuity to a clinical state, and
 * resolve a CodeableConcept's display text. No React, no i18n side effects.
 *
 * Education only.
 */

import type { Bilingual, Lang } from "@/data/mock";
import type { ClinicalState } from "@/data/mock";
import type { CodeableConcept } from "@/domain/fhir";
import type { ObservationInterpretation } from "@/domain/fhir";

/** Pick the active-language side of a Bilingual value. */
export function pick(b: Bilingual | undefined, lang: Lang): string {
  if (!b) return "";
  return b[lang] ?? b.en ?? "";
}

/** Resolve a CodeableConcept's display, preferring localized text over coding. */
export function conceptText(concept: CodeableConcept, lang: Lang): string {
  if (concept.text) return pick(concept.text, lang);
  return concept.coding[0]?.display ?? "";
}

/** The primary code string of a CodeableConcept. */
export function conceptCode(concept: CodeableConcept): string {
  return concept.coding[0]?.code ?? "";
}

/** Format a sim-clock offset (ms) as mm:ss for the encounter clock. */
export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Whole minutes elapsed, for the "X min" timeline labels. */
export function minutesOf(ms: number): number {
  return Math.max(0, Math.round(ms / 60000));
}

/**
 * Map an ESI acuity (1 most acute .. 5 least) to the app's ClinicalState so the
 * banner can carry an icon + label (never color alone).
 */
export function esiToState(esi: 1 | 2 | 3 | 4 | 5): ClinicalState {
  switch (esi) {
    case 1:
      return "critical";
    case 2:
      return "warning";
    case 3:
      return "caution";
    default:
      return "normal";
  }
}

/**
 * Map a FHIR ObservationInterpretation flag to a ClinicalState for the
 * icon + label pairing in the flowsheet/results tables (never color alone).
 */
export function interpretationToState(
  interp: ObservationInterpretation | undefined,
): ClinicalState {
  switch (interp) {
    case "HH":
    case "LL":
      return "critical";
    case "H":
    case "L":
      return "warning";
    case "A":
      return "caution";
    default:
      return "normal";
  }
}

/** i18n suffix key for an interpretation flag (results.interp.<key>). */
export function interpretationKey(
  interp: ObservationInterpretation | undefined,
): string {
  switch (interp) {
    case "HH":
      return "criticalHigh";
    case "LL":
      return "criticalLow";
    case "H":
      return "high";
    case "L":
      return "low";
    case "A":
      return "abnormal";
    default:
      return "normal";
  }
}
