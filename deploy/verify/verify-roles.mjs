// Production verification of the role accounts (run from web/, which has Playwright):
//
//   HTTPS only (no SSH):
//   BASE_URL=https://<domain> OPERATOR_TOKEN_FILE=~/.ssh/acudx-web-prod-operator.token \
//     SHOTS_DIR=../docs/review/evidence/09-production-live START_CASE=1 FINALIZE=1 node ../deploy/verify/verify-roles.mjs
//
//   or with a credentials file copied from the server (CREDENTIALS_FILE=/path/credentials.json).
//
// With OPERATOR_TOKEN_FILE the script mints a single-use code (/bootstrap/operator/mint-code) and
// reads the temporary passwords once through /bootstrap/credentials, in memory only. With START_CASE=1
// it times the learner's fever case (playable, first reply) and checks one on-demand GPU worker: the
// one the case start launches without a serving model, else one woken by POST /v1/voice/warm as the
// patient call does; it waits for it (/bootstrap/operator/gpu) and stops it (/bootstrap/operator/gpu/stop).
// GPU_CHECK=0 skips the worker. With FINALIZE=1 it ends by giving every account a fresh
// temporary password (/bootstrap/operator/reset-accounts) and minting the code to hand over, which it
// prints (a code may be reported; a password never is). For each account it signs in through Keycloak with the
// temporary password, completes the UPDATE_PASSWORD step with a random new password (kept in
// memory only, never printed), checks the landing panel and the UI and API role gates, and saves
// screenshots. With START_CASE=1 the learner account also starts a case, which answers
// model_warming and launches the on-demand GPU worker when no model is serving.
//
// Without FINALIZE=1 the accounts are NOT temporary any more afterwards: run
// deploy/aws/rotate-code.sh --reset-passwords so the person receiving the handoff gets untouched accounts.
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
const OP_FILE = process.env.OPERATOR_TOKEN_FILE;
if (!BASE || (!process.env.CREDENTIALS_FILE && !OP_FILE)) {
  console.error("set BASE_URL and OPERATOR_TOKEN_FILE (HTTPS only) or CREDENTIALS_FILE");
  process.exit(2);
}
const OP_TOKEN = OP_FILE ? readFileSync(OP_FILE, "utf8").trim() : null;

