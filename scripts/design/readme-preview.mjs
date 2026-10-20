// Render README.md with a GitHub-like stylesheet in Chromium, in light and
// dark, at 1012 px and 390 px, screenshot the header, and check that the
// lockup, tagline, badges and hero do not overlap.
//
//   MD_DEPS=/path/with/node_modules node scripts/design/readme-preview.mjs [outDir]
//
// MD_DEPS must contain `marked` and `github-markdown-css` (npm i marked
// github-markdown-css in a scratch directory). The README's relative image
// paths resolve against the repository root through <base>.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const deps = process.env.MD_DEPS;
if (!deps) throw new Error("set MD_DEPS to a directory with marked and github-markdown-css installed");
const depRequire = createRequire(join(deps, "package.json"));
const { marked } = depRequire("marked");
const webRequire = createRequire(join(repo, "web", "package.json"));
const { chromium } = webRequire("playwright-core");
const out = resolve(process.argv[2] ?? join(repo, "docs/design/renewal-shots/readme"));
mkdirSync(out, { recursive: true });

const md = readFileSync(join(repo, "README.md"), "utf8");
const body = marked.parse(md, { gfm: true });
const css = (scheme) =>
  readFileSync(join(deps, "node_modules/github-markdown-css", `github-markdown-${scheme}.css`), "utf8");

function page(scheme) {
  return `<!doctype html><html><head><meta charset="utf-8"><base href="file://${repo}/">
<style>${css(scheme)}
body{margin:0;background:${scheme === "dark" ? "#0d1117" : "#ffffff"}}
.markdown-body{box-sizing:border-box;max-width:1012px;margin:0 auto;padding:32px}
@media (max-width:767px){.markdown-body{padding:16px}}
.markdown-body img{max-width:100%;box-sizing:content-box}
</style></head><body><article class="markdown-body">${body}</article></body></html>`;
}

const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers";
const dir = readdirSync(root)
  .filter((d) => /^chromium-\d+$/.test(d))
  .sort()
  .at(-1);
const browser = await chromium.launch({ executablePath: join(root, dir, "chrome-linux", "chrome") });
let problems = 0;
for (const scheme of ["light", "dark"]) {
  const file = join(out, `readme-${scheme}.html`);
  writeFileSync(file, page(scheme));
  for (const width of [1012, 390]) {
    const ctx = await browser.newContext({ viewport: { width, height: 1200 }, colorScheme: scheme });
    const p = await ctx.newPage();
    await p.goto(`file://${file}`);
    await p.waitForLoadState("load");
    await p.waitForTimeout(400);
    const boxes = await p.evaluate(() => {
      const el = (sel) => document.querySelector(sel);
      const r = (node) => {
        if (!node) return null;
        const b = node.getBoundingClientRect();
        return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, w: b.width, h: b.height };
      };
      const lockup = el("picture img");
      const tagline = el("h3");
      const badges = [...document.querySelectorAll("p")].find((n) => n.querySelector('img[alt="CI"]'));
      const hero = el('img[src*="hero-encounter"]');
      return {
        lockup: r(lockup),
        lockupSrc: lockup?.currentSrc ?? null,
        tagline: r(tagline),
        badges: r(badges),
        hero: r(hero),
        heroNatural: hero ? [hero.naturalWidth, hero.naturalHeight] : null,
        scrollWidth: document.documentElement.scrollWidth,
      };
    });
    const order = ["lockup", "tagline", "badges", "hero"];
    const issues = [];
    for (let i = 1; i < order.length; i++) {
      const a = boxes[order[i - 1]];
      const b = boxes[order[i]];
      if (!a || !b) issues.push(`missing ${!a ? order[i - 1] : order[i]}`);
      else if (b.top < a.bottom - 0.5) issues.push(`${order[i]} overlaps ${order[i - 1]} by ${(a.bottom - b.top).toFixed(1)} px`);
    }
    if (!boxes.lockup?.h) issues.push("lockup did not render");
    if (!boxes.heroNatural?.[0]) issues.push("hero did not load");
    if (boxes.scrollWidth > width + 1) issues.push(`horizontal overflow ${boxes.scrollWidth}`);
    if (scheme === "dark" && !String(boxes.lockupSrc).includes("lockup-dark")) issues.push("dark lockup not selected");
    if (scheme === "light" && !String(boxes.lockupSrc).includes("lockup-light")) issues.push("light lockup not selected");
    problems += issues.length;
    console.log(
      `${scheme} ${width}px: lockup ${boxes.lockup?.w.toFixed(0)}x${boxes.lockup?.h.toFixed(0)} (${String(boxes.lockupSrc).split("/").pop()}), hero ${boxes.hero?.w.toFixed(0)}x${boxes.hero?.h.toFixed(0)}`,
      issues.length ? `ISSUES: ${issues.join("; ")}` : "ok, no overlap",
    );
    const height = Math.min(Math.ceil((boxes.hero?.bottom ?? 900) + 80), 2000);
    await p.setViewportSize({ width, height });
    await p.screenshot({ path: join(out, `readme-header-${scheme}-${width}.png`) });
    await ctx.close();
  }
}
await browser.close();
if (problems) process.exit(1);
