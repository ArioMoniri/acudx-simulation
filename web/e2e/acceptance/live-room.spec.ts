import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Live team-room acceptance (docs/review/07-live-room-acceptance.md): two browser contexts
 * on a dev server that proxies /api to a gateway backed by a real GPU worker. The host
 * creates a room and requests a fever case, a second member joins as the nurse, both play
 * the staged case live (opening, layers, Director steps fanned out, the nurse administers),
 * the doctor commits a diagnosis and the debrief layer appears with citations.
 *
 * Every /api/v2 request and every SSE event each context receives is tapped in the page
 * (wall-clock ms, same machine), so the run measures time to first text, time to the
 * playable opening, layer arrival times and the Director fan-out latency between contexts.
 *
 * Needs ACCEPTANCE_ROOM_BASE_URL (and VITE_MULTIPLAYER_URL on that dev server when the relay
 * is not on :8899); skipped otherwise. Raw screenshots and timings go to ACCEPTANCE_ROOM_OUT.
 */
const BASE = process.env.ACCEPTANCE_ROOM_BASE_URL;
const OUT = process.env.ACCEPTANCE_ROOM_OUT ?? "/tmp/acudx-live-room";

test.skip(!BASE, "live room pass only");

interface TapEntry {
  kind: "http" | "sse";
  path: string;
  method?: string;
  t0?: number;
  t1?: number;
  t?: number;
  status?: number;
  body?: string | null;
  event?: string;
  layer?: string;
  stage?: string;
  error?: string;
  client_id?: string;
  action?: { kind: string; ref: string };
  op?: string;
}

const TAP = `
(() => {
  if (window.__tap) return;
  window.__tap = [];
  const orig = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input && input.url) || String(input);
    if (!url.includes("/api/v2/")) return orig(input, init);
    const path = new URL(url, location.href).pathname + new URL(url, location.href).search;
    const t0 = Date.now();
    const res = await orig(input, init);
    const body = init && typeof init.body === "string" ? init.body.slice(0, 400) : null;
    window.__tap.push({ kind: "http", path, method: (init && init.method) || "GET", t0, t1: Date.now(), status: res.status, body });
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/event-stream") || !res.body) return res;
    const [a, b] = res.body.tee();
    (async () => {
      const reader = b.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\\n\\n")) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = (/^event: (.*)$/m.exec(block) || [])[1];
          const data = (/^data: (.*)$/m.exec(block) || [])[1];
          if (!ev) continue;
          let d = {};
          try { d = JSON.parse(data || "{}"); } catch (e) { d = {}; }
          window.__tap.push({ kind: "sse", path, t: Date.now(), event: ev, layer: d.layer, stage: d.stage, error: d.error,
            client_id: d.client_id, action: d.action, op: d.op });
        }
      }
    })().catch(() => {});
    return new Response(a, { status: res.status, statusText: res.statusText, headers: res.headers });
  };
})();
`;

async function tapOf(page: Page): Promise<TapEntry[]> {
  return (await page.evaluate(() => (window as unknown as { __tap?: unknown[] }).__tap ?? [])) as TapEntry[];
}

let shotSeq = 0;
async function shot(page: Page, name: string): Promise<string> {
  shotSeq += 1;
  const file = `${String(shotSeq).padStart(2, "0")}-${name}.png`;
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: join(OUT, file), fullPage: false });
  return file;
}

const notes: string[] = [];
function note(line: string): void {
  notes.push(line);
  console.log(line);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "notes.txt"), notes.join("\n") + "\n");
}

