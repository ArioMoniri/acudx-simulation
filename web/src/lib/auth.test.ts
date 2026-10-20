import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetAuthForTests,
  base64Url,
  base64UrlDecode,
  bearerHeader,
  buildAuthorizeUrl,
  claimAtPath,
  completeSignIn,
  decodeJwtPayload,
  getAuthSession,
  loadAuthConfig,
  normalizeRoles,
  parseCallback,
  pkceChallenge,
  primaryRole,
  randomString,
  refreshAccessToken,
  roleAtLeast,
  rolesFromClaims,
  type AuthConfig,
} from "./auth";

/* A tiny sessionStorage for the node environment. */
function installSessionStorage() {
  const m = new Map<string, string>();
  const store = {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
  vi.stubGlobal("sessionStorage", store);
  return m;
}

function jwt(payload: Record<string, unknown>): string {
  const enc = (o: unknown) => base64Url(new TextEncoder().encode(JSON.stringify(o)));
  return `${enc({ alg: "RS256", kid: "k1" })}.${enc(payload)}.sig`;
}

const CFG: AuthConfig = {
  mode: "oidc",
  configured: true,
  provider: {
    provider_id: 1,
    name: "keycloak-dev",
    issuer: "https://idp.example.edu/realms/acudx",
    client_id: "acudx-web",
    scopes: "openid profile email",
    role_claim_path: "realm_access.roles",
    org_claim_path: "org",
    flavor: "keycloak",
  },
  discovery: {
    issuer: "https://idp.example.edu/realms/acudx",
    authorization_endpoint: "https://idp.example.edu/realms/acudx/protocol/openid-connect/auth",
    token_endpoint: "https://idp.example.edu/realms/acudx/protocol/openid-connect/token",
    end_session_endpoint: "https://idp.example.edu/realms/acudx/protocol/openid-connect/logout",
    userinfo_endpoint: null,
  },
  roles: ["student", "dean"],
  precedence: { student: 10, dean: 40 },
};

describe("PKCE helpers", () => {
  it("base64url round-trips and strips padding", () => {
    const s = base64Url(new Uint8Array([251, 255, 254, 0, 1]));
    expect(s).not.toMatch(/[+/=]/);
    expect(base64UrlDecode(base64Url(new TextEncoder().encode("hello world")))).toBe("hello world");
  });

  it("randomString yields a 43-char verifier for 32 bytes and is unique", () => {
    const a = randomString(32);
    const b = randomString(32);
    expect(a).toHaveLength(43);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("pkceChallenge is the RFC 7636 S256 transform", async () => {
    // Appendix B of RFC 7636
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(await pkceChallenge(verifier)).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    const v2 = randomString();
    const c2 = await pkceChallenge(v2);
    expect(c2).toHaveLength(43);
    expect(c2).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await pkceChallenge(v2)).toBe(c2);
  });

  it("buildAuthorizeUrl carries the public-client PKCE parameters", () => {
    const url = buildAuthorizeUrl(CFG, {
      redirectUri: "https://app.example/auth/callback",
      state: "st",
      codeChallenge: "ch",
      nonce: "n",
      extra: { kc_idp_hint: "uni-saml" },
    });
    expect(url).not.toBeNull();
    const u = new URL(url!);
    expect(u.origin + u.pathname).toBe(CFG.discovery!.authorization_endpoint);
    expect(Object.fromEntries(u.searchParams)).toEqual({
      response_type: "code",
      client_id: "acudx-web",
      redirect_uri: "https://app.example/auth/callback",
      scope: "openid profile email",
      state: "st",
      code_challenge: "ch",
      code_challenge_method: "S256",
      nonce: "n",
      kc_idp_hint: "uni-saml",
    });
    expect(buildAuthorizeUrl({ ...CFG, discovery: null }, { redirectUri: "x", state: "s", codeChallenge: "c" })).toBeNull();
  });

  it("parseCallback reads code/state/error with or without the question mark", () => {
    expect(parseCallback("?code=abc&state=xyz")).toEqual({ code: "abc", state: "xyz" });
    expect(parseCallback("error=access_denied&error_description=nope")).toEqual({
      error: "access_denied",
      error_description: "nope",
    });
  });

  it("decodeJwtPayload decodes without verifying and tolerates junk", () => {
    expect(decodeJwtPayload(jwt({ sub: "u", exp: 123 }))).toEqual({ sub: "u", exp: 123 });
    expect(decodeJwtPayload("garbage")).toBeNull();
    expect(decodeJwtPayload("a.!!.c")).toBeNull();
  });
});

describe("role derivation", () => {
  it("normalises aliases, drops unknowns and orders by precedence", () => {
    expect(normalizeRoles(["student", "Educator", "super-admin", "student", "x", 3])).toEqual([
      "super_admin",
      "faculty",
      "student",
    ]);
    expect(primaryRole([])).toBe("student");
    expect(primaryRole(["nurse", "dean"])).toBe("dean");
  });

  it("roleAtLeast follows the documented precedence", () => {
    expect(roleAtLeast(["dean"], "faculty")).toBe(true);
    expect(roleAtLeast(["faculty"], "dean")).toBe(false);
    expect(roleAtLeast(["super_admin"], "admin")).toBe(true);
    expect(roleAtLeast(["paramedic"], "student")).toBe(true);
    expect(roleAtLeast(["paramedic"], "resident")).toBe(false);
  });

  it("maps Keycloak and Supabase claim shapes", () => {
    const kc = { realm_access: { roles: ["faculty", "offline_access"] } };
    const sb = { app_metadata: { roles: "dean student" } };
    expect(claimAtPath(kc, "realm_access.roles")).toEqual(["faculty", "offline_access"]);
    expect(claimAtPath(kc, "nope.roles")).toBeUndefined();
    expect(rolesFromClaims(kc, "realm_access.roles")).toEqual(["faculty"]);
    expect(rolesFromClaims(sb, "app_metadata.roles")).toEqual(["dean", "student"]);
    expect(rolesFromClaims({ roles: { admin: true, dean: false } }, "roles")).toEqual(["admin"]);
    expect(rolesFromClaims({}, "roles")).toEqual([]);
  });
});

describe("session flow", () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = installSessionStorage();
    __resetAuthForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loadAuthConfig records the server mode and falls back to local when unreachable", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(CFG), { status: 200 }));
    expect(await loadAuthConfig(f as unknown as typeof fetch)).toEqual(CFG);
    expect(getAuthSession().mode).toBe("oidc");
    expect(getAuthSession().configLoaded).toBe(true);
    __resetAuthForTests();
    const down = vi.fn(async () => {
      throw new TypeError("network");
    });
    expect(await loadAuthConfig(down as unknown as typeof fetch)).toBeNull();
    expect(getAuthSession().mode).toBe("local");
    expect(getAuthSession().configLoaded).toBe(true);
  });

  it("completeSignIn exchanges the code with the PKCE verifier and keeps the token in memory only", async () => {
    storage.set(
      "acudx-oidc-pkce",
      JSON.stringify({ verifier: "ver", state: "st", nonce: "n", redirectUri: "https://app/auth/callback", returnTo: "/dean" }),
    );
    const token = jwt({ sub: "u-1", exp: Math.floor(Date.now() / 1000) + 300 });
    const calls: { url: string; body?: string; auth?: string }[] = [];
    const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: init?.body as string | undefined, auth: (init?.headers as Record<string, string>)?.Authorization });
      if (url.endsWith("/v1/auth/config")) return new Response(JSON.stringify(CFG));
      if (url.endsWith("/token")) return new Response(JSON.stringify({ access_token: token, refresh_token: "r-1", expires_in: 300 }));
      if (url.endsWith("/v1/auth/me"))
        return new Response(
          JSON.stringify({ sub: "u-1", email: "a@b", name: "Ayse", roles: ["dean", "student"], org: "acme", verified: true, mode: "oidc", primary_role: "dean" }),
        );
      return new Response("nf", { status: 404 });
    });
    const out = await completeSignIn("?code=the-code&state=st", f as unknown as typeof fetch);
    expect("principal" in out && out.principal.primary_role).toBe("dean");
    expect("returnTo" in out && out.returnTo).toBe("/dean");
    const tokenCall = calls.find((c) => c.url.endsWith("/token"))!;
    const params = new URLSearchParams(tokenCall.body);
    expect(params.get("grant_type")).toBe("authorization_code");
    expect(params.get("code")).toBe("the-code");
    expect(params.get("code_verifier")).toBe("ver");
    expect(params.get("client_id")).toBe("acudx-web");
    expect(params.get("redirect_uri")).toBe("https://app/auth/callback");
    expect(calls.find((c) => c.url.endsWith("/v1/auth/me"))!.auth).toBe(`Bearer ${token}`);
    expect(bearerHeader()).toEqual({ Authorization: `Bearer ${token}` });
    // PKCE material is consumed; refresh token is tab-scoped; the access token is nowhere in storage
    expect(storage.has("acudx-oidc-pkce")).toBe(false);
    expect(storage.get("acudx-oidc-refresh")).toBe("r-1");
    expect([...storage.values()].some((v) => v.includes(token))).toBe(false);
    expect(getAuthSession().status).toBe("signed-in");
    expect(getAuthSession().expiresAt).toBeGreaterThan(Date.now());
  });

  it("completeSignIn rejects a state mismatch and an IdP error", async () => {
    storage.set("acudx-oidc-pkce", JSON.stringify({ verifier: "v", state: "good", nonce: "n", redirectUri: "r", returnTo: "/" }));
    expect(await completeSignIn("?code=c&state=evil")).toEqual({ error: "state_mismatch" });
    expect(await completeSignIn("?error=access_denied&error_description=denied")).toEqual({ error: "denied" });
    expect(await completeSignIn("?state=only")).toEqual({ error: "missing_code" });
  });

  it("refreshAccessToken uses the tab-scoped refresh token and clears it on failure", async () => {
    storage.set("acudx-oidc-refresh", "r-old");
    const good = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/v1/auth/config")) return new Response(JSON.stringify(CFG));
      return new Response(JSON.stringify({ access_token: jwt({ exp: Math.floor(Date.now() / 1000) + 60 }), refresh_token: "r-new" }));
    });
    expect(await refreshAccessToken(good as unknown as typeof fetch)).toBe(true);
    expect(storage.get("acudx-oidc-refresh")).toBe("r-new");
    expect(bearerHeader().Authorization).toMatch(/^Bearer /);
    const bad = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/v1/auth/config") ? new Response(JSON.stringify(CFG)) : new Response("x", { status: 400 }),
    );
    expect(await refreshAccessToken(bad as unknown as typeof fetch)).toBe(false);
    expect(storage.has("acudx-oidc-refresh")).toBe(false);
    expect(bearerHeader()).toEqual({});
  });
});
