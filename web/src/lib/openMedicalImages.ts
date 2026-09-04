/**
 * openMedicalImages — fetch a REAL, openly-licensed representative image for a
 * clinical condition from Wikimedia Commons.
 *
 * Why Commons: it is an open, freely-licensed media repository whose API sends
 * permissive CORS headers (`origin=*`), so the browser can query it directly
 * even though the pod backend is air-gapped. Every result carries machine-
 * readable license + author metadata, which we surface so the UI can always
 * attribute the work and label it as a *representative* image — never a picture
 * of the actual simulated patient.
 *
 * Contract:
 *   - Never throws. Network failure / offline / abort / parse error -> null.
 *   - Successful lookups (including a genuine "nothing found") are memoised in
 *     process so re-mounts don't re-hit the network; transient errors are NOT
 *     cached, so a later retry can still succeed.
 *   - All human-facing strings (attribution, description) are stripped of the
 *     HTML that Commons embeds in its metadata.
 */

const COMMONS_ENDPOINT = "https://commons.wikimedia.org/w/api.php";
const THUMB_WIDTH = 1024;
const REQUEST_TIMEOUT_MS = 8000;

export interface ConditionImage {
  /** Full-resolution original file URL. */
  url: string;
  /** Scaled thumbnail (~1024px wide) suitable for inline display. */
  thumbUrl: string;
  /** Human-readable file title (e.g. "Chest X-ray of pneumothorax"). */
  title: string;
  /** Author / uploader, HTML stripped. Falls back to a neutral label. */
  attribution: string;
  /** Short license name, e.g. "CC BY 4.0" / "CC0". */
  license: string;
  /** Commons file-description page — the canonical source + license page. */
  pageUrl: string;
}

/* -------------------------------------------------------------------------- */
/* Commons API response shapes (only the fields we read)                       */
/* -------------------------------------------------------------------------- */

interface ExtMetaValue {
  value?: string;
}
type ExtMetadata = Record<string, ExtMetaValue | undefined>;

interface CommonsImageInfo {
  url?: string;
  thumburl?: string;
  descriptionurl?: string;
  extmetadata?: ExtMetadata;
}

interface CommonsPage {
  title?: string;
  index?: number;
  imageinfo?: CommonsImageInfo[];
}

interface CommonsResponse {
  query?: { pages?: Record<string, CommonsPage> };
}

/* -------------------------------------------------------------------------- */
/* Curated fallback — a few seed conditions mapped to a KNOWN Commons file so   */
/* the demo always shows something even when free-text search is flaky. These   */
/* are still fetched live (for fresh license metadata) and attributed like any  */
/* other result. Titles verified to exist on Commons.                           */
/* -------------------------------------------------------------------------- */

const CURATED_FALLBACKS: ReadonlyArray<readonly [terms: string[], title: string]> = [
  [["pneumonia", "pnomoni", "zatürre", "zaturre"], "File:Chest radiograph in influensa and H influenzae, posteroanterior.jpg"],
  [["pneumothorax", "pnömotoraks", "pnomotoraks"], "File:Chest X-ray of pneumothorax.png"],
  [["myocardial", "infarction", "stemi", "mi ", "miyokard", "enfarkt"], "File:ST elevation myocardial infarction ECG (cropped).jpg"],
  [["appendicitis", "apandisit"], "File:Subhepatische Appendicitis 45M - CT coronar - 001.jpg"],
  [["stroke", "cva", "inme", "ischemic", "iskemik"], "File:Brain CT Scan for Stroke Diagnosis.jpg"],
  [["fracture", "kırık", "kirik"], "File:Radiograph of Barton's fracture.jpg"],
];

/* -------------------------------------------------------------------------- */
/* In-process cache                                                            */
/* -------------------------------------------------------------------------- */

const cache = new Map<string, ConditionImage | null>();

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** Strip HTML tags + decode the handful of entities Commons emits, collapse ws. */
function stripHtml(raw: string | undefined): string {
  if (!raw) return "";
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&#x0*27;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function meta(ext: ExtMetadata | undefined, key: string): string {
  return stripHtml(ext?.[key]?.value);
}

function fileTitleToName(title: string): string {
  return title.replace(/^File:/i, "").replace(/\.[a-z0-9]+$/i, "").trim();
}

/** Words that mark a result as a genuine clinical image worth preferring. */
const MEDICAL_TERMS = [
  "radiograph",
  "x-ray",
  "xray",
  "chest",
  "ct ",
  "ct scan",
  "mri",
  "ultrasound",
  "ecg",
  "ekg",
  "scan",
  "radiology",
  "histopath",
  "pathology",
  "medical",
  "clinical",
  "lesion",
];

/** Words that mark a result as a schematic / brand asset to avoid. */
const AVOID_TERMS = ["logo", "icon", "diagram", "illustration", "chart", "map", "flag", "symbol", "clipart"];