async function profile(ctx: BrowserContext, name: string, role: string): Promise<Page> {
  await ctx.addInitScript(TAP);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/signin`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Create your profile" }).click();
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Role", { exact: true }).selectOption(role);
  await page.getByLabel("Institution").fill("AcuDx Acceptance Faculty");
  await page.getByRole("button", { name: "Create profile" }).click();
  await expect(page.locator("main#main")).toBeVisible();
  return page;
}

async function monitor(page: Page): Promise<string> {
  const rows = page.getByTestId("room-monitor").locator("tbody tr");
  const out: string[] = [];
  for (let i = 0; i < (await rows.count()); i += 1) {
    out.push(((await rows.nth(i).innerText()) ?? "").replace(/\s+/g, " ").trim());
  }
  return out.join(", ");
}

const rel = (t: number | undefined, t0: number) => (t == null ? "n/a" : `${((t - t0) / 1000).toFixed(1)} s`);

test("live room: two members play one staged fever case", async ({ browser }) => {
  test.setTimeout(3_000_000);
  const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const nurseCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const host = await profile(hostCtx, "Deniz Host", "resident");
  const nurse = await profile(nurseCtx, "Ece Nurse", "student");

  // 1. The host creates a room and requests a fever case.
  await host.goto(`${BASE}/rooms`, { waitUntil: "domcontentloaded" });
  await host.getByRole("button", { name: "Create room" }).first().click();
  const dialog = host.getByRole("dialog");
  await dialog.getByLabel("Case").selectOption("fever");
  const T0 = Date.now();
  await dialog.getByRole("button", { name: "Create room" }).click();
  await expect(host).toHaveURL(/\/rooms\/[^/]+$/, { timeout: 600_000 });
  const tRoom = Date.now();
  await shot(host, "host-room-opening");
  const code = (await host.getByRole("button", { name: "Copy invite code" }).locator("xpath=preceding-sibling::span[1]").innerText()).trim();
  let tap = await tapOf(host);
  const firstText = tap.find((e) => e.kind === "sse" && e.event === "opening.delta");
  const opening = tap.find((e) => e.kind === "sse" && e.event === "opening.ready");
  note(`T0 ${new Date(T0).toISOString()} room code ${code}`);
  note(`host: first text (opening.delta) ${rel(firstText?.t, T0)}; playable opening (opening.ready) ${rel(opening?.t, T0)}; room page ${rel(tRoom, T0)}`);

  // 2. The second member joins with the code and takes the nurse seat.
  await nurse.goto(`${BASE}/rooms`, { waitUntil: "domcontentloaded" });
  await nurse.getByLabel("Room code").fill(code);
  const tJoin = Date.now();
  await nurse.getByRole("button", { name: "Join", exact: true }).click();
  await expect(nurse.getByRole("heading", { name: "Acting as Nurse" })).toBeVisible({ timeout: 60_000 });
  note(`nurse: joined and seated ${rel(Date.now(), tJoin)} after Join`);
  await expect.poll(async () => (await tapOf(nurse)).some((e) => e.kind === "http" && e.path.includes("/events?")), { timeout: 60_000 }).toBe(true);
  await shot(nurse, "nurse-joined");

  // 3. The doctor interviews: every question is a Director step on the thread, fanned out.
  const composer = host.getByPlaceholder("Type a question to the patient, then press Enter");
  for (const q of ["When did the fever start?", "Have you had shaking chills?", "Do you have any allergies to medicines?"]) {
    await composer.fill(q);
    await composer.press("Enter");
    await expect.poll(async () => (await tapOf(host)).filter((e) => e.kind === "http" && e.path.startsWith("/api/v2/director/step")).length, { timeout: 120_000 })
      .toBeGreaterThan(0);
    await host.waitForTimeout(4_000);
  }
  await shot(host, "host-interview");

  // 4. The treatment table lands on the thread; the doctor orders, the nurse administers.
  const tTableWait = Date.now();
  await expect.poll(async () => (await tapOf(nurse)).some((e) => e.event === "layer.ready" && e.layer === "treatments")
    || (await tapOf(nurse)).some((e) => e.event === "error" && e.stage === "treatments"), { timeout: 1_200_000, intervals: [5_000] }).toBe(true);
  tap = await tapOf(nurse);
  const tableFailed = tap.find((e) => e.event === "error" && e.stage === "treatments");
  note(`nurse: treatment table ${tableFailed ? `failed (${tableFailed.error})` : "ready"} after ${rel(Date.now(), tTableWait)} of waiting`);
  await host.getByRole("tab", { name: "Orders & tasks" }).click();
  await host.getByRole("button", { name: "Order Paracetamol" }).click();
  const administer = nurse.getByRole("button", { name: "Administer Paracetamol" });
  await expect(administer).toBeVisible({ timeout: 60_000 });
  await shot(nurse, "nurse-task-queue");
  await expect(administer).toBeEnabled({ timeout: 900_000 });
  const before = { host: await monitor(host), nurse: await monitor(nurse) };
  const tGive = Date.now();
  await administer.click();
  await expect.poll(async () => (await tapOf(host)).some((e) => e.event === "director" && e.action?.kind === "treatment"), { timeout: 180_000 }).toBe(true);
  await host.waitForTimeout(2_000);
  const after = { host: await monitor(host), nurse: await monitor(nurse) };
  note(`monitor before: host [${before.host}] nurse [${before.nurse}]`);
  note(`monitor after (${rel(Date.now(), tGive)} after Administer): host [${after.host}] nurse [${after.nurse}]`);
  await shot(nurse, "nurse-administered");
  await shot(host, "host-after-administer");

  // 5. The doctor commits a diagnosis; the debrief layer appears with citations.
  await host.getByRole("tab", { name: "Diagnosis" }).click();
  await host.getByRole("button", { name: /^Add .+ to the differential$/ }).first().click();
  const commit = host.getByRole("button", { name: /^Commit .+ as the working diagnosis$/ }).first();
  const dxName = ((await commit.getAttribute("aria-label")) ?? "").replace(/^Commit | as the working diagnosis$/g, "");
  const tCommit = Date.now();
  await commit.click();
  note(`host: committed "${dxName}"`);
  await host.getByRole("tab", { name: "Debrief" }).click();
  const debrief = host.getByTestId("case-debrief");
  await expect(debrief).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => (await debrief.getAttribute("aria-busy")) !== "true", { timeout: 600_000, intervals: [3_000] }).toBe(true);
  const debriefText = ((await debrief.innerText()) ?? "").replace(/\s+/g, " ");
  const links = await debrief.locator("a[href]").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
  note(`host: debrief ${rel(Date.now(), tCommit)} after commit; ${links.length} citation link(s): ${links.slice(0, 4).join(" ")}`);
  note(`debrief text: ${debriefText.slice(0, 600)}`);
  await shot(host, "host-debrief");
  await nurse.getByRole("tab", { name: "Debrief" }).click();
  await expect(nurse.getByTestId("case-debrief")).toBeVisible({ timeout: 120_000 });
  await shot(nurse, "nurse-debrief");

  // 6. Timings from the taps.
  const hostTap = await tapOf(host);
  const nurseTap = await tapOf(nurse);
  const layers = (t: TapEntry[]) => t.filter((e) => e.kind === "sse" && e.event === "layer.ready").map((e) => `${e.layer} ${rel(e.t, T0)}`);
  note(`host layer.ready: ${layers(hostTap).join("; ")}`);
  note(`nurse layer.ready: ${layers(nurseTap).join("; ")}`);
  const fan = (from: TapEntry[], to: TapEntry[], label: string) => {
    const posts = from.filter((e) => e.kind === "http" && e.path.startsWith("/api/v2/director/step") && e.status === 200);
    const clientIds = new Set(posts.map((p) => { try { return String(JSON.parse(p.body ?? "{}").client_id); } catch { return ""; } }));
    const recv = to.filter((e) => e.event === "director" && e.client_id && clientIds.has(e.client_id));
    const lat = recv.map((r, i) => (posts[i]?.t1 != null && r.t != null ? r.t - posts[i].t1! : null)).filter((x): x is number => x != null);
    const steps = posts.map((p) => `${((p.t1! - p.t0!) / 1000).toFixed(1)} s`);
    note(`${label}: ${posts.length} Director step(s) (POST round trip ${steps.join(", ")}); received ${recv.length} on the other context; fan-out after the sender's answer: ${lat.map((x) => `${x} ms`).join(", ")}`);
  };
  fan(hostTap, nurseTap, "host -> nurse");
  fan(nurseTap, hostTap, "nurse -> host");
  const tasks = nurseTap.filter((e) => e.event === "task").map((e) => e.op);
  note(`nurse task events: ${tasks.join(", ")}`);
  writeFileSync(join(OUT, "tap-host.json"), JSON.stringify(hostTap, null, 1));
  writeFileSync(join(OUT, "tap-nurse.json"), JSON.stringify(nurseTap, null, 1));
  expect(links.length).toBeGreaterThan(0);
  await hostCtx.close();
  await nurseCtx.close();
});
