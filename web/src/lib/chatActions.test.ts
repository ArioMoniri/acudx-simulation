import { describe, expect, it } from "vitest";
import {
  MAX_ACTIONS,
  matchTargets,
  parseChatAction,
  parseChatActions,
  parseChatGuard,
  parseSlash,
  questionKey,
  resolveOrderCode,
  searchOrderables,
  tabForTarget,
} from "./chatActions";
import en from "@/i18n/features/chat.en.json";
import tr from "@/i18n/features/chat.tr.json";

describe("parseChatAction", () => {
  it("accepts the three contract kinds", () => {
    expect(parseChatAction({ kind: "order", code: "10839-9", system: "LOINC", label: "Troponin I" })).toEqual({
      kind: "order",
      code: "10839-9",
      system: "LOINC",
      label: "Troponin I",
    });
    expect(parseChatAction({ kind: "navigate", target: "imaging", ref: "cxr" })).toEqual({
      kind: "navigate",
      target: "imaging",
      ref: "cxr",
    });
    expect(parseChatAction({ kind: "navigate", target: "vitals" })).toEqual({ kind: "navigate", target: "vitals" });
    expect(parseChatAction({ kind: "ask", text: "  Any chest pain at rest? " })).toEqual({
      kind: "ask",
      text: "Any chest pain at rest?",
    });
  });

  it("drops anything outside the contract", () => {
    expect(parseChatAction(null)).toBeNull();
    expect(parseChatAction("order")).toBeNull();
    expect(parseChatAction({ kind: "prescribe", code: "x" })).toBeNull();
    expect(parseChatAction({ kind: "order", code: "", label: "x" })).toBeNull();
    expect(parseChatAction({ kind: "order", code: "x" })).toBeNull();
    expect(parseChatAction({ kind: "navigate", target: "billing" })).toBeNull();
    expect(parseChatAction({ kind: "ask", text: 3 })).toBeNull();
  });

  it("defaults an unknown code system to local", () => {
    expect(parseChatAction({ kind: "order", code: "cbc", system: "SNOMED", label: "CBC" })).toMatchObject({
      system: "local",
    });
  });
});

describe("parseChatActions", () => {
  it("returns [] for a missing or malformed array", () => {
    expect(parseChatActions(undefined)).toEqual([]);
    expect(parseChatActions({ kind: "ask", text: "x" })).toEqual([]);
  });

  it("de-duplicates and caps the list", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ kind: "ask", text: `Question ${i}` }));
    const out = parseChatActions([{ kind: "ask", text: "Question 0" }, ...many, { kind: "bogus" }]);
    expect(out).toHaveLength(MAX_ACTIONS);
    expect(out.filter((a) => a.kind === "ask" && a.text === "Question 0")).toHaveLength(1);
  });
});

describe("parseChatGuard", () => {
  it("reads the new { label, note? } shape", () => {
    expect(parseChatGuard({ label: "Off topic", note: "Back to the complaint." })).toEqual({
      label: "Off topic",
      note: "Back to the complaint.",
    });
    expect(parseChatGuard({ label: "Off topic" })).toEqual({ label: "Off topic" });
  });

  it("yields null for the older verdict shape and for junk", () => {
    expect(parseChatGuard({ cls: "in-scope", score: 0.4, rationale: "x" })).toBeNull();
    expect(parseChatGuard(null)).toBeNull();
    expect(parseChatGuard("Off topic")).toBeNull();
  });
});

describe("navigation", () => {
  it("maps every target onto a chart tab", () => {
    expect(tabForTarget("results")).toBe("results");
    expect(tabForTarget("imaging")).toBe("results");
    expect(tabForTarget("orders")).toBe("orders");
    expect(tabForTarget("vitals")).toBe("flowsheets");
    expect(tabForTarget("notes")).toBe("chart-review");
    expect(tabForTarget("diagnosis")).toBe("problem-list");
    expect(tabForTarget("guide")).toBe("guidance");
  });

  it("matches targets by key or localized label", () => {
    expect(matchTargets("res", (t) => t)).toEqual(["results"]);
    expect(matchTargets("sonu", (t) => (t === "results" ? "Sonuçlar" : t))).toEqual(["results"]);
    expect(matchTargets("", (t) => t)).toHaveLength(7);
  });
});

describe("orders", () => {
  it("keeps a code the case authored, else maps to the catalogue", () => {
    expect(resolveOrderCode({ code: "abc-1", label: "Odd test" }, ["abc-1"])).toBe("abc-1");
    expect(resolveOrderCode({ code: "36643-5", label: "Chest X-ray" })).toBe("cxr");
    expect(resolveOrderCode({ code: "rad-123", label: "Chest radiograph PA" })).toBe("cxr");
  });

  it("searches the catalogue for /order", () => {
    const hits = searchOrderables("trop");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].label.en.toLowerCase()).toContain("trop");
    expect(searchOrderables("zzzz-not-a-test")).toEqual([]);
  });
});

describe("parseSlash", () => {
  it("is null for plain text", () => {
    expect(parseSlash("When did it start?")).toBeNull();
  });

  it("lists candidates while the command is typed", () => {
    expect(parseSlash("/")).toMatchObject({ command: null, hasArg: false, candidates: ["order", "exam", "go", "ask"] });
    expect(parseSlash("/ex")).toMatchObject({ command: null, candidates: ["exam"] });
    expect(parseSlash("/order")).toMatchObject({ command: "order", hasArg: false });
  });

  it("reads the argument after the command", () => {
    expect(parseSlash("/order troponin")).toMatchObject({ command: "order", hasArg: true, arg: "troponin" });
    expect(parseSlash("/GO results")).toMatchObject({ command: "go", arg: "results" });
  });
});

describe("catalogue questions", () => {
  it("has a natural EN and TR question for every intent", () => {
    const intents = [
      "onset", "location", "character", "radiation", "severity", "timing", "aggravating", "relieving",
      "associated-symptoms", "red-flags", "past-medical-history", "medications", "allergies",
      "family-history", "social-history", "risk-factors", "ice",
    ] as const;
    for (const i of intents) {
      const leaf = questionKey(i).split(".").pop()!;
      expect((en.chat.questions as Record<string, string>)[leaf]).toBeTruthy();
      expect((tr.chat.questions as Record<string, string>)[leaf]).toBeTruthy();
    }
  });

  it("ships no em dash in the chat strings", () => {
    expect(JSON.stringify(en)).not.toContain("—");
    expect(JSON.stringify(tr)).not.toContain("—");
  });
});
