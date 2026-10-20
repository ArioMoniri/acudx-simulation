import { test, expect, type Page, type Request } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createProfile, openTab, settle } from "./helpers/session";

/**
 * Owner requirement: every case is generated on request and changes in flight.
 * There is no pre-generated case list a learner can open as an encounter.
 *
 * This spec encodes that requirement from every learner entry point:
 *   Start page, Cases page, the encounter's New case menu, Exam, the Rooms
 *   create dialog, and the Home recommended rail.
 * Starting a case from any of them must POST /v2/case/generate (or its /stream
 * twin) and open the case the server returned; a list rendered from bundled
 * data must never open as an encounter on its own. Two identical requests
 * must give different cases, and a learner action must reach
 * /v2/director/step with the returned patient_visible_changes shown.
 *
 * The gateway is intercepted with page.route and serves recorded live
 * responses (server/tests/fixtures/live/*.json) in the SSE shape that
 * web/src/lib/caseGenV2.ts consumes. No real gateway or model is needed.
 *
 * Tests marked test.fail() fail on today's code. Each one names its finding in
 * docs/review/06c-tester-on-request-cases.md; when the implementer fixes the
 * behaviour the test passes, Playwright reports "expected to fail but passed",
 * and the marker must be removed.
 *
 * Viewport: one project (laptop) is enough for a behavioural contract; layout
 * across viewports is covered by the screenshot / a11y specs. Run with
 *   PORT=4203 npx playwright test e2e/on-request.spec.ts --project=laptop
 */

// Every F-W1..F-W8 known-failure marker of docs/review/06c was flipped on 2026-10-20 (all pass).
const HERE = dirname(fileURLToPath(import.meta.url));
const LIVE_DIR = join(HERE, "../../server/tests/fixtures/live");

interface LiveRecord {
  thread_id: string;
  spec: {
    seed: number;
    demographics: { name_hint: string };
    condition: { label_en: string };
    meta: { condition_id: string };
    [k: string]: unknown;
  };
  trace_summary: Record<string, unknown>;
  trace: { node: string; status: string }[];
  council: unknown;
}

const LIVE: LiveRecord[] = ["fever-fever_and_cough", "fever-fever_and_rigors"].map(
  (name) => JSON.parse(readFileSync(join(LIVE_DIR, `${name}.json`), "utf8")) as LiveRecord,
);

const GEN_PATHS = new Set(["/api/v2/case/generate", "/api/v2/case/generate/stream"]);
const PIPELINE = ["sample_condition", "author", "clinical_consistency", "safety_dosing", "pedagogy", "aggregate", "repair", "ground", "finalize"];

/** What the Director answers to every step in this spec: a visible deterioration. */
const DIRECTOR_VITALS = { hr: 141, systolic: 86, diastolic: 52, rr: 30, spo2: 87, tempC: 39.6 };
const DIRECTOR_UTTERANCE = "It is getting harder to breathe, doctor, and I feel faint.";

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

interface Gateway {
  calls: Call[];
  served: LiveRecord[];
  generateCalls: () => Call[];
  directorCalls: () => Call[];
}

