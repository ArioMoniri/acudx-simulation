// Live patient video capture (docs/architecture/18 section 6.3, docs/media/live-avatar/).
//
// Drives the real app against a real gateway with a running GPU worker: creates a local
// profile, opens the encounter, waits for the PatientCallTile to switch to the live
// WebRTC video (LiveTalking + MuseTalk 1.5 on the worker, the case portrait as the face),
// turns voice on, types a question, and records what the learner sees and hears:
//   frames/*.png           tile screenshots while the patient answers
//   patient-live.mp4       the remote WebRTC stream itself (video + the patient voice)
//   encounter-page.mp4     the whole page as the learner sees it (Playwright video, no audio)
//   metrics.json           first frame, answer, speech start, audio-to-lip lag, TTS provider
//
// usage (vite dev server proxying /api to the gateway must be running):
//   BASE_URL=http://localhost:4183 OUT=../docs/media/live-avatar node e2e/capture/live-avatar.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const BASE = process.env.BASE_URL ?? "http://localhost:4183";
const OUT = path.resolve(process.env.OUT ?? "../docs/media/live-avatar");
const QUESTION = process.env.QUESTION ?? "When did the pain start, and where do you feel it?";
fs.mkdirSync(path.join(OUT, "frames"), { recursive: true });
const tmpVideo = fs.mkdtempSync("/tmp/acudx-live-avatar-");

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream"],
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: tmpVideo, size: { width: 1280, height: 800 } },
});
const page = await context.newPage();
const log = [];
page.on("console", (m) => log.push(`[${m.type()}] ${m.text()}`));
const t = (label) => {
  const line = `${new Date().toISOString()} ${label}`;
  log.push(line);
  console.log(line);
};

// 1. Profile through the real onboarding UI.
await page.goto(`${BASE}/signin`);
await page.getByRole("button", { name: "Create your profile" }).click();
await page.getByLabel("Full name").fill("Live Avatar Capture");
await page.getByLabel("Role", { exact: true }).selectOption("student");
await page.getByLabel("Institution").fill("AcuDx Live Video Check");
await page.getByRole("button", { name: "Create profile" }).click();
await page.locator("main#main").waitFor();

// 2. Encounter -> Interview.
await page.goto(`${BASE}/encounter`);
const strip = page.getByRole("tablist", { name: "Chart sections" });
const useTemplate = page.getByRole("button", { name: /^Use template case/ });
await strip.or(useTemplate).first().waitFor({ timeout: 60_000 });
if (await useTemplate.isVisible()) await useTemplate.click();
await strip.waitFor();
await page.getByRole("tab", { name: /Interview/ }).first().click();
const tile = page.locator('section[aria-label="Patient call"]');
await tile.waitFor();
t("tile visible");

// 3. Wait for the live WebRTC video (the tile measures the first frame itself).
await page.locator('section[aria-label="Patient call"][data-call-mode="webrtc"]').waitFor({ timeout: 240_000 });
await page.waitForFunction(() => window.__acudxAvatarCall?.metrics?.firstFrameMs != null, null, { timeout: 60_000 });
t("live video connected");
await tile.screenshot({ path: path.join(OUT, "frames", "00-live-idle.png") });
const video = page.locator('[data-testid="patient-live-video"]');
await video.screenshot({ path: path.join(OUT, "frames", "00-video-idle.png") });

// Voice on (the patient line is spoken into the runner only when voice is on).
const voiceBtn = tile.getByRole("button", { name: /Voice (on|off)/ });
if ((await voiceBtn.getAttribute("aria-pressed")) !== "true") await voiceBtn.click();

// 4. Record the remote stream (video + audio) in the page.
await page.evaluate(() => {
  const v = document.querySelector('[data-testid="patient-live-video"]');
  const stream = v.srcObject;
  const rec = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8,opus" });
  window.__rec = { rec, chunks: [] };
  rec.ondataavailable = (e) => e.data.size && window.__rec.chunks.push(e.data);
  rec.start(250);
});

// 5. Ask a typed question; the reply is spoken by the gateway TTS into the runner.
const composer = page.getByPlaceholder("Type a question to the patient, then press Enter");
await composer.fill(QUESTION);
const askedAt = Date.now();
await composer.press("Enter");
t("question sent");
for (let i = 1; i <= 28; i++) {
  await page.waitForTimeout(450);
  await video.screenshot({ path: path.join(OUT, "frames", `${String(i).padStart(2, "0")}-video.png`) });
  if (i % 7 === 0) await tile.screenshot({ path: path.join(OUT, "frames", `${String(i).padStart(2, "0")}-tile.png`) });
}
t("frames captured");
await page.waitForFunction(() => window.__acudxAvatarCall?.metrics?.lipLagMs != null, null, { timeout: 90_000 })
  .catch(() => t("lip lag not computed in time"));
const metrics = await page.evaluate(() => ({ ...window.__acudxAvatarCall.metrics,
  samples: window.__acudxAvatarCall.samples.length }));
const caption = await tile.getByRole("log", { name: "Live captions" }).innerText().catch(() => "");
const provenance = await tile.locator("p").last().innerText().catch(() => "");
await page.waitForTimeout(1500);

t("metrics " + JSON.stringify(metrics));
// 6. Save the remote stream recording.
const webm = await page.evaluate(async () => {
  const { rec, chunks } = window.__rec;
  await new Promise((r) => { rec.onstop = r; rec.stop(); });
  const blob = new Blob(chunks, { type: "video/webm" });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
});
t("recording saved");
const webmPath = path.join(tmpVideo, "patient-live.webm");
fs.writeFileSync(webmPath, Buffer.from(webm, "base64"));
const pageVideo = await page.video().path();
await context.close();
await browser.close();

execFileSync("ffmpeg", ["-y", "-v", "error", "-i", webmPath, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
  "-movflags", "+faststart", path.join(OUT, "patient-live.mp4")]);
execFileSync("ffmpeg", ["-y", "-v", "error", "-i", pageVideo, "-c:v", "libx264", "-pix_fmt", "yuv420p",
  "-movflags", "+faststart", path.join(OUT, "encounter-page.mp4")]);

const out = { captured_at: new Date().toISOString(), base_url: BASE, question: QUESTION, metrics, caption,
  provenance, reply_wait_ms: Date.now() - askedAt, log: log.slice(-60) };
fs.writeFileSync(path.join(OUT, "metrics.json"), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify({ metrics, caption, provenance }, null, 2));