function scoreResult(page: CommonsPage, queryTokens: string[]): number {
  const info = page.imageinfo?.[0];
  if (!info || !(info.thumburl || info.url)) return -Infinity;

  const title = (page.title ?? "").toLowerCase();
  const desc = meta(info.extmetadata, "ImageDescription").toLowerCase();
  const categories = meta(info.extmetadata, "Categories").toLowerCase();
  const haystack = `${title} ${desc} ${categories}`;

  // Search rank: earlier results are more relevant (index ascending).
  let score = 100 - (page.index ?? 50);

  for (const token of queryTokens) {
    if (token.length < 3) continue;
    if (title.includes(token)) score += 12;
    else if (haystack.includes(token)) score += 5;
  }
  for (const term of MEDICAL_TERMS) if (haystack.includes(term)) score += 4;
  for (const term of AVOID_TERMS) if (haystack.includes(term)) score -= 18;

  // Prefer real photographs / radiographs over vector schematics.
  if (/\.svg$/i.test(title)) score -= 25;

  return score;
}

function toConditionImage(page: CommonsPage): ConditionImage | null {
  const info = page.imageinfo?.[0];
  const thumb = info?.thumburl;
  const full = info?.url;
  const src = thumb ?? full;
  if (!info || !src) return null;

  const title = fileTitleToName(page.title ?? "");
  const ext = info.extmetadata;
  const attribution =
    meta(ext, "Artist") || meta(ext, "Credit") || "Wikimedia Commons contributor";
  const license = meta(ext, "LicenseShortName") || "See source";
  const pageUrl =
    info.descriptionurl ??
    `https://commons.wikimedia.org/wiki/${encodeURI((page.title ?? "").replace(/ /g, "_"))}`;

  return {
    url: full ?? src,
    thumbUrl: src,
    title,
    attribution,
    license,
    pageUrl,
  };
}

/** Fetch + parse JSON from Commons with an abort-linked timeout. Throws on failure. */
async function fetchCommons(
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<CommonsResponse> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const url = `${COMMONS_ENDPOINT}?${new URLSearchParams({
      format: "json",
      origin: "*",
      ...params,
    }).toString()}`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Commons responded ${res.status}`);
    return (await res.json()) as CommonsResponse;
  } finally {
    clearTimeout(timeout);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

function bestOf(data: CommonsResponse, queryTokens: string[]): ConditionImage | null {
  const pages = data.query?.pages;
  if (!pages) return null;
  let best: CommonsPage | null = null;
  let bestScore = -Infinity;
  for (const page of Object.values(pages)) {
    const score = scoreResult(page, queryTokens);
    if (score > bestScore) {
      bestScore = score;
      best = page;
    }
  }
  if (!best || bestScore === -Infinity) return null;
  return toConditionImage(best);
}

async function searchByGenerator(query: string, signal?: AbortSignal): Promise<ConditionImage | null> {
  const data = await fetchCommons(
    {
      action: "query",
      generator: "search",
      gsrsearch: `${query} filetype:bitmap`,
      gsrnamespace: "6",
      gsrlimit: "8",
      prop: "imageinfo",
      iiprop: "url|extmetadata",
      iiurlwidth: String(THUMB_WIDTH),
    },
    signal,
  );
  return bestOf(data, normalizeQuery(query).split(" "));
}

async function fetchByTitle(title: string, signal?: AbortSignal): Promise<ConditionImage | null> {
  const data = await fetchCommons(
    {
      action: "query",
      titles: title,
      prop: "imageinfo",
      iiprop: "url|extmetadata",
      iiurlwidth: String(THUMB_WIDTH),
    },
    signal,
  );
  const pages = data.query?.pages;
  if (!pages) return null;
  const page = Object.values(pages)[0];
  return page ? toConditionImage(page) : null;
}

function curatedTitleFor(normalized: string): string | null {
  for (const [terms, title] of CURATED_FALLBACKS) {
    if (terms.some((term) => normalized.includes(term.trim()))) return title;
  }
  return null;
}

/**
 * searchConditionImage — resolve the best openly-licensed representative image
 * for `query`, or `null` when nothing suitable is found / the request fails.
 *
 * @param query  Free-text condition + optional modality, e.g. "pneumonia chest x-ray".
 * @param signal Optional AbortSignal to cancel an in-flight lookup.
 */
export async function searchConditionImage(
  query: string,
  signal?: AbortSignal,
): Promise<ConditionImage | null> {
  const key = normalizeQuery(query);
  if (!key) return null;
  if (cache.has(key)) return cache.get(key) ?? null;

  try {
    let result = await searchByGenerator(query, signal);
    if (!result) {
      const title = curatedTitleFor(key);
      if (title) result = await fetchByTitle(title, signal);
    }
    // Cache genuine outcomes (image or definitive "nothing found") only.
    cache.set(key, result);
    return result;
  } catch {
    // Offline / aborted / parse error — transient, so leave the cache untouched
    // to allow a later retry, and fail soft.
    return null;
  }
}

/** Clear the in-process cache. Exposed mainly for tests. */
export function __clearConditionImageCache(): void {
  cache.clear();
}
