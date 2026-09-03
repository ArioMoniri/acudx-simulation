/**
 * AcuDx — patientProfiles: the curated character library for the procedural
 * patient avatar (issue #2).
 *
 * A PatientProfile is the *presentation* identity of a synthetic patient: how
 * they look (skin tone, hair, build, headwear, glasses, facial hair), how they
 * carry themselves (baseline affect), and a few persona traits that colour the
 * interview. It is deliberately decoupled from the clinical ground truth — the
 * same profile can front many generated cases, and the Vitals & Physiology
 * Engine still owns the clinical-sign channel that shades the face on top.
 *
 * Diversity is intentional and respectful: a spread of ages (paediatric →
 * very elderly), skin tones 1..6, gender presentations, headwear including
 * hijab / headscarf / cap, and an EN / TR locale balance for the Turkish build.
 *
 * Education only. No real patient. Names are fictional.
 */

/* -------------------------------------------------------------------------- */
/* Schema                                                                      */
/* -------------------------------------------------------------------------- */

/** Fitzpatrick-adjacent tone ladder, 1 (light) .. 6 (deep). */
export type SkinTone = 1 | 2 | 3 | 4 | 5 | 6;
export type HairStyle =
  | "short"
  | "medium"
  | "long"
  | "bald"
  | "bun"
  | "curly"
  | "coily";
export type HairColor = "black" | "brown" | "blonde" | "gray" | "red" | "white";
export type FacialHair = "none" | "stubble" | "beard" | "mustache";
export type Headwear = "none" | "hijab" | "cap" | "headscarf";
export type Build = "slim" | "average" | "heavy";
export type GenderPresentation = "masc" | "femme" | "neutral";
export type SexAtBirth = "male" | "female";
export type BaselineAffect =
  | "calm"
  | "anxious"
  | "distressed"
  | "drowsy"
  | "irritable"
  | "tearful"
  | "stoic";
export type ProfileLocale = "en" | "tr";

export interface PatientAppearance {
  skinTone: SkinTone;
  hairStyle: HairStyle;
  hairColor: HairColor;
  facialHair: FacialHair;
  glasses: boolean;
  headwear: Headwear;
  build: Build;
}

export interface PatientProfile {
  id: string;
  name: { en: string; tr: string };
  age: number;
  sexAtBirth: SexAtBirth;
  genderPresentation: GenderPresentation;
  appearance: PatientAppearance;
  baselineAffect: BaselineAffect;
  personaTraits: string[];
  /** Chief-complaint family this persona reads well for, e.g. "chest-pain". */
  conditionHint: string;
  locales: ProfileLocale[];
}

/* -------------------------------------------------------------------------- */
/* Curated library (18 profiles, deduped from the generation pass)             */
/* -------------------------------------------------------------------------- */

