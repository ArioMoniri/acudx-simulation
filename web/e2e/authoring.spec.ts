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

    // Jump to the sign-off stage via the stepper. Publish is gated on the
    // credentialed clinician's co-sign (the educator profile created above).
    await page.getByRole("button", { name: /^Go to the Publish and version stage/ }).click();
    const publish = page.getByRole("button", { name: "Publish case" });
    await expect(publish).toBeDisabled();
    await expect(page.getByText("Publish is blocked until the credentialed clinician co-signs.")).toBeVisible();
    await page
      .getByLabel("I am the credentialed clinician of record and I approve this case for publication.")
      .check();
    await expect(publish).toBeEnabled();
    await publish.click();
    // Publishing freezes the case and advances the pipeline to Monitor, where the
    // new case is listed as published in this session.
    await expect(page.getByRole("button", { name: /^Go to the Monitor stage, Complete/ })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("table", { name: "Published and monitored cases" })).toBeVisible();
    await expect(page.getByText("Just published in this session")).toBeVisible();

    expect(await boundaryTripped(page)).toBe(false);
    expect(report.pageErrors).toEqual([]);
    expect(report.errors).toEqual([]);
  });
});
