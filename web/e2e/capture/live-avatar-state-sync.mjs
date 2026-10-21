// Symptom-synced live patient video (docs/architecture/18 section 6.6, docs/media/live-avatar/state-sync/).
//
// One fever case end to end against a real gateway and a real GPU worker:
//   1. the case is model-authored on the worker (POST /v2/case/generate, blueprint condition);
//   2. a live call is opened bound to the case thread (POST /v1/voice/avatar/session with thread_id):
//      the gateway reads the thread from its own store, edits the case portrait into the patient's
//      presenting state with FLUX.2 klein 4B on the worker and opens the call on that face;
//   3. the patient answers (POST /v1/patient/turn with thread_id) and speaks into the call;
//   4. the state changes (POST /v2/director/step: time passes untreated, then a treatment): the
//      gateway switches the call's face, crossfaded, and restyles the voice;
//   5. frames before, during and after each switch, the remote stream (webm -> mp4), and every
//      server answer (appearance, switches, speak, vitals) go to OUT.
//
// usage: GATEWAY=http://127.0.0.1:8897 LANG_UI=en OUT=../docs/media/live-avatar/state-sync/en \
//        CONDITION=pneumonia_cap node e2e/capture/live-avatar-state-sync.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const GW = process.env.GATEWAY ?? "http://127.0.0.1:8897";
const LANG = process.env.LANG_UI === "tr" ? "tr" : "en";
const OUT = path.resolve(process.env.OUT ?? `../docs/media/live-avatar/state-sync/${LANG}`);
const CONDITION = process.env.CONDITION ?? "pneumonia_cap";
const USER = process.env.CAPTURE_USER ?? "state-sync-capture";
const HDR = { "Content-Type": "application/json", "X-User-Id": USER, "X-User-Role": "student" };
const Q = {
  en: ["How are you feeling right now?", "Tell me how you feel now.", "And now, how do you feel?"],
  tr: ["Şu an kendinizi nasıl hissediyorsunuz?", "Şimdi nasılsınız, anlatır mısınız?", "Peki şimdi nasıl hissediyorsunuz?"],
}[LANG];
// Same-sex nearest-age bundled portrait (web/src/data/patientPhotos.ts, a subset).
const PHOTOS = [
  ["p01", "female", 28], ["p03", "female", 45], ["p06", "female", 72], ["p09", "female", 51], ["p26", "female", 62],
  ["p11", "male", 30], ["p22", "male", 45], ["p04", "male", 58], ["p05", "male", 67], ["p24", "male", 72],
];
fs.mkdirSync(path.join(OUT, "frames"), { recursive: true });
const tmp = fs.mkdtempSync("/tmp/acudx-state-sync-");
const log = [];
const t = (s) => {
  const line = `${new Date().toISOString()} ${s}`;
  log.push(line);
  console.log(line);
};
async function api(p, body, method = "POST") {
  const r = await fetch(GW + p, { method, headers: HDR, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 400) };
  }
  if (!r.ok) t(`${method} ${p} -> ${r.status} ${text.slice(0, 300)}`);
  return { status: r.status, json };
}

// 1. The case (model-authored on the worker).
const g0 = Date.now();
// CASE_THREAD reuses a case this capture user generated earlier (same server-side thread).
const gen = process.env.CASE_THREAD
  ? await api(`/v2/case/${process.env.CASE_THREAD}`, null, "GET")
  : await api("/v2/case/generate", { locale: LANG, blueprint: { condition_id: CONDITION }, purpose: "encounter" });
if (gen.status !== 200) throw new Error("case generation failed");
const thread = gen.json.thread_id;
const spec = gen.json.spec ?? {};
const demo = spec.demographics ?? spec.opening?.demographics ?? {};
t(`case ${thread} ${spec.condition?.label_en ?? CONDITION} age ${demo.age} ${demo.sex} in ${Date.now() - g0} ms`);
const sex = demo.sex === "female" ? "female" : "male";
const age = Number(demo.age ?? 50);
const photo = process.env.PHOTO ??
  PHOTOS.filter((p) => p[1] === sex).sort((a, b) => Math.abs(a[2] - age) - Math.abs(b[2] - age))[0][0];
const persona = { name: demo.name_hint || (LANG === "tr" ? "Hasta" : "The patient"), age };
const caseState = { persona, narrative: [spec.chief_complaint_en ?? ""].filter(Boolean) };

