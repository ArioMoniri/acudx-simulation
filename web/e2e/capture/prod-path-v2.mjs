// Production-path patient video, second pass (docs/architecture/18 6.3.9, 6.6.1, 6.8;
// docs/media/live-avatar/prod-path-v2/). Drives the real app against a real gateway (Claude as the
// persona) with a real GPU worker and measures, per spoken line:
//   - speech start: the question sent -> the patient's first audible sample in the page;
//   - the hop breakdown the gateway timed (guard, persona first text, first clause, TTS first chunk,
//     runner), from the interview reply's meta.timings and the call's /metrics;
//   - audio-to-lip offset and its correlation score (the tile's whole-line meter), and whether the
//     closed loop moved the runner's video delay;
// then switches the call between the case portrait and a registered edit while recording frames
// (frames around each cross-fade, and a switch requested mid-sentence that must wait for silence).
//
// usage (vite dev server proxying /api to the gateway; the TURN tunnel running):
//   BASE_URL=http://127.0.0.1:4187 LANG_UI=tr OUT=../docs/media/live-avatar/prod-path-v2/tr \
//   WORKER_ORIGIN=https://<worker> WORKER_TOKEN=... node e2e/capture/prod-path-v2.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:4187";
const LANG = process.env.LANG_UI === "tr" ? "tr" : "en";
const OUT = path.resolve(process.env.OUT ?? `../docs/media/live-avatar/prod-path-v2/${LANG}`);
const WORKER = process.env.WORKER_ORIGIN ?? "";
const WTOKEN = process.env.WORKER_TOKEN ?? "";
const LINES = Number(process.env.LINES ?? 6);
const UI = {
  en: { nav: "Chart sections", interview: /Interview/, tile: "Patient call", voice: /Voice (on|off)/,
    composer: "Type a question to the patient, then press Enter",
    questions: ["When did this start, and where exactly do you feel it?", "What does it feel like, sharp, dull or pressing?",
      "Does anything make it better or worse?", "Have you had anything like this before?",
      "Do you take any medicines regularly, and do you have allergies?", "How are you feeling right now, compared to when you arrived?"] },
  tr: { nav: "Kart bölümleri", interview: /Anamnez/, tile: "Hasta görüşmesi", voice: /Ses (açık|kapalı)$/,
    composer: "Hastaya bir soru yazın, ardından Enter'a basın",
    questions: ["Şikayetiniz ne zaman başladı ve nerenizde hissediyorsunuz?", "Ağrınız nasıl bir ağrı, batıcı mı, sıkıştırıcı mı?",
      "Ağrınızı artıran ya da azaltan bir şey var mı?", "Daha önce böyle bir şey yaşadınız mı?",
      "Düzenli kullandığınız ilaç ya da alerjiniz var mı?", "Şu an kendinizi nasıl hissediyorsunuz, geldiğiniz zamana göre?"] },
}[LANG];
fs.mkdirSync(path.join(OUT, "crossfade"), { recursive: true });

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const log = [];
const t = (label) => {
  const line = `${new Date().toISOString()} ${label}`;
  log.push(line);
  console.log(line);
};
const interviewReplies = [];
let ident = "";
page.on("request", (r) => {
  const h = r.headers()["x-user-id"];
  if (h && r.url().includes("/api/")) ident = h;
});
page.on("response", async (r) => {
  if (r.request().method() === "POST" && /\/v2\/case\/[^/]+\/interview$/.test(r.url())) {
    try {
      const body = await r.json();
      interviewReplies.push({ at: Date.now(), reply: body.reply, meta: body.meta, guard: body.guard });
    } catch {
      /* not JSON */
    }
  }
});

// 1. Profile, language, encounter (model-authored case: the interview is server-held, so it can be voiced).
await page.goto(`${BASE}/signin`);
await page.getByRole("button", { name: "Create your profile" }).click();
await page.getByLabel("Full name").fill("Prod Path V2 Capture");
await page.getByLabel("Role", { exact: true }).selectOption("student");
await page.getByLabel("Institution").fill("AcuDx Live Video Check");
await page.getByRole("button", { name: "Create profile" }).click();
await page.locator("main#main").waitFor();
await page.evaluate((lng) => localStorage.setItem("acudx-lang", lng), LANG);
await page.goto(`${BASE}/encounter`);
const strip = page.getByRole("tablist", { name: UI.nav });
await strip.waitFor({ timeout: Number(process.env.CASE_TIMEOUT_MS ?? 420_000) });
t("case open");
await page.getByRole("tab", { name: UI.interview }).first().click();
const tile = page.locator(`section[aria-label="${UI.tile}"]`);
await tile.waitFor();
const callStartClick = Date.now();
const voiceBtn = tile.getByRole("button", { name: UI.voice });
if ((await voiceBtn.getAttribute("aria-pressed")) !== "true") await voiceBtn.click();
await page.locator(`section[aria-label="${UI.tile}"][data-call-mode="webrtc"]`).waitFor({ timeout: 600_000 });
await page.waitForFunction(() => window.__acudxAvatarCall?.metrics?.firstFrameMs != null, null, { timeout: 120_000 });
const liveAfterMs = Date.now() - callStartClick;
t(`live video connected ${liveAfterMs} ms after the voice click`);
const sessionId = await page.evaluate(() => window.__acudxAvatarCall.session.session_id);
const video = page.locator('[data-testid="patient-live-video"]');
await video.screenshot({ path: path.join(OUT, "00-live-idle.png") });
await page.waitForTimeout(2000);

