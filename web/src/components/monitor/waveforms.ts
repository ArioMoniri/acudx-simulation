/**
 * AcuDx — bedside monitor waveform helpers.
 *
 * Pure, deterministic generators that turn a physiologic rate (and an absolute
 * `timeSec` "phase") into an SVG path string for a rolling trace window. The
 * same inputs always produce the same path — no Date.now, no randomness — so a
 * requestAnimationFrame loop can scroll the trace simply by advancing `timeSec`,
 * and a reduced-motion fallback can render one representative frame at a fixed
 * `timeSec`.
 *
 * Coordinate convention: SVG pixel space, y grows downward, so a HIGHER
 * physiologic value maps to a SMALLER y (value is drawn upward from a baseline).
 * The visible window shows the most recent `windowSec` seconds; x=0 is the
 * oldest sample, x=width the newest, so the wave appears to scroll leftward as
 * `timeSec` increases.
 *
 * Education only. No real patient data path.
 */

/** Shared inputs for every waveform path builder. */
export interface WaveformSpec {
  /** Logical viewport width in px (path x spans 0..width). */
  width: number;
  /** Logical viewport height in px (path y spans 0..height). */
  height: number;
  /**
   * Cycle rate in Hz (cycles per second): HR/60 for ECG, pleth and arterial
   * BP; RR/60 for respiration. Values <= 0 render a flat isoelectric line.
   */
  rateHz: number;
  /**
   * Absolute elapsed seconds. Advancing this scrolls the trace; it is the
   * deterministic "phase" input — a given `timeSec` always yields one path.
   */
  timeSec: number;
  /** Seconds of trace visible across the width (default 4.5). */
  windowSec?: number;
  /** Number of x samples along the width (default ≈ width, capped). */
  samples?: number;
  /** 0..1 vertical amplitude of the trace within the band (default 1). */
  amplitude?: number;
  /** Vertical baseline as a fraction of height (per-shape default). */
  baseline?: number;
}

/* -------------------------------------------------------------------------- */
/* Rate helpers                                                               */
/* -------------------------------------------------------------------------- */

/** Convert a heart rate (bpm) to cycles per second. */
export function hrToHz(hr: number): number {
  return hr > 0 ? hr / 60 : 0;
}

/** Convert a respiratory rate (breaths/min) to cycles per second. */
export function rrToHz(rr: number): number {
  return rr > 0 ? rr / 60 : 0;
}

/**
 * SpO₂ → pleth amplitude hint (0.25..1). A low saturation flattens the
 * plethysmograph, mirroring a weak/attenuated pulse signal on a real monitor.
 */
export function spo2ToAmplitude(spo2: number): number {
  const f = (spo2 - 70) / 30; // 70% → 0, 100% → 1
  return clamp(0.25 + 0.75 * clamp(f, 0, 1), 0.25, 1);
}

/* -------------------------------------------------------------------------- */
/* Shape functions — one cardiac/respiratory cycle, phase p in [0, 1)         */
/* -------------------------------------------------------------------------- */

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Unit gaussian bump centered at `c` with standard deviation `w`. */
function gauss(p: number, c: number, w: number): number {
  const d = p - c;
  return Math.exp(-(d * d) / (2 * w * w));
}

/** Fractional part in [0, 1). */
function frac(x: number): number {
  return x - Math.floor(x);
}

/**
 * ECG lead-II morphology as a function of cycle phase (0..1). Sum of gaussian
 * P, Q, R, S and T deflections; R peak ≈ 1.0, isoelectric ≈ 0. Continuous and
 * ≈0 at the cycle boundary so scrolling never shows a seam.
 */
export function ecgShape(p: number): number {
  const q = frac(p);
  return (
    0.12 * gauss(q, 0.16, 0.022) - // P wave
    0.06 * gauss(q, 0.335, 0.012) + // Q
    1.0 * gauss(q, 0.365, 0.0075) - // R spike
    0.2 * gauss(q, 0.4, 0.012) + // S
    0.28 * gauss(q, 0.6, 0.034) // T wave
  );
}

/**
 * Photoplethysmograph / arterial pulse morphology (0..1): a steep systolic
 * upstroke and a smaller dicrotic bump. Used for the SpO₂ pleth lane and, scaled
 * between diastolic and systolic, the arterial BP lane.
 */
export function plethShape(p: number): number {
  const q = frac(p);
  return 0.92 * gauss(q, 0.24, 0.085) + 0.3 * gauss(q, 0.46, 0.06);
}

/** Respiration morphology (-1..1): a smooth sinusoid over the breath cycle. */
export function respShape(p: number): number {
  return Math.sin(2 * Math.PI * frac(p));
}

/* -------------------------------------------------------------------------- */
/* Path builder                                                               */
/* -------------------------------------------------------------------------- */

interface BuildOptions {
  /** Per-shape vertical gain (fraction of half-height at amplitude=1). */
  gain: number;
  /** Default baseline fraction if the spec omits one. */
  baseline: number;
}

function sampleCount(spec: WaveformSpec): number {
  const fallback = Math.round(spec.width);
  const n = spec.samples ?? fallback;
  return Math.max(2, Math.min(600, n));
}

/** Flat isoelectric line at the baseline — used when the rate is unknown/zero. */
export function flatlinePath(width: number, height: number, baseline = 0.5): string {
  const y = (height * baseline).toFixed(1);
  return `M 0,${y} L ${width.toFixed(1)},${y}`;
}

/**
 * Core builder: sample `shape` across the visible window and emit an SVG path.
 * `timeSec` scrolls the window; each x maps to a sample time, whose fractional
 * position within the cycle drives the shape value.
 */
function buildPath(
  spec: WaveformSpec,
  shape: (p: number) => number,
  opts: BuildOptions,
): string {
  const { width, height, rateHz, timeSec } = spec;
  const windowSec = spec.windowSec ?? 4.5;
  const amplitude = spec.amplitude ?? 1;
  const baselineFrac = spec.baseline ?? opts.baseline;

  if (!(rateHz > 0) || !(width > 0) || !(height > 0)) {
    return flatlinePath(Math.max(1, width), Math.max(1, height), baselineFrac);
  }

  const n = sampleCount(spec);
  const baselineY = height * baselineFrac;
  const gainPx = height * 0.5 * opts.gain * clamp(amplitude, 0, 1);
  const startTime = timeSec - windowSec;

  let d = "";
  for (let i = 0; i <= n; i++) {
    const fx = i / n;
    const x = fx * width;
    const sampleTime = startTime + fx * windowSec;
    const p = sampleTime * rateHz; // cycles elapsed; shape takes its frac
    const y = baselineY - shape(p) * gainPx;
    d += `${i === 0 ? "M" : "L"} ${x.toFixed(1)},${y.toFixed(1)} `;
  }
  return d.trimEnd();
}

/** ECG lead-II trace path (rate from HR). */
export function ecgPath(spec: WaveformSpec): string {
  return buildPath(spec, ecgShape, { gain: 0.82, baseline: 0.62 });
}

/** Photoplethysmograph trace path (rate from HR, amplitude hint from SpO₂). */
export function plethPath(spec: WaveformSpec): string {
  return buildPath(spec, plethShape, { gain: 0.86, baseline: 0.74 });
}

/** Arterial blood-pressure trace path (rate from HR). */
export function arterialPath(spec: WaveformSpec): string {
  return buildPath(spec, plethShape, { gain: 0.8, baseline: 0.72 });
}

/** Respiration trace path (rate from RR). */
export function respirationPath(spec: WaveformSpec): string {
  return buildPath(spec, respShape, { gain: 0.62, baseline: 0.5 });
}
