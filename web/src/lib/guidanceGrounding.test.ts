// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { groundingFromResponse } from "@/lib/guidanceEngine";
import type { GroundPassage } from "@/lib/backend";

const passage: GroundPassage = {
  id: "gs_ssc21_antimicrobials_1h",
  statement: "For adults with possible septic shock, administer antimicrobials immediately, ideally within 1 hour.",
  citation: {
    body: "SSC (SCCM/ESICM)",
    title: "Surviving Sepsis Campaign 2021",
    url: "https://www.sccm.org/survivingsepsiscampaign/guidelines-and-resources/surviving-sepsis-campaign-adult-guidelines",
    edition: "2021",
  },
  score: 0.82,
};

describe("groundingFromResponse", () => {
  it("serves verified passages from a ranked (embed + rerank) answer", () => {
    const r = groundingFromResponse({ grounded: true, degraded: false, mode: "embed+rerank", passages: [passage] });
    expect(r.unavailable).toBe(false);
    expect(r.passages).toHaveLength(1);
    expect(r.passages[0].statementId).toBe(passage.id);
    expect(r.passages[0].url).toBe(passage.citation?.url);
  });

  it("refuses a hashing-fallback answer: relevance is unknown, so nothing is shown", () => {
    // Acceptance 2026-10-20: a malaria case got PPH tranexamic acid this way.
    const r = groundingFromResponse({ grounded: true, degraded: true, mode: "hashing-fallback", passages: [passage] });
    expect(r.unavailable).toBe(true);
    expect(r.passages).toEqual([]);
  });

  it("refuses an ungrounded or empty answer", () => {
    expect(groundingFromResponse({ grounded: false, passages: [passage] }).unavailable).toBe(true);
    expect(groundingFromResponse({ grounded: true, degraded: false, passages: [] }).unavailable).toBe(true);
    expect(groundingFromResponse(null).unavailable).toBe(true);
  });

  it("drops a passage without a resolving source", () => {
    const r = groundingFromResponse({ grounded: true, degraded: false, passages: [{ ...passage, citation: {} }] });
    expect(r.unavailable).toBe(true);
  });
});
