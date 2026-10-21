import { describe, it, expect, vi } from "vitest";
import { createAdminApi, type ProviderInput } from "@/lib/adminApi";

type Call = { url: string; init: RequestInit };

/** Test double for fetch: records calls, answers from a queue of responses. */
function fakeFetch(responses: Array<{ status: number; body?: unknown }>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    const next = responses.shift() ?? { status: 200, body: {} };
    return new Response(next.body === undefined ? null : JSON.stringify(next.body), {
      status: next.status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const base = "http://gateway.test/api";

describe("adminApi", () => {
  it("refuses to call the network without a token", async () => {
    const { fn, calls } = fakeFetch([]);
    const api = createAdminApi({ baseUrl: base, fetchFn: fn, getToken: () => null, getBearer: async () => null });
    const r = await api.getHealth();
    expect(r).toEqual({ ok: false, error: "no_token" });
    expect(calls).toHaveLength(0);
  });

  it("uses the signed-in admin's bearer when no bootstrap token is stored", async () => {
    const { fn, calls } = fakeFetch([{ status: 200, body: { providers: [], kinds: [], secrets_configured: true } }]);
    const api = createAdminApi({ baseUrl: base, fetchFn: fn, getToken: () => null, getBearer: async () => "jwt-1" });
    const r = await api.listProviders();
    expect(r.ok).toBe(true);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer jwt-1");
    expect(headers["X-Admin-Token"]).toBeUndefined();
  });

  it("prefers the typed bootstrap token over a bearer", async () => {
    const { fn, calls } = fakeFetch([{ status: 200, body: {} }]);
    const api = createAdminApi({ baseUrl: base, fetchFn: fn, getToken: () => "tok-9", getBearer: async () => "jwt-1" });
    await api.getHealth();
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["X-Admin-Token"]).toBe("tok-9");
    expect(headers.Authorization).toBeUndefined();
  });

  it("sends X-Admin-Token and the kind query on list", async () => {
    const { fn, calls } = fakeFetch([{ status: 200, body: { providers: [], kinds: [], secrets_configured: true } }]);
    const api = createAdminApi({ baseUrl: base, fetchFn: fn, getToken: () => "tok-1" });
    const r = await api.listProviders("llm");
    expect(r.ok).toBe(true);
    expect(calls[0].url).toBe(`${base}/admin/providers?kind=llm`);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["X-Admin-Token"]).toBe("tok-1");
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].init.body).toBeUndefined();
  });

  it("omits an undefined query param", async () => {
    const { fn, calls } = fakeFetch([{ status: 200, body: { providers: [] } }]);
    const api = createAdminApi({ baseUrl: base, fetchFn: fn, getToken: () => "t" });
    await api.listProviders();
    expect(calls[0].url).toBe(`${base}/admin/providers`);
  });

  it("posts JSON bodies and maps the created provider", async () => {
    const created = { id: 7, kind: "llm", name: "deepinfra", has_key: true, key_last4: "ABCD" };
    const { fn, calls } = fakeFetch([{ status: 201, body: created }]);
    const api = createAdminApi({ baseUrl: base, fetchFn: fn, getToken: () => "t" });
    const body: ProviderInput = {
      kind: "llm",
      name: "deepinfra",
      base_url: "https://api.deepinfra.com/v1/openai",
      api_key: "di-secret-ABCD",
    };
    const r = await api.createProvider(body);
    expect(r.ok && r.data.id).toBe(7);
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init.body))).toEqual(body);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
  });

  it("maps 401 / 503 / 404 / 409 / 422 to stable error codes with detail", async () => {
    const { fn } = fakeFetch([
      { status: 401, body: { detail: "invalid X-Admin-Token" } },
      { status: 503, body: { detail: "ADMIN_TOKEN is not configured" } },
      { status: 404, body: { detail: "provider not found" } },
      { status: 409, body: { detail: { reason: "secret_key_missing", message: "ACUDX_SECRET_KEY is not set" } } },
      { status: 422, body: { detail: [{ loc: ["body", "base_url"] }] } },
      { status: 500 },
    ]);
    const api = createAdminApi({ baseUrl: base, fetchFn: fn, getToken: () => "t" });
    expect(await api.getHealth()).toMatchObject({ ok: false, error: "unauthorized", status: 401 });
    expect(await api.getHealth()).toMatchObject({ ok: false, error: "admin_disabled", status: 503 });
    expect(await api.getProvider(1)).toMatchObject({ ok: false, error: "not_found" });
    const conflict = await api.createProvider({ kind: "tts", name: "x", base_url: "https://x", api_key: "k" });
    expect(conflict).toMatchObject({
      ok: false,
      error: "conflict",
      detail: { reason: "secret_key_missing" },
    });
    expect(await api.getHealth()).toMatchObject({ ok: false, error: "validation" });
    expect(await api.getHealth()).toMatchObject({ ok: false, error: "http_500", status: 500 });
  });

  it("treats 204 from delete as ok", async () => {
    const { fn, calls } = fakeFetch([{ status: 204 }]);
    const api = createAdminApi({ baseUrl: base, fetchFn: fn, getToken: () => "t" });
    const r = await api.deleteProvider(3);
    expect(r).toEqual({ ok: true, data: undefined });
    expect(calls[0].url).toBe(`${base}/admin/providers/3`);
    expect(calls[0].init.method).toBe("DELETE");
  });

  it("returns network errors instead of throwing", async () => {
    const fn = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const api = createAdminApi({ baseUrl: base, fetchFn: fn, getToken: () => "t" });
    expect(await api.probeProvider(1)).toEqual({ ok: false, error: "network" });
  });

  it("uses the telemetry window and the gpu routes", async () => {
    const { fn, calls } = fakeFetch([
      { status: 200, body: { window: "7d", calls: 0 } },
      { status: 200, body: { entries: [] } },
      { status: 200, body: { idle_minutes: 5 } },
    ]);
    const api = createAdminApi({ baseUrl: base, fetchFn: fn, getToken: () => "t" });
    await api.getTelemetrySummary("7d");
    await api.gpuLedger(25);
    await api.putGpuPolicy({ idle_minutes: 5, daily_budget_usd: 10, allowlist: ["gpu_1x_a10"], llm_model: "m", region_preference: [] });
    expect(calls[0].url).toBe(`${base}/admin/telemetry/summary?window=7d`);
    expect(calls[1].url).toBe(`${base}/admin/gpu/ledger?limit=25`);
    expect(calls[2].url).toBe(`${base}/admin/gpu/policy`);
    expect(calls[2].init.method).toBe("PUT");
  });

  it("never serialises a key into a GET and never reads one back", async () => {
    const { fn, calls } = fakeFetch([{ status: 200, body: { id: 1, has_key: true, key_last4: "9876" } }]);
    const api = createAdminApi({ baseUrl: base, fetchFn: fn, getToken: () => "t" });
    const r = await api.getProvider(1);
    expect(calls[0].init.body).toBeUndefined();
    expect(r.ok && "api_key" in (r.data as object)).toBe(false);
  });
});
