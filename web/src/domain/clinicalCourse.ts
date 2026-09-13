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
/* Untreated-deterioration overlay (time-critical cases only)                 */
/* -------------------------------------------------------------------------- */

const MIN = 60_000;

/** Reference midpoints used to decide which direction is "getting worse". */
const NORMAL_MID: Record<keyof CurrentVitals, number> = {
  hr: 75,
  systolic: 118,
  diastolic: 76,
  rr: 15,
  spo2: 98,
  tempC: 36.8,
};

/** Max extra excursion (magnitude) an untreated crash may add per vital. */
const OVERLAY_CAP: Record<keyof CurrentVitals, number> = {
  hr: 28,
  systolic: 34,
  diastolic: 16,
  rr: 10,
  spo2: 8,
  tempC: 1.2,
};

/** How much the case's own authored drift is amplified at full decompensation. */
const DRIFT_AMPLIFY = 1.25;

/** Codes that always count as resuscitative (oxygen, IV fluids). */
const UNIVERSAL_RESCUE = ["7806", "313002"];

/**
 * Condition-appropriate rescue treatment codes, derived from the case's
 * diagnosis + presentation keywords (mirrors the treatment catalog's RxNorm
 * ids). Oxygen + IV fluids always count as supportive resuscitation. A rescue
 * treatment is what halts the untreated-deterioration clock — the specific
 * pharmacologic appropriateness is scored elsewhere; here it only decides
 * whether the student "acted" on the crashing patient.
 */
