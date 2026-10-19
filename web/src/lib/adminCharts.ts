/**
 * Pure data shaping for the admin telemetry charts (no React, no I/O).
 *
 * Turns the gateway's `/admin/telemetry/summary` payload into the row shapes
 * the vendored evilcharts compositions consume, formats numbers per locale via
 * `Intl`, and derives the status tones used by the provider table. Kept pure so
 * it is unit-testable in the node Vitest environment.
 */

import type {
  Breakdown,
  LedgerEntry,
  Provider,
  SeriesBucket,
  TelemetrySummary,
  TelemetryWindow,
} from "@/lib/adminApi";

/* -------------------------------------------------------------------------- */
/* Formatting                                                                 */
/* -------------------------------------------------------------------------- */

export function formatUsd(value: number | null | undefined, locale = "en"): string {
  const n = value ?? 0;
  const digits = Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 1 ? 2 : 4;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

export function formatMs(value: number | null | undefined, locale = "en"): string {
  if (value === null || value === undefined) return "n/a";
  if (value >= 1000) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value / 1000)} s`;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value)} ms`;
}

export function formatInt(value: number | null | undefined, locale = "en"): string {
  return new Intl.NumberFormat(locale).format(value ?? 0);
}

export function formatPct(ratio: number | null | undefined, locale = "en"): string {
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(ratio ?? 0);
}

