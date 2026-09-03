import { describe, it, expect } from "vitest";
import {
  computeProcessMetrics,
  safetyCriticalMisses,
  onTimeRate,
} from "@/domain/processMetrics";
import { generateCase } from "@/domain/caseGen";
import { expectedIntents, type CaseInstance } from "@/domain/case";
import type { EncounterEvent, EncounterEventType } from "@/state/encounterStore";

/**
 * Issue #32 — process-metrics unit tests.
 *
 * Derives the §4 process metrics from a hand-built event log against a real
 * generated case, exercising timing (on-time / late / missed vs the guideline
 * window), history coverage / redundancy / off-target, order appropriateness,
 * diagnosis correctness, and the safety-critical-miss surfacing.
 */

const c: CaseInstance = generateCase({
  seedMode: "constrained",
  chiefComplaint: "chest-pain",
  locale: "en",
  seed: 20240001,
});

const codeOf = (i: number): string => c.expectedWorkup[i].code.coding[0]?.code ?? "";

/** Tiny event-log builder that assigns monotonic seq numbers. */
class Log {
  private seq = 0;
  readonly events: EncounterEvent[] = [];
  add(type: EncounterEventType, ref: string, at: number, meta?: Record<string, unknown>): this {
    this.events.push({ seq: this.seq++, type, ref, at, ...(meta ? { meta } : {}) });
    return this;
  }
}

describe("computeProcessMetrics — strong performance", () => {
  const log = new Log().add("stage", "interview", 0, { started: true });
  const expected = expectedIntents(c);
  expected.forEach((intent, i) => log.add("question", intent, 1000 + i * 1000, { hit: true }));
  // A duplicate of the first intent (redundant) and an off-target miss.
  log.add("question", expected[0], 30_000, { hit: true, redundant: true });
  log.add("question", "social-history", 31_000, { hit: false });
  // Every expected workup ordered well inside its window.
  c.expectedWorkup.forEach((w, i) =>
    log.add("order", codeOf(i), Math.floor(w.idealWindowMs / 2), { indicated: true }),
  );
  const correctCode = c.correctDiagnosis.code.coding[0]?.code ?? "";
  // Committed after every order, so it is also the latest event offset.
  const DX_AT = 2_000_000;
  log.add("diagnosis", correctCode, DX_AT, { correct: true });

  const m = computeProcessMetrics(log.events, c);

  it("times the first question and counts questions", () => {
    expect(m.timeToFirstQuestionMs).toBe(1000);
    expect(m.questionCount).toBe(expected.length + 2);
  });

  it("reports full history coverage with one redundant and one off-target", () => {
    expect(m.historyCoveragePct).toBe(1);
    expect(m.redundantQuestions).toBe(1);
    expect(m.irrelevantQuestions).toBe(1);
  });

  it("scores every critical action on-time", () => {
    expect(m.timeToCriticalAction.length).toBe(c.expectedWorkup.length);
    expect(m.timeToCriticalAction.every((a) => a.status === "onTime")).toBe(true);
    expect(onTimeRate(m)).toBe(1);
    expect(safetyCriticalMisses(m)).toHaveLength(0);
  });

  it("captures the correct diagnosis and its timing", () => {
    expect(m.diagnosisCorrect).toBe(true);
    expect(m.timeToDiagnosisMs).toBe(DX_AT);
    expect(m.totalTimeMs).toBe(DX_AT); // latest event offset
  });

  it("each critical result carries a citation id", () => {
    for (const a of m.timeToCriticalAction) {
      expect(a.citationId).toBeTruthy();
    }
  });
});

describe("computeProcessMetrics — missed everything", () => {
  const log = new Log()
    .add("stage", "interview", 0, { started: true })
    .add("diagnosis", "WRONG-CODE", 5000, { correct: false });
  const m = computeProcessMetrics(log.events, c);

  it("marks all expected actions missed", () => {
    expect(m.timeToCriticalAction.every((a) => a.status === "missed")).toBe(true);
    expect(m.timeToCriticalAction.every((a) => a.takenAtMs === null)).toBe(true);
    expect(onTimeRate(m)).toBe(0);
  });

  it("surfaces the critical misses separately", () => {
    const criticalCount = c.expectedWorkup.filter((w) => w.critical).length;
    expect(safetyCriticalMisses(m)).toHaveLength(criticalCount);
    expect(criticalCount).toBeGreaterThan(0);
  });

  it("no questions => null first-question and zero coverage", () => {
    expect(m.timeToFirstQuestionMs).toBeNull();
    expect(m.questionCount).toBe(0);
    expect(m.historyCoveragePct).toBe(0);
  });

  it("records the (incorrect) committed diagnosis timing", () => {
    expect(m.diagnosisCorrect).toBe(false);
    expect(m.timeToDiagnosisMs).toBe(5000);
  });
});

describe("computeProcessMetrics — timing boundary + order appropriateness", () => {
  it("classifies an order exactly at the window as on-time and one past it as late", () => {
    const w0 = c.expectedWorkup[0];
    const onTimeLog = new Log().add("order", codeOf(0), w0.idealWindowMs, {}); // boundary
    const lateLog = new Log().add("order", codeOf(0), w0.idealWindowMs + 1, {});
    const onTime = computeProcessMetrics(onTimeLog.events, c).timeToCriticalAction.find(
      (a) => a.expectationId === w0.id,
    );
    const late = computeProcessMetrics(lateLog.events, c).timeToCriticalAction.find(
      (a) => a.expectationId === w0.id,
    );
    expect(onTime?.status).toBe("onTime");
    expect(late?.status).toBe("late");
  });

  it("splits placed orders into indicated / low-value / unmapped", () => {
    const log = new Log()
      .add("order", "IND", 1000, { indicated: true })
      .add("order", "LOWVAL", 2000, { lowValue: true })
      .add("order", "LOWVAL", 2500, { lowValue: true }) // duplicate low-value code
      .add("order", "UNMAPPED", 3000, {});
    const m = computeProcessMetrics(log.events, c);
    expect(m.orderAppropriateness.indicated).toBe(1);
    expect(m.orderAppropriateness.lowValue).toBe(2);
    expect(m.orderAppropriateness.unmapped).toBe(1);
    expect(m.orderAppropriateness.lowValueCodes).toEqual(["LOWVAL"]);
  });
});

describe("computeProcessMetrics — communication flags", () => {
  it("derives ICE, red-flag screening and allergy checks from event meta", () => {
    const log = new Log()
      .add("question", "ice", 1000, { hit: true })
      .add("question", "risk-factors", 2000, { hit: true })
      .add("question", "allergies", 3000, { hit: false });
    const m = computeProcessMetrics(log.events, c);
    expect(m.communicationFlags.exploredIce).toBe(true);
    expect(m.communicationFlags.screenedRedFlags).toBe(true);
    expect(m.communicationFlags.checkedAllergies).toBe(true);
  });

  it("an empty log yields the zero-metrics baseline", () => {
    const m = computeProcessMetrics([], c);
    expect(m.totalTimeMs).toBe(0);
    expect(m.timeToFirstQuestionMs).toBeNull();
    expect(m.diagnosisCorrect).toBe(false);
    expect(m.timeToDiagnosisMs).toBeNull();
  });
});
