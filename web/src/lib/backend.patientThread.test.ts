import { afterEach, describe, expect, it, vi } from "vitest";
import { patientTurn, setPatientTurnThread } from "@/lib/backend";

function okFetch() {
  return vi.fn(async () =>
    new Response(JSON.stringify({ utterance: "hi", routed_as: "clinical", state_advance: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("patientTurn thread binding", () => {
  afterEach(() => {
    setPatientTurnThread(null);
    vi.unstubAllGlobals();
  });

  it("sends the active case thread so the server voices the live state", async () => {
    const f = okFetch();
    vi.stubGlobal("fetch", f);
    setPatientTurnThread("thr-123");
    await patientTurn({ learner_msg: "How do you feel?" });
    const body = JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.thread_id).toBe("thr-123");
  });

  it("sends no thread when no case session is active, and an explicit one wins", async () => {
    const f = okFetch();
    vi.stubGlobal("fetch", f);
    await patientTurn({ learner_msg: "Hello" });
    setPatientTurnThread("thr-a");
    await patientTurn({ learner_msg: "Hello", thread_id: "thr-b" });
    const first = JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    const second = JSON.parse(String((f.mock.calls[1] as unknown as [string, RequestInit])[1].body));
    expect(first.thread_id).toBeUndefined();
    expect(second.thread_id).toBe("thr-b");
  });
});
