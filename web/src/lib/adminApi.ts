/**
 * AcuDx admin API client (server/registry/routes.py + server/admin_routes.py).
 *
 * Every call carries `X-Admin-Token` when the operator typed the bootstrap token,
 * else the signed-in admin's verified OIDC bearer. The token is typed on the
 * /admin sign-in field and kept in `sessionStorage` ONLY (never localStorage,
 * never a cookie): closing the tab ends the admin session. No provider key is
 * ever returned by the server (only `has_key` + `key_last4`), and the client
 * never stores one: the key input is write-only and sent once in the request.
 *
 * Trade-off (review 04 O10): sessionStorage is tab-scoped but readable by any
 * script in this origin, so an XSS in the admin bundle can exfiltrate the token.
 * It is a bootstrap credential: once an identity provider is configured, sign in
 * with a verified admin bearer (accepted by every /admin route), unset
 * ADMIN_TOKEN on the gateway and rotate it after classroom seeding. See
 * docs/architecture/19 section 9.
 *
 * Shapes mirror the FastAPI models. Every function returns a discriminated
 * `AdminResult` and never throws into the UI.
 */

import { ensureAccessToken } from "@/lib/auth";
import { BACKEND_URL } from "@/lib/backend";

/* -------------------------------------------------------------------------- */
/* Token storage (sessionStorage only)                                        */
/* -------------------------------------------------------------------------- */

export const ADMIN_TOKEN_KEY = "acudx-admin-token";

export function getAdminToken(): string | null {
  try {
    const v = sessionStorage.getItem(ADMIN_TOKEN_KEY);
    return v && v.trim() ? v : null;
  } catch {
    return null;
  }
}