async function operator(path, body = {}, method = "POST") {
  const res = await fetch(BASE + path, {
    method,
    headers: { "X-Operator-Token": OP_TOKEN, "content-type": "application/json" },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${json.error || ""}`);
  return json;
}

async function credentialsOverHttps() {
  const { code } = await operator("/bootstrap/operator/mint-code", { ttl_hours: 1 });
  const res = await fetch(`${BASE}/bootstrap/credentials`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code }).toString(),
  });
  if (res.status !== 200) throw new Error(`/bootstrap/credentials: HTTP ${res.status}`);
  const html = await res.text();
  const unescape = (t) => t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
  const users = [...html.matchAll(/<tr><td><code>([^<]+)<\/code><\/td><td>([^<]+)<\/td><td><code>([^<]+)<\/code><\/td><\/tr>/g)]
    .map((m) => ({ username: unescape(m[1]), role: unescape(m[2]), password: unescape(m[3]) }));
  if (users.length !== 8) throw new Error(`expected 8 accounts in the handoff table, read ${users.length}`);
  const again = await fetch(`${BASE}/bootstrap/credentials`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code }).toString(),
  });
  console.log(`handoff: code accepted once, second use answered ${again.status}`);
  return { users };
}

const creds = OP_TOKEN && !process.env.CREDENTIALS_FILE
  ? await credentialsOverHttps()
  : JSON.parse(readFileSync(process.env.CREDENTIALS_FILE, "utf8"));
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

// Behind an egress proxy (cloud sessions) the browser needs it explicitly; Node's fetch needs
// NODE_USE_ENV_PROXY=1 (Node 22.21+).
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const browser = await chromium.launch(proxy && !IGNORE_TLS ? { proxy: { server: proxy } } : {});
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
          // The seeded anthropic row takes a key in the admin panel (nothing is saved here).
          await page.getByRole("tab", { name: /providers/i }).first().click();
          await page.screenshot({ path: join(SHOTS, "super_admin-providers.png") });
          const editRow = page.getByRole("button", { name: /^edit anthropic$/i });
          // The table renders a skeleton first: wait for the row instead of counting at once.
          const hasRow = await editRow.first().waitFor({ timeout: 15_000 }).then(() => true).catch(() => false);
          lines.push(check(hasRow, "anthropic row present; its drawer takes the Claude key"));
          if (hasRow) {
            await editRow.first().click();
            const keyField = page.locator("input[type=password][autocomplete=new-password]");
            lines.push(check((await keyField.count()) > 0, "write-only API key field in the anthropic drawer"));
            await page.screenshot({ path: join(SHOTS, "super_admin-anthropic-key.png") });
            await page.keyboard.press("Escape");
          }
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
        // Time to playable: the opening is ready (the encounter can start); time to first reply: the
        // patient's first answer to a typed question. The stream only tails the generation, which
        // keeps running on the server after this reader stops.
        const t0 = Date.now();
        const res = await fetch(`${BASE}/api/v2/case/generate/stream`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "content-type": "application/json", accept: "text/event-stream" },
          body: JSON.stringify({ complaint: "fever", locale: "en" }),
        });
        let warming = null;
        if (res.status === 200) {
          const reader = res.body.getReader();
          const dec = new TextDecoder();
          let buf = "";
          let thread = null;
          let playable = null;
          while (Date.now() - t0 < 300_000 && playable === null) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            for (let i = buf.indexOf("\n\n"); i >= 0; i = buf.indexOf("\n\n")) {
              const chunk = buf.slice(0, i);
              buf = buf.slice(i + 2);
              const ev = /^event: (.+)$/m.exec(chunk)?.[1];
              let d = {};
              try { d = JSON.parse(/^data: (.+)$/m.exec(chunk)?.[1] || "{}"); } catch { /* keepalive */ }
              thread = thread || d.thread_id || null;
              if (ev === "opening.ready") playable = Date.now() - t0;
              if (ev === "error" && d.fatal) break;
            }
          }
          await reader.cancel().catch(() => {});
          lines.push(check(playable !== null && Boolean(thread), `case start: playable after ${playable === null ? "-" : (playable / 1000).toFixed(1)} s`));
          if (thread) {
            const t1 = Date.now();
            let r = null;
            for (let k = 0; k < 40; k += 1) {
              r = await api(`/api/v2/case/${thread}/interview`, token, {
                method: "POST", headers: { "content-type": "application/json" },
                body: JSON.stringify({ message: "When did the fever start, and how high has it been?", locale: "en" }),
              });
              if (r.status !== 409) break;
              await new Promise((ok) => setTimeout(ok, 3000));
            }
            const reply = String(r.body?.reply || "");
            lines.push(check(r.status === 200 && reply.length > 0,
              `first reply after ${((Date.now() - t1) / 1000).toFixed(1)} s (${r.body?.meta?.provider || "?"} ${r.body?.meta?.model || ""}): ${JSON.stringify(reply.slice(0, 160))}`));
          }
        } else {
          const body = await res.json().catch(() => ({}));
          lines.push(`info case start: HTTP ${res.status} ${body.error || ""} ${JSON.stringify(body.worker || "")}`);
          warming = body.error === "model_warming";
        }
        if (OP_TOKEN && process.env.GPU_CHECK !== "0") {
          // One GPU worker launch and stop. Without a serving model the case start already launched it
          // (model_warming); with Claude serving cases, wake it the way the patient call does.
          if (!warming) {
            const w = await api("/api/v1/voice/warm", token, { method: "POST" });
            lines.push(`info /v1/voice/warm: HTTP ${w.status} ${JSON.stringify(w.body)}`);
          }
          let w = null;
          for (let i = 0; i < 30 && !w?.instance_id; i += 1) {
            w = (await operator("/bootstrap/operator/gpu", {}, "GET")).worker;
            if (!w?.instance_id) await new Promise((ok) => setTimeout(ok, 10_000));
          }
          lines.push(check(Boolean(w?.instance_id), `GPU worker launched: ${w?.instance_id} ${w?.instance_type} ${w?.region} ${w?.status}`));
          const stop = await operator("/bootstrap/operator/gpu/stop");
          lines.push(check(stop.terminated?.instance_id === w?.instance_id, `GPU worker stop requested: ${stop.terminated?.instance_id} ${stop.terminated?.status}`));
        }
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
if (OP_TOKEN && process.env.FINALIZE === "1") {
  const reset = await operator("/bootstrap/operator/reset-accounts");
  console.log(`accounts reset to fresh temporary passwords: ${reset.accounts.map((a) => a.username).join(", ")}`);
  const final = await operator("/bootstrap/operator/mint-code", { ttl_hours: 72 });
  console.log(`final retrieval code (single use, 72 h): ${final.code}`);
}
process.exit(failures === 0 ? 0 : 1);
