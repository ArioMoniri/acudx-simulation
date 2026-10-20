// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import {
  __flushLive,
  __setClock,
  askQuestion,
  administerTreatment,
  getCurrentVitals,
  getPersonaLiveContext,
  placeOrder,
  resetEncounter,
  setLiveEnabled,
  startEncounter,
  useEncounterState,
  type EncounterState,
} from "@/state/encounterStore";
import { generateCase } from "@/domain/caseGen";
import { currentVitals } from "@/domain/clinicalCourse";
import type { CaseInstance } from "@/domain/case";
import type { DirectorStepResult } from "@/lib/caseGenV2";
import type { OrderResult } from "@/lib/resultsApi";

/**
 * Live-mode wiring of the encounter store against an in-test fetch double that
 * answers with the exact shapes of POST /v1/results/resolve and
 * POST /v2/director/step (server/results_routes.py, server/orchestration/routes.py).
 *
 * Covered: the engine resolves a placed order and the result event is labelled
 * meta.source = "engine" with the server turnaround as the ETA; a failing engine
 * falls back to the labelled offline path; every learner action steps the
 * Director with the round-tripped case_state; the Director's vitals land on
 * getCurrentVitals within bounds; notes become events with meta.director; the
 * persona context carries sanctioned facts and adjectives; offline mode never
 * calls the network and labels its results "case" / "offline-synthetic-normal".
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeCase(seed: number): CaseInstance {
  return generateCase({ seedMode: "constrained", chiefComplaint: "chest-pain", locale: "en", seed });
}

/* ---- Fetch double ------------------------------------------------------- */

interface Call {
  url: string;
  body: Record<string, unknown>;
}

const calls: Call[] = [];
let engineStatus = 200;
/** When set, the Director answer waits for this promise (an in-flight step). */
let directorHold: Promise<void> | null = null;
let directorVitals = { hr: 128, systolic: 84, diastolic: 52, rr: 26, spo2: 88, tempC: 37.8 };

function engineAnswer(body: Record<string, unknown>): OrderResult {
  const code = String(body.order_code);
  const simTime = Number(body.sim_time_ms ?? 0);
  return {
    order_code: code,
    kind: code === "11524-6" ? "ecg" : "lab",
    status: "ok",
    sim_time_ms: simTime,
    t_since_onset_h: 3,
    condition_id: "acs_nstemi",
    severity: 0.55,
    turnaround: { category: "haematology", minutes: 40, ms: 2_400_000, source: "Hawkins 2007" },
    available_at_ms: simTime + 2_400_000,
    observations: [
      {
        loinc: "718-7",
        name: "Hemoglobin",
        short: "Hb",
        value: 13.9,
        unit: "g/dL",
        qualitative: false,
        ref_low: 13.5,
        ref_high: 17.5,
        flag: "N",
        critical: false,
        interpretation: "Within the reference range.",
        delta: null,
        kinetics: null,
        ground_truth: false,
        source: "https://www.nbme.org/laboratory-values/",
        reviewed_at: "2026-10-19",
      },
      {
        loinc: "2823-3",
        name: "Potassium",
        short: "K",
        value: 6.4,
        unit: "mmol/L",
        qualitative: false,
        ref_low: 3.5,
        ref_high: 5.0,
        flag: "HH",
        critical: true,
        interpretation: "Critical high.",
        delta: null,
        kinetics: "potassium",
        ground_truth: false,
        source: "https://www.nbme.org/laboratory-values/",
        reviewed_at: "2026-10-19",
      },
    ],
    abnormal: true,
    critical: true,
    treatments_applied: [],
    narrative: null,
    meta: { source: "engine", seed: 1, reference_ranges_version: "1", degraded: false, is_synthetic_patient: true },
  };
}