export function setAdminToken(token: string | null): void {
  try {
    if (token && token.trim()) sessionStorage.setItem(ADMIN_TOKEN_KEY, token.trim());
    else sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {
    /* storage unavailable: the in-memory client state still carries the token */
  }
}

/* -------------------------------------------------------------------------- */
/* Result type                                                                */
/* -------------------------------------------------------------------------- */

export type AdminErrorCode =
  | "no_token"
  | "unauthorized"
  | "admin_disabled"
  | "not_found"
  | "conflict"
  | "validation"
  | "timeout"
  | "network"
  | `http_${number}`
  | "unknown";

export interface AdminOk<T> {
  ok: true;
  data: T;
}
export interface AdminErr {
  ok: false;
  error: AdminErrorCode;
  status?: number;
  /** Server `detail` payload when present (e.g. { reason, message }). */
  detail?: unknown;
}
export type AdminResult<T> = AdminOk<T> | AdminErr;

/* -------------------------------------------------------------------------- */
/* Wire shapes                                                                */
/* -------------------------------------------------------------------------- */

export type ProviderKind =
  | "llm"
  | "embed"
  | "rerank"
  | "stt"
  | "tts"
  | "avatar"
  | "imaging"
  | "identity"
  | "telemetry";

export const PROVIDER_KINDS: readonly ProviderKind[] = [
  "llm",
  "embed",
  "rerank",
  "stt",
  "tts",
  "avatar",
  "imaging",
  "identity",
  "telemetry",
] as const;

export interface Provider {
  id: number;
  kind: ProviderKind;
  name: string;
  base_url: string;
  model: string | null;
  region: string | null;
  enabled: boolean;
  priority: number;
  extra: Record<string, unknown>;
  created_at: number;
  updated_at: number;
  last_probe_at: number | null;
  last_probe_ok: boolean | null;
  last_probe_latency_ms: number | null;
  last_probe_error: string | null;
  has_key: boolean;
  key_last4: string | null;
}

export interface ProviderInput {
  kind: ProviderKind;
  name: string;
  base_url: string;
  model?: string | null;
  /** Write-only. Omit to keep the stored key on update; "" clears it. */
  api_key?: string;
  region?: string | null;
  enabled?: boolean;
  priority?: number;
  extra?: Record<string, unknown>;
}

export interface ProviderList {
  providers: Provider[];
  kinds: ProviderKind[];
  secrets_configured: boolean;
}

export interface ProbeResult {
  provider_id: number;
  kind: ProviderKind;
  ok: boolean;
  status: number | null;
  latency_ms: number | null;
  error: string | null;
  url: string | null;
  models: string[];
  detail?: string;
}

export interface SettingsMap {
  settings: Record<string, unknown>;
}

export interface HealthReport {
  status: "ok" | "degraded";
  airgapped: boolean;
  secrets_configured: boolean;
  db: { ok: boolean; path: string; latency_ms?: number; size_bytes?: number; error?: string };
  providers: {
    total: number;
    enabled: number;
    probe_failed: number;
    by_kind: Record<string, { total: number; enabled: number; probe_ok: number; probe_failed: number }>;
  };
  gpu: GpuStatus;
  disk: { path: string; total_bytes?: number; free_bytes?: number; used_bytes?: number; used_pct?: number | null; error?: string };
  /** Background jobs (provider_probe, telemetry_retention); absent on older gateways. */
  jobs?: Record<string, JobStatus>;
  ts: number;
}

export interface JobStatus {
  name: string;
  enabled: boolean;
  interval_s: number;
  running: boolean;
  runs: number;
  last_run_at: number | null;
  last_result: Record<string, unknown> | null;
  last_error: string | null;
}

export interface WorkerPolicy {
  idle_minutes: number;
  /** null = no daily cap. */
  daily_budget_usd: number | null;
  allowlist: string[];
  llm_model: string;
  region_preference: string[];
}

export interface WorkerPublic {
  id: number;
  instance_id: string;
  instance_type: string;
  region: string;
  ip: string | null;
  domain: string | null;
  status: string;
  price_cents_per_hour: number;
  launched_at: number;
  ready_at: number | null;
  last_used_at: number;
  terminated_at: number | null;
  endpoints?: Record<string, string>;
}

export interface GpuStatus {
  configured: boolean;
  airgapped?: boolean;
  can_launch?: boolean;
  refusal?: { reason: string; message: string } | null;
  policy?: WorkerPolicy;
  worker: WorkerPublic | null;
  spent_today_usd: number;
  budget_remaining_usd?: number;
  reaper_running?: boolean;
}

export interface LedgerEntry {
  id: number;
  instance_id: string;
  instance_type: string;
  region: string;
  price_cents_per_hour: number;
  started_at: number;
  ended_at: number | null;
  cost_usd: number | null;
  reason: string | null;
}

export interface GpuLedger {
  entries: LedgerEntry[];
  spent_today_usd: number;
}

export interface GpuTelemetry extends GpuLedger {
  spent_7d_usd: number;
  spent_30d_usd: number;
  by_instance_type: Array<{ key: string; sessions: number; hours: number; cost_usd: number }>;
  worker: WorkerPublic | null;
  policy?: WorkerPolicy;
  budget_remaining_usd?: number;
}

export type TelemetryWindow = "24h" | "7d" | "30d";

export interface Breakdown {
  key: string;
  calls: number;
  errors: number;
  cost_usd: number;
  tokens_in: number;
  tokens_out: number;
  p50_ms: number | null;
  p95_ms: number | null;
}

export interface SeriesBucket {
  ts: number;
  calls: number;
  errors: number;
  cost_usd: number;
  tokens_in: number;
  tokens_out: number;
  p50_ms: number | null;
  p95_ms: number | null;
}

export interface TelemetrySummary {
  window: TelemetryWindow;
  from_ts: number;
  to_ts: number;
  bucket_seconds: number;
  calls: number;
  errors: number;
  error_rate: number;
  cost_usd: number;
  tokens_in: number;
  tokens_out: number;
  cached_tokens: number;
  latency_ms: { p50: number | null; p95: number | null };
  by_provider: Breakdown[];
  by_model: Breakdown[];
  by_route: Breakdown[];
  by_kind: Breakdown[];
  series: SeriesBucket[];
  price_version: string;
}

/* -------------------------------------------------------------------------- */
/* Client factory                                                             */
/* -------------------------------------------------------------------------- */

export interface AdminApiOptions {
  baseUrl?: string;
  fetchFn?: typeof fetch;
  getToken?: () => string | null;
  /** Verified OIDC access token, used when no bootstrap admin token is stored. */
  getBearer?: () => Promise<string | null>;
  timeoutMs?: number;
}

function codeForStatus(status: number): AdminErrorCode {
  if (status === 401) return "unauthorized";
  if (status === 503) return "admin_disabled";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 422) return "validation";
  return `http_${status}`;
}

function reasonFor(err: unknown): AdminErrorCode {
  if (err instanceof DOMException && err.name === "AbortError") return "timeout";
  if (err instanceof TypeError) return "network";
  return "unknown";
}

