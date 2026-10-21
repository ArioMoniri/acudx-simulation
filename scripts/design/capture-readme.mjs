// Capture the README hero, feature and panel images from the running app.
//
//   bash <gateway>   # uvicorn server.app:app with ADMIN_TOKEN and ACUDX_DB_PATH (see video/README.md)
//   API_PROXY_TARGET=http://127.0.0.1:8931 npm --prefix web run dev -- --port 4205 --strictPort --host 127.0.0.1
//   GATEWAY_DB=<ACUDX_DB_PATH> ADMIN_TOKEN=<token> node scripts/design/capture-readme.mjs   # raw PNGs into docs/media/readme/raw/
//   python3 scripts/design/readme-media.py                                                  # optimise into docs/media/readme/
//
// Everything is a plain screenshot of the real UI: no cursor overlay, no
// caption bar, no crop that cuts text. The case is model generated: the
// generate request is answered with the recorded live model case the e2e
// suite replays (web/e2e/helpers/liveCase.ts, server/tests/fixtures/live),
// paced as the staged generator writes it (video/scripts/staged-replay.mjs),
// and the same thread is stored in the local gateway's CaseStore
// (video/scripts/seed-thread.py), so the patient turn, results engine,
// Clinical Director, telemetry and dean analytics are the real gateway's.
// Without GATEWAY_DB the rest of /api is aborted as in
// web/e2e/helpers/session.ts and the panels show their offline states.
//
// The learner asks for a fever case on the Start page, interviews the patient,
// places orders, gives fluids, oxygen and an antibiotic (each a Director step),
// waits for the results, commits a diagnosis and opens the feedback report;
// the panels are taken after switching the local profile to the admin role
// and signing in to the admin console with ADMIN_TOKEN.
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LIVE_CASES } from "../../web/e2e/helpers/liveCase.ts";
import { installStagedReplay } from "../../video/scripts/staged-replay.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const require = createRequire(join(repo, "web", "package.json"));
const { chromium } = require("playwright-core");

