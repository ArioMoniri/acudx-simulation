// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  __setClock,
  startEncounter,
  askQuestion,
  requestExam,
  placeOrder,
  administerTreatment,
  commitDiagnosis,
  logGuardOutcome,
  resetEncounter,
  useEncounterState,
  getDiscoveredHistory,
  getDiscoveredExam,
  getDiscoveredLabs,
  getProblemList,
  getEncounterClockMs,
  getCurrentVitals,
  getTreatments,
  getGuardEventCount,
  getOffTaskCount,
  type EncounterState,
} from "@/state/encounterStore";
import { generateCase } from "@/domain/caseGen";
import type { CaseInstance } from "@/domain/case";

/**
 * Issue #32 — encounter store (progressive disclosure + event log) unit tests.
 *
 * The store is a React external store, so we mount a tiny probe component in
 * jsdom to read live snapshots, then drive it through the exported actions. The
 * assertions target the product-critical invariant: the EHR exposes ONLY what
 * the learner has obtained (history by asking, exam by maneuver, results by
 * ordering), and every action appends an event to the sourced log. The clock is
 * injected and lab turnaround uses fake `setTimeout` so nothing waits on wall time.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function makeCase(seed: number): CaseInstance {
  return generateCase({ seedMode: "constrained", chiefComplaint: "chest-pain", locale: "en", seed });
}

let root: Root | null = null;
let snapshot: EncounterState;
let restoreClock: () => void;
let now = 0;

function Probe() {
  snapshot = useEncounterState();
  return null;
}

/** Run a store mutation and flush the resulting React re-render. */
function run(fn: () => void): void {
  act(() => {
    fn();
  });
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
  act(() => {
    root?.unmount();
  });
  root = null;
  resetEncounter();
  restoreClock();
  vi.useRealTimers();
});

describe("encounterStore — guards before an encounter starts", () => {
  it("actions are inert with no case loaded", () => {
    expect(snapshot.caseInstance).toBeNull();
    run(() => askQuestion("onset"));
    run(() => requestExam("cardiovascular"));
    expect(snapshot.events).toEqual([]);
    expect(snapshot.discovered.size).toBe(0);
  });
});

describe("encounterStore — startEncounter", () => {
  it("loads the case, anchors the clock and logs a stage event", () => {
    const c = makeCase(101);
    run(() => startEncounter(c));
    expect(snapshot.caseInstance?.id).toBe(c.id);
    expect(snapshot.stage).toBe("interview");
    expect(snapshot.startTs).toBe(0);
    expect(snapshot.events).toHaveLength(1);
    expect(snapshot.events[0]).toMatchObject({ type: "stage", ref: "interview" });
    // Nothing is disclosed at the start.
    expect(getDiscoveredHistory(snapshot)).toEqual([]);
  });

  it("reads the injected encounter clock live", () => {
    const c = makeCase(102);
    run(() => startEncounter(c));
    now = 5000;
    expect(getEncounterClockMs(snapshot)).toBe(5000);
  });
});

describe("encounterStore — progressive disclosure by asking", () => {
  it("reveals history for an asked intent and flags a repeat as redundant", () => {
    const c = makeCase(103);
    const intent = c.groundTruth.history[0].intent;
    run(() => startEncounter(c));

    run(() => askQuestion(intent));
    const revealed = getDiscoveredHistory(snapshot);
    expect(revealed.length).toBeGreaterThan(0);
    expect(revealed.every((h) => h.intent === intent)).toBe(true);
    const firstQ = snapshot.events.find((e) => e.type === "question" && e.ref === intent);
    expect(firstQ?.meta?.hit).toBe(true);

    run(() => askQuestion(intent));
    const qEvents = snapshot.events.filter((e) => e.type === "question" && e.ref === intent);
    expect(qEvents).toHaveLength(2);
    expect(qEvents[1].meta?.redundant).toBe(true);
  });

  it("logs an off-target question as a miss and reveals nothing", () => {
    const c = makeCase(104);
    run(() => startEncounter(c));
    const before = getDiscoveredHistory(snapshot).length;
    // 'allergies' is absent from the chest-pain history ground truth.
    run(() => askQuestion("allergies"));
    const miss = snapshot.events.find((e) => e.type === "question" && e.ref === "allergies");
    expect(miss?.meta?.hit).toBe(false);
    expect(getDiscoveredHistory(snapshot).length).toBe(before);
  });
});

describe("encounterStore — exam by maneuver", () => {
  it("reveals findings and advances the stage from interview to exam", () => {
    const c = makeCase(105);
    const maneuver = c.groundTruth.exam[0].maneuver;
    run(() => startEncounter(c));
    expect(snapshot.stage).toBe("interview");
    run(() => requestExam(maneuver));
    expect(getDiscoveredExam(snapshot).length).toBeGreaterThan(0);
    expect(snapshot.stage).toBe("exam");
  });
});

describe("encounterStore — orders reveal results after turnaround", () => {
  it("discloses a lab only once the simulated turnaround elapses", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const c = makeCase(106);
    const orderCode = c.groundTruth.labs[0].orderCode;
    run(() => startEncounter(c));
    run(() => placeOrder(orderCode));

    // Order is pending: logged, not yet resolved, result not disclosed.
    expect(getDiscoveredLabs(snapshot)).toEqual([]);
    expect(snapshot.orders.some((o) => o.code === orderCode && !o.resolved)).toBe(true);
    expect(snapshot.events.some((e) => e.type === "order" && e.ref === orderCode)).toBe(true);

    // Turnaround is now per-test (orderCatalog): advance to this order's own ETA.
    const readyAt = snapshot.orders.find((o) => o.code === orderCode)!.resultsReadyAt;
    run(() => {
      now = readyAt;
      vi.advanceTimersByTime(readyAt);
    });

    expect(getDiscoveredLabs(snapshot).length).toBeGreaterThan(0);
    expect(snapshot.orders.find((o) => o.code === orderCode)?.resolved).toBe(true);
    expect(snapshot.results.some((r) => r.code === orderCode)).toBe(true);
    expect(snapshot.events.some((e) => e.type === "result" && e.ref === orderCode)).toBe(true);
  });
});

