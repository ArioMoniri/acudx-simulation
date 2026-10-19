/**
 * AcuDx: typed client for the verified guideline store (server/guidelines/routes.py).
 *
 *   GET /v1/guidelines/statements?condition=&stage=&locale=  -> StatementsResponse
 *   GET /v1/guidelines/statements/{id}?locale=              -> GuidelineStatementPayload
 *   GET /v1/guidelines/tips?condition=&stage=&locale=       -> TipsResponse
 *
 * Every clinical sentence a learner sees must trace to a VERIFIED, versioned
 * GuidelineStatement with a resolving source URL or DOI. This module therefore
 * carries no clinical text of its own: it only maps API payloads to view models
 * and caches them. When the backend is off or a statement is not verified the
 * view models say so ("unavailable") and the UI renders an explicit
 * guidance-unavailable state instead of inventing a hint.
 *
 * Pure mapping functions are exported for unit tests; the React hooks at the
 * bottom wrap them with the live-backend gate and a small in-memory cache.
 */

import { useEffect, useState } from "react";

import { apiGet, type BackendResult } from "@/lib/backend";
import { useLiveBackend } from "@/lib/liveBackend";
import type { Bilingual, Lang } from "@/data/mock"; // watchdog: allow (shared schema hub, type only)

/* -------------------------------------------------------------------------- */
/* API payloads (mirror server/guidelines/store.py learner_view + tips.py)      */
/* -------------------------------------------------------------------------- */

export const TIP_STAGES = [
  "triage",
  "history",
  "exam",
  "workup",
  "treatment",
  "disposition",
] as const;
export type TipStage = (typeof TIP_STAGES)[number];

export interface GuidelineStatementPayload {
  id: string;
  statement: string;
  statement_en: string;
  statement_tr: string;
  source_body: string;
  source_title: string;
  source_url: string;
  doi: string;
  edition_or_version: string;
  published_date: string;
  verified_at: string;
  verification_method: string;
  verification_quote: string;
  license_tag: string;
  scope: { countries?: string[]; specialties?: string[]; [k: string]: unknown };
  condition_codes: string[];
  topic: string;
  status: string;
}

export interface StatementsResponse {
  statements: GuidelineStatementPayload[];
  count: number;
  condition: string | null;
  stage: string | null;
  locale: string;
}

export interface AttendingTipPayload {
  id: string;
  condition_codes: string[];
  stage: TipStage;
  tip_en: string;
  tip_tr: string;
  pitfall_en: string;
  pitfall_tr: string;
  timing_hint: string;
  statement_ids: string[];
}

export interface TipsResponse {
  tips: AttendingTipPayload[];
  statements: Record<string, GuidelineStatementPayload>;
  count: number;
  condition: string | null;
  stage: string | null;
  locale: string;
  stages: TipStage[];
}

/* -------------------------------------------------------------------------- */
/* View models                                                                  */
/* -------------------------------------------------------------------------- */

/** What a citation chip renders: body, title, edition and a resolving link. */
export interface CitationView {
  id: string;
  /** Short chip label, e.g. "NICE NG185", "SSC 2021", "WAO 2020". */
  label: string;
  body: string;
  title: string;
  edition: string;
  /** Resolving deep link (source URL; DOI link when the URL is empty). */
  url: string;
  doi: string;
  publishedDate: string;
  verifiedAt: string;
  /** The exact source passage the verifier located. */
  quote: string;
  licenseTag: string;
}

/** A verified statement resolved for one language, with its citation. */
export interface GuidanceHint {
  id: string;
  stage: TipStage;
  text: Bilingual;
  statementId: string;
  citation: CitationView;
}

export interface AttendingTipView {
  id: string;
  stage: TipStage;
  tip: string;
  pitfall: string;
  timingHint: string;
  /** Verified statements the tip is grounded in (never empty from the API). */
  citations: CitationView[];
}

export type TipsByStage = Record<TipStage, AttendingTipView[]>;

/* -------------------------------------------------------------------------- */
/* Pure mappers                                                                 */
/* -------------------------------------------------------------------------- */

const CODE_IN_TITLE = /\(([A-Z]{1,4}\s?\d{1,4}[A-Za-z]?)\)\s*$/;

/** "NICE NG185" from "... (NG185)"; else "<body> <year>"; else body or id. */
export function citationLabel(p: Pick<GuidelineStatementPayload, "id" | "source_body" | "source_title" | "published_date">): string {
  const body = (p.source_body ?? "").trim();
  const code = CODE_IN_TITLE.exec((p.source_title ?? "").trim())?.[1]?.replace(/\s+/, "");
  if (code) return body ? `${body} ${code}` : code;
  const year = (p.published_date ?? "").slice(0, 4);
  if (body && /^\d{4}$/.test(year)) return `${body} ${year}`;
  return body || p.id;
}

