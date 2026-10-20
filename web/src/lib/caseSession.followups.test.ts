// @vitest-environment jsdom
/**
 * Staged-generation follow-ups on the client (doc 15 section 12.7):
 *  - F30: a safety veto fails the treatment layer honestly, it is regenerated once, then
 *    offered for Retry, and administration is blocked until a safe table lands;
 *  - the debrief layer is requested when the diagnosis is committed;
 *  - a UI switch to Turkish renders the layers already seen (one call per layer);
 *  - a room member joins the thread and follows its log (layers and Director steps).
 */
import i18n from "i18next";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { endCaseSession, followCase, requestCase, seenLayers } from "@/lib/caseSession";
import type { CaseGenV2Spec } from "@/lib/caseGenV2";
import {
  DIRECTOR_CLIENT_ID,
  administerTreatment,
  askQuestion,
  commitDiagnosis,
  getEncounterSnapshot,
  getLayerFailure,
  getLayerRetrying,
  resetEncounter,
  startGeneratedEncounter,
  treatmentsLocked,
} from "@/state/encounterStore";
import { v2SpecToCaseInstance } from "@/lib/caseGenV2";
import { citationHref } from "@/lib/citations";

const sse = (event: string, data: unknown, id: number) => `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

function spec(extra: Partial<CaseGenV2Spec> = {}, layers: Record<string, string> = {}): CaseGenV2Spec {
  return {
    seed: 7,
    locale: "en",
    condition: { icd11: "1G40", icd10: "A41.9", label_en: "Sepsis", label_tr: "Sepsis", system: "infectious" },
    demographics: { age: 67, sex: "female", name_hint: "Ayla K." },
    chief_complaint_en: "Fever and shaking",
    chief_complaint_tr: "Fever and shaking",
    acuity_esi: 2,
    difficulty: 3,
    hpi: [{ uid: "op.0", intent: "onset", answer_en: "Since last night.", answer_tr: "Since last night.", red_flag: false }],
    exam: [],
    triage_vitals: { hr: 118, systolic: 96, diastolic: 58, rr: 24, spo2: 93, tempC: 39.1 },
    vitals_trajectory: [{ atMs: 0, hr: 118, systolic: 96, diastolic: 58, rr: 24, spo2: 93, tempC: 39.1 }],
    labs: [],
    imaging: [],
    treatments: [],
    disposition: "admit-ward",
    ...extra,
    meta: {
      source: "model", generator: "v2", pipeline: "staged", model: "acudx-llm", condition_id: "sepsis_uncomplicated",
      thread_id: "th-f", degraded: false, note: null, latency_ms: 9000, layers,
    },
  } as CaseGenV2Spec;
}

function streamOf(chunks: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const realFetch = globalThis.fetch;

beforeAll(async () => {
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  endCaseSession();
  resetEncounter();
  await i18n.changeLanguage("en");
});

describe("F30: a vetoed treatment table fails honestly", () => {
  it("keeps the reason, regenerates once, then offers Retry and blocks administration", async () => {
    const opening = spec({}, { treatments: "pending" });
    const layerCalls: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/layer/treatments")) {
        layerCalls.push(u);
        await gate;
        return json({ error: "safety_veto", detail: "rejected", reason: "rejected", retryable: true }, 502);
      }
      if (u.includes("/events?")) return streamOf([]); // reconnect after the last id: nothing new
      return streamOf([
        sse("opening.ready", { thread_id: "th-f", opening: {}, spec: opening }, 1),
        sse("layer.pending", { layer: "treatments", reason: "continuation" }, 2),
        sse("error", {
          stage: "treatments", error: "safety_veto", status: 502, retryable: true,
          reason: "The safety review rejected the treatment table after the rewrite.", issues: ["aspirin marked contraindicated"],
        }, 3),
      ]);
    }) as typeof fetch;
    await requestCase({ locale: "en" });
    await tick(10);
    // The automatic regeneration is in flight: "being regenerated", nothing can be given.
    let s = getEncounterSnapshot();
    expect(getLayerRetrying(s, "treatments")).toMatchObject({ error: "safety_veto" });
    expect(treatmentsLocked(s)).toBe(true);
    expect(administerTreatment("ceftriaxone")).toBeNull();
    expect(getEncounterSnapshot().mar).toHaveLength(0);
    release();
    await tick(10);
    // Rejected again: failed with its reason; only Retry regenerates it (no second auto retry).
    s = getEncounterSnapshot();
    expect(getLayerFailure(s, "treatments")).toMatchObject({ error: "safety_veto" });
    expect(layerCalls).toHaveLength(1);
    expect(treatmentsLocked(s)).toBe(true);
    expect(s.caseInstance?.treatmentResponses ?? []).toEqual([]);
  });
});

describe("debrief on commit", () => {
  it("requests the debrief layer with the committed diagnosis and stores it with its citations", async () => {
    const bodies: Record<string, unknown>[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes("/layer/debrief")) {
        bodies.push(JSON.parse(String(init?.body)));
        await gate;
        return json({
          thread_id: "th-f", layer: "debrief", status: "ready", spec: spec(),
          data: {
            teaching_points: ["Give antibiotics within the hour.", "Reassess lactate."], missed_cues: [],
            anchors: [{ statement_id: "gs_sepsis_abx", statement_en: "Antibiotics within 1 h.", source: "SSC 2021", citation: "https://doi.org/10.1007/s00134-021-06506-y" }],
          },
        });
      }
      return streamOf([sse("opening.ready", { thread_id: "th-f", opening: {}, spec: spec() }, 1)]);
    }) as typeof fetch;
    await requestCase({ locale: "en" });
    commitDiagnosis("A41.9", "Sepsis");
    expect(getEncounterSnapshot().debrief.status).toBe("pending");
    await tick(5);
    expect(bodies[0]).toEqual({ reason: "committed", diagnosis: { code: "A41.9", display: "Sepsis" } });
    release();
    await tick(10);
    const d = getEncounterSnapshot().debrief;
    expect(d.status).toBe("ready");
    expect(d.data?.anchors[0].citation).toContain("doi.org");
  });

  it("links a citation only when it resolves", () => {
    expect(citationHref("https://example.org/x")).toBe("https://example.org/x");
    expect(citationHref("10.1007/s00134-021-06506-y")).toBe("https://doi.org/10.1007/s00134-021-06506-y");
    expect(citationHref("SSC guideline")).toBeNull();
  });
});

describe("TR renderings on a language switch", () => {
  it("maps revealed datum ids to the layers seen", () => {
    expect(seenLayers(["h-p-history.presenting.1", "obs-exam-p-exam.respiratory.0", "obs-p-results.lab.2", "h-p-op.0"]).sort()).toEqual(
      ["exam.respiratory", "history.presenting", "opening", "results"],
    );
  });

  it("renders the opening and every layer seen, once each, and keeps the source", async () => {
    const withHistory = spec({
      hpi: [
        { uid: "op.0", intent: "onset", answer_en: "Since last night.", answer_tr: "Since last night.", red_flag: false },
        { uid: "history.presenting.0", intent: "character", answer_en: "It is a dull ache.", answer_tr: "It is a dull ache.", red_flag: false },
      ],
    } as Partial<CaseGenV2Spec>, { "history.presenting": "ready" });
    const rendered = spec({
      chief_complaint_tr: "Ateş ve titreme",
      hpi: [
        { uid: "op.0", intent: "onset", answer_en: "Since last night.", answer_tr: "Dün geceden beri.", red_flag: false },
        { uid: "history.presenting.0", intent: "character", answer_en: "It is a dull ache.", answer_tr: "Künt bir ağrı.", red_flag: false },
      ],
    } as Partial<CaseGenV2Spec>, { "history.presenting": "ready" });
    const renders: string[] = [];
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.endsWith("/render")) {
        renders.push(u.split("/layer/")[1]);
        return json({ thread_id: "th-f", layer: "x", locale: "tr", status: "ready", data: {}, spec: rendered });
      }
      return streamOf([sse("opening.ready", { thread_id: "th-f", opening: {}, spec: withHistory }, 1)]);
    }) as typeof fetch;
    await requestCase({ locale: "en" });
    askQuestion("character");
    await tick(0);
    expect(renders).toEqual([]); // EN UI: nothing to render
    await i18n.changeLanguage("tr");
    await tick(10);
    expect(renders.sort()).toEqual(["history.presenting/render", "opening/render"]);
    const c = getEncounterSnapshot().caseInstance!;
    expect(c.chiefComplaint).toEqual({ en: "Fever and shaking", tr: "Ateş ve titreme" });
    // Switching again does not ask twice for a layer already rendered.
    await i18n.changeLanguage("en");
    await i18n.changeLanguage("tr");
    await tick(10);
    expect(renders).toHaveLength(2);
  });
});

describe("room members follow the thread", () => {
  it("joins with the room code and applies later layers and other members' Director steps", async () => {
    const later = spec({
      hpi: [
        { uid: "op.0", intent: "onset", answer_en: "Since last night.", answer_tr: "Since last night.", red_flag: false },
        { uid: "history.background.0", intent: "allergies", answer_en: "Penicillin gives me a rash.", answer_tr: "x", red_flag: false },
      ],
    } as Partial<CaseGenV2Spec>, { "history.background": "ready" });
    const directorEv = (client: string, t: number, line: string) => ({
      thread_id: "th-f", client_id: client, action: { kind: "question", ref: "onset" },
      case_state: { t_ms: t },
      patient_visible_changes: {
        t_ms: t, vitals: { hr: 130, systolic: 84, diastolic: 50, rr: 28, spo2: 89, tempC: 39.4 },
        affect: { pain: 6, anxiety: 0.7, dyspnea: 0.7, consciousness: "alert", mood_en: "frightened", mood_tr: "korkmuş" },
        utterance_en: line, utterance_tr: line, new_facts: [], complications_fired: [], trace: [],
      },
      director_notes: [],
    });
    const calls: string[] = [];
    const controller = new AbortController();
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      const u = String(url);
      calls.push(u.replace(/^.*\/v2/, ""));
      if (u.endsWith("/room")) return json({ error: "thread_not_found" }, 404);
      if (u.endsWith("/join")) return json({ thread_id: "th-f", member: true, last_event_id: 3 });
      if (u.includes("/events?")) {
        setTimeout(() => controller.abort(), 20);
        return streamOf([
          sse("layer.ready", { layer: "history.background", data: {}, spec: later }, 4),
          sse("director", directorEv(DIRECTOR_CLIENT_ID, 30000, "Mine, never applied twice."), 5),
          sse("director", directorEv("tab-host", 60000, "I feel worse now."), 6),
        ]);
      }
      return json({}, 404);
    }) as typeof fetch;
    // The member's encounter runs the room's thread from the snapshot (the opening).
    startGeneratedEncounter(v2SpecToCaseInstance(spec()).case, {
      source: "model", threadId: "th-f", council: null, degraded: false, model: null, note: null,
    });
    const owners: boolean[] = [];
    const done = followCase("th-f", "QX-77A", { signal: controller.signal, onAccess: ({ owner }) => owners.push(owner) });
    await done;
    expect(calls.slice(0, 3)).toEqual(["/case/th-f/room", "/case/th-f/join", "/case/th-f/events?after=0&follow=1"]);
    expect(owners).toEqual([false]);
    const s = getEncounterSnapshot();
    expect(s.caseInstance?.groundTruth.history.map((h) => h.answer.en)).toContain("Penicillin gives me a rash.");
    const lines = s.dialogue.filter((d) => d.role === "patient").map((d) => d.en);
    expect(lines).toEqual(["I feel worse now."]);
    expect(s.director.caseState?.t_ms).toBe(60000);
  });
});

describe("EN renderings of a TR case", () => {
  it("renders the layers seen into English when a TR case is played with an English UI", async () => {
    const tr = (s: CaseGenV2Spec): CaseGenV2Spec => ({ ...s, locale: "tr", meta: { ...s.meta, locale: "tr" } } as CaseGenV2Spec);
    const opening = tr(spec({
      chief_complaint_en: "Ateş ve titreme",
      chief_complaint_tr: "Ateş ve titreme",
      hpi: [{ uid: "op.0", intent: "onset", answer_en: "Dün geceden beri.", answer_tr: "Dün geceden beri.", red_flag: false }],
    } as Partial<CaseGenV2Spec>));
    const rendered = tr(spec({
      chief_complaint_en: "Fever and shaking",
      chief_complaint_tr: "Ateş ve titreme",
      hpi: [{ uid: "op.0", intent: "onset", answer_en: "Since last night.", answer_tr: "Dün geceden beri.", red_flag: false }],
    } as Partial<CaseGenV2Spec>));
    const renders: { layer: string; locale: unknown }[] = [];
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/render")) {
        renders.push({ layer: u.split("/layer/")[1], locale: JSON.parse(String(init?.body)).locale });
        return json({ thread_id: "th-f", layer: "opening", locale: "en", status: "ready", data: {}, spec: rendered });
      }
      return streamOf([sse("opening.ready", { thread_id: "th-f", opening: {}, spec: opening }, 1)]);
    }) as typeof fetch;
    await i18n.changeLanguage("tr");
    await requestCase({ locale: "tr" });
    await tick(5);
    expect(renders).toEqual([]); // TR UI on a TR case: nothing to render
    await i18n.changeLanguage("en");
    await tick(10);
    expect(renders).toEqual([{ layer: "opening/render", locale: "en" }]);
    const c = getEncounterSnapshot().caseInstance!;
    expect(c.chiefComplaint).toEqual({ en: "Fever and shaking", tr: "Ateş ve titreme" });
  });
});
