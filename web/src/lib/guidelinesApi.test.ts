import { describe, expect, it } from "vitest";

import {
  citationLabel,
  groupTipsByStage,
  mapTips,
  resolveCitationId,
  statementText,
  toCitationView,
  toGuidanceHint,
  visibleTipStages,
  type GuidelineStatementPayload,
  type TipsResponse,
} from "@/lib/guidelinesApi";

function payload(over: Partial<GuidelineStatementPayload> = {}): GuidelineStatementPayload {
  return {
    id: "gs_nice_ng185_aspirin300",
    statement: "Offer people with acute STEMI a single loading dose of 300 mg aspirin.",
    statement_en: "Offer people with acute STEMI a single loading dose of 300 mg aspirin.",
    statement_tr: "Akut STEMI'li hastalara tek bir 300 mg aspirin yükleme dozu verin.",
    source_body: "NICE",
    source_title: "Acute coronary syndromes (NG185)",
    source_url: "https://www.nice.org.uk/guidance/ng185/chapter/Recommendations",
    doi: "",
    edition_or_version: "NG185, November 2020",
    published_date: "2020-11-18",
    verified_at: "2026-10-19T22:50:00+00:00",
    verification_method: "lexical",
    verification_quote: "1.1.4 Offer people with acute STEMI a single loading dose of 300 mg aspirin ...",
    license_tag: "open",
    scope: { countries: ["UK"] },
    condition_codes: ["I21.3"],
    topic: "gs_nice_ng185_aspirin300",
    status: "verified",
    ...over,
  };
}

describe("citationLabel", () => {
  it("uses the guideline code in the title when present", () => {
    expect(citationLabel(payload())).toBe("NICE NG185");
    expect(citationLabel(payload({ source_title: "Headaches in over 12s (CG150)" }))).toBe("NICE CG150");
  });
  it("falls back to body + year, then body, then id", () => {
    expect(citationLabel(payload({ source_body: "SSC (SCCM/ESICM)", source_title: "Surviving Sepsis Campaign 2021", published_date: "2021-10-04" }))).toBe("SSC (SCCM/ESICM) 2021");
    expect(citationLabel(payload({ source_body: "WHO", source_title: "Fact sheet", published_date: "" }))).toBe("WHO");
    expect(citationLabel(payload({ source_body: "", source_title: "x", published_date: "" }))).toBe("gs_nice_ng185_aspirin300");
  });
});

describe("toCitationView", () => {
  it("carries body, title, edition, link and verification date", () => {
    const v = toCitationView(payload());
    expect(v).toMatchObject({
      id: "gs_nice_ng185_aspirin300",
      label: "NICE NG185",
      body: "NICE",
      title: "Acute coronary syndromes (NG185)",
      edition: "NG185, November 2020",
      url: "https://www.nice.org.uk/guidance/ng185/chapter/Recommendations",
      verifiedAt: "2026-10-19T22:50:00+00:00",
    });
    expect(v.quote).toContain("300 mg aspirin");
  });
  it("resolves a DOI link when the source URL is empty", () => {
    const v = toCitationView(payload({ source_url: "", doi: "10.1016/j.waojou.2020.100472" }));
    expect(v.url).toBe("https://doi.org/10.1016/j.waojou.2020.100472");
    expect(v.doi).toBe("10.1016/j.waojou.2020.100472");
  });
});

describe("statementText / toGuidanceHint", () => {
  it("picks Turkish when present and falls back to English", () => {
    expect(statementText(payload(), "tr")).toContain("aspirin yükleme");
    expect(statementText(payload({ statement_tr: "" }), "tr")).toContain("300 mg aspirin.");
    const hint = toGuidanceHint(payload({ statement_tr: "" }));
    expect(hint.text.tr).toBe(hint.text.en);
    expect(hint.statementId).toBe("gs_nice_ng185_aspirin300");
    expect(hint.citation.label).toBe("NICE NG185");
  });
});

describe("mapTips", () => {
  const res: TipsResponse = {
    tips: [
      {
        id: "tip_acs_aspirin", condition_codes: ["I21.3"], stage: "treatment",
        tip_en: "Give aspirin 300 mg.", tip_tr: "300 mg aspirin verin.",
        pitfall_en: "Withholding for a vague intolerance.", pitfall_tr: "Belirsiz intolerans.",
        timing_hint: "As soon as possible", statement_ids: ["gs_nice_ng185_aspirin300"],
      },
      {
        id: "tip_missing_evidence", condition_codes: ["I21.3"], stage: "triage",
        tip_en: "Should not render.", tip_tr: "", pitfall_en: "", pitfall_tr: "", timing_hint: "",
        statement_ids: ["gs_not_in_response"],
      },
      {
        id: "tip_unverified_evidence", condition_codes: ["I21.3"], stage: "triage",
        tip_en: "Should not render either.", tip_tr: "", pitfall_en: "", pitfall_tr: "", timing_hint: "",
        statement_ids: ["gs_failed"],
      },
    ],
    statements: {
      gs_nice_ng185_aspirin300: payload(),
      gs_failed: payload({ id: "gs_failed", status: "failed" }),
    },
    count: 3, condition: "I21.3", stage: null, locale: "en",
    stages: ["triage", "history", "exam", "workup", "treatment", "disposition"],
  };

  it("keeps only tips whose every statement is present and verified", () => {
    const tips = mapTips(res, "en");
    expect(tips.map((t) => t.id)).toEqual(["tip_acs_aspirin"]);
    expect(tips[0]).toMatchObject({
      stage: "treatment", tip: "Give aspirin 300 mg.", pitfall: "Withholding for a vague intolerance.",
      timingHint: "As soon as possible",
    });
    expect(tips[0].citations[0].label).toBe("NICE NG185");
  });
  it("localises tip and pitfall", () => {
    const [tip] = mapTips(res, "tr");
    expect(tip.tip).toBe("300 mg aspirin verin.");
    expect(tip.pitfall).toBe("Belirsiz intolerans.");
  });
  it("groups by stage with every stage present", () => {
    const groups = groupTipsByStage(mapTips(res, "en"));
    expect(Object.keys(groups)).toEqual(["triage", "history", "exam", "workup", "treatment", "disposition"]);
    expect(groups.treatment).toHaveLength(1);
    expect(groups.triage).toHaveLength(0);
  });
});

describe("visibleTipStages", () => {
  it("locks treatment and disposition until assessment", () => {
    expect(visibleTipStages("interview")).toEqual(["triage", "history"]);
    expect(visibleTipStages("results")).toEqual(["triage", "history", "exam", "workup"]);
    expect(visibleTipStages("assessment")).toContain("treatment");
    expect(visibleTipStages("closed")).toContain("disposition");
  });
});

describe("resolveCitationId", () => {
  it("maps legacy ids to verified statements and unverifiable ones to null", () => {
    expect(resolveCitationId("esc-acs-2023")).toBe("gs_nice_ng185_nstemi_assessment");
    expect(resolveCitationId("nice-ng228")).toBe("gs_nice_sah_ct6h");
    expect(resolveCitationId("tepdad-em")).toBeNull();
    expect(resolveCitationId("titck-formulary")).toBeNull();
    expect(resolveCitationId("gs_wao2020_anaph_epinephrine_im")).toBe("gs_wao2020_anaph_epinephrine_im");
    expect(resolveCitationId("")).toBeNull();
  });
});
