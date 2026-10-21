// Production verification of the role accounts (run from web/, which has Playwright):
//
//   BASE_URL=https://<domain> CREDENTIALS_FILE=/path/credentials.json SHOTS_DIR=../docs/review/production \
//     node ../deploy/verify/verify-roles.mjs
//
// CREDENTIALS_FILE is /var/lib/acudx/bootstrap/credentials.json copied from the server over SSH
// (keep it 0600 and delete it afterwards). For each account it signs in through Keycloak with the
// temporary password, completes the UPDATE_PASSWORD step with a random new password (kept in
// memory only, never printed), checks the landing panel and the UI and API role gates, and saves
// screenshots. With START_CASE=1 the learner account also starts a case, which answers
// model_warming and launches the on-demand GPU worker when no model is serving.
//
// Afterwards the accounts are NOT temporary any more: run
// `deploy/rotate-bootstrap-code.sh --reset-passwords` on the server (or deploy/aws/rotate-code.sh)
// so the person receiving the handoff gets untouched accounts.
//
// Never prints a password or a token. IGNORE_HTTPS_ERRORS=1 only for a local smoke stack.
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Resolve Playwright from the working directory (web/), not from this file's folder.
const { chromium } = createRequire(join(process.cwd(), "package.json"))("playwright");

const BASE = (process.env.BASE_URL || "").replace(/\/$/, "");
const SHOTS = process.env.SHOTS_DIR || "verify-shots";
const IGNORE_TLS = process.env.IGNORE_HTTPS_ERRORS === "1";
if (!BASE || !process.env.CREDENTIALS_FILE) {
  console.error("set BASE_URL and CREDENTIALS_FILE");
  process.exit(2);
}
const creds = JSON.parse(readFileSync(process.env.CREDENTIALS_FILE, "utf8"));
mkdirSync(SHOTS, { recursive: true });

const PANEL = { super_admin: "/admin", admin: "/admin", dean: "/dean", faculty: "/faculty" };
const ALLOWED = {
  "/faculty": ["faculty", "dean", "admin", "super_admin"],
  "/dean": ["dean", "admin", "super_admin"],
  "/admin": ["admin", "super_admin"],
};
const API_GATES = [
  { path: "/api/v1/faculty/queue", min: ["faculty", "dean", "admin", "super_admin"] },
  { path: "/api/v1/dean/cohort", min: ["dean", "admin", "super_admin"] },
  { path: "/api/admin/providers", min: ["admin", "super_admin"] },
];
const newPassword = () => randomBytes(18).toString("base64url") + "9a";

async function api(path, token, init = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* not JSON */
  }
  return { status: res.status, body };
}

const browser = await chromium.launch();
const results = [];
let failures = 0;
const check = (ok, what) => {
  if (!ok) failures += 1;
  return `${ok ? "ok  " : "FAIL"} ${what}`;
};

for (const u of creds.users) {
  const lines = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: IGNORE_TLS });
  const page = await ctx.newPage();
  let token = null;
  page.on("response", async (r) => {
    if (r.url().includes("/protocol/openid-connect/token") && r.request().method() === "POST") {
      try {
        token = (await r.json()).access_token || token;
      } catch {
        /* ignore */
      }
    }
  });
  try {
    await page.goto(`${BASE}/signin`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /sign in with your institution/i }).click();
    await page.waitForURL(/\/idp\/realms\/acudx\//, { timeout: 30_000 });
    await page.fill("#username", u.username);
    await page.fill("#password", u.password);
    await page.click("#kc-login");
    const updated = await page
      .waitForSelector("#password-new", { timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    lines.push(check(updated, "Keycloak asked for a new password (UPDATE_PASSWORD)"));
    if (updated) {
      const pw = newPassword();
      await page.fill("#password-new", pw);
      await page.fill("#password-confirm", pw);
      await page.locator("input[type=submit], button[type=submit]").first().click();
    }
    await page.waitForURL((url) => url.origin === BASE && !url.pathname.startsWith("/auth/callback"), { timeout: 30_000 });
    await page.waitForLoadState("networkidle");
    const expected = PANEL[u.role] || "/";
    const landed = new URL(page.url()).pathname;
    lines.push(check(landed === expected, `landed on ${landed} (expected ${expected})`));
    await page.screenshot({ path: join(SHOTS, `${u.role}-landing.png`), fullPage: false });

    for (const [path, roles] of Object.entries(ALLOWED)) {
      await page.goto(BASE + path, { waitUntil: "networkidle" });
      const gated = (await page.locator("#role-gate-title").count()) > 0;
      const allowed = roles.includes(u.role);
      lines.push(check(gated === !allowed, `UI ${path}: ${allowed ? "opens" : "gated"}`));
      if (path === "/admin" && allowed) {
        const tokenGate = (await page.getByText(/admin token/i).count()) > 0 && (await page.getByRole("tab").count()) === 0;
        lines.push(check(!tokenGate, "admin console opens with the verified bearer (no bootstrap token)"));
        await page.screenshot({ path: join(SHOTS, `${u.role}-admin.png`) });
        if (u.role === "super_admin") {
          // The Anthropic preset in the provider drawer (nothing is saved here).
          await page.getByRole("tab", { name: /providers/i }).first().click();
          await page.getByRole("button", { name: /add provider/i }).first().click();
          const preset = page.getByRole("button", { name: /use the anthropic api/i });
          const hasPreset = (await preset.count()) > 0;
          lines.push(check(hasPreset, "provider drawer offers the Anthropic preset"));
          if (hasPreset) await preset.click();
          await page.screenshot({ path: join(SHOTS, "super_admin-anthropic-preset.png") });
          await page.keyboard.press("Escape");
        }
      }
    }
    if (token) {
      const me = await api("/api/v1/auth/me", token);
      lines.push(check(me.status === 200 && me.body?.primary_role === u.role && me.body?.verified === true,
        `/v1/auth/me primary_role=${me.body?.primary_role} verified=${me.body?.verified}`));
      for (const g of API_GATES) {
        const r = await api(g.path, token);
        const allowed = g.min.includes(u.role);
        lines.push(check(allowed ? r.status === 200 : [401, 403].includes(r.status), `API ${g.path}: ${r.status}`));
      }
      if (process.env.START_CASE === "1" && u.role === (process.env.CASE_ROLE || "student")) {
        const r = await api("/api/v2/case/generate/stream", token, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "text/event-stream" },
          body: JSON.stringify({ complaint: "fever", locale: "en" }),
        });
        lines.push(`info case start: HTTP ${r.status} ${r.body?.error || ""} ${JSON.stringify(r.body?.worker || "")}`);
      }
    } else {
      lines.push(check(false, "no access token observed"));
    }
  } catch (e) {
    lines.push(check(false, `flow error: ${String(e).slice(0, 200)}`));
    await page.screenshot({ path: join(SHOTS, `${u.role}-error.png`) }).catch(() => {});
  }
  results.push({ username: u.username, role: u.role, lines });
  console.log(`\n${u.username} (${u.role})\n  ${lines.join("\n  ")}`);
  await ctx.close();
}
await browser.close();
console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`}: ${results.length} accounts checked`);
process.exit(failures === 0 ? 0 : 1);
