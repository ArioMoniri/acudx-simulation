#!/usr/bin/env node
/**
 * Record the AcuDx product walkthrough as a real screen recording.
 *
 * Drives the running web app (no seeded state, no gateway) through one
 * student encounter on a febrile case, then the dean panel, the admin console
 * token gate and the 3D atlas, with Playwright's `recordVideo` at 1920 x 1080.
 * Every step is written to a JSON timeline (time since the recording started,
 * action, chapter and the element's bounding box) that the Remotion
 * `Walkthrough` composition reads for its zoom-to-focus camera, captions and
 * chapter markers.
 *
 *   npm --prefix web run dev -- --port 4197
 *   cd video && npm run record
 *
 * Outputs:
 *   public/recording/walkthrough.webm      the raw recording
 *   public/recording/walkthrough.json      the timeline
 *   out/record-debug/*.png                 one still per chapter (with --debug)
 *
 * Offline path: every `/api/**` request is aborted, exactly like
 * web/e2e/helpers/session.ts `offlineGateway`, so the run never depends on a
 * gateway and the UI shows its labelled on-device fallbacks.
 *
 * Environment: BASE_URL (default http://localhost:4197), CHROMIUM_PATH
 * (default the Playwright Chromium under /opt/pw-browsers). Never runs
 * `playwright install`.
 */
import { chromium } from "playwright-core";
import { mkdirSync, renameSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.BASE_URL ?? "http://localhost:4197";
const CHROME = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const DEBUG = process.argv.includes("--debug");
const REC_DIR = join(ROOT, "public", "recording");
const TMP_DIR = join(REC_DIR, ".tmp");
const DEBUG_DIR = join(ROOT, "out", "record-debug");
const W = 1920;
const H = 1080;

mkdirSync(REC_DIR, { recursive: true });
rmSync(TMP_DIR, { recursive: true, force: true });
mkdirSync(TMP_DIR, { recursive: true });
if (DEBUG) mkdirSync(DEBUG_DIR, { recursive: true });

/**
 * Cursor overlay. Headless Chromium paints no pointer, so a small arrow is
 * drawn in the page and follows real `mousemove` events (the ones
 * `page.mouse` dispatches). A ring pulses on `mousedown`. pointer-events none,
 * so it never intercepts a click.
 */
const CURSOR_SCRIPT = () => {
  const install = () => {
    if (document.getElementById("__rec-cursor")) return;
    const style = document.createElement("style");
    style.textContent = `
      #__rec-cursor{position:fixed;left:0;top:0;width:28px;height:28px;z-index:2147483647;pointer-events:none;
        transform:translate(-100px,-100px);will-change:transform}
      #__rec-cursor svg{display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))}
      #__rec-ring{position:fixed;left:0;top:0;width:36px;height:36px;margin:-18px 0 0 -18px;border-radius:50%;
        border:2px solid rgba(15,118,110,.9);background:rgba(15,118,110,.14);z-index:2147483646;pointer-events:none;
        opacity:0;transform:translate(-100px,-100px) scale(.4)}
      .__rec-hide #__rec-cursor,.__rec-hide #__rec-ring{visibility:hidden}
      #__rec-ring.on{animation:__rec-ring .42s cubic-bezier(.16,1,.3,1)}
      @keyframes __rec-ring{0%{opacity:1;transform:var(--p) scale(.4)}100%{opacity:0;transform:var(--p) scale(1.25)}}`;
    document.documentElement.appendChild(style);
    const c = document.createElement("div");
    c.id = "__rec-cursor";
    c.innerHTML =
      '<svg width="28" height="28" viewBox="0 0 28 28"><path d="M5 3l16.5 12.2-7.1 1.1 4.2 8.3-3.3 1.6-4.1-8.4L5 23.4z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    const ring = document.createElement("div");
    ring.id = "__rec-ring";
    document.documentElement.appendChild(ring);
    document.documentElement.appendChild(c);
    const last = window.__recLast ?? { x: -100, y: -100 };
    c.style.transform = `translate(${last.x - 5}px,${last.y - 3}px)`;
    addEventListener(
      "mousemove",
      (e) => {
        window.__recLast = { x: e.clientX, y: e.clientY };
        c.style.transform = `translate(${e.clientX - 5}px,${e.clientY - 3}px)`;
      },
      true,
    );
    addEventListener(
      "mousedown",
      (e) => {
        const p = `translate(${e.clientX}px,${e.clientY}px)`;
        ring.style.setProperty("--p", p);
        ring.classList.remove("on");
        void ring.offsetWidth;
        ring.classList.add("on");
      },
      true,
    );
  };
  if (document.documentElement) install();
  document.addEventListener("DOMContentLoaded", install);
};

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--hide-scrollbars", "--font-render-hinting=none"],
});
const context = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
  locale: "en-US",
  colorScheme: "light",
  reducedMotion: "no-preference",
  recordVideo: { dir: TMP_DIR, size: { width: W, height: H } },
});
await context.route("**/api/**", (route) => route.abort("failed"));
await context.addInitScript(CURSOR_SCRIPT);

