// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import {
  applyVerifiedIdentity,
  createProfile,
  getProfileState,
  localIdentityHeaders,
  normalizeProfileRole,
  resetProfile,
  updateProfile,
} from "./profileStore";

describe("profileStore role derivation", () => {
  beforeEach(() => {
    resetProfile();
  });

  it("normalises legacy role spellings", () => {
    expect(normalizeProfileRole("educator")).toBe("faculty");
    expect(normalizeProfileRole("super-admin")).toBe("super_admin");
    expect(normalizeProfileRole("dean")).toBe("dean");
    expect(normalizeProfileRole("chancellor")).toBeNull();
  });

  it("derives a verified profile from the server principal and locks identity fields", () => {
    const p = applyVerifiedIdentity({
      sub: "kc-123",
      email: "d@uni.edu",
      name: "Deniz Dean",
      roles: ["dean", "faculty", "student"],
      org: "acme-med",
      primary_role: "dean",
    });
    expect(p.verified).toBe(true);
    expect(p.role).toBe("dean");
    expect(p.roles).toEqual(["dean", "faculty", "student"]);
    expect(p.institution).toBe("acme-med");
    expect(p.fullName).toBe("Deniz Dean");
    expect(getProfileState().active).toBe(true);
    // identity fields cannot be edited on a verified profile; preferences can
    updateProfile({ role: "super_admin", fullName: "Someone Else", language: "tr", specialty: "EM" });
    const after = getProfileState().profile!;
    expect(after.role).toBe("dean");
    expect(after.fullName).toBe("Deniz Dean");
    expect(after.language).toBe("tr");
    expect(after.specialty).toBe("EM");
    // bearer-less headers for a verified profile still carry the role for telemetry context
    expect(localIdentityHeaders()).toMatchObject({ "X-User-Role": "dean", "X-Tenant": "acme-med" });
  });

  it("falls back to student when the principal carries no known role", () => {
    const p = applyVerifiedIdentity({ sub: "x", email: null, name: null, roles: [], org: "o", primary_role: "wizard" });
    expect(p.role).toBe("student");
    expect(p.roles).toEqual(["student"]);
    expect(p.fullName).toBe("x");
  });

  it("local profiles are unverified and send pseudonymous headers", () => {
    const p = createProfile({ fullName: "Local Learner", role: "resident", institution: "Demo Uni", language: "en", avatarSeed: "aster" });
    expect(p.verified).toBe(false);
    expect(p.localId).toMatch(/^local-/);
    const h = localIdentityHeaders();
    expect(h["X-User-Id"]).toBe(p.localId);
    expect(h["X-User-Role"]).toBe("resident");
    expect(h["X-Tenant"]).toBe("demo-uni");
    // a local profile may change its role (AUTH_MODE=local semantics live in the UI gate)
    updateProfile({ role: "faculty" });
    expect(getProfileState().profile!.role).toBe("faculty");
    // signing in through the IdP later keeps the same localId and preferences
    const v = applyVerifiedIdentity({ sub: "s", email: "e@x", name: "Verified", roles: ["faculty"], org: "org", primary_role: "faculty" });
    expect(v.localId).toBe(p.localId);
    expect(v.avatarSeed).toBe("aster");
  });
});
