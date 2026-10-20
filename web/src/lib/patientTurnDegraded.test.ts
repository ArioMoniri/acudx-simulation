import { describe, expect, it } from "vitest";
import { isDegradedPatientTurn } from "@/lib/backend";

describe("isDegradedPatientTurn", () => {
  it("flags the gateway's scripted deflection when the model was unreachable", () => {
    // The exact 200 the acceptance run (2026-10-20) received for every typed question.
    expect(
      isDegradedPatientTurn({
        utterance: "sorry, I'm finding it hard to answer just now. Could you ask me again?",
        flags: [{ type: "gateway_degraded", error: "GatewayError" }],
      }),
    ).toBe(true);
  });

  it("flags an empty or missing reply", () => {
    expect(isDegradedPatientTurn({ utterance: "   ", flags: [] })).toBe(true);
    expect(isDegradedPatientTurn(null)).toBe(true);
  });

  it("accepts a real model reply, including one the fact gate annotated", () => {
    expect(isDegradedPatientTurn({ utterance: "It started two days ago with shivering.", flags: [] })).toBe(false);
    expect(
      isDegradedPatientTurn({ utterance: "It started two days ago.", flags: [{ type: "fact_neutralised", value: "38.9" }] }),
    ).toBe(false);
  });
});
