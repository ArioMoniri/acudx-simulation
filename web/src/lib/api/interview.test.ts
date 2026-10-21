// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { interviewTurn, showsGuardNote, type InterviewReply } from "@/lib/api/interview";

const realFetch = globalThis.fetch;

function stubFetch(status: number, body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return calls;
}

const REPLY: InterviewReply = {
  thread_id: "th-1",
  reply: "Since this morning, doctor.",
  guard: { label: "clinical", reason: "in_scope" },
  actions: [
    { kind: "ask", text: "Does anything make it worse?" },
    { kind: "order", code: "2157-6", system: "LOINC", label: "Creatine kinase" },
    { kind: "navigate", target: "vitals" },
  ],
  intent: "onset",
  layer: "history.presenting",
  state_advance: true,
  flags: [],
  meta: { source: "model", guard_source: "rules+model", provider: "anthropic" },
};

describe("interview API client", () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("posts the typed message to the thread's interview route", async () => {
    const calls = stubFetch(200, REPLY);
    const res = await interviewTurn("th-1", { message: "When did it start?", guidance: true, locale: "en" });
    expect(res.ok).toBe(true);
    expect(calls[0].url).toMatch(/\/v2\/case\/th-1\/interview$/);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ message: "When did it start?", guidance: true, locale: "en" });
    if (res.ok) {
      expect(res.data.reply).toBe("Since this morning, doctor.");
      expect(res.data.actions.map((a) => a.kind)).toEqual(["ask", "order", "navigate"]);
    }
  });

  it("surfaces model_unreachable instead of a reply", async () => {
    stubFetch(503, { error: "model_unreachable", guard: { label: "clinical", reason: "in_scope" } });
    const res = await interviewTurn("th-1", { message: "When did it start?" });
    expect(res).toEqual({ ok: false, error: "model_unreachable", status: 503 });
  });

  it("shows a guard note only for non-clinical labels that carry one", () => {
    expect(showsGuardNote({ label: "clinical", reason: "in_scope" })).toBe(false);
    expect(showsGuardNote({ label: "off_topic", reason: "small_talk", note: "Off-topic." })).toBe(true);
    expect(showsGuardNote({ label: "unsafe", reason: "abuse_toward_patient" })).toBe(false);
  });
});
