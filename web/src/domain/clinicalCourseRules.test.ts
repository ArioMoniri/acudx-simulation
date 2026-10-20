import { describe, it, expect } from "vitest";
import { currentVitals, courseStatus, rescueCodesFor, severity } from "@/domain/clinicalCourse";
import type { CaseInstance, VitalsTrajectoryPoint, TreatmentResponse } from "@/domain/case";

/**
 * Review 02 findings 8, 28 and 41 — rescue derivation, contraindicated
 * treatments as adverse effects, and symmetric severity.
 */

function pt(atMs: number, over: Partial<VitalsTrajectoryPoint>): VitalsTrajectoryPoint {
  return { atMs, hr: 80, systolic: 120, diastolic: 78, rr: 16, spo2: 97, tempC: 37, ...over };
}

function makeCase(opts: {
  dx: string;
  text: string;
  trajectory?: VitalsTrajectoryPoint[];
  responses?: TreatmentResponse[];
  redFlags?: Array<{ en: string; tr: string }>;
}): CaseInstance {
  const traj = opts.trajectory ?? [pt(0, {}), pt(60_000, {})];
  return {
    id: `c-${opts.dx}-${opts.text}`,
    correctDiagnosis: { code: { coding: [{ system: "icd10", code: opts.dx, display: opts.text }], text: { en: opts.text, tr: opts.text } } },
    chiefComplaint: { en: "", tr: "" },
    redFlags: opts.redFlags ?? [],
    triageVitals: { hr: traj[0].hr, systolic: traj[0].systolic, diastolic: traj[0].diastolic, rr: traj[0].rr, spo2: traj[0].spo2, tempC: traj[0].tempC },
    groundTruth: { history: [], exam: [], labs: [], imaging: [], vitalsTrajectory: traj },
    ...(opts.responses ? { treatmentResponses: opts.responses } : {}),
  } as unknown as CaseInstance;
}

describe("review 02 finding 8 — nitroglycerin is never a haemorrhage / stroke rescue", () => {
  it("excludes GTN from SAH, ICH, GI bleed, PPH and ischaemic stroke rescue sets", () => {
    const cases = [
      makeCase({ dx: "I60.9", text: "Subarachnoid haemorrhage" }),
      makeCase({ dx: "I61.9", text: "Intracerebral hemorrhage" }),
      makeCase({ dx: "K92.2", text: "Upper gastrointestinal haemorrhage" }),
      makeCase({ dx: "O72.1", text: "Postpartum haemorrhage (kanama)" }),
      makeCase({ dx: "I63.9", text: "Acute ischaemic stroke" }),
    ];
    for (const c of cases) expect(rescueCodesFor(c).has("4917"), c.id).toBe(false);
  });

  it("keeps GTN as a rescue for ischaemic chest pain and acute pulmonary oedema", () => {
    expect(rescueCodesFor(makeCase({ dx: "I21.4", text: "NSTEMI" })).has("4917")).toBe(true);
    expect(rescueCodesFor(makeCase({ dx: "I50.1", text: "Acute pulmonary oedema" })).has("4917")).toBe(true);
  });

  it("gives GTN no effect when the systolic pressure is below 90", () => {
    const hypotensive = makeCase({ dx: "I21.4", text: "NSTEMI", trajectory: [pt(0, { systolic: 86 }), pt(600_000, { systolic: 86 })] });
    const after = currentVitals(hypotensive, 300_000, [{ code: "4917", at: 0 }]);
    expect(after.systolic).toBe(86);
    const normotensive = makeCase({ dx: "I21.4", text: "NSTEMI", trajectory: [pt(0, { systolic: 140 }), pt(600_000, { systolic: 140 })] });
    expect(currentVitals(normotensive, 300_000, [{ code: "4917", at: 0 }]).systolic).toBeLessThan(140);
  });
});

