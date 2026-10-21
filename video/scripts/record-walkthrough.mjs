#!/usr/bin/env node
/**
 * Record the AcuDx product walkthrough as a real screen recording.
 *
 * v3 (renewed UI, chat with in-chat order and navigate chips, results on clinical
 * turnaround, cited process debrief, rooms). Drives the running web app through
 * one student encounter on a case
 * generated on request (a recorded live model case, replayed as the staged
 * stream), the Clinical Director stepping the patient after treatments, then
 * the admin console telemetry and the dean panel, with Playwright's
 * `recordVideo` at 1920 x 1080. Every step is written to a JSON timeline (time
 * since the recording started, action, chapter and the element's bounding
 * box) that the Remotion `Walkthrough` composition reads for its
 * zoom-to-focus camera, captions and chapter markers. The live patient video
 * chapter is spliced in by the composition from docs/media/live-avatar (a
 * real capture of the MuseTalk worker), see video/README.md.
 *
 *   bash /path/to/gateway.sh   # uvicorn server.app:app on 8931, ADMIN_TOKEN and ACUDX_DB_PATH set
 *   API_PROXY_TARGET=http://127.0.0.1:8931 npm --prefix web run dev -- --port 4197
 *   cd video && GATEWAY_DB=<the gateway's ACUDX_DB_PATH> ADMIN_TOKEN=<its token> npm run record
 *
 * Case source: POST /api/v2/case/generate/stream is intercepted and answered
 * with the recorded live model output the e2e suite replays
 * (web/e2e/helpers/liveCase.ts LIVE_CASES, server/tests/fixtures/live), paced
 * as the staged generator writes it (scripts/staged-replay.mjs). The same
 * thread is stored in the gateway's CaseStore (scripts/seed-thread.py), so
 * every other /api call (patient turn, results engine, Director, telemetry,
 * dean analytics) is answered by the real local gateway. The gateway has no
 * model endpoint in this run: the Director narrates with its deterministic
 * line, and the telemetry counts the failed model calls as errors.
 *
 * Outputs:
 *   public/recording/walkthrough.webm      the raw recording
 *   public/recording/walkthrough.json      the timeline
 *   out/record-debug/*.png                 one still per chapter (with --debug)
 *
 * Environment: BASE_URL (default http://localhost:4197), GATEWAY_DB (required),
 * ADMIN_TOKEN (required), GATEWAY_PYTHON (default python3), CHROMIUM_PATH
 * (default the Playwright Chromium under /opt/pw-browsers). Never runs
 * `playwright install`.
 */
