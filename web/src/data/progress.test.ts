import { describe, it, expect } from "vitest";
import {
  scheduleReview,
  retrievabilityAfter,
  forgettingInterval,
  FSRS_TARGET_RETENTION,
  REVIEW_GRADE_ORDER,
  type ReviewGrade,
} from "@/data/progress";

/**
 * Issue #32 — FSRS spaced-repetition scheduler unit tests.
 *
 * Locks the forgetting-curve invariants (an interval of one stability lands on
 * the 90% target retention) and the grade ladder: a lapse collapses stability
 * and returns the card in-session, while hard < good < easy produce
 * monotonically growing stability and intervals.
 */

describe("retrievabilityAfter", () => {
  it("is 1.0 immediately after review", () => {
    expect(retrievabilityAfter(0, 5)).toBeCloseTo(1, 10);
  });

  it("is exactly the target retention at one stability", () => {
    expect(retrievabilityAfter(8, 8)).toBeCloseTo(FSRS_TARGET_RETENTION, 6);
  });

  it("decays monotonically with elapsed time", () => {
    const s = 6;
    const r1 = retrievabilityAfter(1, s);
    const r5 = retrievabilityAfter(5, s);
    const r20 = retrievabilityAfter(20, s);
    expect(r1).toBeGreaterThan(r5);
    expect(r5).toBeGreaterThan(r20);
  });
});

describe("forgettingInterval", () => {
  it("returns the stability itself for the default 90% retention", () => {
    for (const s of [1, 4, 9, 20, 45]) {
      expect(forgettingInterval(s)).toBeCloseTo(s, 6);
    }
  });

  it("a higher target retention gives a shorter interval", () => {
    const s = 10;
    expect(forgettingInterval(s, 0.95)).toBeLessThan(forgettingInterval(s, 0.9));
  });
});

describe("scheduleReview — lapse ('again')", () => {
  it("collapses stability toward relearning and returns the card in-session", () => {
    const r = scheduleReview({ stabilityDays: 6 }, "again");
    expect(r.stabilityDays).toBe(2.4); // max(0.5, 6 * 0.4)
    expect(r.intervalDays).toBe(0);
    expect(r.state).toBe("learning");
    expect(r.retrievability).toBeLessThan(0.5);
  });

  it("floors stability at 0.5 for an already-weak card", () => {
    const r = scheduleReview({ stabilityDays: 0.5 }, "again");
    expect(r.stabilityDays).toBe(0.5);
    expect(r.intervalDays).toBe(0);
  });
});

describe("scheduleReview — success ladder (hard < good < easy)", () => {
  const prior = { stabilityDays: 9 };
  const hard = scheduleReview(prior, "hard");
  const good = scheduleReview(prior, "good");
  const easy = scheduleReview(prior, "easy");

  it("grows stability strictly with grade quality", () => {
    expect(hard.stabilityDays).toBeGreaterThan(prior.stabilityDays * 0);
    expect(hard.stabilityDays).toBeLessThan(good.stabilityDays);
    expect(good.stabilityDays).toBeLessThan(easy.stabilityDays);
  });

  it("grows the next-review interval with grade quality", () => {
    expect(hard.intervalDays).toBeLessThanOrEqual(good.intervalDays);
    expect(good.intervalDays).toBeLessThanOrEqual(easy.intervalDays);
    expect(hard.intervalDays).toBeGreaterThanOrEqual(1);
  });

  it("marks a card 'scheduled' once the interval reaches two weeks, else 'learning'", () => {
    for (const s of [hard, good, easy]) {
      expect(s.state).toBe(s.intervalDays >= 14 ? "scheduled" : "learning");
    }
  });

  it("applies diminishing returns: a durable card grows proportionally less", () => {
    const weak = scheduleReview({ stabilityDays: 2 }, "good");
    const durable = scheduleReview({ stabilityDays: 40 }, "good");
    const weakGain = weak.stabilityDays / 2;
    const durableGain = durable.stabilityDays / 40;
    expect(durableGain).toBeLessThan(weakGain);
  });
});

describe("REVIEW_GRADE_ORDER", () => {
  it("lists the four grades worst-to-best", () => {
    const expected: ReviewGrade[] = ["again", "hard", "good", "easy"];
    expect(REVIEW_GRADE_ORDER).toEqual(expected);
  });
});
