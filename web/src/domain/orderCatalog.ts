/**
 * AcuDx — per-test order timing ("sense of time").
 *
 * Real diagnostics do not all come back at once: a point-of-care glucose is
 * near-instant, a routine chemistry runs 15–30 min, a CT takes the better part
 * of an hour, and a blood culture is not final for a day or two. This module
 * gives every order a test-specific turnaround so the simulated encounter keeps
 * a believable ordering of results (docs/00-overview/04 — sense of time).
 *
 * Per order:
 *   - `turnaroundMs` / `preliminaryMs` — the realistic order-to-report time in
 *     SIM time, from the server catalogue (server/results/catalog.py TURNAROUND,
 *     each figure sourced or labelled a teaching convention). The encounter
 *     store schedules results on the sim clock with it (review 2026-10-21).
 *   - `clinicalLabel` — the same turnaround as the learner reads it.
 *   - `playbackMs` — a compressed wall-clock delay kept only for the
 *     multiplayer room board, preserving the relative ordering.
 *
 * Pure + deterministic: no Date.now, no Math.random. Category is inferred from
 * the order code and its bilingual label using EN + TR keyword heuristics, with
 * the ServiceRequestKind as a fallback when nothing recognisable is present.
 *
 * Education only. No real patient data path.
 */

import type { Bilingual } from "@/data/schema";
import type { ServiceRequestKind } from "@/domain/fhir";
import { catalogTurnaround, formatSimMinutes } from "@/domain/serverCatalog";

/** Broad turnaround class an order falls into. */
export type OrderCategory =
  | "poc"
  | "lab"
  | "coag"
  | "cardiac"
  | "micro-culture"
  | "imaging-xr"
  | "imaging-ct"
  | "imaging-us"
  | "imaging-mri"
  | "other";

export interface OrderTiming {
  /** Compressed wall-clock delay, kept for the multiplayer room board only. */
  playbackMs: number;
  /**
   * Review 2026-10-21: the realistic order-to-report time in SIM ms (stat
   * chemistry about 50 min, cultures 2 to 5 days, CT about 4 h). The encounter
   * store schedules results on the sim clock with this, so a result is pending
   * until the sim clock reaches it (the learner can advance time).
   */
  turnaroundMs: number;
  /** Preliminary report in sim ms (cultures, CT, ultrasound), or null. */
  preliminaryMs: number | null;
  /** Realistic clinical turnaround shown to the learner (bilingual). */
  clinicalLabel: Bilingual;
  category: OrderCategory;
}

/** Sim minutes per category when a code is not in the server catalogue (server/results/catalog.py). */
const CATEGORY_SIM_MINUTES: Record<OrderCategory, number> = {
  poc: 5,
  lab: 50,
  coag: 55,
  cardiac: 60,
  "imaging-xr": 60,
  "imaging-us": 165,
  "imaging-ct": 250,
  "imaging-mri": 370,
  "micro-culture": 2880,
  other: 50,
};

function simLabel(minutes: number, preliminary: number | null): Bilingual {
  const en = formatSimMinutes(minutes, "en");
  const tr = formatSimMinutes(minutes, "tr");
  if (preliminary) {
    return {
      en: `prelim ${formatSimMinutes(preliminary, "en")}, final ${en}`,
      tr: `ön rapor ${formatSimMinutes(preliminary, "tr")}, kesin ${tr}`,
    };
  }
  return { en: `~${en}`, tr: `~${tr}` };
}

/* -------------------------------------------------------------------------- */
/* Per-category timing table                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Playback is compressed real ms; the relative ordering is what matters for the
 * "sense of time" (poc < lab < coag ≈ xr < us < cardiac < ct < mri ≪ culture).
 * clinicalLabel is the realistic turnaround a clinician would quote.
 */