export function toCitationView(p: GuidelineStatementPayload): CitationView {
  const doi = (p.doi ?? "").trim();
  const url = (p.source_url ?? "").trim() || (doi ? `https://doi.org/${doi}` : "");
  return {
    id: p.id,
    label: citationLabel(p),
    body: p.source_body ?? "",
    title: p.source_title ?? "",
    edition: p.edition_or_version ?? "",
    url,
    doi,
    publishedDate: p.published_date ?? "",
    verifiedAt: p.verified_at ?? "",
    quote: p.verification_quote ?? "",
    licenseTag: p.license_tag ?? "",
  };
}

/** Statement text for a language, falling back to English. */
export function statementText(p: GuidelineStatementPayload, lang: Lang): string {
  const tr = (p.statement_tr ?? "").trim();
  if (lang === "tr" && tr) return tr;
  return (p.statement_en ?? p.statement ?? "").trim();
}

export function toGuidanceHint(p: GuidelineStatementPayload, stage: TipStage = "workup"): GuidanceHint {
  return {
    id: `hint-${p.id}`,
    stage,
    text: { en: (p.statement_en ?? p.statement ?? "").trim(), tr: (p.statement_tr ?? "").trim() || (p.statement_en ?? "").trim() },
    statementId: p.id,
    citation: toCitationView(p),
  };
}

/**
 * Map a tips response for one language. A tip is DROPPED when any of its
 * statement ids is missing from the response's verified statements: the API
 * guarantees the join, but the client never renders a tip whose evidence it
 * cannot show.
 */
export function mapTips(res: TipsResponse, lang: Lang): AttendingTipView[] {
  const out: AttendingTipView[] = [];
  for (const t of res.tips ?? []) {
    const statements = (t.statement_ids ?? []).map((id) => res.statements?.[id]);
    if (statements.length === 0 || statements.some((s) => !s || s.status !== "verified")) continue;
    out.push({
      id: t.id,
      stage: t.stage,
      tip: (lang === "tr" && t.tip_tr ? t.tip_tr : t.tip_en).trim(),
      pitfall: (lang === "tr" && t.pitfall_tr ? t.pitfall_tr : t.pitfall_en ?? "").trim(),
      timingHint: (t.timing_hint ?? "").trim(),
      citations: statements.map((s) => toCitationView(s as GuidelineStatementPayload)),
    });
  }
  return out;
}

export function groupTipsByStage(tips: AttendingTipView[]): TipsByStage {
  const groups = Object.fromEntries(TIP_STAGES.map((s) => [s, [] as AttendingTipView[]])) as TipsByStage;
  for (const t of tips) {
    if (t.stage in groups) groups[t.stage].push(t);
  }
  return groups;
}

/**
 * Encounter stage -> the tip stages a learner may see without the panel leaking
 * management before the work-up is done (treatment/disposition unlock at
 * assessment). Process-first, per docs/architecture/16.
 */
export function visibleTipStages(encounterStage: string): TipStage[] {
  switch (encounterStage) {
    case "chart-review":
      return ["triage"];
    case "interview":
      return ["triage", "history"];
    case "exam":
      return ["triage", "history", "exam"];
    case "orders":
    case "results":
      return ["triage", "history", "exam", "workup"];
    default:
      return [...TIP_STAGES];
  }
}

/* -------------------------------------------------------------------------- */
/* Legacy citation ids                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Ids persisted by older encounters / progress records. Each maps to the
 * verified statement for the same guideline; ids with no verified statement
 * (the TEPDAD / TİTCK framework tags) map to null and render as unavailable.
 */
export const LEGACY_CITATION_ALIASES: Record<string, string | null> = {
  "esc-acs-2023": "gs_nice_ng185_nstemi_assessment",
  "nice-ng185": "gs_nice_ng185_reperfusion_eligibility",
  "nice-ng228": "gs_nice_sah_ct6h",
  "tepdad-em": null,
  "titck-formulary": null,
};

export function resolveCitationId(id: string): string | null {
  if (!id) return null;
  if (id in LEGACY_CITATION_ALIASES) return LEGACY_CITATION_ALIASES[id];
  return id;
}

/* -------------------------------------------------------------------------- */
/* Fetchers (never throw)                                                       */
/* -------------------------------------------------------------------------- */

function qs(params: Record<string, string | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v as string)}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

export function getStatement(id: string, lang: Lang, opts: { signal?: AbortSignal } = {}): Promise<BackendResult<GuidelineStatementPayload>> {
  return apiGet<GuidelineStatementPayload>(`/v1/guidelines/statements/${encodeURIComponent(id)}${qs({ locale: lang })}`, opts);
}

export function getStatements(params: { condition?: string; stage?: TipStage; lang: Lang }, opts: { signal?: AbortSignal } = {}): Promise<BackendResult<StatementsResponse>> {
  return apiGet<StatementsResponse>(`/v1/guidelines/statements${qs({ condition: params.condition, stage: params.stage, locale: params.lang })}`, opts);
}