// 2. The call, bound to the thread.
const s0 = Date.now();
const ses = await api("/v1/voice/avatar/session", {
  encounter_id: thread, thread_id: thread, photo_id: photo, lang: LANG, sex, age, case_state: caseState, persona,
});
if (ses.status !== 200) throw new Error("session failed: " + JSON.stringify(ses.json));
const session = ses.json;
t(`session ${session.session_id} avatar ${session.avatar_id} in ${Date.now() - s0} ms; appearance ${session.appearance?.source}`);

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
page.on("console", (m) => log.push(`[page ${m.type()}] ${m.text()}`));
await page.route(`${GW}/__capture`, (route) => route.fulfill({ contentType: "text/html", body:
  `<!doctype html><meta charset="utf-8"><title>capture</title><style>body{margin:0;background:#111}video{width:530px;height:720px;object-fit:contain}</style><video id="v" autoplay playsinline></video>` }));
await page.goto(`${GW}/__capture`);
const conn = await page.evaluate(async ({ session, hdr }) => {
  const t0 = performance.now();
  const pc = new RTCPeerConnection({ iceServers: session.ice_servers, iceTransportPolicy: session.ice_transport_policy || "relay" });
  pc.addTransceiver("video", { direction: "recvonly" });
  pc.addTransceiver("audio", { direction: "recvonly" });
  const stream = new MediaStream();
  pc.ontrack = (e) => stream.addTrack(e.track);
  const v = document.getElementById("v");
  v.srcObject = stream;
  await pc.setLocalDescription(await pc.createOffer());
  await new Promise((r) => {
    if (pc.iceGatheringState === "complete") return r();
    pc.onicegatheringstatechange = () => pc.iceGatheringState === "complete" && r();
    setTimeout(r, 8000);
  });
  const res = await fetch("/v1/voice/avatar/offer", { method: "POST", headers: hdr,
    body: JSON.stringify({ session_id: session.session_id, sdp: pc.localDescription.sdp, type: "offer" }) });
  const ans = await res.json();
  if (!res.ok) return { error: ans };
  await pc.setRemoteDescription({ type: "answer", sdp: ans.sdp });
  await new Promise((r) => {
    const tick = () => (v.readyState >= 2 && v.videoWidth ? r() : setTimeout(tick, 50));
    tick();
    setTimeout(r, 45000);
  });
  window.__pc = pc;
  const rec = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8,opus" });
  window.__rec = { rec, chunks: [] };
  rec.ondataavailable = (e) => e.data.size && window.__rec.chunks.push(e.data);
  rec.start(250);
  return { first_frame_ms: Math.round(performance.now() - t0), w: v.videoWidth, h: v.videoHeight, answer_ms: ans.answer_ms };
}, { session, hdr: HDR });
if (conn.error) throw new Error("offer failed " + JSON.stringify(conn.error));
t("connected " + JSON.stringify(conn));

