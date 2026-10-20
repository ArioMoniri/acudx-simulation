import { test, expect } from "@playwright/test";
import { createProfile, expectOnTab, openTab, settle } from "./helpers/session";
import { watchConsole, boundaryTripped } from "./helpers/console";

/**
 * Stress: in one encounter, 50 free-text interview submissions in a burst and
 * 25 orders placed as fast as the UI accepts them. The store must stay
 * consistent:
 *   - the transcript holds one doctor turn + one patient turn per question;
 *   - every placed order is tracked exactly once and every result arrives
 *     ("25 placed · 0 pending · 25 resulted");
 *   - no duplicate seq (React would log "Encountered two children with the
 *     same key" for the Chart Review timeline, which keys rows by seq);
 *   - the Chart Review timeline holds one row per order, result and question;
 *   - the UI stays responsive (a tab switch settles within 2 s after the burst).
 *
 * Order clicks use `force` because the Orders list re-renders every second
 * (ETA countdowns), which otherwise trips Playwright's "stable" actionability
 * check mid-burst; that is exactly the condition under stress. Tab checks go
 * through `expectOnTab` because a landing result moves the tab strip to
 * Results on its own (product finding in the tester handoff).
 */
const ORDERS = 25;
const QUESTIONS = 50;

test.describe("stress", () => {
  test(`${QUESTIONS} rapid questions + ${ORDERS} rapid orders keep the store consistent`, async ({ page }) => {
    test.slow();
    const report = watchConsole(page);
    await createProfile(page, { role: "resident" });
    await page.goto("/encounter");
    await settle(page);

    // --- Interview burst (no results pending yet, so the tab stays put) --------
    await openTab(page, "Interview");
    const transcript = page.getByRole("log", { name: "Encounter transcript" });
    const composer = page.getByPlaceholder("Type a question to the patient, then press Enter");
    await expect(composer).toBeVisible();
    const t1 = Date.now();
    for (let i = 0; i < QUESTIONS; i++) {
      await composer.fill(`Stress question ${i + 1}: how severe is the pain right now?`);
      await composer.press("Enter");
    }
    const questionBurstMs = Date.now() - t1;
    const doctorTurns = transcript.getByRole("listitem").filter({ hasText: /^You/ });
    const patientTurns = transcript.getByRole("listitem").filter({ hasText: /^Patient/ });
    await expect(doctorTurns).toHaveCount(QUESTIONS);
    await expect(patientTurns).toHaveCount(QUESTIONS, { timeout: 30_000 });

    // --- Orders burst --------------------------------------------------------
    await openTab(page, "Orders");
    // Pick 25 orderables up front, skipping rows whose turnaround is in hours
    // (micro cultures: 180 s playback) so "all results arrive" fits the budget.
    const rows = page
      .locator("li")
      .filter({ has: page.getByRole("button", { name: /^Order / }) })
      .filter({ hasNotText: /\d+\s*h\b/ });
    await expect(rows.first()).toBeVisible();
    const labels = await rows
      .getByRole("button", { name: /^Order / })
      .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? ""));
    const targets = labels.filter(Boolean).slice(0, ORDERS);
    expect(targets.length, "orderable rows without an hours-long turnaround").toBe(ORDERS);

    const t0 = Date.now();
    for (const label of targets) {
      // Re-open Orders in case an early (6 s) point-of-care result moved the tab.
      if (!(await page.getByRole("tab", { name: /^Orders/ }).getAttribute("aria-selected").then((v) => v === "true"))) {
        await openTab(page, /^Orders/);
      }
      await page.getByRole("button", { name: label, exact: true }).click({ force: true, noWaitAfter: true });
    }
    const orderBurstMs = Date.now() - t0;
    await expectOnTab(page, /^Orders/, page.getByText(new RegExp(`^${ORDERS} placed · \\d+ pending · \\d+ resulted$`)), 15_000);
    // Every target is now placed: its "Order <name>" button is gone (it reads
    // "Repeat <name>" or "<name> already ordered"), and none was placed twice.
    for (const label of targets) {
      await expect(page.getByRole("button", { name: label, exact: true })).toHaveCount(0);
    }

    // --- Responsiveness ------------------------------------------------------
    const t2 = Date.now();
    await openTab(page, "Chart Review");
    await expect(page.getByText("Encounter timeline")).toBeVisible();
    const switchMs = Date.now() - t2;
    expect(switchMs, "tab switch after the burst").toBeLessThan(2_000);

    // --- All results arrive --------------------------------------------------
    await expectOnTab(page, /^Orders/, page.getByText(`${ORDERS} placed · 0 pending · ${ORDERS} resulted`), 100_000);

    // --- Event log consistency ------------------------------------------------
    // The Chart Review timeline renders the event-sourced log (one row per
    // question, order and result event). It must agree with the tracker above:
    // every placed order that the tracker reports as resulted must also have a
    // result event, because grading, debrief and progress read the log, not
    // the tracker's clock.
    await openTab(page, "Chart Review");
    const timeline = page.getByRole("list").filter({ hasText: /Asked about/ }).last();
    const rowsAsked = timeline.getByRole("listitem").filter({ hasText: /Asked about/ });
    const rowsOrdered = timeline.getByRole("listitem").filter({ hasText: /^Ordered /m });
    const rowsResulted = timeline.getByRole("listitem").filter({ hasText: /^Result returned/m });
    await expect(rowsAsked, "question events").toHaveCount(QUESTIONS);
    await expect(rowsOrdered, "order events").toHaveCount(ORDERS);
    await expect(rowsResulted, "result events (one per resulted order)").toHaveCount(ORDERS, { timeout: 20_000 });

    const dupKey = report.errors.filter((e) => /same key|Encountered two children/i.test(e));
    expect(dupKey, "duplicate React keys (duplicate seq)").toEqual([]);
    expect(await boundaryTripped(page)).toBe(false);
    expect(report.pageErrors).toEqual([]);
    expect(report.errors).toEqual([]);

    test.info().annotations.push(
      { type: "questions burst ms", description: String(questionBurstMs) },
      { type: "orders burst ms", description: String(orderBurstMs) },
      { type: "tab switch ms", description: String(switchMs) },
    );
  });
});
