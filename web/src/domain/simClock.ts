/**
 * AcuDx: compressed encounter clock (docs/architecture/14 section 10).
 *
 * Results keep their clinical turnaround on the SIM clock and every time the
 * learner reads is sim time. Two settings keep the real wait short:
 *
 *   - `scale`: sim ms per real ms (default 6: one real minute is six sim
 *     minutes, so a ten-minute session covers the first hour of care).
 *   - `wait_cap_s`: the longest real wait per turnaround class before a pending
 *     report is due. When the cap comes first, the encounter store jumps the
 *     sim clock to the report (the same step as "Advance to next result"), and
 *     the Clinical Director advances the patient by the same sim time. A report
 *     after a preliminary one waits at most one more cap.
 *
 * Mirror of server/learning/sim_clock.py; both read
 * server/tests/fixtures/sim_clock_parity.json in their tests. Faculty set the
 * values per course (GET /v1/me/sim-clock, PUT /v1/faculty/sim-clock).
 *
 * Pure: no Date.now.
 */

import type { OrderCategory } from "@/domain/orderCatalog";

export type WaitClass = "poc" | "lab" | "imaging" | "culture";
export const WAIT_CLASSES: readonly WaitClass[] = ["poc", "lab", "imaging", "culture"];

export interface SimClockSettings {
  scale: number;
  wait_cap_s: Record<WaitClass, number>;
}

export const SCALE_BOUNDS: readonly [number, number] = [1, 60];
export const WAIT_CAP_BOUNDS_S: readonly [number, number] = [5, 600];

export const SIM_CLOCK_DEFAULTS: SimClockSettings = {
  scale: 6,
  wait_cap_s: { poc: 15, lab: 45, imaging: 90, culture: 120 },
};

export const CLASS_OF: Record<OrderCategory, WaitClass> = {
  poc: "poc",
  lab: "lab",
  coag: "lab",
  cardiac: "lab",
  other: "lab",
  "imaging-xr": "imaging",
  "imaging-ct": "imaging",
  "imaging-us": "imaging",
  "imaging-mri": "imaging",
  "micro-culture": "culture",
};

export function waitClass(category: OrderCategory | undefined): WaitClass {
  return (category && CLASS_OF[category]) || "lab";
}

function clamp(v: number, [lo, hi]: readonly [number, number]): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Validate a settings object from the gateway; anything malformed falls back to the defaults. */
export function normalizeSimClock(raw: unknown): SimClockSettings {
  if (!raw || typeof raw !== "object") return SIM_CLOCK_DEFAULTS;
  const r = raw as { scale?: unknown; wait_cap_s?: unknown };
  const scale = typeof r.scale === "number" && Number.isFinite(r.scale) ? clamp(r.scale, SCALE_BOUNDS) : SIM_CLOCK_DEFAULTS.scale;
  const caps = { ...SIM_CLOCK_DEFAULTS.wait_cap_s };
  if (r.wait_cap_s && typeof r.wait_cap_s === "object") {
    for (const k of WAIT_CLASSES) {
      const v = (r.wait_cap_s as Record<string, unknown>)[k];
      if (typeof v === "number" && Number.isFinite(v)) caps[k] = clamp(v, WAIT_CAP_BOUNDS_S);
    }
  }
  return { scale, wait_cap_s: caps };
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** Real seconds from placing an order to its first report and to its final report. */
export function realWaitsS(
  settings: SimClockSettings,
  category: OrderCategory | undefined,
  turnaroundMin: number,
  preliminaryMin: number | null,
): { first: number; final: number } {
  const cap = settings.wait_cap_s[waitClass(category)];
  const perMin = 60 / settings.scale;
  const firstMin = preliminaryMin ? preliminaryMin : turnaroundMin;
  const first = Math.min(firstMin * perMin, cap);
  if (!preliminaryMin) return { first: round3(first), final: round3(first) };
  const final = first + Math.min(Math.max(0, turnaroundMin - preliminaryMin) * perMin, cap);
  return { first: round3(first), final: round3(final) };
}

/** Longest real wait (ms) for one report of an order in this class. */
export function waitCapMs(settings: SimClockSettings, category: OrderCategory | undefined): number {
  return settings.wait_cap_s[waitClass(category)] * 1000;
}
