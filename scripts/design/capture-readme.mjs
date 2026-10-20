// Capture the README hero, feature and panel images from the running app.
//
//   npm --prefix web run dev -- --port 4205 --strictPort --host 127.0.0.1   (another shell)
//   node scripts/design/capture-readme.mjs            # raw PNGs into docs/media/readme/raw/
//   python3 scripts/design/readme-media.py           # optimise into docs/media/readme/
//
// Everything is a plain screenshot of the real UI: no cursor overlay, no
// caption bar, no crop that cuts text. The learner starts a freshly generated
// case from Home (the offline generator, so the run needs no gateway: /api/**
// is aborted as in web/e2e/helpers/session.ts), interviews the patient, places
// three orders, waits for their results, commits a diagnosis and opens the
// feedback report; the panels are taken after switching the local profile to
// the admin role, as the walkthrough recorder does.
import { createRequire } from "node:module";
import { mkdirSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const require = createRequire(join(repo, "web", "package.json"));
const { chromium } = require("playwright-core");

const out = resolve(repo, "docs/media/readme/raw");
const base =
  process.env.ACUDX_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 4205}`;
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

const browser = await chromium.launch({
  executablePath: chromiumPath(),
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
  colorScheme: process.env.SCHEME ?? "light",
  reducedMotion: "reduce",
  locale: "en-US",
  timezoneId: "Europe/Istanbul",
});
await context.route("**/api/**", (route) => route.abort("failed"));
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
  await page
    .getByRole("tablist", { name: "Chart sections" })
    .getByRole("tab", { name })
    .click();
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
async function element(name, locator, maxHeight = 720, pad = 0) {
  await page.setViewportSize({ width: 1280, height: 1400 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  const box = await locator.boundingBox();
  if (!box) throw new Error(`no box for ${name}`);
  const vp = page.viewportSize();
  const clip = {
    x: Math.max(0, box.x - pad),
    y: Math.max(0, box.y - pad),
    width: Math.min(box.width + pad * 2, vp.width - Math.max(0, box.x - pad)),
    height: Math.min(box.height + pad * 2, maxHeight),
  };
  clip.height = Math.min(clip.height, 1400 - clip.y);
  await page.screenshot({ path: resolve(out, `${name}.png`), clip });
  await page.setViewportSize({ width: 1280, height: 800 });
  console.log(name, JSON.stringify(clip));
}

const activePanel = () =>
  page.locator('[role="tabpanel"][data-state="active"]').first();

// 1. Onboard as a learner through the real profile form.
await page.goto(`${base}/signin`);
await settle();
await page.getByRole("button", { name: "Create your profile" }).click();
await page.getByLabel("Full name").fill("Elif Kaya");
await page.getByLabel("Role", { exact: true }).selectOption("student");
await page
  .getByLabel("Institution")
  .fill("Istanbul University Faculty of Medicine");
await page.getByRole("button", { name: "Create profile" }).click();
await page.waitForURL((u) => !/\/(profile|signin)$/.test(u.pathname));
await settle(1200);
await full("panel-student");

// 2. The case generator (Cases page, generator block only).
await page.goto(`${base}/cases`);
await settle(1200);
const genHeading = page
  .getByRole("heading", { name: /Generate a case/ })
  .first();
await element(
  "feature-generator",
  genHeading.locator("xpath=ancestor::*[contains(@class,'border')][1]"),
  720,
  12,
);

// 3. A freshly generated case: Start page, Begin encounter (offline the
// on-device generator builds it and labels it "offline generator").
await page.goto(`${base}/start`);
await settle(1200);
await page.getByRole("button", { name: /begin encounter/i }).click();
await page.waitForURL(/\/encounter/);
await settle(1500);
const strip = page.getByRole("tablist", { name: "Chart sections" });
const useTemplate = page.getByRole("button", { name: /^Use template case/ });
await strip.or(useTemplate).first().waitFor({ timeout: 30_000 });
if (await useTemplate.isVisible().catch(() => false)) await useTemplate.click();
await strip.waitFor();

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
  await page.waitForTimeout(1600);
}
for (const chip of ["General inspection", "Associated symptoms"]) {
  await page
    .getByRole("button", { name: chip, exact: true })
    .first()
    .click()
    .catch(() => {});
  await page.waitForTimeout(1200);
}
await page.waitForTimeout(1200);
await tab("Interview");
if (process.env.SCHEME === "dark") {
  // Dark run: only the encounter, for the landing page's dark hero shot.
  await full("hero-encounter-dark");
  await browser.close();
  process.exit(0);
}
await full("hero-encounter");
await element("feature-interview", activePanel(), 640, 0);

await tab("Orders");
const search = page.getByPlaceholder(/Search tests/);
for (const [q, re] of [
  ["ecg", /^Order .*(ECG|electrocardiogram)/i],
  ["chest", /^Order .*(X-ray|radiograph)/i],
]) {
  await search.fill(q);
  const btn = page.getByRole("button", { name: re }).first();
  if (await btn.count()) await btn.click();
}
await search.fill("");
await tab("Orders");
await element("feature-orders", activePanel(), 600, 0);

const deadline = Date.now() + 150_000;
while (Date.now() < deadline) {
  await tab("Orders");
  if (await page.getByText(/placed · 0 pending/).count()) break;
  await page.waitForTimeout(3000);
}
await tab("Results");
const ecg = page.getByText(/12-lead ECG/).first();
await element("feature-results", activePanel(), 680, 0);
void ecg;
await tab("Guidance");
await element("feature-guidance", activePanel(), 660, 0);

// 4. Commit a diagnosis and open the report.
await tab(/Problem List/);
const dx = page.getByPlaceholder("Search diagnoses or ICD/DSM code...");
for (const term of ["pneumonia", "infection", "pain", "a"]) {
  await dx.fill(term);
  await page.waitForTimeout(400);
  if (
    await page
      .getByRole("button", { name: /^Add .* to the differential$/ })
      .count()
  )
    break;
}
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
await settle(1500);
const plotHeading = page
  .getByRole("heading", { name: /Confidence vs performance/ })
  .first();
await element(
  "feature-feedback",
  plotHeading.locator("xpath=ancestor::*[contains(@class,'border')][1]"),
  640,
  0,
);

// 5. Panels under the admin role (dean, faculty, admin console).
await page.goto(`${base}/account`);
await settle();
await page.getByLabel("Role", { exact: true }).selectOption("admin");
await page.getByRole("button", { name: /^Save/ }).first().click();
await page.waitForTimeout(800);
for (const [name, path] of [
  ["panel-dean", "/dean"],
  ["panel-faculty", "/faculty"],
  ["panel-admin", "/admin"],
]) {
  await page.goto(`${base}${path}`);
  await settle(1500);
  await full(name);
}

await browser.close();
console.log("captured into", out);
