/**
 * studyMedia — richer, real, open-licensed renderings for a resulted imaging
 * study, beyond the single representative still.
 *
 *   - **cine**  — a looping clip for an inherently DYNAMIC study. A still
 *     misrepresents an echocardiogram (the heart moves); a beating-heart loop
 *     is the honest representation.
 *   - **stack** — a scrollable multi-slice series (a PACS-style "DICOM stack")
 *     for a cross-sectional study. Built from the SAME real, expert-segmented
 *     CT the anatomy atlas uses (TotalSegmentator, CC-BY-4.0), so an abdominal
 *     CT reads as a genuine scrollable cross-section series with window presets.
 *
 * Everything is REAL, curated, open-licensed data with provenance — never
 * generated (generated CT/MRI/echo invent anatomy). When neither a cine nor a
 * stack fits, the caller falls back to the representative still (ConditionImage).
 */

import { ATLAS_SLICES, atlasImageUrl } from "@/data/anatomyAtlas";

export interface StudyAttribution {
  author: string;
  license: string;
  sourceUrl: string;
}

/** A looping clip (GIF/video) for a dynamic study. */
export interface CineMedia {
  kind: "cine";
  src: string;
  caption: { en: string; tr: string };
  attribution: StudyAttribution;
}

/** One selectable window (e.g. soft-tissue vs bone) of a scrollable series. */
export interface StackWindow {
  key: string;
  label: { en: string; tr: string };
  /** Ordered slice image URLs, superior → inferior. */
  frames: string[];
}

/** A scrollable multi-slice cross-section series. */
export interface StackMedia {
  kind: "stack";
  plane: { en: string; tr: string };
  windows: StackWindow[];
  caption: { en: string; tr: string };
  attribution: StudyAttribution;
  /** True → offer an "open in the anatomy atlas" affordance (same source data). */
  atlasLinked?: boolean;
}

export type StudyMedia = CineMedia | StackMedia;

const base = import.meta.env.BASE_URL;

/* -------------------------------------------------------------------------- */
/* Cine — echocardiogram (apical 4-chamber loop)                               */
/* -------------------------------------------------------------------------- */

const ECHO_CINE: CineMedia = {
  kind: "cine",
  src: `${base}imaging/echo-cine.gif`,
  caption: {
    en: "Transthoracic echocardiogram — apical 4-chamber cine loop (representative)",
    tr: "Transtorasik ekokardiyogram — apikal 4 boşluk sine döngüsü (temsili)",
  },
  attribution: {
    author: "Kjetil Lenes",
    license: "CC BY-SA 3.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Apikal4D.gif",
  },
};

/* -------------------------------------------------------------------------- */
/* Stack — abdominal CT (real segmented series, abdomen + bone windows)        */
/* -------------------------------------------------------------------------- */

/** Build the axial abdominal-CT stack once from the bundled atlas slices. */
function buildAbdomenCtStack(): StackMedia | null {
  const axial = ATLAS_SLICES.filter((s) => s.plane === "axial").sort((a, b) => a.index - b.index);
  if (axial.length < 2) return null;
  const window = (preset: string): string[] =>
    axial.map((s) => atlasImageUrl(s.src[preset])).filter(Boolean);
  const soft = window("abdomen");
  const bone = window("bone");
  if (soft.length < 2) return null;
  const windows: StackWindow[] = [
    { key: "abdomen", label: { en: "Soft tissue", tr: "Yumuşak doku" }, frames: soft },
  ];
  if (bone.length === soft.length) {
    windows.push({ key: "bone", label: { en: "Bone", tr: "Kemik" }, frames: bone });
  }
  return {
    kind: "stack",
    plane: { en: "Axial", tr: "Aksiyel" },
    windows,
    caption: {
      en: "Axial abdominal CT — scrollable series, no acute abnormality (representative)",
      tr: "Aksiyel abdominal BT — kaydırılabilir seri, akut anormallik yok (temsili)",
    },
    attribution: {
      author: "Wasserthal et al. (TotalSegmentator)",
      license: "CC BY 4.0",
      sourceUrl: "https://doi.org/10.5281/zenodo.6802613",
    },
    atlasLinked: true,
  };
}

let ABDOMEN_CT: StackMedia | null | undefined;
function abdomenCtStack(): StackMedia | null {
  if (ABDOMEN_CT === undefined) ABDOMEN_CT = buildAbdomenCtStack();
  return ABDOMEN_CT;
}

/* -------------------------------------------------------------------------- */
/* Resolution                                                                  */
/* -------------------------------------------------------------------------- */

const ECHO_RE = /echocardiogram|echocardiography|\becho\b|\btte\b|pocus/;
const CT_ABDOMEN_RE = /abdom|pelvi|\bkub\b|renal colic|ureter|appendic|bowel|obstruction|liver|biliary|aort|kidney/;

/**
 * Resolve a richer rendering (cine / scrollable stack) for a resulted study, or
 * `null` when the representative still is the right presentation.
 *
 * @param query    Free-text study/finding (as ConditionImage receives it).
 * @param modality Short modality label ("US" / "CT" / "MRI" / "ECG" / "X-ray").
 */
export function resolveStudyMedia(query: string, modality?: string): StudyMedia | null {
  const q = (query ?? "").toLowerCase();
  const m = (modality ?? "").toLowerCase();

  // Echocardiogram → a beating-heart cine (echo classifies to the "US" label).
  if (ECHO_RE.test(q)) return ECHO_CINE;

  // Abdominal / pelvic CT → a real, scrollable cross-section series.
  if (m === "ct" && CT_ABDOMEN_RE.test(q)) return abdomenCtStack();

  return null;
}