function sse(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** The recorded run replayed as the server's SSE stream (start, node..., done). */
function sseBody(rec: LiveRecord): string {
  let out = sse("start", { thread_id: rec.thread_id, pipeline: PIPELINE });
  for (const t of rec.trace) out += sse("node", { node: t.node, status: t.status, trace: [t] });
  out += sse("done", { thread_id: rec.thread_id, spec: rec.spec, trace_summary: rec.trace_summary });
  return out;
}

function bodyOf(req: Request): Record<string, unknown> | null {
  try {
    return (req.postDataJSON() as Record<string, unknown>) ?? null;
  } catch {
    return null;
  }
}

/**
 * Install a live gateway double on the page (page routes win over the
 * context-level abort that createProfile installs). Generate calls rotate
 * through the recorded live cases, so consecutive requests get different cases.
 */
async function liveGateway(page: Page, opts: { generateStatus?: number } = {}): Promise<Gateway> {
  const calls: Call[] = [];
  const served: LiveRecord[] = [];
  let next = 0;
  await page.route(
    (url) => url.pathname.startsWith("/api/"),
    async (route) => {
      const req = route.request();
      const path = new URL(req.url()).pathname;
      calls.push({ method: req.method(), path, body: bodyOf(req) });
      if (path === "/api/health") {
        return route.fulfill({
          json: { status: "ok", airgapped: false, provider: "double", model: "acudx-llm", llm_base_url: "", tiers: ["casegen"] },
        });
      }
      if (GEN_PATHS.has(path) && req.method() === "POST") {
        if (opts.generateStatus && opts.generateStatus !== 200) {
          return route.fulfill({
            status: opts.generateStatus,
            json: { error: "model_unreachable", detail: "the case generator model endpoint could not be reached" },
          });
        }
        const rec = LIVE[next % LIVE.length];
        next += 1;
        served.push(rec);
        if (path.endsWith("/stream")) {
          return route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: sseBody(rec) });
        }
        return route.fulfill({ json: { thread_id: rec.thread_id, spec: rec.spec, trace_summary: rec.trace_summary, trace: rec.trace, council: rec.council } });
      }
      if (path === "/api/v2/director/step" && req.method() === "POST") {
        const body = bodyOf(req) ?? {};
        const prev = (body.case_state as { t_ms?: number } | undefined)?.t_ms ?? 0;
        const t_ms = prev + 30_000;
        return route.fulfill({
          json: {
            case_state: { t_ms, condition_id: "double" },
            patient_visible_changes: {
              t_ms,
              vitals: DIRECTOR_VITALS,
              affect: { pain: 6, anxiety: 7, dyspnea: 7, consciousness: "alert", mood_en: "frightened", mood_tr: "korkmuş" },
              utterance_en: DIRECTOR_UTTERANCE,
              utterance_tr: "Nefes almak gittikçe zorlaşıyor doktor, bayılacak gibiyim.",
              new_facts: [],
              complications_fired: [],
              trace: [],
            },
            director_notes: [{ at_ms: t_ms, note: "deterioration", why: "test double" }],
          },
        });
      }
      // Everything else (patient turn, results, voice, auth...) is unavailable:
      // the app must keep working on its documented degraded path.
      return route.fulfill({ status: 503, json: { error: "not_in_test", detail: path } });
    },
  );
  return {
    calls,
    served,
    generateCalls: () => calls.filter((c) => c.method === "POST" && GEN_PATHS.has(c.path)),
    directorCalls: () => calls.filter((c) => c.method === "POST" && c.path === "/api/v2/director/step"),
  };
}

/** Wait until at least `n` generate POSTs were issued. */
async function expectGenerateCount(gw: Gateway, n: number, what: string): Promise<void> {
  await expect
    .poll(() => gw.generateCalls().length, { message: `${what}: POST /v2/case/generate[/stream] issued`, timeout: 20_000 })
    .toBeGreaterThanOrEqual(n);
}

/** The case the server returned last is the one on screen (its patient name). */
async function expectServedCaseOpen(page: Page, gw: Gateway): Promise<void> {
  const last = gw.served.at(-1);
  expect(last, "a generated case was served").toBeTruthy();
  await expect(page.getByText(last!.spec.demographics.name_hint).first()).toBeVisible({ timeout: 20_000 });
}

async function signIn(page: Page): Promise<Gateway> {
  await createProfile(page, { role: "student" });
  return liveGateway(page);
}

async function openEncounter(page: Page, gw: Gateway): Promise<void> {
  await page.goto("/encounter");
  await settle(page);
  await expectGenerateCount(gw, 1, "encounter mount");
  await expect(page.getByRole("tablist", { name: "Chart sections" })).toBeVisible({ timeout: 20_000 });
  await expectServedCaseOpen(page, gw);
}

