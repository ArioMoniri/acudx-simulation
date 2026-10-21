import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { replayLiveCases } from "../helpers/liveCase";
import {
  ADMIN_TOKEN,
  captureApi,
  check,
  gatewayJson,
  openTab,
  settle,
  shot,
  snapshot,
  soft,
  type Captured,
} from "./helpers";

/**
 * Live acceptance walk, 2026-10-20 (docs/review/05-acceptance-test-2026-10-20.md).
 *
 * A third-year student works two febrile cases end to end against a real
 * gateway whose model endpoint is unreachable (AIRGAPPED, no llama-server):
 * generation must answer 503 and the UI must offer the labelled template.
 * Then the same browser profile switches to faculty, dean and admin.
 *
 * Needs ACCEPTANCE_BASE_URL / ACCEPTANCE_GATEWAY_URL (see
 * playwright.acceptance.config.ts); skipped otherwise.
 */

test.skip(!process.env.ACCEPTANCE_BASE_URL, "live acceptance run only (needs a running gateway and dev server)");
test.describe.configure({ mode: "serial" });

const STUDENT = "Deniz Acceptance";
const INSTITUTION = "AcuDx Acceptance Faculty";
const TENANT = "acudx-acceptance-faculty";
const DEFLECTION = "finding it hard to answer";

/** Conditions whose presentation is febrile (template condition ids). */
const FEBRILE = new Set([
  "sepsis_uncomplicated", "septic_shock", "pneumonia_cap", "pyelonephritis", "bacterial_meningitis",
  "meningococcemia", "cellulitis", "nec_fasciitis", "malaria", "influenza", "covid19", "septic_arthritis",
  "osteomyelitis", "infective_endocarditis", "ascending_cholangitis", "diverticulitis", "encephalitis",
  "acute_prostatitis", "epididymo_orchitis", "febrile_neutropenia", "pid", "hiv_seroconversion",
  "infectious_mononucleosis", "aspiration_pneumonitis", "undiff_fever",
]);

const QUESTIONS = [
  "When did the fever start?",
  "Can you describe the fever, does it come and go?",
  "What other symptoms have you noticed?",
  "Have you had any shaking chills or rigors?",
  "Any burning or pain when you pass urine, or passing urine more often?",
  "Do you have a cough, shortness of breath or chest pain when you breathe?",
  "Have you had a headache or a stiff neck, or does light hurt your eyes?",
  "Have you travelled anywhere recently?",
  "What medications do you take regularly?",
  "Do you have any allergies to medicines?",
];

const EXAMS = ["General inspection", "Recheck vitals", "Auscultate lungs", "Auscultate heart", "Palpate abdomen", "Neurological exam", "Skin"];

const ORDERS: { key: string; search: string; button: RegExp }[] = [
  { key: "CBC", search: "blood count", button: /^Order Complete blood count/ },
  { key: "CRP", search: "C-reactive", button: /^Order C-reactive protein/ },
  { key: "Lactate", search: "Lactate", button: /^Order Lactate$/ },
  { key: "Blood cultures", search: "Blood culture", button: /^Order Blood culture/ },
  { key: "Urinalysis", search: "Urinalysis", button: /^Order Urinalysis/ },
  { key: "Chest X-ray", search: "Chest X-ray", button: /^Order Chest X-ray/ },
  { key: "ECG", search: "12-lead", button: /^Order 12-lead ECG/ },
];

interface CaseRun {
  label: string;
  conditionId: string;
  icd10: string;
  conditionLabel: string;
  triageTemp: number;
  tries: number;
}

let context: BrowserContext;
let page: Page;
let api: Captured[];
const cases: CaseRun[] = [];

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "en-US", timezoneId: "Europe/Istanbul" });
  page = await context.newPage();
  api = captureApi(page);
});

test.afterAll(async () => {
  await context?.close();
});

async function waitForApi(path: string, after: number, timeout = 30_000): Promise<Captured> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const hit = api.find((c) => c.path === path && c.at >= after);
    if (hit) return hit;
    await page.waitForTimeout(250);
  }
  throw new Error(`no ${path} response within ${timeout} ms`);
}

async function adminSignIn(): Promise<boolean> {
  await setRole("admin", "Platform administrator");
  await page.goto("/admin", { waitUntil: "domcontentloaded" });
  await settle(page);
  const tokenInput = page.getByLabel(/token/i).first();
  if (await tokenInput.isVisible().catch(() => false)) {
    await tokenInput.fill(ADMIN_TOKEN);
    await page.getByRole("button", { name: /sign in|unlock|continue|open/i }).first().click();
    await page.waitForTimeout(2_000);
  }
  return (await page.getByRole("tab").count()) >= 5;
}

async function setRole(role: string, label: string): Promise<void> {
  await page.goto("/account", { waitUntil: "domcontentloaded" });
  await settle(page);
  await page.getByLabel("Role", { exact: true }).selectOption({ label });
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForTimeout(800);
  void role;
}

/* ------------------------------------------------------------------------ */
/* 1. Student                                                               */
/* ------------------------------------------------------------------------ */