function directorAnswer(body: Record<string, unknown>): DirectorStepResult {
  const prev = (body.case_state as Record<string, unknown> | undefined) ?? null;
  const steps = prev ? Number(prev.steps ?? 0) + 1 : 1;
  return {
    case_state: { t_ms: steps * 30_000, steps, from_spec: prev == null },
    patient_visible_changes: {
      t_ms: steps * 30_000,
      vitals: directorVitals,
      affect: { pain: 7, anxiety: 6, dyspnea: 6, consciousness: "alert", mood_en: "frightened", mood_tr: "korkmus" },
      utterance_en: "It is getting harder to breathe.",
      utterance_tr: "Nefes almak zorlasiyor.",
      new_facts: [`fact-${steps}`],
      complications_fired: steps >= 2 ? ["missed_time_critical_treatment"] : [],
      trace: [],
    },
    director_notes: [{ at_ms: steps * 30_000, note: `Step ${steps}: ${String((body.action as { kind: string }).kind)}`, why: "test" }],
  };
}

const fetchDouble: typeof fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
  calls.push({ url, body });
  if (url.endsWith("/v1/results/resolve")) {
    if (engineStatus !== 200) {
      return new Response(JSON.stringify({ detail: "unavailable" }), { status: engineStatus });
    }
    return new Response(JSON.stringify(engineAnswer(body)), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.endsWith("/v2/director/step")) {
    if (directorHold) await directorHold;
    return new Response(JSON.stringify(directorAnswer(body)), { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response("not found", { status: 404 });
};

/* ---- Probe --------------------------------------------------------------- */

let root: Root | null = null;
let snapshot: EncounterState;
let restoreClock: () => void;
let now = 0;
const realFetch = globalThis.fetch;

function Probe() {
  snapshot = useEncounterState();
  return null;
}

function run(fn: () => void): void {
  act(() => {
    fn();
  });
}

async function flush(): Promise<void> {
  await act(async () => {
    await __flushLive();
  });
}

beforeEach(() => {
  now = 0;
  calls.length = 0;
  engineStatus = 200;
  directorHold = null;
  directorVitals = { hr: 128, systolic: 84, diastolic: 52, rr: 26, spo2: 88, tempC: 37.8 };
  globalThis.fetch = fetchDouble;
  restoreClock = __setClock(() => now);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  const container = document.createElement("div");
  act(() => {
    root = createRoot(container);
    root.render(createElement(Probe));
  });
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  resetEncounter();
  setLiveEnabled(false);
  restoreClock();
  globalThis.fetch = realFetch;
  vi.useRealTimers();
});

const engineCalls = () => calls.filter((c) => c.url.endsWith("/v1/results/resolve"));
const directorCalls = () => calls.filter((c) => c.url.endsWith("/v2/director/step"));

describe("encounterStore Live mode: results engine", () => {
  it("resolves a placed order through POST /v1/results/resolve and labels the result meta.source = engine", async () => {
    const c = makeCase(301);
    run(() => setLiveEnabled(true));
    run(() => startEncounter(c));
    expect(snapshot.liveEnabled).toBe(true);
    expect(snapshot.generation?.source).toBe("offline");

    now = 90_000;
    run(() => placeOrder("cbc", { en: "CBC", tr: "Hemogram" }));
    await flush();

    const [call] = engineCalls();
    expect(call).toBeDefined();
    expect(call.body.order_code).toBe("cbc");
    expect(call.body.sim_time_ms).toBe(90_000);
    const cs = call.body.case_state as Record<string, unknown>;
    expect((cs.condition as { label_en: string }).label_en).toBe(c.correctDiagnosis.code.text?.en);
    expect(cs.treatments_given).toEqual([]);

    // The server turnaround drives the ETA label; the playback timer schedules.
    const order = snapshot.orders.find((o) => o.code === "cbc")!;
    expect(order.clinicalLabelEn).toBe("40 min");
    expect(order.clinicalLabelTr).toBe("40 dk");
    expect(order.engineTurnaroundMs).toBe(2_400_000);
    expect(order.resolved).toBe(false);

    const readyAt = order.resultsReadyAt;
    run(() => {
      now = readyAt;
      vi.advanceTimersByTime(readyAt - 90_000);
    });
    await flush();

    const resolved = snapshot.orders.find((o) => o.code === "cbc")!;
    expect(resolved.resolved).toBe(true);
    expect(resolved.source).toBe("engine");
    const result = snapshot.results.find((r) => r.code === "cbc")!;
    expect(result.source).toBe("engine");
    expect(result.engine?.observations?.map((o) => o.loinc)).toEqual(["718-7", "2823-3"]);
    const ev = snapshot.events.find((e) => e.type === "result" && e.ref === "cbc")!;
    expect(ev.meta).toMatchObject({ source: "engine", engineKind: "lab", critical: true, abnormal: true });
  });

  it("passes earlier engine results as prior and the treatments given so far", async () => {
    const c = makeCase(302);
    run(() => setLiveEnabled(true));
    run(() => startEncounter(c));
    run(() => placeOrder("cbc", { en: "CBC", tr: "Hemogram" }));
    await flush();
    const first = snapshot.orders[0];
    run(() => {
      now = first.resultsReadyAt;
      vi.advanceTimersByTime(first.resultsReadyAt);
    });
    await flush();
    run(() => administerTreatment("4917", { en: "Nitroglycerin", tr: "Nitrogliserin" }));
    now = first.resultsReadyAt + 1000;
    run(() => placeOrder("cbc", { en: "CBC", tr: "Hemogram" }));
    await flush();
    const second = engineCalls()[1];
    expect(Array.isArray(second.body.prior)).toBe(true);
    expect((second.body.prior as OrderResult[])[0].order_code).toBe("cbc");
    const cs = second.body.case_state as { treatments_given: Array<{ code: string; label: string }> };
    expect(cs.treatments_given[0]).toMatchObject({ code: "4917", label: "Nitroglycerin" });
  });

  it("falls back to the labelled offline path when the engine answers 503, without throwing", async () => {
    engineStatus = 503;
    const c = makeCase(303);
    run(() => setLiveEnabled(true));
    run(() => startEncounter(c));
    run(() => placeOrder("cbc", { en: "CBC", tr: "Hemogram" }));
    await flush();
    const order = snapshot.orders[0];
    run(() => {
      now = order.resultsReadyAt;
      vi.advanceTimersByTime(order.resultsReadyAt);
    });
    await flush();
    const ev = snapshot.events.find((e) => e.type === "result" && e.ref === "cbc")!;
    expect(ev.meta?.source).toBe("offline-synthetic-normal");
    expect(snapshot.results[0].engine).toBeUndefined();
  });
});

describe("encounterStore Live mode: Clinical Director", () => {
  it("steps the Director on every action, round-trips case_state and applies the vitals within bounds", async () => {
    const c = makeCase(304);
    run(() => setLiveEnabled(true));
    run(() => startEncounter(c));
    const intent = c.groundTruth.history[0].intent;
    const localBefore = currentVitals(c, 0, []);

    run(() => askQuestion(intent));
    await flush();

    const [first] = directorCalls();
    expect(first.body.spec).toBeDefined();
    expect(first.body.case_state).toBeUndefined();
    expect(first.body.action).toMatchObject({ kind: "question", ref: intent, locale: "en" });
    expect(snapshot.director.steps).toBe(1);
    expect(snapshot.director.caseState).toMatchObject({ steps: 1 });

    // The Director's vitals replace the local course (delta from local at the step).
    const v = getCurrentVitals(snapshot)!;
    expect(v.hr).toBe(128);
    expect(v.spo2).toBe(88);
    expect(v.systolic).toBe(84);
    expect(localBefore.hr).not.toBe(128);

    // Director notes are events with meta.director = true (visible in the debrief).
    const note = snapshot.events.find((e) => e.type === "note" && e.meta?.director === true)!;
    expect(note.ref).toBe("director");
    expect(note.meta).toMatchObject({ note: "Step 1: question", why: "test" });

    run(() => administerTreatment("4917", { en: "Nitroglycerin", tr: "Nitrogliserin" }));
    await flush();
    const second = directorCalls()[1];
    expect(second.body.case_state).toMatchObject({ steps: 1 });
    expect(second.body.spec).toBeUndefined();
    expect(second.body.action).toMatchObject({ kind: "treatment", ref: "4917" });
    // A fired complication is logged once as a stage event.
    const comps = snapshot.events.filter((e) => e.type === "stage" && e.meta?.complication === "missed_time_critical_treatment");
    expect(comps).toHaveLength(1);
  });

  it("never lets an out-of-range Director payload escape the physiological bounds", async () => {
    directorVitals = { hr: 900, systolic: 5, diastolic: 400, rr: 120, spo2: 150, tempC: 60 };
    const c = makeCase(305);
    run(() => setLiveEnabled(true));
    run(() => startEncounter(c));
    run(() => askQuestion(c.groundTruth.history[0].intent));
    await flush();
    const v = getCurrentVitals(snapshot)!;
    expect(v.hr).toBeLessThanOrEqual(250);
    expect(v.systolic).toBeGreaterThanOrEqual(40);
    expect(v.diastolic).toBeLessThan(v.systolic);
    expect(v.rr).toBeLessThanOrEqual(60);
    expect(v.spo2).toBeLessThanOrEqual(100);
    expect(v.tempC).toBeLessThanOrEqual(43);
  });

  it("feeds the persona turn the sanctioned facts, adjectives and affect", async () => {
    const c = makeCase(306);
    run(() => setLiveEnabled(true));
    run(() => startEncounter(c));
    run(() => askQuestion(c.groundTruth.history[0].intent));
    await flush();
    const ctx = getPersonaLiveContext(snapshot);
    expect(ctx.sanctioned_facts).toEqual(["fact-1"]);
    expect(ctx.vitals_adjectives).toEqual(expect.arrayContaining(["tachycardic", "hypotensive", "hypoxic", "tachypnoeic"]));
    expect(ctx.affect?.mood_en).toBe("frightened");
  });

  it("steps the Director every 60 s of sim time with a coalesced elapsed action", async () => {
    const c = makeCase(307);
    run(() => setLiveEnabled(true));
    run(() => startEncounter(c));
    run(() => {
      now = 60_000;
      vi.advanceTimersByTime(60_000);
    });
    await flush();
    const ticks = directorCalls().filter((d) => (d.body.action as { kind: string }).kind === "elapsed");
    expect(ticks).toHaveLength(1);
    expect(ticks[0].body.action).toMatchObject({ elapsed_ms: 60_000 });
  });
});

describe("encounterStore offline mode: honest labelling, no network", () => {
  it("labels an authored result 'case' and an uncovered order 'offline-synthetic-normal' and never fetches", () => {
    const c = makeCase(106);
    run(() => setLiveEnabled(false));
    run(() => startEncounter(c));
    const authored = c.groundTruth.labs[0].orderCode;
    run(() => placeOrder(authored));
    run(() => placeOrder("cbc", { en: "CBC", tr: "Hemogram" }));
    expect(snapshot.orders.map((o) => o.source)).toEqual(["case", "offline-synthetic-normal"]);
    const latest = Math.max(...snapshot.orders.map((o) => o.resultsReadyAt));
    run(() => {
      now = latest;
      vi.advanceTimersByTime(latest);
    });
    const byCode = (code: string) => snapshot.events.find((e) => e.type === "result" && e.ref === code)!;
    expect(byCode(authored).meta?.source).toBe("case");
    expect(byCode("cbc").meta?.source).toBe("offline-synthetic-normal");
    expect(snapshot.results.every((r) => r.orderId.startsWith("ord-"))).toBe(true);
    expect(calls).toHaveLength(0);
    expect(snapshot.director.steps).toBe(0);
  });
});

describe("encounterStore Live mode: switching Live off mid-step (review 04 O7)", () => {
  it("drops a Director answer that lands after Live was switched off", async () => {
    const c = makeCase(399);
    run(() => setLiveEnabled(true));
    run(() => startEncounter(c));
    let release: () => void = () => {};
    directorHold = new Promise<void>((resolve) => {
      release = resolve;
    });
    run(() => askQuestion(c.groundTruth.history[0].intent));
    await act(async () => {
      await Promise.resolve();
    });
    expect(directorCalls()).toHaveLength(1);
    expect(snapshot.director.status).toBe("busy");

    run(() => setLiveEnabled(false));
    release();
    await flush();

    expect(snapshot.liveEnabled).toBe(false);
    expect(snapshot.director.steps).toBe(0);
    expect(snapshot.director.caseState).toBeNull();
    expect(snapshot.director.overlay).toBeNull();
    expect(snapshot.director.status).toBe("idle");
    expect(snapshot.events.some((e) => e.meta?.director === true)).toBe(false);
  });
});
