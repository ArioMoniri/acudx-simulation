/**
 * avatarCall: the browser side of the live patient video (server/voice/avatar).
 *
 * Self-hosted path (transport "webrtc"): the gateway prepares the case portrait as the
 * reference face on the GPU worker's LiveTalking + MuseTalk 1.5 runner and hands back
 * TURN credentials; this module opens a receive-only RTCPeerConnection, sends the offer
 * through the gateway (the worker bearer never reaches the browser), attaches the
 * patient's lip-synced video and voice, and asks the gateway to speak each patient line
 * (gateway TTS -> runner audio in -> lip-synced frames and audio on the same connection).
 *
 * Measured on the live connection, all from performance.now():
 *  - firstFrameMs: offer sent -> first decoded video frame (requestVideoFrameCallback);
 *  - speechStartMs: speak request sent -> first audible sample on the remote track;
 *  - lipLagMs: audio-to-lip offset, the lag that best aligns the remote audio RMS
 *    envelope with mouth-region motion in the decoded frames (cross-correlation over
 *    the last utterance); near 0 means lips and voice are in sync.
 *
 * Pure helpers (`crossCorrelationLag`, `mouthRegion`, `sessionBody`) are unit-tested in
 * avatarCall.test.ts.
 */

import type { AvatarSession, AvatarSpeakResult, VoiceApi } from "@/lib/voiceApi";

export type AvatarCallState = "preparing" | "connecting" | "live" | "failed" | "ended";

export interface AvatarCallMetrics {
  prepareMs: number | null;
  answerMs: number | null;
  firstFrameMs: number | null;
  speechStartMs: number | null;
  lipLagMs: number | null;
  /** Receive-side desync now (receiverLagMs, median of the last readings), reported to the gateway. */
  receiverLagMs?: number | null;
  ttsMs: number | null;
  /** Gateway: speak request -> first PCM chunk forwarded to the runner (streamed TTS). */
  firstAudioMs: number | null;
  provider: string | null;
  /** Normalised correlation at the lip lag (0..1); under about 0.3 the lag is not meaningful. */
  lipScore?: number | null;
}

/** One measured patient line: from the question (or speak request) to the end of the voice. */
export interface AvatarLineMeasure {
  text: string;
  /** "speak": the tile asked the gateway to speak; "server": the interview turn spoke it into the call. */
  via: "speak" | "server";
  speechStartMs: number | null;
  lipLagMs: number | null;
  lipScore: number | null;
  voiceMs: number | null;
  /** From the runner's sync probe: the offset end to end over the whole line, whatever the portrait. */
  probeLagMs?: number | null;
  probeScore?: number | null;
  /** The probe's offset over the first stretch of voice (before any correction during the line). */
  probeFirstLagMs?: number | null;
  /** Corrections sent during the line, and the offset left after the last one. */
  probeCorrections?: number;
  probeTailLagMs?: number | null;
}

export interface AvatarSample {
  t: number;
  rms: number;
  motion: number;
  /** Mouth openness: mean darkness of the mouth box (an open mouth shows the dark oral cavity). */
  open: number;
  /** The runner's sync probe block (bottom-right corner), when a harness turned it on: the loudness of the
   * audio each frame was rendered from. */
  probe?: number;
}

export interface AvatarCallHandle {
  session: AvatarSession;
  metrics: AvatarCallMetrics;
  samples: AvatarSample[];
  /** The gateway's reply to the last spoken line (TTS provider, first chunk, runner frame counts). */
  lastSpeak: AvatarSpeakResult | null;
  speak: (text: string) => Promise<boolean>;
  /**
   * A line the server already speaks into the call (the interview turn streamed it, 6.3.9): measure it
   * from `sentAt` (performance.now() when the question was sent) without speaking it again.
   */
  track: (text: string, sentAt: number) => void;
  /** Every measured line of this call, oldest first. */
  lines: AvatarLineMeasure[];
  /** Receiver-side numbers from getStats (audio energy proves the voice arrived, not just packets). */
  stats: () => Promise<AvatarCallStats>;
  end: () => void;
}

