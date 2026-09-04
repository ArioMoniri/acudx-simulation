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

/** How many nearest-age faces a patient can spread across (distinctness window). */
const NEAREST_WINDOW = 4;

/**
 * Pick a portrait for a patient: same sex first, then a small window of the
 * NEAREST ages, and the (identity-derived) seed selects DISTINCTLY within that
 * window — so two different 45-year-old women get different faces while the same
 * patient stays perfectly stable across renders.
 *
 * There is deliberately NO video-preference bias: a face that ships an "alive"
 * idle loop is used only when it is the natural demographic pick, never forced on
 * many unrelated patients just because it can move. (That old bias collapsed most
 * cases onto the three video faces.) Stills get a gentle breathing animation in
 * the UI, so a still never looks frozen either.
 */
export function pickPatientPhoto(
  sex: PhotoSex,
  age: number,
  seed = 0,
): PatientPhotoMeta {
  const pool = PATIENT_PHOTOS.filter((p) => p.sex === sex);
  const candidates = pool.length ? pool : PATIENT_PHOTOS;
  // Rank by age proximity (id as a stable tiebreak), then keep a small window of
  // the nearest faces so distinct patients fan out across several plausible
  // matches instead of all colliding on the single closest age.
  const sorted = [...candidates].sort(
    (a, b) =>
      Math.abs(a.age - age) - Math.abs(b.age - age) || a.id.localeCompare(b.id),
  );
  const window = sorted.slice(0, Math.min(NEAREST_WINDOW, sorted.length));
  const idx = Math.abs(Math.floor(seed)) % window.length;
  return window[idx];
}
