/**
 * audioLipsync: drive the talking head from the ACTUAL audio, not from text timing.
 *
 * A Web Audio AnalyserNode on the patient's <audio> element yields a time-domain
 * frame every animation tick; its RMS is smoothed into a jaw-opening envelope
 * (fast attack, slower release) and quantised into one of the mouth shapes the
 * renderer already understands (`MouthShape` from lipsync.ts), so the viseme
 * overlay and the talking-head clip follow the voice for exactly as long as the
 * audio plays. The pure functions are unit-tested; `createAnalyserEnvelope` is
 * the thin browser wrapper (one MediaElementSource per element, cached).
 */

import { mouthGeometry, type MouthShape } from "@/lib/lipsync";

/* -------------------------------------------------------------------------- */
/* Pure signal processing                                                      */
/* -------------------------------------------------------------------------- */

/** RMS (0..1) of an AnalyserNode byte time-domain frame (128 = silence). */
export function rmsFromTimeDomain(frame: ArrayLike<number>): number {
  const n = frame.length;
  if (n === 0) return 0;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const v = (frame[i] - 128) / 128;
    acc += v * v;
  }
  return Math.min(1, Math.sqrt(acc / n));
}

export interface EnvelopeOptions {
  /** RMS below this reads as silence (room noise, codec hiss). */
  noiseFloor?: number;
  /** RMS at or above this is a fully open jaw. */
  ceiling?: number;
  /** Smoothing toward a louder value (0..1 per tick; higher = snappier). */
  attack?: number;
  /** Smoothing toward a quieter value (0..1 per tick; lower = lingers). */
  release?: number;
}

const DEFAULTS: Required<EnvelopeOptions> = { noiseFloor: 0.015, ceiling: 0.22, attack: 0.65, release: 0.3 };

/**
 * Map one RMS reading onto a smoothed jaw opening 0..1 given the previous value.
 * Deterministic: the same (rms, prev) always yields the same jaw.
 */
export function envelopeToJaw(rms: number, prev: number, opts: EnvelopeOptions = {}): number {
  const o = { ...DEFAULTS, ...opts };
  const span = Math.max(1e-6, o.ceiling - o.noiseFloor);
  const target = Math.max(0, Math.min(1, (rms - o.noiseFloor) / span));
  const k = target > prev ? o.attack : o.release;
  const next = prev + (target - prev) * k;
  return next < 0.005 ? 0 : Math.min(1, next);
}

/**
 * Quantise a jaw opening into a mouth shape. Low openings alternate between
 * closed-lip and generic consonant postures on successive ticks so quiet speech
 * still reads as articulation; mid openings use the spread vowels, wide openings
 * the open/rounded ones. `tick` is any monotonically increasing counter.
 */
export function amplitudeToViseme(jaw: number, tick: number, prev: MouthShape = "rest"): MouthShape {
  if (jaw < 0.06) return "rest";
  if (jaw < 0.2) return tick % 4 < 2 ? "cons" : "mbp";
  if (jaw < 0.4) return tick % 6 < 3 ? "e" : "i";
  if (jaw < 0.7) return tick % 6 < 3 ? "o" : "aa";
  // Wide open: hold "aa" but let a rounded shape through briefly so it is not static.
  return tick % 8 === 0 && prev === "aa" ? "o" : "aa";
}

export interface VisemeFrame {
  rms: number;
  jaw: number;
  shape: MouthShape;
}

/**
 * Convert a whole sequence of RMS readings into frames (pure; used by tests and
 * by any offline pre-render of a clip).
 */
export function framesFromRms(readings: number[], opts: EnvelopeOptions = {}): VisemeFrame[] {
  const out: VisemeFrame[] = [];
  let jaw = 0;
  let shape: MouthShape = "rest";
  readings.forEach((rms, i) => {
    jaw = envelopeToJaw(rms, jaw, opts);
    shape = amplitudeToViseme(jaw, i, shape);
    out.push({ rms, jaw, shape });
  });
  return out;
}

/** Overlay geometry for a frame: how wide / tall / round the mouth overlay draws. */
export function overlayGeometry(frame: Pick<VisemeFrame, "jaw" | "shape">): { width: number; height: number; round: number } {
  const g = mouthGeometry(frame.shape);
  // Blend the shape's canonical jaw with the live envelope so loudness still shows
  // within a shape (a quiet "aa" is smaller than a shouted one).
  const open = Math.max(frame.jaw * 0.6 + g.jaw * 0.4, frame.jaw * 0.3);
  return { width: g.width, height: open, round: g.round };
}

/* -------------------------------------------------------------------------- */
/* Browser wrapper                                                             */
/* -------------------------------------------------------------------------- */

export interface AnalyserEnvelope {
  /** False when Web Audio is unavailable; callers fall back to text timing. */
  supported: boolean;
  /** Resume the context (call inside the gesture that starts playback). */
  start: () => void;
  /** Sample the current frame; cheap enough to call every animation tick. */
  read: () => VisemeFrame;
  /** Reset the envelope (between utterances). */
  reset: () => void;
}

interface Graph {
  ctx: AudioContext;
  analyser: AnalyserNode;
}

// One MediaElementSource may exist per element for its lifetime; keep the graph.
const graphs = new WeakMap<HTMLMediaElement, Graph>();

function graphFor(el: HTMLMediaElement): Graph | null {
  const existing = graphs.get(el);
  if (existing) return existing;
  const Ctor: typeof AudioContext | undefined =
    typeof AudioContext !== "undefined"
      ? AudioContext
      : (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    const ctx = new Ctor();
    const source = ctx.createMediaElementSource(el);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.4;
    source.connect(analyser);
    analyser.connect(ctx.destination);
    const g = { ctx, analyser };
    graphs.set(el, g);
    return g;
  } catch {
    return null;
  }
}

/**
 * Attach an analyser to the shared patient <audio> element. Audio keeps playing
 * through the context's destination, so the learner hears exactly what drives
 * the face.
 */
export function createAnalyserEnvelope(el: HTMLMediaElement, opts: EnvelopeOptions = {}): AnalyserEnvelope {
  const g = graphFor(el);
  if (!g) {
    const silent: VisemeFrame = { rms: 0, jaw: 0, shape: "rest" };
    return { supported: false, start: () => {}, read: () => silent, reset: () => {} };
  }
  const buf = new Uint8Array(g.analyser.fftSize);
  let jaw = 0;
  let shape: MouthShape = "rest";
  let tick = 0;
  return {
    supported: true,
    start: () => {
      if (g.ctx.state === "suspended") void g.ctx.resume().catch(() => {});
    },
    read: () => {
      g.analyser.getByteTimeDomainData(buf);
      const rms = rmsFromTimeDomain(buf);
      jaw = envelopeToJaw(rms, jaw, opts);
      shape = amplitudeToViseme(jaw, tick++, shape);
      return { rms, jaw, shape };
    },
    reset: () => {
      jaw = 0;
      shape = "rest";
      tick = 0;
    },
  };
}