export interface AvatarCallStats {
  audioPackets: number;
  audioEnergy: number;
  videoFrames: number;
  videoFps: number | null;
  rttMs: number | null;
  /** Mean receiver jitter-buffer delay (ms): where the browser holds media, e.g. audio held back to video for lip sync. */
  audioJitterMs: number | null;
  videoJitterMs: number | null;
  /** The ICE pair carrying the call: a relay candidate, and over which TURN transport (udp, tcp, tls). */
  path?: IcePath | null;
}

export interface IcePath {
  localType: string | null;
  relayProtocol: string | null;
  url: string | null;
  state: string | null;
}

/** The selected candidate pair of a getStats report (the transport's selectedCandidatePairId). */
export function selectedIcePath(report: { forEach: (cb: (r: Record<string, unknown>) => void) => void;
  get: (id: string) => Record<string, unknown> | undefined }): IcePath | null {
  let out: IcePath | null = null;
  report.forEach((r) => {
    if (out || r.type !== "transport" || typeof r.selectedCandidatePairId !== "string") return;
    const pair = report.get(r.selectedCandidatePairId);
    const local = pair && typeof pair.localCandidateId === "string" ? report.get(pair.localCandidateId) : undefined;
    out = {
      localType: local?.candidateType != null ? String(local.candidateType) : null,
      relayProtocol: local?.relayProtocol != null ? String(local.relayProtocol) : null,
      url: local?.url != null ? String(local.url) : null,
      state: pair?.state != null ? String(pair.state) : null,
    };
  });
  return out;
}

/** Mean jitter-buffer delay in ms from an inbound-rtp report (jitterBufferDelay is seconds summed per emitted unit). */
/** One reading of the two receivers' playout state (getStats inbound-rtp). */
export interface PlayoutSample {
  /** estimatedPlayoutTimestamp (sender NTP ms of what plays now), when the browser reports it. */
  audioEpt: number | null;
  videoEpt: number | null;
  /** Cumulative jitter-buffer delay (s) and emitted count, for the fallback. */
  audioDelay: number;
  audioCount: number;
  videoDelay: number;
  videoCount: number;
}

export function playoutSample(report: { forEach: (cb: (r: Record<string, unknown>) => void) => void }): PlayoutSample {
  const out: PlayoutSample = { audioEpt: null, videoEpt: null, audioDelay: 0, audioCount: 0, videoDelay: 0, videoCount: 0 };
  report.forEach((r) => {
    if (r.type !== "inbound-rtp" || (r.kind !== "audio" && r.kind !== "video")) return;
    const ept = Number(r.estimatedPlayoutTimestamp);
    const delay = Number(r.jitterBufferDelay ?? 0);
    const count = Number(r.jitterBufferEmittedCount ?? 0);
    if (r.kind === "audio") {
      out.audioEpt = Number.isFinite(ept) && ept > 0 ? ept : null;
      out.audioDelay = Number.isFinite(delay) ? delay : 0;
      out.audioCount = Number.isFinite(count) ? count : 0;
    } else {
      out.videoEpt = Number.isFinite(ept) && ept > 0 ? ept : null;
      out.videoDelay = Number.isFinite(delay) ? delay : 0;
      out.videoCount = Number.isFinite(count) ? count : 0;
    }
  });
  return out;
}

/**
 * How far the browser's playout puts the mouth after the voice (ms; negative = lips early), from what
 * plays now: the audio's estimated playout timestamp minus the video's (both in the sender's clock, so
 * the difference is the receive-side desync: jitter buffers, decoders and Chrome's own A/V sync while
 * it converges). Without playout timestamps, the difference of the two jitter-buffer delays over the
 * last interval (video held longer = lips late). Null when neither can be read.
 *
 * Live 2026-10-22 (A100 40 GB): on the first line of a call the browser's sync had not converged yet
 * (audio jitter buffer 262 ms against 155 ms for video) and the lips were 185 ms early on top of the
 * sender's offset; production saw -520 and -320 ms on the first two lines.
 */
