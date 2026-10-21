/**
 * The server order catalogue, shipped to the browser as generated JSON.
 *
 * Source of truth: server/results/lab_catalog.json, imaging_catalog.json and the
 * TURNAROUND table in server/results/catalog.py. `scripts/terminology/build_terminology.py web`
 * writes ./generated/orderCatalog.generated.json and the CI check fails when it is
 * out of date, so the order-entry list can never offer a test the results engine
 * cannot answer. Every LOINC code was verified against LOINC 2.82.
 */

import raw from "./generated/orderCatalog.generated.json";

export interface CatalogLab {
  code: string;
  loinc: string | null;
  label_en: string;
  label_tr: string;
  section: string;
  specimen: string;
  members: string[];
  turnaround: string;
  generator: string;
  synonyms: string[];
  turnaround_minutes: number;
  preliminary_minutes: number | null;
}

export interface CatalogImaging {
  code: string;
  loinc: string | null;
  label_en: string;
  label_tr: string;
  modality: string;
  region: string;
  playbook: { modality: string; body_part: string; contrast: string };
  laterality_required: boolean;
  turnaround: string;
  synonyms: string[];
  turnaround_minutes: number;
  preliminary_minutes: number | null;
}

export interface CatalogTurnaround {
  minutes: number;
  preliminary_minutes?: number | null;
  basis: "measured" | "guideline" | "convention";
  source: string;
}

interface ServerCatalog {
  schema_version: number;
  reviewed_at: string;
  sections: string[];
  labs: CatalogLab[];
  imaging: CatalogImaging[];
  turnaround: Record<string, CatalogTurnaround>;
}

export const SERVER_CATALOG = raw as unknown as ServerCatalog;

const LAB_BY_CODE = new Map(SERVER_CATALOG.labs.map((l) => [l.code, l]));
const IMAGING_BY_CODE = new Map(SERVER_CATALOG.imaging.map((p) => [p.code, p]));

export function catalogLab(code: string): CatalogLab | undefined {
  return LAB_BY_CODE.get(code);
}

export function catalogImaging(code: string): CatalogImaging | undefined {
  return IMAGING_BY_CODE.get(code);
}

/** Order-to-report minutes and the preliminary minutes for a catalogue code. */
export function catalogTurnaround(code: string): { minutes: number; preliminaryMinutes: number | null } | undefined {
  const hit = LAB_BY_CODE.get(code) ?? IMAGING_BY_CODE.get(code);
  if (!hit) return undefined;
  return { minutes: hit.turnaround_minutes, preliminaryMinutes: hit.preliminary_minutes ?? null };
}

/** A compact duration for sim minutes: "45 min", "4 h", "2 d". */
export function formatSimMinutes(minutes: number, lang: "en" | "tr" = "en"): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 90) return lang === "tr" ? `${m} dk` : `${m} min`;
  if (m < 48 * 60) {
    const h = Math.round((m / 60) * 10) / 10;
    return lang === "tr" ? `${h} sa` : `${h} h`;
  }
  const d = Math.round((m / 1440) * 10) / 10;
  return lang === "tr" ? `${d} gün` : `${d} d`;
}
