// @vitest-environment jsdom
/**
 * Acceptance test 2026-10-20 (docs/review/05), second pass: D-11, D-12, D-19,
 * D-20 through the real case builder and encounter store.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  __setClock,
  askQuestion,
  administerMedication,
  resetEncounter,
  startEncounter,
  useEncounterState,
  type EncounterState,
} from "@/state/encounterStore";
import { v2SpecToCaseInstance, type CaseGenV2Spec } from "@/lib/caseGenV2";
import { inferQuestionIntent, inferQuestionTopic } from "@/domain/scopeGuard";
import { getOrderableByCode } from "@/domain/orderables";
import { buildEncounterRecord, deriveTreatmentBehaviors } from "@/state/progressStore";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const topic = (t: string, intent: string, en: string) => ({ intent, topic: t, answer_en: en, answer_tr: en, red_flag: false });

/** A sepsis template spec as the server returns it (server/case_fixtures.py). */
const SEPSIS: CaseGenV2Spec = {
  seed: 2,
  locale: "en",
  condition: { icd11: "1G40", icd10: "A41.9", label_en: "Sepsis", label_tr: "Sepsis", system: "emergency" },
  demographics: { age: 64, sex: "female", name_hint: "Ayla K." },
  chief_complaint_en: "Fever with a fast heart rate and malaise",
  chief_complaint_tr: "Ateş, hızlı nabız ve halsizlik",
  acuity_esi: 2,
  difficulty: 3,
  hpi: [
    { intent: "onset", answer_en: "Since yesterday.", answer_tr: "Dünden beri.", red_flag: false },
    { intent: "allergies", answer_en: "No known drug allergies.", answer_tr: "Bilinen ilaç alerjim yok.", red_flag: false },
    { intent: "red-flags", answer_en: "I feel faint when I stand.", answer_tr: "Ayağa kalkınca bayılacak gibi oluyorum.", red_flag: true },
    topic("rigors", "associated-symptoms", "Yes, proper shaking chills."),
    topic("urinary", "associated-symptoms", "No burning when I pass urine."),
    topic("cough", "associated-symptoms", "No cough and no phlegm."),
    topic("neck", "associated-symptoms", "My neck moves fine."),
    topic("travel", "social-history", "I haven't travelled anywhere recently."),
    topic("contacts", "social-history", "Nobody around me has been ill."),
    topic("vaccination", "past-medical-history", "My vaccinations are up to date."),
    topic("immunosuppression", "risk-factors", "I don't take steroids."),
  ],
  allergies_en: "No known drug allergies.",
  allergies_tr: "Bilinen ilaç alerjim yok.",
  exam: [{ maneuver: "general-inspection", system_en: "General", system_tr: "Genel", finding_en: "Flushed.", finding_tr: "Kızarık.", abnormal: true }],
  triage_vitals: { hr: 116, systolic: 119, diastolic: 75, rr: 22, spo2: 95, tempC: 39.1 },
  vitals_trajectory: [{ atMs: 0, hr: 116, systolic: 119, diastolic: 75, rr: 22, spo2: 95, tempC: 39.1 }],
  labs: [{ code: "2524-7", label_en: "Lactate", label_tr: "Laktat", value: 2.8, unit: "mmol/L", ref_low: 0.5, ref_high: 2, flag: "H", category: "blood-gas" }],
  imaging: [{ code: "36643-5", modality_en: "Chest X-ray", modality_tr: "Akciğer grafisi", findings_en: "No consolidation.", findings_tr: "Konsolidasyon yok." }],
  treatments: [
    { code: "cultures", label_en: "Blood cultures (2 sets) before antibiotics", label_tr: "Kültür", appropriateness: "indicated", effects: [], narrative_en: "", narrative_tr: "" },
    { code: "abx", label_en: "Broad-spectrum IV antibiotics within 1 hour", label_tr: "Antibiyotik", appropriateness: "indicated", effects: [], narrative_en: "", narrative_tr: "" },
    { code: "delay_abx", label_en: "Delay antibiotics until all results are back", label_tr: "Ertele", appropriateness: "contraindicated", effects: [], narrative_en: "", narrative_tr: "" },
  ],
  disposition: "admit-ward",
  guideline_anchors: [
    { statement_id: "gs_ssc21_lactate_cultures", codes: ["2524-7", "blood-culture"], statement_en: "Cultures.", statement_tr: "Kültür.", source: "SSC", citation: "https://www.sccm.org/" },
    { statement_id: "gs_nice_ng250_cap_4h", codes: ["cxr"], statement_en: "CXR.", statement_tr: "AG.", source: "NICE", citation: "https://www.nice.org.uk/" },
  ],
  meta: { source: "template", generator: "v2", model: null, condition_id: "sepsis_uncomplicated", degraded: true, note: null, latency_ms: 0 },
} as unknown as CaseGenV2Spec;

let root: Root | null = null;
let snapshot: EncounterState;
let restoreClock: () => void;
let now = 0;

function Probe() {
  const s = useEncounterState();
  useEffect(() => {
    snapshot = s;
  });
  return null;
}

