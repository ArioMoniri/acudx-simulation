import { describe, expect, it } from "vitest";

import { generateCase } from "@/domain/caseGen";
import type { PatientVisibleChanges } from "@/lib/caseGenV2";
import {
  DIRECTOR_BOUNDS,
  applyDirectorChanges,
  caseInstanceToSpec,
  caseMetaProvenanceKey,
  clampDirectorVitals,
  engineObservationToFhir,
  overlayVitals,
  resultsCaseState,
  turnaroundLabel,
  vitalsAdjectives,
} from "@/lib/liveEncounter";
import type { Observation } from "@/lib/resultsApi";

const makeCase = (seed: number) =>
  generateCase({ seedMode: "constrained", chiefComplaint: "chest-pain", locale: "en", seed });

const local = { hr: 90, systolic: 130, diastolic: 80, rr: 18, spo2: 96, tempC: 37 };

function changes(vitals: Partial<PatientVisibleChanges["vitals"]>, extra: Partial<PatientVisibleChanges> = {}): PatientVisibleChanges {
  return {
    t_ms: 60_000,
    vitals: { ...local, ...vitals },
    affect: { pain: 5, anxiety: 4, dyspnea: 3, consciousness: "alert", mood_en: "worried", mood_tr: "endiseli" },
    utterance_en: "",
    utterance_tr: "",
    new_facts: [],
    complications_fired: [],
    trace: [],
    ...extra,
  };
}

describe("caseInstanceToSpec", () => {
  it("maps the CaseInstance onto the wire shape both services read", () => {
    const c = makeCase(11);
    const spec = caseInstanceToSpec(c);
    expect(spec.condition.label_en).toBe(c.correctDiagnosis.code.text?.en);
    expect(spec.condition.icd10).toBe(c.correctDiagnosis.code.coding.find((k) => k.system.includes("icd-10"))?.code);
    expect(spec.demographics?.age).toBe(c.patient.ageYears);
    expect(spec.acuity_esi).toBe(c.acuityESI);
    expect(spec.triage_vitals).toEqual(c.triageVitals);
    expect(spec.hpi?.length).toBe(c.groundTruth.history.length);
    expect(spec.hpi?.[0]).toMatchObject({ intent: c.groundTruth.history[0].intent, answer_en: c.groundTruth.history[0].answer.en });
    expect(spec.exam?.length).toBe(c.groundTruth.exam.length);
    expect(spec.labs?.length).toBe(c.groundTruth.labs.length);
    for (const lab of spec.labs ?? []) {
      expect(lab.code).toBeTruthy();
      expect(lab.value).not.toBeUndefined();
    }
    expect(spec.imaging?.length).toBe(c.groundTruth.imaging.length);
    expect(spec.vitals_trajectory?.length).toBe(c.groundTruth.vitalsTrajectory.length);
  });

  it("carries the treatments given as the engine's treatments_given", () => {
    const c = makeCase(12);
    const cs = resultsCaseState(c, [{ code: "4917", at: 30_000 }], { "4917": "Nitroglycerin" });
    expect(cs.treatments_given).toEqual([{ code: "4917", label: "Nitroglycerin", at_ms: 30_000 }]);
    expect(cs.condition?.label_en).toBeTruthy();
  });
});

describe("Director overlay: bounds respected", () => {
  it("clamps every vital to the server's hard bounds and keeps diastolic below systolic", () => {
    const v = clampDirectorVitals({ hr: 999, systolic: 10, diastolic: 500, rr: -4, spo2: 140, tempC: 50 });
    expect(v.hr).toBe(DIRECTOR_BOUNDS.hr.max);
    expect(v.systolic).toBe(DIRECTOR_BOUNDS.systolic.min);
    expect(v.diastolic).toBeLessThan(v.systolic);
    expect(v.rr).toBe(DIRECTOR_BOUNDS.rr.min);
    expect(v.spo2).toBe(100);
    expect(v.tempC).toBe(DIRECTOR_BOUNDS.tempC.max);
  });

  it("records the delta between the Director's vitals and the local course", () => {
    const o = applyDirectorChanges(null, changes({ hr: 130, spo2: 88 }), local, 60_000);
    expect(o.delta.hr).toBe(40);
    expect(o.delta.spo2).toBe(-8);
    expect(o.delta.systolic).toBe(0);
    expect(o.vitals.hr).toBe(130);
    expect(o.atMs).toBe(60_000);
  });

  it("applies the overlay on top of the running local course and never exceeds bounds", () => {
    const o = applyDirectorChanges(null, changes({ spo2: 99 }), { ...local, spo2: 95 }, 0);
    // Local course later climbs to 98: 98 + 4 would be 102, clamped to 100.
    expect(overlayVitals({ ...local, spo2: 98 }, o).spo2).toBe(100);
    const deep = applyDirectorChanges(null, changes({ systolic: 40 }), local, 0);
    expect(overlayVitals({ ...local, systolic: 60 }, deep).systolic).toBe(DIRECTOR_BOUNDS.systolic.min);
    expect(overlayVitals(local, null)).toEqual(local);
  });

  it("accumulates sanctioned facts and complications across steps, deduplicated", () => {
    const first = applyDirectorChanges(null, changes({}, { new_facts: ["Pain started 2 h ago", " "] }), local, 0);
    const second = applyDirectorChanges(
      first,
      changes({}, { new_facts: ["Pain started 2 h ago", "Radiates to the jaw"], complications_fired: ["missed_time_critical_treatment"] }),
      local,
      60_000,
    );
    expect(second.sanctionedFacts).toEqual(["Pain started 2 h ago", "Radiates to the jaw"]);
    expect(second.complications).toEqual(["missed_time_critical_treatment"]);
    const third = applyDirectorChanges(second, changes({}, { complications_fired: ["missed_time_critical_treatment"] }), local, 120_000);
    expect(third.complications).toHaveLength(1);
  });
});