const page = await context.newPage();
const t0 = Date.now();
const timeline = [];
let chapter = "intro";
let mouse = { x: W * 0.62, y: H * 0.55 };

const now = () => (Date.now() - t0) / 1000;
const round = (n) => Math.round(n * 10) / 10;
function log(action, extra = {}) {
  const entry = { t: Math.round(now() * 1000) / 1000, chapter, action, ...extra };
  timeline.push(entry);
  console.log(`${entry.t.toFixed(2).padStart(7)}s  ${chapter.padEnd(10)} ${action}${extra.label ? `  ${extra.label}` : ""}`);
  return entry;
}
function boxOf(b) {
  return b ? { x: round(b.x), y: round(b.y), w: round(b.width), h: round(b.height) } : null;
}
async function snap(name) {
  if (!DEBUG) return;
  // Stills are clean captures for docs: the cursor overlay is hidden for the shot.
  await page.evaluate(() => document.documentElement.classList.add("__rec-hide")).catch(() => {});
  await page.screenshot({ path: join(DEBUG_DIR, `${String(timeline.length).padStart(3, "0")}-${name}.png`) });
  await page.evaluate(() => document.documentElement.classList.remove("__rec-hide")).catch(() => {});
}
const pause = (ms) => page.waitForTimeout(ms);

/** Start a chapter: a marker the composition turns into a caption and a tick. */
async function startChapter(id) {
  chapter = id;
  log("chapter");
}

/** easeInOutCubic */
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Glide the pointer to (x, y) along a gently curved, eased path. The path is
 * animated inside the page on requestAnimationFrame, so it stays smooth at the
 * recording's frame rate whatever a CDP round trip costs; one real
 * `mousemove` then lands the pointer where the overlay already is.
 */
async function glide(x, y, ms) {
  const from = { ...mouse };
  const dist = Math.hypot(x - from.x, y - from.y);
  const dur = ms ?? Math.min(850, Math.max(300, dist * 0.7));
  await page
    .evaluate(
      ([fx, fy, tx, ty, d]) =>
        new Promise((resolve) => {
          const c = document.getElementById("__rec-cursor");
          if (!c) return resolve(undefined);
          const len = Math.hypot(tx - fx, ty - fy) || 1;
          const nx = -(ty - fy) / len;
          const ny = (tx - fx) / len;
          const bend = Math.min(60, len * 0.08);
          const e = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
          const start = performance.now();
          const step = (nowMs) => {
            const raw = Math.min(1, (nowMs - start) / d);
            const t = e(raw);
            const arc = Math.sin(Math.PI * t) * bend;
            const px = fx + (tx - fx) * t + nx * arc;
            const py = fy + (ty - fy) * t + ny * arc;
            c.style.transform = `translate(${px - 5}px,${py - 3}px)`;
            window.__recLast = { x: px, y: py };
            if (raw < 1) requestAnimationFrame(step);
            else resolve(undefined);
          };
          requestAnimationFrame(step);
        }),
      [from.x, from.y, x, y, dur],
    )
    .catch(() => {});
  await page.mouse.move(x, y);
  mouse = { x, y };
}

