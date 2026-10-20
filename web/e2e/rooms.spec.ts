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