describe("vitalsAdjectives", () => {
  it("names deterioration in plain words for the persona", () => {
    const words = vitalsAdjectives(
      { hr: 128, systolic: 84, diastolic: 50, rr: 28, spo2: 85, tempC: 38.6 },
      { pain: 8, anxiety: 8, dyspnea: 7, consciousness: "drowsy", mood_en: "", mood_tr: "" },
    );
    expect(words).toEqual(
      expect.arrayContaining(["tachycardic", "hypotensive", "tachypnoeic", "hypoxic", "severely hypoxic", "febrile", "drowsy", "short of breath", "in severe pain", "very anxious"]),
    );
  });

  it("says so when everything is within usual limits", () => {
    expect(vitalsAdjectives(local)).toEqual(["vitals within usual limits"]);
  });
});

describe("engineObservationToFhir", () => {
  const obs: Observation = {
    loinc: "2160-0",
    name: "Creatinine",
    short: "Cr",
    value: 1.9,
    unit: "mg/dL",
    qualitative: false,
    ref_low: 0.7,
    ref_high: 1.3,
    flag: "H",
    critical: false,
    interpretation: "Above the reference range.",
    delta: null,
    kinetics: "creatinine_aki",
    ground_truth: false,
    source: "https://www.nbme.org/laboratory-values/",
    reviewed_at: "2026-10-19",
  };

  it("keeps the LOINC code, flag, unit and range so the panel renders it like any lab", () => {
    const f = engineObservationToFhir(obs, "p1", 1234, "cmp-e0");
    expect(f.code.coding[0]).toMatchObject({ code: "2160-0", display: "Creatinine" });
    expect(f.valueQuantity).toEqual({ value: 1.9, unit: "mg/dL" });
    expect(f.interpretation).toBe("H");
    expect(f.referenceRange).toBe("0.7 - 1.3");
    expect(f.subject).toBe("p1");
    expect(f.id).toBe("cmp-e0-2160-0");
  });

  it("renders a qualitative value as a bilingual string", () => {
    const f = engineObservationToFhir({ ...obs, value: "Positive", qualitative: true, ref_low: null, ref_high: null }, "p1", 0, "x");
    expect(f.valueString).toEqual({ en: "Positive", tr: "Positive" });
    expect(f.referenceRange).toBeUndefined();
  });
});

describe("turnaroundLabel", () => {
  it("formats minutes and hours bilingually", () => {
    expect(turnaroundLabel(45)).toEqual({ en: "45 min", tr: "45 dk" });
    expect(turnaroundLabel(1440)).toEqual({ en: "24 h", tr: "24 sa" });
  });
});

describe("caseMetaProvenanceKey", () => {
  it("labels a template case as a template, not a generated case (acceptance 2026-10-20)", () => {
    expect(caseMetaProvenanceKey({ source: "template" }, "generated")).toBe("live2.source.template");
    expect(caseMetaProvenanceKey({ source: "model" }, "generated")).toBe("live2.source.model");
    expect(caseMetaProvenanceKey({ source: "offline" }, "generated")).toBe("live2.source.offline");
  });

  it("falls back to the case provenance before an encounter has generation meta", () => {
    expect(caseMetaProvenanceKey(null, "seed")).toBe("ehr.provenance.seed");
  });
});