const CATEGORY_META: Record<OrderCategory, { playbackMs: number; clinicalLabel: Bilingual }> = {
  poc: { playbackMs: 6_000, clinicalLabel: { en: "~5 min", tr: "~5 dk" } },
  lab: { playbackMs: 18_000, clinicalLabel: { en: "~15–30 min", tr: "~15–30 dk" } },
  coag: { playbackMs: 24_000, clinicalLabel: { en: "~30–45 min", tr: "~30–45 dk" } },
  cardiac: { playbackMs: 30_000, clinicalLabel: { en: "~30 min (serial)", tr: "~30 dk (seri)" } },
  "imaging-xr": { playbackMs: 24_000, clinicalLabel: { en: "~20 min", tr: "~20 dk" } },
  "imaging-us": { playbackMs: 28_000, clinicalLabel: { en: "~30 min", tr: "~30 dk" } },
  "imaging-ct": { playbackMs: 48_000, clinicalLabel: { en: "~45 min", tr: "~45 dk" } },
  "imaging-mri": { playbackMs: 62_000, clinicalLabel: { en: "~60 min", tr: "~60 dk" } },
  "micro-culture": { playbackMs: 180_000, clinicalLabel: { en: "36–48 h", tr: "36–48 sa" } },
  other: { playbackMs: 20_000, clinicalLabel: { en: "~20 min", tr: "~20 dk" } },
};

/* -------------------------------------------------------------------------- */
/* Keyword detection (EN + TR, case-insensitive)                              */
/* -------------------------------------------------------------------------- */

/** Substring test on the normalised haystack. */
function has(hay: string, kw: string): boolean {
  return hay.includes(kw);
}

/**
 * Whole-token test: `token` is bounded by a non-alphanumeric char (or the
 * string ends). Essential for short/ambiguous tokens like "ct", "us", "mr" so
 * they do not match inside longer words (e.g. "us" inside "status", "ct" inside
 * "lactate"). ASCII tokens only.
 */
