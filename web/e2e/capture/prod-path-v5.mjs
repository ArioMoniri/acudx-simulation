// Production-path patient video, fifth pass (docs/architecture/18 6.3.13; docs/media/live-avatar/prod-path-v5/).
// prod-path-v4.mjs on the production network path and with the numbers the A100 40 GB pass needs:
//   - TURN over TLS on 443 only (TURN_TLS_ONLY, default on): the session's ICE servers keep only
//     turns:turn.<worker>:443; Chromium maps turn.<worker> to the local end of a byte pipe
//     (scripts/turn_ws_tunnel.py --url wss://<worker>/avatar/turn?via=tls), so the browser's own TLS
//     session reaches coturn's TLS listener through the worker's 443 router, certificate verified;
//   - the voice click -> live video timeline: every /api/v1/voice request (start, end) after the click,
//     the session's prepare breakdown and the first decoded frame;
//   - per line: the runner's per-call numbers sampled every second while the line plays (inference fps,
//     sent fps, underruns, sender queue), the browser's jitter-buffer delays, the video delay the
//     closed loop set, as well as speech start, lip offset and score and the gateway's hop timings.
//
// usage (vite dev server proxying /api to the gateway; the TLS tunnel running on HARNESS_TURN_PORT):
//   BASE_URL=http://127.0.0.1:4211 LANG_UI=tr OUT=../docs/media/live-avatar/prod-path-v5/tr \
//   WORKER_ORIGIN=https://<worker> WORKER_TOKEN=... HARNESS_TURN_PORT=3501 node e2e/capture/prod-path-v5.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:4189";
const LANG = process.env.LANG_UI === "tr" ? "tr" : "en";
const OUT = path.resolve(process.env.OUT ?? `../docs/media/live-avatar/prod-path-v5/${LANG}`);
const VOICE_DELAY_MS = Number(process.env.VOICE_DELAY_MS ?? 0);
const OVERLAP = process.env.OVERLAP === "1";
const CROSSFADE = process.env.CROSSFADE === "1";
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
// QUESTIONS (a JSON array) replaces the questions, e.g. a medicines question first for the history-layer worst case.
if (process.env.QUESTIONS) UI.questions = JSON.parse(process.env.QUESTIONS);
fs.mkdirSync(path.join(OUT, "crossfade"), { recursive: true });

