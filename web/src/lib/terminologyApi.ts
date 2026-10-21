/**
 * Typed client for the terminology routes (server/terminology/routes.py):
 * ICD-10-CM FY2027 search over every code with the official alphabetic-index
 * phrases as synonyms, and ICD-11 MMS 2026-01 search with WHO URIs.
 *
 * Never throws: every call answers a BackendResult. The diagnosis picker merges
 * these hits into its local catalogue search when the gateway is reachable.
 */

import { BACKEND_URL, type BackendResult, type RequestOptions } from "@/lib/backend";

export interface Icd10cmHit {
  system: "icd10cm";
  code: string;
  title: string;
  billable: boolean;
  /** The alphabetic-index phrase that matched when the title did not. */
  matched_term: string | null;
  score: number;
}

export interface Icd10cmSearch {
  available: boolean;
  release: string | null;
  query?: string;
  results: Icd10cmHit[];
}

export interface Icd10Relation {
  committed: string;
  target: string;
  relation: "exact" | "more_specific" | "less_specific" | "same_category" | "same_block" | "unrelated";
  credit: boolean;
}

async function get<T>(path: string, opts: RequestOptions, timeoutMs: number): Promise<BackendResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? timeoutMs);
  const external = opts.signal;
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", () => controller.abort(), { once: true });
  }
  try {
    const res = await fetch(`${BACKEND_URL}${path}`, { headers: { accept: "application/json" }, signal: controller.signal });
    if (!res.ok) return { ok: false, error: `http_${res.status}`, status: res.status };
    return { ok: true, data: (await res.json()) as T };
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    return { ok: false, error: name === "AbortError" ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}

/** Search ICD-10-CM by code prefix ("I21", "i21.0") or words ("heart attack"). */
export function searchIcd10cm(q: string, limit = 25, opts: RequestOptions = {}): Promise<BackendResult<Icd10cmSearch>> {
  const params = new URLSearchParams({ q, limit: String(limit) });
  return get<Icd10cmSearch>(`/v1/terminology/icd10cm/search?${params.toString()}`, opts, 6_000);
}

/** How a committed ICD-10-CM code relates to the case's code (debrief scoring). */
export function relateIcd10(committed: string, target: string, opts: RequestOptions = {}): Promise<BackendResult<Icd10Relation>> {
  const params = new URLSearchParams({ committed, target });
  return get<Icd10Relation>(`/v1/terminology/icd10cm/relate?${params.toString()}`, opts, 6_000);
}
