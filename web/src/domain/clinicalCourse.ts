/**
 * AcuDx — live clinical course (vitals over time + treatment response).
 *
 * Derives the patient's *current* vitals by interpolating the case's baseline
 * `vitalsTrajectory` at the elapsed sim time, then layering the ramped effect of
 * each administered treatment on top. A coarse `courseStatus` classifies the
 * trend, and `vitalsSeries` samples the effective course for a trend monitor.
 *
 * Every function here is pure and deterministic: it takes an explicit
 * `elapsedMs` (never reads Date.now) and the same inputs always yield the same
 * output. Treatment effects come from the case's bespoke `treatmentResponses`
 * when present, otherwise from the generic physiology fallback.
 *
 * Education only. No real patient data path.
 */

import type { CaseInstance } from "@/domain/case";
import { genericEffect } from "@/domain/treatments";

export interface CurrentVitals {
  hr: number;
  systolic: number;
  diastolic: number;
  rr: number;
  spo2: number;
  tempC: number;
}

export type CourseStatus = "improving" | "stable" | "deteriorating" | "critical";

/** A treatment the learner has administered, at a sim-clock offset in ms. */
export interface AdministeredTreatment {
  code: string;
  at: number;
}

/* -------------------------------------------------------------------------- */
/* Physiologic bounds + helpers                                               */
/* -------------------------------------------------------------------------- */

const BOUNDS: Record<keyof CurrentVitals, { min: number; max: number }> = {
  hr: { min: 20, max: 250 },
  systolic: { min: 40, max: 300 },
  diastolic: { min: 20, max: 200 },
  rr: { min: 4, max: 60 },
  spo2: { min: 50, max: 100 },
  tempC: { min: 30, max: 43 },
};

function clampVital(key: keyof CurrentVitals, value: number): number {
  const b = BOUNDS[key];
  return Math.min(b.max, Math.max(b.min, value));
}

function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f;
}

/** Round a vital for display: tempC to 0.1, everything else to whole units. */
function roundVital(key: keyof CurrentVitals, value: number): number {
  return key === "tempC" ? Math.round(value * 10) / 10 : Math.round(value);
}

/**
 * Interpolate the baseline trajectory at `t` (clamped to the trajectory ends).
 * Falls back to triageVitals when the trajectory is empty. Returns unrounded
 * numbers so downstream treatment math stays precise.
 */
function baselineAt(c: CaseInstance, t: number): CurrentVitals {
  const traj = c.groundTruth.vitalsTrajectory;
  if (traj.length === 0) {
    const v = c.triageVitals;
    return { hr: v.hr, systolic: v.systolic, diastolic: v.diastolic, rr: v.rr, spo2: v.spo2, tempC: v.tempC };
  }
  const pts = [...traj].sort((a, b) => a.atMs - b.atMs);
  const first = pts[0];
  const last = pts[pts.length - 1];
  const pick = (p: (typeof pts)[number]): CurrentVitals => ({
    hr: p.hr,
    systolic: p.systolic,
    diastolic: p.diastolic,
    rr: p.rr,
    spo2: p.spo2,
    tempC: p.tempC,
  });
  if (t <= first.atMs) return pick(first);
  if (t >= last.atMs) return pick(last);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (t >= a.atMs && t <= b.atMs) {
      const span = b.atMs - a.atMs || 1;
      const f = (t - a.atMs) / span;
      return {
        hr: lerp(a.hr, b.hr, f),
        systolic: lerp(a.systolic, b.systolic, f),
        diastolic: lerp(a.diastolic, b.diastolic, f),
        rr: lerp(a.rr, b.rr, f),
        spo2: lerp(a.spo2, b.spo2, f),
        tempC: lerp(a.tempC, b.tempC, f),
      };
    }
  }
  return pick(last);
}

