/**
 * AcuDx - browser identity: OIDC Authorization Code + PKCE against the identity
 * provider the server advertises at GET /v1/auth/config (server/auth).
 *
 * Minimal implementation, no SDK: the provider is a PUBLIC client, so the flow
 * is redirect -> code -> token exchange with the PKCE verifier. Design rules:
 *
 *   - the ACCESS TOKEN lives in module memory only; it is never written to
 *     localStorage, sessionStorage or a cookie;
 *   - the REFRESH TOKEN is kept in sessionStorage (tab-scoped, gone when the tab
 *     closes) so a reload within the tab restores the session silently;
 *   - the PKCE verifier + state live in sessionStorage only for the duration of
 *     the redirect and are removed on return;
 *   - the browser never decides a role: `rolesFromClaims` mirrors the server's
 *     mapping for display, but the role the app gates on comes from
 *     GET /v1/auth/me, i.e. the server's verified principal.
 *
 * Pure helpers (PKCE, URL building, claim mapping) are exported for Vitest; the
 * session store is a dependency-free `useSyncExternalStore` source like the
 * other stores in this app. Education only.
 */

import { useSyncExternalStore } from "react";

import { BACKEND_URL } from "@/lib/backend";

/* -------------------------------------------------------------------------- */
/* Roles (mirror of server/auth/roles.py)                                      */
/* -------------------------------------------------------------------------- */

export type AcuDxRole =
  | "student"
  | "nurse"
  | "paramedic"
  | "resident"
  | "faculty"
  | "dean"
  | "admin"
  | "super_admin";

export const ACUDX_ROLES: readonly AcuDxRole[] = [
  "student",
  "nurse",
  "paramedic",
  "resident",
  "faculty",
  "dean",
  "admin",
  "super_admin",
] as const;

/** Precedence: super_admin > admin > dean > faculty > resident > nurse = paramedic = student. */
export const ROLE_PRECEDENCE: Record<AcuDxRole, number> = {
  student: 10,
  nurse: 10,
  paramedic: 10,
  resident: 20,
  faculty: 30,
  dean: 40,
  admin: 50,
  super_admin: 60,
};

const ROLE_ALIASES: Record<string, AcuDxRole> = {
  "super-admin": "super_admin",
  superadmin: "super_admin",
  platform_admin: "super_admin",
  educator: "faculty",
  teacher: "faculty",
  academician: "faculty",
  administrator: "admin",
  learner: "student",
  medical_student: "student",
};

export function normalizeRole(value: unknown): AcuDxRole | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase().replace(/\s+/g, "_");
  const mapped = ROLE_ALIASES[v] ?? v;
  return (ACUDX_ROLES as readonly string[]).includes(mapped) ? (mapped as AcuDxRole) : null;
}

/** Canonical, de-duplicated roles ordered by descending precedence. */
export function normalizeRoles(values: Iterable<unknown>): AcuDxRole[] {
  const seen = new Set<AcuDxRole>();
  for (const v of values) {
    const r = normalizeRole(v);
    if (r) seen.add(r);
  }
  return [...seen].sort(
    (a, b) => ROLE_PRECEDENCE[b] - ROLE_PRECEDENCE[a] || ACUDX_ROLES.indexOf(a) - ACUDX_ROLES.indexOf(b),
  );
}

export function primaryRole(roles: Iterable<unknown>): AcuDxRole {
  return normalizeRoles(roles)[0] ?? "student";
}

export function roleAtLeast(roles: Iterable<unknown>, minimum: AcuDxRole): boolean {
  const need = ROLE_PRECEDENCE[minimum];
  return normalizeRoles(roles).some((r) => ROLE_PRECEDENCE[r] >= need);
}

