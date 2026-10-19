import { test, expect } from "@playwright/test";
import { createProfile, settle } from "./helpers/session";
import { watchConsole, boundaryTripped } from "./helpers/console";

/**
 * Team rooms: create a room, read its invite code, join from a second browser
 * context (a different device/person, synced over the ws relay on :8899), and
 * switch the acting role.
 */
test.describe("rooms", () => {
  test("create, join by code from a second context, switch role", async ({ browser, page }) => {
    const report = watchConsole(page);
    await createProfile(page, { role: "resident", fullName: "Host Resident" });

    await page.goto("/rooms");
    await settle(page);
    await page.getByRole("button", { name: "Create room" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Create room" }).click();
    await expect(page).toHaveURL(/\/rooms\/[^/]+$/);
    await settle(page);
    const roomUrl = page.url();

    // Invite code sits next to the copy button.
    const copyBtn = page.getByRole("button", { name: "Copy invite code" });
    await expect(copyBtn).toBeVisible();
    const code = (await copyBtn.locator("xpath=preceding-sibling::span[1]").innerText()).trim();
    expect(code, "invite code").toMatch(/^[A-Z0-9-]{4,}$/i);

    // Second person, second context.
    const ctx2 = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
    const p2 = await ctx2.newPage();
    const report2 = watchConsole(p2);
    await createProfile(p2, { role: "student", fullName: "Joining Student" });
    await p2.goto("/rooms");
    await settle(p2);
    await p2.getByLabel("Room code").fill(code);
    await p2.getByRole("button", { name: "Join", exact: true }).click();
    await expect(p2).toHaveURL(new RegExp(roomUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/^https?:\/\/[^/]+/, "") + "$"));
    await settle(p2);

    // The joiner's room title must match the host's (synced snapshot, not a placeholder).
    const hostTitle = await page.getByRole("heading", { level: 1 }).first().innerText();
    await expect(p2.getByRole("heading", { level: 1 }).first()).toHaveText(hostTitle, { timeout: 15_000 });
    // Host sees two seats filled.
    await expect(page.getByText(/2 of \d seats filled/)).toBeVisible({ timeout: 15_000 });

    // Role switch on the host.
    const switcher = page.getByRole("group", { name: "Switch role" });
    await expect(switcher).toBeVisible();
    await switcher.getByRole("button", { name: /Nurse/ }).click();
    await expect(switcher.getByRole("button", { name: /Nurse/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("heading", { name: "Acting as Nurse" })).toBeVisible();
    await switcher.getByRole("button", { name: /Doctor/ }).click();
    await expect(page.getByRole("heading", { name: "Acting as Doctor" })).toBeVisible();

    expect(await boundaryTripped(page)).toBe(false);
    expect(await boundaryTripped(p2)).toBe(false);
    expect(report.pageErrors).toEqual([]);
    expect(report2.pageErrors).toEqual([]);
    expect(report.errors).toEqual([]);
    expect(report2.errors).toEqual([]);
    await ctx2.close();
  });

  test("an unknown code is rejected with a message", async ({ page }) => {
    await createProfile(page, { role: "student" });
    await page.goto("/rooms");
    await settle(page);
    await page.getByLabel("Room code").fill("ZZZ-000");
    await page.getByRole("button", { name: "Join", exact: true }).click();
    await expect(page.getByText("No open room matches that code. Check it and try again.")).toBeVisible();
    await expect(page).toHaveURL(/\/rooms$/);
  });
});