/** Scroll the window back to the top smoothly (the EHR tab strip scrolls with the page). */
async function toTop() {
  const y = await page.evaluate(() => window.scrollY);
  if (y < 4) return;
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await pause(Math.min(900, 300 + y * 0.6));
}

/** Smoothly scroll the window by dy pixels (native smooth scrolling, so the video shows it). */
async function smoothScrollBy(dy, label, ms = 900) {
  if (Math.abs(dy) < 8) return;
  log("scroll", { label, dy: Math.round(dy) });
  await page.evaluate((d) => window.scrollBy({ top: d, behavior: "smooth" }), dy);
  await pause(ms);
}

/** Drag with real mouse events (the 3D view needs every move), eased. */
async function dragTo(x, y, ms) {
  const from = { ...mouse };
  const dist = Math.hypot(x - from.x, y - from.y);
  const dur = ms;
  const steps = Math.max(8, Math.round(dur / 40));
  // A slight arc: offset the midpoint perpendicular to the travel direction.
  const nx = -(y - from.y) / (dist || 1);
  const ny = (x - from.x) / (dist || 1);
  const bend = Math.min(60, dist * 0.08);
  for (let i = 1; i <= steps; i++) {
    const t = ease(i / steps);
    const arc = Math.sin(Math.PI * t) * bend;
    const px = from.x + (x - from.x) * t + nx * arc;
    const py = from.y + (y - from.y) * t + ny * arc;
    await page.mouse.move(px, py);
    await pause(dur / steps);
  }
  mouse = { x, y };
}

async function target(locator) {
  await locator.waitFor({ state: "visible", timeout: 30_000 });
  // Out of view: scroll the window smoothly so the move is seen, then let
  // scrollIntoViewIfNeeded handle inner scroll containers.
  const pre = await locator.boundingBox();
  if (pre && (pre.y < 150 || pre.y + pre.height > H - 30)) {
    await page.evaluate((d) => window.scrollBy({ top: d, behavior: "smooth" }), pre.y - H * 0.42);
    await pause(750);
  }
  await locator.scrollIntoViewIfNeeded();
  const b = await locator.boundingBox();
  if (!b) throw new Error(`no box for ${locator}`);
  return b;
}

/**
 * Move to an element and click it. `zoom` is the camera scale the composition
 * should use for this step (0 for none); `focus` optionally names a larger
 * element whose box frames the zoom instead of the clicked control.
 */
async function click(locator, label, { zoom = 0, focus, hold = 350 } = {}) {
  const b = await target(locator);
  const fb = focus ? await focus.boundingBox() : null;
  await glide(b.x + b.width / 2, b.y + b.height / 2);
  await pause(120);
  log("click", { label, box: boxOf(b), focus: boxOf(fb), zoom });
  await page.mouse.down();
  await pause(70);
  await page.mouse.up();
  await pause(hold);
}

/** Click into a field and type, key by key, so the typing is seen. */
async function type(locator, text, label, { zoom = 0, focus, delay = 30, enter = false } = {}) {
  const b = await target(locator);
  const fb = focus ? await focus.boundingBox() : null;
  await glide(b.x + Math.min(b.width / 2, 160), b.y + b.height / 2);
  await pause(100);
  log("type", { label, text, box: boxOf(b), focus: boxOf(fb), zoom });
  await page.mouse.down();
  await page.mouse.up();
  await locator.fill("");
  await page.keyboard.type(text, { delay });
  if (enter) {
    await pause(180);
    await page.keyboard.press("Enter");
  }
  await pause(250);
}

