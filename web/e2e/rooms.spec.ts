import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { createProfile, settle } from "./helpers/session";
import { watchConsole, boundaryTripped } from "./helpers/console";
import { LIVE_CASES } from "./helpers/liveCase";

const sse = (event: string, data: unknown, id: number) => `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/** The room thread as the server would serve it (doc 15 12.7): bind, join, follow, layers. */
async function roomThreadServer(
  ctx: BrowserContext,
  opts: { member: boolean; releaseFollow?: Promise<void>; holdLayer?: Promise<void> },
) {
  const calls: { path: string; body: unknown }[] = [];
  let follows = 0;
  await ctx.route(
    (url) => /^\/api\/v2\/case\/[^/]+\/(room|join|events|layer\/[^/]+)$/.test(url.pathname),
    async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const threadId = decodeURIComponent(url.pathname.split("/")[4]);
      const what = url.pathname.split("/").slice(5).join("/");
      calls.push({ path: `${what}${url.search}`, body: req.postDataJSON?.() ?? null });
      const rec = LIVE_CASES[0];
      const spec = (layers: Record<string, string>, extra: Record<string, unknown> = {}) => ({
        ...rec.spec,
        ...extra,
        meta: { ...rec.spec.meta, thread_id: threadId, source: "model", layers },
      });
      if (what === "room") {
        return opts.member
          ? route.fulfill({ status: 404, json: { error: "thread_not_found" } })
          : route.fulfill({ json: { thread_id: threadId, room: true } });
      }
      if (what === "join") return route.fulfill({ json: { thread_id: threadId, member: true, last_event_id: 6 } });
      if (what.startsWith("layer/")) {
        await opts.holdLayer;
        return route.fulfill({
          json: { thread_id: threadId, layer: what.slice(6), status: "ready", data: {},
                  spec: spec({ "history.background": "ready", results: "ready", treatments: "ready" },
                             { allergies_en: "Penicillin (rash)", allergies_tr: "Penisilin (döküntü)" }) },
        });
      }
      // events?follow=1: the member's own stream of the thread log.
      follows += 1;
      if (!opts.member) return route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: "" });
      if (follows === 1) {
        return route.fulfill({
          status: 200, headers: { "content-type": "text/event-stream" },
          body: sse("layer.pending", { layer: "results", reason: "continuation" }, 7)
            + sse("layer.pending", { layer: "treatments", reason: "continuation" }, 8),
        });
      }
      if (follows === 2) await opts.releaseFollow;
      const body = follows === 2
        ? sse("layer.ready", { layer: "history.background", data: {},
                               spec: spec({ "history.background": "ready", results: "ready", treatments: "pending" },
                                          { allergies_en: "Penicillin (rash)", allergies_tr: "Penisilin (döküntü)" }) }, 9)
          + sse("error", { stage: "treatments", error: "safety_veto", status: 502, retryable: true, thread_id: threadId,
                           reason: "The safety review rejected the treatment table after the rewrite.", issues: ["unsafe dose"] }, 10)
          + sse("director", {
              thread_id: threadId, client_id: "tab-host", action: { kind: "question", ref: "onset" },
              case_state: { t_ms: 60000 },
              patient_visible_changes: {
                t_ms: 60000, vitals: { hr: 128, systolic: 88, diastolic: 52, rr: 28, spo2: 91, tempC: 39.6 },
                affect: { pain: 6, anxiety: 0.7, dyspnea: 0.6, consciousness: "alert", mood_en: "frightened", mood_tr: "korkmuş" },
                utterance_en: "The shivering is worse, I feel awful.", utterance_tr: "Titreme kötüleşti, çok kötü hissediyorum.",
                new_facts: [], complications_fired: [], trace: [],
              },
              director_notes: [],
            }, 11)
        : "";
      return route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body });
    },
  );
  return { calls };
}

/**
 * One room thread shared by two browser contexts, as the gateway serves it (doc 15 12.8):
 * the thread log (`task`, `director`, `layer.ready` events) that every member follows, the
 * task route with the treatment-table gate, and the Director step that lands on the log.
 */
function sharedRoomThread() {
  const threadId = "e2e-room-thread";
  const rec = LIVE_CASES[0];
  const log: { id: number; event: string; data: unknown }[] = [];
  const tasks: Record<string, Record<string, unknown>> = {};
  const directorSteps: Record<string, unknown>[] = [];
  let layers: Record<string, string> = { "history.presenting": "ready", treatments: "pending" };
  const spec = () => ({ ...rec.spec, meta: { ...rec.spec.meta, thread_id: threadId, source: "model", layers: { ...layers } } });
  const emit = (event: string, data: unknown) => log.push({ id: log.length + 1, event, data });
  const after = async (n: number) => {
    // A follow stream: what landed after `n`, or (idle) an empty answer after a short wait.
    for (let i = 0; i < 15 && !log.some((e) => e.id > n); i += 1) await new Promise((r) => setTimeout(r, 100));
    return log.filter((e) => e.id > n).map((e) => sse(e.event, e.data, e.id)).join("");
  };
  emit("opening.ready", { thread_id: threadId, opening: {}, spec: spec() });
  const TREATED = { hr: 97, systolic: 112, diastolic: 70, rr: 19, spo2: 97, tempC: 38.2 };

  async function install(ctx: BrowserContext, role: "host" | "member") {
    await ctx.route("**/api/health", (route) => route.fulfill({ json: { status: "ok" } }));
    await ctx.route(
      (url) => url.pathname === "/api/v2/case/generate/stream" || url.pathname === "/api/v2/director/step"
        || /^\/api\/v2\/case\/[^/]+\/(room|join|events|task|layer\/[^/]+)$/.test(url.pathname),
      async (route) => {
        const req = route.request();
        const url = new URL(req.url());
        const body = (req.postDataJSON?.() ?? {}) as Record<string, unknown>;
        if (url.pathname.endsWith("/generate/stream")) {
          return route.fulfill({
            status: 200, headers: { "content-type": "text/event-stream" },
            body: sse("start", { thread_id: threadId, stages: ["s1"] }, 0) + sse("opening.ready", { thread_id: threadId, opening: {}, spec: spec() }, 1),
          });
        }
        if (url.pathname.endsWith("/director/step")) {
          const action = body.action as { kind: string; ref: string };
          if (action.kind === "treatment" && layers.treatments !== "ready") {
            return route.fulfill({ status: 409, json: { error: "treatments_locked" } });
          }
          directorSteps.push(body);
          const vitals = action.kind === "treatment" ? TREATED : rec.spec.triage_vitals;
          const t = 60_000 * (directorSteps.length);
          const out = {
            thread_id: threadId, case_state: { t_ms: t },
            patient_visible_changes: { t_ms: t, vitals, new_facts: [], complications_fired: [], trace: [] },
            director_notes: [], layers_pending: [],
          };
          emit("director", { ...out, client_id: body.client_id, action });
          return route.fulfill({ json: out });
        }
        const what = url.pathname.split("/").slice(5).join("/");
        if (what === "room") {
          return role === "host"
            ? route.fulfill({ json: { thread_id: threadId, room: true } })
            : route.fulfill({ status: 404, json: { error: "thread_not_found" } });
        }
        if (what === "join") return route.fulfill({ json: { thread_id: threadId, member: true, last_event_id: log.length } });
        if (what === "events") {
          const n = Number(url.searchParams.get("after") ?? 0);
          return route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: await after(n) });
        }
        if (what === "task") {
          const task = body.task as Record<string, unknown>;
          const id = String(task.id);
          const cur = tasks[id] ?? { ...task, status: "pending" };
          const mar = body.mar as { outcome?: string } | undefined;
          if (body.op === "complete" && cur.kind === "medication" && mar?.outcome !== "blocked" && layers.treatments !== "ready") {
            return route.fulfill({ status: 409, json: { error: "treatments_locked" } });
          }
          if (body.op === "claim" && cur.status === "pending") Object.assign(cur, { status: "claimed", claimed_by: body.role });
          if (body.op === "complete") Object.assign(cur, { status: "done", completed_by: body.role, ...(mar ? { mar } : {}) });
          tasks[id] = cur;
          emit("task", { thread_id: threadId, op: body.op, task: { ...cur }, client_id: body.client_id });
          return route.fulfill({ json: { thread_id: threadId, task: cur } });
        }
        // A lazy layer read: the layer is in.
        return route.fulfill({ json: { thread_id: threadId, layer: what.slice(6), status: "ready", data: {}, spec: spec() } });
      },
    );
  }

  return {
    threadId,
    tasks,
    directorSteps,
    install,
    /** The treatment table passed the safety review and lands on the thread. */
    landTreatments() {
      layers = { ...layers, treatments: "ready" };
      emit("layer.ready", { layer: "treatments", data: {}, spec: spec() });
    },
    treated: TREATED,
  };
}

async function monitorHr(page: Page): Promise<string> {
  return (await page.getByTestId("room-monitor").locator("tbody tr").first().locator("td").innerText()).trim();
}

async function openRoomAsHost(page: Page): Promise<{ roomUrl: string; code: string }> {
  await page.goto("/rooms");
  await settle(page);
  await page.getByRole("button", { name: "Create room" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const confirm = dialog.getByRole("button", { name: "Create room" });
  await confirm.scrollIntoViewIfNeeded();
  await confirm.click({ force: true });
  await expect(page).toHaveURL(/\/rooms\/[^/]+$/);
  await settle(page);
  const copyBtn = page.getByRole("button", { name: "Copy invite code" });
  await expect(copyBtn).toBeVisible();
  const code = (await copyBtn.locator("xpath=preceding-sibling::span[1]").innerText()).trim();
  return { roomUrl: page.url(), code };
}

/**
 * Team rooms: create a room, read its invite code, join from a second browser
 * context (a different device/person, synced over the ws relay on :8899), and
 * switch the acting role.
 */
test.describe("rooms", () => {
  test("create, join by code from a second context, switch role", async ({ browser, page }) => {
    const report = watchConsole(page);
    await createProfile(page, { role: "resident", fullName: "Host Resident" });

    await page.goto("/rooms");
    await settle(page);
    await page.getByRole("button", { name: "Create room" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // On the 390px project the confirm button sits below the fold of a
    // scrolling dialog and never passes the "stable" check within the budget;
    // scroll it in and force the click.
    const confirm = dialog.getByRole("button", { name: "Create room" });
    await confirm.scrollIntoViewIfNeeded();
    await confirm.click({ force: true });
    await expect(page).toHaveURL(/\/rooms\/[^/]+$/);
    await settle(page);
    const roomUrl = page.url();

    // Invite code sits next to the copy button.
    const copyBtn = page.getByRole("button", { name: "Copy invite code" });
    await expect(copyBtn).toBeVisible();
    const code = (await copyBtn.locator("xpath=preceding-sibling::span[1]").innerText()).trim();
    expect(code, "invite code").toMatch(/^[A-Z0-9-]{4,}$/i);

    // Second person, second context.
    const ctx2 = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
    const p2 = await ctx2.newPage();
    const report2 = watchConsole(p2);
    await createProfile(p2, { role: "student", fullName: "Joining Student" });
    await p2.goto("/rooms");
    await settle(p2);
    await p2.getByLabel("Room code").fill(code);
    await p2.getByRole("button", { name: "Join", exact: true }).click();
    await expect(p2).toHaveURL(new RegExp(roomUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/^https?:\/\/[^/]+/, "") + "$"));
    await settle(p2);

    // The joiner's room title must match the host's (synced snapshot, not a placeholder).
    const hostTitle = await page.getByRole("heading", { level: 1 }).first().innerText();
    await expect(p2.getByRole("heading", { level: 1 }).first()).toHaveText(hostTitle, { timeout: 15_000 });
    // Host sees the joiner occupy the first open seat (Nurse): its "Take seat"
    // control disappears while the AI-held Paramedic seat stays open.
    await expect(page.getByRole("button", { name: "Take the Nurse seat" })).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Take the Paramedic seat" })).toBeVisible();
    // Joiner is seated and acting as the nurse.
    await expect(p2.getByRole("heading", { name: "Acting as Nurse" })).toBeVisible({ timeout: 15_000 });

    // Role switch on the host.
    const switcher = page.getByRole("group", { name: "Switch role" });
    await expect(switcher).toBeVisible();
    await switcher.getByRole("button", { name: /Nurse/ }).click();
    await expect(switcher.getByRole("button", { name: /Nurse/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("heading", { name: "Acting as Nurse" })).toBeVisible();
    await switcher.getByRole("button", { name: /Doctor/ }).click();
    await expect(page.getByRole("heading", { name: "Acting as Doctor" })).toBeVisible();

    expect(await boundaryTripped(page)).toBe(false);
    expect(await boundaryTripped(p2)).toBe(false);
    expect(report.pageErrors).toEqual([]);
    expect(report2.pageErrors).toEqual([]);
    expect(report.errors).toEqual([]);
    expect(report2.errors).toEqual([]);
    await ctx2.close();
  });

  test("a member receives the room thread's later layers, safety failure and Director updates", async ({ browser, page }) => {
    const report = watchConsole(page);
    await createProfile(page, { role: "resident", fullName: "Host Resident" });
    const host = await roomThreadServer(page.context(), { member: false });
    const { roomUrl, code } = await openRoomAsHost(page);
    // The learner who requested the case binds its thread to the room's code.
    await expect.poll(() => host.calls.find((c) => c.path === "room")?.body).toEqual({ room_code: code });

    const ctx2 = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
    const p2 = await ctx2.newPage();
    const report2 = watchConsole(p2);
    await createProfile(p2, { role: "student", fullName: "Joining Student" });
    let release: () => void = () => undefined;
    const releaseFollow = new Promise<void>((r) => {
      release = r;
    });
    let releaseLayer: () => void = () => undefined;
    const holdLayer = new Promise<void>((r) => {
      releaseLayer = r;
    });
    const member = await roomThreadServer(ctx2, { member: true, releaseFollow, holdLayer });
    await p2.goto("/rooms");
    await settle(p2);
    await p2.getByLabel("Room code").fill(code);
    await p2.getByRole("button", { name: "Join", exact: true }).click();
    await expect(p2).toHaveURL(new URL(roomUrl).pathname);
    await settle(p2);

    // The member joins the thread with the code and follows its log.
    await expect.poll(() => member.calls.map((c) => c.path.split("?")[0])).toEqual(
      expect.arrayContaining(["room", "join", "events"]),
    );
    expect(member.calls.find((c) => c.path === "join")?.body).toEqual({ room_code: code });
    expect(member.calls.find((c) => c.path.startsWith("events"))?.path).toBe("events?after=0&follow=1");
    // Layers still being written for this patient reach the member's strip...
    const strip = p2.getByRole("status", { name: "Being written for this patient" });
    await expect(strip.getByText("Results is being written for this patient")).toBeVisible({ timeout: 15_000 });
    release();
    // ...then the later layer lands (the allergy from the background history) ...
    await expect(p2.getByText(/Penicillin \(rash\)|Penisilin \(döküntü\)/).first()).toBeVisible({ timeout: 15_000 });
    await expect(strip.getByText("Results is being written for this patient")).toHaveCount(0);
    // ...the vetoed treatment table fails honestly and is regenerated once (the member's own
    // layer read), nothing is shown in its place ...
    await expect(strip.getByText("Treatment options are being regenerated")).toBeVisible();
    await expect.poll(() => member.calls.some((c) => c.path === "layer/treatments")).toBe(true);
    // ...and the host's Director step reaches the member's transcript.
    const switcher = p2.getByRole("group", { name: "Switch role" });
    await switcher.getByRole("button", { name: /Doctor/ }).click();
    await p2.getByRole("tab", { name: "Interview" }).click();
    await expect(p2.getByText(/The shivering is worse, I feel awful\.|Titreme kötüleşti/).first()).toBeVisible({ timeout: 15_000 });
    // The regenerated table lands; nothing is left being written.
    releaseLayer();
    await expect(strip).toHaveCount(0, { timeout: 15_000 });

    expect(await boundaryTripped(page)).toBe(false);
    expect(await boundaryTripped(p2)).toBe(false);
    expect(report.pageErrors).toEqual([]);
    expect(report2.pageErrors).toEqual([]);
    expect(report.errors).toEqual([]);
    expect(report2.errors).toEqual([]);
    await ctx2.close();
  });

  test("the doctor orders, the nurse administers on the thread, both monitors move together", async ({ browser, page }) => {
    const report = watchConsole(page);
    const thread = sharedRoomThread();
    await createProfile(page, { role: "resident", fullName: "Host Resident" });
    await thread.install(page.context(), "host");
    const { roomUrl, code } = await openRoomAsHost(page);

    const ctx2 = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
    const p2 = await ctx2.newPage();
    const report2 = watchConsole(p2);
    await createProfile(p2, { role: "student", fullName: "Joining Nurse" });
    await thread.install(ctx2, "member");
    await p2.goto("/rooms");
    await settle(p2);
    await p2.getByLabel("Room code").fill(code);
    await p2.getByRole("button", { name: "Join", exact: true }).click();
    await expect(p2).toHaveURL(new URL(roomUrl).pathname);
    await settle(p2);
    await expect(p2.getByRole("heading", { name: "Acting as Nurse" })).toBeVisible({ timeout: 15_000 });

    // The doctor orders paracetamol; the order lands in the nurse's queue on the other device.
    await page.getByRole("tab", { name: "Orders & tasks" }).click();
    await page.getByRole("button", { name: "Order Paracetamol" }).click();
    await expect.poll(() => Object.values(thread.tasks).map((t) => t.code)).toEqual(["161"]);
    const administer = p2.getByRole("button", { name: "Administer Paracetamol" });
    await expect(administer).toBeVisible({ timeout: 15_000 });
    // No safe treatment table on the thread yet: Administer is disabled, the notice says why.
    await expect(administer).toBeDisabled();
    await expect(p2.getByTestId("treatment-table-notice")).toContainText("Treatment options are being written for this patient");

    // The table lands for every member; the nurse gives the dose through the shared thread.
    thread.landTreatments();
    await expect(administer).toBeEnabled({ timeout: 15_000 });
    await expect(p2.getByTestId("treatment-table-notice")).toHaveCount(0);
    await administer.click();

    // The Director stepped the thread once (server-held state, never a client course) ...
    await expect.poll(() => thread.directorSteps.filter((b) => (b.action as { kind: string }).kind === "treatment").length, { timeout: 15_000 }).toBe(1);
    const step = thread.directorSteps.find((b) => (b.action as { kind: string }).kind === "treatment")!;
    expect(step).toMatchObject({ thread_id: thread.threadId, action: { kind: "treatment", ref: "161" } });
    expect(step).not.toHaveProperty("case_state");
    // ... the MAR line and the done task travel on the thread ...
    await expect.poll(() => thread.tasks[Object.keys(thread.tasks)[0]].status).toBe("done");
    expect(thread.tasks[Object.keys(thread.tasks)[0]]).toMatchObject({ completed_by: "nurse", mar: { outcome: expect.stringMatching(/given|flagged/) } });
    // ... and both monitors show the same Director vitals.
    const hr = `${thread.treated.hr} bpm`;
    await expect.poll(() => monitorHr(p2), { timeout: 15_000 }).toBe(hr);
    await expect.poll(() => monitorHr(page), { timeout: 15_000 }).toBe(hr);
    // The doctor sees the task done by the nurse.
    await expect(page.getByText("Executed by Nurse").first()).toBeVisible({ timeout: 15_000 });

    expect(await boundaryTripped(page)).toBe(false);
    expect(await boundaryTripped(p2)).toBe(false);
    expect(report.pageErrors).toEqual([]);
    expect(report2.pageErrors).toEqual([]);
    expect(report.errors).toEqual([]);
    expect(report2.errors).toEqual([]);
    await ctx2.close();
  });

  test("the lobby lists no example rooms and shows the empty state", async ({ page }) => {
    await createProfile(page, { role: "student" });
    await page.goto("/rooms");
    await settle(page);
    const empty = page.getByTestId("rooms-empty");
    await expect(empty).toBeVisible();
    await expect(empty.getByText("No rooms yet")).toBeVisible();
    for (const seeded of ["Morning resus", "Emine Korkmaz", "Thunderclap headache", "Kerem Öztürk", "ACS-7K2"]) {
      await expect(page.getByText(seeded)).toHaveCount(0);
    }
    await empty.getByRole("button", { name: "Create room" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("an unknown code is rejected with a message", async ({ page }) => {
    await createProfile(page, { role: "student" });
    await page.goto("/rooms");
    await settle(page);
    await page.getByLabel("Room code").fill("ZZZ-000");
    await page.getByRole("button", { name: "Join", exact: true }).click();
    await expect(page.getByText("No open room matches that code. Check it and try again.")).toBeVisible();
    await expect(page).toHaveURL(/\/rooms$/);
  });
});
