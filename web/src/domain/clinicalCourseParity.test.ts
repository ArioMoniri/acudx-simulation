import { describe, it, expect } from "vitest";
import parityFixture from "../../../server/tests/fixtures/course_parity.json";
import {
  courseBindingFromSpec,
  courseEventFor,
  currentVitals,
  namedAgents,
  simulateCourse,
  type CourseInput,
  type CourseSnapshot,
} from "@/domain/clinicalCourse";
import { COURSE_TABLES } from "@/domain/courseTables.generated";
import type { CaseInstance, TreatmentResponse } from "@/domain/case";

/**
 * Review 06b acceptance test 10: the browser mirror of the course model returns
 * the same vitals as the server Clinical Director (within 1 unit) at t10, t30,
 * t60 and t120 for every scenario of the reviewers' simulation. The fixture is
 * written by scripts/gen_course_tables.py from the Director itself and checked
 * fresh by server/tests/test_course_parity.py.
 */

interface ParityCase {
  condition_id: string;
  label: string;
  input: CourseInput;
  expect: Record<string, { vitals: Record<string, number>; phase: string; gcs: number; lactate: number; active_diagnoses: string[] }>;
}

const fixture = parityFixture as unknown as { marks: number[]; cases: ParityCase[] };

describe("06b test 10: clinicalCourse.ts mirrors the server Director", () => {
  it("has a scenario for every 06b section 2 condition", () => {
    const conds = new Set(fixture.cases.map((c) => c.condition_id));
    for (const id of ["septic_shock", "anaphylaxis", "acs_stemi", "dka", "bacterial_meningitis", "heart_failure_acute"]) {
      expect(conds.has(id), id).toBe(true);
    }
  });

  for (const pc of fixture.cases) {
    it(`${pc.condition_id} [${pc.label}] matches within 1 unit at ${fixture.marks.join(", ")} min`, () => {
      for (const m of fixture.marks) {
        const snap: CourseSnapshot = simulateCourse(pc.input, m * 60_000);
        const want = pc.expect[String(m)];
        for (const k of ["hr", "systolic", "diastolic", "rr", "spo2"] as const) {
          expect(Math.abs(snap.vitals[k] - want.vitals[k]), `${pc.condition_id} ${pc.label} t${m} ${k}`).toBeLessThanOrEqual(1);
        }
        expect(Math.abs(snap.vitals.tempC - want.vitals.tempC)).toBeLessThanOrEqual(0.1);
        expect(snap.phase, `${pc.condition_id} ${pc.label} t${m}`).toBe(want.phase);
        expect(Math.abs(snap.bedside.gcs - want.gcs)).toBeLessThanOrEqual(1);
        expect(snap.active_diagnoses).toEqual(want.active_diagnoses);
      }
    });
  }
});

describe("06b client binding: spec to course and formulary codes to events", () => {
  const spec = {
    seed: 7,
    condition: { label_en: "Anaphylaxis", icd10: COURSE_TABLES.icd10.anaphylaxis },
    meta: { condition_id: "anaphylaxis" },
    triage_vitals: { hr: 128, systolic: 82, diastolic: 46, rr: 28, spo2: 91, tempC: 36.9 },
    demographics: { age: 30 },
    allergies_en: "Penicillin: anaphylaxis as a child.",
  };

  it("binds the case to its course rule with structured allergies", () => {
    const b = courseBindingFromSpec(spec);
    expect(b?.conditionId).toBe("anaphylaxis");
    expect(b?.patient.allergies).toEqual([{ agent_class: "penicillin", reaction: "anaphylaxis" }]);
    expect(courseBindingFromSpec({ ...spec, meta: {}, condition: { icd10: "Z99.99" } })).toBeNull();
  });

  it("an IM adrenaline dose rescues the bound case; untreated it arrests (shared model)", () => {
    const responses: TreatmentResponse[] = [
      { treatmentCode: "im_adrenaline", appropriateness: "indicated", effects: [], narrative: { en: "", tr: "" },
        label: { en: "IM adrenaline 0.5 mg", tr: "" } },
    ];
    const c = { id: "t-ana", course: courseBindingFromSpec(spec), treatmentResponses: responses,
      triageVitals: spec.triage_vitals, groundTruth: { vitalsTrajectory: [] } } as unknown as CaseInstance;
    expect(courseEventFor(c, "3992-im", 180_000, 0)?.classes).toEqual(["adrenaline_im"]);
    expect(currentVitals(c, 30 * 60_000, []).systolic).toBe(0);
    expect(currentVitals(c, 10 * 60_000, [{ code: "3992-im", at: 180_000 }]).systolic).toBeGreaterThanOrEqual(90);
  });

  it("ceftriaxone is an antibiotic, never a beta-blocker (06b F08)", () => {
    expect(COURSE_TABLES.codeClasses["2193"]).toEqual(["antibiotic"]);
  });
});

describe("ARDS ventilatory support (product owner decision 2026-10-21, ESICM 2023 rec. 3.1)", () => {
  const ards = (label: string) => {
    const pc = fixture.cases.find((c) => c.condition_id === "ards" && c.label === label);
    if (!pc) throw new Error(`no ards [${label}] parity case`);
    return pc;
  };

  it("the ARDS group is met by HFNC, NIV or intubation, never plain oxygen", () => {
    const g = COURSE_TABLES.rules.ards.groups.find((x) => x.id === "ventilation");
    expect(g?.classes).toEqual(["hfnc", "niv", "intubation"]);
    expect(g?.classes).not.toContain("oxygen");
    expect(COURSE_TABLES.supportClasses).toEqual(["hfnc", "niv", "intubation"]);
    expect(COURSE_TABLES.handledClasses).toContain("hfnc");
  });

  it("HFNC, NIV and intubation improve the course in the browser mirror; an NRB alone does not", () => {
    const nrb = simulateCourse(ards("nrb").input, 120 * 60_000);
    expect(nrb.phase).toBe("peri_arrest");
    for (const label of ["hfnc", "niv", "intubation"]) {
      const snap = simulateCourse(ards(label).input, 120 * 60_000);
      expect(snap.phase, label).toBe("improving");
      expect(snap.vitals.spo2, label).toBeGreaterThan(nrb.vitals.spo2);
    }
    const hfncEvent = ards("hfnc").input.events?.find((e) => e.code === "hfnc_60l");
    expect(hfncEvent?.classes).toEqual(["oxygen", "hfnc"]);
  });
});

describe("named antimicrobial spectrum (mirror of director.named_agents)", () => {
  it("reads agents from free-text codes the same way the server does", () => {
    expect(namedAgents("co_amoxiclav")).toEqual(["anaerobe", "gram_neg", "gram_pos"]);
    expect(namedAgents("ceftriaxone 2 g iv")).toEqual(["cns", "gram_neg", "gram_pos"]);
    expect(namedAgents("clarithromycin")).toEqual(["atypical"]);
    expect(namedAgents("iv_antibiotics")).toEqual([]);
  });
});
