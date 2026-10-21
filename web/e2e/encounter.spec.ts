import { test, expect, type Page } from "@playwright/test";
import { createProfile, expectOnTab, openTab, settle } from "./helpers/session";
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
    // A reachable gateway whose model endpoint is down answers 503: the
    // workspace then shows the real error and asks the learner to choose. Take
    // the labelled template so the flow goes on; offline, the on-device case
    // starts at once and the strip is already there.
    const useTemplate = page.getByRole("button", { name: /^Use template case/ });
    await expect(strip.or(useTemplate)).toBeVisible({ timeout: 20_000 });
    if (await useTemplate.isVisible()) await useTemplate.click();
    await expect(strip).toBeVisible();

    // Interview: three typed questions + one intent chip, each produces a reply.
    await openTab(page, "Interview");
    const transcript = page.getByRole("log", { name: "Encounter transcript" });
    await expect(transcript).toBeVisible();
    await askFreeText(page, "When did the pain start?");
    await askFreeText(page, "Where exactly is the pain and does it move anywhere?");
    await askFreeText(page, "Do you take any regular medications?");
    // Offline path: each typed question is classified to an intent and rendered
    // as a doctor turn ("You") followed by the patient's reply ("Patient"), so
    // the transcript holds 3 doctor turns + 3 patient turns.
    const doctorTurns = transcript.getByRole("listitem").filter({ hasText: /^You/ });
    const patientTurns = transcript.getByRole("listitem").filter({ hasText: /^Patient/ });
    await expect(doctorTurns).toHaveCount(3);
    await expect(patientTurns).toHaveCount(3, { timeout: 15_000 });

    // Exam maneuver suggestions live in the collapsible suggestions drawer.
    const heart = page.getByRole("button", { name: "Auscultate heart" });
    if (!(await heart.isVisible())) await page.getByRole("button", { name: "Suggestions" }).click();
    await heart.click();
    await page.getByRole("button", { name: "Recheck vitals" }).click();

    // Orders: one lab (troponin) + one imaging (chest X-ray).
    await openTab(page, "Orders");
    const search = page.getByPlaceholder(/Search tests/);
    await search.fill("troponin");
    const troponin = page.getByRole("button", { name: /^Order .*troponin/i }).first();
    await expect(troponin).toBeVisible();
    const labLabel = (await troponin.getAttribute("aria-label"))!;
    await troponin.click();
    // Placed: the "Order X" control is replaced by "Repeat X" (serial tests) or
    // "X already ordered" (single-draw tests).
    await expect(page.getByRole("button", { name: labLabel, exact: true })).toHaveCount(0);
    await expect(page.getByText(/1 placed · \d+ pending · \d+ resulted/)).toBeVisible();

    await search.fill("chest");
    const cxr = page.getByRole("button", { name: /^Order .*(X-ray|radiograph|chest)/i }).first();
    await expect(cxr).toBeVisible();
    const imgLabel = (await cxr.getAttribute("aria-label"))!;
    await cxr.click();
    await expect(page.getByRole("button", { name: imgLabel, exact: true })).toHaveCount(0);
    await search.fill("");

    // Order tracker: 2 placed; wait until both have resulted (real timers).
    // A landing result advances the store stage and the tab strip follows it to
    // Results (see handoff finding), so re-open Orders before each check.
    await expectOnTab(page, "Orders", page.getByText(/2 placed · \d+ pending · \d+ resulted/), 15_000);
    await expectOnTab(page, "Orders", page.getByText("2 placed · 0 pending · 2 resulted"), 90_000);

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
    await administer.click();
    // A medication is never given by a bare click (clinical review 02, finding
    // 9): Administer opens the dose / route / indication form prefilled from the
    // formulary, and "Give" submits it through the five-rights + allergy check.
    const give = page.getByRole("button", { name: /^Confirm and administer / }).first();
    await expect(give).toBeVisible();
    await give.click();
    // Treatments are repeatable, so the control keeps its "Administer" label
    // and the given-count badge + MAR line record the dose.
    await expect(page.getByText("1 given")).toBeVisible();

    // Diagnosis: add a candidate to the differential and commit it.
    await openTab(page, /Problem List/);
    const dxSearch = page.getByPlaceholder("Search diagnoses or ICD/DSM code...");
    await dxSearch.fill("myocardial infarction");
    const add = page.getByRole("button", { name: /^Add .* to the differential$/ }).first();
    await expect(add).toBeVisible();
    const dxName = (await add.getAttribute("aria-label"))!.replace(/^Add /, "").replace(/ to the differential$/, "");
    await add.click();
    await page.getByRole("button", { name: `Commit ${dxName} as the working diagnosis` }).click();
    // The verdict panel replaces the commit control; its debrief entry point is
    // the stable signal that the diagnosis was committed.
    await expect(page.getByRole("button", { name: "View attending debrief" })).toBeVisible();

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
