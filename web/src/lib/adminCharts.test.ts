import { describe, it, expect } from "vitest";
import {
  breakdownBars,
  bucketLabel,
  formatBytes,
  formatMs,
  formatUsd,
  groupByKind,
  ledgerByDay,
  providerTone,
  seriesRows,
  topShares,
} from "@/lib/adminCharts";
import type { Breakdown, LedgerEntry, Provider, TelemetrySummary } from "@/lib/adminApi";

const NOW = 1_800_000_000; // 2027-01-15T08:00:00Z

function summary(over: Partial<TelemetrySummary> = {}): TelemetrySummary {
  const from = NOW - 3 * 3600;
  return {
    window: "24h",
    from_ts: from,
    to_ts: NOW,
    bucket_seconds: 3600,
    calls: 3,
    errors: 1,
    error_rate: 1 / 3,
    cost_usd: 0.5,
    tokens_in: 100,
    tokens_out: 50,
    cached_tokens: 0,
    latency_ms: { p50: 100, p95: 300 },
    by_provider: [],
    by_model: [],
    by_route: [],
    by_kind: [],
    series: [
      { ts: from, calls: 2, errors: 1, cost_usd: 0.123456789, tokens_in: 60, tokens_out: 30, p50_ms: 100, p95_ms: 300 },
      { ts: from + 3600, calls: 0, errors: 0, cost_usd: 0, tokens_in: 0, tokens_out: 0, p50_ms: null, p95_ms: null },
      { ts: from + 7200, calls: 1, errors: 0, cost_usd: 0.4, tokens_in: 40, tokens_out: 20, p50_ms: 50, p95_ms: 50 },
    ],
    price_version: "2026-10-19",
    ...over,
  };
}

describe("seriesRows", () => {
  it("emits one row per bucket, oldest first, labelled by bucket end", () => {
    const rows = seriesRows(summary(), "en", "UTC");
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.calls)).toEqual([2, 0, 1]);
    expect(rows[0].ok).toBe(1);
    expect(rows[0].cost_usd).toBe(0.123457);
    expect(rows[0].tokens).toBe(90);
    // empty bucket: latencies collapse to 0 so lines do not break
    expect(rows[1].p50_ms).toBe(0);
    expect(rows[1].p95_ms).toBe(0);
    // from = 05:00Z, bucket end = 06:00Z
    expect(rows[0].label).toBe("06:00");
    expect(rows[2].label).toBe("08:00");
  });

  it("uses a date label for 7d / 30d windows", () => {
    expect(bucketLabel(NOW, "7d", "en", "UTC")).toBe("Jan 15");
    expect(bucketLabel(NOW, "30d", "tr", "UTC")).toMatch(/15 Oca/);
  });
});

describe("topShares", () => {
  const rows: Breakdown[] = [
    { key: "a", calls: 50, errors: 0, cost_usd: 1, tokens_in: 0, tokens_out: 0, p50_ms: 1, p95_ms: 1 },
    { key: "b", calls: 30, errors: 0, cost_usd: 2, tokens_in: 0, tokens_out: 0, p50_ms: 1, p95_ms: 1 },
    { key: "c", calls: 15, errors: 0, cost_usd: 0, tokens_in: 0, tokens_out: 0, p50_ms: 1, p95_ms: 1 },
    { key: "d", calls: 5, errors: 0, cost_usd: 0, tokens_in: 0, tokens_out: 0, p50_ms: 1, p95_ms: 1 },
  ];

  it("keeps the top N and folds the rest into other with correct shares", () => {
    const out = topShares(rows, "calls", 2);
    expect(out.map((r) => r.key)).toEqual(["a", "b", "other"]);
    expect(out[0].share).toBeCloseTo(0.5);
    expect(out[2].calls).toBe(20);
    expect(out[2].share).toBeCloseTo(0.2);
    expect(out.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1);
  });

  it("drops a zero-valued tail and returns [] for an empty total", () => {
    expect(topShares(rows, "cost_usd", 2).map((r) => r.key)).toEqual(["b", "a"]);
    expect(topShares([], "calls")).toEqual([]);
    expect(topShares(rows.map((r) => ({ ...r, cost_usd: 0 })), "cost_usd")).toEqual([]);
  });

  it("breakdownBars sorts descending and skips zeros", () => {
    expect(breakdownBars(rows, "cost_usd").map((r) => r.key)).toEqual(["b", "a"]);
    expect(breakdownBars(rows, "calls", 3).map((r) => r.key)).toEqual(["a", "b", "c"]);
  });
});

