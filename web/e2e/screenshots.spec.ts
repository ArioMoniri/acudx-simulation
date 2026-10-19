import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createProfile, ROUTES, settle, routeSlug } from "./helpers/session";

/**
 * Capture every route at desktop (1920x1080) and mobile (390x844) into
 * web/e2e/__screenshots__/<route>-<project>.png. These are committed and
 * referenced by the README. Other projects skip.
 */
const OUT = join(dirname(fileURLToPath(import.meta.url)), "__screenshots__");

test.describe("screenshots", () => {
  test.skip(
    ({}, testInfo) => !["desktop", "mobile"].includes(testInfo.project.name),
    "desktop + mobile only",
  );

  test.beforeEach(async ({ page }) => {
    mkdirSync(OUT, { recursive: true });
    await createProfile(page, { role: "dean", fullName: "Dr. Deniz Yılmaz" });
  });

  for (const route of ROUTES.filter((r) => !r.includes("does-not-exist"))) {
    test(`capture ${route}`, async ({ page }, testInfo) => {
      await page.goto(route);
      await settle(page);
      await page.waitForTimeout(600);
      await page.screenshot({
        path: join(OUT, `${routeSlug(route)}-${testInfo.project.name}.png`),
        fullPage: false,
        animations: "disabled",
      });
    });
  }
});