function wb(hay: string, token: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${token}([^a-z0-9]|$)`).test(hay);
}

/**
 * Infer the turnaround category from an order code + optional bilingual label.
 * Priority order resolves overlaps (culture before its "blood/urine" wording,
 * coags before generic labs, distinctive lab tokens before short imaging
 * tokens). Returns null when nothing recognisable is present.
 */
function detectCategory(code: string, label?: Bilingual): OrderCategory | null {
  const hay = [code, label?.en, label?.tr].filter(Boolean).join(" ").toLowerCase();

  // 1. Microbiology cultures — the "much later" bucket.
  if (has(hay, "culture") || has(hay, "kültür") || has(hay, "kultur")) return "micro-culture";

  // 2. Cardiac markers (troponin) — serial, ~30 min.
  if (has(hay, "troponin") || wb(hay, "trop")) return "cardiac";

  // 3. Coagulation studies.
  if (has(hay, "coag") || wb(hay, "inr") || has(hay, "ptt") || has(hay, "dimer") || has(hay, "pihtila"))
    return "coag";

  // 4. Routine chemistry / haematology / urinalysis.
  if (
    wb(hay, "cbc") ||
    has(hay, "hemogram") ||
    has(hay, "kan sayımı") ||
    has(hay, "kan sayimi") ||
    wb(hay, "bmp") ||
    wb(hay, "cmp") ||
    has(hay, "electrolyte") ||
    has(hay, "elektrolit") ||
    wb(hay, "lft") ||
    has(hay, "liver function") ||
    has(hay, "lactate") ||
    has(hay, "laktat") ||
    has(hay, "urinalysis") ||
    has(hay, "idrar") ||
    wb(hay, "ua") ||
    wb(hay, "wbc") ||
    wb(hay, "crp") ||
    has(hay, "creatinine") ||
    has(hay, "malaria") ||
    has(hay, "sıtma") ||
    has(hay, "kreatinin") ||
    wb(hay, "bun")
  )
    return "lab";

  // 5. Plain radiography.
  if (
    has(hay, "xray") ||
    has(hay, "x-ray") ||
    has(hay, "x ray") ||
    has(hay, "röntgen") ||
    has(hay, "rontgen") ||
    wb(hay, "cxr") ||
    wb(hay, "kxr") ||
    has(hay, "chest radiograph") ||
    has(hay, "akciğer grafisi") ||
    has(hay, "akciger grafisi")
  )
    return "imaging-xr";

  // 6. Computed tomography (EN "ct" / TR "bt").
  if (wb(hay, "ct") || wb(hay, "bt") || has(hay, "tomography") || has(hay, "tomografi"))
    return "imaging-ct";

  // 7. Magnetic resonance.
  if (has(hay, "mri") || wb(hay, "mr") || has(hay, "manyetik rezonans") || has(hay, "magnetic resonance"))
    return "imaging-mri";

  // 8. Ultrasound (EN "us"/"ultrasound" / TR "ultrason"/"usg").
  if (has(hay, "ultrasound") || has(hay, "ultrason") || has(hay, "usg") || has(hay, "doppler") || wb(hay, "us"))
    return "imaging-us";

  // 9. Point-of-care / bedside tests.
  if (
    has(hay, "glucose") ||
    has(hay, "glukoz") ||
    has(hay, "kan şekeri") ||
    has(hay, "kan sekeri") ||
    has(hay, "parmak ucu") ||
    has(hay, "istat") ||
    has(hay, "i-stat") ||
    wb(hay, "vbg") ||
    wb(hay, "abg") ||
    has(hay, "kan gazı") ||
    has(hay, "kan gazi") ||
    wb(hay, "ecg") ||
    wb(hay, "ekg") ||
    wb(hay, "poc") ||
    has(hay, "point of care") ||
    has(hay, "point-of-care") ||
    has(hay, "bedside")
  )
    return "poc";

  return null;
}

/** Fallback when the label/code carries no recognisable modality keyword. */
function kindFallback(kind: ServiceRequestKind): OrderCategory {
  if (kind === "imaging") return "imaging-xr";
  if (kind === "laboratory") return "lab";
  return "other";
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Resolve the timing for an order. Keyword detection first, then the
 * ServiceRequestKind as a fallback. Pure + deterministic.
 */
export function orderTiming(
  code: string,
  kind: ServiceRequestKind,
  label?: Bilingual,
): OrderTiming {
  const category = detectCategory(code, label) ?? kindFallback(kind);
  const meta = CATEGORY_META[category];
  const fromCatalog = catalogTurnaround(code);
  const minutes = fromCatalog?.minutes ?? CATEGORY_SIM_MINUTES[category];
  const preliminary = fromCatalog ? fromCatalog.preliminaryMinutes : category === "micro-culture" ? 1440 : null;
  return {
    playbackMs: meta.playbackMs,
    turnaroundMs: minutes * 60_000,
    preliminaryMs: preliminary ? preliminary * 60_000 : null,
    clinicalLabel: simLabel(minutes, preliminary),
    category,
  };
}

/** The clinical label for an engine turnaround (minutes plus optional preliminary minutes). */
export function simTurnaroundLabel(minutes: number, preliminaryMinutes?: number | null): Bilingual {
  return simLabel(minutes, preliminaryMinutes ?? null);
}

/* -------------------------------------------------------------------------- */
/* Serial / repeat ordering                                                    */
/* -------------------------------------------------------------------------- */

/** Whether an order is sensibly repeated over time, plus the realistic cadence. */
export interface SerialInfo {
  /** True for tests a clinician trends serially (troponin, lactate, gas, POC). */
  repeatable: boolean;
  /** Realistic repeat cadence to hint at (bilingual), or null when not serial. */
  cadence: Bilingual | null;
}

/**
 * Categories whose result meaningfully trends when re-ordered — cardiac markers
 * (serial troponin), routine chemistry / lactate (repeat bloods), blood gases +
 * bedside tests (recheck after intervention), and coagulation. Imaging and
 * cultures are deliberately NOT flagged repeatable (re-scanning / re-culturing
 * is not a routine trend and only inflates over-ordering).
 */
const SERIAL_CADENCE: Partial<Record<OrderCategory, Bilingual>> = {
  cardiac: { en: "repeat 0 / 1 / 3 h", tr: "tekrar 0 / 1 / 3 sa" },
  lab: { en: "serial as indicated", tr: "gerektikçe seri" },
  poc: { en: "recheck as needed", tr: "gerektikçe tekrarla" },
  coag: { en: "repeat q6–12 h", tr: "tekrar 6–12 sa" },
};

/**
 * Resolve whether an order supports serial re-ordering and its realistic
 * cadence, from the same keyword/kind detection that drives turnaround.
 */
export function serialInfo(
  code: string,
  kind: ServiceRequestKind,
  label?: Bilingual,
): SerialInfo {
  const category = detectCategory(code, label) ?? kindFallback(kind);
  const cadence = SERIAL_CADENCE[category] ?? null;
  return { repeatable: cadence != null, cadence };
}