describe("ledgerByDay", () => {
  it("buckets closed and running entries per UTC day", () => {
    const entries: LedgerEntry[] = [
      // yesterday, 2 h at $1.10/h closed
      { id: 1, instance_id: "x", instance_type: "gpu_1x_a10", region: "us", price_cents_per_hour: 110,
        started_at: NOW - 86_400 - 7200, ended_at: NOW - 86_400, cost_usd: 2.2, reason: "idle" },
      // today, running for 30 min at $2.00/h
      { id: 2, instance_id: "y", instance_type: "gpu_1x_a100", region: "us", price_cents_per_hour: 200,
        started_at: NOW - 1800, ended_at: null, cost_usd: null, reason: null },
    ];
    const rows = ledgerByDay(entries, NOW, "en", 3);
    expect(rows).toHaveLength(3);
    expect(rows[2].day).toBe("2027-01-15");
    expect(rows[2].cost_usd).toBeCloseTo(1.0);
    expect(rows[2].hours).toBeCloseTo(0.5);
    expect(rows[1].cost_usd).toBeCloseTo(2.2);
    expect(rows[1].sessions).toBe(1);
    expect(rows[0].cost_usd).toBe(0);
  });
});

describe("formatting", () => {
  it("formats currency with precision that scales with magnitude", () => {
    expect(formatUsd(0.0123, "en")).toBe("$0.0123");
    expect(formatUsd(12.5, "en")).toBe("$12.50");
    expect(formatUsd(1234, "en")).toBe("$1,234");
    expect(formatUsd(null, "en")).toBe("$0.0000");
  });
  it("formats latency and bytes", () => {
    expect(formatMs(null)).toBe("n/a");
    expect(formatMs(420.4)).toBe("420 ms");
    expect(formatMs(2500)).toBe("2.5 s");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3 MB");
  });
});

describe("provider helpers", () => {
  const p = (over: Partial<Provider>): Provider => ({
    id: 1, kind: "llm", name: "n", base_url: "http://127.0.0.1:1", model: null, region: null, enabled: true,
    priority: 100, extra: {}, created_at: 0, updated_at: 0, last_probe_at: null, last_probe_ok: null,
    last_probe_latency_ms: null, last_probe_error: null, has_key: false, key_last4: null, ...over,
  });

  it("derives tones: disabled, failed, ok, unknown", () => {
    expect(providerTone(p({ enabled: false, last_probe_ok: true }))).toBe("neutral");
    expect(providerTone(p({ last_probe_ok: false }))).toBe("critical");
    expect(providerTone(p({ last_probe_ok: true }))).toBe("normal");
    expect(providerTone(p({}))).toBe("caution");
  });

  it("groups by kind in canonical order, sorted by priority then name", () => {
    const list = [
      p({ id: 1, kind: "tts", name: "b", priority: 5 }),
      p({ id: 2, kind: "llm", name: "z", priority: 10 }),
      p({ id: 3, kind: "llm", name: "a", priority: 10 }),
      p({ id: 4, kind: "llm", name: "first", priority: 0 }),
    ];
    const groups = groupByKind(list, ["llm", "embed", "tts"]);
    expect(groups.map((g) => g.kind)).toEqual(["llm", "tts"]);
    expect(groups[0].items.map((i) => i.name)).toEqual(["first", "a", "z"]);
  });
});