export const PATIENT_PROFILES: PatientProfile[] = [
  {
    id: "pp-emre-yildiz",
    name: { en: "Emre Yildiz", tr: "Emre Yıldız" },
    age: 34,
    sexAtBirth: "male",
    genderPresentation: "masc",
    appearance: {
      skinTone: 3,
      hairStyle: "short",
      hairColor: "black",
      facialHair: "stubble",
      glasses: false,
      headwear: "none",
      build: "average",
    },
    baselineAffect: "anxious",
    personaTraits: ["talkative", "health-anxious", "checks-phone-for-symptoms"],
    conditionHint: "chest-pain",
    locales: ["tr"],
  },
  {
    id: "pp-priya-nair",
    name: { en: "Priya Nair", tr: "Priya Nair" },
    age: 26,
    sexAtBirth: "female",
    genderPresentation: "femme",
    appearance: {
      skinTone: 5,
      hairStyle: "long",
      hairColor: "black",
      facialHair: "none",
      glasses: true,
      headwear: "none",
      build: "slim",
    },
    baselineAffect: "distressed",
    personaTraits: ["breathless", "speaks-in-short-sentences", "known-asthmatic"],
    conditionHint: "dyspnea",
    locales: ["en"],
  },
  {
    id: "pp-meiling-chen",
    name: { en: "Mei-Ling Chen", tr: "Mei-Ling Chen" },
    age: 29,
    sexAtBirth: "female",
    genderPresentation: "neutral",
    appearance: {
      skinTone: 2,
      hairStyle: "medium",
      hairColor: "black",
      facialHair: "none",
      glasses: true,
      headwear: "none",
      build: "average",
    },
    baselineAffect: "anxious",
    personaTraits: ["first-episode", "non-native-speaker", "asks-if-its-serious"],
    conditionHint: "palpitations",
    locales: ["en"],
  },
  {
    id: "pp-marcus-okafor",
    name: { en: "Marcus Okafor", tr: "Marcus Okafor" },
    age: 44,
    sexAtBirth: "male",
    genderPresentation: "masc",
    appearance: {
      skinTone: 6,
      hairStyle: "coily",
      hairColor: "black",
      facialHair: "beard",
      glasses: false,
      headwear: "none",
      build: "heavy",
    },
    baselineAffect: "stoic",
    personaTraits: ["downplays-symptoms", "delayed-presentation", "reluctant-historian"],
    conditionHint: "chest-pain",
    locales: ["en"],
  },
  {
    id: "pp-zeynep-demir",
    name: { en: "Zeynep Demir", tr: "Zeynep Demir" },
    age: 22,
    sexAtBirth: "female",
    genderPresentation: "femme",
    appearance: {
      skinTone: 3,
      hairStyle: "long",
      hairColor: "brown",
      facialHair: "none",
      glasses: false,
      headwear: "hijab",
      build: "average",
    },
    baselineAffect: "distressed",
    personaTraits: ["known-food-allergy", "frightened", "throat-tightness"],
    conditionHint: "dyspnea",
    locales: ["en", "tr"],
  },
  {
    id: "pp-sofia-markovic",
    name: { en: "Sofia Markovic", tr: "Sofia Markoviç" },
    age: 33,
    sexAtBirth: "female",
    genderPresentation: "femme",
    appearance: {
      skinTone: 1,
      hairStyle: "long",
      hairColor: "red",
      facialHair: "none",
      glasses: false,
      headwear: "none",
      build: "slim",
    },
    baselineAffect: "tearful",
    personaTraits: ["recent-long-haul-flight", "on-oral-contraceptive", "frightened-after-collapse"],
    conditionHint: "syncope",
    locales: ["en"],
  },
  {
    id: "p2-ayse-yildirim",
    name: { en: "Ayse Yildirim", tr: "Ayşe Yıldırım" },
    age: 78,
    sexAtBirth: "female",
    genderPresentation: "femme",
    appearance: {
      skinTone: 3,
      hairStyle: "bun",
      hairColor: "gray",
      facialHair: "none",
      glasses: true,
      headwear: "headscarf",
      build: "average",
    },
    baselineAffect: "stoic",
    personaTraits: ["elderly-frail", "hard-of-hearing", "low-health-literacy"],
    conditionHint: "abdominal-pain",
    locales: ["tr"],
  },
  {
    id: "p2-mehmet-demir",
    name: { en: "Mehmet Demir", tr: "Mehmet Demir" },
    age: 81,
    sexAtBirth: "male",
    genderPresentation: "masc",
    appearance: {
      skinTone: 3,
      hairStyle: "short",
      hairColor: "white",
      facialHair: "mustache",
      glasses: true,
      headwear: "none",
      build: "slim",
    },
    baselineAffect: "calm",
    personaTraits: ["elderly-frail", "low-health-literacy"],
    conditionHint: "neuro-deficit",
    locales: ["tr"],
  },
  {
    id: "p2-gloria-adeyemi",
    name: { en: "Gloria Adeyemi", tr: "Gloria Adeyemi" },
    age: 73,
    sexAtBirth: "female",
    genderPresentation: "femme",
    appearance: {
      skinTone: 6,
      hairStyle: "coily",
      hairColor: "gray",
      facialHair: "none",
      glasses: false,
      headwear: "none",
      build: "heavy",
    },
    baselineAffect: "distressed",
    personaTraits: ["elderly-frail", "facial-droop-worried"],
    conditionHint: "neuro-deficit",
    locales: ["en"],
  },
  {
    id: "p2-bernard-whitfield",
    name: { en: "Bernard Whitfield", tr: "Bernard Whitfield" },
    age: 88,
    sexAtBirth: "male",
    genderPresentation: "masc",
    appearance: {
      skinTone: 1,
      hairStyle: "bald",
      hairColor: "white",
      facialHair: "stubble",
      glasses: true,
      headwear: "none",
      build: "slim",
    },
    baselineAffect: "tearful",
    personaTraits: ["elderly-frail", "visual-impairment"],
    conditionHint: "abdominal-pain",
    locales: ["en"],
  },
  {
    id: "p2-fatma-kaya",
    name: { en: "Fatma Kaya", tr: "Fatma Kaya" },
    age: 70,
    sexAtBirth: "female",
    genderPresentation: "femme",
    appearance: {
      skinTone: 2,
      hairStyle: "bun",
      hairColor: "brown",
      facialHair: "none",
      glasses: true,
      headwear: "none",
      build: "heavy",
    },
    baselineAffect: "anxious",
    personaTraits: ["non-native-speaker", "low-health-literacy"],
    conditionHint: "dizziness",
    locales: ["tr", "en"],
  },
  {
    id: "p2-deniz-aydin",
    name: { en: "Deniz Aydin", tr: "Deniz Aydın" },
    age: 84,
    sexAtBirth: "female",
    genderPresentation: "neutral",
    appearance: {
      skinTone: 4,
      hairStyle: "short",
      hairColor: "white",
      facialHair: "none",
      glasses: true,
      headwear: "none",
      build: "slim",
    },
    baselineAffect: "drowsy",
    personaTraits: ["elderly-frail", "hard-of-hearing", "low-health-literacy"],
    conditionHint: "confusion",
    locales: ["tr"],
  },
  {
    id: "p3-deniz-yildiz",
    name: { en: "Deniz Yildiz", tr: "Deniz Yıldız" },
    age: 4,
    sexAtBirth: "female",
    genderPresentation: "femme",
    appearance: {
      skinTone: 3,
      hairStyle: "medium",
      hairColor: "brown",
      facialHair: "none",
      glasses: false,
      headwear: "none",
      build: "slim",
    },
    baselineAffect: "tearful",
    personaTraits: ["pediatric-via-parent", "low-health-literacy", "clinging-to-parent"],
    conditionHint: "abdominal-pain",
    locales: ["tr"],
  },
  {
    id: "p3-kwame-mensah",
    name: { en: "Kwame Mensah", tr: "Kwame Mensah" },
    age: 7,
    sexAtBirth: "male",
    genderPresentation: "masc",
    appearance: {
      skinTone: 6,
      hairStyle: "coily",
      hairColor: "black",
      facialHair: "none",
      glasses: false,
      headwear: "none",
      build: "slim",
    },
    baselineAffect: "distressed",
    personaTraits: ["pediatric-via-parent", "audible-wheeze", "using-accessory-muscles"],
    conditionHint: "dyspnea",
    locales: ["en"],
  },
  {
    id: "p3-elif-kaya",
    name: { en: "Elif Kaya", tr: "Elif Kaya" },
    age: 24,
    sexAtBirth: "female",
    genderPresentation: "femme",
    appearance: {
      skinTone: 3,
      hairStyle: "long",
      hairColor: "black",
      facialHair: "none",
      glasses: true,
      headwear: "none",
      build: "average",
    },
    baselineAffect: "tearful",
    personaTraits: ["withdrawn", "soft-spoken", "poor-eye-contact"],
    conditionHint: "psychiatric",
    locales: ["tr", "en"],
  },
  {
    id: "p3-amani-haddad",
    name: { en: "Amani Haddad", tr: "Amani Haddad" },
    age: 29,
    sexAtBirth: "female",
    genderPresentation: "femme",
    appearance: {
      skinTone: 4,
      hairStyle: "long",
      hairColor: "black",
      facialHair: "none",
      glasses: false,
      headwear: "hijab",
      build: "average",
    },
    baselineAffect: "anxious",
    personaTraits: ["non-native-speaker", "pregnant", "low-health-literacy"],
    conditionHint: "pregnancy",
    locales: ["tr"],
  },
  {
    id: "p3-hakim-nazari",
    name: { en: "Hakim Nazari", tr: "Hakim Nazari" },
    age: 68,
    sexAtBirth: "male",
    genderPresentation: "masc",
    appearance: {
      skinTone: 4,
      hairStyle: "short",
      hairColor: "gray",
      facialHair: "beard",
      glasses: true,
      headwear: "cap",
      build: "slim",
    },
    baselineAffect: "stoic",
    personaTraits: ["non-native-speaker", "hard-of-hearing", "elderly-frail"],
    conditionHint: "chest-pain",
    locales: ["tr"],
  },
  {
    id: "p3-oksana-kovalenko",
    name: { en: "Oksana Kovalenko", tr: "Oksana Kovalenko" },
    age: 34,
    sexAtBirth: "female",
    genderPresentation: "femme",
    appearance: {
      skinTone: 1,
      hairStyle: "medium",
      hairColor: "blonde",
      facialHair: "none",
      glasses: false,
      headwear: "none",
      build: "average",
    },
    baselineAffect: "anxious",
    personaTraits: ["non-native-speaker", "talkative", "photophobic"],
    conditionHint: "headache",
    locales: ["en"],
  },
];

