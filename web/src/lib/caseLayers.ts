/**
 * AcuDx: the layer vocabulary of an on-request case (server/orchestration/staged.py).
 *
 * A case opens with its kernel and opening only; every other part is a layer the
 * server writes for the same thread, by background continuation or on first access:
 *
 *   history.presenting | history.associated | history.background
 *   exam.general | exam.cardiovascular | exam.respiratory | exam.abdominal |
 *   exam.neurological | exam.msk_skin | exam.ent_special
 *   treatments | results | debrief | event.<branch id>
 *
 * Pure. Education only.
 */

import type { ExamManeuver, QuestionIntent } from "@/domain/case";

export type LayerStatus = "pending" | "ready" | "failed";

export const HISTORY_CLUSTERS: Record<string, readonly QuestionIntent[]> = {
  presenting: ["onset", "location", "character", "radiation", "severity", "timing", "aggravating", "relieving"],
  associated: ["associated-symptoms", "red-flags", "risk-factors", "ice"],
  background: ["past-medical-history", "medications", "allergies", "family-history", "social-history"],
} as const as Record<string, readonly QuestionIntent[]>;

export const EXAM_SYSTEMS: Record<string, readonly ExamManeuver[]> = {
  general: ["general-inspection", "vitals-recheck"],
  cardiovascular: ["cardiovascular"],
  respiratory: ["respiratory"],
  abdominal: ["abdominal"],
  neurological: ["neurological"],
  msk_skin: ["musculoskeletal", "skin"],
  ent_special: ["ent", "focused-special"],
} as const as Record<string, readonly ExamManeuver[]>;

/** The layer a history question reads. */
export function layerForIntent(intent: string): string | null {
  for (const [name, intents] of Object.entries(HISTORY_CLUSTERS)) {
    if ((intents as readonly string[]).includes(intent)) return `history.${name}`;
  }
  return null;
}

/** The layer an exam maneuver reads. */
export function layerForManeuver(maneuver: string): string | null {
  for (const [name, mans] of Object.entries(EXAM_SYSTEMS)) {
    if ((mans as readonly string[]).includes(maneuver)) return `exam.${name}`;
  }
  return null;
}

/** The layer an encounter tab shows (Orders: the treatment table; Results: results). */
export function layerForTab(tab: string): string | null {
  if (tab === "orders" || tab === "treatments" || tab === "medications") return "treatments";
  if (tab === "results") return "results";
  return null;
}

/** Normalise a server layer map (`meta.layers`) to known statuses. */
export function layerStatuses(raw: Record<string, string | null | undefined> | undefined): Record<string, LayerStatus> {
  const out: Record<string, LayerStatus> = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (v === "pending" || v === "ready" || v === "failed") out[k] = v;
  }
  return out;
}

/** True when the layer is known to the thread and not written yet. */
export function layerPending(layers: Record<string, LayerStatus>, layer: string | null): boolean {
  if (!layer) return false;
  const s = layers[layer];
  return s === undefined || s === "pending" || s === "failed";
}