export function createAdminApi(opts: AdminApiOptions = {}) {
  const baseUrl = opts.baseUrl ?? BACKEND_URL;
  const fetchFn = opts.fetchFn ?? ((input, init) => fetch(input, init));
  const getToken = opts.getToken ?? getAdminToken;
  const getBearer = opts.getBearer ?? (() => ensureAccessToken());
  const timeoutMs = opts.timeoutMs ?? 12_000;

  async function request<T>(
    path: string,
    init: { method?: string; body?: unknown; query?: Record<string, string | number | undefined> } = {},
  ): Promise<AdminResult<T>> {
    // The bootstrap X-Admin-Token wins when the operator typed one; otherwise a signed-in
    // admin / super_admin uses the verified bearer (server/admin_routes.py require_admin).
    const token = getToken();
    let authHeader: Record<string, string>;
    if (token) {
      authHeader = { "X-Admin-Token": token };
    } else {
      const bearer = await getBearer();
      if (!bearer) return { ok: false, error: "no_token" };
      authHeader = { Authorization: `Bearer ${bearer}` };
    }

    const qs = init.query
      ? Object.entries(init.query)
          .filter(([, v]) => v !== undefined && v !== "")
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join("&")
      : "";
    const url = `${baseUrl}${path}${qs ? `?${qs}` : ""}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchFn(url, {
        method: init.method ?? "GET",
        headers: {
          accept: "application/json",
          ...authHeader,
          ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: controller.signal,
      });
      if (!res.ok) {
        let detail: unknown;
        try {
          detail = ((await res.json()) as { detail?: unknown }).detail;
        } catch {
          detail = undefined;
        }
        return { ok: false, error: codeForStatus(res.status), status: res.status, detail };
      }
      if (res.status === 204) return { ok: true, data: undefined as T };
      return { ok: true, data: (await res.json()) as T };
    } catch (err) {
      return { ok: false, error: reasonFor(err) };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    /* providers */
    listProviders: (kind?: ProviderKind) =>
      request<ProviderList>("/admin/providers", { query: { kind } }),
    getProvider: (id: number) => request<Provider>(`/admin/providers/${id}`),
    createProvider: (body: ProviderInput) =>
      request<Provider>("/admin/providers", { method: "POST", body }),
    updateProvider: (id: number, body: Partial<ProviderInput>) =>
      request<Provider>(`/admin/providers/${id}`, { method: "PUT", body }),
    deleteProvider: (id: number) => request<void>(`/admin/providers/${id}`, { method: "DELETE" }),
    probeProvider: (id: number) =>
      request<ProbeResult>(`/admin/providers/${id}/probe`, { method: "POST" }),
    /* settings + health */
    getSettings: () => request<SettingsMap>("/admin/settings"),
    putSettings: (settings: Record<string, unknown>) =>
      request<SettingsMap>("/admin/settings", { method: "PUT", body: { settings } }),
    getHealth: () => request<HealthReport>("/admin/health"),
    /* telemetry */
    getTelemetrySummary: (window: TelemetryWindow) =>
      request<TelemetrySummary>("/admin/telemetry/summary", { query: { window } }),
    getGpuTelemetry: (limit = 200) =>
      request<GpuTelemetry>("/admin/telemetry/gpu", { query: { limit } }),
    /* gpu worker (server/admin_routes.py) */
    gpuStatus: () => request<GpuStatus>("/admin/gpu/status"),
    gpuStart: () =>
      request<{ worker: WorkerPublic; spent_today_usd: number }>("/admin/gpu/start", { method: "POST" }),
    gpuStop: () =>
      request<{ terminated: WorkerPublic | null; spent_today_usd: number }>("/admin/gpu/stop", {
        method: "POST",
      }),
    gpuLedger: (limit = 100) => request<GpuLedger>("/admin/gpu/ledger", { query: { limit } }),
    getGpuPolicy: () => request<WorkerPolicy>("/admin/gpu/policy"),
    putGpuPolicy: (policy: WorkerPolicy) =>
      request<WorkerPolicy>("/admin/gpu/policy", { method: "PUT", body: policy }),
    /* identity: user_roles directory (server/auth/routes.py) */
    listUsers: (org?: string) => request<UserDirectory>("/admin/users", { query: { org } }),
    putUserRoles: (sub: string, roles: string[], org?: string) =>
      request<UserRecord>(`/admin/users/${encodeURIComponent(sub)}/roles`, { method: "PUT", body: { roles, org } }),
    deleteUser: (sub: string) => request<void>(`/admin/users/${encodeURIComponent(sub)}`, { method: "DELETE" }),
  };
}

export interface UserRecord {
  sub: string;
  org: string | null;
  roles: string[];
  email: string | null;
  name: string | null;
  granted_by: string | null;
  created_at: number;
  updated_at: number;
  last_seen_at: number | null;
}

export interface UserDirectory {
  users: UserRecord[];
  roles: string[];
}

export type AdminApi = ReturnType<typeof createAdminApi>;

/** Default client: same-origin gateway, token from sessionStorage. */
export const adminApi: AdminApi = createAdminApi();
