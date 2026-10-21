import { describe, expect, it } from "vitest";
import { breadcrumbsFor, navItemsFor, primaryTabsFor } from "./navigation";

describe("navItemsFor", () => {
  it("gives the learner the solo loop and nothing role-gated", () => {
    const paths = navItemsFor("learner").map((i) => i.to);
    expect(paths).toEqual(["/", "/start", "/cases", "/rooms", "/exam", "/atlas", "/feedback", "/progress"]);
    expect(paths).not.toContain("/authoring");
    expect(paths).not.toContain("/admin");
  });

  it("gives the educator authoring and faculty", () => {
    const paths = navItemsFor("educator").map((i) => i.to);
    expect(paths).toContain("/authoring");
    expect(paths).toContain("/faculty");
    expect(paths).not.toContain("/dean");
  });

  it("gives the dean the institution dashboard", () => {
    expect(navItemsFor("dean").map((i) => i.to)).toContain("/dean");
  });

  it("exposes the operator console only to the admin vantage", () => {
    expect(navItemsFor("admin").map((i) => i.to)).toContain("/admin");
    for (const role of ["learner", "educator", "dean"] as const) {
      expect(navItemsFor(role).map((i) => i.to)).not.toContain("/admin");
    }
  });

  it("marks only Home as an exact match", () => {
    const items = navItemsFor("learner");
    expect(items.find((i) => i.to === "/")?.end).toBe(true);
    expect(items.filter((i) => i.end)).toHaveLength(1);
  });
});

describe("primaryTabsFor", () => {
  it("keeps the first four items for the bottom tab bar and moves the rest to More", () => {
    const { primary, overflow } = primaryTabsFor("learner");
    expect(primary.map((i) => i.to)).toEqual(["/", "/start", "/cases", "/rooms"]);
    expect(overflow.map((i) => i.to)).toEqual(["/exam", "/atlas", "/feedback", "/progress"]);
  });

  it("shows up to five tabs without a More entry when everything fits", () => {
    const { primary, overflow } = primaryTabsFor("dean");
    expect(primary.length).toBeLessThanOrEqual(5);
    expect(overflow).toEqual([]);
    expect(primary.length + overflow.length).toBe(navItemsFor("dean").length);
  });
});

describe("breadcrumbsFor", () => {
  it("returns only Home on the home route", () => {
    expect(breadcrumbsFor("/", "learner")).toEqual([{ to: "/", key: "nav.home" }]);
  });

  it("builds Home, then the matching nav item for a top-level route", () => {
    expect(breadcrumbsFor("/cases", "learner")).toEqual([
      { to: "/", key: "nav.home" },
      { to: "/cases", key: "nav.cases" },
    ]);
  });

  it("resolves routes outside the nav to their own label key", () => {
    expect(breadcrumbsFor("/encounter", "learner")).toEqual([
      { to: "/", key: "nav.home" },
      { to: "/encounter", key: "nav.encounter" },
    ]);
    expect(breadcrumbsFor("/account", "learner")).toEqual([
      { to: "/", key: "nav.home" },
      { to: "/account", key: "nav.account" },
    ]);
  });

  it("treats /institution as the institution dashboard", () => {
    expect(breadcrumbsFor("/institution", "dean").at(-1)).toEqual({ to: "/institution", key: "nav.institution" });
  });

  it("falls back to Home alone for an unknown route", () => {
    expect(breadcrumbsFor("/this-route-does-not-exist", "learner")).toEqual([{ to: "/", key: "nav.home" }]);
  });
});


describe("homePathForRole", () => {
  it("sends each staff role to its panel and learners home", async () => {
    const { homePathForRole } = await import("@/lib/navigation");
    expect(homePathForRole("super_admin")).toBe("/admin");
    expect(homePathForRole("admin")).toBe("/admin");
    expect(homePathForRole("dean")).toBe("/dean");
    expect(homePathForRole("faculty")).toBe("/faculty");
    for (const r of ["resident", "student", "nurse", "paramedic", undefined]) expect(homePathForRole(r)).toBe("/");
  });
});