const TLS_ONLY = process.env.TURN_TLS_ONLY !== "0";
const TURN_PORT = process.env.HARNESS_TURN_PORT ?? "";
const TURN_HOST = WORKER ? `turn.${new URL(WORKER).hostname}` : "";
// No proxy: the browser stands for a learner's machine on an ordinary network (Chromium would otherwise
// carry TURN over TCP and TLS through the environment's HTTPS proxy).
const args = ["--autoplay-policy=no-user-gesture-required", "--no-proxy-server"]; // watchdog: allow Chromium flag names
if (TLS_ONLY && TURN_HOST) args.push(`--host-resolver-rules=MAP ${TURN_HOST} 127.0.0.1`);
const browser = await chromium.launch({ args });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const log = [];
const t = (label) => {
  const line = `${new Date().toISOString()} ${label}`;
  log.push(line);
  console.log(line);
};
const interviewReplies = [];
let sessionReply = null;
let ident = "";
let clickAt = null;
const voiceRequests = [];
page.on("request", (r) => {
  const h = r.headers()["x-user-id"];
  if (h && r.url().includes("/api/")) ident = h;
  if (clickAt != null && /\/api\/v1\/voice\//.test(r.url()) && voiceRequests.length < 200) {
    voiceRequests.push({ url: r.url().replace(/^.*\/api/, "").slice(0, 80), method: r.method(), start_ms: Date.now() - clickAt, req: r });
  }
});
page.on("requestfinished", (r) => {
  const row = voiceRequests.find((x) => x.req === r);
  if (row && clickAt != null) row.end_ms = Date.now() - clickAt;
});
if (TLS_ONLY) {
  // TURN over TLS on 443 only: keep the gateway's credentials and drop the UDP / TCP 3478 URLs.
  await page.route("**/api/v1/voice/avatar/session", async (route) => {
    const res = await route.fetch({ timeout: 240_000 });
    let body = await res.text();
    try {
      const j = JSON.parse(body);
      if (Array.isArray(j.ice_servers)) {
        j.ice_servers = j.ice_servers.map((s) => ({ ...s, urls: [].concat(s.urls).filter((u) => u.startsWith("turns:"))
          .map((u) => (TURN_PORT ? u.replace(":443?", `:${TURN_PORT}?`) : u)) }));
        body = JSON.stringify(j);
        t(`ice servers for the browser: ${JSON.stringify(j.ice_servers.map((s) => s.urls))}`);
      }
    } catch { /* not JSON */ }
    await route.fulfill({ response: res, body });
  });
}
page.on("response", async (r) => {
  if (r.request().method() === "POST" && /\/v1\/voice\/avatar\/session$/.test(r.url())) {
    try {
      const b = await r.json();
      if (b.session_id) sessionReply = { at: Date.now(), prepare_ms: b.prepare_ms, prepare: b.prepare,
        appearance: b.appearance ? { source: b.appearance.source, reason: b.appearance.reason,
          current_key: b.appearance.current_key } : null, worker: b.worker };
    } catch {
      /* not JSON */
    }
  }
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
await page.getByLabel("Full name").fill("Prod Path V5 Capture");
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
if (VOICE_DELAY_MS > 0) await page.waitForTimeout(VOICE_DELAY_MS);
const callStartClick = Date.now();
clickAt = callStartClick;
const voiceBtn = tile.getByRole("button", { name: UI.voice });
if ((await voiceBtn.getAttribute("aria-pressed")) !== "true") await voiceBtn.click();
await page.locator(`section[aria-label="${UI.tile}"][data-call-mode="webrtc"]`).waitFor({ timeout: 600_000 });
await page.waitForFunction(() => window.__acudxAvatarCall?.metrics?.firstFrameMs != null, null, { timeout: 120_000 });
const liveAfterMs = Date.now() - callStartClick;
t(`live video connected ${liveAfterMs} ms after the voice click; session ${JSON.stringify(sessionReply)}`);
const clickTimeline = voiceRequests.map(({ req, ...x }) => x);
t(`click timeline ${JSON.stringify(clickTimeline)}`);
clickAt = null;
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

async function runnerHealth() {
  const r = await fetch(`${WORKER}/avatar/health`, { headers: { Authorization: `Bearer ${WTOKEN}` } });
  return r.json();
}
// Runner numbers sampled every second while a line plays.
function sampleRunner() {
  const rows = [];
  let stop = false;
  const loop = (async () => {
    while (!stop && WORKER && WTOKEN) {
      try {
        const h = await runnerHealth();
        const c = (h.calls ?? [])[0] ?? {};
        rows.push({ t: Date.now(), infer_fps: c.infer_fps, out_fps: c.out_fps, underruns: c.underruns,
          sender_queue: c.sender_queue, speaking: c.speaking, av_shift_ms: c.tuning?.av_shift_ms, sync: c.sync ?? null,
          gpu_free_mb: h.gpu?.free_mb });
      } catch { /* the next sample */ }
      await new Promise((r) => setTimeout(r, 1000));
    }
  })();
  return async () => { stop = true; await loop; return rows; };
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
  const stopSampler = sampleRunner();
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
  const runnerRows = await stopSampler();
  const lineRtc = await page.evaluate(() => window.__acudxAvatarCall.stats()).catch(() => null);
  const speakingRows = runnerRows.filter((r) => r.speaking);
  const minOf = (k) => { const v = speakingRows.map((r) => r[k]).filter((x) => typeof x === "number"); return v.length ? Math.min(...v) : null; };
  const reply = interviewReplies.at(-1) ?? null;
  const m = await callMetrics();
  const turn = (m.voiced_turns ?? []).at(-1) ?? null;
  const row = { line: i + 1, question: q, reply: reply?.reply, via: measure?.via, speech_start_ms: measure?.speechStartMs,
    lip_lag_ms: measure?.lipLagMs, lip_score: measure?.lipScore, voice_ms: measure?.voiceMs,
    av_shift_ms_after: m.av_shift_ms, reply_http_ms: reply ? reply.at - sentAt : null,
    speculative: reply?.meta?.speculative ?? null, gateway_timings: reply?.meta?.timings ?? null,
    history: reply?.meta?.history ?? null,
    voiced_turn: turn ? { timings: turn.timings, requests: turn.requests, runner: turn.runner, error: turn.error } : null,
    runner_while_speaking: { min_infer_fps: minOf("infer_fps"), min_out_fps: minOf("out_fps"),
      underruns: runnerRows.length ? [runnerRows[0].underruns, runnerRows.at(-1).underruns] : null, samples: runnerRows },
    rtc_jitter_ms: lineRtc ? { audio: lineRtc.audioJitterMs, video: lineRtc.videoJitterMs, path: lineRtc.path } : null,
    lip_lags: (m.lip_lags ?? []).slice(-1), receiver_lags: (m.receiver_lags ?? []).slice(-8), lip_bias_ms: m.lip_bias_ms ?? null,
    receiver_lag_now_ms: await page.evaluate(() => window.__acudxAvatarCall.metrics.receiverLagMs ?? null) };
  lines.push(row);
  t(`line ${i + 1}: ${JSON.stringify({ s: row.speech_start_ms, lag: row.lip_lag_ms, score: row.lip_score, shift: row.av_shift_ms_after,
    fps: row.runner_while_speaking.min_out_fps, inf: row.runner_while_speaking.min_infer_fps, jit: row.rtc_jitter_ms })}`);
  await page.waitForTimeout(1500);
}

// 2b. A question asked while the previous reply still plays.
const overlap = [];
if (OVERLAP) {
  const extra = LANG === "tr"
    ? ["Ağrı kola ya da sırta yayılıyor mu, nefes darlığınız var mı?", "Peki ailenizde kalp hastalığı olan var mı?"]
    : ["Does the pain spread to your arm or back, and are you short of breath?", "Does anyone in your family have heart disease?"];
  const before = await page.evaluate(() => window.__acudxAvatarCall.lines.length);
  const turnsBefore = ((await callMetrics()).voiced_turns ?? []).length;
  await composer.fill(extra[0]);
  await composer.press("Enter");
  t("overlap: first question sent");
  await page.waitForFunction((n) => {
    const l = window.__acudxAvatarCall.lines;
    return l.length > n && l.at(-1).speechStartMs != null;
  }, before, { timeout: 120_000 }).catch(() => undefined);
  await page.waitForTimeout(1500);              // the patient is mid-reply
  const sentAt = Date.now();
  await composer.fill(extra[1]);
  await composer.press("Enter");
  t("overlap: second question sent while the first reply plays");
  for (let k = 0; k < 150; k++) {
    if (((await callMetrics()).voiced_turns ?? []).length >= turnsBefore + 2) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(4000);
  const m = await callMetrics();
  const turns = (m.voiced_turns ?? []).slice(turnsBefore);
  overlap.push({ second_sent_ms_after_first_speech: 1500, turns: turns.map((x) => ({ cut: x.cut, cut_previous: x.cut_previous,
    timings: x.timings, spoken_text: x.spoken_text })), lip_lags_after: (m.lip_lags ?? []).slice(-3),
    av_shift_ms: m.av_shift_ms, second_reply_http_ms: (interviewReplies.at(-1)?.at ?? sentAt) - sentAt });
  t(`overlap: ${JSON.stringify(overlap[0].turns.map((x) => [x.cut, x.cut_previous]))}`);
  // One clean line after the cut: its lips must be in sync again.
  await page.waitForTimeout(3000);
  const b2 = await page.evaluate(() => window.__acudxAvatarCall.lines.length);
  await composer.fill(UI.questions[5]);
  await composer.press("Enter");
  await page.waitForFunction((n) => {
    const l = window.__acudxAvatarCall.lines;
    return l.length > n && l.at(-1).lipLagMs != null;
  }, b2, { timeout: 150_000 }).catch(() => t("overlap: no lip measure after the cut"));
  const after = await page.evaluate(() => window.__acudxAvatarCall.lines.at(-1));
  overlap.push({ clean_line_after_cut: { speech_start_ms: after?.speechStartMs, lip_lag_ms: after?.lipLagMs,
    lip_score: after?.lipScore } });
  t(`overlap: clean line after the cut ${JSON.stringify(overlap[1])}`);
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
for (let k = 0; CROSSFADE && k < 60 && !(appearance?.appearance?.variants ?? []).some((v) => v.status === "ready"); k++) {
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
if (CROSSFADE && WORKER && WTOKEN && variants.length) {
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
const out = { captured_at: new Date().toISOString(), base_url: BASE, lang: LANG, voice_delay_ms: VOICE_DELAY_MS,
  live_after_voice_click_ms: liveAfterMs, click_timeline: clickTimeline, session: sessionReply, overlap,
  first_frame_ms: await page.evaluate(() => window.__acudxAvatarCall.metrics.firstFrameMs), lines, fades,
  registration: variants.map((v) => ({ name: v.name, avatar_id: v.avatar_id, registration: v.registration })),
  call_metrics: { av_shift_ms: finalMetrics.av_shift_ms, lip_lags: finalMetrics.lip_lags, preroll: finalMetrics.preroll,
    answer_ms: finalMetrics.answer_ms, prepare_ms: finalMetrics.prepare_ms },
  runner_call: runner?.calls ?? null, rtc, log: log.slice(-80) };
fs.writeFileSync(path.join(OUT, "metrics.json"), JSON.stringify(out, null, 2) + "\n");
await context.close();
await browser.close();
console.log(JSON.stringify(lines.map((l) => [l.line, l.speech_start_ms, l.lip_lag_ms, l.lip_score]), null, 0));