let shot = 0;
async function frame(tag) {
  shot += 1;
  const name = `${String(shot).padStart(2, "0")}-${tag}.png`;
  await page.locator("#v").screenshot({ path: path.join(OUT, "frames", name) });
  return name;
}
async function appearance() {
  return (await api(`/v1/voice/avatar/appearance?session_id=${session.session_id}`, null, "GET")).json;
}
async function ask(i, tag) {
  const turn = await api("/v1/patient/turn", { learner_msg: Q[i], thread_id: thread, case_state: caseState, persona, locale: LANG, history: [] });
  const text = turn.json.utterance ?? "";
  t(`patient (${tag}): ${text}`);
  const sp0 = Date.now();
  const speakP = api("/v1/voice/avatar/speak", { session_id: session.session_id, text });
  const frames = [];
  for (const gap of [1500, 600, 800]) {
    await page.waitForTimeout(gap);
    frames.push(await frame(`${tag}-speaking`));
  }
  const speak = (await speakP).json;
  t(`speak ${tag}: ${JSON.stringify({ first_chunk_ms: speak.first_chunk_ms, voice: speak.voice, silent: speak.silent, spoken: speak.spoken_text })}`);
  await page.waitForTimeout(Math.max(500, (speak.audio_duration_ms ?? 2000) - (Date.now() - sp0) + 600));
  return { question: Q[i], utterance: text, speak, frames, routed_as: turn.json.routed_as };
}
async function stepAndWaitSwitch(action, tag) {
  const before = (await appearance()).appearance?.switches?.length ?? 0;
  const st0 = Date.now();
  const step = await api("/v2/director/step", { thread_id: thread, action, use_model: false });
  const cs = step.json.case_state ?? {};
  t(`director ${tag}: phase ${cs.snapshot?.phase} vitals ${JSON.stringify(cs.vitals)}`);
  const trans = [];
  let sw = null;
  for (let i = 0; i < 600; i++) {
    const a = (await appearance()).appearance;
    if ((a?.switches?.length ?? 0) > before) {
      sw = a.switches[a.switches.length - 1];
      break;
    }
    await page.waitForTimeout(250);
  }
  const switchedMs = Date.now() - st0;
  for (let i = 0; i < 8; i++) {
    trans.push(await frame(`${tag}-crossfade`));
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(800);
  const after = await frame(`${tag}-after`);
  t(`switch ${tag} after ${switchedMs} ms: ${JSON.stringify(sw && { to: sw.to, exact: sw.exact, phase: sw.phase, reason: sw.reason })}`);
  return { action, phase: cs.snapshot?.phase, severity: cs.snapshot?.severity, vitals: cs.vitals, bedside: cs.snapshot?.bedside,
    affect: cs.affect, switch: sw, switch_after_step_ms: switchedMs, frames: [...trans, after] };
}

await page.waitForTimeout(1500);
const idle = await frame("presenting-idle");
const a0 = await appearance();
const turn1 = await ask(0, "presenting");

// Time passes untreated: the course engine deteriorates the patient.
const worse = await stepAndWaitSwitch({ kind: "elapsed", ref: "", elapsed_ms: Number(process.env.WORSEN_MS ?? 240 * 60_000), locale: LANG }, "worse");
const turn2 = await ask(1, "worse");

// A treatment from the case's own table (the first indicated one), then time for it to act.
const rows = spec.treatments ?? [];
// TREATMENTS (comma list of codes) gives several; else the first indicated row.
const wanted = (process.env.TREATMENTS ?? "").split(",").filter(Boolean);
const given = wanted.length ? rows.filter((r) => wanted.includes(r.code))
  : [rows.find((r) => /indicated|appropriate|correct/.test(String(r.appropriateness))) ?? rows[0]].filter(Boolean);
const tx = given[0];
let better = null;
let turn3 = null;
if (tx) {
  for (const g of given) {
    await api("/v2/director/step", { thread_id: thread, action: { kind: "treatment", ref: g.code, locale: LANG }, use_model: false });
  }
  better = await stepAndWaitSwitch({ kind: "elapsed", ref: "", elapsed_ms: Number(process.env.TREAT_MS ?? 180 * 60_000), locale: LANG }, "treated");
  better.treatment = given.map((g) => ({ code: g.code, label: g.label_en }));
  turn3 = await ask(2, "treated");
} else {
  t("no treatment table in the spec yet; the treatment step is skipped");
}

const finalAppearance = await appearance();
// The pictures the face was edited into (what the image edit server made for this case).
fs.mkdirSync(path.join(OUT, "variants"), { recursive: true });
for (const v of finalAppearance.appearance?.variants ?? []) {
  if (!v.has_image) continue;
  const r = await fetch(`${GW}/v1/voice/avatar/appearance/image?session_id=${session.session_id}&key=${v.key}`, { headers: HDR });
  if (r.ok) fs.writeFileSync(path.join(OUT, "variants", `${v.name}-${v.key}.jpg`), Buffer.from(await r.arrayBuffer()));
}
const webm = await page.evaluate(async () => {
  const { rec, chunks } = window.__rec;
  await new Promise((r) => { rec.onstop = r; rec.stop(); });
  const buf = new Uint8Array(await new Blob(chunks, { type: "video/webm" }).arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
});
await browser.close();
const end = await api("/v1/voice/avatar/end", { session_id: session.session_id });
const out = {
  captured_at: new Date().toISOString(), gateway: GW, lang: LANG, condition: CONDITION, thread_id: thread,
  case: { label: spec.condition?.label_en, age, sex, chief_complaint: spec.chief_complaint_en, triage_vitals: spec.triage_vitals,
    exam: (spec.exam ?? []).map((e) => e.finding_en) },
  photo, session: { avatar_id: session.avatar_id, prepare_ms: session.prepare_ms, worker: session.worker, appearance: session.appearance },
  connect: conn, presenting: { frame: idle, appearance: a0, turn: turn1 }, worse: { ...worse, turn: turn2 },
  treated: better ? { ...better, turn: turn3 } : null, final_appearance: finalAppearance, end: end.json,
  log: log.slice(-80),
};
fs.writeFileSync(path.join(OUT, "metrics.json"), JSON.stringify(out, null, 2) + "\n");
const webmPath = path.join(tmp, "call.webm");
fs.writeFileSync(webmPath, Buffer.from(webm, "base64"));
execFileSync("ffmpeg", ["-y", "-v", "error", "-i", webmPath, "-r", "25", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
  "-movflags", "+faststart", path.join(OUT, "patient-call.mp4")]);

console.log("done", OUT);
