import { test, expect } from "@playwright/test";
import { createProfile, ROUTES, settle } from "./helpers/session";
import { watchConsole, boundaryTripped } from "./helpers/console";

/**
 * Every route in web/src/App.tsx renders for a signed-in dean (the role that
 * passes both RoleGates) without console errors, without tripping the
 * ErrorBoundary, and without horizontal overflow at the project's viewport.
 */
test.describe("routes", () => {
  test.beforeEach(async ({ page }) => {
    await createProfile(page, { role: "dean" });
  });

  for (const route of ROUTES) {
    test(`${route} renders cleanly`, async ({ page }) => {
      const report = watchConsole(page);
      await page.goto(route);
      await settle(page);

      expect(await boundaryTripped(page), "ErrorBoundary tripped").toBe(false);

      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth, `horizontal overflow on ${route}`).toBeLessThanOrEqual(clientWidth);

      expect(report.pageErrors, "uncaught exceptions").toEqual([]);
      expect(report.errors, "console.error output").toEqual([]);
    });
  }

  test("/signin redirects a signed-in user to Home", async ({ page }) => {
    await page.goto("/signin");
    await expect(page).toHaveURL(/\/$/);
  });

  test("role gates refuse a student on /authoring and /institution with a notice", async ({ browser, page }) => {
    // Acceptance 2026-10-20 D-21: a refused page names the role it needs instead of a
    // silent redirect; the protected content must not render.
    const fresh = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
    const p2 = await fresh.newPage();
    await createProfile(p2, { role: "student" });
    for (const path of ["/authoring", "/institution"]) {
      await p2.goto(path);
      const notice = p2.getByRole("alert").filter({ has: p2.locator("#role-gate-title") });
      await expect(notice).toBeVisible();
      await expect(p2.locator("#role-gate-title")).not.toBeEmpty();
    }
    await fresh.close();
  });
});
