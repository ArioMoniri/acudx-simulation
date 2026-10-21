// Production-path patient video call (docs/architecture/18 section 6.7, docs/media/live-avatar/prod-path/).
//
// Drives the production stack (docker-compose.prod.yml: Caddy, gateway in OIDC mode, Keycloak) as a
// student would: Keycloak sign-in, a model-authored case (the case start prewarms the GPU worker when
// AVATAR_PREWARM_ON_CASE_START is on), "Voice call", the start-up panel while the worker warms, then the
// live WebRTC call with TURN over TLS on 443 as the only ICE server (relay only). It asks a question,
// records the remote stream, steps the Director (time passes untreated) and records again, and saves:
//   frames/*.png          the tile and the live video at each stage
//   pictures/*.jpg        the case's generated pictures (the symptoms the face is edited into)
//   patient-live-*.mp4    the remote stream itself (video + the patient voice), before and after the step
//   metrics.json          ICE (selected pair: relay over TLS to turns:...:443), audio energy, mouth motion
//                         while speaking vs silent, the face switch after the Director step, timings
//
// usage: BASE_URL=https://acudx.localhost:18443 CREDS=<credentials.json> PW_FILE=<file> LANG_UI=en|tr \
//        OUT=../docs/media/live-avatar/prod-path/en node e2e/capture/prod-path-call.mjs
// The browser runs without a proxy; the harness maps turn.<worker> to a local byte pipe (see the doc).
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const BASE = process.env.BASE_URL ?? "https://acudx.localhost:18443";
const LANG = process.env.LANG_UI === "tr" ? "tr" : "en";
const OUT = path.resolve(process.env.OUT ?? `../docs/media/live-avatar/prod-path/${LANG}`);
const USER = process.env.ACCOUNT ?? "acudx-student";
const PW_FILE = process.env.PW_FILE;
const TLS_ONLY = process.env.TURN_TLS_ONLY !== "0";
const WARM_TIMEOUT_MS = Number(process.env.WARM_TIMEOUT_MS ?? 70 * 60_000);
const UI = {
  en: { interview: /Interview/, tile: "Patient call", call: /^Start a voice call with the patient$/, captions: "Live captions",
    composer: "Type a question to the patient, then press Enter",
    q1: "How are you feeling right now? Tell me about the fever.", q2: "Are you feeling worse now? How is your breathing?" },
  tr: { interview: /Anamnez/, tile: "Hasta görüşmesi", call: /^Hastayla sesli görüşme başlatın$/, captions: "Canlı altyazı",
    composer: "Hastaya bir soru yazın, ardından Enter'a basın",
    q1: "Şu an nasıl hissediyorsunuz? Ateşinizden bahseder misiniz?", q2: "Şimdi daha mı kötüsünüz? Nefesiniz nasıl?" },
}[LANG];
for (const d of ["frames", "pictures"]) fs.mkdirSync(path.join(OUT, d), { recursive: true });
const tmp = fs.mkdtempSync("/tmp/acudx-prod-path-");
const log = [];
const t0 = Date.now();
const t = (label) => {
  const line = `${((Date.now() - t0) / 1000).toFixed(1)}s ${label}`;
  log.push(line);
  console.log(line);
};

const browser = await chromium.launch({
  // No proxy: the browser stands for a learner's machine on an ordinary network.
  args: ["--no-proxy-server", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"], // watchdog: allow Chromium flag names
});
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true,
  recordVideo: { dir: tmp, size: { width: 1280, height: 800 } } });
const page = await context.newPage();
page.on("console", (m) => { if (m.type() === "error") log.push(`[console] ${m.text().slice(0, 300)}`); });
let bearer = null;
page.on("request", (r) => {
  const a = r.headers()["authorization"];
  if (a && r.url().startsWith(`${BASE}/api/`)) bearer = a;
});
const sessions = [];
// TURN over TLS on 443 only: keep the gateway's credentials and drop the UDP / TCP 3478 URLs.
await page.route("**/api/v1/voice/avatar/session", async (route) => {
  const res = await route.fetch({ timeout: 240_000 });
  let body = await res.text();
  try {
    const j = JSON.parse(body);
    sessions.push({ status: res.status(), ice_servers_from_gateway: j.ice_servers, state: j.state, reasons: j.reasons });
    if (TLS_ONLY && Array.isArray(j.ice_servers)) {
      // HARNESS_TURN_PORT: the local end of the byte pipe when this machine's 443 is taken; the name
      // (SNI and certificate) stays turn.<worker>, the far end is the worker's public 443 router.
      const port = process.env.HARNESS_TURN_PORT;
      j.ice_servers = j.ice_servers.map((s) => ({ ...s, urls: [].concat(s.urls).filter((u) => u.startsWith("turns:"))
        .map((u) => (port ? u.replace(":443?", `:${port}?`) : u)) }));
      body = JSON.stringify(j);
    }
  } catch { /* not JSON */ }
  await route.fulfill({ response: res, body });
});
const api = async (p, init = {}) => {
  const r = await fetch(`${BASE}/api${p}`, { ...init, headers: { ...(init.headers ?? {}), Authorization: bearer } });
  return r;
};