beforeEach(() => {
  now = 0;
  restoreClock = __setClock(() => now);
  const container = document.createElement("div");
  act(() => {
    root = createRoot(container);
    root.render(createElement(Probe));
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  resetEncounter();
  restoreClock();
});

describe("D-19 case imaging maps to the catalogue chest X-ray", () => {
  it("the case's chest film is the catalogue 'cxr', so there is one orderable", () => {
    const c = v2SpecToCaseInstance(SEPSIS).case;
    const cxr = c.expectedWorkup.find((w) => w.kind === "imaging");
    expect(cxr?.code.coding[0]?.code).toBe("cxr");
    expect(getOrderableByCode("cxr")).toBeDefined();
    expect(c.groundTruth.imaging[0].orderCode).toBe("cxr");
  });
});

describe("D-11 work-up rows cite verified statements", () => {
  it("each expectation carries the statement that names its order code", () => {
    const c = v2SpecToCaseInstance(SEPSIS).case;
    const byCode = new Map(c.expectedWorkup.map((w) => [w.code.coding[0]?.code, w.citationId] as const));
    expect(byCode.get("2524-7")).toBe("gs_ssc21_lactate_cultures");
    expect(byCode.get("cxr")).toBe("gs_nice_ng250_cap_4h");
  });

  it("sepsis feedback lists sepsis red flags, not cardiac, and no NICE NG185", () => {
    const c = v2SpecToCaseInstance(SEPSIS).case;
    const rec = buildEncounterRecord([], c, 1, 0);
    const rows = deriveTreatmentBehaviors(rec);
    expect(rows[0].label.en).toMatch(/sepsis/i);
    expect(rows[0].label.en).not.toMatch(/cardiac/i);
    expect(rows.map((r) => r.citationId)).not.toContain("gs_nice_ng185_reperfusion_eligibility");
    expect(rows.map((r) => r.citationId)).toEqual(["gs_nice_ng253_high_risk_criteria", "gs_nice_cg183_check_allergy", "gs_nice_ng197_what_matters"]);
  });
});

describe("D-12 fever topics answer the question that was asked", () => {
  it("infers the topic and intent from free text", () => {
    const c = v2SpecToCaseInstance(SEPSIS).case;
    expect(inferQuestionTopic("Have you had any shaking chills or rigors?")?.topic).toBe("rigors");
    expect(inferQuestionIntent("Any burning when you pass urine?", c)).toBe("associated-symptoms");
    expect(inferQuestionIntent("Have you travelled abroad recently?", c)).toBe("social-history");
    expect(inferQuestionIntent("Are your vaccinations up to date?", c)).toBe("past-medical-history");
    expect(inferQuestionIntent("Do you take steroids or chemotherapy?", c)).toBe("risk-factors");
  });

  it("reveals only the rigors answer for a rigors question", () => {
    const c = v2SpecToCaseInstance(SEPSIS).case;
    act(() => startEncounter(c));
    act(() => askQuestion("associated-symptoms", { utterance: "Any shaking chills or rigors?" }));
    const ev = snapshot.events.filter((e) => e.type === "question").at(-1)!;
    const revealed = ev.meta?.revealed as string[];
    expect(revealed).toHaveLength(1);
    expect(c.groundTruth.history.find((h) => h.id === revealed[0])?.topic).toBe("rigors");
  });

  it("does not repeat the allergy answer as an unlabelled line", () => {
    const c = v2SpecToCaseInstance(SEPSIS).case;
    expect(c.groundTruth.history.filter((h) => h.intent === "allergies")).toHaveLength(1);
  });
});

describe("D-25 febrile differentials", () => {
  it("a febrile case is not offered GERD, and a malaria case is offered sepsis and pneumonia", () => {
    const sepsis = v2SpecToCaseInstance(SEPSIS).case.differentials.map((d) => d.code.coding[0]?.code);
    expect(sepsis).not.toContain("K21.9");
    const malaria = v2SpecToCaseInstance({
      ...SEPSIS,
      condition: { icd11: "1F40", icd10: "B54", label_en: "Malaria", label_tr: "Sıtma", system: "infectious" },
    } as CaseGenV2Spec).case.differentials.map((d) => d.code.coding[0]?.code);
    expect(malaria).not.toContain("K21.9");
    expect(malaria).toEqual(expect.arrayContaining(["A41.9", "N10"]));
  });
});

describe("D-20 an indicated formulary antibiotic scores indicated", () => {
  it("vancomycin given in sepsis is recorded as indicated, not neutral", () => {
    const c = v2SpecToCaseInstance(SEPSIS).case;
    act(() => startEncounter(c));
    act(() => {
      administerMedication({ drug: "11124", dose: 1500, unit: "mg", route: "IV", frequency: "", indication: "sepsis", weightKg: 70 });
    });
    const tx = snapshot.events.find((e) => e.type === "treatment" && e.ref === "11124");
    expect(tx?.meta?.appropriateness).toBe("indicated");
  });
});