/* -------------------------------------------------------------------------- */
/* Helpers                                                                      */
/* -------------------------------------------------------------------------- */

const PROFILE_BY_ID: Map<string, PatientProfile> = new Map(
  PATIENT_PROFILES.map((p) => [p.id, p]),
);

/** Look up a profile by id. */
export function getProfile(id: string): PatientProfile | undefined {
  return PROFILE_BY_ID.get(id);
}

/**
 * Deterministic 32-bit hash (FNV-1a) of a string or number seed. Stable across
 * runs so a case always renders the same face.
 */
export function hashSeed(seed: string | number): number {
  const s = String(seed);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Chief-complaint families that read equally well for the same persona, so a
 * case whose hint is not represented can still borrow a close-enough face.
 */
const HINT_FALLBACK: Record<string, string> = {
  palpitations: "chest-pain",
  syncope: "chest-pain",
  dizziness: "neuro-deficit",
  confusion: "neuro-deficit",
  "shortness-of-breath": "dyspnea",
  breathlessness: "dyspnea",
  abdomen: "abdominal-pain",
};

/**
 * Pick a profile for a case. Prefers profiles whose `conditionHint` matches
 * (then a related family), and falls back to the whole library. The seed makes
 * the choice deterministic — the same case id always yields the same patient.
 *
 * @param conditionHint chief-complaint family, e.g. "chest-pain"
 * @param seed          any stable value (case id / numeric seed / name)
 */
export function pickProfileForCase(
  conditionHint: string,
  seed: string | number,
): PatientProfile {
  const hint = (conditionHint || "").trim().toLowerCase();

  let pool = PATIENT_PROFILES.filter((p) => p.conditionHint === hint);
  if (pool.length === 0 && HINT_FALLBACK[hint]) {
    pool = PATIENT_PROFILES.filter((p) => p.conditionHint === HINT_FALLBACK[hint]);
  }
  if (pool.length === 0) pool = PATIENT_PROFILES;

  const idx = hashSeed(`${hint}:${seed}`) % pool.length;
  return pool[idx];
}

/** Pick any profile deterministically from a seed (no condition constraint). */
export function pickProfile(seed: string | number): PatientProfile {
  return PATIENT_PROFILES[hashSeed(seed) % PATIENT_PROFILES.length];
}
