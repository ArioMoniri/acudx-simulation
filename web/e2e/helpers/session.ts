import { expect, type Locator, type Page } from "@playwright/test";

export type Role = "student" | "resident" | "educator" | "dean";

export interface ProfileOptions {
  role?: Role;
  fullName?: string;
  institution?: string;
  specialty?: string;
}

/**
 * Create a real local profile through the UI: SignInPage -> "Create your
 * profile" -> ProfilePage form -> "Create profile". No localStorage shortcut:
 * this is the only onboarding path a learner has, so every spec exercises it.
 *
 * Leaves the page on Home ("/") and signed in.
 */
export async function createProfile(page: Page, opts: ProfileOptions = {}): Promise<void> {
  await offlineGateway(page);
  const role: Role = opts.role ?? "student";
  const fullName = opts.fullName ?? `E2E ${role} ${Date.now().toString(36)}`;
  const institution = opts.institution ?? "AcuDx E2E Faculty of Medicine";

  await page.goto("/signin");
  await expect(page).toHaveURL(/\/signin$/);
  await page.getByRole("button", { name: "Create your profile" }).click();
  await expect(page).toHaveURL(/\/profile$/);

  await page.getByLabel("Full name").fill(fullName);
  await page.getByLabel("Role", { exact: true }).selectOption(role);
  await page.getByLabel("Institution").fill(institution);
  if (opts.specialty) await page.getByLabel(/Specialty or department/).fill(opts.specialty);

  await page.getByRole("button", { name: "Create profile" }).click();
  // Onboarding completes -> the gate opens and the app lands on Home.
  await expect(page).not.toHaveURL(/\/(profile|signin)$/);
  await expect(page.locator("main#main")).toBeVisible();
}

/**
 * Pin the suite to the on-device path. Playwright starts no gateway, and every
 * spec measures the client's own behaviour (deterministic reveal-graph replies,
 * synthetic results, client-side grading). A gateway that happens to listen on
 * the Vite `/api` proxy port on the same machine would silently switch the app
 * to its live path (model replies arriving one HTTP round-trip at a time), so
 * `/api` is aborted for the whole context; the app treats that exactly like no
 * gateway at all. Aborted requests surface as net::ERR_FAILED, which
 * helpers/console.ts already allows for the documented fallback.
 */
export async function offlineGateway(page: Page): Promise<void> {
  await page.context().route("**/api/**", (route) => route.abort("failed"));
}

/** Every route in web/src/App.tsx that a signed-in dean can render directly. */
export const ROUTES: readonly string[] = [
  "/",
  "/welcome",
  "/start",
  "/cases",
  "/rooms",
  "/encounter",
  "/feedback",
  "/progress",
  "/exam",
  "/atlas",
  "/account",
  "/profile",
  "/authoring",
  "/institution",
  "/this-route-does-not-exist",
];

/** A file-safe slug for a route path. */
export function routeSlug(route: string): string {
  return route === "/" ? "home" : route.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-");
}

/** Wait for the lazy route chunk + entry animations to settle. */
export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await expect(page.locator("main#main")).toBeVisible();
  // RouteFallback shows a status spinner while the chunk loads.
  await page
    .locator("main#main [role=status]")
    .first()
    .waitFor({ state: "hidden", timeout: 20_000 })
    .catch(() => {});
  await page.waitForTimeout(400);
}

/** Open the EHR tab strip entry by its visible label (Chart Review, Interview, Orders, ...). */
export async function openTab(page: Page, name: string | RegExp): Promise<void> {
  const strip = page.getByRole("tablist", { name: "Chart sections" });
  await strip.getByRole("tab", { name }).click();
}

/**
 * Assert `target` becomes visible on the given EHR tab, re-opening that tab
 * between attempts. Written when a landing result moved the tab strip to Results
 * on its own (tester handoff finding); ActivityTabs no longer steals the tab
 * (it badges Results and announces instead), so this is now belt-and-braces: it
 * keeps a long wait honest if the learner's tab ever changes under the test.
 */
export async function expectOnTab(
  page: Page,
  tab: string | RegExp,
  target: Locator,
  timeout: number,
): Promise<void> {
  const deadline = Date.now() + timeout;
  let lastError: unknown;
  while (Date.now() < deadline) {
    await openTab(page, tab);
    try {
      await expect(target).toBeVisible({ timeout: Math.min(3_000, Math.max(500, deadline - Date.now())) });
      return;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error(`expectOnTab: ${String(target)} not visible on ${String(tab)} within ${timeout}ms`);
}