describe("review 02 finding 28 — rescue derives from authored treatments; contraindicated items act adversely", () => {
  const apo = makeCase({
    dx: "I50.1",
    text: "Acute pulmonary oedema",
    trajectory: [pt(0, { spo2: 90, rr: 26 }), pt(600_000, { spo2: 90, rr: 26 })],
    responses: [
      { treatmentCode: "iv_diuretic", appropriateness: "indicated", effects: [{ key: "spo2", delta: 3, onsetMs: 300_000 }], narrative: { en: "", tr: "" } },
      { treatmentCode: "313002", appropriateness: "contraindicated", effects: [], narrative: { en: "Fluid loading worsens pulmonary oedema.", tr: "" } },
    ],
  });

  it("uses the authored indicated codes and drops contraindicated fluids from the rescue set", () => {
    const s = rescueCodesFor(apo);
    expect(s.has("iv_diuretic")).toBe(true);
    expect(s.has("313002")).toBe(false);
    expect(s.has("7806")).toBe(true);
  });

  it("a contraindicated fluid bolus lowers SpO2 and raises RR instead of doing nothing", () => {
    const after = currentVitals(apo, 400_000, [{ code: "313002", at: 0 }]);
    expect(after.spo2).toBeLessThan(90);
    expect(after.rr).toBeGreaterThan(26);
  });

  it("fluids are not a rescue in acute pulmonary oedema even without authored responses", () => {
    expect(rescueCodesFor(makeCase({ dx: "I50.9", text: "Heart failure" })).has("313002")).toBe(false);
    expect(rescueCodesFor(makeCase({ dx: "A41.9", text: "Sepsis" })).has("313002")).toBe(true);
  });

  it("naloxone is a rescue only for an opioid toxidrome, IM adrenaline for anaphylaxis", () => {
    expect(rescueCodesFor(makeCase({ dx: "T39.1X1A", text: "Paracetamol overdose" })).has("7242")).toBe(false);
    expect(rescueCodesFor(makeCase({ dx: "T40.2X1A", text: "Opioid overdose" })).has("7242")).toBe(true);
    const ana = rescueCodesFor(makeCase({ dx: "T78.2XXA", text: "Anaphylaxis" }));
    expect(ana.has("3992-im")).toBe(true);
    expect(ana.has("3992")).toBe(false);
  });
});

describe("review 02 finding 41 — severity is symmetric", () => {
  it("a hypertensive emergency at 230/130 is not 'stable'", () => {
    const hbp = makeCase({ dx: "I16.1", text: "Hypertensive emergency", trajectory: [pt(0, { systolic: 230, diastolic: 130 }), pt(60_000, { systolic: 230, diastolic: 130 })] });
    expect(courseStatus(hbp, 30_000, [])).not.toBe("stable");
    expect(severity({ hr: 80, systolic: 230, diastolic: 130, rr: 16, spo2: 98, tempC: 37 })).toBeGreaterThan(0);
  });

  it("hypothermia, hyperthermia and bradypnoea move the score", () => {
    const base = { hr: 80, systolic: 120, diastolic: 78, rr: 16, spo2: 98, tempC: 37 };
    expect(severity({ ...base, tempC: 31 })).toBeGreaterThan(severity(base));
    expect(severity({ ...base, tempC: 41 })).toBeGreaterThan(severity({ ...base, tempC: 38.5 }));
    expect(severity({ ...base, rr: 6 })).toBeGreaterThan(severity(base));
    const cold = makeCase({ dx: "T68", text: "Hypothermia", trajectory: [pt(0, { tempC: 34 }), pt(60_000, { tempC: 34 })] });
    expect(courseStatus(cold, 30_000, [])).toBe("deteriorating");
    const severe = makeCase({ dx: "T68", text: "Severe hypothermia", trajectory: [pt(0, { tempC: 30 }), pt(60_000, { tempC: 30 })] });
    expect(courseStatus(severe, 30_000, [])).toBe("critical");
  });
});
