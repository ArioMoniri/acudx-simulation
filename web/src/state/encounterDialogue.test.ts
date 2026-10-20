// @vitest-environment jsdom
/**
 * One patient line per action (coordinator defect, F-W8 follow-up): the Director's
 * utterance is rendered only when no persona reply (/v1/patient/turn) answered the same
 * action, and identical consecutive patient lines are shown once.
 */
import { afterEach, describe, expect, it } from "vitest";

import type { CaseGenV2Spec } from "@/lib/caseGenV2";
import { v2SpecToCaseInstance } from "@/lib/caseGenV2";
import {
  __flushLive,
  askQuestion,
  dedupePatientTurns,
  getEncounterSnapshot,
  recordDialogue,
  resetEncounter,
  setLiveEnabled,
  startGeneratedEncounter,
} from "@/state/encounterStore";

const UTTER = "It hurts more when I breathe in.";

function spec(): CaseGenV2Spec {
  return {
    seed: 3, locale: "en",
    condition: { icd11: "CA40", icd10: "J18.9", label_en: "Pneumonia", label_tr: "Pnömoni", system: "respiratory" },
    demographics: { age: 54, sex: "male", name_hint: "Can T." },
    chief_complaint_en: "Cough and fever", chief_complaint_tr: "Cough and fever",
    acuity_esi: 3, difficulty: 2,
    hpi: [{ uid: "op.0", intent: "onset", answer_en: "Three days ago.", answer_tr: "Üç gün önce.", red_flag: false }],
    exam: [], triage_vitals: { hr: 104, systolic: 122, diastolic: 74, rr: 22, spo2: 94, tempC: 38.6 },
    vitals_trajectory: [{ atMs: 0, hr: 104, systolic: 122, diastolic: 74, rr: 22, spo2: 94, tempC: 38.6 }],
    labs: [], imaging: [], treatments: [], disposition: "admit-ward",
    meta: { source: "model", generator: "v2", pipeline: "staged", model: "acudx-llm", condition_id: "cap", thread_id: "th-d",
            degraded: false, note: null, latency_ms: 1 },
  } as CaseGenV2Spec;
}

function directorReplying(line: string): void {
  globalThis.fetch = (async () => new Response(JSON.stringify({
    case_state: { t_ms: 30000 },
    patient_visible_changes: {
      t_ms: 30000, vitals: { hr: 106, systolic: 120, diastolic: 72, rr: 23, spo2: 93, tempC: 38.7 },
      affect: { pain: 4, anxiety: 0.4, dyspnea: 0.4, consciousness: "alert", mood_en: "worried", mood_tr: "endişeli" },
      utterance_en: line, utterance_tr: line, new_facts: [], complications_fired: [], trace: [],
    },
    director_notes: [],
  }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
}

const patientLines = () => getEncounterSnapshot().dialogue.filter((d) => d.role === "patient").map((d) => d.en);

describe("one patient line per action", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    setLiveEnabled(false);
    resetEncounter();
  });

  function start(): void {
    startGeneratedEncounter(v2SpecToCaseInstance(spec()).case, {
      source: "model", threadId: "th-d", council: null, degraded: false, model: null, note: null,
    });
    setLiveEnabled(true);
  }

  it("drops the Director line when a persona reply answered the same action, even unmarked", async () => {
    start();
    directorReplying("I have had this cough for three days now.");
    recordDialogue({ doctorText: "When did it start?", patient: { en: UTTER, tr: UTTER }, affect: "worried", source: "live" });
    askQuestion("onset", { utterance: "When did it start?" }); // a caller that forgot voiced
    await __flushLive();
    expect(patientLines()).toEqual([UTTER]);
  });

  it("does not append a Director line identical to the patient's last line", async () => {
    start();
    directorReplying(UTTER);
    recordDialogue({ doctorText: "How is the pain?", patient: { en: UTTER, tr: UTTER }, affect: "worried", source: "live" });
    askQuestion("character"); // a separate chip question, not voiced
    await __flushLive();
    expect(patientLines()).toEqual([UTTER]);
  });

  it("still voices the Director line when no persona reply answered", async () => {
    start();
    directorReplying("I feel short of breath now.");
    askQuestion("onset");
    await __flushLive();
    expect(patientLines()).toEqual(["I feel short of breath now."]);
  });

  it("dedupes identical consecutive patient turns in the transcript", () => {
    const turns = [
      { id: "d1", role: "doctor" as const, en: "Q", tr: "Q", seq: 1 },
      { id: "p1", role: "patient" as const, en: "It hurts.", tr: "Acıyor.", seq: 1 },
      { id: "p2", role: "patient" as const, en: " it hurts ", tr: "acıyor", seq: 2 },
      { id: "p3", role: "patient" as const, en: "Worse now.", tr: "Daha kötü.", seq: 2 },
    ];
    expect(dedupePatientTurns(turns).map((t) => t.id)).toEqual(["d1", "p1", "p3"]);
  });
});
