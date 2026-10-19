// Capture real AcuDx screens for the launch video with Playwright.
//
// Usage:
//   npm --prefix web run dev -- --port 4175        (in another terminal)
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/capture-screens.mjs
//
// The script onboards through the real profile form (no seeded state), starts
// an encounter from the Start page, then captures the EHR workspace, rooms,
// feedback and atlas at 1920x1080 into public/screens/. With `--landing` it
// also captures the landing page at the four design-system breakpoints into
// web/e2e/__screenshots__/ for the responsive review.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const repo = resolve(root, "..");
const base = process.env.ACUDX_BASE_URL ?? "http://127.0.0.1:4175";
const executablePath =
  process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const landingOnly = process.argv.includes("--landing-only");
const withLanding = landingOnly || process.argv.includes("--landing");

const screensDir = resolve(root, "public/screens");
const e2eDir = resolve(repo, "web/e2e/__screenshots__");
mkdirSync(screensDir, { recursive: true });
mkdirSync(e2eDir, { recursive: true });

const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  colorScheme: "light",
  reducedMotion: "reduce",
  locale: "en-GB",
});
const page = await context.newPage();
page.setDefaultTimeout(30_000);

async function settle(ms = 900) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(ms);
}

// 1. Onboard through the UI: the auth gate sends a first-time visitor to
//    /signin, whose "create" call to action opens the real profile form.
await page.goto(`${base}/signin`);
await settle();
const createCta = page.getByRole("button", { name: /create your profile|profil/i }).first();
if (await createCta.count()) {
  await createCta.click();
} else {
  await page.goto(`${base}/profile`);
}
await page.waitForURL(/\/profile/);
await settle(400);

await page.getByLabel(/full name|ad soyad/i).fill("Elif Kaya");
await page.getByLabel(/^role/i).selectOption({ index: 1 });
await page.getByLabel(/institution|kurum/i).fill("Istanbul University Faculty of Medicine");
await page.getByRole("button", { name: /^create profile|oluştur/i }).click();
await page.waitForURL((u) => !u.pathname.startsWith("/profile"));
await settle();

if (!landingOnly) {
  // 2. Start an encounter from the Start page so /encounter has a live case.
  await page.goto(`${base}/start`);
  await settle();
  await page.getByRole("button", { name: /begin encounter/i }).click();
  await page.waitForURL(/\/encounter/);
  await settle(2500);
  await page.screenshot({ path: resolve(screensDir, "encounter.png") });

  // Orders tab, if the tab strip exposes it, for a second EHR frame.
  const ordersTab = page.getByRole("tab", { name: /orders/i }).first();
  if (await ordersTab.count()) {
    await ordersTab.click();
    await settle(1200);
    await page.screenshot({ path: resolve(screensDir, "encounter-orders.png") });
  }

  for (const route of ["rooms", "feedback", "atlas", "progress", "cases"]) {
    await page.goto(`${base}/${route}`);
    await settle(2000);
    await page.screenshot({ path: resolve(screensDir, `${route}.png`) });
  }
}

if (withLanding) {
  // 3. Landing page at the design-system breakpoints (protocol section 3.4).
  const sizes = [
    [390, 844],
    [768, 1024],
    [1280, 800],
    [1920, 1080],
  ];
  for (const [w, h] of sizes) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(`${base}/welcome`);
    await settle(1200);
    // Walk the page once so lazy sections (the teaser poster) mount before
    // the full-page capture, then return to the top.
    await page.evaluate(async () => {
      const step = window.innerHeight;
      for (let y = 0; y < document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => requestAnimationFrame(() => r(undefined)));
      }
      window.scrollTo(0, 0);
    });
    await settle(800);
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      const wide = [];
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (r.right > doc.clientWidth + 1 && r.width > 0) {
          wide.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} right=${Math.round(r.right)}`);
        }
      }
      return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, wide: wide.slice(0, 12) };
    });
    console.log(`landing ${w}x${h}`, JSON.stringify(overflow));
    await page.screenshot({ path: resolve(e2eDir, `landing-${w}.png`), fullPage: true });
  }
}

await browser.close();
console.log("captured");
