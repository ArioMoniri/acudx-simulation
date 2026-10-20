// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { installEventSync, toEncounterBatch } from "./eventSync";
import type { PanelsApi } from "./panelsApi";
import { recordEncounter, resetProgress, type EncounterRecord } from "@/state/progressStore";
import type { EncounterEvent } from "@/state/encounterStore";

function record(id: string): EncounterRecord {
  return {
    id,
    sourceKey: 1_700_000_000_000,
    caseId: "case-chest-pain",
    title: { en: "Chest pain", tr: "Gogus agrisi" },
    at: 1_700_000_600_000,
    domainScores: [
      { key: "history", axis: "clinical", band: "strong", confidence: 0.8, competence: 0.74, scored: true },
      { key: "professionalism", axis: "communication", band: "withheld", confidence: 0, competence: 0, scored: false },
    ],
    calibration: [{ domain: "history", confidence: 0.8, competence: 0.74, direction: "well" }],
    overallGap: 0.06,
    brier: 0.0036,
    metrics: { historyCoveragePct: 0.6, questionCount: 5, diagnosisCorrect: true } as EncounterRecord["metrics"],
    expectedIntentCount: 8,
    diagnosisCorrect: true,
    safetyMiss: false,
  };
}

const events: EncounterEvent[] = [
  { seq: 0, type: "question", ref: "onset", at: 1000 },
  { seq: 1, type: "diagnosis", ref: "I21.0", at: 9000, meta: { correct: true } },
];

describe("eventSync", () => {
  it("shapes a record + log into the server batch", () => {
    const b = toEncounterBatch(record("enc-1"), events);
    expect(b.encounter_id).toBe("enc-1");
    expect(b.case_id).toBe("case-chest-pain");
    expect(b.started_at).toBe(1_700_000_000_000);
    expect(b.events).toEqual([
      { seq: 0, type: "question", ref: "onset", at: 1000, meta: null },
      { seq: 1, type: "diagnosis", ref: "I21.0", at: 9000, meta: { correct: true } },
    ]);
    expect(b.summary.domain_scores[0]).toEqual({ key: "history", axis: "clinical", band: "strong", competence: 0.74, confidence: 0.8, scored: true });
    expect(b.summary.diagnosis_correct).toBe(true);
    expect(b.summary.safety_miss).toBe(false);
    expect(b.summary.title).toEqual({ en: "Chest pain", tr: "Gogus agrisi" });
  });

  it("posts every newly recorded encounter and keeps failures for retry", async () => {
    resetProgress();
    const post = vi.fn(async (batch: { encounter_id: string }) =>
      batch.encounter_id === "enc-bad"
        ? ({ ok: false as const, error: "network" as const })
        : ({ ok: true as const, authMode: "local" as const, data: { stored: true, id: 1, org: "local", chain_hash: "h", prev_hash: "0", body_sha256: "b", verified_identity: false } }),
    );
    const api = { postEncounter: post } as unknown as PanelsApi;
    const off = installEventSync(api);
    recordEncounter(record("enc-ok"), events);
    recordEncounter(record("enc-ok"), events); // same encounter again: no second post
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0].encounter_id).toBe("enc-ok");
    const bad = record("enc-bad");
    bad.sourceKey = 2;
    recordEncounter(bad, events);
    await new Promise((r) => setTimeout(r, 0));
    // the failed batch is retried when the next record arrives
    const next = record("enc-next");
    next.sourceKey = 3;
    recordEncounter(next, events);
    await new Promise((r) => setTimeout(r, 0));
    const ids = post.mock.calls.map((c) => c[0].encounter_id);
    expect(ids.filter((i) => i === "enc-bad").length).toBeGreaterThanOrEqual(2);
    expect(ids).toContain("enc-next");
    off();
  });
});
