import { defineConfig, devices } from "@playwright/test";
import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * AcuDx web — Playwright end-to-end config.
 *
 * Servers (both started by Playwright, both reused when already running):
 *   - the Vite dev server on http://localhost:4173 (`npm run dev -- --port 4173`).
 *     Dev mode was chosen over `vite preview` so a spec failure maps to source
 *     lines and the suite needs no `tsc` + bundle step before it starts.
 *     Set E2E_PREVIEW=1 to run the production bundle instead
 *     (`npm run build && npm run preview -- --port 4173`).
 *   - the multiplayer WebSocket relay on ws://localhost:8899
 *     (`node ../multiplayer/server.mjs`), which the Rooms spec needs so a second
 *     browser context can join a room by code.
 *
 * Browser: Chromium only. The sandbox ships a Chromium build under
 * PLAYWRIGHT_BROWSERS_PATH (/opt/pw-browsers) whose revision may be older than
 * the one this @playwright/test version expects; `playwright install` is not
 * allowed there, so `resolveChromium()` points launchOptions.executablePath at
 * whatever chromium-* build is present. On CI the matching revision is
 * installed with `npx playwright install --with-deps chromium`, the bundled
 * revision directory exists, and the override is skipped.
 *
 * Projects: one per viewport the protocol requires (section 3.4):
 *   mobile 390x844, tablet 768x1024, laptop 1280x800, desktop 1920x1080.
 */

function resolveChromium(): string | undefined {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return undefined;
  let expected: string | undefined;
  try {
    const require = createRequire(import.meta.url);
    const manifest = JSON.parse(readFileSync(require.resolve("playwright-core/browsers.json"), "utf8")) as {
      browsers: { name: string; revision: string }[];
    };
    expected = manifest.browsers.find((b) => b.name === "chromium")?.revision;
  } catch {
    expected = undefined;
  }
  if (expected && existsSync(join(root, `chromium-${expected}`))) return undefined;
  const dirs = readdirSync(root)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort();
  const latest = dirs.at(-1);
  if (!latest) return undefined;
  const bin = join(root, latest, "chrome-linux", "chrome");
  return existsSync(bin) ? bin : undefined;
}

const executablePath = resolveChromium();
const PORT = Number(process.env.PORT ?? 4173);
export const BASE_URL = `http://localhost:${PORT}`;

const webCommand = process.env.E2E_PREVIEW
  ? `npm run build && npm run preview -- --port ${PORT} --strictPort --host 127.0.0.1`
  : `npm run dev -- --port ${PORT} --strictPort --host 127.0.0.1`;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // Locally, Playwright's default (half the cores) is kept: a fixed 4 workers
  // oversubscribed a 4-core box that also hosts the Vite dev server, the relay
  // and other sessions, and the longest crawls (buttons on /atlas, /exam) ran
  // 3-4x slower than in isolation and blew their 60 s budget. CI pins 2.
  workers: process.env.CI ? 2 : undefined,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: BASE_URL,
    locale: "en-US",
    timezoneId: "Europe/Istanbul",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    {
      name: "mobile",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
    },
    {
      name: "tablet",
      use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 }, hasTouch: true },
    },
    { name: "laptop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1920, height: 1080 } } },
  ],
  webServer: [
    {
      command: webCommand,
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
      // Vite logs "http proxy error: /health" for every /api probe while no
      // gateway runs; that is expected in e2e, so stderr is not piped.
      stdout: "ignore",
      stderr: "ignore",
    },
    {
      command: "node ../multiplayer/server.mjs",
      port: 8899,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
