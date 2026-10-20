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
 * Review 06b (one shared physiology model): a case bound to a course rule
 * (`CaseInstance.course`, set from the generated spec) runs the same engine as
 * the server Clinical Director (`server/orchestration/course.py`) over the
 * generated tables in `courseTables.generated.ts`: per-condition severity that
 * keeps rising untreated, guideline targets, harms, branches and the explicit
 * cardiac-arrest state. The server is authoritative in Live mode; this mirror
 * is what the browser shows offline and between Director steps. A case with no
 * binding (curated seed cases, conditions with no course rule) keeps the
 * trajectory model below.
 *
 * Education only. No real patient data path.
 */

import type { CaseInstance } from "@/domain/case";
import { adverseEffectForContraindicated, classify, genericEffect } from "@/domain/treatments";
import { fluidsGate, gateFor, isAnaphylaxis, isOpioidToxidrome } from "@/domain/treatmentRules";
import { FORMULARY_ROW_STEMS, isOmissionRow, matchTreatmentResponse } from "@/domain/treatmentMatch";
import { COURSE_TABLES } from "@/domain/courseTables.generated";

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

/**
 * Effects for one administered treatment: the case's bespoke response, else the
 * gated generic fallback.
 *
 * Review 02 finding 28: a treatment the case authored as CONTRAINDICATED with no
 * explicit effects acts ADVERSELY (fluids in pulmonary oedema: SpO2 falls, RR
 * rises) rather than neutrally. Review 02 finding 8 / 36: nitrates and naloxone
 * are gated on the case and the vitals at the moment of administration.
 */
