import { test, expect } from "@playwright/test";
import { createProfile, settle } from "./helpers/session";
import { watchConsole, boundaryTripped } from "./helpers/console";

/**
 * Educator authoring pipeline: generate an AI draft from the blueprint, step
 * into expert review, lock every drafted fact, and reach a publishable state.
 */
test.describe("authoring", () => {
  test("blueprint -> draft -> review -> lock all -> publish", async ({ page }) => {
    const report = watchConsole(page);
    await createProfile(page, { role: "educator", fullName: "Dr. Educator" });
    await page.goto("/authoring");
    await settle(page);
    await expect(page).toHaveURL(/\/authoring$/);

    const stepper = page.getByRole("navigation", { name: /Case authoring pipeline/ }).or(
      page.locator('[aria-label^="Case authoring pipeline"]'),
    );
    await expect(stepper.first()).toBeVisible();

    // Blueprint stage: generate a draft.
    await page.getByRole("button", { name: /Generate draft|Generate another draft/ }).click();
    await expect(page.getByRole("button", { name: "Generate another draft" })).toBeVisible({ timeout: 30_000 });

    // Draft handoff -> expert review.
    await page.getByRole("button", { name: "Next stage" }).click();
    await expect(page.getByText(/clinical facts? drafted/)).toBeVisible();
    await page.getByRole("button", { name: "Continue to expert review" }).or(page.getByRole("button", { name: "Next stage" })).first().click();

    // Review: lock every fact (as drafted, or ground-and-lock when flagged).
    const lockButtons = page.getByRole("button", { name: /^(Lock the .* fact as drafted|Ground and lock the flagged .* fact)$/ });
    const before = await lockButtons.count();
    expect(before, "facts awaiting a clinician").toBeGreaterThan(0);
    for (let guard = 0; guard < 200 && (await lockButtons.count()) > 0; guard++) {
      await lockButtons.first().click();
    }
    await expect(lockButtons).toHaveCount(0);
    await expect(page.getByText(/Every clinical fact is grounded and locked/)).toBeVisible();

    // Walk forward to sign-off and publish.
    for (let i = 0; i < 4; i++) {
      const publish = page.getByRole("button", { name: /Publish/ });
      if ((await publish.count()) > 0 && (await publish.first().isVisible())) break;
      await page.getByRole("button", { name: "Next stage" }).click();
    }
    const publish = page.getByRole("button", { name: /^Publish/ }).first();
    await expect(publish).toBeEnabled();
    await publish.click();
    await expect(page.getByRole("button", { name: /Monitor|monitor/ }).first()).toBeVisible({ timeout: 15_000 });

    expect(await boundaryTripped(page)).toBe(false);
    expect(report.pageErrors).toEqual([]);
    expect(report.errors).toEqual([]);
  });
});