const out = resolve(repo, "docs/media/readme/raw");
const base = process.env.ACUDX_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 4205}`;
const GATEWAY_DB = process.env.GATEWAY_DB;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const PYTHON = process.env.GATEWAY_PYTHON ?? "python3";
const DARK = process.env.SCHEME === "dark";
const CASE = LIVE_CASES.find((c) => c.spec.meta.condition_id === "sepsis_uncomplicated") ?? LIVE_CASES[0];
mkdirSync(out, { recursive: true });

function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers";
  const dir = readdirSync(root)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort()
    .at(-1);
  const bin = join(root, dir, "chrome-linux", "chrome");
  if (!existsSync(bin)) throw new Error(`no chromium under ${root}`);
  return bin;
}

const browser = await chromium.launch({ executablePath: chromiumPath(), headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: process.env.SCHEME ?? "light",
  reducedMotion: "reduce",
  locale: "en-US",
  timezoneId: "Europe/Istanbul",
});
if (!GATEWAY_DB) {
  // Only the gateway proxy (/api/... at the path root): the "**/api/**" glob also matched the
  // dev server's module /src/lib/api/interview.ts and crashed every page (as web/e2e/helpers/session.ts).
  await context.route((url) => url.pathname.startsWith("/api/"), (route) => route.abort("failed"));
}
// Slower than the film (pace 2.5) so the staged layers can be captured while they are written.
await installStagedReplay(context, [CASE], {
  pace: 2.5,
  onGenerate: ({ body, rec, threadId }) => {
    if (!GATEWAY_DB) return;
    const r = spawnSync(PYTHON, [join(repo, "video", "scripts", "seed-thread.py"), GATEWAY_DB, threadId, String(body.learner_id ?? "")], {
      input: JSON.stringify(rec),
      encoding: "utf8",
    });
    if (r.status !== 0) throw new Error(`seed-thread failed: ${r.stderr}`);
  },
});
const page = await context.newPage();
page.setDefaultTimeout(30_000);

async function settle(ms = 900) {
  await page.waitForLoadState("domcontentloaded");
  await page
    .locator("main#main [role=status]")
    .first()
    .waitFor({ state: "hidden", timeout: 20_000 })
    .catch(() => {});
  await page.waitForTimeout(ms);
}

async function tab(name) {
  await page.getByRole("tablist", { name: "Chart sections" }).getByRole("tab", { name }).click();
  await page.waitForTimeout(500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
}

async function full(name) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(out, `${name}.png`) });
  console.log(name);
}

/**
 * Screenshot one element as laid out with the page scrolled to the top, on a
 * taller viewport, capped at maxHeight CSS px from its top. Viewport-relative
 * clip (no fullPage), so the sticky banner never lands inside the crop.
 */
async function element(name, locator, maxHeight = 720, pad = 12) {
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  let box = await locator.boundingBox();
  if (!box) throw new Error(`no box for ${name}`);
  if (box.y + Math.min(box.height, maxHeight) > 1400 - pad) {
    // Further down the page: scroll it to just under the top bar.
    await page.evaluate((dy) => window.scrollBy(0, dy), box.y - 80);
    await page.waitForTimeout(600);
    box = await locator.boundingBox();
  }
  const vp = page.viewportSize();
  const clip = {
    x: Math.max(0, box.x - pad),
    y: Math.max(0, box.y - pad),
    width: Math.min(box.width + pad * 2, vp.width - Math.max(0, box.x - pad)),
    height: Math.min(box.height + pad * 2, maxHeight),
  };
  clip.height = Math.min(clip.height, 1400 - clip.y);
  await page.screenshot({ path: resolve(out, `${name}.png`), clip });
  await page.setViewportSize({ width: 1440, height: 900 });
  console.log(name, JSON.stringify(clip));
}

/** The chat column (thread and composer) of the Interview tab, without the call rail. */
async function chatColumn(name, maxHeight = 760) {
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  const log = await page.getByRole("log").first().boundingBox();
  const panel = await activePanel().boundingBox();
  const clip = { x: log.x - 12, y: panel.y - 12, width: log.width + 24, height: Math.min(panel.height + 24, maxHeight) };
  await page.screenshot({ path: resolve(out, `${name}.png`), clip });
  await page.setViewportSize({ width: 1440, height: 900 });
  console.log(name, JSON.stringify(clip));
}

const activePanel = () => page.locator('[role="tabpanel"][data-state="active"]').first();

async function give(drug) {
  await page.getByRole("button", { name: drug }).first().click();
  await page.getByRole("button", { name: /^Confirm and administer / }).first().click();
  await page.waitForTimeout(1500);
}

// 1. Onboard as a learner through the real profile form.
await page.goto(`${base}/signin`);
await settle();
await page.getByRole("button", { name: "Create your profile" }).click();
await page.getByLabel("Full name").fill("Elif Kaya");
await page.getByLabel("Role", { exact: true }).selectOption("student");
await page.getByLabel("Institution").fill("Istanbul University Faculty of Medicine");
await page.getByRole("button", { name: "Create profile" }).click();
await page.waitForURL((u) => !/\/(profile|signin)$/.test(u.pathname));
await settle(1200);
if (!DARK) await full("panel-student");

// 2. Ask for a fever case on the Start page; the case is written on request.
await page.goto(`${base}/start`);
await settle(1200);
await page
  .locator("main#main")
  .getByRole("button", { name: /^Fever/ })
  .or(page.locator("main#main").getByRole("radio", { name: /^Fever/ }))
  .first()
  .click();
await page.getByRole("button", { name: "Begin encounter" }).click();
await page.waitForURL(/\/encounter/);
const strip = page.getByRole("tablist", { name: "Chart sections" });
await strip.waitFor({ timeout: 60_000 });
// The opening is in and the layers are being written: the chart header with its layer chips.
await page.getByText(/is being written for this patient/).first().waitFor();
await page.waitForTimeout(9000);
if (!DARK) {
  // The banner (patient, "model generated") down to the last layer chip, full main width.
  const main = await page.locator("main#main").boundingBox();
  const name = await page.getByText(CASE.spec.demographics.name_hint).first().boundingBox();
  const chip = await page.getByText(/is being written for this patient/).last().boundingBox();
  const y = Math.max(0, name.y - 16);
  await page.screenshot({
    path: resolve(out, "feature-generator.png"),
    clip: { x: main.x, y, width: main.width, height: chip.y + chip.height + 18 - y },
  });
  console.log("feature-generator");
}
await page.getByText(/is being written for this patient/).first().waitFor({ state: "hidden", timeout: 90_000 }).catch(() => {});
await settle(800);

await tab("Interview");
const composer = page.getByPlaceholder("Type a question to the patient, then press Enter"); // watchdog: allow Playwright locator API, not data
// Typed free text, not catalogue clicks: the chat answers what is typed (docs/design/05-chat.md section 2).
// One message at a time: the composer ignores Enter while a reply is in flight.
async function ask(q) {
  await composer.fill(q);
  await composer.press("Enter");
  await page.getByText("Sending", { exact: true }).first().waitFor({ state: "hidden", timeout: 60_000 }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector("textarea")?.value, null, { timeout: 60_000 });
  await page.waitForTimeout(900);
}
for (const q of [
  "When did the fever start?",
  "How severe is the fever?",
  "Have you had chills or body aches?",
]) {
  await ask(q);
}
// Examination manoeuvres live in the Suggestions drawer above the composer (section 3.3).
async function drawer(open = true) {
  const toggle = page.getByRole("button", { name: "Suggestions" }).first();
  const expanded = (await toggle.getAttribute("aria-expanded")) === "true";
  if (expanded !== open) await toggle.click();
  await page.waitForTimeout(300);
}
async function exam(name) {
  await drawer(true);
  await page.getByRole("button", { name, exact: true }).first().click();
  await page.waitForTimeout(1200);
}
await exam("Auscultate lungs");
await drawer(false);
await tab("Interview");
if (DARK) {
  // Dark run: only the encounter, for the landing page's dark hero shot.
  await full("hero-encounter-dark");
  await browser.close();
  process.exit(0);
}
await full("hero-encounter");

// An order typed into the chat: "/order lactate" stages the chip in its confirm step.
await composer.fill("/order lactate");
await page.getByRole("option", { name: /^Lactate(?! dehydrogenase)/ }).first().waitFor();
await page.waitForTimeout(400);
await page.getByRole("option", { name: /^Lactate(?! dehydrogenase)/ }).first().click();
await page.getByRole("button", { name: "Place order" }).first().waitFor();
await page.waitForTimeout(600);
await chatColumn("feature-chat-confirm", 760);
await page.getByRole("button", { name: "Place order" }).first().click();
await page.waitForTimeout(1200);

await tab("Orders");
const search = page.getByPlaceholder(/Search tests/); // watchdog: allow Playwright locator API, not data
for (const [q, re] of [
  ["CBC", /^Order Complete blood count/],
  ["blood culture", /^Order Blood culture/],
  ["renal", /^Order Renal function/],
  ["ecg", /^Order 12-lead ECG/],
  ["chest", /^Order Chest X-ray/],
]) {
  await search.fill(q);
  const btn = page.getByRole("button", { name: re }).first();
  if (await btn.count()) await btn.click();
}
await search.fill("");
await tab("Orders");
await element("feature-orders", activePanel(), 640);
// Results pending: each order shows its clinical turnaround until it resolves.
await tab("Results");
await page.waitForTimeout(800);
await element("feature-results-pending", activePanel(), 560);

// Treat: each administration is one Clinical Director step on the server.
await tab("Orders");
await page.getByRole("tab", { name: "Treatments" }).click();
await page.waitForTimeout(500);
for (const drug of [/^Administer IV fluid bolus/, /^Administer Oxygen/, /^Administer Ceftriaxone/]) await give(drug);
await tab("Interview");
await exam("Recheck vitals");
await drawer(false);
await tab("Monitor");
await page.waitForTimeout(2500);
await element("feature-director", activePanel(), 760);

// Results keep their clinical turnaround (ECG minutes, culture days): advance the sim clock
// to each next result as a learner would, until everything but the culture is back.
await tab("Results");
for (let i = 0; i < 24; i++) {
  const summary = (await page.getByText(/of \d+ orders resulted/).first().textContent().catch(() => "")) ?? "";
  const m = /(\d+) of (\d+) orders resulted/.exec(summary);
  if (m && Number(m[1]) >= Number(m[2]) - 1) break;
  const advance = page.getByRole("button", { name: /^Advance to next result/ }).first();
  if (!(await advance.count())) break;
  await advance.click();
  await page.waitForTimeout(1500);
}
await page.waitForTimeout(2000);
// The chat after the results: the nurse calls each one in with a jump to it, and the
// order placed from the chat now reads resulted.
await tab("Interview");
await page.waitForTimeout(1200);
await chatColumn("feature-chat", 760);
await tab("Results");
await element("feature-results", activePanel(), 680);
await tab("Guidance");
await element("feature-guidance", activePanel(), 660);

// 4. Commit a diagnosis and open the report.
await tab(/Problem List/);
const dx = page.getByPlaceholder("Search diagnoses or ICD/DSM code..."); // watchdog: allow Playwright locator API, not data
for (const term of ["sepsis", "infection", "fever", "a"]) {
  await dx.fill(term);
  await page.waitForTimeout(400);
  if (await page.getByRole("button", { name: /^Add .* to the differential$/ }).count()) break;
}
const plain = page.getByRole("button", { name: /^Add Sepsis to the differential$/ });
await ((await plain.count()) ? plain : page.getByRole("button", { name: /^Add .* to the differential$/ })).first().click();
await page.getByRole("button", { name: /^Commit .* as the working diagnosis$/ }).first().click();
await page.getByRole("button", { name: "View attending debrief" }).click();
await page.waitForTimeout(2500);
await page.getByRole("button", { name: "View full report" }).click();
await page.waitForURL(/\/feedback$/);
await settle(1500);
const plotHeading = page.getByRole("heading", { name: /Confidence vs performance/ }).first();
// The debrief's process section: every check is measured against a guideline target and cited.
await element(
  "feature-debrief",
  page.getByRole("region", { name: "Process and timing" }).first(),
  1300,
);
await element("feature-feedback", plotHeading.locator("xpath=ancestor::*[contains(@class,'border')][1]"), 640, 0);

// 5. Panels under the admin role (admin console signed in with the token, dean, faculty).
await page.goto(`${base}/account`);
await settle();
await page.getByLabel("Role", { exact: true }).selectOption("admin");
await page.getByRole("button", { name: /^Save/ }).first().click();
await page.waitForTimeout(800);
await page.goto(`${base}/admin`);
await settle(1200);
if (ADMIN_TOKEN) {
  await page.getByLabel("Admin token").first().fill(ADMIN_TOKEN);
  await page.getByRole("button", { name: "Sign in" }).first().click();
  await page.getByText("Admin session active").first().waitFor({ timeout: 20_000 });
  await page.getByRole("tab", { name: "Telemetry" }).first().click();
  await page.getByText("Calls over time").first().waitFor({ timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(2000);
}
await full("panel-admin");
// Client-side navigation keeps the admin session of this tab (sessionStorage) for the panels.
for (const [name, label] of [
  ["panel-dean", "Institution"],
  ["panel-faculty", "Faculty"],
]) {
  await page.locator("nav").getByRole("link", { name: label, exact: true }).first().click();
  await settle(2500);
  await full(name);
}

// Rooms: the lobby for doctor, nurse and paramedic teams.
// A room created here: its case is generated on request like any other (the recorded live case).
await page.goto(`${base}/rooms`);
await settle(1500);
await page.getByRole("button", { name: "Create room" }).first().click();
const dialog = page.getByRole("dialog").first();
await dialog.waitFor();
await page.waitForTimeout(600);
await dialog.getByRole("button", { name: /Create/ }).last().click();
await page.waitForURL(/\/rooms\/.+/, { timeout: 90_000 });
await settle(6000);
await full("panel-rooms");

await browser.close();
console.log("captured into", out);
