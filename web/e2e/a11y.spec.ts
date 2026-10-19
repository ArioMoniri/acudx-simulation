import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createProfile, ROUTES, settle } from "./helpers/session";

/**
 * Accessibility smoke: axe-core on every route. Violations of impact
 * serious/critical fail the test; minor/moderate are attached to the report
 * and logged so they stay visible without blocking.
 */
test.describe("a11y", () => {
  test.beforeEach(async ({ page }) => {
    await createProfile(page, { role: "dean" });
  });

  for (const route of ROUTES) {
    test(`axe ${route}`, async ({ page }, testInfo) => {
      await page.goto(route);
      await settle(page);

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
        .analyze();

      const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      const advisory = results.violations.filter((v) => !blocking.includes(v));

      const describe = (v: (typeof results.violations)[number]) =>
        `${v.id} [${v.impact}] ${v.help} — ${v.nodes.length} node(s): ${v.nodes
          .slice(0, 3)
          .map((n) => n.target.join(" "))
          .join(" | ")}`;

      if (advisory.length) {
        const text = advisory.map(describe).join("\n");
        await testInfo.attach(`axe-advisory-${route}`, { body: text, contentType: "text/plain" });
        console.log(`[a11y advisory] ${route} (${testInfo.project.name})\n${text}`);
      }
      expect(blocking.map(describe), "serious/critical axe violations").toEqual([]);
    });
  }
});