test("student: profile through the UI", async () => {
  await page.goto("/signin", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Create your profile" }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await page.getByLabel("Full name").fill(STUDENT);
  await page.getByLabel("Role", { exact: true }).selectOption("student");
  await page.getByLabel("Institution").fill(INSTITUTION);
  const f = await shot(page, "student-profile-form");
  await page.getByRole("button", { name: "Create profile" }).click();
  await expect(page).not.toHaveURL(/\/(profile|signin)$/);
  await settle(page);
  const heading = (await page.getByRole("heading", { level: 1 }).first().textContent().then((t) => t ?? "")).trim();
  check("S1", "Student", "Create a profile through the UI", "Profile created, app lands on Home", /Deniz/.test(heading), `Home heading: "${heading}"`, f);
});

async function startFebrileCase(n: number, exclude: Set<string>): Promise<CaseRun | null> {
  const label = `case${n}`;
  for (let attempt = 1; attempt <= 6; attempt++) {
    await page.getByRole("link", { name: "Start", exact: true }).click();
    await settle(page);
    const hasFever = await page.getByRole("radio", { name: /^Fever\b/ }).count();
    if (attempt === 1 && n === 1) {
      const s = await shot(page, "start-complaint-picker");
      check(
        "S2",
        "Student",
        "Constrain the case by chief complaint 'fever' on Start",
        "A fever option, or a family that yields febrile presentations",
        hasFever > 0,
        hasFever > 0 ? "Fever option present" : "No 'Fever' option among the 17 tiles; used 'Infectious (Sepsis-spectrum illness)' instead",
        s,
      );
    }
    // No fever tile: "Infectious" is the closest family on the Start page.
    const family = /^Infectious/;
    const pick = hasFever > 0 ? page.getByRole("radio", { name: /^Fever\b/ }) : page.getByRole("radio", { name: family });
    await pick.click();
    const before = Date.now();
    await page.getByRole("button", { name: "Begin encounter" }).click();

    // 503 from the generator: the UI must explain it and offer Retry only (owner decision:
    // no template or on-device case is ever served to a learner).
    const retry = page.getByRole("button", { name: "Retry model generation" });
    await retry.waitFor({ timeout: 40_000 });
    const gen = await waitForApi("/v2/case/generate/stream", before);
    if (attempt === 1) {
      const panelText = await page.getByRole("status", { name: /Writing your case|Generating a case/ }).textContent().then((t) => t ?? "");
      const s = await shot(page, `${label}-generator-503`);
      const body = gen.body as { error?: string } | string;
      check(
        n === 1 ? "S3" : "S3b",
        "Student",
        "Generator with no reachable model",
        "POST /v2/case/generate/stream answers 503 model_unreachable; UI names the failure and offers Retry, no template",
        gen.status === 503 && /503/.test(panelText) && (await retry.count()) === 1 &&
          (await page.getByRole("button", { name: /^Use template case/ }).count()) === 0,
        `HTTP ${gen.status} ${typeof body === "object" ? body?.error : ""}; panel: "${panelText.replace(/\s+/g, " ").slice(0, 160)}"`,
        s,
      );
    }
    // The model is down in this run: replay a recorded live model case for the retry so the
    // rest of the walkthrough can proceed on a case generated by the model.
    const replay = await replayLiveCases(page);
    await retry.click();
    await expect.poll(() => replay.served.length, { timeout: 20_000 }).toBeGreaterThan(0);
    const spec = replay.served.at(-1)!.spec as unknown as {
      meta: { source: string; condition_id: string; degraded: boolean };
      condition: { label_en: string; icd10: string };
      triage_vitals: { tempC: number };
    };
    await expect(page.getByRole("tablist", { name: "Chart sections" })).toBeVisible();
    const cid = spec.meta.condition_id;
    const febrile = FEBRILE.has(cid) || spec.triage_vitals.tempC >= 38.0;
    let tipsCount = 0;
    try {
      const tips = await gatewayJson(`/v1/guidelines/tips?condition=${encodeURIComponent(spec.condition.icd10)}&locale=en`);
      tipsCount = (tips.body as { count?: number }).count ?? 0;
    } catch {
      tipsCount = 0;
    }
    // Prefer a case with attending tips for three tries, then take any febrile one.
    const acceptable = febrile && !exclude.has(cid) && (tipsCount > 0 || attempt >= 4);
    console.log(`attempt ${attempt}: ${cid} temp ${spec.triage_vitals.tempC} febrile=${febrile} tips=${tipsCount} -> ${acceptable ? "take" : "retry"}`);
    if (acceptable) {
      return {
        label,
        conditionId: cid,
        icd10: spec.condition.icd10,
        conditionLabel: spec.condition.label_en,
        triageTemp: spec.triage_vitals.tempC,
        tries: attempt,
      };
    }
  }
  return null;
}

async function workCase(n: number): Promise<void> {
  const exclude = new Set(cases.map((c) => c.conditionId));
  const run = await startFebrileCase(n, exclude);
  const id = (s: string) => `${s}.${n}`;
  if (!run) {
    check(id("C0"), "Student", `Febrile case ${n}`, "A febrile presentation within 6 tries", false, "No febrile case with tips in 6 tries");
    return;
  }
  cases.push(run);
  check(id("C0"), "Student", `Febrile case ${n} via the template path`, "A febrile presentation within 6 tries", true, `${run.conditionLabel} (${run.icd10}) after ${run.tries} tr${run.tries === 1 ? "y" : "ies"}`);

  // Banner honesty.
  await soft(id("C1"), "Student", "Banner labels the source", "Banner says template (not model generated) and degraded", async () => {
    const note = page.getByRole("note", { name: /Case source:/ });
    const noteText = (await note.getAttribute("aria-label")) ?? "";
    const visible = await note.textContent().then((t) => t ?? "");
    const sub = await page.getByText(/Difficulty \d\/5/).first().textContent().then((t) => t ?? "");
    const s = await shot(page, `${run.label}-banner`, false);
    check(
      id("C1"),
      "Student",
      "Banner labels the source",
      "Banner says template (not model generated) and degraded; no line calls it generated",
      /template \(not model generated\)/.test(noteText) && /degraded/.test(visible) && !/Generated case/.test(sub),
      `note: "${noteText}" / "${visible.replace(/\s+/g, " ")}"; sub-line: "${sub}"`,
      s,
    );
  }, page);

  // Triage vitals.
  await soft(id("C2"), "Student", "Triage vitals show fever", "Temp at or above 38.0 C on the chart", async () => {
    await openTab(page, "Chart Review");
    const mainText = await page.locator("main").textContent().then((t) => t ?? "");
    const vitalsLine = /Presenting vitals.{0,120}?Temp\s*[\d.]+\s*°C/i.exec(mainText)?.[0] ?? mainText.slice(0, 120);
    const m = /Temp\s*([\d.]+)/i.exec(vitalsLine);
    const temp = m ? Number(m[1]) : NaN;
    const s = await shot(page, `${run.label}-chart-review`);
    check(id("C2"), "Student", "Triage vitals show fever", "Temp at or above 38.0 C on the chart", temp >= 38.0, vitalsLine.replace(/\s+/g, " ").slice(0, 160), s);
  }, page);

  // Interview: ten typed questions.
  await soft(id("C3"), "Student", "Interview with 10 typed questions", "Every question gets a case-specific answer (no deflection)", async () => {
    await openTab(page, "Interview");
    const transcript = page.getByRole("log", { name: "Encounter transcript" });
    const composer = page.getByPlaceholder("Type a question to the patient, then press Enter");
    const replies: string[] = [];
    for (const q of QUESTIONS) {
      const before = await transcript.getByRole("listitem").count();
      await composer.fill(q);
      await composer.press("Enter");
      // Wait for a new patient turn (or a guard notice that replaces it).
      await expect
        .poll(async () => transcript.getByRole("listitem").count(), { timeout: 20_000 })
        .toBeGreaterThanOrEqual(before + 2)
        .catch(() => {});
      const items = await transcript.getByRole("listitem").allTextContents();
      replies.push(items.at(-1) ?? "");
    }
    const patient = replies.filter((r) => /^\s*Patient/i.test(r));
    const deflections = patient.filter((r) => r.includes(DEFLECTION)).length;
    const clarify = patient.filter((r) => /more specific|say that another way|not sure what you mean/i.test(r)).length;
    const s = await shot(page, `${run.label}-interview`);
    await snapshot(page, `${run.label}-interview`);
    check(
      id("C3b"),
      "Student",
      "Typed history questions reach a case answer",
      "No 'be more specific' clarification for the 10 standard febrile history questions",
      clarify === 0,
      `${clarify} clarification replies of ${patient.length}; last: "${(patient.at(-1) ?? "").replace(/^\s*Patient\s*/i, "").slice(0, 90)}"`,
    );
    check(
      id("C3"),
      "Student",
      "Interview with 10 typed questions",
      "10 patient replies, none the gateway's 'hard to answer' deflection",
      patient.length >= QUESTIONS.length && deflections === 0,
      `${patient.length} patient replies, ${deflections} deflections. Sample: ${patient.slice(0, 3).map((r) => `"${r.replace(/^\s*Patient\s*/i, "").slice(0, 70)}"`).join(" | ")}`,
      s,
    );
  }, page);

  // Exams.
  await soft(id("C4"), "Student", "Perform the relevant exams", "Each maneuver adds a finding", async () => {
    // Examination manoeuvres live in the Suggestions drawer above the composer (docs/design/05-chat.md 3.3).
    const drawer = page.getByRole("button", { name: "Suggestions" }).first();
    if ((await drawer.count()) && (await drawer.getAttribute("aria-expanded")) !== "true") await drawer.click();
    for (const e of EXAMS) {
      const b = page.getByRole("button", { name: e, exact: true });
      if (await b.count()) await b.first().click();
      await page.waitForTimeout(250);
    }
    const heading = await page.getByRole("heading", { name: /^Exam findings/ }).first().textContent().then((t) => t ?? "");
    const findings = await page.getByRole("complementary", { name: "Storyboard" }).getByRole("listitem").allTextContents();
    const s = await shot(page, `${run.label}-exam`);
    const count = Number(/(\d+)/.exec(heading)?.[1] ?? 0);
    check(id("C4"), "Student", "Perform the relevant exams", `${EXAMS.length - 1} findings recorded (vitals recheck aside)`, count >= EXAMS.length - 2, `${heading}; ${findings.filter((f) => /General|Resp|Card|Abd|Neuro|Skin/i.test(f)).slice(0, 4).map((f) => f.slice(0, 80)).join(" | ")}`, s);
  }, page);

  // Orders.
  const orderStart = Date.now();
  await soft(id("C5"), "Student", "Order CBC, CRP, lactate, blood cultures, urinalysis, chest X-ray, ECG", "7 orders placed", async () => {
    await openTab(page, "Orders");
    const search = page.getByRole("searchbox", { name: "Search orderable tests" });
    const placed: string[] = [];
    for (const o of ORDERS) {
      await search.fill(o.search);
      const btn = page.getByRole("button", { name: o.button }).first();
      if (await btn.count()) {
        await btn.click();
        placed.push(o.key);
      }
      await page.waitForTimeout(250);
    }
    await search.fill("");
    const tracker = await page.getByText(/\d+ placed · \d+ pending · \d+ resulted/).first().textContent().then((t) => t ?? "");
    const s = await shot(page, `${run.label}-orders`);
    check(id("C5"), "Student", "Order CBC, CRP, lactate, blood cultures, urinalysis, chest X-ray, ECG", "7 orders placed", placed.length === 7, `placed: ${placed.join(", ")}; tracker: ${tracker}`, s);
  }, page);

  // Treatments while results run: paracetamol then an antibiotic, both through the dose form.
  await soft(id("C6"), "Student", "Paracetamol and an antibiotic through the five-rights dose form", "Each opens a dose form, is confirmed, and is recorded on the MAR", async () => {
    await openTab(page, "Monitor");
    const monitorBefore = await page.getByRole("table", { name: "Current vital signs" }).textContent().then((t) => t ?? "");
    await openTab(page, "Orders");
    await page.getByRole("tab", { name: "Treatments" }).click();
    const given: string[] = [];
    const forms: string[] = [];
    for (const drug of ["Paracetamol", "Ceftriaxone"]) {
      await page.getByRole("button", { name: `Administer ${drug}`, exact: true }).click();
      const confirm = page.getByRole("button", { name: /^Confirm and administer / }).first();
      await expect(confirm).toBeVisible();
      const form = confirm.locator("xpath=ancestor::*[self::form or @role='dialog' or self::section][1]");
      forms.push((await form.textContent().then((t) => t ?? "").catch(() => "")).replace(/\s+/g, " ").slice(0, 200));
      if (drug === "Paracetamol") await shot(page, `${run.label}-dose-form`);
      await confirm.click();
      await page.waitForTimeout(600);
      given.push(drug);
    }
    const mar = await page.getByText(/\d+ given/).allTextContents();
    const s = await shot(page, `${run.label}-treatments-given`);
    check(
      id("C6"),
      "Student",
      "Paracetamol and an antibiotic through the five-rights dose form",
      "Dose form with dose, route and indication for each; both recorded as given",
      given.length === 2 && mar.length >= 2,
      `given: ${given.join(", ")}; badges: ${mar.join(", ")}; form: "${forms[0] ?? ""}"`,
      s,
    );
    // The monitor reacts: wait two sim minutes and compare.
    await page.waitForTimeout(25_000);
    await openTab(page, "Monitor");
    const monitorAfter = await page.getByRole("table", { name: "Current vital signs" }).textContent().then((t) => t ?? "");
    const t0 = Number(/Temp(?:erature)?\s*([\d.]+)/i.exec(monitorBefore)?.[1] ?? NaN);
    const t1 = Number(/Temp(?:erature)?\s*([\d.]+)/i.exec(monitorAfter)?.[1] ?? NaN);
    const directorSteps = api.filter((c) => c.path === "/v2/director/step").length;
    const s2 = await shot(page, `${run.label}-monitor-after-treatment`);
    check(
      id("C7"),
      "Student",
      "Monitor or flowsheet reacts to treatment",
      "Temperature trends down after paracetamol (or another vital moves), Director steps logged",
      monitorBefore !== monitorAfter && directorSteps > 0,
      `Temp ${t0} -> ${t1} C; ${directorSteps} Director steps so far; before "${monitorBefore.replace(/\s+/g, " ").slice(0, 110)}" after "${monitorAfter.replace(/\s+/g, " ").slice(0, 110)}"`,
      s2,
    );
  }, page);

  // Results: wait for every order (cultures last).
  await soft(id("C8"), "Student", "Results arrive with provenance and plausible values", "All 7 resulted, each with a provenance chip, cultures after CBC", async () => {
    await openTab(page, "Orders");
    await page.getByRole("tab", { name: "Order tests" }).click();
    const deadline = Date.now() + 300_000;
    let tracker = "";
    while (Date.now() < deadline) {
      tracker = await page.getByText(/\d+ placed · \d+ pending · \d+ resulted/).first().textContent().then((t) => t ?? "");
      if (/· 0 pending/.test(tracker)) break;
      await page.waitForTimeout(3_000);
    }
    await openTab(page, /^Results/);
    await page.waitForTimeout(1_000);
    const s = await shot(page, `${run.label}-results`);
    await snapshot(page, `${run.label}-results`);
    const resolves = api.filter((c) => c.path === "/v1/results/resolve" && c.at >= orderStart);
    type Obs = { short?: string; name: string; value: number | string; unit: string; flag: string; source: string };
    type Res = { order_code: string; kind: string; available_at_ms: number; sim_time_ms: number; observations?: Obs[]; meta?: Record<string, unknown>; report?: Record<string, unknown> };
    const bodies = resolves.map((r) => r.body as Res).filter((b) => b && b.order_code);
    const byCode = new Map(bodies.map((b) => [b.order_code, b]));
    const allObs = bodies.flatMap((b) => b.observations ?? []);
    const find = (re: RegExp) => allObs.find((o) => re.test(o.short ?? "") || re.test(o.name));
    const wbc = find(/^WBC|leukocytes/i);
    const crp = find(/^CRP|C reactive/i);
    const lac = find(/^Lac|lactate/i);
    const cbc = [...byCode.values()].find((b) => (b.observations ?? []).some((o) => /WBC|leukocytes/i.test(`${o.short} ${o.name}`)));
    const cult = byCode.get("blood-culture");
    const provenanceChips = await page.getByRole("heading", { name: /Results engine|Offline|Synthetic|curated|bank/i }).count();
    const listChips = await page.getByRole("listitem").filter({ hasText: /Results engine/ }).count();
    const withSource = allObs.filter((o) => o.source && o.source.length > 3).length;
    const later = !!(cbc && cult && cult.available_at_ms - cult.sim_time_ms > cbc.available_at_ms - cbc.sim_time_ms);
    check(
      id("C8"),
      "Student",
      "All results arrive, each with a provenance chip",
      "Tracker 0 pending; every result group carries a provenance label; every analyte carries a source",
      /· 0 pending/.test(tracker) && provenanceChips + listChips >= 6 && withSource === allObs.length,
      `${tracker}; ${bodies.length} resolve calls; provenance chips: ${provenanceChips} lab groups + ${listChips} report items; analytes with source ${withSource}/${allObs.length}`,
      s,
    );
    check(
      id("C9"),
      "Student",
      "Cultures return later than the CBC",
      "Blood culture turnaround longer than CBC turnaround",
      later,
      `CBC turnaround ${cbc ? Math.round((cbc.available_at_ms - cbc.sim_time_ms) / 60000) : "?"} sim-min, blood culture ${cult ? Math.round((cult.available_at_ms - cult.sim_time_ms) / 60000) : "?"} sim-min`,
    );
    const v = (o?: Obs) => (o ? `${o.value} ${o.unit} (${o.flag})` : "missing");
    // Second pass: malaria and viral or HIV illness keep a normal or low white
    // count (WHO malaria; section 5 of the report), so "raised" is bacterial only.
    const notRaised = new Set(["malaria", "influenza", "covid19", "hiv_seroconversion"]);
    const wbcOk = !!wbc && (run.conditionId === "febrile_neutropenia"
      ? Number(wbc.value) < 4
      : notRaised.has(run.conditionId ?? "") ? Number(wbc.value) <= 11 : Number(wbc.value) > 11);
    const plausible = wbcOk && !!crp && Number(crp.value) > 10 && !!lac && Number(lac.value) >= 0.5;
    check(
      id("C10"),
      "Student",
      "WBC, CRP and lactate consistent with the condition",
      `Bacterial febrile illness: WBC raised, CRP raised, lactate reported (raised if septic). Condition: ${run.conditionLabel}`,
      plausible,
      `WBC ${v(wbc)}; CRP ${v(crp)}; lactate ${v(lac)}; culture: ${cult ? JSON.stringify(cult.report ?? cult.observations?.[0] ?? {}).slice(0, 160) : "missing"}`,
    );
  }, page);

  // Guidance and attending tips.
  await soft(id("C11"), "Student", "Guidance and attending tips carry citations", "Each tip has a citation chip linking to a real source URL", async () => {
    await openTab(page, "Guidance");
    await page.waitForTimeout(1_500);
    const s = await shot(page, `${run.label}-guidance`);
    await snapshot(page, `${run.label}-guidance`);
    const panel = page.getByRole("region", { name: "Clinical guidance" });
    const panelText = (await panel.textContent().then((t) => t ?? "")).replace(/\s+/g, " ");
    const tipsAside = page.getByRole("complementary", { name: "Attending tips" });
    const tipsText = (await tipsAside.textContent().then((t) => t ?? "")).replace(/\s+/g, " ");
    const links = await tipsAside.getByRole("link").evaluateAll((els) => els.map((e) => ({ text: (e.textContent ?? "").trim(), href: (e as HTMLAnchorElement).href })));
    const unavailable = await tipsAside.getByText(/Source unavailable/).count();
    const httpLinks = links.filter((l) => /^https?:\/\//.test(l.href));
    const tipsApi = [...api].reverse().find((c) => c.path === "/v1/guidelines/tips");
    const tipsBody = (tipsApi?.body ?? {}) as { count?: number; statements?: Record<string, { source_url?: string }> };
    const storeUrls = new Set(Object.values(tipsBody.statements ?? {}).map((st) => st.source_url ?? ""));
    const fromStore = httpLinks.filter((l) => storeUrls.has(l.href)).length;
    // Tip cards are the list items that are not work-up outline rows ("X within N min").
    const items = tipsAside.getByRole("listitem");
    const n = await items.count();
    let tipCards = 0;
    let citedCards = 0;
    for (let i = 0; i < n; i++) {
      const it = items.nth(i);
      const t = (await it.textContent()) ?? "";
      if (/within \d+ min/.test(t)) continue;
      tipCards += 1;
      if ((await it.locator("a[href^='http']").count()) > 0) citedCards += 1;
    }
    check(
      id("C11"),
      "Student",
      "Attending tips each show a citation chip linking to a real source",
      "Every tip card carries a link to the verified statement's source URL",
      tipCards > 0 && citedCards === tipCards && fromStore === httpLinks.length,
      `tips API count ${tipsBody.count ?? "?"}; ${tipCards} tip cards shown, ${citedCards} cited; ${httpLinks.length} citation links (${fromStore} match the verified store's source_url); raw i18n keys: ${/guidance3\./.test(tipsText) ? "YES" : "none"}; first: ${httpLinks[0]?.href ?? "-"}`,
      s,
    );
    check(
      id("C11b"),
      "Student",
      "Next best action and work-up outline rows are cited",
      "No 'Source unavailable' on a recommendation shown to the learner",
      unavailable === 0,
      `${unavailable} rows show 'Source unavailable' (next best action + work-up outline)`,
    );
    const pill = /Live guideline grounding/.test(panelText) ? "live" : /Guidance unavailable/.test(panelText) ? "unavailable" : "other";
    const groundRes = [...api].reverse().find((c) => c.path === "/v1/ground");
    const gb = (groundRes?.body ?? {}) as { degraded?: boolean; mode?: string; passages?: { id?: string }[] };
    check(
      id("C12"),
      "Student",
      "Clinical guidance panel is relevant or honestly unavailable",
      "Lead statement relevant to the case, or 'Guidance unavailable' when retrieval is degraded",
      !(gb.degraded && pill === "live"),
      `panel state: ${pill}; /v1/ground mode ${gb.mode ?? "?"} degraded=${String(gb.degraded)} ids ${(gb.passages ?? []).map((p) => p.id).join(", ")}`,
    );
    // Source URL reachability (HEAD through the egress proxy where allowed).
    const reach: string[] = [];
    for (const l of httpLinks.slice(0, 4)) {
      try {
        const r = await page.request.get(l.href, { timeout: 15_000, maxRedirects: 5 });
        reach.push(`${r.status()} ${l.href}`);
      } catch (e) {
        reach.push(`ERR ${l.href} (${(e as Error).message.split("\n")[0].slice(0, 60)})`);
      }
    }
    check(id("C13"), "Student", "Tip source URLs resolve", "Each source URL answers 2xx or 3xx", reach.length > 0 && reach.every((r) => /^[23]\d\d /.test(r)), reach.join("; ") || "no links to test");
  }, page);

  // Differential + working diagnosis.
  await soft(id("C14"), "Student", "Add a differential and commit a working diagnosis", "Verdict panel appears with a debrief entry", async () => {
    await openTab(page, /Problem List/);
    const dx = page.getByPlaceholder("Search diagnoses or ICD/DSM code...");
    const target = run.conditionLabel.replace(/^Acute /i, "").replace(/, .*$/, "");
    const alt = run.conditionId === "sepsis_uncomplicated" ? "pneumonia" : "sepsis";
    await dx.fill(alt);
    const addAlt = page.getByRole("button", { name: /^Add .* to the differential$/ }).first();
    if (await addAlt.count()) await addAlt.click();
    await dx.fill(target);
    const add = page.getByRole("button", { name: /^Add .* to the differential$/ }).first();
    await expect(add).toBeVisible();
    const dxName = (await add.getAttribute("aria-label"))!.replace(/^Add /, "").replace(/ to the differential$/, "");
    await add.click();
    await page.getByRole("button", { name: `Commit ${dxName} as the working diagnosis` }).click();
    const debrief = page.getByRole("button", { name: "View attending debrief" });
    await expect(debrief).toBeVisible();
    const s = await shot(page, `${run.label}-diagnosis`);
    check(id("C14"), "Student", "Add a differential and commit a working diagnosis", "Two candidates, one committed, verdict shown", true, `differential: ${alt} + ${dxName}; committed ${dxName}`, s);
  }, page);

  // Complete + Feedback.
  await soft(id("C15"), "Student", "Complete the encounter and open Feedback", "Feedback with bands, calibration plot and gaps with citations", async () => {
    const before = Date.now();
    await page.getByRole("button", { name: "View attending debrief" }).click();
    const dlg = page.getByRole("dialog", { name: /Attending debrief/ });
    await expect(dlg).toBeVisible();
    await shot(page, `${run.label}-debrief`, false);
    await page.getByRole("button", { name: "View full report" }).click();
    await expect(page).toHaveURL(/\/feedback$/);
    await settle(page);
    await page.waitForTimeout(2_000);
    const s = await shot(page, `${run.label}-feedback`);
    await snapshot(page, `${run.label}-feedback`);
    const main = (await page.locator("main").textContent().then((t) => t ?? "")).replace(/\s+/g, " ");
    const bands = (main.match(/(Exemplary|Strong|Proficient|Developing|Emerging|Withheld)/g) ?? []).length;
    const calib = await page.getByRole("img", { name: /calibration/i }).count() + await page.getByRole("figure", { name: /calibration/i }).count() + await page.getByText(/Calibration/).count();
    const citeLinks = await page.locator("main a[href^='http']").count();
    check(
      id("C15"),
      "Student",
      "Feedback shows bands, a calibration plot and gaps with citations",
      "Domain bands, a calibration visual, gaps each linking a guideline source",
      bands > 0 && calib > 0 && citeLinks > 0,
      `${bands} band words, ${calib} calibration elements, ${citeLinks} external citation links`,
      s,
    );
    const ev = await waitForApi("/v1/events/encounter", before, 20_000).catch(() => undefined);
    check(
      id("C16"),
      "Student",
      "Finished encounter is posted to the server",
      "POST /v1/events/encounter 200/201 with a chain hash",
      !!ev && ev.status < 300,
      ev ? `HTTP ${ev.status} ${JSON.stringify(ev.body).slice(0, 160)}` : "no POST /v1/events/encounter seen",
    );
  }, page);
}

test("student: febrile case 1", async () => {
  test.setTimeout(900_000);
  await workCase(1);
});

test("student: febrile case 2", async () => {
  test.setTimeout(900_000);
  await workCase(2);
});

/* ------------------------------------------------------------------------ */
/* 2. Faculty                                                               */
/* ------------------------------------------------------------------------ */

test("faculty: vantage, review queue and roster", async () => {
  await page.goto("/faculty", { waitUntil: "domcontentloaded" });
  await settle(page);
  const urlAsStudent = new URL(page.url()).pathname;
  const s0 = await shot(page, "faculty-as-student");
  check("F1", "Faculty", "Open /faculty as the student", "Refused with an explanation (role gate)", urlAsStudent !== "/faculty" || /not|role|permission/i.test(await page.locator("main").textContent().then((t) => t ?? "")), `landed on ${urlAsStudent}`, s0);

  await setRole("faculty", "Faculty (clinician educator)");
  const nav = await page.getByRole("navigation", { name: "AcuDx" }).textContent().then((t) => t ?? "");
  await page.goto("/faculty", { waitUntil: "domcontentloaded" });
  await settle(page);
  await page.waitForTimeout(2_000);
  const s1 = await shot(page, "faculty-panel");
  await snapshot(page, "faculty-panel");
  const main = (await page.locator("main").textContent().then((t) => t ?? "")).replace(/\s+/g, " ");
  const q0 = [...api].reverse().find((c) => c.path === "/v1/faculty/queue");
  check(
    "F2a",
    "Faculty",
    "Faculty panel with a local faculty profile only",
    "Either served (local mode trusts the profile role) or refused with a way forward",
    !!q0 && (q0.status === 200 || /admin token|sign in/i.test(main)),
    `queue HTTP ${q0?.status}; page says: "${(/Your current identity.{0,300}/.exec(main)?.[0] ?? "").slice(0, 300)}"`,
  );
  // The way forward the page names in local mode: sign in to the admin console
  // in this tab, so the panels also send X-Admin-Token.
  if (q0?.status !== 200) {
    await adminSignIn();
    await setRole("faculty", "Faculty (clinician educator)");
    await page.goto("/faculty", { waitUntil: "domcontentloaded" });
    await settle(page);
    await page.waitForTimeout(2_000);
    await shot(page, "faculty-panel-with-admin-token");
    await snapshot(page, "faculty-panel-with-admin-token");
  }
  const q = [...api].reverse().find((c) => c.path === "/v1/faculty/queue");
  const r = [...api].reverse().find((c) => c.path === "/v1/faculty/roster");
  check(
    "F2",
    "Faculty",
    "Switch to the faculty vantage (local mode: profile role)",
    "Account -> Role -> Faculty; nav shows Faculty; /faculty renders with the Local, unverified badge",
    /Faculty/.test(nav) && new URL(page.url()).pathname === "/faculty",
    `nav: ${nav.replace(/\s+/g, " ").slice(0, 120)}; badge: ${/Local, unverified/.test(main) ? "Local, unverified" : "none"}`,
    s1,
  );
  check(
    "F3",
    "Faculty",
    "Review queue",
    "GET /v1/faculty/queue 200; flagged encounters listed when a diagnosis was wrong or a safety miss occurred",
    !!q && q.status === 200,
    q ? `HTTP ${q.status} ${JSON.stringify(q.body).slice(0, 220)}` : "no queue call",
  );
  check(
    "F4",
    "Faculty",
    "Roster",
    "GET /v1/faculty/roster 200 listing the student with 2 encounters",
    !!r && r.status === 200 && /"encounters":\s*2|encounter_count":\s*2|"encounters": 2/.test(JSON.stringify(r.body)),
    r ? `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 260)}` : "no roster call",
  );
});

/* ------------------------------------------------------------------------ */
/* 3. Dean                                                                  */
/* ------------------------------------------------------------------------ */

test("dean: cohort and chain", async () => {
  await setRole("dean", "Dean / administrator");
  await page.goto("/dean", { waitUntil: "domcontentloaded" });
  await settle(page);
  await page.waitForTimeout(2_500);
  const s = await shot(page, "dean-panel");
  await snapshot(page, "dean-panel");
  const main = (await page.locator("main").textContent().then((t) => t ?? "")).replace(/\s+/g, " ");
  const cohort = [...api].reverse().find((c) => c.path === "/v1/dean/cohort");
  const cb = (cohort?.body ?? {}) as { encounters?: number; learner_count?: number; chain?: { ok?: boolean; verified?: boolean } };
  check(
    "D1",
    "Dean",
    "Open /dean; cohort reflects the two encounters",
    "Cohort encounters = 2, learner count = 1, from the server (not the on-device fallback)",
    cohort?.status === 200 && cb.encounters === 2,
    `UI GET /v1/dean/cohort HTTP ${cohort?.status}; encounters ${cb.encounters}; learners ${cb.learner_count}; page: "${main.slice(0, 160)}"`,
    s,
  );
  const chainText = /chain[^.]{0,60}(verified|intact|broken|unverified)/i.exec(main)?.[0] ?? "";
  check("D2", "Dean", "Chain badge verifies", "Badge reads verified/intact", /verified|intact/i.test(chainText) && !/broken/i.test(chainText), `badge text: "${chainText}"; cohort.chain ${JSON.stringify(cb.chain ?? null)}`);

  // Local-mode header principals are capped at resident; the bootstrap admin
  // token is the documented operator path for the panels.
  const headers = { "X-User-Id": "acceptance-dean-curl", "X-User-Role": "dean", "X-Tenant": TENANT, "X-Admin-Token": ADMIN_TOKEN };
  const curl = await gatewayJson("/v1/dean/cohort?window=all", headers);
  const chain = await gatewayJson("/v1/dean/chain", headers);
  const cbody = curl.body as { encounters?: number };
  check(
    "D3",
    "Dean",
    "Verify with GET /v1/dean/cohort and /v1/dean/chain (curl)",
    "encounters = 2 for the org; chain ok",
    curl.status === 200 && cbody.encounters === 2 && chain.status === 200 && /"ok":\s*true|"verified":\s*true|"valid":\s*true/.test(JSON.stringify(chain.body)),
    `cohort HTTP ${curl.status} encounters=${cbody.encounters}; chain HTTP ${chain.status} ${JSON.stringify(chain.body).slice(0, 160)}`,
  );
});

/* ------------------------------------------------------------------------ */
/* 4. Admin                                                                 */
/* ------------------------------------------------------------------------ */

test("admin: overview, providers, GPU, telemetry, users", async () => {
  await setRole("admin", "Platform administrator");
  await page.goto("/admin", { waitUntil: "domcontentloaded" });
  await settle(page);
  const gate = await shot(page, "admin-token-gate");
  const tokenInput = page.getByLabel(/token/i).first();
  if (await tokenInput.isVisible().catch(() => false)) {
    await tokenInput.fill(ADMIN_TOKEN);
    await page.getByRole("button", { name: /sign in|unlock|continue|open/i }).first().click();
  }
  await page.waitForTimeout(2_000);
  const main0 = (await page.locator("main").textContent().then((t) => t ?? "")).replace(/\s+/g, " ");
  const tabs = await page.getByRole("tab").allTextContents();
  check("A1", "Admin", "Open /admin with the token", "Token verified, console tabs render", tabs.length >= 5, `tabs: ${tabs.join(", ")}`, gate);

  const s1 = await shot(page, "admin-overview");
  check("A2", "Admin", "Overview", "Health tiles, 24 h cost, calls, error rate", /Database|Providers|Disk/.test(main0), main0.slice(0, 200), s1);

  for (const [tid, name, expected] of [
    ["A3", "Providers", "Seeded env rows listed with kind, endpoint, probe"],
    ["A4", "GPU", "Policy readable; Start refused with reason airgapped"],
    ["A5", "Telemetry", "24 h calls and costs from this session"],
    ["A6", "Users", "User list renders (roles table)"],
  ] as const) {
    await soft(tid, "Admin", name, expected, async () => {
      await page.getByRole("tab", { name: new RegExp(`^${name}`) }).first().click();
      await page.waitForTimeout(1_500);
      let extra = "";
      if (name === "GPU") {
        const start = page.getByRole("button", { name: /^Start/ }).first();
        if (await start.count()) {
          await start.click().catch(() => {});
          await page.waitForTimeout(1_500);
        }
        const st = await gatewayJson("/admin/gpu/status", { "X-Admin-Token": ADMIN_TOKEN });
        const pol = await gatewayJson("/admin/gpu/policy", { "X-Admin-Token": ADMIN_TOKEN });
        const startRes = await fetch(`${process.env.ACCEPTANCE_GATEWAY_URL ?? "http://127.0.0.1:8931"}/admin/gpu/start`, { method: "POST", headers: { "X-Admin-Token": ADMIN_TOKEN } });
        extra = ` | status ${st.status} can_launch=${String((st.body as { can_launch?: boolean }).can_launch)}; policy ${pol.status} ${JSON.stringify(pol.body).slice(0, 120)}; POST start ${startRes.status} ${(await startRes.text()).slice(0, 120)}`;
      }
      if (name === "Telemetry") {
        const tel = await gatewayJson("/admin/telemetry/summary?window=24h", { "X-Admin-Token": ADMIN_TOKEN });
        const tb = tel.body as { calls?: number; cost_usd?: number; by_route?: unknown; by_kind?: unknown };
        extra = ` | summary: calls=${tb.calls} cost=${tb.cost_usd} by_route=${JSON.stringify(tb.by_route).slice(0, 300)}`;
      }
      const s = await shot(page, `admin-${name.toLowerCase()}`);
      await snapshot(page, `admin-${name.toLowerCase()}`);
      const text = (await page.locator("main").textContent().then((t) => t ?? "")).replace(/\s+/g, " ");
      const ok =
        name === "Providers" ? /llm|embed|rerank/i.test(text)
        : name === "GPU" ? /airgap|AIRGAPPED/i.test(text + extra) && /idle|budget/i.test(text)
        : name === "Telemetry" ? /calls|cost/i.test(text)
        : /user|role|sub/i.test(text);
      check(tid, "Admin", name, expected, ok, `${text.slice(0, 160)}${extra}`, s);
    }, page);
  }
});