export function getTips(params: { condition?: string; stage?: TipStage; lang: Lang }, opts: { signal?: AbortSignal } = {}): Promise<BackendResult<TipsResponse>> {
  return apiGet<TipsResponse>(`/v1/guidelines/tips${qs({ condition: params.condition, stage: params.stage, locale: params.lang })}`, opts);
}

/* -------------------------------------------------------------------------- */
/* In-memory cache + hooks                                                      */
/* -------------------------------------------------------------------------- */

export type GuidanceStatus = "loading" | "ready" | "unavailable";

/** Statement cache: id -> payload, or null when the API said "not verified". */
const statementCache = new Map<string, GuidelineStatementPayload | null>();
const inflight = new Map<string, Promise<GuidelineStatementPayload | null>>();

/** Seed the cache from a payload that already arrived (tips / grounding). */
export function primeStatementCache(p: GuidelineStatementPayload): void {
  if (p?.id && p.status === "verified") statementCache.set(p.id, p);
}

export function cachedCitation(id: string): CitationView | null {
  const resolved = resolveCitationId(id);
  if (!resolved) return null;
  const p = statementCache.get(resolved);
  return p ? toCitationView(p) : null;
}

/** Test helper. */
export function clearGuidelineCache(): void {
  statementCache.clear();
  inflight.clear();
}

function loadStatement(id: string, lang: Lang): Promise<GuidelineStatementPayload | null> {
  if (statementCache.has(id)) return Promise.resolve(statementCache.get(id) ?? null);
  const pending = inflight.get(id);
  if (pending) return pending;
  const p = getStatement(id, lang).then((res) => {
    const payload = res.ok && res.data?.status === "verified" ? res.data : null;
    // Cache negatives only for a definitive "not verified"/404; network errors retry later.
    if (res.ok || (!res.ok && res.status === 404)) statementCache.set(id, payload);
    inflight.delete(id);
    return payload;
  });
  inflight.set(id, p);
  return p;
}

export interface CitationState {
  status: GuidanceStatus;
  citation: CitationView | null;
}

/**
 * useGuidelineCitation: resolve a statement id (or legacy alias) to its
 * verified citation. Offline => "unavailable" synchronously; never invents.
 */
export function useGuidelineCitation(citationId: string, lang: Lang): CitationState {
  const { enabled } = useLiveBackend();
  const resolved = resolveCitationId(citationId);
  const cached = resolved ? statementCache.get(resolved) : undefined;
  const [state, setState] = useState<CitationState>(() =>
    cached ? { status: "ready", citation: toCitationView(cached) }
      : !enabled || !resolved ? { status: "unavailable", citation: null }
        : { status: "loading", citation: null },
  );

  useEffect(() => {
    if (!resolved || !enabled) {
      setState({ status: "unavailable", citation: null });
      return;
    }
    const hit = statementCache.get(resolved);
    if (hit) {
      setState({ status: "ready", citation: toCitationView(hit) });
      return;
    }
    let cancelled = false;
    setState({ status: "loading", citation: null });
    void loadStatement(resolved, lang).then((p) => {
      if (cancelled) return;
      setState(p ? { status: "ready", citation: toCitationView(p) } : { status: "unavailable", citation: null });
    });
    return () => {
      cancelled = true;
    };
  }, [resolved, enabled, lang]);

  return state;
}

export interface TipsState {
  status: GuidanceStatus;
  tips: AttendingTipView[];
  byStage: TipsByStage;
}

const EMPTY_GROUPS = groupTipsByStage([]);

/**
 * useAttendingTips: verified tips for the active condition (ICD-10 code or
 * catalog id). Fetches all stages once per condition and lets the panel filter
 * by the encounter stage client-side. Offline => "unavailable", no tips.
 */
export function useAttendingTips(condition: string | undefined, lang: Lang): TipsState {
  const { enabled } = useLiveBackend();
  const [state, setState] = useState<TipsState>({ status: enabled && condition ? "loading" : "unavailable", tips: [], byStage: EMPTY_GROUPS });

  useEffect(() => {
    if (!enabled || !condition) {
      setState({ status: "unavailable", tips: [], byStage: EMPTY_GROUPS });
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    setState((prev) => ({ ...prev, status: "loading" }));
    void getTips({ condition, lang }, { signal: controller.signal }).then((res) => {
      if (cancelled) return;
      if (!res.ok) {
        setState({ status: "unavailable", tips: [], byStage: EMPTY_GROUPS });
        return;
      }
      for (const p of Object.values(res.data.statements ?? {})) primeStatementCache(p);
      const tips = mapTips(res.data, lang);
      setState({ status: tips.length ? "ready" : "unavailable", tips, byStage: groupTipsByStage(tips) });
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [enabled, condition, lang]);

  return state;
}
