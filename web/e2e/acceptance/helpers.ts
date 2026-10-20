import { expect, type Page, type Response } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Shared plumbing for the live acceptance run (docs/review/05). Every check is
 * soft: it is recorded with expected / observed / pass and the run goes on, so
 * one defect does not hide the rest of the walk. The step table in the review
 * is generated from `results.json`.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
export const SHOT_DIR = process.env.ACCEPTANCE_SHOT_DIR ?? join(HERE, "../../../docs/review/acceptance-2026-10-20");
export const GATEWAY = process.env.ACCEPTANCE_GATEWAY_URL ?? "http://127.0.0.1:8931";
export const ADMIN_TOKEN = process.env.ACCEPTANCE_ADMIN_TOKEN ?? "acceptance-admin";

export interface StepRecord {
  id: string;
  actor: string;
  step: string;
  expected: string;
  observed: string;
  pass: boolean;
  screenshot?: string;
}

const records: StepRecord[] = [];
let shotSeq = 0;

export function record(r: StepRecord): void {
  records.push(r);
  mkdirSync(SHOT_DIR, { recursive: true });
  writeFileSync(join(SHOT_DIR, "results.json"), JSON.stringify(records, null, 2));
  // Visible in the list reporter while the run is in flight.
  console.log(`${r.pass ? "PASS" : "FAIL"} ${r.id} ${r.step} :: ${r.observed}`);
}

export function check(
  id: string,
  actor: string,
  step: string,
  expected: string,
  pass: boolean,
  observed: string,
  screenshot?: string,
): boolean {
  record({ id, actor, step, expected, observed, pass, ...(screenshot ? { screenshot } : {}) });
  return pass;
}

/** Full-page screenshot into the review folder; returns the file name. */
export async function shot(page: Page, name: string, fullPage = true): Promise<string> {
  shotSeq += 1;
  const file = `${String(shotSeq).padStart(2, "0")}-${name}.png`;
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: join(SHOT_DIR, file), fullPage });
  return file;
}

/** Aria snapshot of <main> for the evidence folder (debugging a failed step). */
export async function snapshot(page: Page, name: string): Promise<void> {
  try {
    const yml = await page.locator("main").first().ariaSnapshot({ timeout: 5_000 });
    mkdirSync(join(SHOT_DIR, "aria"), { recursive: true });
    writeFileSync(join(SHOT_DIR, "aria", `${name}.yml`), yml);
  } catch {
    /* evidence only */
  }
}

/** Run a step; an exception becomes a failed record instead of aborting the walk. */
export async function soft(id: string, actor: string, step: string, expected: string, fn: () => Promise<void>, page?: Page): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
    let screenshot: string | undefined;
    if (page) {
      try {
        screenshot = await shot(page, `${id}-error`);
        await snapshot(page, `${id}-error`);
      } catch {
        screenshot = undefined;
      }
    }
    check(id, actor, step, expected, false, `step threw: ${msg.slice(0, 300)}`, screenshot);
    return false;
  }
}

/** Captured gateway traffic, keyed by path, so checks can read what the UI received. */
export interface Captured {
  url: string;
  path: string;
  method: string;
  status: number;
  reqBody: unknown;
  body: unknown;
  at: number;
}

export function captureApi(page: Page): Captured[] {
  const log: Captured[] = [];
  page.on("response", (r: Response) => {
    const url = r.url();
    const i = url.indexOf("/api/");
    if (i < 0) return;
    const path = url.slice(i + 4).split("?")[0];
    const req = r.request();
    let reqBody: unknown = null;
    try {
      reqBody = req.postDataJSON();
    } catch {
      reqBody = req.postData();
    }
    void r
      .text()
      .then((t) => {
        let body: unknown = t;
        try {
          body = JSON.parse(t);
        } catch {
          body = t.slice(0, 2000);
        }
        log.push({ url, path, method: req.method(), status: r.status(), reqBody, body, at: Date.now() });
      })
      .catch(() => {
        log.push({ url, path, method: req.method(), status: r.status(), reqBody, body: null, at: Date.now() });
      });
  });
  return log;
}

export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await expect(page.locator("main#main")).toBeVisible();
  await page
    .locator("main#main [role=status]")
    .first()
    .waitFor({ state: "hidden", timeout: 10_000 })
    .catch(() => {});
  await page.waitForTimeout(500);
}

export function chartTab(page: Page, name: string | RegExp) {
  return page.getByRole("tablist", { name: "Chart sections" }).getByRole("tab", { name });
}

export async function openTab(page: Page, name: string | RegExp): Promise<void> {
  await chartTab(page, name).click();
  await page.waitForTimeout(300);
}

/** The gateway's own view, read with curl-equivalent requests (no browser). */
export async function gatewayJson(path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${GATEWAY}${path}`, { headers: { accept: "application/json", ...headers } });
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text };
  }
}