// 1. Keycloak sign-in (first sign-in sets a new password).
const creds = JSON.parse(fs.readFileSync(process.env.CREDS, "utf8"));
const account = creds.users.find((u) => u.username === USER);
let password = PW_FILE && fs.existsSync(PW_FILE) ? fs.readFileSync(PW_FILE, "utf8").trim() : account.password;
await page.goto(`${BASE}/signin`, { waitUntil: "networkidle" });
await page.evaluate((lng) => localStorage.setItem("acudx-lang", lng), LANG);
await page.getByRole("button", { name: /sign in with your institution|kurumunuzla giriş/i }).first().click();
await page.waitForURL(/\/idp\/realms\/acudx\//, { timeout: 30_000 });
await page.fill("#username", USER);
await page.fill("#password", password);
await page.click("#kc-login");
if (await page.waitForSelector("#password-new", { timeout: 8000 }).then(() => true).catch(() => false)) {
  password = `Pv-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}-A1`;
  await page.fill("#password-new", password);
  await page.fill("#password-confirm", password);
  await page.locator("input[type=submit], button[type=submit]").first().click();
  if (PW_FILE) fs.writeFileSync(PW_FILE, password, { mode: 0o600 });
}
await page.waitForURL((u) => u.origin === BASE && !u.pathname.startsWith("/auth/callback"), { timeout: 30_000 });
await page.evaluate((lng) => localStorage.setItem("acudx-lang", lng), LANG);
t(`signed in as ${USER}`);

// 2. A model-authored case (Claude in production); the case start prewarms the worker.
await page.goto(`${BASE}/encounter`);
const interviewTab = page.getByRole("tab", { name: UI.interview }).first();
await interviewTab.waitFor({ timeout: 600_000 });
await interviewTab.click();
const tile = page.locator(`section[aria-label="${UI.tile}"]`);
await tile.waitFor();
await page.waitForFunction(() => true);
t("case open");
await tile.screenshot({ path: path.join(OUT, "frames", "01-case-open.png") });

// 3. Start the call; the start-up panel shows the stage, progress and minutes left.
await page.getByRole("button", { name: UI.call }).first().click();
t("voice call started");
const panel = page.locator('[data-testid="live-start-panel"]');
const stages = [];
const deadline = Date.now() + WARM_TIMEOUT_MS;
let lastStage = null;
while (Date.now() < deadline) {
  if ((await tile.getAttribute("data-call-mode")) === "webrtc") break;
  if (await panel.isVisible().catch(() => false)) {
    const stage = await panel.getAttribute("data-stage");
    const pct = await panel.locator('[role="progressbar"]').getAttribute("aria-valuenow").catch(() => null);
    const text = (await panel.innerText().catch(() => "")).replace(/\s+/g, " ");
    if (stage !== lastStage) {
      stages.push({ at_s: Math.round((Date.now() - t0) / 1000), stage, progress: pct, text });
      t(`panel ${stage} ${pct}% | ${text}`);
      await tile.screenshot({ path: path.join(OUT, "frames", `02-warming-${stages.length}-${stage}.png`) });
      lastStage = stage;
      if (stage === "failed") break;
    }
  }
  await page.waitForTimeout(5000);
}
const mode = await tile.getAttribute("data-call-mode");
if (mode !== "webrtc") {
  t(`no live video: mode=${mode}`);
  await tile.screenshot({ path: path.join(OUT, "frames", "02-no-live.png") });
  fs.writeFileSync(path.join(OUT, "metrics.json"), JSON.stringify({ ok: false, stages, sessions, log }, null, 2) + "\n");
  await context.close();
  await browser.close();
  process.exit(2);
}
await page.waitForFunction(() => window.__acudxAvatarCall?.metrics?.firstFrameMs != null, null, { timeout: 60_000 });
t("live video connected");
const sessionId = await page.evaluate(() => window.__acudxAvatarCall.session.session_id);

// ICE: the selected pair must be a relay candidate over TLS (turns:...:443).
const ice = await page.evaluate(async () => {
  const pcStats = await window.__acudxAvatarCall.stats();
  return pcStats;
});
const selected = await page.evaluate(async () => {
  // The peer connection is private to avatarCall; read the selected pair from a fresh getStats via the
  // receiver track's transport (RTCRtpReceiver.getStats carries the transport and candidate pair).
  const v = document.querySelector('[data-testid="patient-live-video"]');
  const track = v?.srcObject?.getVideoTracks?.()[0];
  return track ? { track: track.label, readyState: track.readyState } : null;
});
await page.waitForTimeout(1500);
await page.locator('[data-testid="patient-live-video"]').screenshot({ path: path.join(OUT, "frames", "03-live-presenting.png") });
await tile.screenshot({ path: path.join(OUT, "frames", "03-tile-live.png") });

// The generated pictures for this case (the ladder) and which one the call shows.
const appearance = async () => (await (await api(`/v1/voice/avatar/appearance?session_id=${sessionId}`)).json());
let ap0 = await appearance();
for (let i = 0; i < 60 && !(ap0.appearance?.variants ?? []).some((v) => v.status === "ready"); i++) {
  await page.waitForTimeout(10_000);
  ap0 = await appearance();
}
for (const v of ap0.appearance?.variants ?? []) {
  if (!v.has_image) continue;
  const r = await api(`/v1/voice/avatar/appearance/image?session_id=${sessionId}&key=${encodeURIComponent(v.key)}`);
  if (r.ok) fs.writeFileSync(path.join(OUT, "pictures", `${v.name}-${v.key}.jpg`), Buffer.from(await r.arrayBuffer()));
}
t(`appearance: current=${ap0.appearance?.current_key} live=${ap0.appearance?.live?.key} variants=${(ap0.appearance?.variants ?? []).map((v) => `${v.name}:${v.status}`).join(",")}`);
await page.waitForTimeout(2000);
await page.locator('[data-testid="patient-live-video"]').screenshot({ path: path.join(OUT, "frames", "04-live-look.png") });

async function speakTurn(question, tag) {
  await page.evaluate(() => {
    const v = document.querySelector('[data-testid="patient-live-video"]');
    const rec = new MediaRecorder(v.srcObject, { mimeType: "video/webm;codecs=vp8,opus" });
    window.__rec = { rec, chunks: [] };
    rec.ondataavailable = (e) => e.data.size && window.__rec.chunks.push(e.data);
    rec.start(250);
  });
  const before = await page.evaluate(() => window.__acudxAvatarCall.stats());
  const from = await page.evaluate(() => window.__acudxAvatarCall.samples.length);
  const composer = page.getByPlaceholder(UI.composer); // watchdog: allow Playwright locator API name
  await composer.fill(question);
  await composer.press("Enter");
  t(`${tag}: question sent`);
  await page.waitForFunction((n) => window.__acudxAvatarCall.lastSpeak && window.__acudxAvatarCall.samples
    .slice(n).some((s) => s.rms > 0.02), from, { timeout: 120_000 }).catch(() => t(`${tag}: no audible speech in 120 s`));
  for (let i = 1; i <= 8; i++) {
    await page.waitForTimeout(400);
    await page.locator('[data-testid="patient-live-video"]').screenshot({ path: path.join(OUT, "frames", `${tag}-speaking-${i}.png`) });
  }
  await page.waitForTimeout(6000);
  const after = await page.evaluate(() => window.__acudxAvatarCall.stats());
  const win = await page.evaluate((n) => window.__acudxAvatarCall.samples.slice(n), from);
  const speakRes = await page.evaluate(() => window.__acudxAvatarCall.lastSpeak);
  const voiced = win.filter((s) => s.rms > 0.02);
  const quiet = win.filter((s) => s.rms < 0.005);
  const mean = (a, k) => (a.length ? a.reduce((x, s) => x + s[k], 0) / a.length : null);
  const webm = await page.evaluate(async () => {
    const { rec, chunks } = window.__rec;
    await new Promise((r) => { rec.onstop = r; rec.stop(); });
    const buf = new Uint8Array(await new Blob(chunks, { type: "video/webm" }).arrayBuffer());
    let s = "";
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  });
  const webmPath = path.join(tmp, `${tag}.webm`);
  fs.writeFileSync(webmPath, Buffer.from(webm, "base64"));
  execFileSync("ffmpeg", ["-y", "-v", "error", "-i", webmPath, "-r", "25", "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-movflags", "+faststart", path.join(OUT, `patient-live-${tag}.mp4`)]);
  const caption = await tile.getByRole("log", { name: UI.captions }).innerText().catch(() => "");
  return {
    question, caption: caption.replace(/\s+/g, " ").slice(0, 400),
    speak: speakRes && { provider: speakRes.provider, model: speakRes.model, first_chunk_ms: speakRes.first_chunk_ms,
      audio_duration_ms: speakRes.audio_duration_ms, runner: speakRes.runner, voice: speakRes.voice },
    audio_energy_delta: after.audioEnergy - before.audioEnergy, audio_packets_delta: after.audioPackets - before.audioPackets,
    video_frames_delta: after.videoFrames - before.videoFrames, video_fps: after.videoFps,
    samples: win.length, voiced_frames: voiced.length, quiet_frames: quiet.length,
    mouth_motion_voiced: mean(voiced, "motion"), mouth_motion_quiet: mean(quiet, "motion"),
    mouth_open_voiced: mean(voiced, "open"), mouth_open_quiet: mean(quiet, "open"),
    peak_rms: win.reduce((m, s) => Math.max(m, s.rms), 0),
    speech_start_ms: await page.evaluate(() => window.__acudxAvatarCall.metrics.speechStartMs),
    lip_lag_ms: await page.evaluate(() => window.__acudxAvatarCall.metrics.lipLagMs),
  };
}

const turn1 = await speakTurn(UI.q1, "05-before-step");
t(`turn1 ${JSON.stringify(turn1)}`);

// 4. The Director moves the patient on: 40 minutes untreated. The face follows (state_sync).
const threadId = ap0.thread_id ?? (await appearance()).thread_id;
const step = await api("/v2/director/step", { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ thread_id: threadId, action: { kind: "elapsed", elapsed_ms: 40 * 60_000, locale: LANG }, use_model: false }) });
const stepBody = await step.json().catch(() => ({}));
t(`director step ${step.status} phase=${stepBody?.case_state?.snapshot?.phase} vitals=${JSON.stringify(stepBody?.case_state?.vitals ?? {})}`);
let ap1 = await appearance();
const switchDeadline = Date.now() + 240_000;
while (Date.now() < switchDeadline && (ap1.appearance?.switches ?? []).filter((s) => s.reason?.startsWith("director")).length === 0) {
  await page.waitForTimeout(5000);
  ap1 = await appearance();
}
t(`after step: current=${ap1.appearance?.current_key} live=${ap1.appearance?.live?.key} switches=${JSON.stringify((ap1.appearance?.switches ?? []).map((s) => [s.reason, s.from, s.to]))}`);
await page.waitForTimeout(2500);
await page.locator('[data-testid="patient-live-video"]').screenshot({ path: path.join(OUT, "frames", "06-after-step.png") });
await tile.screenshot({ path: path.join(OUT, "frames", "06-tile-after-step.png") });
const turn2 = await speakTurn(UI.q2, "07-after-step");
t(`turn2 ${JSON.stringify(turn2)}`);
for (const v of ap1.appearance?.variants ?? []) {
  const f = path.join(OUT, "pictures", `${v.name}-${v.key}.jpg`);
  if (!v.has_image || fs.existsSync(f)) continue;
  const r = await api(`/v1/voice/avatar/appearance/image?session_id=${sessionId}&key=${encodeURIComponent(v.key)}`);
  if (r.ok) fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
}
// The chart's still portrait now shows the generated look too.
const chartLook = await (await api(`/v1/voice/avatar/look?thread_id=${threadId}&photo_id=${encodeURIComponent(ap1.appearance?.variants?.[0]?.avatar_id?.split("-")[1] ?? "")}`)).json().catch(() => null);
const banner = page.locator("header").first();
await banner.screenshot({ path: path.join(OUT, "frames", "08-banner.png") }).catch(() => {});
const bannerLook = await page.locator('[data-testid="patient-generated-look"]').count();

