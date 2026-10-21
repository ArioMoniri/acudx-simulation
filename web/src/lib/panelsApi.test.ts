// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * Review 04 O2: in local mode the server caps header principals at resident. The panel
 * client adds X-Admin-Token only when an operator signed in to the admin console in this
 * tab and a local profile is active; a bearer (SSO) always wins and never carries it.
 */
const auth = vi.hoisted(() => ({ token: null as string | null, refreshable: false, refreshed: null as string | null }));
const profile = vi.hoisted(() => ({ headers: {} as Record<string, string> }));

vi.mock("@/lib/auth", () => ({
  hasAccessToken: () => auth.token !== null,
  canRefreshAccessToken: () => auth.refreshable,
  ensureAccessToken: async () => {
    if (auth.token === null && auth.refreshable) auth.token = auth.refreshed;
    return auth.token;
  },
  bearerHeader: () => (auth.token ? { Authorization: `Bearer ${auth.token}` } : {}),
}));
vi.mock("@/state/profileStore", () => ({
  getProfileState: () => ({}),
  localIdentityHeaders: () => profile.headers,
}));

import { ADMIN_TOKEN_KEY } from "@/lib/adminApi";
import { identityHeaders } from "@/lib/panelsApi";

afterEach(() => {
  auth.token = null;
  auth.refreshable = false;
  auth.refreshed = null;
  profile.headers = {};
  sessionStorage.clear();
});

describe("identityHeaders (local mode role cap)", () => {
  it("sends only the local profile headers when no admin token is held", async () => {
    profile.headers = { "X-User-Id": "loc-1", "X-User-Role": "dean" };
    expect(await identityHeaders()).toEqual({ "X-User-Id": "loc-1", "X-User-Role": "dean" });
  });

  it("adds X-Admin-Token from the admin console session so privileged panels open", async () => {
    profile.headers = { "X-User-Id": "loc-1", "X-User-Role": "faculty" };
    sessionStorage.setItem(ADMIN_TOKEN_KEY, "adm-secret");
    const h = await identityHeaders();
    expect(h["X-Admin-Token"]).toBe("adm-secret");
    expect(h["X-User-Role"]).toBe("faculty");
  });

  it("never attaches the admin token without a local profile or next to a bearer", async () => {
    sessionStorage.setItem(ADMIN_TOKEN_KEY, "adm-secret");
    expect(await identityHeaders()).toEqual({});
    auth.token = "jwt";
    profile.headers = { "X-User-Id": "loc-1", "X-User-Role": "faculty" };
    expect(await identityHeaders()).toEqual({ Authorization: "Bearer jwt" });
  });

  it("after a page reload (no token in memory, a refresh token in the tab) it refreshes and sends the bearer", async () => {
    // Live finding 2026-10-21 on the production stack: reloading /encounter started the case with
    // no bearer (401 unauthenticated) because the in-memory token was gone until the next refresh.
    auth.refreshable = true;
    auth.refreshed = "jwt-after-reload";
    expect(await identityHeaders()).toEqual({ Authorization: "Bearer jwt-after-reload" });
  });
});
