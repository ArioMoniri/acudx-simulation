// Horizontal overflow audit and screen capture for the renewal 2 pass.
//
//   npm --prefix web run dev -- --port 4321 --strictPort --host 127.0.0.1   (another shell)
//   node scripts/design/audit-overflow.mjs docs/design/renewal-2-shots/after shots
//
// Signs in a dean through the real profile form, opens every route at
// 375, 768, 1024, 1280, 1440 and 1920 px, and prints every element that scrolls
// horizontally (and any page-level horizontal scroll). With "shots" it also
// captures each route at 375 and 1280 px. /api/ is aborted and the case
// generator replays a recorded live case, as web/e2e/helpers/session.ts does.
//
// Env: PORT (4321), ROUTES=/a,/b, WIDTHS=375,1280, SHOT_WIDTHS=375,1280,
// LOCALE (en-US), ROLE (dean), MOTION=full to keep animations.
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
const shots = process.argv[3] === "shots";
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
// Only the gateway proxy (/api/... at the path root): the "**/api/**" glob also matched the
// dev server's module /src/lib/api/interview.ts and crashed every page (as web/e2e/helpers/session.ts).
await ctx.route((url) => url.pathname.startsWith("/api/"), (r) => r.abort("failed"));
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
  await page.evaluate(() => localStorage.setItem("acudx-lang", "tr"));
}

const ROUTES = (
  process.env.ROUTES ??
  "/,/welcome,/start,/cases,/rooms,/encounter,/feedback,/progress,/exam,/atlas,/account,/authoring,/institution,/faculty,/admin"
).split(",");
const WIDTHS = (process.env.WIDTHS ?? "375,768,1024,1280,1440,1920").split(",").map(Number);
const SHOT_WIDTHS = (process.env.SHOT_WIDTHS ?? "375,1280").split(",").map(Number);

const scan = () =>
  page.evaluate(() => {
    const res = [];
    for (const el of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(el);
      if (cs.display === "none") continue;
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      if ((cs.overflowX === "auto" || cs.overflowX === "scroll") && el.scrollWidth > el.clientWidth + 1) {
        const role =
          el.getAttribute("role") ||
          el.querySelector("[role=tablist],nav,[role=menu],[role=toolbar]")?.getAttribute("role") ||
          "";
        const cls = String(el.className?.baseVal ?? el.className ?? "").slice(0, 60);
        const text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 50);
        res.push(
          `${el.tagName.toLowerCase()}.${cls} role=${role} table=${!!el.querySelector("table")} ${el.scrollWidth}>${el.clientWidth} "${text}"`,
        );
      }
    }
    const d = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    if (d > 0) res.push(`PAGE +${d}`);
    return res;
  });

for (const route of ROUTES) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(base + route);
  await settle(900);
  if (route === "/encounter") {
    await page
      .getByRole("tablist", { name: /Chart sections|Kart bölümleri/ })
      .waitFor({ timeout: 30000 })
      .catch(() => console.log("no chart strip"));
    await page.waitForTimeout(800);
  }
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: w < 768 ? 844 : 900 });
    await page.waitForTimeout(400);
    const r = await scan();
    if (r.length) console.log(`${route} @${w}\n  ${r.join("\n  ")}`);
    if (shots && SHOT_WIDTHS.includes(w)) {
      const name = route === "/" ? "home" : route.slice(1).replace(/\//g, "-");
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: join(out, `${name}-${w}.png`) });
    }
  }
}
await browser.close();