async function callInfo() {
  return page.evaluate(async ([sid, who]) => {
    const r = await fetch(`/api/v1/voice/avatar/metrics?session_id=${encodeURIComponent(sid)}`, { headers: { "X-User-Id": who } });
    return r.ok ? r.json() : { status: r.status, metrics: {} };
  }, [sessionId, ident]);
}
async function callMetrics() {
  return (await callInfo()).metrics ?? {};
}

// 2. The lines.
const composer = page.getByPlaceholder(UI.composer); // watchdog: allow Playwright locator API name
const lines = [];
for (let i = 0; i < Math.min(LINES, UI.questions.length); i++) {
  const q = UI.questions[i];
  const before = await page.evaluate(() => window.__acudxAvatarCall.lines.length);
  const turnsBefore = ((await callMetrics()).voiced_turns ?? []).length;
  await composer.fill(q);
  const sentAt = Date.now();
  await composer.press("Enter");
  t(`line ${i + 1} sent`);
  await page.waitForFunction((n) => {
    const l = window.__acudxAvatarCall.lines;
    return l.length > n && l[l.length - 1].lipLagMs != null;
  }, before, { timeout: 150_000 }).catch(() => t(`line ${i + 1}: no lip measure in time`));
  // The whole reply has gone to the runner (the gateway's voiced turn is done) and played out.
  for (let k = 0; k < 120; k++) {
    if (((await callMetrics()).voiced_turns ?? []).length > turnsBefore) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForFunction((n) => window.__acudxAvatarCall.lines.length > n
    && window.__acudxAvatarCall.lines.at(-1).lipLagMs != null, before, { timeout: 60_000 }).catch(() => undefined);
  const measure = await page.evaluate(() => window.__acudxAvatarCall.lines.at(-1));
  const reply = interviewReplies.at(-1) ?? null;
  const m = await callMetrics();
  const turn = (m.voiced_turns ?? []).at(-1) ?? null;
  const row = { line: i + 1, question: q, reply: reply?.reply, via: measure?.via, speech_start_ms: measure?.speechStartMs,
    lip_lag_ms: measure?.lipLagMs, lip_score: measure?.lipScore, voice_ms: measure?.voiceMs,
    av_shift_ms_after: m.av_shift_ms, reply_http_ms: reply ? reply.at - sentAt : null,
    speculative: reply?.meta?.speculative ?? null, gateway_timings: reply?.meta?.timings ?? null,
    voiced_turn: turn ? { timings: turn.timings, requests: turn.requests, runner: turn.runner, error: turn.error } : null };
  lines.push(row);
  t(`line ${i + 1}: ${JSON.stringify({ s: row.speech_start_ms, lag: row.lip_lag_ms, score: row.lip_score, via: row.via })}`);
  await page.waitForTimeout(1500);
}

// 3. Cross-fades between the case portrait and a registered edit (direct runner switch, the same call
//    the Director sync makes), frames recorded around each.
async function recordFrames(ms) {
  return page.evaluate(async (dur) => {
    const v = document.querySelector('[data-testid="patient-live-video"]');
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const g = c.getContext("2d");
    const out = [];
    const t0 = performance.now();
    await new Promise((resolve) => {
      const tick = () => {
        g.drawImage(v, 0, 0);
        out.push({ t: Math.round(performance.now() - t0), png: c.toDataURL("image/png") });
        if (performance.now() - t0 < dur) v.requestVideoFrameCallback(tick);
        else resolve();
      };
      v.requestVideoFrameCallback(tick);
    });
    return out;
  }, ms);
}
const readAppearance = () => page.evaluate(async ([sid, who]) => {
  const r = await fetch(`/api/v1/voice/avatar/appearance?session_id=${encodeURIComponent(sid)}`, { headers: { "X-User-Id": who } });
  return r.ok ? r.json() : null;
}, [sessionId, ident]);
let appearance = await readAppearance();
for (let k = 0; k < 60 && !(appearance?.appearance?.variants ?? []).some((v) => v.status === "ready"); k++) {
  await page.waitForTimeout(5000);
  appearance = await readAppearance();
}
t(`variants ready: ${(appearance?.appearance?.variants ?? []).filter((v) => v.status === "ready").length}`);
const variants = (appearance?.appearance?.variants ?? []).filter((v) => v.status === "ready");
const fades = [];
async function runnerSwitch(avatar, sid) {
  const r = await fetch(`${WORKER}/avatar/switch`, { method: "POST",
    headers: { Authorization: `Bearer ${WTOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sessionid: sid, avatar, crossfade_ms: 900 }) });
  return r.json();
}
async function runnerHealth() {
  const r = await fetch(`${WORKER}/avatar/health`, { headers: { Authorization: `Bearer ${WTOKEN}` } });
  return r.json();
}
if (WORKER && WTOKEN && variants.length) {
  const h = await runnerHealth();
  const call = (h.calls ?? [])[0];
  const sid = (await callInfo()).worker_session ?? null;
  // From the picture on screen to another prepared picture of the same patient, and back.
  const target = variants.find((v) => v.avatar_id !== call?.avatar)?.avatar_id ?? variants[0].avatar_id;
  const back = call?.avatar ?? null;
  for (const [k, to] of [[1, target], [2, back]]) {
    if (!to || !sid) break;
    const rec = recordFrames(2600);
    await page.waitForTimeout(400);
    const sw = await runnerSwitch(to, sid);
    const frames = await rec;
    const dir = path.join(OUT, "crossfade", `switch-${k}`);
    fs.mkdirSync(dir, { recursive: true });
    frames.forEach((f, i) => fs.writeFileSync(path.join(dir, `${String(i).padStart(3, "0")}-${f.t}ms.png`),
      Buffer.from(f.png.split(",")[1], "base64")));
    fades.push({ switch: k, to, reply: sw, frames: frames.length });
    t(`switch ${k} -> ${to}: ${JSON.stringify(sw)} (${frames.length} frames)`);
    await page.waitForTimeout(1500);
  }
  // A switch requested while the patient speaks waits for silence (never mid-word).
  if (back && target && sid) {
    await composer.fill(UI.questions[0]);
    await composer.press("Enter");
    await page.waitForFunction(() => {
      const l = window.__acudxAvatarCall.lines.at(-1);
      return l && l.speechStartMs != null;
    }, null, { timeout: 120_000 }).catch(() => undefined);
    await page.waitForTimeout(800);
    const sw = await runnerSwitch(target, sid);
    const h2 = await runnerHealth();
    fades.push({ switch: "mid-sentence", to: target, reply: sw, pending_right_after: (h2.calls ?? [])[0]?.switch_pending });
    t(`mid-sentence switch: ${JSON.stringify(sw)} pending=${(h2.calls ?? [])[0]?.switch_pending}`);
    await page.waitForFunction(() => window.__acudxAvatarCall.lines.at(-1)?.lipLagMs != null, null, { timeout: 150_000 })
      .catch(() => undefined);
    const h3 = await runnerHealth();
    fades.push({ switch: "mid-sentence-after", applied: (h3.calls ?? [])[0]?.switches_applied,
      pending: (h3.calls ?? [])[0]?.switch_pending, avatar: (h3.calls ?? [])[0]?.avatar });
  }
}

const rtc = await page.evaluate(() => window.__acudxAvatarCall.stats());
const finalMetrics = await callMetrics();
const runner = WORKER && WTOKEN ? await runnerHealth().catch(() => null) : null;
const out = { captured_at: new Date().toISOString(), base_url: BASE, lang: LANG, live_after_voice_click_ms: liveAfterMs,
  first_frame_ms: await page.evaluate(() => window.__acudxAvatarCall.metrics.firstFrameMs), lines, fades,
  registration: variants.map((v) => ({ name: v.name, avatar_id: v.avatar_id, registration: v.registration })),
  call_metrics: { av_shift_ms: finalMetrics.av_shift_ms, lip_lags: finalMetrics.lip_lags, preroll: finalMetrics.preroll,
    answer_ms: finalMetrics.answer_ms, prepare_ms: finalMetrics.prepare_ms },
  runner_call: runner?.calls ?? null, rtc, log: log.slice(-80) };
fs.writeFileSync(path.join(OUT, "metrics.json"), JSON.stringify(out, null, 2) + "\n");
await context.close();
await browser.close();
console.log(JSON.stringify(lines.map((l) => [l.line, l.speech_start_ms, l.lip_lag_ms, l.lip_score]), null, 0));