export function receiverLagMs(prev: PlayoutSample | null, cur: PlayoutSample): number | null {
  if (cur.audioEpt != null && cur.videoEpt != null) return Math.round(cur.audioEpt - cur.videoEpt);
  if (!prev) return null;
  const da = cur.audioCount - prev.audioCount;
  const dv = cur.videoCount - prev.videoCount;
  if (da <= 0 || dv <= 0) return null;
  const a = ((cur.audioDelay - prev.audioDelay) / da) * 1000;
  const v = ((cur.videoDelay - prev.videoDelay) / dv) * 1000;
  return Number.isFinite(a) && Number.isFinite(v) ? Math.round(v - a) : null;
}

export function jitterBufferMs(r: Record<string, unknown>): number | null {
  const delay = Number(r.jitterBufferDelay);
  const count = Number(r.jitterBufferEmittedCount);
  if (!Number.isFinite(delay) || !Number.isFinite(count) || count <= 0) return null;
  return Math.round((delay / count) * 1000);
}

export interface StartAvatarCallOptions {
  api: VoiceApi;
  session: AvatarSession;
  video: HTMLVideoElement;
  audio: HTMLAudioElement;
  onState?: (s: AvatarCallState) => void;
  onMetrics?: (m: AvatarCallMetrics) => void;
  iceGatherTimeoutMs?: number;
  /** How often the receive-side desync is read (ms, 1000). */
  syncIntervalMs?: number;
  firstFrameTimeoutMs?: number;
  /** Receiver playout target in ms (default 0: play as soon as decodable). */
  playoutDelayMs?: number;
}

/**
 * Ask the browser to keep its jitter buffer short. The patient stream is one-way and
 * conversational, so latency matters more than smoothing: the live run measured about 1 s of
 * audio held in the jitter buffer (getStats jitterBufferDelay), part of it audio waiting for the
 * video for lip sync. `jitterBufferTarget` is the standard hint (Chrome 124+, Firefox), and
 * `playoutDelayHint` the older Chrome one; both are hints, so unsupported browsers ignore them.
 */
export function lowLatencyReceiver(receiver: RTCRtpReceiver | undefined, targetMs: number): void {
  if (!receiver) return;
  const r = receiver as RTCRtpReceiver & { jitterBufferTarget?: number | null; playoutDelayHint?: number };
  try {
    if ("jitterBufferTarget" in r) r.jitterBufferTarget = targetMs;
    r.playoutDelayHint = targetMs / 1000;
  } catch {
    /* hints only */
  }
}

const MAX_SAMPLES = 1500;
/** After a lip correction: the runner moves its delay one frame per frame, then the jitter buffers play it out. */
const SETTLE_MS = 1200;

/** Body for POST /v1/voice/avatar/session. */
export function sessionBody(args: {
  encounterId: string;
  photoId: string;
  lang: string;
  sex?: string;
  age?: number;
  context?: { case_state?: Record<string, unknown>; persona?: Record<string, unknown>; case_context?: Record<string, unknown> };
  /** The case thread: the server derives the face, the voice and the answers from its live state. */
  threadId?: string | null;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    encounter_id: args.encounterId,
    photo_id: args.photoId,
    lang: args.lang,
    sex: args.sex,
    age: args.age,
    case_state: args.context?.case_state ?? {},
    persona: args.context?.persona ?? null,
    case_context: args.context?.case_context ?? null,
  };
  if (args.threadId) body.thread_id = args.threadId;
  return body;
}

/**
 * The mouth box of a frame, as fractions of width and height: from the face box the runner
 * detected when it prepared the portrait (`prepare.face_box`, frame `width` x `height`) when the
 * session carries it, else the lower-centre of the frame.
 */