/** Walk a dotted path (`realm_access.roles`) through a claims object. */
export function claimAtPath(claims: unknown, path: string | null | undefined): unknown {
  if (!path) return undefined;
  let node: unknown = claims;
  for (const part of path.split(".")) {
    if (node && typeof node === "object" && part in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return node;
}

/** Roles found at the claim path: a list, a space/comma separated string, or a dict of flags. */
export function rolesFromClaims(claims: unknown, path: string | null | undefined): AcuDxRole[] {
  const raw = claimAtPath(claims, path);
  if (raw == null) return [];
  if (typeof raw === "string") return normalizeRoles(raw.replace(/,/g, " ").split(/\s+/).filter(Boolean));
  if (Array.isArray(raw)) return normalizeRoles(raw);
  if (typeof raw === "object") {
    return normalizeRoles(Object.entries(raw as Record<string, unknown>).filter(([, v]) => Boolean(v)).map(([k]) => k));
  }
  return [];
}

/* -------------------------------------------------------------------------- */
/* Wire shapes (mirror server/auth/routes.py)                                  */
/* -------------------------------------------------------------------------- */

export type AuthMode = "local" | "oidc";

export interface IdentityProviderPublic {
  provider_id: number;
  name: string;
  issuer: string;
  client_id: string;
  scopes: string;
  role_claim_path: string;
  org_claim_path: string;
  flavor: string;
  /** Server-side configuration error (for example an empty audience); bearers are refused while set. */
  config_error?: string | null;
}

export interface DiscoveryPublic {
  issuer: string;
  authorization_endpoint: string | null;
  token_endpoint: string | null;
  end_session_endpoint: string | null;
  userinfo_endpoint: string | null;
}

export interface AuthConfig {
  mode: AuthMode;
  configured: boolean;
  provider: IdentityProviderPublic | null;
  discovery: DiscoveryPublic | null;
  discovery_error?: string;
  roles: string[];
  precedence: Record<string, number>;
}

export interface Principal {
  sub: string;
  email: string | null;
  name: string | null;
  roles: AcuDxRole[];
  org: string;
  verified: boolean;
  mode: AuthMode;
  primary_role: AcuDxRole;
}

/* -------------------------------------------------------------------------- */
/* PKCE helpers (Web Crypto; pure)                                             */
/* -------------------------------------------------------------------------- */

export function base64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(s: string): string {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Random base64url string; 32 bytes gives a 43-char PKCE verifier (RFC 7636 section 4.1). */
export function randomString(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base64Url(buf);
}

/** S256 code challenge for a verifier. */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

export interface AuthorizeParams {
  redirectUri: string;
  state: string;
  codeChallenge: string;
  nonce?: string;
  /** Extra parameters, e.g. Keycloak `kc_idp_hint` to route straight to a university IdP. */
  extra?: Record<string, string>;
}

export function buildAuthorizeUrl(cfg: AuthConfig, p: AuthorizeParams): string | null {
  const endpoint = cfg.discovery?.authorization_endpoint;
  const provider = cfg.provider;
  if (!endpoint || !provider) return null;
  const url = new URL(endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", provider.client_id);
  url.searchParams.set("redirect_uri", p.redirectUri);
  url.searchParams.set("scope", provider.scopes);
  url.searchParams.set("state", p.state);
  url.searchParams.set("code_challenge", p.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (p.nonce) url.searchParams.set("nonce", p.nonce);
  for (const [k, v] of Object.entries(p.extra ?? {})) url.searchParams.set(k, v);
  return url.toString();
}

export interface CallbackParams {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
}

/** Parse the IdP's redirect back (query string, with or without a leading "?"). */
export function parseCallback(search: string): CallbackParams {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const out: CallbackParams = {};
  for (const k of ["code", "state", "error", "error_description"] as const) {
    const v = q.get(k);
    if (v) out[k] = v;
  }
  return out;
}

/** Unverified payload decode for UI hints only (expiry countdown). The server verifies. */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const parsed = JSON.parse(base64UrlDecode(parts[1])) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Session store                                                               */
/* -------------------------------------------------------------------------- */

export type AuthStatus = "idle" | "loading" | "anonymous" | "signed-in" | "error";

export interface AuthSession {
  status: AuthStatus;
  /** Server-reported mode; "local" until the config has loaded. */
  mode: AuthMode;
  /** True once GET /v1/auth/config answered (even with mode local). */
  configLoaded: boolean;
  config: AuthConfig | null;
  principal: Principal | null;
  /** Epoch ms when the in-memory access token expires (0 when none). */
  expiresAt: number;
  error: string | null;
}

const REFRESH_KEY = "acudx-oidc-refresh";
const PKCE_KEY = "acudx-oidc-pkce";

let accessToken: string | null = null;
let refreshInFlight: Promise<boolean> | null = null;

let session: AuthSession = {
  status: "idle",
  mode: "local",
  configLoaded: false,
  config: null,
  principal: null,
  expiresAt: 0,
  error: null,
};
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function setSession(patch: Partial<AuthSession>): void {
  session = { ...session, ...patch };
  emit();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function getAuthSession(): AuthSession {
  return session;
}

export function useAuthSession(): AuthSession {
  return useSyncExternalStore(subscribe, getAuthSession, getAuthSession);
}

/** "local" until the server says otherwise. */
export function useAuthMode(): AuthMode {
  return useSyncExternalStore(subscribe, () => session.mode, () => session.mode);
}

export function hasAccessToken(): boolean {
  return accessToken !== null;
}

/** True when this tab holds a refresh token (a reload drops the in-memory access token only). */
export function canRefreshAccessToken(): boolean {
  try {
    return sessionStorage.getItem(REFRESH_KEY) !== null;
  } catch {
    return false;
  }
}

/** Reset for tests. */
export function __resetAuthForTests(): void {
  accessToken = null;
  refreshInFlight = null;
  session = { status: "idle", mode: "local", configLoaded: false, config: null, principal: null, expiresAt: 0, error: null };
  try {
    sessionStorage.removeItem(REFRESH_KEY);
    sessionStorage.removeItem(PKCE_KEY);
  } catch {
    /* no storage in this environment */
  }
}

type FetchLike = typeof fetch;

function fetcher(impl?: FetchLike): FetchLike {
  return impl ?? ((input, init) => fetch(input, init));
}

/* -------------------------------------------------------------------------- */
/* Config                                                                      */
/* -------------------------------------------------------------------------- */

export async function loadAuthConfig(fetchImpl?: FetchLike, timeoutMs = 6000): Promise<AuthConfig | null> {
  const f = fetcher(fetchImpl);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await f(`${BACKEND_URL}/v1/auth/config`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`http_${res.status}`);
    const cfg = (await res.json()) as AuthConfig;
    const mode: AuthMode = cfg.mode === "oidc" ? "oidc" : "local";
    setSession({ config: cfg, mode, configLoaded: true, status: session.status === "idle" ? "anonymous" : session.status });
    return cfg;
  } catch {
    // Unreachable gateway: behave as the unverified local profile and say so.
    setSession({ config: null, mode: "local", configLoaded: true, status: session.status === "idle" ? "anonymous" : session.status });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* -------------------------------------------------------------------------- */
/* Sign-in flow                                                                */
/* -------------------------------------------------------------------------- */

interface PkceState {
  verifier: string;
  state: string;
  nonce: string;
  redirectUri: string;
  returnTo: string;
}

function savePkce(p: PkceState): void {
  sessionStorage.setItem(PKCE_KEY, JSON.stringify(p));
}

function takePkce(): PkceState | null {
  try {
    const raw = sessionStorage.getItem(PKCE_KEY);
    sessionStorage.removeItem(PKCE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PkceState;
    return p && typeof p.verifier === "string" && typeof p.state === "string" ? p : null;
  } catch {
    return null;
  }
}

/** Default redirect target: `<origin>/auth/callback`. */
export function defaultRedirectUri(): string {
  return `${window.location.origin}/auth/callback`;
}

/**
 * Begin the redirect to the IdP. Returns the authorize URL (and navigates to it
 * unless `navigate` is false, for tests). Null when no provider is configured.
 */
export async function beginSignIn(
  cfg: AuthConfig,
  opts: { redirectUri?: string; returnTo?: string; navigate?: boolean; extra?: Record<string, string> } = {},
): Promise<string | null> {
  const verifier = randomString(32);
  const state = randomString(16);
  const nonce = randomString(16);
  const redirectUri = opts.redirectUri ?? defaultRedirectUri();
  const url = buildAuthorizeUrl(cfg, { redirectUri, state, codeChallenge: await pkceChallenge(verifier), nonce, extra: opts.extra });
  if (!url) return null;
  savePkce({ verifier, state, nonce, redirectUri, returnTo: opts.returnTo ?? "/" });
  if (opts.navigate !== false) window.location.assign(url);
  return url;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
  token_type?: string;
}

async function tokenRequest(cfg: AuthConfig, body: Record<string, string>, fetchImpl?: FetchLike): Promise<TokenResponse> {
  const endpoint = cfg.discovery?.token_endpoint;
  if (!endpoint || !cfg.provider) throw new Error("no_token_endpoint");
  const res = await fetcher(fetchImpl)(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cfg.provider.client_id, ...body }).toString(),
  });
  if (!res.ok) throw new Error(`token_http_${res.status}`);
  const data = (await res.json()) as TokenResponse;
  if (!data.access_token) throw new Error("token_missing");
  return data;
}

function storeTokens(t: TokenResponse): void {
  accessToken = t.access_token;
  const payload = decodeJwtPayload(t.access_token);
  const expFromJwt = payload && typeof payload.exp === "number" ? payload.exp * 1000 : 0;
  const expiresAt = expFromJwt || (t.expires_in ? Date.now() + t.expires_in * 1000 : Date.now() + 5 * 60_000);
  try {
    if (t.refresh_token) sessionStorage.setItem(REFRESH_KEY, t.refresh_token);
  } catch {
    /* tab storage unavailable: the session lasts as long as the access token */
  }
  setSession({ expiresAt });
}

/** GET /v1/auth/me with the in-memory bearer. */
export async function fetchMe(fetchImpl?: FetchLike): Promise<Principal | null> {
  if (!accessToken) return null;
  const res = await fetcher(fetchImpl)(`${BACKEND_URL}/v1/auth/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const p = (await res.json()) as Principal;
  return { ...p, roles: normalizeRoles(p.roles), primary_role: primaryRole(p.roles) };
}

/**
 * Complete the redirect: validate state, exchange the code (PKCE), load the
 * verified principal from the server. Returns the principal and where to go next.
 */
export async function completeSignIn(
  search: string,
  fetchImpl?: FetchLike,
): Promise<{ principal: Principal; returnTo: string } | { error: string }> {
  const cb = parseCallback(search);
  const pkce = takePkce();
  if (cb.error) return { error: cb.error_description ?? cb.error };
  if (!cb.code || !cb.state) return { error: "missing_code" };
  if (!pkce || pkce.state !== cb.state) return { error: "state_mismatch" };
  let cfg = session.config;
  if (!cfg) cfg = await loadAuthConfig(fetchImpl);
  if (!cfg || !cfg.provider) return { error: "no_provider" };
  setSession({ status: "loading", error: null });
  try {
    const tokens = await tokenRequest(
      cfg,
      { grant_type: "authorization_code", code: cb.code, redirect_uri: pkce.redirectUri, code_verifier: pkce.verifier },
      fetchImpl,
    );
    storeTokens(tokens);
    const principal = await fetchMe(fetchImpl);
    if (!principal) {
      accessToken = null;
      setSession({ status: "error", error: "me_failed", principal: null, expiresAt: 0 });
      return { error: "me_failed" };
    }
    setSession({ status: "signed-in", principal, error: null });
    return { principal, returnTo: pkce.returnTo || "/" };
  } catch (e) {
    accessToken = null;
    const msg = e instanceof Error ? e.message : "exchange_failed";
    setSession({ status: "error", error: msg, principal: null, expiresAt: 0 });
    return { error: msg };
  }
}

/** Refresh the access token from the tab-scoped refresh token; true on success. */
export async function refreshAccessToken(fetchImpl?: FetchLike): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    let refresh: string | null = null;
    try {
      refresh = sessionStorage.getItem(REFRESH_KEY);
    } catch {
      refresh = null;
    }
    const cfg = session.config ?? (await loadAuthConfig(fetchImpl));
    if (!refresh || !cfg || !cfg.provider) return false;
    try {
      const tokens = await tokenRequest(cfg, { grant_type: "refresh_token", refresh_token: refresh }, fetchImpl);
      storeTokens(tokens);
      return true;
    } catch {
      accessToken = null;
      try {
        sessionStorage.removeItem(REFRESH_KEY);
      } catch {
        /* nothing to clear */
      }
      setSession({ expiresAt: 0 });
      return false;
    }
  })();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

/**
 * Restore a session on boot: load the config, and when a refresh token survives
 * in this tab, mint a fresh access token and fetch the principal.
 */
export async function bootstrapAuth(fetchImpl?: FetchLike): Promise<Principal | null> {
  setSession({ status: session.status === "idle" ? "loading" : session.status });
  const cfg = await loadAuthConfig(fetchImpl);
  if (!cfg || !cfg.provider) {
    setSession({ status: "anonymous" });
    return null;
  }
  const ok = await refreshAccessToken(fetchImpl);
  if (!ok) {
    setSession({ status: "anonymous" });
    return null;
  }
  const principal = await fetchMe(fetchImpl);
  setSession(principal ? { status: "signed-in", principal, error: null } : { status: "anonymous", principal: null });
  return principal;
}

/** A bearer that is valid for at least `skewMs`, refreshing when needed. */
export async function ensureAccessToken(skewMs = 20_000, fetchImpl?: FetchLike): Promise<string | null> {
  if (accessToken && session.expiresAt - Date.now() > skewMs) return accessToken;
  if (await refreshAccessToken(fetchImpl)) return accessToken;
  return null;
}

/** Synchronous bearer header when a token is in memory (callers refresh ahead of time). */
export function bearerHeader(): Record<string, string> {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

/** Drop the in-memory session; optionally send the browser to the IdP end-session endpoint. */
export function signOutOidc(opts: { redirect?: boolean; postLogoutRedirectUri?: string } = {}): string | null {
  const cfg = session.config;
  accessToken = null;
  try {
    sessionStorage.removeItem(REFRESH_KEY);
  } catch {
    /* nothing to clear */
  }
  setSession({ status: "anonymous", principal: null, expiresAt: 0, error: null });
  const end = cfg?.discovery?.end_session_endpoint;
  if (!end || !cfg?.provider) return null;
  const url = new URL(end);
  url.searchParams.set("client_id", cfg.provider.client_id);
  if (opts.postLogoutRedirectUri) url.searchParams.set("post_logout_redirect_uri", opts.postLogoutRedirectUri);
  if (opts.redirect !== false && typeof window !== "undefined") window.location.assign(url.toString());
  return url.toString();
}
