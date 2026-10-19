import type { Page } from "@playwright/test";

/**
 * Collect console errors + uncaught exceptions for a page. Only noise that is
 * provably not an app defect is filtered (listed below, each with the reason).
 */
export interface ConsoleReport {
  errors: string[];
  pageErrors: string[];
}

const IGNORED: RegExp[] = [
  /Download the React DevTools/i, // dev-mode advertisement, not an error
  /favicon\.ico/i, // missing favicon request, not app code
  /\[vite\] (connecting|connected)/i, // HMR client chatter
  /net::ERR_(FAILED|INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|CONNECTION_REFUSED)/i, // offline gateway / wikimedia probe; the app has a documented fallback path
  /Failed to load resource: the server responded with a status of (404|503)/i, // /api probe + /tts when no gateway/key is configured
  /WebSocket connection to 'ws:\/\/[^']+' failed/i, // relay not reachable in a project where it is not required
];

/**
 * Resource loads that are allowed to fail in e2e because no backend is running:
 * the gateway behind the Vite `/api` proxy (the app probes it and degrades to
 * its on-device path) and the dev-only `/tts` voice proxy (503 without a key).
 */
const OFFLINE_RESOURCES = /\/(api|tts)(\/|$|\?)/;

export function watchConsole(page: Page): ConsoleReport {
  const report: ConsoleReport = { errors: [], pageErrors: [] };
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const url = msg.location()?.url ?? "";
    const text = url ? `${msg.text()} <${url}>` : msg.text();
    if (IGNORED.some((re) => re.test(text))) return;
    if (/Failed to load resource/i.test(text) && OFFLINE_RESOURCES.test(new URL(url, "http://localhost").pathname)) return;
    report.errors.push(text);
  });
  page.on("pageerror", (err) => {
    report.pageErrors.push(`${err.name}: ${err.message}`);
  });
  return report;
}

/** True when the ErrorBoundary recovery card is on screen. */
export async function boundaryTripped(page: Page): Promise<boolean> {
  const alert = page
    .getByRole("alert")
    .filter({ hasText: /This screen ran into a problem|Something went wrong/ });
  return (await alert.count()) > 0;
}