export function mouthRegion(prep?: { face_box?: number[]; width?: number; height?: number } | null): {
  x: number; y: number; w: number; h: number;
} {
  const b = prep?.face_box;
  if (b && b.length === 4 && prep?.width && prep?.height) {
    const [x1, y1, x2, y2] = b;
    const fw = x2 - x1;
    const fh = y2 - y1;
    return { x: (x1 + 0.3 * fw) / prep.width, y: (y1 + 0.62 * fh) / prep.height, w: (0.4 * fw) / prep.width,
      h: (0.3 * fh) / prep.height };
  }
  return { x: 0.3, y: 0.55, w: 0.4, h: 0.25 };
}

/**
 * Lag (ms) that maximises the normalised cross-correlation of `a` (audio RMS) and `b`
 * (mouth motion), both sampled every `stepMs`, searched over +-`maxLagMs`. Positive means
 * the motion follows the audio. Null when either series is flat.
 */
export function crossCorrelationLag(a: number[], b: number[], stepMs: number, maxLagMs = 600): number | null {
  return crossCorrelation(a, b, stepMs, maxLagMs)?.lagMs ?? null;
}

/**
 * The lag (ms) and the normalised correlation at it (how much the lag can be trusted). `absolute`: the lag
 * of the strongest correlation of either sign, scored by its size. For the mouth box a portrait whose teeth
 * show when the mouth opens gets brighter, not darker, as it speaks (live 2026-10-22, A100 pass: scores of
 * -0.05 to -0.24 on every line of one portrait, so its offsets were never measured).
 */
export function crossCorrelation(a: number[], b: number[], stepMs: number, maxLagMs = 600, absolute = false):
  { lagMs: number; score: number } | null {
  const n = Math.min(a.length, b.length);
  if (n < 8) return null;
  const mean = (x: number[]) => x.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const ma = mean(a);
  const mb = mean(b);
  const da = a.slice(0, n).map((v) => v - ma);
  const db = b.slice(0, n).map((v) => v - mb);
  const sa = Math.sqrt(da.reduce((s, v) => s + v * v, 0));
  const sb = Math.sqrt(db.reduce((s, v) => s + v * v, 0));
  if (sa < 1e-9 || sb < 1e-9) return null;
  const maxLag = Math.max(1, Math.round(maxLagMs / stepMs));
  let best = 0;
  let bestScore = -Infinity;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i < n; i++) {
      const j = i + lag;
      if (j < 0 || j >= n) continue;
      s += da[i] * db[j];
    }
    const raw = s / (sa * sb);
    const score = absolute ? Math.abs(raw) : raw;
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  return { lagMs: best * stepMs, score: Math.round(bestScore * 1000) / 1000 };
}

/**
 * The span of one spoken line in the sampler's series: from `startAt` to the end of the voice (the
 * last loud sample once `quietMs` (2.5 s: a streamed reply can pause between clauses) of silence followed it). `done` is false while the voice may still
 * go on. A long reply (live 2026-10-21: 12.6 s) is measured whole, not cut at a guessed duration.
 */
export function utteranceSpan(samples: AvatarSample[], startAt: number, now: number,
  opts: { loud?: number; quietMs?: number } = {}): { first: number | null; last: number | null; done: boolean } {
  const loud = opts.loud ?? 0.01;
  const quietMs = opts.quietMs ?? 2500;
  let first: number | null = null;
  let last: number | null = null;
  for (const s of samples) {
    if (s.t < startAt || s.rms <= loud) continue;
    if (first == null) first = s.t;
    last = s.t;
  }
  return { first, last, done: last != null && now - last >= quietMs };
}

/** Resample irregular samples onto a fixed grid (nearest previous sample). */
export function resample(samples: AvatarSample[], stepMs: number):
  { rms: number[]; motion: number[]; open: number[]; probe: number[] } {
  if (samples.length < 2) return { rms: [], motion: [], open: [], probe: [] };
  const t0 = samples[0].t;
  const t1 = samples[samples.length - 1].t;
  const rms: number[] = [];
  const motion: number[] = [];
  const open: number[] = [];
  const probe: number[] = [];
  let k = 0;
  for (let t = t0; t <= t1; t += stepMs) {
    while (k + 1 < samples.length && samples[k + 1].t <= t) k++;
    rms.push(samples[k].rms);
    motion.push(samples[k].motion);
    open.push(samples[k].open ?? 0);
    probe.push(samples[k].probe ?? 0);
  }
  return { rms, motion, open, probe };
}

