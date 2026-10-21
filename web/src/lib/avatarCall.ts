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
  ttsMs: number | null;
  /** Gateway: speak request -> first PCM chunk forwarded to the runner (streamed TTS). */
  firstAudioMs: number | null;
  provider: string | null;
}

export interface AvatarSample {
  t: number;
  rms: number;
  motion: number;
  /** Mouth openness: mean darkness of the mouth box (an open mouth shows the dark oral cavity). */
  open: number;
}

export interface AvatarCallHandle {
  session: AvatarSession;
  metrics: AvatarCallMetrics;
  samples: AvatarSample[];
  /** The gateway's reply to the last spoken line (TTS provider, first chunk, runner frame counts). */
  lastSpeak: AvatarSpeakResult | null;
  speak: (text: string) => Promise<boolean>;
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
}

/** Mean jitter-buffer delay in ms from an inbound-rtp report (jitterBufferDelay is seconds summed per emitted unit). */
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
    const score = s / (sa * sb);
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  return best * stepMs;
}

/** Resample irregular samples onto a fixed grid (nearest previous sample). */
export function resample(samples: AvatarSample[], stepMs: number): { rms: number[]; motion: number[]; open: number[] } {
  if (samples.length < 2) return { rms: [], motion: [], open: [] };
  const t0 = samples[0].t;
  const t1 = samples[samples.length - 1].t;
  const rms: number[] = [];
  const motion: number[] = [];
  const open: number[] = [];
  let k = 0;
  for (let t = t0; t <= t1; t += stepMs) {
    while (k + 1 < samples.length && samples[k + 1].t <= t) k++;
    rms.push(samples[k].rms);
    motion.push(samples[k].motion);
    open.push(samples[k].open ?? 0);
  }
  return { rms, motion, open };
}

function waitForIce(pc: RTCPeerConnection, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") return resolve();
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === "complete") done();
    };
    pc.addEventListener("icegatheringstatechange", check);
    setTimeout(done, timeoutMs);
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
  let speakAt: number | null = null;
  const end = () => {
    if (ended) return;
    ended = true;
    stopSampler();
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
      samples.push({ t: now, rms, motion, open });
      if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
      if (speakAt != null && rms > 0.01 && metrics.speechStartMs == null) {
        metrics.speechStartMs = Math.round(now - speakAt);
        emit();
      }
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

  const speak = async (text: string): Promise<boolean> => {
    if (ended) return false;
    metrics.speechStartMs = null;
    const from = samples.length;
    speakAt = performance.now();
    const res = await api.avatarSpeak(session.session_id, text);
    if (!res.ok) return false;
    handle.lastSpeak = res.data;
    metrics.ttsMs = res.data.tts_ms;
    metrics.firstAudioMs = res.data.first_chunk_ms ?? null;
    metrics.provider = res.data.provider;
    emit();
    // Audio-to-lip offset over this utterance, once it has played for a while.
    const durationMs = res.data.audio_duration_ms ?? Math.max(1500, text.length * 60);
    setTimeout(() => {
      const win = samples.slice(from);
      // Openness (darkness of the mouth box), not frame-to-frame motion: with the idle head loop
      // the whole face moves a little all the time, which frame differences pick up everywhere,
      // while the mouth box's mean darkness changes only when the mouth opens.
      const { rms, open } = resample(win, 40);
      const lag = crossCorrelationLag(rms, open, 40);
      if (lag != null) {
        metrics.lipLagMs = lag;
        emit();
      }
    }, durationMs + 2500);
    return true;
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
    return out;
  };

  const handle: AvatarCallHandle = { session, metrics, samples, lastSpeak: null, speak, stats, end };
  return handle;
}
