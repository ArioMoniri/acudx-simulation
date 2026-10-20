// Capture the 12 renewal screens at 1280x800 and 390x844 on the offline path.
//
//   npm --prefix web run dev -- --port 4205 --strictPort --host 127.0.0.1   (another shell)
//   node scripts/design/capture-renewal.mjs docs/design/renewal-shots/after
//
// One profile is created through the real form, one encounter is driven
// through the UI (three questions, an exam, three orders, their results, a
// committed diagnosis), and every screen is captured at both widths from the
// same state. /api/** is aborted, exactly as web/e2e/helpers/session.ts does,
// so the run is deterministic and needs no gateway.
//
// Env: PORT (default 4205), ONLY=name,name to limit screens, EXTRA=1 to also
// capture progress, faculty, atlas and rooms, SCHEME=dark for the dark theme.
import { createRequire } from "node:module";
import { mkdirSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const require = createRequire(join(repo, "web", "package.json"));
const { chromium } = require("playwright-core");

const out = resolve(repo, process.argv[2] ?? "docs/design/renewal-shots/after");
const base =
  process.env.ACUDX_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 4205}`;
const only = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
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

const SIZES = [
  [1280, 800],
  [390, 844],
];

const browser = await chromium.launch({
  executablePath: chromiumPath(),
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  colorScheme: process.env.SCHEME ?? "light",
  reducedMotion: "reduce",
  locale: "en-US",
  timezoneId: "Europe/Istanbul",
});
await context.route("**/api/**", (route) => route.abort("failed"));
const page = await context.newPage();
page.setDefaultTimeout(30_000);

async function settle(ms = 700) {
  await page.waitForLoadState("domcontentloaded");
  await page
    .locator("main#main [role=status]")
    .first()
    .waitFor({ state: "hidden", timeout: 20_000 })
    .catch(() => {});
  await page.waitForTimeout(ms);
}

async function shoot(name, before) {
  if (only && !only.has(name)) return;
  for (const [w, h] of SIZES) {
    await page.setViewportSize({ width: w, height: h });
    if (before) await before();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(600);
    await page.screenshot({ path: resolve(out, `${name}-${w}.png`) });
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    console.log(
      `${name}-${w}${sw > w + 1 ? `  HORIZONTAL OVERFLOW ${sw}` : ""}`,
    );
  }
  await page.setViewportSize({ width: 1280, height: 800 });
}

// With ONLY set, skip the slow encounter steps no requested screen needs.
const need = (...names) => !only || names.some((n) => only.has(n));

async function tab(name) {
  await page
    .getByRole("tablist", { name: "Chart sections" })
    .getByRole("tab", { name })
    .click();
  await page.waitForTimeout(400);
}

// 1. Onboard through the profile form as a dean (sees every panel).
await page.goto(`${base}/signin`);
await settle();
await page.getByRole("button", { name: "Create your profile" }).click();
await page.getByLabel("Full name").fill("Deniz Yilmaz");
await page.getByLabel("Role", { exact: true }).selectOption("dean");
await page
  .getByLabel("Institution")
  .fill("Istanbul University Faculty of Medicine");
await page.getByRole("button", { name: "Create profile" }).click();
await page.waitForURL((u) => !/\/(profile|signin)$/.test(u.pathname));
await settle();

// 2. Static surfaces.
for (const [name, path] of [
  ["landing", "/welcome"],
  ["home", "/"],
  ["start", "/start"],
  ["cases", "/cases"],
]) {
  await page.goto(`${base}${path}`);
  await settle(900);
  await shoot(name);
}

// 3. One encounter, driven through the UI.
const encounterScreens = [
  "encounter",
  "encounter-interview",
  "encounter-orders",
  "encounter-results",
  "encounter-guidance",
  "feedback",
];
if (need(...encounterScreens)) {
  await page.goto(`${base}/encounter`);
  await settle(1200);
  const strip = page.getByRole("tablist", { name: "Chart sections" });
  const useTemplate = page.getByRole("button", { name: /^Use template case/ });
  await strip.or(useTemplate).first().waitFor({ timeout: 20_000 });
  if (await useTemplate.isVisible().catch(() => false))
    await useTemplate.click();
  await strip.waitFor();
  await shoot("encounter", () => tab("Chart Review"));

  await tab("Interview");
  const composer = page.getByPlaceholder(
    "Type a question to the patient, then press Enter",
  );
  for (const q of [
    "When did the pain start?",
    "Where exactly is the pain and does it move anywhere?",
    "Do you take any regular medications?",
  ]) {
    await composer.fill(q);
    await composer.press("Enter");
    await page.waitForTimeout(1500);
  }
  await page
    .getByRole("button", { name: "Auscultate heart" })
    .click()
    .catch(() => {});
  await page.waitForTimeout(800);
  await shoot("encounter-interview", () => tab("Interview"));

  await tab("Orders");
  const search = page.getByPlaceholder(/Search tests/);
  for (const [q, re] of [
    ["troponin", /^Order .*troponin/i],
    ["chest", /^Order .*(X-ray|radiograph|chest)/i],
    ["ecg", /^Order .*(ECG|electrocardiogram)/i],
  ]) {
    await search.fill(q);
    const btn = page.getByRole("button", { name: re }).first();
    if (await btn.count()) await btn.click();
  }
  await search.fill("");
  await shoot("encounter-orders", () => tab("Orders"));

  if (need("encounter-results", "encounter-guidance", "feedback")) {
    // Wait for the results (real turnaround timers).
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      await tab("Orders");
      if (await page.getByText(/placed · 0 pending/).count()) break;
      await page.waitForTimeout(3000);
    }
    await shoot("encounter-results", () => tab("Results"));
    await shoot("encounter-guidance", () => tab("Guidance"));

    // 4. Commit a diagnosis and open the feedback report.
    await tab(/Problem List/);
    await page
      .getByPlaceholder("Search diagnoses or ICD/DSM code...")
      .fill("myocardial infarction");
    await page
      .getByRole("button", { name: /^Add .* to the differential$/ })
      .first()
      .click();
    await page
      .getByRole("button", { name: /^Commit .* as the working diagnosis$/ })
      .first()
      .click();
    await page.getByRole("button", { name: "View attending debrief" }).click();
    await page.getByRole("button", { name: "View full report" }).click();
    await page.waitForURL(/\/feedback$/);
    await settle(1200);
    await shoot("feedback");
  }
}

// 5. Panels. The dean panel as the dean; extra learner surfaces (EXTRA=1,
// reviewed during the pass but not on the 12-screen contact sheet).
const visit = async (name, path) => {
  if (only && !only.has(name)) return;
  await page.goto(`${base}${path}`);
  await settle(1500);
  await shoot(name);
};
await visit("dean", "/dean");
if (process.env.EXTRA) {
  await visit("progress", "/progress");
  await visit("atlas", "/atlas");
  await visit("rooms", "/rooms");
}

// 6. The admin console and the faculty workspace need the admin role: a local
// profile may take any role (no identity provider), as the walkthrough does.
if (need("admin", "faculty")) {
  await page.goto(`${base}/account`);
  await settle(900);
  await page.getByLabel("Role", { exact: true }).selectOption("admin");
  await page.getByRole("button", { name: /^Save/ }).first().click();
  await page.waitForTimeout(800);
  await visit("admin", "/admin");
  if (process.env.EXTRA) await visit("faculty", "/faculty");
}

await browser.close();
console.log("captured into", out);