/** Choose an option of a <select> (the click is real; the option is chosen by value). */
async function choose(locator, option, label, opts = {}) {
  const b = await target(locator);
  await glide(b.x + Math.min(b.width / 2, 160), b.y + b.height / 2);
  await pause(100);
  log("select", { label, box: boxOf(b), focus: null, zoom: opts.zoom ?? 0 });
  await page.mouse.down();
  await page.mouse.up();
  await pause(250);
  await page.keyboard.press("Escape");
  await locator.selectOption(option);
  await pause(400);
}

/** Point at a region without clicking, so the camera can frame it. */
async function look(locator, label, { zoom = 1.35, dwell = 1600, point = true } = {}) {
  await locator.waitFor({ state: "visible", timeout: 6_000 });
  await locator.scrollIntoViewIfNeeded();
  const b = await locator.boundingBox();
  await lookBox(b, label, { zoom, dwell, point });
}

/** Frame an explicit box (page coordinates of the viewport). */
async function lookBox(b, label, { zoom = 1.35, dwell = 1600, point = true } = {}) {
  if (point) await glide(b.x + b.width * 0.5, b.y + Math.min(b.height * 0.5, 120));
  log("focus", { label, box: boxOf(b), focus: boxOf(b), zoom });
  await pause(dwell);
}

/** The viewport box that covers every given locator (all must be visible). */
async function union(...locators) {
  const boxes = [];
  for (const l of locators) {
    await l.waitFor({ state: "visible", timeout: 6_000 });
    const b = await l.boundingBox();
    if (b) boxes.push(b);
  }
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const r = Math.max(...boxes.map((b) => b.x + b.width));
  const btm = Math.max(...boxes.map((b) => b.y + b.height));
  return { x, y, width: r - x, height: btm - y };
}

/** Smooth wheel scroll inside the page by `dy` pixels. */
async function scroll(dy, label, ms = 900) {
  log("scroll", { label, dy });
  const steps = Math.round(ms / 16);
  let done = 0;
  for (let i = 1; i <= steps; i++) {
    const want = Math.round(dy * ease(i / steps));
    await page.mouse.wheel(0, want - done);
    done = want;
    await pause(16);
  }
  await pause(250);
}

/** Mark a span the composition compresses (waiting on timers, chunk loads). */
const skipBegin = (label) => log("skip-begin", { label });
const skipEnd = (label) => log("skip-end", { label });

const tab = (name) => page.getByRole("tablist", { name: "Chart sections" }).getByRole("tab", { name });
async function openTab(name, label) {
  await toTop();
  await click(tab(name), label);
}
const nav = (name) => page.locator("nav").getByRole("link", { name, exact: true }).first();

/** A lazy route chunk loading: wait for real content and mark the wait as a skip. */
async function routeLoad(label, ready) {
  skipBegin(label);
  await waitSettled();
  await ready.first().waitFor({ state: "visible", timeout: 30_000 });
  await pause(300);
  skipEnd(label);
}

async function waitSettled() {
  await page.locator("main#main").waitFor({ state: "visible" });
  await page
    .locator("main#main [role=status]")
    .first()
    .waitFor({ state: "hidden", timeout: 3_000 })
    .catch(() => {});
}