function effectsFor(
  c: CaseInstance,
  code: string,
  baseline: CurrentVitals,
  treatments: AdministeredTreatment[],
  at: number,
) {
  const bespoke = matchTreatmentResponse(c, code);
  if (bespoke) {
    if (bespoke.appropriateness === "contraindicated" && bespoke.effects.length === 0) {
      return adverseEffectForContraindicated(code);
    }
    return bespoke.effects;
  }
  const gate = gateFor(code, c, baseline, treatments, at);
  if (gate && !gate.allowed) {
    // A gate-blocked nitrate / naloxone / insulin has NO effect (the error is
    // scored on the event); fluids given against the pulmonary-oedema gate act
    // adversely, as the review asks (finding 28).
    return classify(code) === "fluids" && gate.appropriateness === "contraindicated"
      ? adverseEffectForContraindicated(code)
      : [];
  }
  const opioidOnBoard =
    isOpioidToxidrome(c) || treatments.some((t) => t.at <= at && classify(t.code) === "opioid");
  return genericEffect(code, baseline, {
    nitrateAllowed: gate?.allowed,
    opioidOnBoard,
    anaphylaxis: isAnaphylaxis(c),
  });
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

/** Codes that count as supportive resuscitation (oxygen, IV fluids) when not contraindicated. */
const SUPPORTIVE_RESCUE = ["7806", "313002"];

/**
 * Condition-appropriate rescue treatment codes. When the case carries authored
 * treatment responses, the rescue set is exactly its `indicated` codes
 * (review 02 finding 28: derive rescue from the authored treatments, never let
 * a contraindicated item act as a rescue). Otherwise it is derived from the
 * diagnosis + presentation keywords (mirrors the treatment catalog's RxNorm
 * ids), with oxygen and IV fluids counted as supportive resuscitation only
 * where the fluids gate allows them (not in pulmonary oedema). A rescue
 * treatment is what halts the untreated-deterioration clock — the specific
 * pharmacologic appropriateness is scored elsewhere; here it only decides
 * whether the student "acted" on the crashing patient.
 *
 * Review 02 finding 8: nitroglycerin is NOT a rescue for haemorrhage or stroke
 * (SAH/ICH BP control uses titratable agents; GI bleed and PPH need haemorrhage
 * control). Review 02 finding 7: anaphylaxis rescue is IM adrenaline (3992-im).
 * Review 02 finding 28: naloxone is a rescue only for an opioid toxidrome, not
 * for "overdose" in general (paracetamol, TCA).
 */
export function rescueCodesFor(c: CaseInstance): Set<string> {
  const authored = c.treatmentResponses ?? [];
  if (authored.length > 0) {
    const s = new Set<string>(authored.filter((r) => r.appropriateness === "indicated").map((r) => r.treatmentCode));
    // D-20: formulary drugs that stand for an indicated row are rescues too.
    for (const code of Object.keys(FORMULARY_ROW_STEMS).filter((k) => k !== "161" && k !== "7052")) {
      if (matchTreatmentResponse(c, code)?.appropriateness === "indicated") s.add(code);
    }
    const contraindicated = new Set(authored.filter((r) => r.appropriateness === "contraindicated").map((r) => r.treatmentCode));
    for (const code of SUPPORTIVE_RESCUE) {
      if (contraindicated.has(code)) continue;
      if (code === "313002" && !fluidsGate(c).allowed) continue;
      s.add(code);
    }
    return s;
  }
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
  const s = new Set<string>();
  s.add("7806"); // oxygen
  if (fluidsGate(c).allowed) s.add("313002"); // IV fluids (not in pulmonary oedema)
  if (/^i2[01]/.test(dxCode) || kw("myocardial", "coronary", "nstemi", "stemi", "angina", "miyokart", "koroner")) {
    s.add("1191"); // aspirin
    s.add("4917"); // nitroglycerin (ischaemic chest pain; gated on vitals at administration)
  }
  if (/^i50/.test(dxCode) || kw("heart failure", "pulmonary oedema", "pulmonary edema", "kalp yetmez"))
    s.add("4917"); // nitroglycerin (preload reduction in acute pulmonary oedema)
  if (kw("sepsis", "septic", "sepsi", "septik", "pneumonia", "pnömoni", "pnomoni", "meningitis", "menenjit", "urinary", "pyelonephritis", "idrar", "piyelonefrit", "cholangitis", "kolanjit"))
    s.add("2193"); // ceftriaxone
  if (kw("ketoacidosis", "ketoasidoz", "diabetic keto", "hyperglyc")) s.add("5856"); // insulin
  if (kw("asthma", "astım", "astim", "copd", "koah", "bronchospasm", "bronkospazm", "wheeze")) s.add("435"); // salbutamol
  if (kw("anaphyla", "anafilaks")) s.add("3992-im"); // IM adrenaline 0.5 mg (first line)
  if (isOpioidToxidrome(c)) s.add("7242"); // naloxone (opioid toxidrome only)
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
  const snap = courseSnapshot(c, elapsedMs, treatments);
  if (snap) return snap.vitals;
  const base = baselineAt(c, elapsedMs);
  const acc: CurrentVitals = { ...base };

  for (const t of treatments) {
    if (t.at > elapsedMs) continue;
    // Gate on the vitals at the moment of administration (the baseline at t.at
    // plus whatever earlier treatments had already changed is approximated by
    // the baseline at t.at — pure and cheap).
    const effects = effectsFor(c, t.code, baselineAt(c, t.at), treatments, t.at);
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

/**
 * A coarse abnormality score — higher is sicker. Review 02 finding 41:
 * symmetric penalties for hypertension (SBP > 180, DBP > 120), hypothermia
 * (< 35C), hyperthermia (> 40C) and bradypnoea (RR < 10), so a hypertensive
 * emergency at 230/130 no longer reads "stable" (ACC/AHA 2017,
 * https://doi.org/10.1161/HYP.0000000000000065).
 */
export function severity(v: CurrentVitals): number {
  let s = 0;
  if (v.spo2 < 94) s += 94 - v.spo2;
  if (v.systolic < 100) s += (100 - v.systolic) * 0.5;
  if (v.systolic > 180) s += (v.systolic - 180) * 0.3;
  if (v.diastolic > 120) s += (v.diastolic - 120) * 0.3;
  if (v.hr > 100) s += (v.hr - 100) * 0.3;
  if (v.hr < 50) s += (50 - v.hr) * 0.3;
  if (v.rr > 20) s += (v.rr - 20) * 0.5;
  if (v.rr < 10) s += (10 - v.rr) * 1.0;
  if (v.tempC > 38) s += (v.tempC - 38) * 2;
  if (v.tempC > 40) s += (v.tempC - 40) * 3;
  if (v.tempC < 35) s += (35 - v.tempC) * 2;
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
  const snap = courseSnapshot(c, elapsedMs, treatments);
  if (snap) {
    if (snap.phase === "arrest" || snap.phase === "peri_arrest") return "critical";
    if (snap.phase === "deteriorating") return "deteriorating";
    if (snap.phase === "improving") return "improving";
    return "stable";
  }
  const cur = currentVitals(c, elapsedMs, treatments);
  const base = currentVitals(c, 0, []);

  const critical =
    cur.spo2 < 85 || cur.systolic < 80 || cur.hr > 150 || cur.rr > 34 || cur.rr < 8 ||
    cur.systolic > 220 || cur.tempC < 32 || cur.tempC > 41;
  if (critical) return "critical";
  const danger =
    cur.spo2 < 90 || cur.systolic < 90 || cur.hr > 130 || cur.hr < 40 ||
    cur.systolic > 180 || cur.diastolic > 120 || cur.tempC < 35 || cur.tempC > 40 || cur.rr < 10;
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

/* ========================================================================== */
/* Shared course engine (review 06b): line-by-line mirror of                  */
/* server/orchestration/course.py over the generated tables                   */
/* (courseTables.generated.ts). The server is authoritative in Live mode;     */
/* this mirror runs offline and between Director steps, and                   */
/* clinicalCourseParity.test.ts replays the server's fixture through it.      */
/* ========================================================================== */

type Num = number;
type Dict<T> = Record<string, T>;

export interface CourseCond {
  k: string;
  op: string;
  v: number;
}
export interface CourseGroup {
  id: string;
  codes: string[];
  classes: string[];
  needs: string[];
  modifies: boolean;
  active_min: number | null;
  recover_h: number | null;
  lag_min: number | null;
  label_en: string;
  label_tr: string;
}
export interface CourseTarget {
  id: string;
  group: string;
  by_min: number;
  source: string;
  basis: string;
  type?: string;
  after_min?: number;
  grace_min?: number;
  when?: CourseCond[];
}
export interface CourseBranch {
  id: string;
  to: string;
  when: CourseCond[];
  p: number;
  window: number[] | null;
  supersede: boolean;
  s_start: number | null;
  lactate_min: number | null;
  arrest: string | null;
  rate_h: number | null;
  why_en: string;
  why_tr: string;
  say_en: string;
  say_tr: string;
}
export interface CourseFinding {
  id: string;
  exam: string;
  when: CourseCond[];
  en: string;
  tr: string;
}
export interface CourseRowHarm {
  effects: Dict<number>;
  onset_min: number;
  rate_mult: number;
  arrest: string | null;
  p: number;
  branch: string | null;
  en: string;
  tr: string;
}
export interface CourseRule {
  id: string;
  pattern: string;
  fallback?: boolean;
  s0: number;
  rate_h: number;
  recover_h: number;
  floor: number;
  lag_min: number;
  arrest_rhythm: string | null;
  start_arrest: string | null;
  fluid: string;
  fluid_limit_ml: number | null;
  fluid_persistent: boolean;
  o2_response: number;
  hypercapnic: boolean;
  metabolic: string | null;
  resolve_below: number | null;
  peri: Dict<number>;
  well: Dict<number>;
  bedside0: Dict<number>;
  groups: CourseGroup[];
  targets: CourseTarget[];
  branches: CourseBranch[];
  findings: CourseFinding[];
  harm_rules: string[];
  row_classes: Dict<string[]>;
  row_harms: Dict<CourseRowHarm>;
}
export interface ClassEffect {
  effects: Dict<number>;
  onset: number;
  wane: number[] | null;
  source: string;
}
export interface CourseTables {
  rules: Dict<CourseRule>;
  stable: CourseRule;
  classEffects: Dict<ClassEffect>;
  labRates: Dict<number | string>;
  codeClasses: Dict<string[]>;
  agentCoverage: Dict<string[]>;
  agentAllergyClass: Dict<string>;
  rowClasses: Dict<string[]>;
  handledClasses: string[];
  bounds: Dict<number[]>;
  defaultBedside: Dict<number>;
  icd10: Dict<string>;
  sources: Dict<string>;
}

export interface CourseEvent {
  kind?: string;
  code: string;
  row?: string;
  at_ms: number;
  seq?: number;
  classes?: string[];
  agents?: string[];
  allergy_class?: string;
  volume_ml?: number;
  appropriateness?: string;
  effects?: Array<{ key: string; delta: number; onsetMs: number }>;
  label?: string;
}
export interface CoursePatient {
  weight_kg?: number;
  age?: number;
  flags?: string[];
  allergies?: Array<{ agent_class: string; reaction: string }>;
  difficulty?: number;
  curb65?: number;
}
export interface CourseInput {
  condition_id: string;
  t0: Dict<number>;
  seed: number | string;
  patient?: CoursePatient;
  events?: CourseEvent[];
  trajectory?: Array<Dict<number>>;
  library?: Dict<CourseRule>;
}
export interface CourseSnapshot {
  t_ms: number;
  vitals: CurrentVitals;
  bedside: {
    map: number;
    gcs: number;
    avpu: string;
    cbg: number;
    k: number;
    lactate: number;
    crt_s: number;
    mottling: number;
    skin: string;
    urine_ml_h: number;
    pain: number;
    airway: string;
    rhythm: string;
    pulse: boolean;
    fluid_in_ml: number;
    o2: boolean;
    news2: number;
  };
  severity: number;
  phase: "stable" | "improving" | "deteriorating" | "peri_arrest" | "arrest";
  processes: Array<{ id: string; s: number; onset_ms: number; superseded: boolean; resolved: boolean; primary: boolean; why_en: string; why_tr: string }>;
  active_diagnoses: string[];
  harms: Array<{ id: string; at_ms: number; why_en: string; why_tr: string; src: string }>;
  targets: Array<Dict<unknown>>;
  findings: Array<{ id: string; at_ms: number; exam: string; en: string; tr: string }>;
  log: Array<Dict<unknown>>;
  pressor_on: boolean;
}

const MIN_MS = 60_000;
const C_VITALS = ["hr", "systolic", "diastolic", "rr", "spo2", "tempC"] as const;
const C_BED = ["gcs", "crt", "mottle", "urine", "pain"] as const;
const C_ANCHORS = [...C_VITALS, ...C_BED];
const ARREST_SUSTAIN_MIN = 3;

/** Half-up rounding identical to course.py `rnd`. */
export function rnd(x: Num, d = 0): Num {
  const f = 10 ** d;
  return Math.floor(x * f + 0.5) / f;
}
function clampN(x: Num, lo: Num, hi: Num): Num {
  return x < lo ? lo : x > hi ? hi : x;
}
export function fnv1a(text: string): Num {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h ^= c < 128 ? c : 63;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
export function u01(seed: unknown, ...parts: string[]): Num {
  return fnv1a([String(seed), ...parts].join("|")) / 4294967296;
}
function meanAp(sbp: Num, dbp: Num): Num {
  return (sbp + 2 * dbp) / 3;
}
export function courseCurve(dt: Num, onset: Num, wane: number[] | null): Num {
  if (dt <= 0) return 0;
  const up = onset <= 0 ? 1 : Math.min(1, dt / onset);
  if (wane == null) return up;
  const [w0, w1] = wane;
  if (dt <= w0) return up;
  if (dt >= w1) return 0;
  return up * (1 - (dt - w0) / (w1 - w0));
}
function cmp(a: Num, op: string, b: Num): boolean {
  switch (op) {
    case ">=": return a >= b;
    case "<=": return a <= b;
    case ">": return a > b;
    case "<": return a < b;
    case "==": return a === b;
    default: return a !== b;
  }
}

function fallbackRule(cid: string): CourseRule {
  return { ...structuredCloneSafe(COURSE_TABLES.stable), id: cid, fallback: true };
}
function structuredCloneSafe<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

const LIB_CACHE = new Map<string, Dict<CourseRule>>();

/** Mirror of course.library_for: the rule plus every rule its branches can open. */
export function courseLibrary(cid: string): Dict<CourseRule> {
  const hit = LIB_CACHE.get(cid);
  if (hit) return hit;
  const out: Dict<CourseRule> = {};
  const rules = COURSE_TABLES.rules;
  if (!(cid in rules)) out[cid] = fallbackRule(cid);
  const queue = [cid, "anaphylaxis_iatrogenic", "hypoglycemia"];
  while (queue.length) {
    const nxt = queue.pop() as string;
    if (!nxt || nxt in out) continue;
    const rule = rules[nxt];
    if (!rule) continue;
    out[nxt] = rule;
    for (const b of rule.branches) queue.push(b.to || "");
    for (const h of Object.values(rule.row_harms)) queue.push(h.branch || "");
    if (rule.harm_rules.includes("beta_blocker_killip")) queue.push("cardiogenic_shock");
    if (rule.harm_rules.includes("lp_before_ct")) queue.push("herniation");
    if (rule.hypercapnic) queue.push("type2_respiratory_failure");
    if (rule.fluid === "rv") queue.push("pe_high_risk");
  }
  LIB_CACHE.set(cid, out);
  return out;
}

interface Proc {
  id: string;
  s: Num;
  s_start: Num;
  start: Num;
  v_start: Dict<Num>;
  superseded: boolean;
  resolved: boolean;
  rate_mult: Num;
  why_en: string;
  why_tr: string;
  primary: boolean;
  trend: Num;
  rate_h: Num;
}
interface Eff {
  key: string;
  delta: Num;
  at_ms: Num;
  onset: Num;
  wane: number[] | null;
  src: string;
}
interface Pending {
  at: Num;
  to: string;
  parent: string;
  why_en: string;
  why_tr: string;
  supersede: boolean;
  s_start?: Num;
  say_en?: string;
  say_tr?: string;
}
interface Arrest {
  rhythm: string;
  at: Num;
  cause: string;
  why: string;
  shock_at: Num | null;
  adrenaline_at: Num | null;
}

class CourseSim {
  private lib: Dict<CourseRule>;
  private seed: unknown;
  private weight: Num;
  private age: Num;
  private flags: string[];
  private allergies: Array<{ agent_class: string; reaction: string }>;
  private difficulty: Num;
  private curb65: Num;
  private t0: Dict<Num>;
  private traj: Array<Dict<number>>;
  private events: CourseEvent[];
  private procs: Proc[] = [];
  private effects: Eff[] = [];
  private harms: CourseSnapshot["harms"] = [];
  private log: Array<Dict<unknown>> = [];
  private findings: CourseSnapshot["findings"] = [];
  private targets = new Map<string, Dict<unknown>>();
  private pending: Pending[] = [];
  private fluidMl = 0;
  private fluidFirstHour = 0;
  private classDoses: Dict<Num[]> = {};
  private coverage: Dict<Set<string>> = {};
  private met: Dict<Num> = {};
  private activeDoses: Dict<Num[]> = {};
  private pressorStart: Num | null = null;
  private insulinStart: Num | null = null;
  private dextroseStart: Num | null = null;
  private kReplaceStart: Num | null = null;
  private dextroseBoluses: Num[] = [];
  private kDrops: Num[] = [];
  private dialysisStart: Num | null = null;
  private oxygenOn = false;
  private lactate: Num;
  private cbg: Num;
  private k: Num;
  private lowMapRun = 0;
  private lowSpo2Run = 0;
  private arrest: Arrest | null = null;
  private transient: [string, Num] | null = null;
  private ctDone = false;
  private cid: string;

  constructor(inp: CourseInput) {
    this.cid = String(inp.condition_id);
    this.lib = inp.library ?? courseLibrary(this.cid);
    this.seed = inp.seed ?? 0;
    const pat = inp.patient ?? {};
    this.weight = Number(pat.weight_kg || 70);
    this.age = Number(pat.age || 45);
    this.flags = [...(pat.flags ?? [])];
    this.allergies = [...(pat.allergies ?? [])];
    this.difficulty = Number(pat.difficulty || 3);
    this.curb65 = Number(pat.curb65 || 0);
    const t0 = inp.t0;
    const rule0 = this.lib[this.cid];
    const bedRule = rule0.bedside0 ?? {};
    this.t0 = {};
    for (const k of C_ANCHORS) if (k in t0) this.t0[k] = Number(t0[k]);
    for (const k of C_BED) if (!(k in this.t0)) this.t0[k] = Number(k in bedRule ? bedRule[k] : COURSE_TABLES.defaultBedside[k]);
    this.traj = [...(inp.trajectory ?? [])].sort((a, b) => Number(a.atMs ?? 0) - Number(b.atMs ?? 0));
    this.events = [...(inp.events ?? [])].sort((a, b) => (a.at_ms - b.at_ms) || ((a.seq ?? 0) - (b.seq ?? 0)));
    const def = COURSE_TABLES.defaultBedside;
    this.lactate = Number("lactate" in t0 ? t0.lactate : ("lactate" in bedRule ? bedRule.lactate : def.lactate));
    this.cbg = Number("cbg" in t0 ? t0.cbg : ("cbg" in bedRule ? bedRule.cbg : def.cbg));
    this.k = Number("k" in t0 ? t0.k : ("k" in bedRule ? bedRule.k : def.k));
    this.open(this.cid, 0, null, { why_en: "presenting condition", why_tr: "başvuru tanısı", primary: true });
    if (rule0.start_arrest) this.doArrest(0, String(rule0.start_arrest), this.cid, "presented in cardiac arrest");
  }

  private rule(id: string): CourseRule {
    return this.lib[id];
  }

  private open(
    rid: string,
    minute: Num,
    parent: Proc | null,
    o: { why_en: string; why_tr: string; s_start?: Num | null; supersede?: boolean; primary?: boolean; say_en?: string; say_tr?: string; lactate_min?: Num | null; rate_h?: Num | null },
  ): void {
    const rule = this.lib[rid];
    if (!rule || this.procs.some((p) => p.id === rid)) return;
    const vStart = o.primary ? { ...this.t0 } : this.disease();
    const s0 = Number(o.s_start == null ? rule.s0 : o.s_start);
    const proc: Proc = {
      id: rid, s: s0, s_start: s0, start: minute, v_start: vStart, superseded: false, resolved: false, rate_mult: 1,
      why_en: o.why_en, why_tr: o.why_tr, primary: !!o.primary, trend: 0, rate_h: Number(o.rate_h == null ? rule.rate_h : o.rate_h),
    };
    if (o.supersede && parent) parent.superseded = true;
    this.procs.push(proc);
    if (o.lactate_min != null) this.lactate = Math.max(this.lactate, Number(o.lactate_min));
    if (!o.primary) {
      this.log.push({ at_ms: minute * MIN_MS, kind: "branch", id: rid, parent: parent ? parent.id : "",
        why_en: o.why_en, why_tr: o.why_tr, say_en: o.say_en ?? "", say_tr: o.say_tr ?? "" });
    }
  }

  private live(): Proc[] {
    return this.procs.filter((p) => !p.superseded);
  }
  private gkey(p: Proc, g: CourseGroup): string {
    return `${p.id}:${g.id}`;
  }
  private groupMet(p: Proc, g: CourseGroup, minute: Num): boolean {
    const key = this.gkey(p, g);
    if (g.active_min) return (this.activeDoses[key] ?? []).some((d) => minute - d < Number(g.active_min) && d <= minute);
    const at = this.met[key];
    return at !== undefined && at <= minute;
  }
  private unmet(p: Proc, gid: string, minute: Num): boolean {
    for (const g of this.rule(p.id).groups) {
      if (g.id !== gid) continue;
      const key = this.gkey(p, g);
      if (g.active_min) return !(this.activeDoses[key]?.length);
      return !(key in this.met && this.met[key] <= minute);
    }
    return false;
  }

  private delta(p: Proc): Dict<Num> {
    const rule = this.rule(p.id);
    const out: Dict<Num> = {};
    let f: Num;
    let anchors: Dict<Num>;
    if (p.s >= p.s_start) {
      f = p.s_start >= 1 ? 0 : (p.s - p.s_start) / (1 - p.s_start);
      anchors = rule.peri;
    } else {
      f = p.s_start <= 0 ? 1 : (p.s_start - p.s) / p.s_start;
      anchors = rule.well;
    }
    for (const [k, target] of Object.entries(anchors)) {
      const base = p.v_start[k];
      if (base === undefined) continue;
      out[k] = f * (Number(target) - base);
    }
    return out;
  }
  private disease(): Dict<Num> {
    const v: Dict<Num> = { ...this.t0 };
    for (const p of this.procs) for (const [k, d] of Object.entries(this.delta(p))) v[k] = (v[k] ?? 0) + d;
    return v;
  }

  private classesOf(e: CourseEvent): string[] {
    const rule = this.rule(this.cid);
    const row = String(e.row ?? "");
    if (row && row in rule.row_classes && String(e.code ?? "") === row) return [...rule.row_classes[row]];
    return [...(e.classes ?? [])];
  }
  private vNow(minute: Num): Dict<Num> {
    return this.compose(minute * MIN_MS, minute);
  }
  private addEffect(cls: string, atMs: Num, scale = 1, key = ""): void {
    const spec = COURSE_TABLES.classEffects[cls];
    if (!spec) return;
    for (const [k, d] of Object.entries(spec.effects)) {
      this.effects.push({ key: k, delta: Number(d) * scale, at_ms: atMs, onset: Number(spec.onset), wane: spec.wane, src: key || cls });
    }
  }
  private custom(effects: Dict<Num>, atMs: Num, onset: Num, wane: number[] | null, src: string): void {
    for (const [k, d] of Object.entries(effects)) this.effects.push({ key: k, delta: Number(d), at_ms: atMs, onset: Number(onset), wane, src });
  }
  private harm(id: string, minute: Num, en: string, tr: string, src = ""): void {
    this.harms.push({ id, at_ms: minute * MIN_MS, why_en: en, why_tr: tr, src });
  }

  private applyEvent(e: CourseEvent, minute: Num): void {
    const kind = String(e.kind ?? "treatment");
    const code = String(e.code ?? "");
    const row = String(e.row ?? "");
    const atMs = Number(e.at_ms ?? 0);
    const pr = this.rule(this.cid);
    if (kind === "order") {
      const low = `${code} ${e.label ?? ""}`.toLowerCase();
      const words = low.split(/\s+/).filter(Boolean);
      if (words.includes("ct") || low.includes("ct head") || low.includes("ct-head") || low.includes("head ct") || code === "24725-4" || code === "30799-1") this.ctDone = true;
      if (low.includes("lumbar") || words[0] === "lp" || code === "lp" || code === "lumbar_puncture") {
        if (pr.harm_rules.includes("lp_before_ct") && !this.ctDone) {
          const v = this.vNow(minute);
          if ((v.gcs ?? 15) < 13 || this.flags.includes("red_flags")) {
            this.harm("lp_before_ct", minute, "Lumbar puncture before CT with red flags: herniation risk (IDSA 2004; NICE NG240)",
              "Kırmızı bayrak varken BT öncesi lomber ponksiyon: herniasyon riski (IDSA 2004; NICE NG240)", code);
            this.pending.push({ at: minute + 30, to: "herniation", parent: this.procs[0].id,
              why_en: "Herniation after lumbar puncture with red flags (IDSA 2004)",
              why_tr: "Kırmızı bayraklı hastada LP sonrası herniasyon (IDSA 2004)", supersede: false, s_start: 0.5 });
          }
        }
      }
      this.satisfy(code, row, [], [], minute);
      return;
    }
    if (kind === "position") {
      if (pr.harm_rules.includes("posture") && (code === "sit_up" || code === "stand") && (this.vNow(minute).systolic ?? 120) < 90) {
        this.harm("posture", minute, "Sitting or standing a hypotensive anaphylaxis patient: empty-ventricle arrest (Pumphrey 2003)",
          "Hipotansif anafilaksi hastasını oturtmak veya ayağa kaldırmak: boş ventrikül arresti (Pumphrey 2003)", code);
        this.doArrest(minute, "PEA", this.procs[0].id, "posture change in hypotensive anaphylaxis");
      }
      return;
    }
    const classes = this.classesOf(e);
    const has = (c: string) => classes.includes(c);
    const agents = [...(e.agents ?? [])];
    const appr = String(e.appropriateness ?? "neutral");
    for (const c of classes) (this.classDoses[c] ??= []).push(minute);
    const v = this.vNow(minute);
    const sbp = v.systolic ?? 120;
    const acls = String(e.allergy_class ?? "");
    if (acls) this.allergy(acls, minute, code);
    const rh = row ? pr.row_harms[row] : undefined;
    if (rh) this.rowHarm(row, rh, minute, atMs);
    const inArrest = this.arrest !== null;
    let handled = false;
    if (this.arrest) {
      if (has("rhythm") && (this.arrest.rhythm === "VF" || this.arrest.rhythm === "pVT")) this.arrest.shock_at = minute;
      if (has("adrenaline_iv")) this.arrest.adrenaline_at = minute;
    }
    const liveRules = () => this.live().map((p) => this.rule(p.id));
    if (has("fluids") && !inArrest) {
      this.fluids(e, minute, atMs);
      handled = true;
    }
    if (has("oxygen") && !has("niv") && !inArrest) {
      this.oxygenOn = true;
      const spo2 = v.spo2 ?? 97;
      let resp = Number(pr.o2_response || 0.4);
      for (const r of liveRules()) resp = Math.min(resp, Number(r.o2_response || resp));
      const gain = spo2 >= 94 ? 0 : Math.min(15, (98 - spo2) * resp);
      if (gain > 0) this.custom({ spo2: gain }, atMs, 5, null, code);
      if (liveRules().some((r) => r.hypercapnic) && row !== "controlled_o2" && spo2 + gain > 92) {
        this.harm("o2_hypercapnia", minute, "High-flow oxygen to SpO2 above 92 % with hypercapnic risk (BTS 2017; Austin 2010)",
          "Hiperkapni riskinde SpO2 %92 üzerine yüksek akım oksijen (BTS 2017; Austin 2010)", code);
        this.pending.push({ at: minute + 30, to: "type2_respiratory_failure", parent: this.procs[0].id,
          why_en: "Oxygen-induced hypercapnia: type 2 respiratory failure (BTS 2017)",
          why_tr: "Oksijene bağlı hiperkapni: tip 2 solunum yetmezliği (BTS 2017)", supersede: false });
      }
      handled = true;
    }
    if (has("niv") && !inArrest) {
      this.oxygenOn = true;
      this.addEffect("niv", atMs, 1, code);
      handled = true;
    }
    if (has("vasopressor") && !inArrest && this.pressorStart === null) {
      this.pressorStart = minute;
      handled = true;
    }
    if (has("adrenaline_iv") && !inArrest) {
      const ana = liveRules().some((r) => r.pattern === "upper_airway");
      const im = (this.classDoses["adrenaline_im"] ?? []).length;
      if (ana && im < 2) {
        this.harm("iv_adrenaline_bolus", minute, "IV adrenaline bolus outside cardiac arrest: severe hypertension and VT (RCUK 2021)",
          "Kardiyak arrest dışında İ.V. adrenalin bolusu: ağır hipertansiyon ve VT (RCUK 2021)", code);
        this.addEffect("adrenaline_iv_bolus", atMs, 1, code);
        this.transient = ["VT", minute + 5];
      } else if (this.pressorStart === null) {
        this.pressorStart = minute;
      }
      handled = true;
    }
    if (has("adrenaline_im") && !inArrest) {
      this.addEffect("adrenaline_im", atMs, 1, code);
      handled = true;
    }
    if (has("nitrate") && !inArrest) {
      if (sbp < 90 || this.flags.includes("rv_infarct") || this.flags.includes("pde5")) {
        this.harm("gtn_hypotension", minute, "Nitrate with SBP below 90, RV infarct or a PDE-5 inhibitor: profound hypotension (ESC 2023)",
          "SKB 90 altı, RV infarktı veya PDE-5 inhibitörüyle nitrat: derin hipotansiyon (ESC 2023)", code);
        this.addEffect("nitrate_harm", atMs, 1, code);
      } else if (sbp > 110) {
        this.addEffect("nitrate", atMs, 1, code);
        if (pr.fluid === "pulmonary_oedema") this.custom({ rr: -4, spo2: 2 }, atMs, 5, null, code);
      }
      handled = true;
    }
    if (has("opioid") || has("benzodiazepine")) {
      const seizing = liveRules().some((r) => r.pattern === "seizure");
      const depressed = (v.rr ?? 16) < 12 || (v.gcs ?? 15) < 13;
      const onBoard = ["opioid", "benzodiazepine"].some((c) => (this.classDoses[c] ?? []).some((d) => minute - d <= 60 && d < minute));
      if (!seizing && (depressed || onBoard)) {
        this.harm("opioid_hypoventilation", minute, "Opioid or benzodiazepine in a patient already hypoventilating or sedated (AHA 2020)",
          "Zaten hipoventile veya sedatize hastada opioid ya da benzodiazepin (AHA 2020)", code);
        this.addEffect("opioid_harm", atMs, 1, code);
      } else if (has("opioid")) {
        this.addEffect("opioid", atMs, 1, code);
      }
      handled = true;
    }
    if (has("analgesia") && !has("opioid")) this.addEffect("analgesia", atMs, 1, code);
    if (has("naloxone")) {
      const opioid = liveRules().some((r) => r.pattern === "tox_resp_depression") || (this.classDoses["opioid"] ?? []).length > 0;
      if (opioid) this.addEffect("naloxone", atMs, 1, code);
    }
    if (has("antipyretic") && (v.tempC ?? 37) > 38) this.addEffect("antipyretic", atMs, 1, code);
    if (has("bronchodilator")) this.addEffect("bronchodilator", atMs, 1, code);
    if (has("loop_diuretic")) this.addEffect("loop_diuretic", atMs, 1, code);
    if (has("beta_blocker_iv")) {
      this.addEffect("beta_blocker_iv", atMs, 1, code);
      const killip = (v.spo2 ?? 97) < 94 || sbp < 100 || this.flags.includes("killip2");
      if (pr.harm_rules.includes("beta_blocker_killip") && killip) {
        this.harm("beta_blocker_killip", minute, "IV beta-blocker with Killip II or more or SBP below 100: cardiogenic shock (COMMIT 2005)",
          "Killip II ve üzeri veya SKB 100 altında İ.V. beta bloker: kardiyojenik şok (COMMIT 2005)", code);
        this.pending.push({ at: minute + 20, to: "cardiogenic_shock", parent: this.procs[0].id,
          why_en: "IV beta-blocker in pump failure (COMMIT 2005)", why_tr: "Pompa yetmezliğinde İ.V. beta bloker (COMMIT 2005)", supersede: true });
      }
    }
    if (has("glucagon") && this.flags.includes("beta_blocked")) this.addEffect("glucagon", atMs, 1, code);
    if (has("thrombolytic")) {
      const highRisk = this.live().some((p) => p.id === "pe_high_risk");
      if (highRisk) this.addEffect("thrombolytic_pe", atMs, 1, code);
      else if (pr.harm_rules.includes("thrombolysis_intermediate_pe")) {
        this.harm("thrombolysis_intermediate_pe", minute, "Systemic thrombolysis in intermediate-risk PE without decompensation: bleeding risk, no benefit (PEITHO 2014)",
          "Dekompanse olmayan orta riskli PE'de sistemik tromboliz: kanama riski, yarar yok (PEITHO 2014)", code);
      }
      if (pr.harm_rules.includes("lysis_bp_gate") && (sbp > 185 || (v.diastolic ?? 80) > 110)) {
        this.harm("lysis_bp_gate", minute, "Thrombolysis with BP above 185/110: intracranial haemorrhage risk (AHA/ASA 2019)",
          "KB 185/110 üzerindeyken tromboliz: intrakraniyal kanama riski (AHA/ASA 2019)", code);
      }
    }
    if (has("insulin_frii") && this.insulinStart === null) {
      this.insulinStart = minute;
      if (pr.harm_rules.includes("insulin_low_k") && this.k < 3.3) {
        this.harm("insulin_low_k", minute, "Insulin started with K below 3.3 mmol/L: hypokalaemia and arrhythmia (ADA 2024; JBDS 2023)",
          "K 3.3 mmol/L altında insülin başlandı: hipokalemi ve aritmi (ADA 2024; JBDS 2023)", code);
      }
    }
    if (has("insulin_bolus")) {
      this.kDrops.push(minute);
      if (pr.metabolic === "hypo") this.cbg = Math.max(1, this.cbg - 1);
    }
    if (has("potassium") && this.kReplaceStart === null) this.kReplaceStart = minute;
    if (has("dextrose")) {
      if (pr.metabolic === "dka") {
        if (this.dextroseStart === null) this.dextroseStart = minute;
      } else this.dextroseBoluses.push(minute);
    }
    if (has("glucagon") && pr.metabolic === "hypo") this.dextroseBoluses.push(minute);
    if (has("insulin_dextrose")) this.kDrops.push(minute);
    if ((row === "urgent_dialysis" || row === "dialysis_referral") && this.dialysisStart === null) this.dialysisStart = minute + 60;
    const handledSet = COURSE_TABLES.handledClasses;
    if (e.effects && e.effects.length && !classes.some((c) => handledSet.includes(c)) && !inArrest) {
      for (const eff of e.effects) {
        this.effects.push({ key: String(eff.key), delta: Number(eff.delta), at_ms: atMs, onset: Math.max(0, Number(eff.onsetMs ?? 0) / MIN_MS), wane: null, src: code });
      }
      handled = true;
    }
    if (appr === "contraindicated" && !rh && !handled) {
      this.harm("contraindicated_treatment", minute, "Contraindicated for this patient; no specific acute physiological effect (process error)",
        "Bu hasta için kontrendike; özgül akut fizyolojik etkisi yok (süreç hatası)", code);
    }
    this.satisfy(code, row, classes, agents, minute);
  }

  private rowHarm(row: string, rh: CourseRowHarm, minute: Num, atMs: Num): void {
    this.harm(`row_harm:${row}`, minute, rh.en, rh.tr, row);
    if (rh.effects && Object.keys(rh.effects).length) this.custom(rh.effects, atMs, Number(rh.onset_min || 5), null, row);
    if (Number(rh.rate_mult || 1) !== 1) for (const p of this.live()) p.rate_mult = Math.max(p.rate_mult, Number(rh.rate_mult));
    const fires = u01(this.seed, "rowharm", row) < Number(rh.p || 1);
    if (rh.arrest && fires) this.doArrest(minute + 2, String(rh.arrest), this.procs[0].id, rh.en);
    if (rh.branch && fires) {
      this.pending.push({ at: minute + 20, to: rh.branch, parent: this.procs[0].id, why_en: rh.en, why_tr: rh.tr, supersede: false });
    }
  }

  private allergy(acls: string, minute: Num, code: string): void {
    for (const a of this.allergies) {
      if (String(a.agent_class) !== acls) continue;
      const reaction = String(a.reaction || "rash");
      if (acls === "penicillin" && reaction === "anaphylaxis") {
        this.harm("allergen_exposure", minute, "Penicillin given to a patient with penicillin anaphylaxis (NICE CG183)",
          "Penisilin anafilaksisi olan hastaya penisilin verildi (NICE CG183)", code);
        this.pending.push({ at: minute + 5, to: "anaphylaxis_iatrogenic", parent: this.procs[0].id,
          why_en: "Iatrogenic anaphylaxis after a known allergen (Pumphrey 2000: median 5 min to arrest in fatal IV reactions)",
          why_tr: "Bilinen alerjen sonrası iyatrojenik anafilaksi (Pumphrey 2000)", supersede: false,
          say_en: "My throat is closing... I can't breathe.", say_tr: "Boğazım kapanıyor... nefes alamıyorum." });
      } else if (acls === "penicillin") {
        this.harm("allergen_exposure", minute, "Penicillin given with a rash-only history: urticarial rash (NICE CG183)",
          "Yalnızca döküntü öyküsüyle penisilin: ürtikeryal döküntü (NICE CG183)", code);
        this.findings.push({ id: "drug_rash", at_ms: (minute + 45) * MIN_MS, exam: "skin",
          en: "A new urticarial rash over the trunk; no wheeze or swelling.", tr: "Gövdede yeni ürtikeryal döküntü; hırıltı veya şişlik yok." });
      } else if (acls === "nsaid") {
        this.harm("allergen_exposure", minute, "Aspirin in aspirin/NSAID-exacerbated respiratory disease: bronchospasm (ESC 2023)",
          "Aspirin/NSAİİ ile alevlenen solunum hastalığında aspirin: bronkospazm (ESC 2023)", code);
        this.custom({ rr: 6, spo2: -4 }, minute * MIN_MS, 15, null, code);
        this.findings.push({ id: "drug_wheeze", at_ms: (minute + 15) * MIN_MS, exam: "respiratory",
          en: "New widespread expiratory wheeze after aspirin.", tr: "Aspirinden sonra yeni yaygın ekspiratuvar hışıltı." });
      } else if (acls === "opioid") {
        this.findings.push({ id: "pruritus", at_ms: (minute + 15) * MIN_MS, exam: "skin",
          en: "Itching and flushing along the arm (opioid pseudo-allergy).", tr: "Kol boyunca kaşıntı ve kızarıklık (opioid psödoalerjisi)." });
      } else if (acls === "contrast") {
        this.findings.push({ id: "contrast_hives", at_ms: (minute + 10) * MIN_MS, exam: "skin", en: "Hives after contrast.", tr: "Kontrast sonrası kurdeşen." });
      }
    }
  }

  private fluids(e: CourseEvent, minute: Num, atMs: Num): void {
    const vol = Number(e.volume_ml || 500);
    const scale = vol / 500;
    const before = this.fluidMl;
    this.fluidMl += vol;
    if (minute < 60) this.fluidFirstHour += vol;
    let mode = "neutral";
    let limit: Num | null = null;
    let persistent = false;
    for (const p of this.live()) {
      const r = this.rule(p.id);
      const fm = String(r.fluid || "neutral");
      if (fm === "pulmonary_oedema" || (fm === "renal" && mode !== "pulmonary_oedema") ||
        (fm === "rv" && mode !== "pulmonary_oedema" && mode !== "renal") ||
        ((fm === "responsive" || fm === "haemorrhage") && mode === "neutral")) mode = fm;
      if (r.fluid_limit_ml) limit = Number(r.fluid_limit_ml);
      persistent = persistent || !!r.fluid_persistent;
    }
    if (this.flags.includes("heart_failure")) mode = "pulmonary_oedema";
    if (this.flags.includes("renal_failure") && mode !== "pulmonary_oedema") mode = "renal";
    const spec = COURSE_TABLES.classEffects["fluids"];
    const wane = persistent ? null : spec.wane;
    const code = String(e.code);
    if (mode === "pulmonary_oedema") {
      this.harm("fluid_overload", minute, "Fluid bolus in pulmonary oedema: SpO2 falls, crackles rise (ESC 2021 HF)",
        "Pulmoner ödemde sıvı bolusu: SpO2 düşer, raller artar (ESC 2021 KY)", code);
      this.custom({ spo2: -3 * scale, rr: 4 * scale }, atMs, 15, null, "fluid_overload");
      this.findings.push({ id: `crackles_${this.harms.length}`, at_ms: (minute + 15) * MIN_MS, exam: "respiratory",
        en: "Crackles have extended further up both lung fields after the fluid.", tr: "Sıvıdan sonra raller her iki akciğerde daha yukarı uzandı." });
      return;
    }
    let factor: Num;
    if (mode === "renal") {
      if (this.fluidMl > 1000) {
        this.harm("fluid_overload", minute, "Fluid beyond 1 L in oligo-anuric renal failure: overload (NICE CG174)",
          "Oligo-anürik böbrek yetmezliğinde 1 L üzeri sıvı: yüklenme (NICE CG174)", code);
        this.custom({ spo2: -2 * scale, rr: 3 * scale }, atMs, 15, null, "fluid_overload");
        return;
      }
      factor = 0.5;
    } else if (mode === "rv") {
      if (this.fluidMl > 500) {
        this.harm("fluid_rv", minute, "More than 500 mL fluid in RV failure: RV overdistension lowers BP (ESC 2019 PE)",
          "Sağ ventrikül yetmezliğinde 500 mL üzeri sıvı: RV distansiyonu KB'yi düşürür (ESC 2019 PE)", code);
        this.custom({ systolic: -12 * scale, diastolic: -6 * scale }, atMs, 20, null, "fluid_rv");
        return;
      }
      factor = 0.5;
    } else if (mode === "responsive" || mode === "haemorrhage") {
      const cap = limit !== null ? limit : 30 * this.weight;
      if (before >= cap) {
        this.harm("fluid_nonresponse", minute, "Further fluid after about 30 mL/kg without response: oedema, not pressure (SSC 2021; Glassford 2014)",
          "Yanıtsız yaklaşık 30 mL/kg sonrası ek sıvı: basınç değil ödem (SSC 2021; Glassford 2014)", code);
        this.custom({ spo2: -2 * scale }, atMs, 15, null, "fluid_nonresponse");
        return;
      }
      factor = before < 1000 ? 1 : Math.max(0, (cap - before) / Math.max(1, cap - 1000));
    } else factor = 0.5;
    for (const [k, d] of Object.entries(spec.effects)) {
      this.effects.push({ key: k, delta: Number(d) * factor * scale, at_ms: atMs, onset: Number(spec.onset), wane, src: "fluids" });
    }
  }

  private satisfy(code: string, row: string, classes: string[], agents: string[], minute: Num): void {
    for (const p of this.live()) {
      for (const g of this.rule(p.id).groups) {
        const key = this.gkey(p, g);
        const hitRow = !!row && g.codes.includes(row);
        const hitCode = g.codes.includes(code);
        const hitCls = classes.some((c) => g.classes.includes(c));
        if (!(hitRow || hitCode || hitCls)) continue;
        const needs = g.needs ?? [];
        if (needs.length) {
          if (agents.length) {
            const cov = (this.coverage[key] ??= new Set<string>());
            for (const a of agents) cov.add(a);
            if (!needs.every((n) => cov.has(n))) {
              const miss = needs.filter((n) => !cov.has(n)).join(", ");
              this.log.push({ at_ms: minute * MIN_MS, kind: "spectrum", id: g.id, parent: p.id,
                why_en: `${code} does not cover ${miss} for this condition`, why_tr: `${code} bu durum için ${miss} kapsamıyor` });
              continue;
            }
          } else if (!(hitRow || hitCode)) continue;
        }
        if (g.active_min) (this.activeDoses[key] ??= []).push(minute);
        if (!(key in this.met)) this.met[key] = minute;
      }
    }
  }

  private doArrest(minute: Num, rhythm: string, cause: string, why: string): void {
    if (this.arrest) return;
    this.arrest = { rhythm, at: minute, cause, why, shock_at: null, adrenaline_at: null };
    const shock = rhythm === "VF" || rhythm === "pVT";
    this.log.push({ at_ms: minute * MIN_MS, kind: "arrest", id: rhythm, parent: cause,
      why_en: `Cardiac arrest (${rhythm}): ${why}. Start ALS: CPR 30:2, attach the defibrillator, ${shock ? "shock" : "adrenaline 1 mg IV as soon as possible"} (ERC 2021)`,
      why_tr: `Kardiyak arrest (${rhythm}): ${why}. İYD başlatın: KPR 30:2, defibrilatörü bağlayın (ERC 2021)` });
  }

  private tryRosc(minute: Num): void {
    const a = this.arrest;
    if (!a) return;
    let rosc = false;
    if ((a.rhythm === "VF" || a.rhythm === "pVT") && a.shock_at !== null && minute >= a.shock_at + 1) rosc = true;
    else if ((a.rhythm === "PEA" || a.rhythm === "asystole") && a.adrenaline_at !== null) {
      const cause = this.procs.find((p) => p.id === a.cause);
      let treated = true;
      if (cause) {
        for (const g of this.rule(cause.id).groups) {
          const key = this.gkey(cause, g);
          if (g.modifies && !(key in this.met || (this.activeDoses[key]?.length ?? 0) > 0)) treated = false;
        }
      }
      if (treated && minute >= a.adrenaline_at + 2) rosc = true;
    }
    if (rosc) {
      for (const p of this.live()) if (p.s >= 0.9) p.s = 0.9;
      this.log.push({ at_ms: minute * MIN_MS, kind: "rosc", id: a.rhythm, parent: a.cause,
        why_en: "Return of spontaneous circulation; post-resuscitation care (ERC 2021)",
        why_tr: "Spontan dolaşımın geri dönüşü; resüsitasyon sonrası bakım (ERC 2021)" });
      this.arrest = null;
      this.lowMapRun = 0;
      this.lowSpo2Run = 0;
    }
  }

  private step(minute: Num): void {
    for (const p of this.live()) {
      const rule = this.rule(p.id);
      p.trend = 0;
      if (this.arrest) continue;
      const groups = rule.groups.filter((g) => g.modifies);
      const perm = groups.filter((g) => !g.active_min);
      const act = groups.filter((g) => g.active_min);
      const lagDefault = Number(rule.lag_min || 0);
      const permMet = perm.length > 0 && perm.every((g) => {
        const key = this.gkey(p, g);
        return key in this.met && minute - this.met[key] >= Number(g.lag_min != null ? g.lag_min : lagDefault);
      });
      const active = act.filter((g) => this.groupMet(p, g, minute));
      let recover: Num | null = null;
      if (permMet) {
        recover = Number(rule.recover_h);
        for (const g of perm) if (g.recover_h != null) recover = Number(g.recover_h);
      } else if (active.length) {
        recover = Math.max(...active.map((g) => Number(g.recover_h != null ? g.recover_h : rule.recover_h)));
      } else if (p.resolved) recover = Number(rule.recover_h);
      let ds: Num;
      if (recover !== null) {
        ds = -recover / 60;
        const floor = Number(rule.floor);
        if (p.s > floor) p.s = Math.max(floor, p.s + ds);
        else ds = 0;
      } else {
        ds = (p.rate_h * p.rate_mult) / 60;
        p.s = Math.min(1, p.s + ds);
      }
      p.trend = ds;
      if (rule.resolve_below != null && p.s <= Number(rule.resolve_below)) p.resolved = true;
    }
    this.labs(minute);
  }

  private labs(minute: Num): void {
    const rule = this.rule(this.cid);
    const lr = COURSE_TABLES.labRates as Dict<number>;
    const v = this.compose(minute * MIN_MS, minute);
    const perfused = this.arrest === null && meanAp(v.systolic, v.diastolic) >= 65 && (v.crt ?? 2) <= 3;
    const shockPatterns = ["distributive_shock", "haemorrhagic_shock", "obstructive_shock", "cardiogenic", "upper_airway"];
    const sl = this.live().filter((p) => this.rule(p.id).arrest_rhythm || shockPatterns.includes(this.rule(p.id).pattern)).map((p) => p.s);
    const smax = sl.length ? Math.max(...sl) : 0;
    if (!perfused) {
      const plateau = 1 + 9 * smax;
      this.lactate += (plateau - this.lactate) * (1 - Math.exp(-1 / lr.lactate_plateau_tau_min));
    } else {
      let hl = lr.lactate_half_life_min;
      const untreated = this.live().some((p) => this.rule(p.id).groups.some((g) => g.modifies && this.unmet(p, g.id, minute)));
      if (untreated) hl *= 2;
      this.lactate = 1 + (this.lactate - 1) * 2 ** (-1 / hl);
    }
    const met = rule.metabolic;
    if (met === "dka") {
      let rate: Num;
      if (this.insulinStart !== null && minute > this.insulinStart) {
        rate = lr.dka_cbg_insulin_h;
        if (this.dextroseStart !== null && minute > this.dextroseStart) rate += lr.dextrose_offset_h;
        const dt = minute - this.insulinStart;
        let krate = dt <= 240 ? lr.dka_k_insulin_h : lr.dka_k_insulin_late_h;
        if (this.kReplaceStart !== null && minute > this.kReplaceStart) krate += lr.k_replacement_h;
        this.k += krate / 60;
      } else if (this.fluidMl > 0) rate = lr.dka_cbg_fluids_h;
      else rate = lr.dka_cbg_untreated_h;
      this.cbg += rate / 60;
    } else if (met === "hypo") {
      this.cbg += (this.dextroseBoluses.length === 0 ? lr.hypo_cbg_untreated_h : lr.post_dextrose_h) / 60;
    } else if (met === "hyperk") {
      let krate = lr.hyperk_untreated_h;
      if (this.dialysisStart !== null && minute > this.dialysisStart) krate += lr.dialysis_k_h;
      this.k += krate / 60;
    }
    for (const d of this.dextroseBoluses) if (d < minute && minute <= d + lr.dextrose_bolus_min) this.cbg += lr.dextrose_bolus_mmol / lr.dextrose_bolus_min;
    for (const d of this.kDrops) if (d < minute && minute <= d + lr.insulin_dextrose_min) this.k += lr.insulin_dextrose_k / lr.insulin_dextrose_min;
    this.cbg = clampN(this.cbg, 1, 60);
    this.k = clampN(this.k, 1.5, 9.5);
  }

  private trajOffset(tMs: Num): Dict<Num> {
    const pts = this.traj;
    if (pts.length < 2) return {};
    const out: Dict<Num> = {};
    for (const k of C_VITALS) {
      const series = pts.filter((p) => p[k] != null).map((p) => [Number(p.atMs ?? 0), Number(p[k])] as [Num, Num]);
      if (series.length < 2) continue;
      let val = series[series.length - 1][1];
      if (tMs <= series[0][0]) val = series[0][1];
      else {
        for (let i = 0; i < series.length - 1; i++) {
          const [ta, va] = series[i];
          const [tb, vb] = series[i + 1];
          if (ta <= tMs && tMs <= tb) {
            val = tb === ta ? va : va + ((tMs - ta) / (tb - ta)) * (vb - va);
            break;
          }
        }
      }
      out[k] = val - series[0][1];
    }
    return out;
  }

  private compose(tMs: Num, minute: Num): Dict<Num> {
    const v = this.disease();
    for (const [k, d] of Object.entries(this.trajOffset(tMs))) v[k] = (v[k] ?? 0) + d;
    for (const e of this.effects) {
      if (e.at_ms > tMs) continue;
      const dt = (tMs - e.at_ms) / MIN_MS;
      v[e.key] = (v[e.key] ?? 0) + e.delta * courseCurve(dt, e.onset, e.wane);
    }
    if (this.pressorStart !== null && minute >= this.pressorStart && this.arrest === null) {
      const ls = this.live().map((p) => p.s);
      const smax = ls.length ? Math.max(...ls) : 0;
      const cap = smax < 0.9 ? 40 : Math.max(0, (40 * (1 - smax)) / 0.1);
      const need = Math.max(0, 68 - meanAp(v.systolic, v.diastolic));
      const ramp = Math.min(1, (tMs - this.pressorStart * MIN_MS) / (10 * MIN_MS));
      const d = Math.min(need / 0.7333, cap) * Math.max(0, ramp);
      v.systolic += d;
      v.diastolic += 0.6 * d;
      v.hr += 3 * Math.max(0, ramp);
      v.crt = (v.crt ?? 2) - 2.5 * Math.max(0, ramp);
    }
    let g = v.gcs ?? 15;
    if (this.cbg < 3.5) g = Math.min(g, 15 - (3.5 - this.cbg) * 4);
    if (meanAp(v.systolic, v.diastolic) < 45) g -= 2;
    if (v.spo2 < 80) g -= 3;
    v.gcs = g;
    return v;
  }

  private stateValue(key: string, p: Proc, v: Dict<Num>, minute: Num): Num {
    if (key === "s") return p.s;
    if (key === "map") return meanAp(v.systolic, v.diastolic);
    if (key === "sbp") return v.systolic;
    if (key in v) return v[key];
    switch (key) {
      case "t_min": return minute;
      case "pt_min": return minute - p.start;
      case "lactate": return this.lactate;
      case "cbg": return this.cbg;
      case "k": return this.k;
      case "fluid_ml": return this.fluidMl;
      case "fluid_ml_60": return this.fluidFirstHour;
      case "pressor_on": return this.pressorStart !== null ? 1 : 0;
      case "age": return this.age;
      case "curb65": return this.curb65;
      case "difficulty": return this.difficulty;
    }
    if (key.startsWith("unmet:")) return this.unmet(p, key.slice(6), minute) ? 1 : 0;
    if (key.startsWith("flag:")) return this.flags.includes(key.slice(5)) ? 1 : 0;
    return 0;
  }
  private conds(cs: CourseCond[], p: Proc, v: Dict<Num>, minute: Num): boolean {
    return cs.every((c) => cmp(this.stateValue(c.k, p, v, minute), c.op, Number(c.v)));
  }

  private triggers(minute: Num): void {
    const v = this.compose(minute * MIN_MS, minute);
    const due = this.pending.filter((x) => x.at <= minute);
    for (const item of due) {
      this.pending.splice(this.pending.indexOf(item), 1);
      const parent = this.procs.find((p) => p.id === item.parent) ?? null;
      this.open(item.to, minute, parent, { why_en: item.why_en, why_tr: item.why_tr, s_start: item.s_start ?? null,
        supersede: !!item.supersede, say_en: item.say_en ?? "", say_tr: item.say_tr ?? "" });
    }
    for (const p of [...this.live()]) {
      for (const b of this.rule(p.id).branches) {
        const tag = `${p.id}>${b.id}`;
        if (this.log.some((x) => x.tag === tag)) continue;
        if (Number(b.p || 1) < 1 && u01(this.seed, p.id, b.id) >= Number(b.p)) continue;
        if (b.window) {
          const [lo, hi] = b.window;
          const at = lo + u01(this.seed, p.id, b.id, "t") * (hi - lo);
          if (minute - p.start < at) continue;
        }
        if (!this.conds(b.when ?? [], p, v, minute)) continue;
        this.log.push({ at_ms: minute * MIN_MS, kind: "trigger", id: b.id, tag, parent: p.id, why_en: b.why_en, why_tr: b.why_tr });
        if (b.arrest) this.doArrest(minute, String(b.arrest), p.id, b.why_en);
        else if (b.to) {
          this.open(b.to, minute, p, { why_en: b.why_en, why_tr: b.why_tr, s_start: b.s_start, supersede: !!b.supersede,
            say_en: b.say_en ?? "", say_tr: b.say_tr ?? "", lactate_min: b.lactate_min, rate_h: b.rate_h });
        }
      }
    }
    if (this.arrest === null) {
      for (const p of this.live()) {
        const rule = this.rule(p.id);
        if (rule.arrest_rhythm && p.s >= 1) {
          this.doArrest(minute, String(rule.arrest_rhythm), p.id, `${p.id} reached peri-arrest severity untreated`);
          break;
        }
      }
    }
    if (this.arrest === null) {
      this.lowMapRun = meanAp(v.systolic, v.diastolic) < 40 ? this.lowMapRun + 1 : 0;
      this.lowSpo2Run = v.spo2 < 60 ? this.lowSpo2Run + 1 : 0;
      if (this.lowMapRun >= ARREST_SUSTAIN_MIN) this.doArrest(minute, "PEA", this.live()[0].id, "MAP below 40 mmHg for 3 minutes");
      else if (this.lowSpo2Run >= ARREST_SUSTAIN_MIN) this.doArrest(minute, "PEA", this.live()[0].id, "SpO2 below 60 % for 3 minutes");
    }
    if (this.arrest === null && this.k < 2.5 && this.rule(this.cid).metabolic === "dka") {
      this.doArrest(minute, "VF", this.procs[0].id, "potassium below 2.5 mmol/L");
    }
    this.tryRosc(minute);
    if (this.insulinStart !== null) {
      if (this.k < 3 && !this.harms.some((h) => h.id === "hypokalaemic_arrhythmia_risk")) {
        this.harm("hypokalaemic_arrhythmia_risk", minute, "K below 3.0 mmol/L on insulin: ectopy, U waves and VT hazard (JBDS 2023; ADA 2024)",
          "İnsülin altında K 3.0 mmol/L altı: ektopi, U dalgası ve VT riski (JBDS 2023; ADA 2024)");
      }
      if (this.cbg < 4 && !this.harms.some((h) => h.id === "hypoglycaemia")) {
        this.harm("hypoglycaemia", minute, "CBG below 4 mmol/L on insulin without 10 % glucose (JBDS 2023)",
          "%10 glukoz olmadan insülin altında KKŞ 4 mmol/L altı (JBDS 2023)");
        this.open("hypoglycemia", minute, this.procs[0], { why_en: "Iatrogenic hypoglycaemia on fixed-rate insulin without 10 % glucose (JBDS 2023)",
          why_tr: "%10 glukoz olmadan sabit hızlı insülinle iyatrojenik hipoglisemi (JBDS 2023)", s_start: 0.4,
          say_en: "I feel shaky and sweaty.", say_tr: "Titriyorum ve terliyorum." });
      }
    }
    for (const p of this.live()) {
      const rule = this.rule(p.id);
      for (const t of rule.targets) {
        const key = `${p.id}:${t.id}`;
        const g = rule.groups.find((x) => x.id === t.group);
        if (!g) continue;
        const gk = this.gkey(p, g);
        let st = this.targets.get(key);
        if (!st) {
          st = { id: t.id, process: p.id, group: t.group, status: "pending", due_ms: (p.start + Number(t.by_min || 0)) * MIN_MS, met_ms: null,
            source: t.source, basis: t.basis ?? "guideline", label_en: g.label_en ?? "", label_tr: g.label_tr ?? "", codes: [...g.codes], classes: [...g.classes] };
          this.targets.set(key, st);
        }
        if (st.status !== "pending") continue;
        if (t.type === "repeat") {
          const doses = this.activeDoses[gk] ?? [];
          if (!doses.length) {
            st.due_ms = null;
            continue;
          }
          const check = doses[0] + Number(t.after_min);
          st.due_ms = (check + Number(t.grace_min)) * MIN_MS;
          if (doses.length >= 2) {
            st.status = "met";
            st.met_ms = doses[1] * MIN_MS;
          } else if (minute >= check + Number(t.grace_min)) {
            const vc = this.compose(check * MIN_MS, check);
            st.status = this.conds(t.when ?? [], p, vc, check) ? "breached" : "not_needed";
          }
          continue;
        }
        let metAt: Num | undefined = this.met[gk];
        if (metAt === undefined && this.activeDoses[gk]?.length) metAt = this.activeDoses[gk][0];
        if (metAt !== undefined && metAt * MIN_MS <= Number(st.due_ms)) {
          st.status = "met";
          st.met_ms = metAt * MIN_MS;
        } else if (minute * MIN_MS >= Number(st.due_ms) && metAt === undefined) st.status = "breached";
      }
    }
    for (const p of this.live()) {
      for (const f of this.rule(p.id).findings) {
        const fid = `${p.id}:${f.id}`;
        if (this.findings.some((x) => x.id === fid)) continue;
        if (this.conds(f.when ?? [], p, v, minute)) this.findings.push({ id: fid, at_ms: minute * MIN_MS, exam: f.exam, en: f.en, tr: f.tr });
      }
    }
  }

  run(tMs: Num): CourseSnapshot {
    const last = Math.floor(Math.max(0, tMs) / MIN_MS);
    const evs = this.events.filter((e) => Number(e.at_ms ?? 0) <= tMs);
    let idx = 0;
    for (let minute = 0; minute <= last; minute++) {
      if (minute > 0) this.step(minute);
      while (idx < evs.length && Math.floor(Number(evs[idx].at_ms ?? 0) / MIN_MS) <= minute) {
        this.applyEvent(evs[idx], minute);
        idx++;
      }
      this.triggers(minute);
    }
    return this.snapshot(tMs, last);
  }

  private snapshot(tMs: Num, minute: Num): CourseSnapshot {
    const v = this.compose(tMs, minute);
    const B = COURSE_TABLES.bounds;
    let rhythm = "sinus";
    let pulse = true;
    if (this.arrest) {
      rhythm = this.arrest.rhythm;
      pulse = false;
    } else if (this.transient && minute <= this.transient[1]) rhythm = this.transient[0];
    else if (this.k < 3) rhythm = "sinus with ectopy (U waves)";
    else if (this.k >= 6.5) rhythm = "sinus with peaked T waves";
    else if (v.hr > 100) rhythm = "sinus tachycardia";
    else if (v.hr < 50) rhythm = "bradycardia";
    const vit: Dict<Num> = {};
    for (const k of C_VITALS) vit[k] = clampN(v[k] ?? this.t0[k] ?? 0, B[k][0], B[k][1]);
    if (vit.diastolic >= vit.systolic) vit.diastolic = Math.max(B.diastolic[0], vit.systolic - 20);
    for (const k of ["hr", "systolic", "diastolic", "rr", "spo2"]) vit[k] = rnd(vit[k]);
    vit.tempC = rnd(vit.tempC, 1);
    const bed: Dict<Num> = {};
    for (const k of C_BED) bed[k] = rnd(clampN(v[k] ?? COURSE_TABLES.defaultBedside[k], B[k][0], B[k][1]));
    if (this.arrest) {
      for (const k of ["hr", "systolic", "diastolic", "rr", "spo2"]) vit[k] = 0;
      bed.gcs = 3;
      bed.urine = 0;
    }
    const ls = this.live().map((p) => p.s);
    const smax = ls.length ? Math.max(...ls) : 0;
    const map = rnd(meanAp(vit.systolic, vit.diastolic));
    const trend = this.live().reduce((a, p) => a + p.trend, 0);
    let phase: CourseSnapshot["phase"];
    if (this.arrest) phase = "arrest";
    else if (smax >= 0.85 || map < 50 || vit.spo2 < 80) phase = "peri_arrest";
    else if (trend > 0 && smax > 0) phase = "deteriorating";
    else if (trend < 0) phase = "improving";
    else phase = "stable";
    const gcs = bed.gcs;
    const avpu = gcs >= 15 ? "A" : gcs >= 13 ? "C" : gcs >= 9 ? "V" : gcs >= 6 ? "P" : "U";
    let airway = "patent";
    const air = this.live().filter((p) => this.rule(p.id).pattern === "upper_airway").map((p) => p.s);
    if (air.length) {
      const sAir = Math.max(...air);
      airway = sAir >= 0.9 ? "obstructed" : sAir >= 0.7 ? "stridor" : "patent";
    }
    if (gcs <= 8 && airway === "patent" && !this.arrest) airway = "at risk";
    const mottle = bed.mottle;
    const skin = mottle >= 2 ? "mottled" : bed.crt >= 4 ? "cool" : "warm";
    const vitals: CurrentVitals = { hr: vit.hr, systolic: vit.systolic, diastolic: vit.diastolic, rr: vit.rr, spo2: vit.spo2, tempC: vit.tempC };
    return {
      t_ms: tMs,
      vitals,
      bedside: {
        map, gcs, avpu, cbg: rnd(this.cbg, 1), k: rnd(this.k, 1), lactate: rnd(this.lactate, 1), crt_s: bed.crt, mottling: mottle, skin,
        urine_ml_h: bed.urine, pain: bed.pain, airway, rhythm, pulse, fluid_in_ml: rnd(this.fluidMl), o2: this.oxygenOn,
        news2: pulse ? news2(vitals, avpu, this.oxygenOn, this.flags.includes("hypercapnic_target")) : 20,
      },
      severity: rnd(smax, 3),
      phase,
      processes: this.procs.map((p) => ({ id: p.id, s: rnd(p.s, 3), onset_ms: p.start * MIN_MS, superseded: p.superseded, resolved: p.resolved,
        primary: p.primary, why_en: p.why_en, why_tr: p.why_tr })),
      active_diagnoses: this.live().filter((p) => this.rule(p.id).pattern !== "stable" || p.primary || p.id === "refractory_shock").map((p) => p.id),
      harms: this.harms,
      targets: [...this.targets.values()],
      findings: this.findings.filter((f) => f.at_ms <= tMs),
      log: this.log,
      pressor_on: this.pressorStart !== null,
    };
  }
}

/** NEWS2 aggregate score (RCP 2017), mirror of course.news2. */
export function news2(v: CurrentVitals, avpu: string, onO2: boolean, scale2 = false): number {
  let s = 0;
  const rr = v.rr;
  s += rr <= 8 ? 3 : rr <= 11 ? 1 : rr <= 20 ? 0 : rr <= 24 ? 2 : 3;
  const sp = v.spo2;
  if (scale2) s += sp <= 83 ? 3 : sp <= 85 ? 2 : sp <= 87 ? 1 : 0;
  else s += sp <= 91 ? 3 : sp <= 93 ? 2 : sp <= 95 ? 1 : 0;
  s += onO2 ? 2 : 0;
  const sbp = v.systolic;
  s += sbp <= 90 ? 3 : sbp <= 100 ? 2 : sbp <= 110 ? 1 : sbp <= 219 ? 0 : 3;
  const hr = v.hr;
  s += hr <= 40 ? 3 : hr <= 50 ? 1 : hr <= 90 ? 0 : hr <= 110 ? 1 : hr <= 130 ? 2 : 3;
  s += avpu === "A" ? 0 : 3;
  const t = v.tempC;
  s += t <= 35 ? 3 : t <= 36 ? 1 : t <= 38 ? 0 : t <= 39 ? 1 : 2;
  return s;
}

/** The patient's course state at `tMs` (pure; mirror of course.simulate). */
export function simulateCourse(inp: CourseInput, tMs: number): CourseSnapshot {
  return new CourseSim(inp).run(tMs);
}

/* -------------------------------------------------------------------------- */
/* Case binding: spec -> course input, administered codes -> course events     */
/* (mirror of director.build_course_input and director.course_event)           */
/* -------------------------------------------------------------------------- */

/** What a CaseInstance carries so the browser can run the shared course model. */
export interface CaseCourseBinding {
  conditionId: string;
  /** Arrival state: triage vitals plus bedside values (GCS, CBG, K, lactate...). */
  t0: Record<string, number>;
  seed: number;
  patient: CoursePatient;
}

/** Minimal structural view of a wire spec (lib/liveCaseGen GeneratedCaseSpec). */
export interface CourseSpecLike {
  seed?: number | string;
  difficulty?: number;
  condition?: { label_en?: string; icd10?: string | null; id?: string };
  meta?: { condition_id?: string } | null;
  demographics?: { age?: number; weight_kg?: number };
  triage_vitals?: Partial<CurrentVitals>;
  labs?: Array<{ code?: string; value?: unknown; unit?: string }>;
  pmh_en?: string | string[];
  meds_en?: string | string[];
  allergies_en?: string | string[];
  course?: { bedside0?: Record<string, number>; flags?: string[]; curb65?: number; allergies?: Array<{ agent_class: string; reaction?: string }> };
}

const LACTATE_CODES = ["2524-7", "32693-4"];
const GLUCOSE_CODES = ["2345-7", "2339-0", "15074-8", "41653-7"];
const K_CODES = ["2823-3", "6298-4"];
const UREA_CODES = ["3094-0", "22664-7", "3091-6"];
const COURSE_FLAGS = ["heart_failure", "renal_failure", "copd", "beta_blocked", "pde5", "rv_infarct", "killip2", "red_flags", "hypercapnic_target"];

function textOf(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v.join(" ") : String(v ?? "");
}
function numOf(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Catalogue id for a spec (meta first, then the ICD-10 index of the course tables). */
export function courseConditionId(spec: CourseSpecLike): string | null {
  const meta = spec.meta?.condition_id ?? spec.condition?.id;
  if (meta && meta in COURSE_TABLES.rules) return meta;
  const icd = spec.condition?.icd10 ?? "";
  if (!icd) return null;
  for (const [id, code] of Object.entries(COURSE_TABLES.icd10)) if (code === icd) return id;
  return null;
}

/** Structured allergies (06b section 4.3), mirror of director.parse_allergies. */
export function parseCourseAllergies(spec: CourseSpecLike): Array<{ agent_class: string; reaction: string }> {
  const out: Array<{ agent_class: string; reaction: string }> = [];
  for (const a of spec.course?.allergies ?? []) {
    if (["penicillin", "cephalosporin", "nsaid", "opioid", "contrast", "sulfonamide"].includes(a.agent_class)) {
      out.push({ agent_class: a.agent_class, reaction: String(a.reaction || "rash") });
    }
  }
  if (out.length) return out;
  const text = textOf(spec.allergies_en).toLowerCase();
  if (!text || text.includes("no known") || text.includes("nkda")) return out;
  const reaction = (seg: string) =>
    seg.includes("anaphyla") ? "anaphylaxis" : seg.includes("wheeze") || seg.includes("bronchospasm") ? "bronchospasm"
      : seg.includes("swelling") || seg.includes("angioedema") ? "angioedema" : seg.includes("itch") ? "pruritus" : "rash";
  for (const seg of text.split(/[;\n]/)) {
    if (["penicillin", "amoxicillin", "co-amoxiclav", "flucloxacillin"].some((w) => seg.includes(w))) out.push({ agent_class: "penicillin", reaction: reaction(seg) });
    if (["aspirin", "ibuprofen", "nsaid"].some((w) => seg.includes(w))) out.push({ agent_class: "nsaid", reaction: reaction(seg) });
    if (["morphine", "codeine"].some((w) => seg.includes(w))) out.push({ agent_class: "opioid", reaction: reaction(seg) });
    if (seg.includes("contrast")) out.push({ agent_class: "contrast", reaction: reaction(seg) });
    if (seg.includes("sulfonamide") || seg.includes("sulpha")) out.push({ agent_class: "sulfonamide", reaction: reaction(seg) });
  }
  return out;
}

function courseFlags(spec: CourseSpecLike): string[] {
  const pmh = `${textOf(spec.pmh_en)} ${textOf(spec.meds_en)}`.toLowerCase();
  const flags = new Set<string>();
  if (pmh.includes("heart failure") || pmh.includes("cardiac failure")) flags.add("heart_failure");
  if (["dialysis", "end-stage renal", "end stage renal", "esrd", "ckd stage 5"].some((w) => pmh.includes(w))) flags.add("renal_failure");
  if (pmh.includes("copd") || pmh.includes("chronic obstructive")) {
    flags.add("copd");
    flags.add("hypercapnic_target");
  }
  if (["bisoprolol", "atenolol", "metoprolol", "propranolol", "beta-blocker", "beta blocker"].some((w) => pmh.includes(w))) flags.add("beta_blocked");
  if (["sildenafil", "tadalafil", "vardenafil"].some((w) => pmh.includes(w))) flags.add("pde5");
  for (const f of spec.course?.flags ?? []) if (COURSE_FLAGS.includes(f)) flags.add(f);
  return [...flags].sort();
}

/** The course binding for a spec, or null when its condition has no course rule. */
export function courseBindingFromSpec(spec: CourseSpecLike): CaseCourseBinding | null {
  const cid = courseConditionId(spec);
  if (!cid) return null;
  const rule = courseLibrary(cid)[cid];
  const tv = spec.triage_vitals ?? {};
  const t0: Record<string, number> = {};
  for (const k of C_VITALS) if (typeof tv[k] === "number") t0[k] = tv[k] as number;
  const bed0: Record<string, number> = { ...(rule.bedside0 ?? {}) };
  for (const lab of spec.labs ?? []) {
    const code = String(lab.code ?? "");
    const val = numOf(lab.value);
    if (val === null) continue;
    const unit = String(lab.unit ?? "").toLowerCase();
    if (LACTATE_CODES.includes(code)) bed0.lactate = val;
    else if (GLUCOSE_CODES.includes(code) && (rule.metabolic === "dka" || rule.metabolic === "hypo")) bed0.cbg = unit.includes("mg") ? val / 18 : val;
    else if (K_CODES.includes(code) && (rule.metabolic === "dka" || rule.metabolic === "hyperk")) bed0.k = val;
  }
  for (const [k, v] of Object.entries(spec.course?.bedside0 ?? {})) {
    if (["gcs", "crt", "mottle", "urine", "pain", "lactate", "cbg", "k"].includes(k) && numOf(v) !== null) bed0[k] = Number(v);
  }
  Object.assign(t0, bed0);
  const seedRaw = spec.seed;
  const seed = typeof seedRaw === "number" ? Math.trunc(seedRaw) : /^\d+$/.test(String(seedRaw ?? "")) ? Number(seedRaw) : fnv1a(String(seedRaw ?? cid));
  const age = numOf(spec.demographics?.age) ?? 45;
  let urea: number | null = null;
  for (const lab of spec.labs ?? []) {
    if (!UREA_CODES.includes(String(lab.code ?? ""))) continue;
    const val = numOf(lab.value);
    if (val !== null) urea = String(lab.unit ?? "").toLowerCase().includes("mg") ? val / 2.8 : val;
  }
  const g = Number(t0.gcs ?? 15);
  const score = Number(g < 15) + Number(urea !== null && urea > 7) + Number((tv.rr ?? 16) >= 30) +
    Number((tv.systolic ?? 120) < 90 || (tv.diastolic ?? 80) <= 60) + Number(age >= 65);
  return {
    conditionId: cid,
    t0,
    seed,
    patient: {
      weight_kg: numOf(spec.demographics?.weight_kg) ?? 70,
      age,
      difficulty: Math.trunc(Number(spec.difficulty || 3)),
      flags: courseFlags(spec),
      allergies: parseCourseAllergies(spec),
      curb65: Math.trunc(Number(spec.course?.curb65 || score)),
    },
  };
}

const PENICILLIN_WORDS = ["penicillin", "amoxicillin", "co-amoxiclav", "co amoxiclav", "flucloxacillin", "piperacillin", "benzylpenicillin", "ampicillin"];
const EFFECT_CAPS: Record<string, number> = { hr: 80, systolic: 50, diastolic: 30, rr: 15, spo2: 15, tempC: 2.5, pain: 10 };

/** One course event for an administered code (mirror of director.course_event), or null for an omission row. */
export function courseEventFor(c: CaseInstance, code: string, at: number, seq: number): CourseEvent | null {
  const row = matchTreatmentResponse(c, code);
  const label = `${row?.label?.en ?? ""} ${row?.narrative.en ?? ""}`.toLowerCase();
  if (row && isOmissionRow(row)) return null;
  let classes = COURSE_TABLES.codeClasses[code];
  if (!classes) classes = row ? COURSE_TABLES.rowClasses[row.treatmentCode] ?? [] : COURSE_TABLES.rowClasses[code] ?? [];
  let acls = COURSE_TABLES.agentAllergyClass[code] ?? "";
  if (!acls && PENICILLIN_WORDS.some((w) => label.includes(w))) acls = "penicillin";
  let vol = 500;
  const m = /(\d+(?:\.\d+)?)\s*(ml|l)\b/.exec(label);
  if (m) {
    const v = Number(m[1]) * (m[2] === "l" ? 1000 : 1);
    if (v >= 100 && v <= 1000) vol = v;
  }
  return {
    kind: "treatment", code, row: row?.treatmentCode ?? "", at_ms: at, seq,
    classes: [...classes], agents: [...(COURSE_TABLES.agentCoverage[code] ?? [])], allergy_class: acls, volume_ml: vol,
    appropriateness: row?.appropriateness ?? "neutral",
    effects: (row?.effects ?? []).filter((e) => e.key in EFFECT_CAPS).map((e) => ({
      key: e.key, delta: Math.max(-EFFECT_CAPS[e.key], Math.min(EFFECT_CAPS[e.key], e.delta)), onsetMs: Math.max(0, Math.trunc(e.onsetMs)),
    })),
  };
}

/** The engine input for a bound case and the treatments given so far. */
export function courseInputFor(c: CaseInstance, treatments: AdministeredTreatment[]): CourseInput | null {
  const b = c.course;
  if (!b) return null;
  const events: CourseEvent[] = [];
  [...treatments].sort((a, z) => a.at - z.at).forEach((t) => {
    const ev = courseEventFor(c, t.code, t.at, events.length);
    if (ev) events.push(ev);
  });
  return { condition_id: b.conditionId, t0: b.t0, seed: b.seed, patient: b.patient, events };
}

/** The shared-model state of a bound case at `elapsedMs` (null when the case has no binding). */
export function courseSnapshot(c: CaseInstance, elapsedMs: number, treatments: AdministeredTreatment[]): CourseSnapshot | null {
  const inp = courseInputFor(c, treatments.filter((t) => t.at <= elapsedMs));
  return inp ? simulateCourse(inp, Math.max(0, elapsedMs)) : null;
}