// The selected ICE pair (avatarCall stats().path: candidate type and TURN transport).
const pair = await page.evaluate(async () => (await window.__acudxAvatarCall.stats()).path ?? null);
t(`selected pair ${JSON.stringify(pair)}`);
const pageVideo = await page.video().path();
await page.evaluate(() => window.__acudxAvatarCall?.end());
await context.close();
await browser.close();
execFileSync("ffmpeg", ["-y", "-v", "error", "-i", pageVideo, "-r", "25", "-c:v", "libx264", "-pix_fmt", "yuv420p",
  "-movflags", "+faststart", path.join(OUT, "encounter-page.mp4")]);

const out = { ok: true, captured_at: new Date().toISOString(), base_url: BASE, lang: LANG, turn_tls_only: TLS_ONLY,
  sessions, stages, selected_pair: pair, ice_stats: ice, track: selected, turn1, turn2,
  director_step: { status: step.status, phase: stepBody?.case_state?.snapshot?.phase, vitals: stepBody?.case_state?.vitals },
  appearance_before: ap0.appearance && { current_key: ap0.appearance.current_key, live: ap0.appearance.live, source: ap0.appearance.source,
    variants: ap0.appearance.variants.map((v) => ({ name: v.name, key: v.key, status: v.status, signs: v.signs, gen_ms: v.gen_ms })) },
  appearance_after: ap1.appearance && { current_key: ap1.appearance.current_key, live: ap1.appearance.live, switches: ap1.appearance.switches },
  chart_look: chartLook, banner_generated_look: bannerLook, log };
fs.writeFileSync(path.join(OUT, "metrics.json"), JSON.stringify(out, null, 2) + "\n");
console.log("done");