try {
  /* ------------------------------------------------------------ profile */
  await startChapter("profile");
  skipBegin("first load");
  await page.goto(`${BASE}/signin`);
  await page.getByRole("button", { name: "Create your profile" }).waitFor();
  await page.mouse.move(mouse.x, mouse.y);
  await pause(300);
  skipEnd("first load");
  await pause(500);
  await snap("signin");
  await click(page.getByRole("button", { name: "Create your profile" }), "Create your profile", { zoom: 1.4 });
  await page.getByLabel("Full name").waitFor();
  await pause(400);
  const form = page.locator("form").first();
  await type(page.getByLabel("Full name"), "Elif Kaya", "Full name", { zoom: 1.5, focus: form });
  await choose(page.getByLabel("Role", { exact: true }), "student", "Role: student", { zoom: 1.5 });
  await type(page.getByLabel("Institution"), "Ankara Faculty of Medicine", "Institution", { zoom: 1.5, focus: form });
  await snap("profile");
  await click(page.getByRole("button", { name: "Create profile" }), "Create profile", { zoom: 1.5, focus: form });
  await routeLoad("home load", page.locator("main#main h1"));
  await pause(900);
  await snap("home");

  /* ------------------------------------------------------------ case */
  await startChapter("case");
  await click(nav("Cases"), "Cases");
  await routeLoad("cases load", page.getByRole("region", { name: "Generate a case" }).getByRole("button", { name: "Quick generate" }));
  await pause(500);
  const gen = page.getByRole("region", { name: "Generate a case" });
  await choose(gen.locator("select").first(), { label: "Infectious" }, "Chief complaint: Infectious", { zoom: 1.45 });
  // The generator draws by prevalence within the family; keep drawing until it
  // serves the community-acquired pneumonia presentation (cough and fever).
  // Extra draws are marked as a skip so the edit compresses them.
  let drew = 0;
  for (;;) {
    if (drew === 1) skipBegin("redraw");
    await click(gen.getByRole("button", { name: "Quick generate" }), "Quick generate", { zoom: drew === 0 ? 1.45 : 0, hold: 700 });
    drew++;
    const first = await page.locator("tbody tr").first().innerText();
    if (/cough, fever/i.test(first) || drew > 12) break;
  }
  if (drew > 1) skipEnd("redraw");
  const row = page.locator("tbody tr").first();
  await look(row, "Generated case: cough, fever and breathlessness", { zoom: 1.5, dwell: 1300 });
  await snap("generated");
  await click(row.getByRole("button", { name: /Start/ }), "Start", { zoom: 1.5, focus: row });
  await routeLoad("encounter load", tab("Chart Review"));
  await pause(700);

  /* ------------------------------------------------------------ chart */
  await startChapter("chart");
  await look(page.locator("header, [data-patient-banner], section").filter({ hasText: "Chief complaint" }).first(), "Patient banner", {
    zoom: 1.45,
    dwell: 1800,
  });
  await snap("chart");
  await look(page.getByText(/Vitals snapshot/i).first().locator("xpath=ancestor::section[1]"), "Vitals snapshot", { zoom: 1.6, dwell: 1500 }).catch(
    async () => {
      await pause(1200);
    },
  );

  /* ------------------------------------------------------------ interview */
  await startChapter("interview");
  await openTab("Interview", "Interview tab");
  await pause(500);
  const composer = page.getByPlaceholder("Type a question to the patient, then press Enter");
  const transcript = page.getByRole("log", { name: "Encounter transcript" });
  const questions = [
    "When did the cough start?",
    "Have you had a fever along with it?",
    "How severe is the breathlessness?",
    "Any risk factors, like a chronic lung condition?",
  ];
  for (const [i, q] of questions.entries()) {
    await type(composer, q, `Question ${i + 1}`, { zoom: 1.3, focus: transcript, enter: true });
    await transcript
      .getByRole("listitem")
      .filter({ hasText: /^Patient/ })
      .nth(i)
      .waitFor({ timeout: 15_000 })
      .catch(() => {});
    await pause(900);
  }
  await look(transcript, "Transcript with patient replies", { zoom: 1.3, dwell: 1600 });
  await snap("interview");

  /* ------------------------------------------------------------ exam */
  await startChapter("exam");
  await click(page.getByRole("button", { name: "Auscultate lungs" }), "Auscultate lungs", { zoom: 1.45, hold: 900 });
  await snap("exam");
  await click(page.getByRole("button", { name: "Recheck vitals" }), "Recheck vitals", { zoom: 0, hold: 700 });
  await look(page.getByText(/Exam findings/i).first().locator("xpath=ancestor::section[1]"), "Exam findings in the chart rail", {
    zoom: 1.6,
    dwell: 1500,
  }).catch(async () => pause(1000));

  /* ------------------------------------------------------------ orders */
  await startChapter("orders");
  await openTab(/^Orders/, "Orders tab");
  await pause(500);
  const search = page.getByPlaceholder(/Search tests/);
  const orders = [
    ["CBC", /^Order Complete blood count/],
    ["CRP", /^Order C-reactive protein/],
    ["lactate", /^Order Lactate$/],
    ["blood culture", /^Order Blood culture/],
    ["chest x-ray", /^Order Chest X-ray/],
    ["ECG", /^Order 12-lead ECG/],
  ];
  for (const [q, name] of orders) {
    await type(search, q, `Search ${q}`, { zoom: 1.25, delay: 45 });
    await click(page.getByRole("button", { name }).first(), `Order ${q}`, { zoom: 1.25, hold: 450 });
  }
  await search.fill("");
  await snap("orders");

  /* ------------------------------------------------------------ results */
  await startChapter("results");
  const tracker = page.getByText(/6 placed · \d+ pending · \d+ resulted/).first();
  const trackerPanel = page.getByText("Order tracker").first();
  await lookBox(await union(trackerPanel, tracker), "Order tracker", { zoom: 1.5, dwell: 1500 }).catch(async () => pause(1000));
  skipBegin("results turnaround");
  await page.getByText(/6 placed · 0 pending · 6 resulted/).first().waitFor({ timeout: 240_000 }).catch(() => {});
  await pause(400);
  skipEnd("results turnaround");
  await lookBox(await union(trackerPanel, page.getByText(/12-lead ECG/).last()), "All six resulted", { zoom: 1.5, dwell: 1300 }).catch(async () =>
    pause(800),
  );
  await openTab(/^Results/, "Results tab");
  await pause(800);
  await snap("results");
  // Provenance: every result row carries where it came from (case record,
  // offline synthetic), and the summary counts abnormal and critical values.
  await lookBox(await union(page.getByText("Result summary").first(), page.getByText("Critical values").first()), "Result summary and critical value", {
    zoom: 1.35,
    dwell: 1500,
  }).catch(async () => pause(900));
  await lookBox(
    await union(page.getByText(/Complete blood count \(CBC\) with differential/).nth(0), page.getByText("Case record").first(), page.getByText("Haemoglobin").first()),
    "Provenance chips",
    { zoom: 1.6, dwell: 1700 },
  ).catch(async () => pause(900));
  const ecg = page.getByRole("img", { name: /ECG|electrocardiogram/i }).first();
  const ecgBox = await ecg.boundingBox();
  if (ecgBox) await smoothScrollBy(ecgBox.y - 250, "Scroll to the ECG");
  await look(ecg, "12-lead ECG strip", { zoom: 1.3, dwell: 2300 }).catch(async () => pause(1200));
  await snap("ecg");

  /* ------------------------------------------------------------ guidance */
  await startChapter("guidance");
  await openTab("Guidance", "Guidance tab");
  await pause(700);
  await snap("guidance");
  await lookBox(await union(page.getByText("Attending tips").first(), page.getByText("What a strong work-up covers").first()), "Attending tips", {
    zoom: 1.4,
    dwell: 1800,
  }).catch(async () => pause(1200));
  const chip = page.getByText("Source unavailable").first();
  await lookBox(await union(chip, page.getByText(/within \d+ min/).first()), "Citation chips", { zoom: 1.7, dwell: 1700 }).catch(async () => pause(1000));

  /* ------------------------------------------------------------ treat */
  await startChapter("treat");
  await openTab(/^Orders/, "Orders tab");
  await pause(400);
  await click(page.getByRole("tab", { name: "Treatments" }), "Treatments", { zoom: 1.3 });
  await pause(500);
  const adminPara = page.getByRole("button", { name: /^Administer .*Paracetamol/i }).first();
  await click(adminPara, "Administer paracetamol", { zoom: 1.35 });
  const give = page.getByRole("button", { name: /^Confirm and administer / }).first();
  await give.waitFor();
  await pause(300);
  const doseBox = await union(page.getByText("Paracetamol", { exact: true }).first(), give, page.getByText(/Adult range/).first());
  await lookBox(doseBox, "Dose, route and indication form", { zoom: 1.5, dwell: 2000 }).catch(async () => pause(1200));
  await snap("dose");
  await click(give, "Confirm and administer", { zoom: 1.5, focus: give, hold: 900 });
  await lookBox(doseBox, "Given and charted", { zoom: 1.5, dwell: 1300, point: false }).catch(async () => pause(800));

  /* ------------------------------------------------------------ diagnose */
  await startChapter("diagnose");
  await openTab(/Problem List/, "Problem List tab");
  await pause(500);
  const dxSearch = page.getByPlaceholder("Search diagnoses or ICD/DSM code...");
  await type(dxSearch, "pneumonia", "Search diagnoses", { zoom: 1.35 });
  const add = page.getByRole("button", { name: /^Add .*pneumonia.* to the differential$/i }).first();
  await add.waitFor();
  const dxName = (await add.getAttribute("aria-label")).replace(/^Add /, "").replace(/ to the differential$/, "");
  await click(add, `Add ${dxName}`, { zoom: 1.35 });
  await click(page.getByRole("button", { name: `Commit ${dxName} as the working diagnosis` }), "Commit diagnosis", { zoom: 1.35, hold: 900 });
  await snap("committed");
  const debrief = page.getByRole("button", { name: "View attending debrief" });
  await lookBox(await union(page.getByText("Working diagnosis", { exact: true }).first(), debrief), "Verdict", { zoom: 1.3, dwell: 1500 }).catch(
    async () => pause(900),
  );

  /* ------------------------------------------------------------ feedback */
  await startChapter("feedback");
  await click(debrief, "View attending debrief", { zoom: 1.3, hold: 900 });
  const dlg = page.getByRole("dialog", { name: /Attending debrief/ });
  await look(dlg, "Attending debrief", { zoom: 1.15, dwell: 1800, point: false }).catch(async () => pause(1000));
  await snap("debrief");
  await click(page.getByRole("button", { name: "View full report" }), "View full report", { zoom: 1.3 });
  await routeLoad("feedback load", page.getByText("Confidence vs performance"));
  await pause(700);
  await snap("feedback");
  const calibTitle = page.getByText("Confidence vs performance").first();
  await calibTitle.waitFor({ timeout: 10_000 });
  const ct = await calibTitle.boundingBox();
  if (ct) await smoothScrollBy(ct.y - 70, "Scroll to the calibration plot", 1100);
  const plotBox = await union(calibTitle, page.getByText("Your confidence").first());
  await lookBox(plotBox, "Calibration plot", { zoom: 1.45, dwell: 1000 });
  const dot = page.locator("svg circle").nth(0);
  if (await dot.isVisible().catch(() => false)) {
    const db = await dot.boundingBox();
    await glide(db.x + db.width / 2, db.y + db.height / 2, 700);
    log("focus", { label: "A domain on the plot", box: boxOf(db), focus: boxOf(plotBox), zoom: 1.45 });
    await pause(1600);
  }
  await snap("calibration");

  /* ------------------------------------------------------------ dean */
  await startChapter("dean");
  await click(page.getByRole("link", { name: "Account" }).first(), "Account").catch(async () => {
    await page.goto(`${BASE}/account`);
  });
  await routeLoad("account load", page.getByLabel("Role", { exact: true }));
  await pause(500);
  // Local profiles may take any role (no identity provider configured); with
  // OIDC the role comes from verified claims instead.
  await choose(page.getByLabel("Role", { exact: true }), "admin", "Role: Platform administrator (local profile)", { zoom: 1.5 });
  await click(page.getByRole("button", { name: /^Save/ }).first(), "Save changes", { zoom: 1.5, hold: 800 });
  await snap("role");
  await click(nav("Institution"), "Institution").catch(async () => {
    await page.goto(`${BASE}/dean`);
  });
  await routeLoad("dean load", page.getByText("Your headline metrics"));
  await pause(700);
  await snap("dean");
  await lookBox(await union(page.getByText("Your headline metrics").first(), page.getByText("Domains scored").first()), "Headline metrics", {
    zoom: 1.25,
    dwell: 1500,
  }).catch(async () => pause(1000));
  const heat = page.getByText("Cohort competency heatmap").first();
  const hb = await heat.boundingBox();
  if (hb) await smoothScrollBy(hb.y - 80, "Scroll to the heatmap", 1100);
  await lookBox(await union(heat, page.getByText("Select any cell to inspect the evidence behind its band.").first()), "Competency heatmap", {
    zoom: 1.2,
    dwell: 1800,
  }).catch(async () => pause(1200));
  await snap("dean-2");

  /* ------------------------------------------------------------ admin */
  await startChapter("admin");
  await toTop();
  await click(nav("Admin"), "Admin").catch(async () => {
    await page.goto(`${BASE}/admin`);
  });
  await routeLoad("admin load", page.getByText("Admin sign-in"));
  await pause(600);
  await snap("admin");
  const tokenField = page.getByLabel("Admin token").first();
  await lookBox(await union(page.getByText("Admin sign-in").first(), page.getByRole("button", { name: "Sign in" }).first()), "Admin token gate", {
    zoom: 1.6,
    dwell: 1000,
  }).catch(async () => pause(800));
  await click(tokenField, "Admin token field", { zoom: 1.6, hold: 1100 }).catch(async () => pause(600));

  /* ------------------------------------------------------------ atlas */
  await startChapter("atlas");
  // Admin navigation is console-first; "View as Learner" brings the learner rail back.
  await click(page.getByRole("button", { name: /Learner/ }).first(), "View as Learner").catch(async () => {});
  await pause(500);
  await click(nav("Atlas"), "Atlas").catch(async () => {
    await page.goto(`${BASE}/atlas`);
  });
  await routeLoad("atlas load", page.getByRole("tablist", { name: "Atlas view" }));
  await pause(600);
  const modes = page.getByRole("tablist", { name: "Atlas view" });
  await click(modes.getByRole("tab", { name: "3D organs" }), "3D organs", { zoom: 1.3 });
  skipBegin("3D load");
  const canvas = page.locator("canvas").first();
  await canvas.waitFor({ state: "visible", timeout: 30_000 });
  await pause(2500);
  skipEnd("3D load");
  const spin = page.getByRole("button", { name: /Spin/ }).first();
  if (await spin.isVisible().catch(() => false)) await click(spin, "Spin", { zoom: 0, hold: 300 });
  const cb = await canvas.boundingBox();
  if (cb) {
    await glide(cb.x + cb.width * 0.55, cb.y + cb.height * 0.45);
    log("focus", { label: "3D organs from TotalSegmentator", box: boxOf(cb), focus: boxOf(cb), zoom: 1.2 });
    await pause(3200);
  }
  await snap("atlas");
  await pause(600);
} catch (err) {
  console.error(err);
  await page.screenshot({ path: join(ROOT, "out", "record-failure.png") }).catch(() => {});
  process.exitCode = 1;
} finally {
  const video = page.video();
  await context.close();
  await browser.close();
  const raw = video ? await video.path() : null;
  if (raw && process.exitCode !== 1) {
    renameSync(raw, join(REC_DIR, "walkthrough.webm"));
    writeFileSync(
      join(REC_DIR, "walkthrough.json"),
      JSON.stringify({ width: W, height: H, duration: now(), base: BASE, recordedAt: new Date().toISOString(), events: timeline }, null, 2) + "\n",
    );
    console.log(`wrote public/recording/walkthrough.webm and walkthrough.json (${timeline.length} events, ${now().toFixed(1)} s)`);
  }
  for (const f of readdirSync(TMP_DIR)) rmSync(join(TMP_DIR, f), { force: true });
  rmSync(TMP_DIR, { recursive: true, force: true });
}