/** Effects for one administered treatment: bespoke response or generic fallback. */
function effectsFor(c: CaseInstance, code: string, baseline: CurrentVitals) {
  const bespoke = c.treatmentResponses?.find((r) => r.treatmentCode === code);
  if (bespoke) return bespoke.effects;
  return genericEffect(code, baseline);
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The patient's effective vitals at `elapsedMs`: baseline trajectory plus every
 * treatment's ramped effect (linear from its administration time over onsetMs),
 * clamped to physiologic bounds and rounded for display.
 */
export function currentVitals(
  c: CaseInstance,
  elapsedMs: number,
  treatments: AdministeredTreatment[],
): CurrentVitals {
  const base = baselineAt(c, elapsedMs);
  const acc: CurrentVitals = { ...base };

  for (const t of treatments) {
    if (t.at > elapsedMs) continue;
    const effects = effectsFor(c, t.code, base);
    for (const e of effects) {
      const onset = e.onsetMs > 0 ? e.onsetMs : 1;
      const frac = Math.min(1, Math.max(0, (elapsedMs - t.at) / onset));
      acc[e.key] = acc[e.key] + e.delta * frac;
    }
  }

  return {
    hr: roundVital("hr", clampVital("hr", acc.hr)),
    systolic: roundVital("systolic", clampVital("systolic", acc.systolic)),
    diastolic: roundVital("diastolic", clampVital("diastolic", acc.diastolic)),
    rr: roundVital("rr", clampVital("rr", acc.rr)),
    spo2: roundVital("spo2", clampVital("spo2", acc.spo2)),
    tempC: roundVital("tempC", clampVital("tempC", acc.tempC)),
  };
}

/** A coarse abnormality score — higher is sicker. */
function severity(v: CurrentVitals): number {
  let s = 0;
  if (v.spo2 < 94) s += 94 - v.spo2;
  if (v.systolic < 100) s += (100 - v.systolic) * 0.5;
  if (v.hr > 100) s += (v.hr - 100) * 0.3;
  if (v.hr < 50) s += (50 - v.hr) * 0.3;
  if (v.rr > 20) s += (v.rr - 20) * 0.5;
  if (v.tempC > 38) s += (v.tempC - 38) * 2;
  return s;
}

/**
 * Classify the trend from current vitals vs the encounter-start baseline, with
 * absolute danger thresholds taking precedence.
 */
export function courseStatus(
  c: CaseInstance,
  elapsedMs: number,
  treatments: AdministeredTreatment[],
): CourseStatus {
  const cur = currentVitals(c, elapsedMs, treatments);
  const base = currentVitals(c, 0, []);

  const critical = cur.spo2 < 85 || cur.systolic < 80 || cur.hr > 150 || cur.rr > 34 || cur.rr < 8;
  if (critical) return "critical";
  const danger = cur.spo2 < 90 || cur.systolic < 90 || cur.hr > 130;
  if (danger) return "deteriorating";

  const dv = severity(cur) - severity(base);
  if (dv <= -1.5) return "improving";
  if (dv >= 1.5) return "deteriorating";
  return "stable";
}

/**
 * Sample the effective vitals from 0..elapsedMs for a trend monitor. Steps by
 * `stepMs` (default ~5000), widening the step so the series never exceeds ~120
 * points. The final point always lands exactly on `elapsedMs`.
 */
export function vitalsSeries(
  c: CaseInstance,
  elapsedMs: number,
  treatments: AdministeredTreatment[],
  stepMs = 5_000,
): Array<{ atMs: number } & CurrentVitals> {
  const end = Math.max(0, elapsedMs);
  const cap = 120;
  const baseStep = Math.max(1, stepMs);
  const step = Math.max(baseStep, Math.ceil(end / (cap - 1)) || baseStep);

  const out: Array<{ atMs: number } & CurrentVitals> = [];
  for (let t = 0; t < end; t += step) {
    out.push({ atMs: t, ...currentVitals(c, t, treatments) });
  }
  out.push({ atMs: end, ...currentVitals(c, end, treatments) });
  return out;
}
