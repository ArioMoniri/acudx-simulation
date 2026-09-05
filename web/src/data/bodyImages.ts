/**
 * AcuDx — photoreal full-body image sets for the interactive exam viewer.
 *
 * Each set is a handful of CONSISTENT photoreal images of the same synthetic
 * patient at several angles (front / right / back / left), generated once and
 * bundled (air-gapped at runtime). `resolvePatientBody` returns the set that
 * matches a case's demographic, or null when no full-body set exists yet — in
 * which case the surfaces fall back to the realistic single portrait.
 *
 * This is a growing bank (like the portraits): as more demographic sets are
 * generated they are registered here. Education only. Synthetic patient.
 */

import type { CaseInstance } from "@/domain/case";

export interface BodyImageSet {
  id: string;
  /** Photoreal frames in clockwise spin order (front, right, back, left). */
  frames: string[];
  /** i18n keys for each frame's angle label. */
  frameLabelKeys: string[];
  /** Demographic this set represents. */
  sex: "male" | "female";
  /** Inclusive age band this set is appropriate for. */
  ageMin: number;
  ageMax: number;
}

const BASE = import.meta.env.BASE_URL;
const angleKeys = [
  "bodyviewer.angle.front",
  "bodyviewer.angle.right",
  "bodyviewer.angle.back",
  "bodyviewer.angle.left",
];

/** The first generated set: an adult man in a hospital gown (front/right/back/left). */
const ADULT_MALE: BodyImageSet = {
  id: "adult-male",
  frames: [
    `${BASE}patients/exam/am_0.jpg`,
    `${BASE}patients/exam/am_1.jpg`,
    `${BASE}patients/exam/am_2.jpg`,
    `${BASE}patients/exam/am_3.jpg`,
  ],
  frameLabelKeys: angleKeys,
  sex: "male",
  ageMin: 35,
  ageMax: 80,
};

const BODY_SETS: BodyImageSet[] = [ADULT_MALE];

/**
 * The full-body image set matching a case's patient, or null when none exists
 * yet (caller falls back to the portrait). Matches on sex + age band.
 */
export function resolvePatientBody(caseInstance: CaseInstance): BodyImageSet | null {
  const p = caseInstance.patient;
  const sex = p.gender === "female" ? "female" : "male";
  const age = p.ageYears;
  return (
    BODY_SETS.find((s) => s.sex === sex && age >= s.ageMin && age <= s.ageMax) ??
    null
  );
}