test.describe("cases are generated on request", () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== "laptop", "behavioural contract: one viewport (laptop)");
  });

  /* ---------------------------------------------------------------------- */
  /* Entry points                                                            */
  /* ---------------------------------------------------------------------- */

  test("Start page: Begin encounter generates the case", async ({ page }) => {
    const gw = await signIn(page);
    await page.goto("/start");
    await settle(page);
    await page.getByRole("button", { name: "Begin encounter" }).click();
    await expect(page).toHaveURL(/\/encounter$/);
    await expectGenerateCount(gw, 1, "Start page");
    await expectServedCaseOpen(page, gw);
  });

  test("Cases page: starting a listed case generates it, never opens bundled data", async ({ page }) => {
    const gw = await signIn(page);
    await page.goto("/cases");
    await settle(page);
    // Each library row has a "Start" button (the nav "Start" is a link).
    const start = page.getByRole("button", { name: "Start", exact: true }).first();
    await expect(start).toBeVisible();
    const before = gw.generateCalls().length;
    await start.click();
    await expect(page).toHaveURL(/\/encounter$/);
    await expectGenerateCount(gw, before + 1, "Cases page Start this case");
    await expectServedCaseOpen(page, gw);
  });

  test("Cases page: every generate control uses the v2 generator", async ({ page }) => {
    const gw = await signIn(page);
    await page.goto("/cases");
    await settle(page);
    const region = page.getByRole("region", { name: "Generate a case" });
    for (const name of ["Generate a fresh case", "AI generate", "Quick generate"]) {
      const control = region.getByRole("button", { name, exact: true });
      if ((await control.count()) === 0) continue; // a removed control cannot bypass the generator
      const before = gw.generateCalls().length;
      await control.first().click();
      await expectGenerateCount(gw, before + 1, `Cases page ${name}`);
    }
  });

  test("Encounter New case menu: a fresh case is generated", async ({ page }) => {
    const gw = await signIn(page);
    await openEncounter(page, gw);
    await page.getByRole("button", { name: "New case" }).click();
    const menu = page.getByRole("menu", { name: "Generate or load a case" });
    await menu.getByRole("menuitem", { name: /Generate a fresh case/ }).click();
    await expectGenerateCount(gw, 2, "New case > Generate a fresh case");
    await expectServedCaseOpen(page, gw);
  });

  test("Encounter New case menu: no curated bundled case opens without generation", async ({ page }) => {
    const gw = await signIn(page);
    await openEncounter(page, gw);
    await page.getByRole("button", { name: "New case" }).click();
    const menu = page.getByRole("menu", { name: "Generate or load a case" });
    const items = menu.getByRole("menuitem");
    const count = await items.count();
    // Item 0 is "Generate a fresh case"; anything after the constrained form is a listed case.
    const listed = [];
    for (let i = 0; i < count; i += 1) {
      const label = (await items.nth(i).innerText()).trim();
      if (!/Generate a fresh case|Generate case/.test(label)) listed.push(i);
    }
    if (listed.length === 0) return; // no bundled list rendered: requirement met
    const before = gw.generateCalls().length;
    await items.nth(listed[0]).click();
    await expectGenerateCount(gw, before + 1, "New case > listed case");
    await expectServedCaseOpen(page, gw);
  });

  test("Exam: each exam case is generated by /v2", async ({ page }) => {
    const gw = await signIn(page);
    await page.goto("/exam");
    await settle(page);
    await page.getByRole("button", { name: "Begin exam" }).click();
    await expectGenerateCount(gw, 1, "Exam Begin exam");
    await expectServedCaseOpen(page, gw);
  });

  test("Rooms create dialog: the room case is generated", async ({ page }) => {
    const gw = await signIn(page);
    await page.goto("/rooms");
    await settle(page);
    await page.getByRole("button", { name: "Create room" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const confirm = dialog.getByRole("button", { name: "Create room" });
    await confirm.scrollIntoViewIfNeeded();
    await confirm.click({ force: true });
    await expect(page).toHaveURL(/\/rooms\/[^/]+$/);
    await expectGenerateCount(gw, 1, "Rooms create");
    await expectServedCaseOpen(page, gw);
  });

  test("Home recommended rail: opening a recommended case generates it", async ({ page }) => {
    const gw = await signIn(page);
    await page.goto("/");
    await settle(page);
    const heading = page.getByRole("heading", { name: "Recommended cases" });
    await expect(heading).toBeVisible();
    const row = page.locator("section", { has: heading }).getByRole("listitem").first().getByRole("link").first();
    await expect(row).toBeVisible();
    const before = gw.generateCalls().length;
    await row.click();
    await expect(page).toHaveURL(/\/encounter$/);
    await expectGenerateCount(gw, before + 1, "Home recommended rail");
    await expectServedCaseOpen(page, gw);
  });

  /* ---------------------------------------------------------------------- */
  /* Variety and honesty                                                     */
  /* ---------------------------------------------------------------------- */

  test("two consecutive requests with the same filters give different cases", async ({ page }) => {
    const gw = await signIn(page);
    await openEncounter(page, gw);
    const names: string[] = [gw.served.at(-1)!.spec.demographics.name_hint];
    await page.getByRole("button", { name: "New case" }).click();
    await page.getByRole("menu", { name: "Generate or load a case" }).getByRole("menuitem", { name: /Generate a fresh case/ }).click();
    await expectGenerateCount(gw, 2, "second request");
    await expectServedCaseOpen(page, gw);
    names.push(gw.served.at(-1)!.spec.demographics.name_hint);
    const [a, b] = gw.generateCalls().slice(-2).map((c) => c.body ?? {});
    // Same filters (none), so the client must not pin one seed for both.
    const strip = (x: Record<string, unknown>) => ({ ...x, seed: undefined, learner_id: undefined, session_id: undefined, thread_id: undefined });
    expect(strip(a)).toEqual(strip(b));
    if (a.seed != null || b.seed != null) expect(a.seed).not.toEqual(b.seed);
    const [sa, sb] = gw.served.slice(-2).map((r) => `${r.spec.seed}:${r.spec.meta.condition_id}`);
    expect(sa).not.toEqual(sb);
    // And the second case replaced the first on screen.
    expect(names[0]).not.toEqual(names[1]);
    await expect(page.getByText(names[0], { exact: false })).toHaveCount(0);
  });

  test("a model outage offers the learner no template or on-device case", async ({ page }) => {
    await createProfile(page, { role: "student" });
    const gw = await liveGateway(page, { generateStatus: 503 });
    await page.goto("/encounter");
    await settle(page);
    await expectGenerateCount(gw, 1, "encounter mount under outage");
    await expect(page.getByRole("button", { name: "Retry" }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: /^Use template case/ })).toHaveCount(0);
    expect(gw.calls.filter((c) => c.path === "/api/v2/case/template")).toEqual([]);
  });

  /* ---------------------------------------------------------------------- */
  /* In flight: the Director                                                 */
  /* ---------------------------------------------------------------------- */

  async function askQuestion(page: Page, text: string): Promise<void> {
    await openTab(page, "Interview");
    const composer = page.getByPlaceholder("Type a question to the patient, then press Enter");
    await composer.fill(text);
    await composer.press("Enter");
  }

  test("a student action calls /v2/director/step and the vitals show the returned changes", async ({ page }) => {
    const gw = await signIn(page);
    await openEncounter(page, gw);
    await askQuestion(page, "When did the fever start?");
    await expect.poll(() => gw.directorCalls().length, { message: "director step issued", timeout: 15_000 }).toBeGreaterThanOrEqual(1);
    const first = gw.directorCalls()[0].body ?? {};
    expect((first.action as { kind?: string } | undefined)?.kind).toBe("question");
    // Review 06a 4.5: the server holds the case and the Director state (CaseStore), so the
    // step names the generation thread of the case the server returned.
    expect(first.thread_id, "the step is bound to the generated case's thread").toBe(gw.served.at(-1)!.thread_id);
    const storyboard = page.getByRole("complementary", { name: "Storyboard" }).filter({ visible: true }).first();
    // MiniVital: <p>LABEL</p><p>VALUE<span>unit</span></p>
    const read = async (label: string): Promise<number> => {
      const value = storyboard.getByText(label, { exact: true }).first().locator("xpath=following-sibling::p[1]");
      const m = ((await value.innerText().catch(() => "")) || "").match(/[0-9]+(?:\.[0-9]+)?/);
      return m ? Number(m[0]) : Number.NaN;
    };
    await expect.poll(async () => Math.abs((await read("HR")) - DIRECTOR_VITALS.hr), { message: "HR follows the Director", timeout: 15_000 }).toBeLessThanOrEqual(4);
    await expect.poll(async () => Math.abs((await read("SpO2")) - DIRECTOR_VITALS.spo2), { message: "SpO2 follows the Director", timeout: 15_000 }).toBeLessThanOrEqual(3);
  });

  test("the patient reply reflects the Director's utterance", async ({ page }) => {
    const gw = await signIn(page);
    await openEncounter(page, gw);
    await askQuestion(page, "How is your breathing now?");
    await expect.poll(() => gw.directorCalls().length, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
    const transcript = page.getByRole("log", { name: "Encounter transcript" });
    await expect(transcript.getByText(DIRECTOR_UTTERANCE)).toBeVisible({ timeout: 15_000 });
  });
});
