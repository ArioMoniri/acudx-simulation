import { describe, it, expect } from "vitest";
import {
  currentVitals,
  courseStatus,
  vitalsSeries,
  type AdministeredTreatment,
} from "@/domain/clinicalCourse";
import type { CaseInstance, VitalsTrajectoryPoint, TreatmentResponse } from "@/domain/case";

/**
 * clinicalCourse — live vitals from the baseline trajectory + treatment ramps.
 *
 * Pure and deterministic: an explicit elapsedMs, no Date.now, no Math.random.
 * We build a minimal CaseInstance stub carrying only the fields these functions
 * read (triageVitals, groundTruth.vitalsTrajectory, treatmentResponses).
 */

function pt(atMs: number, over: Partial<VitalsTrajectoryPoint>): VitalsTrajectoryPoint {
  return { atMs, hr: 80, systolic: 120, diastolic: 78, rr: 16, spo2: 97, tempC: 37, ...over };
}

function makeCase(
  trajectory: VitalsTrajectoryPoint[],
  treatmentResponses?: TreatmentResponse[],
): CaseInstance {
  return {
    triageVitals: { hr: 80, systolic: 120, diastolic: 78, rr: 16, spo2: 97, tempC: 37 },
    groundTruth: { history: [], exam: [], labs: [], imaging: [], vitalsTrajectory: trajectory },
    ...(treatmentResponses ? { treatmentResponses } : {}),
  } as unknown as CaseInstance;
}

describe("clinicalCourse — trajectory interpolation", () => {
  it("linearly interpolates between two trajectory points", () => {
    const c = makeCase([pt(0, { hr: 80 }), pt(60_000, { hr: 120 })]);
    expect(currentVitals(c, 0, []).hr).toBe(80);
    expect(currentVitals(c, 30_000, []).hr).toBe(100); // midpoint
    expect(currentVitals(c, 60_000, []).hr).toBe(120);
  });

  it("clamps to the trajectory ends past its bounds", () => {
    const c = makeCase([pt(0, { hr: 80 }), pt(60_000, { hr: 120 })]);
    expect(currentVitals(c, -5_000, []).hr).toBe(80);
    expect(currentVitals(c, 999_000, []).hr).toBe(120);
  });

  it("falls back to triageVitals when the trajectory is empty", () => {
    const c = makeCase([]);
    expect(currentVitals(c, 42_000, [])).toMatchObject({ hr: 80, systolic: 120, spo2: 97 });
  });
});

describe("clinicalCourse — treatment effects ramp over onset", () => {
  it("an O2 bolus raises a low SpO2 gradually to its target", () => {
    // Hypoxic baseline held constant; O2 generic effect = +6 SpO2 over 120s.
    const c = makeCase([pt(0, { spo2: 88 }), pt(300_000, { spo2: 88 })]);
    const o2: AdministeredTreatment[] = [{ code: "7806", at: 0 }];

    expect(currentVitals(c, 0, o2).spo2).toBe(88); // no ramp yet
    expect(currentVitals(c, 60_000, o2).spo2).toBe(91); // halfway (+3)
    expect(currentVitals(c, 120_000, o2).spo2).toBe(94); // full effect (+6)
    // Effect does not overshoot beyond onset.
    expect(currentVitals(c, 240_000, o2).spo2).toBe(94);
  });

  it("prefers a case-specific treatmentResponse over the generic fallback", () => {
    const resp: TreatmentResponse = {
      treatmentCode: "7806",
      appropriateness: "indicated",
      effects: [{ key: "spo2", delta: 10, onsetMs: 100_000 }],
      narrative: { en: "n", tr: "n" },
    };
    const c = makeCase([pt(0, { spo2: 88 }), pt(300_000, { spo2: 88 })], [resp]);
    // Bespoke +10 (not generic +6) at full onset.
    expect(currentVitals(c, 100_000, [{ code: "7806", at: 0 }]).spo2).toBe(98);
  });

  it("does not apply a treatment before it is administered", () => {
    const c = makeCase([pt(0, { spo2: 88 }), pt(300_000, { spo2: 88 })]);
    const later: AdministeredTreatment[] = [{ code: "7806", at: 200_000 }];
    expect(currentVitals(c, 60_000, later).spo2).toBe(88);
  });
});

describe("clinicalCourse — determinism + status + series", () => {
  it("is deterministic: identical inputs yield identical output (no clock/culture)", () => {
    const c = makeCase([pt(0, { hr: 90 }), pt(120_000, { hr: 110 })]);
    const tx: AdministeredTreatment[] = [{ code: "4917", at: 10_000 }];
    const a = currentVitals(c, 75_000, tx);
    const b = currentVitals(c, 75_000, tx);
    expect(a).toEqual(b);
  });

  it("flags an absolute danger threshold as deteriorating/critical", () => {
    const crit = makeCase([pt(0, { spo2: 82 }), pt(120_000, { spo2: 82 })]);
    expect(courseStatus(crit, 60_000, [])).toBe("critical");
    const danger = makeCase([pt(0, { spo2: 88 }), pt(120_000, { spo2: 88 })]);
    expect(courseStatus(danger, 60_000, [])).toBe("deteriorating");
    const ok = makeCase([pt(0, {}), pt(120_000, {})]);
    expect(courseStatus(ok, 60_000, [])).toBe("stable");
  });

  it("caps the sampled series and lands the final point on elapsedMs", () => {
    const c = makeCase([pt(0, {}), pt(600_000, { hr: 120 })]);
    const series = vitalsSeries(c, 600_000, [], 1_000); // would be 601 pts at 1s step
    expect(series.length).toBeLessThanOrEqual(121);
    expect(series[0].atMs).toBe(0);
    expect(series[series.length - 1].atMs).toBe(600_000);
  });
});
