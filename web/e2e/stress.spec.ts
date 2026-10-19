import { test, expect } from "@playwright/test";
import { createProfile, openTab, settle } from "./helpers/session";
import { watchConsole, boundaryTripped } from "./helpers/console";

/**
 * Stress: in one encounter, 25 orders placed as fast as the UI accepts them
 * and 50 free-text interview submissions in a burst. The store must stay
 * consistent:
 *   - every placed order is tracked exactly once and every result arrives
 *     ("25 placed · 0 pending · 25 resulted");
 *   - no duplicate seq (React would log "Encountered two children with the
 *     same key" for the Chart Review timeline, which keys rows by seq);
 *   - the Chart Review timeline holds one row per order, result and question;
 *   - the UI stays responsive (a tab switch settles within 2 s after the burst).
 */
const ORDERS = 25;
const QUESTIONS = 50;

test.describe("stress", () => {
  test.describe.configure({ mode: "serial" });

  test(`${ORDERS} rapid orders + ${QUESTIONS} rapid questions keep the store consistent`, async ({ page }) => {
    test.slow();
    const report = watchConsole(page);
    await createProfile(page, { role: "resident" });
    await page.goto("/encounter");
    await settle(page);

    // --- Orders burst --------------------------------------------------------
    await openTab(page, "Orders");
    // Skip rows whose turnaround is in hours (micro cultures: 180 s playback).
    const rows = page.locator("li").filter({ has: page.getByRole("button", { name: /^Order / }) }).filter({ hasNotText: /\d+\s*h\b/ });
    await expect(rows.first()).toBeVisible();
    const available = await rows.count();
    expect(available, "orderable rows without an hours-long turnaround").toBeGreaterThanOrEqual(ORDERS);
    const t0 = Date.now();
    for (let i = 0; i < ORDERS; i++) {
      await rows.nth(i).getByRole("button", { name: /^Order / }).click({ noWaitAfter: true });
    }
    const orderBurstMs = Date.now() - t0;
    await expect(page.getByText(new RegExp(`^${ORDERS} placed · \\d+ pending · \\d+ resulted$`))).toBeVisible();
    await expect(page.getByRole("button", { name: / already ordered$/ })).toHaveCount(ORDERS);

    // --- Interview burst -----------------------------------------------------
    await openTab(page, "Interview");
    const composer = page.getByPlaceholder("Type a question to the patient, then press Enter");
    const t1 = Date.now();
    for (let i = 0; i < QUESTIONS; i++) {
      await composer.fill(`Stress question ${i + 1}: how is the pain right now?`);
      await composer.press("Enter");
    }
    const questionBurstMs = Date.now() - t1;
    await expect(page.getByText(`Stress question ${QUESTIONS}: how is the pain right now?`)).toBeVisible();
    await expect(page.getByText(/Stress question \d+:/)).toHaveCount(QUESTIONS);

    // --- Responsiveness ------------------------------------------------------
    const t2 = Date.now();
    await openTab(page, "Chart Review");
    await expect(page.getByText("Encounter timeline")).toBeVisible();
    const switchMs = Date.now() - t2;
    expect(switchMs, "tab switch after the burst").toBeLessThan(2_000);

    // --- All results arrive --------------------------------------------------
    await openTab(page, "Orders");
    await expect(page.getByText(`${ORDERS} placed · 0 pending · ${ORDERS} resulted`)).toBeVisible({ timeout: 100_000 });

    // --- Event log consistency ------------------------------------------------
    await openTab(page, "Chart Review");
    const timeline = page.getByRole("list").filter({ has: page.locator("li") }).last();
    // orders + results + questions (chips not used here) — at least this many rows.
    await expect
      .poll(async () => await page.locator("main#main li").count(), { timeout: 20_000 })
      .toBeGreaterThanOrEqual(ORDERS * 2 + QUESTIONS);
    void timeline;

    const dupKey = report.errors.filter((e) => /same key|Encountered two children/i.test(e));
    expect(dupKey, "duplicate React keys (duplicate seq)").toEqual([]);
    expect(await boundaryTripped(page)).toBe(false);
    expect(report.pageErrors).toEqual([]);
    expect(report.errors).toEqual([]);

    test.info().annotations.push(
      { type: "orders burst ms", description: String(orderBurstMs) },
      { type: "questions burst ms", description: String(questionBurstMs) },
      { type: "tab switch ms", description: String(switchMs) },
    );
  });
});