export function formatBytes(bytes: number | null | undefined, locale = "en"): string {
  if (bytes === null || bytes === undefined) return "n/a";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: i === 0 ? 0 : 1 }).format(v)} ${units[i]}`;
}

/** Bucket label: hour of day for the 24h window, short date otherwise. */
export function bucketLabel(ts: number, window: TelemetryWindow, locale = "en", timeZone?: string): string {
  const d = new Date(ts * 1000);
  const opts: Intl.DateTimeFormatOptions =
    window === "24h"
      ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }
      : { month: "short", day: "numeric" };
  return new Intl.DateTimeFormat(locale, { ...opts, ...(timeZone ? { timeZone } : {}) }).format(d);
}

/* -------------------------------------------------------------------------- */
/* Series shaping                                                             */
/* -------------------------------------------------------------------------- */

export interface SeriesRow extends Record<string, unknown> {
  ts: number;
  label: string;
  calls: number;
  errors: number;
  ok: number;
  cost_usd: number;
  tokens: number;
  p50_ms: number;
  p95_ms: number;
}

/**
 * One chart row per bucket, oldest first. Buckets end at `ts + bucket_seconds`,
 * so the label names the bucket END (what a reader expects on a time axis).
 * Null latencies become 0 so the line never breaks on empty buckets.
 */
export function seriesRows(summary: TelemetrySummary, locale = "en", timeZone?: string): SeriesRow[] {
  return summary.series.map((b: SeriesBucket) => ({
    ts: b.ts,
    label: bucketLabel(b.ts + summary.bucket_seconds, summary.window, locale, timeZone),
    calls: b.calls,
    errors: b.errors,
    ok: Math.max(0, b.calls - b.errors),
    cost_usd: Number(b.cost_usd.toFixed(6)),
    tokens: b.tokens_in + b.tokens_out,
    p50_ms: b.p50_ms ?? 0,
    p95_ms: b.p95_ms ?? 0,
  }));
}

/* -------------------------------------------------------------------------- */
/* Breakdowns                                                                 */
/* -------------------------------------------------------------------------- */

export interface ShareRow extends Record<string, unknown> {
  key: string;
  calls: number;
  cost_usd: number;
  share: number;
}

/**
 * Top `max` entries of a breakdown by the chosen metric; the tail is folded into
 * an "other" row so a pie never has more than `max + 1` sectors.
 */
export function topShares(rows: Breakdown[], metric: "calls" | "cost_usd", max = 5, otherKey = "other"): ShareRow[] {
  const total = rows.reduce((s, r) => s + r[metric], 0);
  if (total <= 0) return [];
  const sorted = [...rows].sort((a, b) => b[metric] - a[metric] || a.key.localeCompare(b.key));
  const head = sorted.slice(0, max);
  const tail = sorted.slice(max);
  const out: ShareRow[] = head.map((r) => ({
    key: r.key,
    calls: r.calls,
    cost_usd: r.cost_usd,
    share: r[metric] / total,
  }));
  if (tail.length) {
    const calls = tail.reduce((s, r) => s + r.calls, 0);
    const cost = tail.reduce((s, r) => s + r.cost_usd, 0);
    const value = metric === "calls" ? calls : cost;
    if (value > 0) out.push({ key: otherKey, calls, cost_usd: cost, share: value / total });
  }
  return out;
}

/** Sorted breakdown rows for a horizontal bar chart (largest first, max `max`). */
export function breakdownBars(rows: Breakdown[], metric: "calls" | "cost_usd" | "errors", max = 8): Breakdown[] {
  return [...rows]
    .filter((r) => r[metric] > 0)
    .sort((a, b) => b[metric] - a[metric] || a.key.localeCompare(b.key))
    .slice(0, max);
}

/* -------------------------------------------------------------------------- */
/* GPU ledger                                                                 */
/* -------------------------------------------------------------------------- */

export interface LedgerDayRow extends Record<string, unknown> {
  day: string;
  label: string;
  cost_usd: number;
  hours: number;
  sessions: number;
}

/** Fold ledger entries into per-UTC-day cost and hours (running entries priced to `now`). */
export function ledgerByDay(entries: LedgerEntry[], now: number, locale = "en", days = 14): LedgerDayRow[] {
  const dayMs = 86_400_000;
  const todayStart = Math.floor((now * 1000) / dayMs) * dayMs;
  const buckets = new Map<string, LedgerDayRow>();
  for (let i = days - 1; i >= 0; i -= 1) {
    const start = todayStart - i * dayMs;
    const key = new Date(start).toISOString().slice(0, 10);
    buckets.set(key, {
      day: key,
      label: new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(start)),
      cost_usd: 0,
      hours: 0,
      sessions: 0,
    });
  }
  for (const e of entries) {
    const key = new Date(e.started_at * 1000).toISOString().slice(0, 10);
    const b = buckets.get(key);
    if (!b) continue;
    const end = e.ended_at ?? now;
    const hours = Math.max(0, end - e.started_at) / 3600;
    b.sessions += 1;
    b.hours += hours;
    b.cost_usd += e.cost_usd ?? (hours * e.price_cents_per_hour) / 100;
  }
  return [...buckets.values()].map((b) => ({
    ...b,
    cost_usd: Number(b.cost_usd.toFixed(4)),
    hours: Number(b.hours.toFixed(3)),
  }));
}

/* -------------------------------------------------------------------------- */
/* Provider status                                                            */
/* -------------------------------------------------------------------------- */

export type ProviderTone = "normal" | "critical" | "caution" | "neutral";

/** Status tone for a provider row: disabled > failed probe > ok probe > never probed. */
export function providerTone(p: Pick<Provider, "enabled" | "last_probe_ok">): ProviderTone {
  if (!p.enabled) return "neutral";
  if (p.last_probe_ok === false) return "critical";
  if (p.last_probe_ok === true) return "normal";
  return "caution";
}

/** Stable sort for the provider table: kind, then priority, then name. */
export function sortProviders(list: Provider[]): Provider[] {
  return [...list].sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.priority - b.priority || a.name.localeCompare(b.name),
  );
}

/** Group providers by kind, preserving the canonical kind order given. */
export function groupByKind(list: Provider[], kinds: readonly string[]): Array<{ kind: string; items: Provider[] }> {
  const sorted = sortProviders(list);
  return kinds
    .map((kind) => ({ kind, items: sorted.filter((p) => p.kind === kind) }))
    .filter((g) => g.items.length > 0);
}
