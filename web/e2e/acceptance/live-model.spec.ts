import { test, expect } from "@playwright/test";
import { captureApi, check, settle, shot, snapshot } from "./helpers";

/**
 * One extra student pass against a model-backed gateway (acceptance
 * 2026-10-20, docs/review/05 section "Live model pass"). Needs
 * ACCEPTANCE_LIVE_BASE_URL (a dev server proxying /api to that gateway),
 * ACCEPTANCE_LIVE_GATEWAY_URL and ACCEPTANCE_LIVE_ADMIN_TOKEN; skipped otherwise.
 */
const BASE = process.env.ACCEPTANCE_LIVE_BASE_URL;
const GW = process.env.ACCEPTANCE_LIVE_GATEWAY_URL ?? "http://127.0.0.1:8890";
const TOKEN = process.env.ACCEPTANCE_LIVE_ADMIN_TOKEN ?? "";

test.skip(!BASE, "live model pass only");

test("live model: fever case through the streaming generator", async ({ page }) => {
  test.setTimeout(900_000);
  const api = captureApi(page);
  await page.goto(`${BASE}/signin`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Create your profile" }).click();
  await page.getByLabel("Full name").fill("Deniz Live");
  await page.getByLabel("Role", { exact: true }).selectOption("student");
  await page.getByLabel("Institution").fill("AcuDx Acceptance Faculty");
  await page.getByRole("button", { name: "Create profile" }).click();
  await settle(page);
  await page.getByRole("link", { name: "Start", exact: true }).click();
  await settle(page);
  await page.getByRole("radio", { name: /^Infectious/ }).click();
  const t0 = Date.now();
  await page.getByRole("button", { name: "Begin encounter" }).click();

  // Watch the progress panel until the chart opens or the panel reports a failure.
  const strip = page.getByRole("tablist", { name: "Chart sections" });
  const timeline: string[] = [];
  let last = "";
  let shots = 0;
  while (Date.now() - t0 < 600_000) {
    if (await strip.isVisible().catch(() => false)) break;
    const panel = page.getByRole("status", { name: /Writing your case|Generating a case/ });
    const text = ((await panel.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
    if (text && text !== last) {
      timeline.push(`${Math.round((Date.now() - t0) / 1000)}s: ${text.slice(0, 220)}`);
      last = text;
      if (shots < 4) {
        await shot(page, `live-progress-${shots}`);
        shots += 1;
      }
    }
    if (await page.getByRole("button", { name: "Retry model generation" }).isVisible().catch(() => false)) break;
    await page.waitForTimeout(5_000);
  }
  const elapsed = Math.round((Date.now() - t0) / 1000);
  const opened = await strip.isVisible().catch(() => false);
  const s = await shot(page, "live-after-generation");
  check("L1", "Student (live)", "Streaming progress panel", "The opening streams field by field and the chart opens on opening.ready", timeline.length > 0, `${elapsed}s; ${timeline.join(" || ")}`, s);

  if (!opened) {
    check("L2", "Student (live)", "Case opens in the chart", "A model case opens", false, `no chart after ${elapsed}s`);
    return;
  }
  const note = (await page.getByRole("note", { name: /Case source:/ }).getAttribute("aria-label")) ?? "";
  const banner = ((await page.getByRole("note", { name: /Case source:/ }).textContent()) ?? "").replace(/\s+/g, " ");
  const main = ((await page.locator("main").textContent()) ?? "").replace(/\s+/g, " ");
  const vitals = /Presenting vitals.{0,120}?Temp\s*[\d.]+\s*°C/i.exec(main)?.[0] ?? "";
  const done = [...api].reverse().find((c) => c.path === "/v2/case/generate/stream");
  check("L2", "Student (live)", "Case opens with an honest banner", "Banner names model generation and the council verdict / degraded marker", /model generated/.test(note + banner), `banner: "${banner}"; ${vitals}; stream HTTP ${done?.status}`, await shot(page, "live-banner", false));

  // Usability: interview, orders and treatments.
  await page.getByRole("tablist", { name: "Chart sections" }).getByRole("tab", { name: "Interview" }).click();
  const composer = page.getByPlaceholder("Type a question to the patient, then press Enter");
  for (const q of ["When did the fever start?", "Have you had any shaking chills or rigors?", "Do you have any allergies to medicines?"]) {
    await composer.fill(q);
    await composer.press("Enter");
    await page.waitForTimeout(8_000);
  }
  const transcript = ((await page.getByRole("log", { name: "Encounter transcript" }).textContent()) ?? "").replace(/\s+/g, " ");
  await snapshot(page, "live-interview");
  check("L3", "Student (live)", "Interview on the model case", "Three answers from the persona model", /Patient/.test(transcript), transcript.slice(0, 400), await shot(page, "live-interview"));

  await page.getByRole("tablist", { name: "Chart sections" }).getByRole("tab", { name: "Orders" }).click();
  await page.getByRole("tab", { name: "Treatments" }).click();
  await page.waitForTimeout(800);
  await snapshot(page, "live-treatments");
  const tx = ((await page.getByRole("tabpanel", { name: "Treatments" }).textContent()) ?? "").replace(/\s+/g, " ");
  check("L4", "Student (live)", "Orders and treatments usable", "Formulary and case treatments listed", tx.length > 50, tx.slice(0, 300), await shot(page, "live-treatments"));

  // Admin telemetry on that gateway.
  const res = await fetch(`${GW}/admin/telemetry/summary?window=24h`, { headers: { "X-Admin-Token": TOKEN } });
  const body = (await res.json()) as { calls?: number; cost_usd?: number; by_route?: unknown; by_kind?: unknown; by_model?: unknown };
  check(
    "L5",
    "Admin (live)",
    "Telemetry on the live gateway shows the model calls",
    "Rows for the generator and the persona turns",
    res.status === 200 && (body.calls ?? 0) > 0,
    `HTTP ${res.status} calls=${body.calls} cost=${body.cost_usd} by_route=${JSON.stringify(body.by_route).slice(0, 400)} by_model=${JSON.stringify(body.by_model).slice(0, 200)}`,
  );
  await expect(strip).toBeVisible();
});
