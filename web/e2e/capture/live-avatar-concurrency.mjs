/* global AudioContext, MediaStream, RTCPeerConnection, console, document, fetch, performance, process, requestAnimationFrame, setTimeout, window */
// Concurrent live calls on one GPU worker (docs/architecture/18 section 6.3, "Concurrency").
//
// Opens CALLS receive-only WebRTC calls through the gateway (/v1/voice/avatar/session, /offer),
// one Chromium page per call, then makes every patient speak the same long line AT THE SAME TIME
// (/v1/voice/avatar/speak in parallel) and samples the runner's per-call numbers from
// /v1/voice/capabilities while they talk: inference fps, frames sent per second, underruns, VRAM.
// One extra session beyond the worker's limit is requested to show the 503 worker_full refusal.
//
// usage (gateway in local auth mode, a ready worker):
//   GATEWAY=http://127.0.0.1:8895 CALLS=2 OUT=../docs/media/live-avatar node e2e/capture/live-avatar-concurrency.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const GW = process.env.GATEWAY ?? "http://127.0.0.1:8895";
const CALLS = Number(process.env.CALLS ?? 2);
const OUT = path.resolve(process.env.OUT ?? "../docs/media/live-avatar");
const LINE = process.env.LINE ?? "The pain started about two hours ago, right in the middle of my chest, and it spreads to my " +
  "left arm. I feel sweaty and a bit sick, and it gets worse when I walk up the stairs.";
const PHOTOS = ["p04", "p01", "p07", "p09"];

