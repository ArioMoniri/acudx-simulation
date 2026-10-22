import { describe, expect, it, vi } from "vitest";
import { createAdminApi } from "@/lib/adminApi";
import { cooldownRows, poolRows } from "@/lib/adminCharts";

function fakeFetch(body: unknown = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const base = "http://gateway.test/api";

describe("GPU pool admin calls", () => {
  it("stops one worker by id, or the whole pool", async () => {
    const { fn, calls } = fakeFetch({ terminated: null, spent_today_usd: 0 });
    const api = createAdminApi({ baseUrl: base, fetchFn: fn, getToken: () => "t" });
    await api.gpuStop(7);
    await api.gpuStop();
    expect(calls[0].url).toBe(`${base}/admin/gpu/stop?worker_id=7`);
    expect(calls[1].url).toBe(`${base}/admin/gpu/stop`);
    expect(calls[0].init.method).toBe("POST");
  });

  it("asks for one more worker", async () => {
    const { fn, calls } = fakeFetch({ started: "admin" });
    const api = createAdminApi({ baseUrl: base, fetchFn: fn, getToken: () => "t" });
    const r = await api.gpuScaleUp();
    expect(r.ok).toBe(true);
    expect(calls[0].url).toBe(`${base}/admin/gpu/scale-up`);
    expect(calls[0].init.method).toBe("POST");
  });
});

describe("poolRows", () => {
  it("marks a worker on a smaller card than the live-video preference as a fallback", () => {
    const base = {
      instance_id: "i", region: "us-east-1", ip: null, domain: "d", status: "ready", price_cents_per_hour: 199,
      launched_at: 1, ready_at: 1, last_used_at: 1, terminated_at: null,
    };
    const rows = poolRows({
      configured: true, spent_today_usd: 0, worker: null,
      workers: [
        { ...base, id: 1, instance_type: "gpu_1x_a100_sxm4", gpu_memory_gb: 40,
          video_tier: { tier: "fallback", gpu_memory_gb: 40, notice: "40 GB card" } },
        { ...base, id: 2, instance_type: "gpu_1x_h100_pcie", gpu_memory_gb: 80,
          video_tier: { tier: "preferred", gpu_memory_gb: 80, notice: null } },
      ],
    });
    expect(rows.map((r) => [r.id, r.gpu_memory_gb, r.fallback])).toEqual([[2, 80, false], [1, 40, true]]);
  });

  it("lists every worker with its load, newest first, and falls back to the single worker", () => {
    const w = (id: number, extra: Record<string, unknown> = {}) => ({
      id, instance_id: `i-${id}`, instance_type: "gpu_1x_h100_sxm5", region: "us-east-1", ip: null, domain: `d${id}`,
      status: "ready", price_cents_per_hour: 429, launched_at: id, ready_at: id, last_used_at: id, terminated_at: null,
      ...extra,
    });
    const rows = poolRows({
      configured: true, spent_today_usd: 0, worker: w(2),
      workers: [w(1, { gpus: 1, load: { inflight: 2, calls: 1, gpus: 1, score: 5 } }), w(2, { gpus: 8, instance_type: "gpu_8x_h100_sxm5" })],
    });
    expect(rows.map((r) => r.id)).toEqual([2, 1]);
    expect(rows[1]).toMatchObject({ inflight: 2, calls: 1, gpus: 1 });
    expect(rows[0]).toMatchObject({ inflight: 0, calls: 0, gpus: 8 });
    expect(poolRows({ configured: true, spent_today_usd: 0, worker: w(3) }).map((r) => r.id)).toEqual([3]);
    expect(rows[0]).toMatchObject({ gpu_memory_gb: null, fallback: false });
    expect(poolRows({ configured: true, spent_today_usd: 0, worker: null })).toEqual([]);
  });
});

describe("cooldownRows", () => {
  it("lists running launch cooldowns with minutes left and folds provider reasons", () => {
    const now = 1_000_000;
    const c = (instance_type: string, region: string, reason: string, until: number) => ({
      instance_type, region, reason, at: now - 60, until, remaining_s: until - now,
    });
    const rows = cooldownRows({
      configured: true, spent_today_usd: 0, worker: null,
      cooldowns: [
        c("gpu_1x_h100_pcie", "us-west-3", "boot_stuck", now + 3000),
        c("gpu_1x_h100_sxm5", "us-east-3", "provider:preempted", now + 3590),
        c("gpu_1x_a100_sxm4", "us-east-1", "boot_timeout", now - 5),
      ],
    }, now);
    expect(rows.map((r) => [r.key, r.reason, r.minutes_left])).toEqual([
      ["gpu_1x_h100_sxm5@us-east-3", "provider", 60],
      ["gpu_1x_h100_pcie@us-west-3", "boot_stuck", 50],
    ]);
    expect(cooldownRows(null, now)).toEqual([]);
  });

  it("clears the cooldowns through the admin API", async () => {
    const { fn, calls } = fakeFetch({ cleared: 1, cooldowns: [] });
    const api = createAdminApi({ baseUrl: base, fetchFn: fn, getToken: () => "t" });
    const r = await api.gpuClearCooldowns();
    expect(r.ok).toBe(true);
    expect(calls[0].url).toBe(`${base}/admin/gpu/cooldowns/clear`);
    expect(calls[0].init.method).toBe("POST");
  });
});
