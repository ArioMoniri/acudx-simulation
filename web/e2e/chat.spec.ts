import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createProfile, openTab, settle } from "./helpers/session";

/**
 * The interview pane (docs/design/05-chat.md): free text first, one send path,
 * generative components from the reply's `actions`, at the four design
 * viewports 375, 768, 1024 and 1440 px. Screenshots land in
 * docs/design/chat-shots/.
 *
 * Offline: /api is aborted (helpers/session offlineGateway) and the client
 * reveal graph answers. Live: /api/health and POST /api/v2/case/{thread}/interview
 * are answered here in the InterviewReply shape (lib/api/interview.ts,
 * docs/architecture/20-chat-contract.md).
 *
 * Run: PORT=4207 npx playwright test e2e/chat.spec.ts --project=laptop
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, "../../docs/design/chat-shots");
mkdirSync(SHOTS, { recursive: true });

const VIEWPORTS = [
  { name: "375", width: 375, height: 812 },
  { name: "768", width: 768, height: 1024 },
  { name: "1024", width: 1024, height: 768 },
  { name: "1440", width: 1440, height: 900 },
] as const;

const COMPOSER = "Type a question to the patient, then press Enter";

function interviewReply(message: string) {
  const offTopic = /weather/i.test(message);
  return {
    thread_id: "e2e",
    reply: offTopic
      ? "I would rather talk about my chest, doctor."
      : "It came on this morning, a heavy pressure in the middle of my chest. It still has not gone.",
    guard: offTopic
      ? { label: "off_topic", reason: "small_talk", note: "Off-topic: the patient answered briefly. Back to the history." }
      : { label: "clinical", reason: "in_scope" },
    actions: offTopic
      ? []
      : [
          { kind: "order", code: "10839-9", system: "LOINC", label: "Troponin I" },
          { kind: "navigate", target: "vitals" },
          { kind: "ask", text: "Does the pain spread to your arm or jaw?" },
        ],
    intent: offTopic ? null : "onset",
    layer: offTopic ? null : "history.presenting",
    state_advance: !offTopic,
    flags: [],
    meta: { source: "model", guard_source: "rules+model", provider: "e2e" },
  };
}

async function openInterview(page: Page) {
  await page.goto("/encounter");
  await settle(page);
  const strip = page.getByRole("tablist", { name: "Chart sections" });
  await expect(strip).toBeVisible({ timeout: 30_000 });
  await openTab(page, "Interview");
  await expect(page.getByRole("log", { name: "Encounter transcript" })).toBeVisible();
}

async function ask(page: Page, text: string) {
  const composer = page.getByPlaceholder(COMPOSER);
  await composer.fill(text);
  await composer.press("Enter");
  await expect(composer).toHaveValue("");
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "horizontal overflow in px").toBeLessThanOrEqual(1);
}

async function axeClean(page: Page) {
  const results = await new AxeBuilder({ page })
    .include("[aria-label='Encounter transcript']")
    .include("#acudx-ask")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
}

async function shot(page: Page, name: string) {
  // Frame the interview pane: its top under the sticky chrome.
  await page.locator('section[aria-label="Interview"]').evaluate((el) => el.scrollIntoView({ block: "start" }));
  // Clear the sticky chrome (top bar, chart banner) above it.
  await page.evaluate(() => {
    let bottom = 0;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const pos = getComputedStyle(el).position;
      if (pos !== "sticky" && pos !== "fixed") continue;
      const r = el.getBoundingClientRect();
      if (r.top <= 1 && r.height < window.innerHeight / 2) bottom = Math.max(bottom, r.bottom);
    }
    window.scrollBy(0, -(bottom + 8));
  });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: false });
}

test.describe("interview chat", () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== "laptop", "viewports are driven inside the spec");
  });

  for (const vp of VIEWPORTS) {
    test(`offline: typed questions answer without the list (${vp.name})`, async ({ page }) => {
      test.slow();
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await createProfile(page, { role: "student" });
      await openInterview(page);

      const transcript = page.getByRole("log", { name: "Encounter transcript" });
      await ask(page, "When did the pain start?");
      await ask(page, "Do you take any regular medications?");
      await expect(transcript.locator("li[data-speaker=learner]")).toHaveCount(2);
      await expect(transcript.locator("li[data-speaker=patient]").first()).toBeVisible();
      expect(await transcript.locator("li[data-speaker=patient]").count()).toBeGreaterThanOrEqual(2);

      // Off topic: an in-character reply and an attending note, never silence.
      await ask(page, "Did you watch the football match this weekend?");
      await expect(transcript.getByTestId("guard-note").last()).toContainText("Off topic");

      // The suggestions drawer sends through the same path.
      await page.getByRole("button", { name: "Suggestions" }).click();
      await page.getByRole("button", { name: "Allergies", exact: true }).click();
      await expect(transcript).toContainText("Are you allergic to any medicines?");

      // Slash command: /exam with the keyboard.
      const composer = page.getByPlaceholder(COMPOSER);
      await composer.fill("/exam heart");
      await expect(page.getByRole("listbox", { name: "Commands" })).toBeVisible();
      await composer.press("Enter");
      await expect(transcript).toContainText("Examined:");

      await noHorizontalScroll(page);
      await axeClean(page);
      await shot(page, `offline-${vp.name}`);
    });

    test(`live: reply actions render and work (${vp.name})`, async ({ page }) => {
      test.slow();
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await createProfile(page, { role: "student" });
      await page.route("**/api/health", (route) => route.fulfill({ json: { status: "ok" } }));
      const turns: string[] = [];
      await page.route("**/api/v2/case/*/interview", async (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        const body = route.request().postDataJSON() as { message: string };
        turns.push(body.message);
        await route.fulfill({ json: interviewReply(body.message) });
      });
      await openInterview(page);

      const transcript = page.getByRole("log", { name: "Encounter transcript" });
      await ask(page, "What brings you in today?");
      await expect.poll(() => turns.length).toBe(1);
      await expect(transcript).toContainText("heavy pressure");

      // Order chip: one click asks, the confirm places, the chip goes pending.
      await transcript.getByRole("button", { name: "Order Troponin I" }).click();
      await shot(page, `live-confirm-${vp.name}`);
      await transcript.getByRole("button", { name: "Place order" }).click();
      await expect(transcript.locator("[data-order-state=pending]")).toBeVisible();

      // Ask chip: goes through the same send path.
      await transcript.getByRole("button", { name: "Does the pain spread to your arm or jaw?" }).click();
      await expect.poll(() => turns.length).toBe(2);
      expect(turns[1]).toBe("Does the pain spread to your arm or jaw?");
      await expect(transcript.getByTestId("guard-note")).toHaveCount(0);

      // Off topic: the server's guard note renders under the in-character reply.
      await ask(page, "Nice weather today, isn't it?");
      await expect.poll(() => turns.length).toBe(3);
      await expect(transcript.getByTestId("guard-note").last()).toContainText("Back to the history.");

      await noHorizontalScroll(page);
      await axeClean(page);
      await shot(page, `live-${vp.name}`);

      // Navigate button: opens the Flowsheets tab.
      await transcript.getByRole("button", { name: "Open Vitals" }).first().click();
      await expect(page.getByRole("tab", { name: /Flowsheets/ })).toHaveAttribute("aria-selected", "true");
    });
  }
});
