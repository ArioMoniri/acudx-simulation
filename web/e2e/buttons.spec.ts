import { test, expect } from "@playwright/test";
import { createProfile, ROUTES, settle } from "./helpers/session";
import { watchConsole, boundaryTripped } from "./helpers/console";

/**
 * Button crawler: on each route, in a fresh page, click every enabled
 * <button> / [role=button] once. After every click: no uncaught exception, no
 * ErrorBoundary card. A click that navigates away is followed by a return to
 * the route so the remaining buttons are still reachable; a click that opens a
 * dialog is followed by Escape.
 *
 * The crawl is bounded (MAX_CLICKS) so a route with hundreds of chips (Orders,
 * Interview) stays inside the test budget; the count clicked is attached.
 */
const MAX_CLICKS = 120;
const SELECTOR = 'button:enabled, [role="button"]:not([aria-disabled="true"])';

test.describe("buttons", () => {
  test.beforeEach(async ({ page }) => {
    await createProfile(page, { role: "dean" });
  });

  for (const route of ROUTES.filter((r) => !r.includes("does-not-exist"))) {
    test(`click every button on ${route}`, async ({ page }, testInfo) => {
      const report = watchConsole(page);
      await page.goto(route);
      await settle(page);

      const seen = new Set<string>();
      let clicked = 0;
      let skipped = 0;
      for (let i = 0; i < MAX_CLICKS; i++) {
        const buttons = page.locator(SELECTOR);
        const total = await buttons.count();
        if (i >= total) break;
        const btn = buttons.nth(i);
        // A stable-ish identity so re-renders don't make us click one twice.
        const id = await btn
          .evaluate(
            (el) =>
              `${el.tagName}|${el.getAttribute("aria-label") ?? ""}|${(el.textContent ?? "").trim().slice(0, 60)}`,
          )
          .catch(() => `#${i}`);
        if (seen.has(id)) continue;
        seen.add(id);
        if (!(await btn.isVisible().catch(() => false))) {
          skipped++;
          continue;
        }
        // Never sign out / reset mid-crawl: those remove the session the crawl relies on.
        if (/sign out|reset|remove|delete|clear data/i.test(id)) {
          skipped++;
          continue;
        }
        try {
          await btn.scrollIntoViewIfNeeded({ timeout: 2_000 });
          await btn.click({ timeout: 3_000, noWaitAfter: true });
          clicked++;
        } catch {
          skipped++;
          continue;
        }
        await page.waitForTimeout(150);
        expect(await boundaryTripped(page), `ErrorBoundary after clicking ${id}`).toBe(false);
        expect(report.pageErrors, `uncaught exception after clicking ${id}`).toEqual([]);

        const url = new URL(page.url());
        if (url.pathname !== route) {
          await page.goto(route);
          await settle(page);
        } else if ((await page.locator('[role="dialog"]').count()) > 0) {
          await page.keyboard.press("Escape");
          await page.waitForTimeout(100);
        }
      }
      await testInfo.attach("crawl", {
        body: `route=${route} clicked=${clicked} skipped=${skipped} unique=${seen.size}`,
        contentType: "text/plain",
      });
      expect(clicked, "at least one button clicked").toBeGreaterThan(0);
    });
  }
});
