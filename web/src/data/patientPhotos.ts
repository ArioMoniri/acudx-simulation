/**
 * AcuDx — synthetic patient photo library.
 *
 * A small, bundled set of photorealistic SYNTHETIC patient portraits (generated
 * once, air-gapped at runtime — no external calls). Each case picks the closest
 * face by sex + age so the visible patient matches the demographic, replacing
 * the procedural cartoon avatar. Every face is a synthetic person, not a real
 * individual, and is always labelled as such in the UI.
 */

export type PhotoSex = "male" | "female";

export interface PatientPhotoMeta {
  id: string;
  sex: PhotoSex;
  age: number;
  ethnicity: string;
}

export const PATIENT_PHOTOS: PatientPhotoMeta[] = [
  { id: "p01", sex: "female", age: 28, ethnicity: "middle-eastern" },
  { id: "p02", sex: "male", age: 34, ethnicity: "east-asian" },
  { id: "p03", sex: "female", age: 45, ethnicity: "white" },
  { id: "p04", sex: "male", age: 58, ethnicity: "middle-eastern" },
  { id: "p05", sex: "male", age: 67, ethnicity: "white" },
  { id: "p06", sex: "female", age: 72, ethnicity: "south-asian" },
  { id: "p07", sex: "male", age: 22, ethnicity: "black" },
  { id: "p08", sex: "female", age: 40, ethnicity: "latina" },
  { id: "p09", sex: "female", age: 51, ethnicity: "black" },
  { id: "p10", sex: "female", age: 60, ethnicity: "east-asian" },
  { id: "p11", sex: "male", age: 30, ethnicity: "white" },
  { id: "p12", sex: "female", age: 75, ethnicity: "middle-eastern" },
];

/** Resolve the bundled URL for a photo id (respects Vite base path). */
export function patientPhotoUrl(id: string): string {
  return `${import.meta.env.BASE_URL}patients/${id}.jpg`;
}

/**
 * Photo ids that also ship a short "alive" idle video loop (subtle head
 * movement + blinking), so a matching case's patient looks alive rather than a
 * frozen still. Generated once from the same face; the rest stay stills.
 */
export const PATIENT_VIDEO_IDS = new Set<string>(["p01", "p04", "p09"]);

export function hasPatientVideo(id: string): boolean {
  return PATIENT_VIDEO_IDS.has(id);
}

export function patientVideoUrl(id: string): string {
  return `${import.meta.env.BASE_URL}patients/${id}.mp4`;
}

/**
 * Pick the closest-matching portrait for a case: same sex first, then the
 * nearest age; a stable seed varies the choice among near-equal ages so two
 * different 58-year-old men don't always get the identical face.
 */
export function pickPatientPhoto(
  sex: PhotoSex,
  age: number,
  seed = 0,
): PatientPhotoMeta {
  const pool = PATIENT_PHOTOS.filter((p) => p.sex === sex);
  const candidates = pool.length ? pool : PATIENT_PHOTOS;
  const sorted = [...candidates].sort(
    (a, b) => Math.abs(a.age - age) - Math.abs(b.age - age),
  );
  const bestAge = sorted[0].age;
  const near = sorted.filter((p) => Math.abs(p.age - bestAge) <= 10);
  const idx = Math.abs(Math.floor(seed)) % near.length;
  return near[idx];
}
