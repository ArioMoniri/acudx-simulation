import { defineConfig, devices } from "@playwright/test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Live acceptance run (docs/review/05-acceptance-test-2026-10-20.md).
 *
 * Unlike playwright.config.ts this config starts NO server: the tester runs a
 * real gateway and a dev server on private ports and points the run at them:
 *
 *   ACCEPTANCE_BASE_URL=http://localhost:4193 \
 *   ACCEPTANCE_GATEWAY_URL=http://127.0.0.1:8931 \
 *   ACCEPTANCE_ADMIN_TOKEN=acceptance-admin \
 *   npx playwright test -c playwright.acceptance.config.ts
 *
 * One project (laptop 1280x800), serial, so the student, faculty, dean and
 * admin steps run in order against the same gateway database.
 */
function resolveChromium(): string | undefined {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers";
  if (!existsSync(root)) return undefined;
  const latest = readdirSync(root)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort()
    .at(-1);
  if (!latest) return undefined;
  const bin = join(root, latest, "chrome-linux", "chrome");
  return existsSync(bin) ? bin : undefined;
}

const executablePath = resolveChromium();

export default defineConfig({
  testDir: "./e2e/acceptance",
  // Outside web/: Vite watches its root and reloads the page on every trace file.
  outputDir: process.env.ACCEPTANCE_OUTPUT_DIR ?? join(tmpdir(), "acudx-acceptance-results"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 900_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: process.env.ACCEPTANCE_BASE_URL ?? "http://localhost:4193",
    locale: "en-US",
    timezoneId: "Europe/Istanbul",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [{ name: "laptop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } }],
});
