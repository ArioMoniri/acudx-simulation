/**
 * openMedicalImages: resolve a REAL, openly-licensed representative image for
 * a study from the curated bundle only.
 *
 * History: this module used to run a free-text search against the Wikimedia
 * Commons API at runtime. The results and imaging engine audit
 * (docs/architecture/14, section 1) found that such a search can return a
 * wrong image for the condition or the wrong side, so the runtime path now has
 * two sources and no live search:
 *
 *   1. In Live mode the server engine selects the image to match the structured
 *      finding and laterality and returns full provenance (resultsApi,
 *      `report.image` + `report.provenance`), rendered by StudyViewer.
 *   2. Offline (and for authored studies without an engine answer) this module
 *      returns a curated, individually verified bundle entry
 *      (src/data/conditionImaging.ts) or null. Every bundle entry carries the
 *      author, licence and source page needed for attribution.
 *
 * Contract: pure and synchronous. Never fetches, never throws, never returns an
 * image for a query the bundle does not cover.
 */

import { resolveCuratedImagingByText } from "@/data/conditionImaging";

export interface ConditionImage {
  /** Image URL (a bundled asset under /imaging). */
  url: string;
  /** Same as `url` for bundled assets (kept for the viewer's prop contract). */
  thumbUrl: string;
  /** Human-readable title (the curated teaching caption). */
  title: string;
  /** Author / uploader as credited on the source page. */
  attribution: string;
  /** Short licence name, e.g. "CC BY 4.0" / "CC0" / "Public domain". */
  license: string;
  /** The canonical source + licence page. */
  pageUrl: string;
}

/** A resolved study image, always from the curated bundle. */
export interface ResolvedConditionImage extends ConditionImage {
  /** Always true: only verified bundle entries are served. */
  curated: true;
  /** Curated teaching caption (already resolved to `lang`). */
  curatedCaption: string;
}

/**
 * resolveStudyImage: the single entry point the offline viewer uses. Returns
 * the curated, individually verified image for this condition + modality, or
 * null when the bundle has nothing that genuinely depicts the study. A null is
 * rendered as "no representative image" with the structured report standing
 * alone; nothing is guessed.
 *
 * @param query    Free-text finding (+ optional modality), as ConditionImage receives it.
 * @param modality Short modality label, e.g. "ECG" / "CT" / "X-ray".
 * @param lang     Active language for the curated caption.
 */
export function resolveStudyImage(
  query: string,
  modality: string | undefined,
  lang: "en" | "tr",
): ResolvedConditionImage | null {
  const curated = resolveCuratedImagingByText(query, modality);
  if (!curated) return null;
  const caption = curated.caption[lang];
  return {
    url: curated.src,
    thumbUrl: curated.src,
    title: caption,
    attribution: curated.attribution.author,
    license: curated.attribution.license,
    pageUrl: curated.attribution.sourceUrl,
    curated: true,
    curatedCaption: caption,
  };
}