/**
 * The end-to-end lip offset from the runner's sync probe over [from, to] (page clock ms): the probe block's
 * brightness follows the loudness of the audio each frame was rendered from, so its lag against what is
 * heard is the offset whatever the face. Null without a probe signal or with less than 2 s of samples.
 */
export function probeLag(samples: AvatarSample[], from: number, to: number): { lagMs: number; score: number } | null {
  const win = samples.filter((x) => x.t >= from && x.t <= to);
  if (win.length < 2 || win[win.length - 1].t - win[0].t < 2000) return null;
  const { rms, probe } = resample(win, 40);
  if (Math.max(...probe) - Math.min(...probe) <= 20) return null;
  return crossCorrelation(rms, probe, 40);
}

/**
 * Resolve once ICE gathering is complete, or `settleMs` after the first relay candidate (the offer is
 * not trickled, and the call is relay only, so one relay candidate is enough to connect), or after
 * `timeoutMs`. Gathering itself only completes once every TURN URL has answered or timed out: with UDP
 * blocked that was the whole 4 s timeout before every call's offer (live 2026-10-22, A100 pass).
 */
export function waitForIce(pc: Pick<RTCPeerConnection, "iceGatheringState" | "addEventListener" | "removeEventListener">,
  timeoutMs: number, settleMs = 300): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") return resolve();
    let finished = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const done = () => {
      if (finished) return;
      finished = true;
      timers.forEach(clearTimeout);
      pc.removeEventListener("icegatheringstatechange", check);
      pc.removeEventListener("icecandidate", onCandidate as EventListener);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === "complete") done();
    };
    let settling = false;
    const onCandidate = (e: RTCPeerConnectionIceEvent) => {
      const c = e.candidate;
      if (!c || settling) return;
      if (c.type === "relay" || / typ relay/.test(c.candidate ?? "")) {
        settling = true;
        timers.push(setTimeout(done, settleMs));
      }
    };
    pc.addEventListener("icegatheringstatechange", check);
    pc.addEventListener("icecandidate", onCandidate as EventListener);
    timers.push(setTimeout(done, timeoutMs));
  });
}

/**
 * Connect the live video for a prepared session. Resolves once the first video frame is
 * decoded (or rejects on failure / timeout, so the caller can fall back honestly).
 */
