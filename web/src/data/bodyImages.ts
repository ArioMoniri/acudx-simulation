/**
 * AcuDx — photoreal full-body image sets for the interactive exam viewer.
 *
 * Each set is four CONSISTENT photoreal images of the SAME synthetic patient at
 * four angles (front / right / back / left), generated once from that patient's
 * own portrait (identity-matched face, hair and skin tone) and bundled
 * (air-gapped at runtime). There is now one set per portrait in the photo
 * library, keyed by `photoId` so the full-body figure is the exact same person
 * the rest of the UI shows — not merely a demographic look-alike.
 *
 * `resolvePatientBody` resolves the case's unified visual identity to its
 * `photoId` and returns the set with that id, or null when none exists (the
 * surfaces then fall back to the realistic single portrait). Education only.
 * Synthetic patient.
 */

import type { CaseInstance, ExamFinding } from "@/domain/case";
import { PATIENT_PHOTOS } from "@/data/patientPhotos";
import { resolvePatientVisual } from "@/domain/patientIdentity";
import type { BodyFinding } from "@/components/PatientBodyViewer";
import type { Lang } from "@/data/schema";

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

/**
 * Build the four-frame full-body set for a portrait id. Frames follow the
 * `<id>_<0..3>.jpg` convention under `patients/exam/` (0 front, 1 right, 2 back,
 * 3 left). `ageMin`/`ageMax` are retained for the shape but matching is by
 * `id === photoId`, so they carry the portrait's own age for documentation only.
 */
function makeBodySet(
  id: string,
  sex: "male" | "female",
  age: number,
): BodyImageSet {
  return {
    id,
    frames: [
      `${BASE}patients/exam/${id}_0.jpg`,
      `${BASE}patients/exam/${id}_1.jpg`,
      `${BASE}patients/exam/${id}_2.jpg`,
      `${BASE}patients/exam/${id}_3.jpg`,
    ],
    frameLabelKeys: angleKeys,
    sex,
    ageMin: age,
    ageMax: age,
  };
}

/**
 * One full-body set per portrait, keyed by photo id. Derived from the portrait
 * library so the bank stays in lock-step with it: every id in `PATIENT_PHOTOS`
 * ships a matching four-frame set under `patients/exam/`.
 */
const BODY_SETS: BodyImageSet[] = PATIENT_PHOTOS.map((p) =>
  makeBodySet(p.id, p.sex === "female" ? "female" : "male", p.age),
);

/**
 * The full-body image set for a case's patient, or null when none exists (caller
 * falls back to the portrait). Resolves the case's UNIFIED visual identity to a
 * `photoId` and returns the set whose `id` matches it — so the full-body figure
 * is the exact same synthetic person shown everywhere else, never a demographic
 * stand-in.
 */
export function resolvePatientBody(
  caseInstance: CaseInstance,
): BodyImageSet | null {
  const { photoId } = resolvePatientVisual(caseInstance);
  return BODY_SETS.find((s) => s.id === photoId) ?? null;
}

/**
 * Anatomical anchor (spin frame + normalized position) for each exam maneuver,
 * so a discovered abnormal finding pins onto the right part of the body. Front
 * frame for most; the back frame (2) is used where the manoeuvre inspects the
 * back. Positions are approximate — enough to read "this finding is here".
 */
const MANEUVER_ANCHOR: Record<string, { frame: number; x: number; y: number }> = {
  "general-inspection": { frame: 0, x: 0.5, y: 0.16 },
  "vitals-recheck": { frame: 0, x: 0.62, y: 0.26 },
  cardiovascular: { frame: 0, x: 0.44, y: 0.34 },
  respiratory: { frame: 2, x: 0.55, y: 0.32 },
  abdominal: { frame: 0, x: 0.5, y: 0.5 },
  neurological: { frame: 0, x: 0.5, y: 0.09 },
  musculoskeletal: { frame: 0, x: 0.33, y: 0.72 },
  skin: { frame: 0, x: 0.28, y: 0.55 },
  ent: { frame: 0, x: 0.52, y: 0.08 },
  "focused-special": { frame: 0, x: 0.5, y: 0.42 },
};

/**
 * Map DISCOVERED abnormal exam findings onto body markers so the interactive
 * patient becomes examinable — each finding the learner has elicited appears
 * pinned at its anatomical site. Findings on the same region are staggered so
 * they don't overlap. Normal findings are omitted (no marker clutter).
 */
export function bodyFindingsFromExam(
  exam: ExamFinding[],
  lang: Lang,
): BodyFinding[] {
  const perRegion = new Map<string, number>();
  const out: BodyFinding[] = [];
  for (const e of exam) {
    if (!e.abnormal) continue;
    const a = MANEUVER_ANCHOR[e.maneuver] ?? { frame: 0, x: 0.5, y: 0.3 };
    const k = `${a.frame}:${a.x}:${a.y}`;
    const idx = perRegion.get(k) ?? 0;
    perRegion.set(k, idx + 1);
    out.push({
      id: e.id,
      frame: a.frame,
      x: a.x,
      y: Math.min(0.95, a.y + idx * 0.06),
      label: e.finding[lang],
      tone: "finding",
    });
  }
  return out;
}