function rescueCodesFor(c: CaseInstance): Set<string> {
  const dxCode = c.correctDiagnosis?.code.coding[0]?.code ?? "";
  const hay = [
    dxCode,
    c.correctDiagnosis?.code.coding[0]?.display,
    c.correctDiagnosis?.code.text?.en,
    c.correctDiagnosis?.code.text?.tr,
    c.chiefComplaint?.en,
    c.chiefComplaint?.tr,
    ...(c.redFlags ?? []).flatMap((r) => [r.en, r.tr]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const kw = (...ks: string[]) => ks.some((k) => hay.includes(k));
  const s = new Set<string>(UNIVERSAL_RESCUE);
  if (/^i2[01]/.test(dxCode) || kw("myocardial", "coronary", "nstemi", "stemi", "angina", "miyokart", "koroner")) {
    s.add("1191"); // aspirin
    s.add("4917"); // nitroglycerin
  }
  if (/^i50/.test(dxCode) || kw("heart failure", "pulmonary oedema", "pulmonary edema", "kalp yetmez"))
    s.add("4917"); // nitroglycerin (preload reduction)
  if (kw("subarachnoid", "haemorrhage", "hemorrhage", "subaraknoid", "kanama", "stroke", "inme"))
    s.add("4917"); // vasodilator proxy for blood-pressure control
  if (kw("sepsis", "septic", "sepsi", "septik", "pneumonia", "pnömoni", "pnomoni", "meningitis", "menenjit", "urinary", "pyelonephritis", "idrar", "piyelonefrit", "cholangitis", "kolanjit"))
    s.add("2193"); // ceftriaxone
  if (kw("ketoacidosis", "ketoasidoz", "diabetic keto", "hyperglyc")) s.add("5856"); // insulin
  if (kw("asthma", "astım", "astim", "copd", "koah", "bronchospasm", "bronkospazm", "wheeze")) s.add("435"); // salbutamol
  if (kw("anaphyla", "anafilaks")) s.add("3992"); // adrenaline
  if (kw("opioid", "overdose", "aşırı doz", "asiri doz", "naloxone")) s.add("7242"); // naloxone
  if (kw("supraventricular", "tachyarrhythmia", "taşiaritmi", "tasiaritmi") || / svt|^svt/.test(hay)) s.add("448"); // adenosine
  if (kw("seizure", "epilepticus", "nöbet", "nobet", "status epilep")) s.add("6470"); // lorazepam
  return s;
}

export interface DeteriorationProfile {
  /** Grace period (from the case's ideal critical-action window) before drift. */
  graceMs: number;
  /** Time from grace to full (level = 1) decompensation. */
  rampMs: number;
  /** Time over which a rescue reverses the accrued deterioration. */
  recoverMs: number;
  /** Fraction of the accrued level a full recovery removes (residual injury). */
  recoverFraction: number;
  /** Treatment codes that halt the deterioration clock. */
  rescueCodes: Set<string>;
  /** Signed max delta per vital at full untreated decompensation. */
  overlay: Partial<Record<keyof CurrentVitals, number>>;
}

const PROFILE_CACHE = new Map<string, DeteriorationProfile | null>();

/**
 * A time-critical case's untreated-deterioration profile, or null when the case
 * has no defined deterioration path (it then stays exactly on its authored
 * trajectory + treatment ramps). Gate: ESI acuity ≤ 2 AND at least one
 * safety-critical expected-workup item — i.e. a genuine "minutes matter" case.
 *
 * The decompensation DIRECTION is the case's own authored trajectory drift
 * (amplified, capped), applied only to vitals that end abnormal AND are still
 * moving away from normal — so the overlay follows how THIS patient is authored
 * to worsen (e.g. rising BP in SAH, falling SpO2 in PE) and can never
 * accelerate a spontaneous recovery. All excursions stay physiologically
 * bounded via OVERLAY_CAP + the clampVital bounds applied downstream.
 */
export function deteriorationProfile(c: CaseInstance): DeteriorationProfile | null {
  const cached = typeof c.id === "string" ? PROFILE_CACHE.get(c.id) : undefined;
  if (cached !== undefined) return cached;

  const compute = (): DeteriorationProfile | null => {
    const workup = c.expectedWorkup;
    if (c.acuityESI == null || c.acuityESI > 2 || !workup) return null;
    const criticalWindows = workup.filter((w) => w.critical).map((w) => w.idealWindowMs);
    if (criticalWindows.length === 0) return null;

    const first = baselineAt(c, 0);
    const last = baselineAt(c, Number.MAX_SAFE_INTEGER);
    const overlay: Partial<Record<keyof CurrentVitals, number>> = {};
    let anyWorsening = false;
    for (const key of Object.keys(NORMAL_MID) as (keyof CurrentVitals)[]) {
      const drift = last[key] - first[key];
      if (drift === 0) continue;
      // Only amplify a vital that ends abnormal and is drifting further from normal.
      if (Math.sign(last[key] - NORMAL_MID[key]) !== Math.sign(drift)) continue;
      overlay[key] = Math.sign(drift) * Math.min(Math.abs(drift) * DRIFT_AMPLIFY, OVERLAY_CAP[key]);
      anyWorsening = true;
    }
    if (!anyWorsening) return null;

    const graceMs = Math.min(Math.max(Math.min(...criticalWindows), 5 * MIN), 20 * MIN);
    return {
      graceMs,
      rampMs: 25 * MIN,
      recoverMs: 20 * MIN,
      recoverFraction: 0.8,
      rescueCodes: rescueCodesFor(c),
      overlay,
    };
  };

  const profile = compute();
  if (typeof c.id === "string") PROFILE_CACHE.set(c.id, profile);
  return profile;
}

/** Earliest administration time of any rescue treatment, or null. */
function earliestRescueAt(profile: DeteriorationProfile, treatments: AdministeredTreatment[]): number | null {
  let at: number | null = null;
  for (const t of treatments) {
    if (!profile.rescueCodes.has(t.code)) continue;
    at = at == null ? t.at : Math.min(at, t.at);
  }
  return at;
}

/**
 * The 0..1 severity of untreated decompensation at `elapsedMs`. Zero until the
 * grace window (anchored to the case's ideal critical-action window) elapses,
 * then ramps toward 1. A rescue treatment freezes the level at the value it had
 * reached by then and decays it toward a residual floor — so acting BEFORE the
 * window prevents deterioration entirely, while a late rescue only partly
 * reverses it. Never acting lets the level climb (and hold) at its ceiling.
 */
export function deteriorationLevel(
  profile: DeteriorationProfile,
  elapsedMs: number,
  treatments: AdministeredTreatment[],
): number {
  const t = Math.max(0, elapsedMs);
  const ramp = (x: number) => Math.min(1, Math.max(0, (x - profile.graceMs) / profile.rampMs));
  const rescueAt = earliestRescueAt(profile, treatments);
  if (rescueAt == null || t <= rescueAt) return ramp(t);
  const peak = ramp(rescueAt);
  const recovered = Math.min(1, Math.max(0, (t - rescueAt) / profile.recoverMs));
  return peak * (1 - profile.recoverFraction * recovered);
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The patient's effective vitals at `elapsedMs`: baseline trajectory plus every
 * treatment's ramped effect (linear from its administration time over onsetMs),
 * then any untreated-deterioration overlay for a time-critical case, clamped to
 * physiologic bounds and rounded for display.
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

  // Untreated time-critical illness drifts further from normal once its ideal
  // action window has passed; a timely rescue treatment halts (and partly
  // reverses) that drift. Cases with no deterioration path skip this entirely.
  const profile = deteriorationProfile(c);
  if (profile) {
    const level = deteriorationLevel(profile, elapsedMs, treatments);
    if (level > 0) {
      for (const key of Object.keys(profile.overlay) as (keyof CurrentVitals)[]) {
        acc[key] += (profile.overlay[key] ?? 0) * level;
      }
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
