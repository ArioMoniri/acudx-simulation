/**
 * AcuDx — patientIdentity: the ONE resolver that unifies every patient visual.
 *
 * The bug this fixes: the realistic photo (from PATIENT_PHOTOS) and the 3D head
 * (from PATIENT_PROFILES via pickProfile) were two DISCONNECTED identity sources,
 * so the enlarged "live clinical signs" head could be labelled "Bernard Whitfield"
 * while the case patient was "Ece Polat", and different patients kept collapsing
 * onto the same three video faces.
 *
 * `resolvePatientVisual` is the single source of truth: given a CaseInstance it
 * returns the ONE identity every surface renders — the case patient's own name,
 * a STABLE + DISTINCT demographic-matched photo (seeded off the patient identity,
 * not the raw case seed, so distinct patients get distinct faces), and a skin
 * tone DERIVED from that photo's ethnicity so a 3D head (kept only as a small
 * secondary element) agrees with the photo instead of contradicting it.
 *
 * Pure + deterministic: the same patient always resolves to the same visual.
 *
 * Education only. Synthetic patient — no real patient data path.
 */

import type { CaseInstance } from "@/domain/case";
import { hashSeed, type SkinTone } from "@/domain/patientProfiles";
import {
  hasPatientVideo,
  pickPatientPhoto,
  type PhotoSex,
} from "@/data/patientPhotos";

/** The single, unified visual identity every patient surface renders. */
export interface PatientVisualIdentity {
  /** The CASE patient's display name (never a pool name). */
  name: string;
  /** Photo/anatomy sex, mapped from the FHIR administrative gender. */
  sexAtBirth: PhotoSex;
  /** Patient age in years. */
  age: number;
  /** The chosen synthetic portrait id (stable + distinct per patient). */
  photoId: string;
  /** The chosen portrait's ethnicity label (drives the derived skin tone). */
  ethnicity: string;
  /** Fitzpatrick-adjacent tone (1..6) derived from the photo, for the 3D head. */
  skinTone: SkinTone;
  /** Whether the chosen face ships an "alive" idle video loop. */
  hasVideo: boolean;
  /**
   * The identity-derived seed handed to `pickPatientPhoto`. Surfaces that render
   * `<PatientPhoto>` by sex/age/seed can pass this to reproduce EXACTLY the same
   * `photoId` this resolver chose (they may also just pass `photoId` directly).
   */
  photoSeed: number;
}

/** Map a photo ethnicity onto a Fitzpatrick-adjacent skin tone (1 light..6 deep). */
const ETHNICITY_SKIN_TONE: Record<string, SkinTone> = {
  white: 1,
  "east-asian": 2,
  latina: 3,
  "middle-eastern": 3,
  "south-asian": 4,
  black: 6,
};

/** Derive a skin tone from a photo's ethnicity so a 3D head matches the photo. */
export function skinToneForEthnicity(ethnicity: string): SkinTone {
  return ETHNICITY_SKIN_TONE[ethnicity.toLowerCase()] ?? 3;
}

/** Map the FHIR administrative gender onto the photo library's sex union. */
export function photoSexFor(gender: string): PhotoSex {
  return gender === "female" ? "female" : "male";
}

export interface PatientVisualParts {
  /** The case patient's display name. */
  name: string;
  /** FHIR administrative gender ("male" | "female" | "other" | "unknown"). */
  gender: string;
  ageYears: number;
  /** Any stable case value (numeric seed / id). */
  seed: string | number;
}

/**
 * Resolve the unified visual identity from the raw pieces. Shared by
 * `resolvePatientVisual` and by callers that only hold the patient + seed (e.g.
 * the 3D avatar wrapper reading the encounter store).
 *
 * The photo choice is seeded off `hash(name : seed)` — NOT the raw case seed —
 * so two different patients never collapse onto the same face just because a
 * pool bias preferred it, while the same patient stays perfectly stable.
 */
export function patientVisualFromParts(
  parts: PatientVisualParts,
): PatientVisualIdentity {
  const sexAtBirth = photoSexFor(parts.gender);
  const age = parts.ageYears;
  const photoSeed = hashSeed(`${parts.name}:${parts.seed}`);
  const photo = pickPatientPhoto(sexAtBirth, age, photoSeed);
  return {
    name: parts.name,
    sexAtBirth,
    age,
    photoId: photo.id,
    ethnicity: photo.ethnicity,
    skinTone: skinToneForEthnicity(photo.ethnicity),
    hasVideo: hasPatientVideo(photo.id),
    photoSeed,
  };
}

/**
 * resolvePatientVisual — the ONE entry point. Every patient visual (storyboard
 * thumbnail, flowsheet card, enlarged viewer, interview presence, and any 3D
 * head) must resolve identity through this so they all show the SAME case
 * patient: same name, same distinct photo, matching skin tone.
 */
export function resolvePatientVisual(
  caseInstance: CaseInstance,
): PatientVisualIdentity {
  const { patient, seed } = caseInstance;
  return patientVisualFromParts({
    name: patient.name,
    gender: patient.gender,
    ageYears: patient.ageYears,
    seed,
  });
}
