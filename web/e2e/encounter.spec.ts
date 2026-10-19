import { test, expect, type Page } from "@playwright/test";
import { createProfile, openTab, settle } from "./helpers/session";
import { watchConsole, boundaryTripped } from "./helpers/console";

/**
 * The full solo encounter loop, driven only through the UI:
 *   start -> 3 interview questions -> an exam maneuver -> a lab order and an
 *   imaging order -> wait for both results -> administer a treatment ->
 *   add + commit a diagnosis -> attending debrief -> Feedback page.
 */
async function askFreeText(page: Page, question: string) {
  const composer = page.getByPlaceholder("Type a question to the patient, then press Enter");
  await composer.fill(question);
  await composer.press("Enter");
  await expect(composer).toHaveValue("");
}

test.describe("encounter", () => {
  test("solo encounter from start to feedback", async ({ page }) => {
    test.slow(); // real result turnaround timers (18–30 s per order)
    const report = watchConsole(page);
    await createProfile(page, { role: "student" });

    // Start -> the default case opens in the EHR workspace.
    await page.goto("/encounter");
    await settle(page);
    const strip = page.getByRole("tablist", { name: "Chart sections" });
    await expect(strip).toBeVisible();

    // Interview: three typed questions + one intent chip, each produces a reply.
    await openTab(page, "Interview");
    const transcript = page.getByRole("log", { name: "Encounter transcript" }).or(
      page.locator('[aria-label="Encounter transcript"]'),
    );
    await askFreeText(page, "When did the pain start?");
    await askFreeText(page, "Where exactly is the pain and does it move anywhere?");
    await askFreeText(page, "Do you take any regular medications?");
    await expect(transcript.first().getByText("When did the pain start?")).toBeVisible();
    await expect(transcript.first().getByText("Do you take any regular medications?")).toBeVisible();
    // Patient replies arrive after the typing indicator.
    await expect
      .poll(async () => (await transcript.first().locator("p, li, div[role=listitem]").allInnerTexts()).length, {
        timeout: 15_000,
      })
      .toBeGreaterThanOrEqual(6);

    // Exam maneuver chip.
    await page.getByRole("button", { name: "Auscultate heart" }).click();
    await page.getByRole("button", { name: "Recheck vitals" }).click();

    // Orders: one lab (troponin) + one imaging (chest X-ray).
    await openTab(page, "Orders");
    const search = page.getByPlaceholder(/Search tests/);
    await search.fill("troponin");
    const troponin = page.getByRole("button", { name: /^Order .*troponin/i }).first();
    await expect(troponin).toBeVisible();
    const labName = (await troponin.getAttribute("aria-label"))!.replace(/^Order /, "");
    await troponin.click();
    await expect(page.getByRole("button", { name: `${labName} already ordered` })).toBeVisible();

    await search.fill("chest");
    const cxr = page.getByRole("button", { name: /^Order .*(X-ray|radiograph|chest)/i }).first();
    await expect(cxr).toBeVisible();
    const imgName = (await cxr.getAttribute("aria-label"))!.replace(/^Order /, "");
    await cxr.click();
    await expect(page.getByRole("button", { name: `${imgName} already ordered` })).toBeVisible();
    await search.fill("");

    // Order tracker: 2 placed; wait until both have resulted (real timers).
    await expect(page.getByText(/2 placed · \d+ pending · \d+ resulted/)).toBeVisible();
    await expect(page.getByText("2 placed · 0 pending · 2 resulted")).toBeVisible({ timeout: 90_000 });

    // Results tab shows both.
    await openTab(page, "Results");
    await expect(page.getByText("No results yet. Place an order to see results here.")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /Laboratory/ }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: /Imaging/ }).first()).toBeVisible();

    // Treatment: switch the Orders tab to Treatments and administer the first one.
    await openTab(page, "Orders");
    await page.getByRole("tab", { name: "Treatments" }).click();
    const administer = page.getByRole("button", { name: /^Administer / }).first();
    await expect(administer).toBeVisible();
    const txName = (await administer.getAttribute("aria-label"))!.replace(/^Administer /, "");
    await administer.click();
    await expect(page.getByText("1 given")).toBeVisible();
    await expect(page.getByRole("button", { name: `${txName} administered` })).toBeVisible();

    // Diagnosis: add a candidate to the differential and commit it.
    await openTab(page, /Problem List/);
    const dxSearch = page.getByPlaceholder("Search diagnoses or ICD/DSM code...");
    await dxSearch.fill("myocardial infarction");
    const add = page.getByRole("button", { name: /^Add .* to the differential$/ }).first();
    await expect(add).toBeVisible();
    const dxName = (await add.getAttribute("aria-label"))!.replace(/^Add /, "").replace(/ to the differential$/, "");
    await add.click();
    await page.getByRole("button", { name: `Commit ${dxName} as the working diagnosis` }).click();
    await expect(page.getByText(/Working diagnosis committed|Committed/).first()).toBeVisible();

    // Attending debrief -> full report (Feedback page).
    await page.getByRole("button", { name: "View attending debrief" }).click();
    await expect(page.getByRole("dialog", { name: /Attending debrief/ })).toBeVisible();
    await page.getByRole("button", { name: "View full report" }).click();
    await expect(page).toHaveURL(/\/feedback$/);
    await settle(page);

    expect(await boundaryTripped(page)).toBe(false);
    expect(report.pageErrors).toEqual([]);
    expect(report.errors).toEqual([]);
  });
});