import { chromium } from "playwright-core";
import { spawnSync } from "node:child_process";
import { mkdirSync, renameSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LIVE_CASES } from "../../web/e2e/helpers/liveCase.ts";
import { installStagedReplay } from "./staged-replay.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.BASE_URL ?? "http://localhost:4197";
const CHROME = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const GATEWAY_DB = process.env.GATEWAY_DB;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const PYTHON = process.env.GATEWAY_PYTHON ?? "python3";
if (!GATEWAY_DB || !ADMIN_TOKEN) throw new Error("set GATEWAY_DB and ADMIN_TOKEN to the local gateway's ACUDX_DB_PATH and ADMIN_TOKEN");
const DEBUG = process.argv.includes("--debug");
const REC_DIR = join(ROOT, "public", "recording");
const TMP_DIR = join(REC_DIR, ".tmp");
const DEBUG_DIR = join(ROOT, "out", "record-debug");
const W = 1920;
const H = 1080;
/** The recorded sepsis case (fever and rigors): the one whose course answers fluids, oxygen and an antibiotic. */
const CASE = LIVE_CASES.find((c) => c.spec.meta.condition_id === "sepsis_uncomplicated") ?? LIVE_CASES[0];

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
await installStagedReplay(context, [CASE], {
  onGenerate: ({ body, rec, threadId }) => {
    const r = spawnSync(PYTHON, [join(ROOT, "scripts", "seed-thread.py"), GATEWAY_DB, threadId, String(body.learner_id ?? "")], {
      input: JSON.stringify(rec),
      encoding: "utf8",
    });
    if (r.status !== 0) throw new Error(`seed-thread failed: ${r.stderr}`);
  },
});
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
  await pause(700);

  /* ------------------------------------------------------------ request */
  await startChapter("request");
  await click(nav("Start"), "Start");
  await routeLoad("start load", page.getByRole("button", { name: "Begin encounter" }));
  await pause(500);
  const fever = page.locator("main#main").getByRole("button", { name: /^Fever/ }).or(page.locator("main#main").getByRole("radio", { name: /^Fever/ })).first();
  await click(fever, "Presentation: Fever", { zoom: 1.4 });
  await snap("request");
  const begin = page.getByRole("button", { name: "Begin encounter" });
  await click(begin, "Begin encounter", { zoom: 1.4, hold: 200 });

  /* ------------------------------------------------------------ generate */
  await startChapter("generate");
  const writing = page.getByText(/Writing your case/).first();
  await writing.waitFor({ timeout: 20_000 });
  const card = writing.locator("xpath=ancestor::*[contains(@class,'border')][1]");
  await pause(1200);
  await lookBox(await card.boundingBox(), "Opening streams in", { zoom: 1.5, dwell: 3200, point: false }).catch(async () => pause(2000));
  await snap("opening");
  await tab("Chart Review").waitFor({ timeout: 30_000 });
  await pause(500);
  const pending = page.getByText(/is being written for this patient/).first();
  if (await pending.isVisible().catch(() => false)) {
    const pb = await pending.boundingBox();
    await lookBox({ x: 276, y: pb.y - 14, width: 1600, height: 70 }, "Layers written for this patient", { zoom: 1.2, dwell: 2600 });
    await snap("layers");
  }
  skipBegin("layers finish");
  await pending.waitFor({ state: "hidden", timeout: 40_000 }).catch(() => {});
  await pause(400);
  skipEnd("layers finish");

  /* ------------------------------------------------------------ chart */
  await startChapter("chart");
  const banner = page.getByText("model generated").first();
  await lookBox(await union(page.getByText(CASE.spec.demographics.name_hint).first(), banner), "Banner: model generated", { zoom: 1.6, dwell: 2200 });
  await snap("chart");
  await look(page.getByText(/Vitals snapshot/i).first().locator("xpath=ancestor::section[1]"), "Vitals snapshot", { zoom: 1.6, dwell: 1300 }).catch(async () => pause(900));

  /* ------------------------------------------------------------ interview */
  await startChapter("interview");
  await openTab("Interview", "Interview tab");
  await pause(500);
  const composer = page.getByPlaceholder("Type a question to the patient, then press Enter"); // watchdog: allow Playwright locator API, not data
  const transcript = page.getByRole("log").first();
  // Typed free text (docs/design/05-chat.md section 2); the composer ignores Enter while a reply is in flight.
  const questions = ["When did the fever start?", "How severe is the fever?", "Have you had chills or body aches?"];
  for (const [i, q] of questions.entries()) {
    await type(composer, q, `Question ${i + 1}`, { zoom: 1.3, focus: transcript, enter: true });
    await page.getByText("Sending", { exact: true }).first().waitFor({ state: "hidden", timeout: 60_000 }).catch(() => {});
    await page.waitForFunction(() => !document.querySelector("textarea")?.value, null, { timeout: 60_000 }).catch(() => {});
    await pause(900);
  }
  await look(transcript, "Transcript with patient replies", { zoom: 1.3, dwell: 1400 });
  await snap("interview");

  /* ------------------------------------------------------------ call (the composition splices the live capture here) */
  await startChapter("call");
  const callTile = page.getByText("Patient call", { exact: true }).first().locator("xpath=ancestor::*[contains(@class,'border')][1]");
  await look(callTile, "Patient call tile", { zoom: 1.3, dwell: 1800 }).catch(async () => pause(1500));

  /* ------------------------------------------------------------ exam */
  await startChapter("exam");
  // Examination manoeuvres live in the Suggestions drawer above the composer.
  const drawerToggle = page.getByRole("button", { name: "Suggestions" }).first();
  async function drawer(open) {
    if (((await drawerToggle.getAttribute("aria-expanded")) === "true") !== open) {
      await click(drawerToggle, open ? "Open suggestions" : "Close suggestions", { zoom: open ? 1.35 : 0, hold: 500 });
    }
  }
  await drawer(true);
  await click(page.getByRole("button", { name: "Auscultate lungs", exact: true }).first(), "Auscultate lungs", { zoom: 1.45, hold: 900 });
  await drawer(false);
  await snap("exam");
  await look(transcript.getByRole("listitem").last(), "Exam finding in the transcript", { zoom: 1.5, dwell: 1300 }).catch(async () => pause(900));

  /* ------------------------------------------------------------ chat order */
  await startChapter("chatorder");
  await type(composer, "/order lactate", "Slash command: /order lactate", { zoom: 1.4, delay: 55 });
  const lactate = page.getByRole("option", { name: /^Lactate(?! dehydrogenase)/ }).first();
  await lactate.waitFor();
  await pause(500);
  await click(lactate, "Lactate", { zoom: 1.4, hold: 500 });
  const place = page.getByRole("button", { name: "Place order" }).first();
  await place.waitFor();
  await look(place.locator("xpath=ancestor::*[@role='group'][1]"), "Order chip, confirm step", { zoom: 1.6, dwell: 1500 }).catch(async () => pause(900));
  await snap("chat-order");
  await click(place, "Place order", { zoom: 1.6, hold: 1200 });

  /* ------------------------------------------------------------ orders */
  await startChapter("orders");
  await openTab(/^Orders/, "Orders tab");
  await pause(500);
  const search = page.getByPlaceholder(/Search tests/); // watchdog: allow Playwright locator API, not data
  const orders = [
    ["CBC", /^Order Complete blood count/],
    ["blood culture", /^Order Blood culture/],
    ["chest x-ray", /^Order Chest X-ray/],
    ["ECG", /^Order 12-lead ECG/],
  ];
  for (const [q, name] of orders) {
    await type(search, q, `Search ${q}`, { zoom: 1.25, delay: 45 });
    await click(page.getByRole("button", { name }).first(), `Order ${q}`, { zoom: 1.25, hold: 450 });
  }
  await search.fill("");
  const tracker = page.getByText("Order tracker").first().locator("xpath=ancestor::*[contains(@class,'border')][1]");
  await look(tracker, "Order tracker with turnaround", { zoom: 1.35, dwell: 1800 }).catch(async () => pause(1000));
  await snap("orders");

  /* ------------------------------------------------------------ treat */
  await startChapter("treat");
  await click(page.getByRole("tab", { name: "Treatments" }), "Treatments", { zoom: 1.3 });
  await pause(500);
  for (const [drug, label] of [
    [/^Administer IV fluid bolus/, "IV fluid bolus"],
    [/^Administer Oxygen/, "Oxygen"],
    [/^Administer Ceftriaxone/, "Ceftriaxone"],
  ]) {
    await click(page.getByRole("button", { name: drug }).first(), `Administer ${label}`, { zoom: 1.35, hold: 400 });
    const give = page.getByRole("button", { name: /^Confirm and administer / }).first();
    await give.waitFor();
    await pause(500);
    if (label === "IV fluid bolus") {
      const doseBox = await union(give, page.getByText(/Adult range/).first()).catch(() => null);
      if (doseBox) await lookBox(doseBox, "Dose, route and indication form", { zoom: 1.4, dwell: 1500 });
      await snap("dose");
    }
    await click(give, `Confirm ${label}`, { zoom: 1.35, hold: 1100 });
  }

  /* ------------------------------------------------------------ director */
  await startChapter("director");
  await openTab("Interview", "Interview tab");
  await pause(600);
  // Each action is one Director step on the server: the course engine moves the patient.
  await drawer(true);
  await click(page.getByRole("button", { name: "Recheck vitals", exact: true }).first(), "Recheck vitals", { zoom: 1.4, hold: 900 });
  await drawer(false);
  const chip = page.getByText(/Director: \d+ steps?/).first();
  await look(chip, "Director steps", { zoom: 1.7, dwell: 1200 }).catch(async () => pause(800));
  await openTab("Monitor", "Monitor tab");
  await pause(1500);
  await look(page.getByText("Bedside monitor").first().locator("xpath=ancestor::*[contains(@class,'rounded')][1]"), "Bedside monitor", {
    zoom: 1.15,
    dwell: 2000,
    point: false,
  }).catch(async () => pause(1500));
  await snap("monitor");
  const trends = page.getByText("Trends", { exact: true }).first();
  const tb = await trends.boundingBox();
  if (tb) await smoothScrollBy(tb.y - 120, "Scroll to the trends", 1000);
  await lookBox(await union(trends, page.getByText(/Treatment/).last()), "Trends with treatment markers", { zoom: 1.3, dwell: 2200 }).catch(async () => pause(1500));
  await snap("trends");

  /* ------------------------------------------------------------ results */
  await startChapter("results");
  await openTab(/^Results/, "Results tab");
  await pause(800);
  await look(page.getByText(/Pending/).first().locator("xpath=ancestor::*[contains(@class,'border')][1]"), "Results pending with turnaround", {
    zoom: 1.3,
    dwell: 1800,
  }).catch(async () => pause(1000));
  await snap("results-pending");
  // Turnaround is clinical (ECG minutes, culture days): advance the sim clock to each next result.
  for (let i = 0; i < 24; i++) {
    const summary = (await page.getByText(/of \d+ orders resulted/).first().textContent().catch(() => "")) ?? "";
    const m = /(\d+) of (\d+) orders resulted/.exec(summary);
    if (m && Number(m[1]) >= Number(m[2]) - 1) break;
    const advance = page.getByRole("button", { name: /^Advance to next result/ }).first();
    if (!(await advance.count())) break;
    await click(advance, `Advance to next result ${i + 1}`, { zoom: i === 0 ? 1.4 : 0, hold: 900 });
  }
  await pause(800);
  // The nurse calls each result in on the chat, with a jump to it.
  await openTab("Interview", "Interview tab");
  await pause(800);
  const nurse = transcript.getByRole("listitem").filter({ hasText: /^Nurse/ }).last();
  await look(nurse, "Nurse calls the results in", { zoom: 1.4, dwell: 1600 }).catch(async () => pause(1000));
  await snap("nurse");
  const openLink = transcript.getByText(/^Open Results$/).last();
  await click(openLink, "Open Results from the chat", { zoom: 1.5, hold: 1400 });
  await snap("results");
  await lookBox(await union(page.getByText("Result summary").first(), page.getByText(/Critical values|Abnormal/).first()), "Result summary", {
    zoom: 1.35,
    dwell: 1500,
  }).catch(async () => pause(900));
  const ecg = page.getByRole("img", { name: /ECG|electrocardiogram/i }).first();
  const ecgBox = await ecg.boundingBox().catch(() => null);
  if (ecgBox) await smoothScrollBy(ecgBox.y - 250, "Scroll to the ECG");
  await look(ecg, "12-lead ECG strip", { zoom: 1.3, dwell: 2000 }).catch(async () => pause(1200));
  await snap("ecg");

  /* ------------------------------------------------------------ guidance */
  await startChapter("guidance");
  await openTab("Guidance", "Guidance tab");
  await pause(800);
  await snap("guidance");
  await look(page.locator('[role="tabpanel"][data-state="active"]').first(), "Guidance panel", { zoom: 1.2, dwell: 2200, point: false }).catch(async () => pause(1200));

  /* ------------------------------------------------------------ diagnose */
  await startChapter("diagnose");
  await openTab(/Problem List/, "Problem List tab");
  await pause(500);
  const dxSearch = page.getByPlaceholder("Search diagnoses or ICD/DSM code..."); // watchdog: allow Playwright locator API, not data
  await type(dxSearch, "sepsis", "Search diagnoses", { zoom: 1.35 });
  const add = page.getByRole("button", { name: /^Add .*sepsis.* to the differential$/i }).first();
  await add.waitFor();
  const dxName = (await add.getAttribute("aria-label")).replace(/^Add /, "").replace(/ to the differential$/, "");
  await click(add, `Add ${dxName}`, { zoom: 1.35 });
  await click(page.getByRole("button", { name: `Commit ${dxName} as the working diagnosis` }), "Commit diagnosis", { zoom: 1.35, hold: 900 });
  await snap("committed");
  const debrief = page.getByRole("button", { name: "View attending debrief" });
  await lookBox(await union(page.getByText("Working diagnosis", { exact: true }).first(), debrief), "Verdict", { zoom: 1.3, dwell: 1400 }).catch(async () =>
    pause(900),
  );

  /* ------------------------------------------------------------ feedback */
  await startChapter("feedback");
  await click(debrief, "View attending debrief", { zoom: 1.3, hold: 900 });
  const dlg = page.getByRole("dialog", { name: /Attending debrief/ });
  await look(dlg, "Attending debrief", { zoom: 1.15, dwell: 1700, point: false }).catch(async () => pause(1000));
  await snap("debrief");
  await click(page.getByRole("button", { name: "View full report" }), "View full report", { zoom: 1.3 });
  await routeLoad("feedback load", page.getByText("Confidence vs performance"));
  await pause(700);
  // The process section: every check measured against a guideline target, with its citation.
  const proc = page.getByRole("region", { name: "Process and timing" }).first();
  const pb0 = await proc.boundingBox().catch(() => null);
  if (pb0) {
    await smoothScrollBy(pb0.y - 70, "Scroll to process and timing", 1200);
    await look(proc, "Process and timing, cited", { zoom: 1.15, dwell: 2600, point: false }).catch(async () => pause(1500));
    await snap("process");
    await toTop();
  }
  const calibTitle = page.getByText("Confidence vs performance").first();
  const ct = await calibTitle.boundingBox();
  if (ct) await smoothScrollBy(ct.y - 70, "Scroll to the calibration plot", 1100);
  const plotBox = await union(calibTitle, page.getByText("Your confidence").first()).catch(() => null);
  if (plotBox) await lookBox(plotBox, "Calibration plot", { zoom: 1.45, dwell: 1800 });
  await snap("calibration");

  /* ------------------------------------------------------------ admin */
  await startChapter("admin");
  await toTop();
  await click(page.getByRole("link", { name: "Account" }).first(), "Account").catch(async () => {
    await page.goto(`${BASE}/account`);
  });
  await routeLoad("account load", page.getByLabel("Role", { exact: true }));
  await pause(400);
  // Local profiles may pick any role (no identity provider configured); the server caps an
  // unverified header principal at resident, so the panels below need the admin token.
  await choose(page.getByLabel("Role", { exact: true }), "admin", "Role: Platform administrator (local profile)", { zoom: 1.5 });
  await click(page.getByRole("button", { name: /^Save/ }).first(), "Save changes", { zoom: 1.5, hold: 700 });
  await click(nav("Admin"), "Admin").catch(async () => {
    await page.goto(`${BASE}/admin`);
  });
  await routeLoad("admin load", page.getByText("Admin sign-in"));
  await pause(400);
  await type(page.getByLabel("Admin token").first(), ADMIN_TOKEN, "Admin token", { zoom: 1.6, delay: 20 });
  await click(page.getByRole("button", { name: "Sign in" }).first(), "Sign in", { zoom: 1.6, hold: 600 });
  skipBegin("console load");
  await page.getByText("Admin session active").first().waitFor({ timeout: 20_000 });
  await pause(1200);
  skipEnd("console load");
  await snap("admin");
  await click(page.getByRole("tab", { name: "Telemetry" }).first(), "Telemetry", { zoom: 1.3 });
  skipBegin("telemetry load");
  await page.getByText("Calls over time").first().waitFor({ timeout: 20_000 }).catch(() => {});
  await pause(1500);
  skipEnd("telemetry load");
  await lookBox(await union(page.getByText("Calls", { exact: true }).first(), page.getByText("P95 latency", { exact: false }).first()), "Telemetry headline", {
    zoom: 1.3,
    dwell: 1800,
  }).catch(async () => pause(1200));
  await snap("telemetry");
  const route = page.getByText("By route").first();
  const rb = await route.boundingBox().catch(() => null);
  if (rb) await smoothScrollBy(rb.y - 380, "Scroll to calls by route", 1100);
  await look(route.locator("xpath=ancestor::*[contains(@class,'border')][1]"), "Calls by route", { zoom: 1.4, dwell: 2000 }).catch(async () => pause(1200));
  await snap("telemetry-2");

  /* ------------------------------------------------------------ dean */
  await startChapter("dean");
  await toTop();
  await click(nav("Institution"), "Institution").catch(async () => {
    await page.goto(`${BASE}/dean`);
  });
  await routeLoad("dean load", page.getByText("Institution dashboard"));
  await pause(1500);
  await snap("dean");
  await lookBox(await union(page.getByText("Institution dashboard").first(), page.getByText(/Chain verified/).first()), "Dean panel and chain check", {
    zoom: 1.4,
    dwell: 1700,
  }).catch(async () => pause(1000));
  const kpi = page.getByText("Cohort headline metrics").first();
  await lookBox(await union(kpi, page.getByText("At-risk learners", { exact: true }).first()), "Cohort headline metrics", { zoom: 1.2, dwell: 2000 }).catch(
    async () => pause(1200),
  );
  const grid = page.getByText("Cohort competency grid").first();
  const gb = await grid.boundingBox().catch(() => null);
  if (gb) await smoothScrollBy(gb.y - 90, "Scroll to the competency grid", 1100);
  await look(grid, "Cohort competency grid", { zoom: 1.2, dwell: 2600, point: false }).catch(async () => pause(1500));
  await snap("dean-2");
  await pause(600);

  /* ------------------------------------------------------------ rooms */
  await startChapter("rooms");
  await toTop();
  await click(nav("Rooms"), "Rooms").catch(async () => {
    await page.goto(`${BASE}/rooms`);
  });
  await routeLoad("rooms load", page.getByRole("button", { name: "Create room" }));
  await pause(500);
  await click(page.getByRole("button", { name: "Create room" }).first(), "Create room", { zoom: 1.4 });
  const roomDialog = page.getByRole("dialog").first();
  await roomDialog.waitFor();
  await look(roomDialog, "Room: roles, AI backfill, language", { zoom: 1.25, dwell: 1800, point: false }).catch(async () => pause(1200));
  await click(roomDialog.getByRole("button", { name: /Create/ }).last(), "Create the room", { zoom: 1.4, hold: 300 });
  skipBegin("room case");
  await page.waitForURL(/\/rooms\/.+/, { timeout: 90_000 });
  await waitSettled();
  await pause(2500);
  skipEnd("room case");
  await look(page.locator("main#main"), "Team room: one case, a seat per role", { zoom: 1.1, dwell: 2600, point: false }).catch(async () => pause(1500));
  await snap("room");
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