export async function startAvatarCall(opts: StartAvatarCallOptions): Promise<AvatarCallHandle> {
  const { api, session, video, audio } = opts;
  const metrics: AvatarCallMetrics = {
    prepareMs: session.prepare_ms ?? null,
    answerMs: null,
    firstFrameMs: null,
    speechStartMs: null,
    lipLagMs: null,
    ttsMs: null,
    firstAudioMs: null,
    provider: null,
  };
  const samples: AvatarSample[] = [];
  const emit = () => opts.onMetrics?.({ ...metrics });
  opts.onState?.("connecting");

  const pc = new RTCPeerConnection({
    iceServers: session.ice_servers ?? [],
    iceTransportPolicy: session.ice_transport_policy === "relay" ? "relay" : "all",
  });
  pc.addTransceiver("video", { direction: "recvonly" });
  pc.addTransceiver("audio", { direction: "recvonly" });
  const stream = new MediaStream();
  pc.ontrack = (e) => {
    lowLatencyReceiver(e.receiver, opts.playoutDelayMs ?? 0);
    stream.addTrack(e.track);
    video.srcObject = stream;
    audio.srcObject = stream;
  };
  let ended = false;
  let stopSampler = () => {};
  let stopSync = () => {};

  const end = () => {
    if (ended) return;
    ended = true;
    stopSampler();
    stopSync();
    pc.close();
    void api.avatarEnd(session.session_id);
    opts.onState?.("ended");
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" && !ended) {
      opts.onState?.("failed");
    }
  };

  await pc.setLocalDescription(await pc.createOffer());
  await waitForIce(pc, opts.iceGatherTimeoutMs ?? 4000);
  const t0 = performance.now();
  const ans = await api.avatarOffer(session.session_id, pc.localDescription?.sdp ?? "");
  if (!ans.ok) {
    pc.close();
    throw new Error(`offer_failed:${ans.error}`);
  }
  metrics.answerMs = Math.round(performance.now() - t0);
  await pc.setRemoteDescription({ type: "answer", sdp: ans.data.sdp });

  // First decoded frame (a timeout ends the remote session too, so nothing leaks).
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("first_frame_timeout")), opts.firstFrameTimeoutMs ?? 30_000);
    const got = () => {
      clearTimeout(timer);
      metrics.firstFrameMs = Math.round(performance.now() - t0);
      resolve();
    };
    const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    if (typeof v.requestVideoFrameCallback === "function") v.requestVideoFrameCallback(got);
    else video.addEventListener("playing", got, { once: true });
    void video.play().catch(() => {});
  }).catch((err: unknown) => {
    end();
    throw err;
  });
  // The voice is on the same stream: start the audio element explicitly (autoplay alone can leave it
  // paused when the call connects minutes after the click that started it).
  void audio.play().catch(() => {});
  emit();
  opts.onState?.("live");

  // Sampler: remote audio RMS + mouth-region motion per decoded frame.
  try {
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    const buf = new Float32Array(an.fftSize);
    const canvas = document.createElement("canvas");
    canvas.width = 48;
    canvas.height = 32;
    const g = canvas.getContext("2d", { willReadFrequently: true });
    const probeCanvas = document.createElement("canvas");
    probeCanvas.width = 4;
    probeCanvas.height = 4;
    const pg = probeCanvas.getContext("2d", { willReadFrequently: true });
    let prev: Uint8ClampedArray | null = null;
    let stopped = false;
    const r = mouthRegion((session as { prepare?: { face_box?: number[]; width?: number; height?: number } }).prepare);
    const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number) => void) => number };
    const tick = (now: number) => {
      if (stopped) return;
      an.getFloatTimeDomainData(buf);
      let s = 0;
      for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
      const rms = Math.sqrt(s / buf.length);
      let motion = 0;
      let open = 0;
      if (g && video.videoWidth > 0) {
        g.drawImage(video, video.videoWidth * r.x, video.videoHeight * r.y, video.videoWidth * r.w,
          video.videoHeight * r.h, 0, 0, canvas.width, canvas.height);
        const px = g.getImageData(0, 0, canvas.width, canvas.height).data;
        let luma = 0;
        for (let i = 0; i < px.length; i += 4) luma += px[i + 1];
        open = 255 - luma / (px.length / 4);
        if (prev) {
          let d = 0;
          for (let i = 0; i < px.length; i += 4) d += Math.abs(px[i + 1] - prev[i + 1]);
          motion = d / (px.length / 4);
        }
        prev = px.slice();
      }
      let probe: number | undefined;
      if (pg && video.videoWidth > 8) {
        // The centre 4 x 4 of the runner's 8 x 8 probe block (the edge pixels blur in the encoder).
        pg.drawImage(video, video.videoWidth - 6, video.videoHeight - 6, 4, 4, 0, 0, 4, 4);
        const pp = pg.getImageData(0, 0, 4, 4).data;
        let l = 0;
        for (let i = 0; i < pp.length; i += 4) l += pp[i + 1];
        probe = l / (pp.length / 4);
      }
      samples.push({ t: now, rms, motion, open, probe });
      if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
      if (typeof v.requestVideoFrameCallback === "function") v.requestVideoFrameCallback(tick);
      else requestAnimationFrame(tick);
    };
    if (typeof v.requestVideoFrameCallback === "function") v.requestVideoFrameCallback(tick);
    else requestAnimationFrame(tick);
    stopSampler = () => {
      stopped = true;
      void ctx.close();
    };
  } catch {
    /* metrics are best effort; the call itself does not depend on them */
  }

  // Receive-side desync, read once a second; its median goes to the gateway, whose runner adds it to the
  // sender's own skew when it sets the video (or audio) delay (docs/architecture/18 6.3.13).
  {
    let prev: PlayoutSample | null = null;
    const recent: number[] = [];
    let sent: number | null = null;
    let sentAt = 0;
    const timer = setInterval(() => {
      if (ended) return;
      void pc.getStats().then((report) => {
        const cur = playoutSample(report as unknown as Parameters<typeof playoutSample>[0]);
        const lag = receiverLagMs(prev, cur);
        prev = cur;
        if (lag == null || Math.abs(lag) > 2000) return;
        recent.push(lag);
        if (recent.length > 5) recent.shift();
        const med = [...recent].sort((x, y) => x - y)[Math.floor(recent.length / 2)];
        metrics.receiverLagMs = med;
        const now = performance.now();
        if (recent.length >= 3 && now - sentAt >= 3000 && (sent == null || Math.abs(med - sent) >= 40 || now - sentAt > 10_000)) {
          sent = med;
          sentAt = now;
          void api.avatarSync?.(session.session_id, med).catch(() => undefined);
        }
      }).catch(() => undefined);
    }, opts.syncIntervalMs ?? 1000);
    stopSync = () => clearInterval(timer);
  }

  const lines: AvatarLineMeasure[] = [];
  let measureSeq = 0;
  /**
   * Speech start and the audio-to-lip offset of the line that began at `startAt`, once its voice has
   * ended; the offset goes back to the gateway, which moves the call's video delay when it is outside
   * the tolerance (closed loop, so a host whose encoder or network shifts the lips is corrected).
   */
  const measure = (text: string, startAt: number, via: AvatarLineMeasure["via"]) => {
    const seq = ++measureSeq;
    const line: AvatarLineMeasure = { text, via, speechStartMs: null, lipLagMs: null, lipScore: null, voiceMs: null };
    lines.push(line);
    if (lines.length > 50) lines.splice(0, lines.length - 50);
    const started = performance.now();
    // Corrections during the line, from the sync probe: the first seconds of a call play the lips early on the
    // receive side (live 2026-10-22, A100 pass: -240 ms on line 1 while the browser's A/V sync converged), and
    // a correction only after the line came one line late. Every second, once 2.8 s of voice have played since
    // the last correction took effect, the probe's lag over that stretch goes to the gateway.
    let corrected = -Infinity;
    let checked = -Infinity;
    const poll = () => {
      if (ended || seq !== measureSeq) return;
      const t = performance.now();
      const span = utteranceSpan(samples, startAt, t);
      if (span.first != null && line.speechStartMs == null) {
        line.speechStartMs = Math.round(span.first - startAt);
        metrics.speechStartMs = line.speechStartMs;
        emit();
      }
      if (span.first != null && !span.done && t - checked >= 1000) {
        const from = Math.max(span.first, corrected + SETTLE_MS) - 400;
        if (t - from >= 2800) {
          checked = t;
          const p = probeLag(samples, from, t);
          if (p && p.score >= 0.6) {
            if (line.probeFirstLagMs == null) line.probeFirstLagMs = p.lagMs;
            if (Math.abs(p.lagMs) > 40) {
              corrected = t;
              line.probeCorrections = (line.probeCorrections ?? 0) + 1;
              void api.avatarLipsync(session.session_id, p.lagMs, p.score).catch(() => undefined);
            }
          }
        }
      }
      if (!span.done) {
        if (t - started < 120_000) setTimeout(poll, 300);
        return;
      }
      line.voiceMs = Math.round((span.last ?? span.first ?? t) - (span.first ?? t));
      // Openness (darkness of the mouth box), not frame-to-frame motion: with the idle head loop the
      // whole face moves a little all the time, while the mouth box's darkness changes only when the
      // mouth opens. The window is the whole voice plus 0.8 s either side.
      const win = samples.filter((s) => s.t >= (span.first ?? startAt) - 800 && s.t <= (span.last ?? t) + 800);
      const { rms, open, probe } = resample(win, 40);
      const cc = crossCorrelation(rms, open, 40, 600, true);
      // The runner's sync probe, when on: louder audio = a brighter block, so a plain correlation.
      const probed = Math.max(...probe) - Math.min(...probe) > 20 ? crossCorrelation(rms, probe, 40) : null;
      if (probed) {
        line.probeLagMs = probed.lagMs;
        line.probeScore = probed.score;
      }
      // After corrections during the line, only the stretch since the last one says what is left to correct.
      const tail = Number.isFinite(corrected)
        ? probeLag(samples, Math.max(span.first ?? startAt, corrected + SETTLE_MS) - 400, (span.last ?? t) + 800) : null;
      if (tail) line.probeTailLagMs = tail.lagMs;
      // With the probe on, a weak probe reading sends nothing: the face meter is the fallback only without a probe
      // (live 2026-10-22, A100: a line under 300 ms of network jitter scored the probe 0.36 at +120 ms and the face
      // meter 0.27 at -400 ms; the meter's reading moved the bias the wrong way and the next line opened 320 ms late).
      const use = Number.isFinite(corrected) ? (tail && tail.score >= 0.5 ? tail : null)
        : probed ? (probed.score >= 0.5 ? probed : null) : cc;
      if (cc) {
        line.lipLagMs = cc.lagMs;
        line.lipScore = cc.score;
        metrics.lipLagMs = cc.lagMs;
        metrics.lipScore = cc.score;
        emit();
      }
      if (use) void api.avatarLipsync(session.session_id, use.lagMs, use.score).catch(() => undefined);
    };
    setTimeout(poll, 300);
  };

  const speak = async (text: string): Promise<boolean> => {
    if (ended) return false;
    metrics.speechStartMs = null;
    const speakAt = performance.now();
    measure(text, speakAt, "speak");
    const res = await api.avatarSpeak(session.session_id, text);
    if (!res.ok) return false;
    handle.lastSpeak = res.data;
    metrics.ttsMs = res.data.tts_ms;
    metrics.firstAudioMs = res.data.first_chunk_ms ?? null;
    metrics.provider = res.data.provider;
    emit();
    return true;
  };

  const track = (text: string, sentAt: number) => {
    if (ended) return;
    metrics.speechStartMs = null;
    metrics.provider = "interview-stream";
    measure(text, sentAt, "server");
  };

  const stats = async (): Promise<AvatarCallStats> => {
    const out: AvatarCallStats = { audioPackets: 0, audioEnergy: 0, videoFrames: 0, videoFps: null, rttMs: null,
      audioJitterMs: null, videoJitterMs: null };
    const report = await pc.getStats();
    report.forEach((r: Record<string, unknown>) => {
      if (r.type === "inbound-rtp" && r.kind === "audio") {
        out.audioPackets = Number(r.packetsReceived ?? 0);
        out.audioEnergy = Number(r.totalAudioEnergy ?? 0);
        out.audioJitterMs = jitterBufferMs(r);
      } else if (r.type === "inbound-rtp" && r.kind === "video") {
        out.videoFrames = Number(r.framesDecoded ?? 0);
        out.videoFps = r.framesPerSecond != null ? Number(r.framesPerSecond) : null;
        out.videoJitterMs = jitterBufferMs(r);
      } else if (r.type === "candidate-pair" && r.nominated && r.currentRoundTripTime != null) {
        out.rttMs = Math.round(Number(r.currentRoundTripTime) * 1000);
      }
    });
    out.path = selectedIcePath(report as unknown as Parameters<typeof selectedIcePath>[0]);
    return out;
  };

  const handle: AvatarCallHandle = { session, metrics, samples, lastSpeak: null, speak, track, lines, stats, end };
  return handle;
}