describe("encounterStore — per-test turnaround (sense of time)", () => {
  it("schedules a culture much later than a CBC", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const c = makeCase(120);
    run(() => startEncounter(c));
    // Both placed at t=0, so resultsReadyAt reflects the per-test playback only.
    run(() => placeOrder("blood-culture", { en: "Blood culture", tr: "Kan kültürü" }));
    run(() => placeOrder("cbc", { en: "CBC", tr: "Hemogram" }));

    const culture = snapshot.orders.find((o) => o.code === "blood-culture")!;
    const cbc = snapshot.orders.find((o) => o.code === "cbc")!;
    expect(culture.category).toBe("micro-culture");
    expect(cbc.category).toBe("lab");
    expect(culture.resultsReadyAt).toBeGreaterThan(cbc.resultsReadyAt);
    // A realistic clinical ETA is captured for the UI (not the compressed time).
    expect(culture.clinicalLabelEn).toMatch(/h$/);
  });
});

describe("encounterStore — administerTreatment", () => {
  it("logs a treatment event and shifts the live vitals", () => {
    const c = makeCase(121);
    run(() => startEncounter(c));
    const base = getCurrentVitals(snapshot)!;

    // Nitroglycerin (RxNorm 4917): generic effect lowers systolic over ~90s.
    // Seed 121 is an NSTEMI with SBP 135 / HR 91, so the nitrate gate
    // (review 02 finding 8) allows it and scores the choice as indicated.
    run(() => administerTreatment("4917", { en: "Nitroglycerin", tr: "Nitrogliserin" }));

    const ev = snapshot.events.find((e) => e.type === "treatment" && e.ref === "4917");
    expect(ev).toBeDefined();
    expect(ev?.meta?.appropriateness).toBe("indicated"); // gate-derived (ischaemic pain, SBP >= 90)
    expect(getTreatments(snapshot).some((t) => t.code === "4917")).toBe(true);
    // The administration is recorded on the MAR with its five-rights checks.
    const mar = snapshot.events.find((e) => e.type === "mar" && e.ref === "4917");
    expect(mar?.meta?.outcome).toBe("given");

    // Past the effect onset, the systolic pressure has fallen from baseline.
    now = 120_000;
    const after = getCurrentVitals(snapshot)!;
    expect(after.systolic).toBeLessThan(base.systolic);
  });
});

describe("encounterStore — commitDiagnosis", () => {
  it("marks the correct diagnosis and adds a working problem-list entry", () => {
    const c = makeCase(107);
    const correct = c.correctDiagnosis.code.coding[0]?.code ?? "";
    run(() => startEncounter(c));
    run(() => commitDiagnosis(correct, "Working dx"));
    const dx = snapshot.events.find((e) => e.type === "diagnosis");
    expect(dx?.meta?.correct).toBe(true);
    expect(snapshot.committedDiagnosis).toBe(correct);
    expect(snapshot.stage).toBe("assessment");
    expect(getProblemList(snapshot).some((p) => p.role === "working")).toBe(true);
  });

  it("marks an incorrect diagnosis as such", () => {
    const c = makeCase(108);
    run(() => startEncounter(c));
    run(() => commitDiagnosis("NOT-THE-CODE", "Wrong dx"));
    expect(snapshot.events.find((e) => e.type === "diagnosis")?.meta?.correct).toBe(false);
  });
});

describe("encounterStore — guard outcomes (separate log, off-task signal)", () => {
  it("records guard events and counts off-task moves without injection/unsafe", () => {
    const c = makeCase(109);
    run(() => startEncounter(c));
    run(() => logGuardOutcome({ type: "offtopic", utterance: "nice weather", score: 0.8, rationale: "social" }));
    run(() => logGuardOutcome({ type: "answer-seeking", utterance: "tell me", score: 0.85, rationale: "meta" }));
    run(() => logGuardOutcome({ type: "injection", utterance: "ignore rules", score: 0.97, rationale: "inj" }));

    expect(getGuardEventCount(snapshot)).toBe(3);
    expect(getGuardEventCount(snapshot, "injection")).toBe(1);
    // Off-task = off-topic + answer-seeking only; injection/unsafe are security/safety.
    expect(getOffTaskCount(snapshot)).toBe(2);
    // Guard outcomes never pollute the clinical event log.
    expect(snapshot.events.some((e) => (e.type as string) === "injection")).toBe(false);
  });
});

describe("encounterStore — resetEncounter", () => {
  it("clears the case, disclosure set and event log", () => {
    const c = makeCase(110);
    run(() => startEncounter(c));
    run(() => askQuestion(c.groundTruth.history[0].intent));
    expect(snapshot.events.length).toBeGreaterThan(0);

    run(() => resetEncounter());
    expect(snapshot.caseInstance).toBeNull();
    expect(snapshot.events).toEqual([]);
    expect(snapshot.discovered.size).toBe(0);
    expect(snapshot.stage).toBe("chart-review");
  });
});
