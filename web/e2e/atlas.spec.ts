import { test, expect } from "@playwright/test";
import { createProfile, settle } from "./helpers/session";
import { watchConsole, boundaryTripped } from "./helpers/console";

/**
 * Anatomy atlas: cross-section viewer controls (plane, window preset, level
 * slider, organ legend) and the 3D organ view toggle.
 */
test.describe("atlas", () => {
  test("cross-section controls and 3D toggle work", async ({ page }) => {
    const report = watchConsole(page);
    await createProfile(page, { role: "student" });
    await page.goto("/atlas");
    await settle(page);

    const modes = page.getByRole("tablist", { name: "Atlas view" });
    await expect(modes).toBeVisible();
    await expect(modes.getByRole("tab", { name: "Cross-section" })).toHaveAttribute("aria-selected", "true");

    // Level slider moves.
    const slider = page.getByRole("slider").first();
    await expect(slider).toBeVisible();
    const min = Number(await slider.getAttribute("min"));
    const max = Number(await slider.getAttribute("max"));
    expect(max).toBeGreaterThan(min);
    await slider.fill(String(Math.round((min + max) / 2)));
    await expect(slider).toHaveValue(String(Math.round((min + max) / 2)));

    // Window presets + planes are radio-like button groups.
    const windowGroup = page.getByRole("group", { name: "Window preset" }).or(page.locator('[aria-label="Window preset"]'));
    const presets = windowGroup.first().getByRole("button");
    const presetCount = await presets.count();
    expect(presetCount).toBeGreaterThan(1);
    await presets.nth(1).click();

    // Organ legend: hide all then show all keeps the page alive.
    const legendButtons = page.getByRole("button", { name: /Hide all|Show all/ });
    if ((await legendButtons.count()) >= 2) {
      await page.getByRole("button", { name: /Hide all/ }).click();
      await page.getByRole("button", { name: /Show all/ }).click();
    }

    // 3D organs: canvas mounts (WebGL via three.js, swiftshader in headless).
    await modes.getByRole("tab", { name: "3D organs" }).click();
    await expect(modes.getByRole("tab", { name: "3D organs" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole("slider", { name: "Cut level" }).fill("50").catch(() => {});

    await modes.getByRole("tab", { name: "Cross-section" }).click();
    await expect(slider).toBeVisible();

    expect(await boundaryTripped(page)).toBe(false);
    expect(report.pageErrors).toEqual([]);
    expect(report.errors).toEqual([]);
  });
});
