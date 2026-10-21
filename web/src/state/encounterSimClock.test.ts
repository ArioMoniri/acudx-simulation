// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  __setClock,
  advanceSimTime,
  getEncounterClockMs,
  nextResultInMs,
  placeOrder,
  resetEncounter,
  setSimClockSettings,
  startEncounter,
  useEncounterState,
  type EncounterState,
} from "@/state/encounterStore";
import { SIM_CLOCK_DEFAULTS } from "@/domain/simClock";
import { generateCase } from "@/domain/caseGen";
import type { CaseInstance } from "@/domain/case";

/**
 * Live report 2026-10-21: "results should be faster, not that much wait time, in a couple
 * of minutes". Results keep their clinical turnaround on the sim clock (times shown stay
 * sim time); the compressed clock and the real wait caps (domain/simClock.ts) bring every
 * routine report within about two real minutes. The clock is injected and the timers are
 * fake, so nothing waits on wall time.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

function run(fn: () => void): void {
  act(() => {
    fn();
  });
}

/** Let `ms` of wall time pass (store clock and timers together). */
function wait(ms: number): void {
  run(() => {
    now += ms;
    vi.advanceTimersByTime(ms);
  });
}

const BMP = { en: "Basic metabolic panel (BMP)", tr: "Temel metabolik panel" };
const CULTURE = { en: "Blood culture", tr: "Kan kültürü" };

beforeEach(() => {
  now = 0;
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
  setSimClockSettings(SIM_CLOCK_DEFAULTS);
  restoreClock();
  vi.useRealTimers();
});

describe("compressed encounter clock", () => {
  it("runs the encounter clock at the course scale (x6 by default)", () => {
    run(() => startEncounter(makeCase(501)));
    wait(10_000);
    expect(getEncounterClockMs(snapshot)).toBe(60_000);
  });

  it("lands a stat chemistry within 45 real seconds, stamped at its clinical turnaround", () => {
    run(() => startEncounter(makeCase(502)));
    wait(5_000);
    run(() => placeOrder("acudx-test-bmp", BMP));
    const order = snapshot.orders[0];
    expect(order.category).toBe("lab");
    expect(order.resultsReadyAt - order.placedAt).toBe(50 * 60_000);
    wait(44_000);
    expect(snapshot.orders[0].resolved).toBe(false);
    wait(1_000);
    expect(snapshot.orders[0].resolved).toBe(true);
    // Displayed times stay clinical: the result is out 50 sim minutes after the order.
    expect(getEncounterClockMs(snapshot)).toBe(order.resultsReadyAt);
    const jump = snapshot.events.find((e) => e.meta?.auto === true);
    expect(jump?.meta?.advancedMs).toBeGreaterThan(0);
    const result = snapshot.events.find((e) => e.type === "result");
    expect(result?.at).toBe(order.resultsReadyAt);
  });

  it("gives a culture its preliminary report at 2 real minutes and the final 2 minutes later", () => {
    run(() => startEncounter(makeCase(503)));
    run(() => placeOrder("acudx-test-culture", CULTURE));
    const order = snapshot.orders[0];
    expect(order.category).toBe("micro-culture");
    expect(order.preliminaryAt).toBe(order.placedAt + 1440 * 60_000);
    wait(120_000);
    expect(snapshot.orders[0].preliminaryReached).toBe(true);
    expect(snapshot.orders[0].resolved).toBe(false);
    expect(getEncounterClockMs(snapshot)).toBe(order.preliminaryAt);
    expect(nextResultInMs(snapshot)).toBe(order.resultsReadyAt - (order.preliminaryAt ?? 0));
    wait(120_000);
    expect(snapshot.orders[0].resolved).toBe(true);
    expect(getEncounterClockMs(snapshot)).toBe(order.resultsReadyAt);
  });

  it("keeps the Advance to next result button: an advance releases the result at once", () => {
    run(() => startEncounter(makeCase(504)));
    run(() => placeOrder("acudx-test-bmp", BMP));
    const left = nextResultInMs(snapshot);
    expect(left).toBe(50 * 60_000);
    run(() => advanceSimTime(left ?? 0));
    expect(snapshot.orders[0].resolved).toBe(true);
    expect(snapshot.events.some((e) => e.meta?.advancedMs === left && e.meta?.auto !== true)).toBe(true);
  });

  it("follows the course setting: at real time a short wait is the clinical one", () => {
    run(() => setSimClockSettings({ scale: 1, wait_cap_s: { poc: 600, lab: 600, imaging: 600, culture: 600 } }));
    run(() => startEncounter(makeCase(505)));
    run(() => placeOrder("acudx-test-glucose", { en: "Point-of-care glucose (fingerstick)", tr: "Kapiller kan şekeri" }));
    const order = snapshot.orders[0];
    expect(order.category).toBe("poc");
    wait(order.resultsReadyAt - order.placedAt - 1_000);
    expect(snapshot.orders[0].resolved).toBe(false);
    wait(1_000);
    expect(snapshot.orders[0].resolved).toBe(true);
  });
});
