// @vitest-environment jsdom
/**
 * One request -> one case played in flight (review 06a 4.6): the encounter starts on
 * opening.ready, later layers of the SAME thread merge into it without a restart, a
 * question that reached a layer before it was written is answered when it lands, the
 * Director is stepped by thread_id and its patient line reaches the transcript.
 */
import { afterEach, describe, expect, it } from "vitest";

import { requestCase, endCaseSession } from "@/lib/caseSession";
import { personaFacts } from "@/lib/personaFacts";
import { layerForIntent, layerForManeuver } from "@/lib/caseLayers";
import { foldProgress, EMPTY_PROGRESS } from "@/components/ehr/CaseGenProgress";
import type { CaseGenV2Spec } from "@/lib/caseGenV2";
import {
  __flushLive,
  askQuestion,
  getEncounterSnapshot,
  resetEncounter,
  setLiveEnabled,
} from "@/state/encounterStore";

const sse = (event: string, data: unknown, id: number) => `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

function baseSpec(): CaseGenV2Spec {
  return {
    seed: 4242,
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
    meta: {
      source: "model", generator: "v2", pipeline: "staged", model: "acudx-llm", condition_id: "sepsis_uncomplicated",
      thread_id: "th-live", degraded: false, note: null, latency_ms: 9000,
      layers: { "history.background": "pending" },
    },
  } as CaseGenV2Spec;
}

function withBackground(spec: CaseGenV2Spec): CaseGenV2Spec {
  return {
    ...spec,
    hpi: [
      ...(spec.hpi ?? []),
      { uid: "history.background.0", intent: "allergies", answer_en: "I am allergic to penicillin.", answer_tr: "x", red_flag: false },
    ],
    meta: { ...spec.meta, layers: { "history.background": "ready" } },
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

describe("requestCase", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    setLiveEnabled(false);
    endCaseSession();
    resetEncounter();
  });

  it("starts on opening.ready and merges the later layers of the same thread", async () => {
    const opening = baseSpec();
    const later = withBackground(opening);
    globalThis.fetch = (async () =>
      streamOf([
        sse("start", { thread_id: "th-live", stages: ["s1"], eta_ms: { s1: 15000 } }, 1),
        sse("opening.delta", { path: "chief_complaint", value: "Fever and shaking" }, 2),
        sse("opening.ready", { thread_id: "th-live", opening: {}, spec: opening }, 3),
        sse("layer.pending", { layer: "history.background", reason: "continuation" }, 4),
        sse("layer.ready", { layer: "history.background", data: {}, spec: later }, 5),
        sse("done", { thread_id: "th-live", spec: later }, 6),
      ])) as typeof fetch;
    const seen: string[] = [];
    const res = await requestCase({ locale: "en" }, { onEvent: (e) => seen.push(e.event) });
    expect(res).toEqual({ ok: true, data: { threadId: "th-live" } });
    await new Promise((r) => setTimeout(r, 0));
    const s = getEncounterSnapshot();
    expect(s.generation).toMatchObject({ source: "model", threadId: "th-live" });
    expect(s.caseInstance?.groundTruth.history.map((h) => h.answer.en)).toContain("I am allergic to penicillin.");
    expect(s.caseLayers["history.background"]).toBe("ready");
    expect(seen).toEqual(["start", "opening.delta", "opening.ready", "layer.pending", "layer.ready", "done"]);
  });

  it("a question that reached an unwritten layer is answered when the layer lands", async () => {
    const opening = baseSpec();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      if (String(url).includes("/layer/")) {
        await gate;
        return new Response(JSON.stringify({ thread_id: "th-live", layer: "history.background", status: "ready", data: {}, spec: withBackground(opening) }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      return streamOf([sse("opening.ready", { thread_id: "th-live", opening: {}, spec: opening }, 1)]);
    }) as typeof fetch;
    await requestCase({ locale: "en" });
    askQuestion("allergies");
    let ev = getEncounterSnapshot().events.at(-1)!;
    expect(ev.meta).toMatchObject({ awaiting: true, hit: false });
    release();
    await new Promise((r) => setTimeout(r, 10));
    ev = getEncounterSnapshot().events.find((e) => e.seq === ev.seq)!;
    expect(ev.meta).toMatchObject({ awaiting: false, hit: true });
    expect((ev.meta?.revealed as string[]).length).toBe(1);
  });

  it("returns the server error and starts nothing when the model is unreachable", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "model_unreachable" }), { status: 503, headers: { "content-type": "application/json" } })) as typeof fetch;
    const res = await requestCase({ locale: "en" });
    expect(res).toEqual({ ok: false, error: "model_unreachable", status: 503 });
    expect(getEncounterSnapshot().caseInstance).toBeNull();
  });

  it("refuses a stream that serves a case that is not model generated", async () => {
    const bad = { ...baseSpec(), meta: { ...baseSpec().meta, source: "template" } } as CaseGenV2Spec;
    globalThis.fetch = (async () => streamOf([sse("done", { thread_id: "t", spec: bad }, 1)])) as typeof fetch;
    const res = await requestCase({ locale: "en" }).catch(() => ({ ok: false as const, error: "thrown" }));
    expect(res.ok).toBe(false);
    expect(getEncounterSnapshot().caseInstance).toBeNull();
  });

  it("steps the Director by thread_id and voices its line in the transcript", async () => {
    const opening = baseSpec();
    const bodies: Record<string, unknown>[] = [];
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes("/director/step")) {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({
          case_state: { t_ms: 30000 },
          patient_visible_changes: {
            t_ms: 30000, vitals: { hr: 130, systolic: 84, diastolic: 50, rr: 28, spo2: 89, tempC: 39.4 },
            affect: { pain: 6, anxiety: 0.7, dyspnea: 0.7, consciousness: "alert", mood_en: "frightened", mood_tr: "korkmuş" },
            utterance_en: "I can hardly breathe now.", utterance_tr: "Artık zor nefes alıyorum.",
            new_facts: [], complications_fired: [], trace: [],
          },
          director_notes: [],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return streamOf([sse("opening.ready", { thread_id: "th-live", opening: {}, spec: opening }, 1)]);
    }) as typeof fetch;
    await requestCase({ locale: "en" });
    setLiveEnabled(true);
    askQuestion("onset");
    await __flushLive();
    expect(bodies[0]).toMatchObject({ thread_id: "th-live", action: { kind: "question", ref: "onset" } });
    expect(bodies[0]).not.toHaveProperty("spec");
    const lines = getEncounterSnapshot().dialogue.filter((d) => d.role === "patient").map((d) => d.en);
    expect(lines).toContain("I can hardly breathe now.");
    // A question the persona already voiced does not get the narrator line on top.
    askQuestion("onset", { voiced: true });
    await __flushLive();
    expect(getEncounterSnapshot().dialogue.filter((d) => d.role === "patient")).toHaveLength(1);
  });
});

describe("persona facts follow the questions actually asked", () => {
  it("sanctions revealed answers and the current question only", async () => {
    const { specToCaseInstance } = await import("@/lib/liveCaseGen");
    const c = specToCaseInstance(withBackground(baseSpec()) as never);
    const none = personaFacts(c, new Set(), "en", null);
    expect(none.sanctioned).toEqual([]);
    const asked = personaFacts(c, new Set(), "en", "allergies");
    expect(asked.sanctioned).toEqual(["I am allergic to penicillin."]);
    const revealed = personaFacts(c, new Set([c.groundTruth.history[0].id]), "en", null);
    expect(revealed.sanctioned).toEqual(["Since last night."]);
    expect(revealed.narrative[0]).toBe("Fever and shaking");
  });
});

describe("layer vocabulary and progress", () => {
  it("maps actions to the layer they read", () => {
    expect(layerForIntent("onset")).toBe("history.presenting");
    expect(layerForIntent("allergies")).toBe("history.background");
    expect(layerForManeuver("skin")).toBe("exam.msk_skin");
  });

  it("folds streamed opening fields into the progress preview", () => {
    let p = foldProgress(EMPTY_PROGRESS, { event: "start", thread_id: "t", eta_ms: { s1: 14000 } });
    p = foldProgress(p, { event: "opening.delta", path: "demographics.age", value: 58 });
    expect(p).toMatchObject({ threadId: "t", etaMs: 14000, phase: "writing", preview: { "demographics.age": 58 } });
  });
});
