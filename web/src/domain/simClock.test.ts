import { describe, expect, it } from "vitest";
import parity from "../../../server/tests/fixtures/sim_clock_parity.json";
import {
  CLASS_OF,
  SCALE_BOUNDS,
  SIM_CLOCK_DEFAULTS,
  WAIT_CAP_BOUNDS_S,
  normalizeSimClock,
  realWaitsS,
} from "@/domain/simClock";
import type { OrderCategory } from "@/domain/orderCatalog";

/**
 * Parity with server/learning/sim_clock.py through the shared fixture
 * server/tests/fixtures/sim_clock_parity.json (server/tests/test_sim_clock.py
 * reads the same file).
 */
describe("simClock parity with the server", () => {
  it("has the same defaults, bounds and wait classes", () => {
    expect(SIM_CLOCK_DEFAULTS).toEqual(parity.defaults);
    expect([...SCALE_BOUNDS]).toEqual(parity.bounds.scale);
    expect([...WAIT_CAP_BOUNDS_S]).toEqual(parity.bounds.wait_cap_s);
    expect(CLASS_OF).toEqual(parity.class_of);
  });

  for (const row of parity.waits) {
    it(`real wait: ${row.name}`, () => {
      const w = realWaitsS(SIM_CLOCK_DEFAULTS, row.category as OrderCategory, row.turnaround_min, row.preliminary_min);
      expect(w).toEqual({ first: row.first_report_s, final: row.final_s });
      expect(w.first).toBeLessThanOrEqual(120);
    });
  }
});

describe("normalizeSimClock", () => {
  it("clamps to the bounds and falls back to the defaults for missing or malformed values", () => {
    expect(normalizeSimClock(null)).toEqual(SIM_CLOCK_DEFAULTS);
    expect(normalizeSimClock({ scale: 500 }).scale).toBe(60);
    expect(normalizeSimClock({ scale: 0 }).scale).toBe(1);
    expect(normalizeSimClock({ scale: "fast" }).scale).toBe(SIM_CLOCK_DEFAULTS.scale);
    expect(normalizeSimClock({ wait_cap_s: { lab: 1, culture: 9999 } }).wait_cap_s).toEqual({
      ...SIM_CLOCK_DEFAULTS.wait_cap_s,
      lab: 5,
      culture: 600,
    });
  });
});