const api = async (user, route, body) => {
  const r = await fetch(`${GW}${route}`, { method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", "x-user-id": user }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const calls = [];
for (let i = 0; i < CALLS; i++) {
  const user = `concurrency-${i}`;
  const ses = await api(user, "/v1/voice/avatar/session", { encounter_id: `concurrency-${i}`, photo_id: PHOTOS[i % PHOTOS.length],
    lang: "en", sex: i % 2 ? "female" : "male", age: 60, case_state: {} });
  if (ses.status !== 200) throw new Error(`session ${i}: ${ses.status} ${JSON.stringify(ses.body)}`);
  const page = await (await browser.newContext()).newPage();
  await page.goto("about:blank");
  const sdp = await page.evaluate(async (s) => {
    const pc = new RTCPeerConnection({ iceServers: s.ice_servers, iceTransportPolicy: "relay" });
    window.pc = pc;
    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });
    const stream = new MediaStream();
    pc.ontrack = (e) => stream.addTrack(e.track);
    window.stream = stream;
    await pc.setLocalDescription(await pc.createOffer());
    await new Promise((r) => { pc.onicegatheringstatechange = () => pc.iceGatheringState === "complete" && r(); setTimeout(r, 4000); });
    return pc.localDescription.sdp;
  }, ses.body);
  const ans = await api(user, "/v1/voice/avatar/offer", { session_id: ses.body.session_id, sdp, type: "offer" });
  if (ans.status !== 200) throw new Error(`offer ${i}: ${ans.status} ${JSON.stringify(ans.body)}`);
  await page.evaluate(async ({ a, prep }) => {
    await window.pc.setRemoteDescription({ type: "answer", sdp: a.sdp });
    const v = document.createElement("video");
    v.muted = true; v.srcObject = window.stream; document.body.appendChild(v); await v.play().catch(() => {});
    const ctx = new AudioContext();
    const an = ctx.createAnalyser(); an.fftSize = 512;
    ctx.createMediaStreamSource(window.stream).connect(an);
    const buf = new Float32Array(512);
    window.frames = 0; window.firstSound = null; window.speakAt = null;
    const tick = () => { an.getFloatTimeDomainData(buf); let s = 0; for (const x of buf) s += x * x;
      if (window.speakAt != null && window.firstSound == null && Math.sqrt(s / 512) > 0.01) window.firstSound = performance.now();
      requestAnimationFrame(tick); };
    tick();
    // Lip-sync meter, as in web/src/lib/avatarCall.ts: per decoded frame, the remote audio RMS and
    // the mouth box's darkness (openness), the box placed from the runner's face box.
    const cv = document.createElement("canvas"); cv.width = 48; cv.height = 32;
    const g = cv.getContext("2d", { willReadFrequently: true });
    window.lip = [];
    const fb = prep && prep.face_box && prep.width ? prep : null;
    const vt = (now) => {
      window.frames++;
      an.getFloatTimeDomainData(buf); let s = 0; for (const x of buf) s += x * x;
      if (v.videoWidth > 0) {
        const W = v.videoWidth, H = v.videoHeight;
        const [x1, y1, x2, y2] = fb ? fb.face_box.map((q, k) => q * (k % 2 ? H / fb.height : W / fb.width)) : [0.3 * W, 0.45 * H, 0.7 * W, 0.9 * H];
        const fw = x2 - x1, fh = y2 - y1;
        g.drawImage(v, x1 + 0.3 * fw, y1 + 0.62 * fh, 0.4 * fw, 0.3 * fh, 0, 0, 48, 32);
        const px = g.getImageData(0, 0, 48, 32).data; let l = 0;
        for (let i = 0; i < px.length; i += 4) l += px[i + 1];
        window.lip.push({ t: now, rms: Math.sqrt(s / 512), open: 255 - l / (px.length / 4) });
        if (window.lip.length > 4000) window.lip.splice(0, 1000);
      }
      v.requestVideoFrameCallback(vt);
    };
    v.requestVideoFrameCallback(vt);
  }, { a: ans.body, prep: ses.body.prepare });
  await page.waitForFunction(() => window.frames > 10, null, { timeout: 60_000 });
  calls.push({ user, page, session: ses.body });
  console.log(`call ${i} live (${ses.body.session_id.slice(0, 6)}, prepare ${ses.body.prepare_ms} ms)`);
}

// One more than the limit: refused before any portrait work.
const extra = await api("concurrency-extra", "/v1/voice/avatar/session", { encounter_id: "concurrency-extra", photo_id: "p04",
  lang: "en", case_state: {} });
console.log(`extra session -> ${extra.status} ${extra.body.state ?? ""} ${(extra.body.reasons ?? []).join("; ")}`);
if (extra.status === 200) await api("concurrency-extra", "/v1/voice/avatar/end", { session_id: extra.body.session_id });

// Everyone speaks at once; sample the runner while they talk.
const samples = [];
let sampling = true;
const sampler = (async () => {
  while (sampling) {
    const c = await api(calls[0].user, "/v1/voice/capabilities");
    samples.push({ t: Date.now(), calls: c.body.avatar?.calls ?? [], vram: c.body.avatar?.vram ?? null });
    await new Promise((r) => setTimeout(r, 1000));
  }
})();
// ROUNDS > 1 speaks the line again after it finished (the first line of a call pays one-time costs).
const ROUNDS = Number(process.env.ROUNDS ?? 1);
const rounds = [];
let spoken = [];
for (let round = 0; round < ROUNDS; round++) {
  await Promise.all(calls.map((c) => c.page.evaluate(() => { window.speakAt = performance.now(); window.firstSound = null; })));
  spoken = await Promise.all(calls.map((c) => api(c.user, "/v1/voice/avatar/speak", { session_id: c.session.session_id, text: LINE })));
  await new Promise((r) => setTimeout(r, 13000));
  const starts = await Promise.all(calls.map((c) => c.page.evaluate(() =>
    (window.firstSound != null ? Math.round(window.firstSound - window.speakAt) : null))));
  const lags = await Promise.all(calls.map((c) => c.page.evaluate(() => {
    // Cross-correlation of RMS and openness on a 20 ms grid over this round's speech (lag > 0:
    // mouth after voice), searched over +-600 ms.
    const w = window.lip.filter((x) => x.t >= window.speakAt);
    if (w.length < 20) return null;
    const step = 20, t0 = w[0].t, t1 = w[w.length - 1].t, a = [], b = [];
    let k = 0;
    for (let t = t0; t <= t1; t += step) { while (k + 1 < w.length && w[k + 1].t <= t) k++; a.push(w[k].rms); b.push(w[k].open); }
    const n = a.length, ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
    let best = 0, bs = -Infinity;
    for (let lag = -30; lag <= 30; lag++) {
      let sc = 0; for (let i = 0; i < n; i++) { const j = i + lag; if (j >= 0 && j < n) sc += (a[i] - ma) * (b[j] - mb); }
      if (sc > bs) { bs = sc; best = lag; }
    }
    return best * step;
  })));
  const trace = (await api(calls[0].user, "/v1/voice/capabilities")).body.avatar?.last_speech_trace ?? null;
  rounds.push({ round, speechStartMs: starts, lipLagMs: lags, first_chunk_ms: spoken.map((x) => x.body.first_chunk_ms), trace });
  console.log(`round ${round}: speech start ${starts.join(", ")} ms, mouth-after-voice ${lags.join(", ")} ms`);
}
sampling = false;
await sampler;
const perCall = [];
for (const [i, c] of calls.entries()) {
  const m = await c.page.evaluate(async () => {
    const st = await window.pc.getStats();
    const out = { speechStartMs: window.firstSound != null ? Math.round(window.firstSound - window.speakAt) : null };
    st.forEach((r) => {
      if (r.type === "inbound-rtp" && r.kind === "video") Object.assign(out, { framesDecoded: r.framesDecoded, fps: r.framesPerSecond });
      if (r.type === "inbound-rtp" && r.kind === "audio") out.audioEnergy = r.totalAudioEnergy;
    });
    return out;
  });
  perCall.push({ call: i, speak: spoken[i].body, browser: m });
}
// Busiest moment: the sample where both calls were speaking (or the last one).
const talking = samples.filter((s) => s.calls.filter((x) => x.speaking).length >= Math.min(CALLS, 2));
const peak = (talking.length ? talking : samples).at(-1);
const out = { captured_at: new Date().toISOString(), gateway: GW, calls: CALLS, line_chars: LINE.length,
  extra_session: { status: extra.status, state: extra.body.state, reasons: extra.body.reasons, max_calls: extra.body.max_calls },
  per_call: perCall, rounds, runner_while_talking: peak, samples_with_all_speaking: talking.length, samples: samples.length };
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "concurrency.json"), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify({ per_call: perCall.map((p) => ({ call: p.call, speechStartMs: p.browser.speechStartMs, fps: p.browser.fps,
  first_chunk_ms: p.speak.first_chunk_ms })), runner: peak?.calls, vram: peak?.vram, extra: out.extra_session }, null, 1));
for (const c of calls) await api(c.user, "/v1/voice/avatar/end", { session_id: c.session.session_id });
await browser.close();
