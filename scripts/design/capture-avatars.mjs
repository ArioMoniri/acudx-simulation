// Close-up captures of every patient photo surface for the renewal 2 pass.
//
//   npm --prefix web run dev -- --port 4321 --strictPort --host 127.0.0.1   (another shell)
//   node scripts/design/capture-avatars.mjs docs/design/renewal-2-shots/after
//
// Opens one encounter (recorded live case, /api/** aborted) and captures the
// chart header, the storyboard identity block and the Flowsheets monitor card at
// 375 and 1280 px, light and dark, with reduced motion (the case where the
// clinical-signs pill is drawn) and with full motion. Prints, for every patient
// photo narrower than 160 px, whether any overlay text is inside it.
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const WEB = join(repo, "web");
const require = createRequire(join(WEB, "package.json"));
const { chromium } = require("playwright-core");

const out = resolve(repo, process.argv[2] ?? "docs/design/renewal-2-shots/after");
mkdirSync(out, { recursive: true });
const base = `http://127.0.0.1:${process.env.PORT ?? 4321}`;

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

const rec = JSON.parse(
  readFileSync(join(repo, "server/tests/fixtures/live/accepted-meningitis.json"), "utf8"),
);
const sse = (e, d, id) => `id: ${id}\nevent: ${e}\ndata: ${JSON.stringify(d)}\n\n`;
function staged(threadId) {
  const spec = { ...rec.spec, meta: { ...rec.spec.meta, thread_id: threadId } };
  let id = 1;
  let o = sse("start", { thread_id: threadId, stages: ["s1"], eta_ms: { s1: 15000 } }, id++);
  o += sse("kernel", { status: "ready" }, id++);
  o += sse("opening.ready", { thread_id: threadId, opening: {}, spec, timings: {} }, id++);
  o += sse("done", { thread_id: threadId, spec }, id++);
  return o;
}

const browser = await chromium.launch({ executablePath: chromiumPath() });
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  reducedMotion: process.env.MOTION === "full" ? "no-preference" : "reduce",
  locale: process.env.LOCALE ?? "en-US",
  timezoneId: "Europe/Istanbul",
});
await ctx.route("**/api/**", (r) => r.abort("failed"));
await ctx.route(/\/case\/generate\/stream/, (r) =>
  r.fulfill({
    status: 200,
    headers: { "content-type": "text/event-stream" },
    body: staged(`t-${Date.now()}`),
  }),
);
const page = await ctx.newPage();
page.setDefaultTimeout(30000);
const settle = async (ms = 700) => {
  await page.waitForLoadState("domcontentloaded");
  await page
    .locator("main#main [role=status]")
    .first()
    .waitFor({ state: "hidden", timeout: 20000 })
    .catch(() => {});
  await page.waitForTimeout(ms);
};

await page.goto(`${base}/signin`);
await settle();
await page.getByRole("button", { name: "Create your profile" }).click();
await page.getByLabel("Full name").fill("Deniz Yilmaz");
await page.getByLabel("Role", { exact: true }).selectOption(process.env.ROLE ?? "dean");
await page.getByLabel("Institution").fill("Istanbul University Faculty of Medicine");
await page.getByRole("button", { name: "Create profile" }).click();
await page.waitForURL((u) => !/\/(profile|signin)$/.test(u.pathname));
await settle();
if (process.env.LANG_TR) {
  await page.evaluate(() => localStorage.setItem("i18nextLng", "tr"));
}


const tab = async (re) => {
  await page.getByRole("tablist", { name: "Chart sections" }).getByRole("tab", { name: re }).click();
  await page.waitForTimeout(500);
};
const probe = () =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll("figure[data-patient-photo], figure.\\@container"))
      .filter((f) => f.getBoundingClientRect().width > 0)
      .map((f) => {
        const w = Math.round(f.getBoundingClientRect().width);
        const text = Array.from(f.querySelectorAll("span, figcaption"))
          .filter((n) => n.getBoundingClientRect().width > 0 && getComputedStyle(n).display !== "none")
          .map((n) => (n.textContent || "").trim())
          .filter(Boolean);
        return `${w}px overlay=${JSON.stringify([...new Set(text)])}`;
      }),
  );
const shot = async (locator, name) => {
  const el = page.locator(locator).first();
  if (!(await el.count())) return console.log(`missing ${locator}`);
  await el.scrollIntoViewIfNeeded();
  await el.screenshot({ path: join(out, name) });
};
for (const scheme of ["light", "dark"]) {
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: process.env.MOTION === "full" ? "no-preference" : "reduce" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${base}/encounter`);
  await settle(900);
  await page.getByRole("tablist", { name: "Chart sections" }).waitFor({ timeout: 30000 });
  for (const w of [1280, 375]) {
    await page.setViewportSize({ width: w, height: w < 768 ? 844 : 900 });
    await tab(/Chart Review/);
    await page.waitForTimeout(400);
    await shot('header[aria-label]', `avatar-banner-${scheme}-${w}.png`);
    await page.evaluate(() => window.scrollTo(0, 0));
    if (w >= 1024) await shot("aside:has(figure) > div:first-child", `avatar-storyboard-${scheme}-${w}.png`);
    console.log(scheme, w, "chart", (await probe()).join(" | "));
    await tab(/Flowsheets/);
    await page.waitForTimeout(600);
    // Before renewal 2 the card was a figure around the photo figure; after,
    // a plain row around a figure[data-patient-photo].
    const card = page
      .locator("[role=tabpanel] div:has(> figure[data-patient-photo]), figure:has(> figure)")
      .first();
    if (await card.count()) {
      await card.scrollIntoViewIfNeeded();
      await card.screenshot({ path: join(out, `avatar-flowsheet-${scheme}-${w}.png`) });
    } else {
      await shot("figure:has(figure)", `avatar-flowsheet-${scheme}-${w}.png`);
    }
    console.log(scheme, w, "flowsheet", (await probe()).join(" | "));
  }
}
await browser.close();
