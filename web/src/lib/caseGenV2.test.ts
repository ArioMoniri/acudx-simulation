import { describe, expect, it } from "vitest";

import { parseSseBuffer, streamCaseGenV2, v2SpecToCaseInstance, type CaseGenV2Spec } from "@/lib/caseGenV2";
import { validateCase } from "@/domain/caseGen";

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

describe("parseSseBuffer", () => {
  it("parses complete blocks in order and keeps the partial tail", () => {
    const text =
      sse("start", { thread_id: "t1", pipeline: ["sample_condition", "author"] }) +
      sse("node", { node: "sample_condition", status: "sampled", trace: [] }) +
      "event: node\ndata: {\"node\": \"auth";
    const { events, rest } = parseSseBuffer(text);
    expect(events.map((e) => e.event)).toEqual(["start", "node"]);
    expect(events[0]).toMatchObject({ event: "start", thread_id: "t1" });
    expect(events[1]).toMatchObject({ event: "node", node: "sample_condition" });
    expect(rest).toBe("event: node\ndata: {\"node\": \"auth");
  });

  it("tolerates CRLF and drops malformed data without losing later events", () => {
    const text = "event: node\r\ndata: not-json\r\n\r\n" + sse("done", { thread_id: "t1", spec: null, trace_summary: { nodes: [] } });
    const { events } = parseSseBuffer(text);
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("done");
  });
});

describe("streamCaseGenV2", () => {
  it("emits events in order and resolves with the done payload", async () => {
    const chunks = [
      sse("start", { thread_id: "t9", pipeline: ["sample_condition", "author", "finalize"] }),
      sse("node", { node: "sample_condition", status: "sampled", trace: [] }),
      sse("node", { node: "author", status: "authored", trace: [{ node: "author", tokens_in: 1, tokens_out: 1 }] }),
      sse("done", { thread_id: "t9", spec: null, trace_summary: { nodes: ["sample_condition", "author"], model_calls: 1 } }),
    ];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        for (const c of chunks) controller.enqueue(enc.encode(c));
        controller.close();
      },
    });
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } })) as typeof fetch;
    try {
      const seen: string[] = [];
      const res = await streamCaseGenV2({ system: "cardiology" }, { onEvent: (e) => seen.push(e.event) });
      expect(seen).toEqual(["start", "node", "node", "done"]);
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.data.thread_id).toBe("t9");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("surfaces the server error code on a 503", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "model_unreachable", detail: "x" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    try {
      const res = await streamCaseGenV2({}, { onEvent: () => undefined });
      expect(res).toEqual({ ok: false, error: "model_unreachable", status: 503 });
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("v2SpecToCaseInstance", () => {
  const spec: CaseGenV2Spec = {
    seed: 7,
    locale: "en",
    condition: { icd11: "BA41.1", icd10: "I21.4", label_en: "NSTEMI", label_tr: "NSTEMI", system: "cardiology" },
    demographics: { age: 61, sex: "male", name_hint: "James T." },
    chief_complaint_en: "Chest pressure",
    chief_complaint_tr: "Göğüs baskısı",
    acuity_esi: 2,
    difficulty: 3,
    hpi: [{ intent: "onset", answer_en: "An hour ago.", answer_tr: "Bir saat önce.", red_flag: false }],
    exam: [{ maneuver: "cardiovascular", system_en: "CV", system_tr: "KV", finding_en: "S4", finding_tr: "S4", abnormal: true }],
    triage_vitals: { hr: 98, systolic: 142, diastolic: 88, rr: 20, spo2: 96, tempC: 36.9 },
    vitals_trajectory: [{ atMs: 0, hr: 98, systolic: 142, diastolic: 88, rr: 20, spo2: 96, tempC: 36.9 }],
    labs: [],
    imaging: [],
    treatments: [],
    disposition: "admit-ccu",
    guideline_anchors: [
      {
        statement_id: "gs_esc23acs_dapt",
        statement_en: "Start DAPT.",
        statement_tr: "DAPT başlayın.",
        source: "ESC",
        citation: "https://www.escardio.org/",
      },
    ],
    meta: { source: "model", generator: "v2", model: "qwen2.5-7b-instruct", condition_id: "acs_nstemi", degraded: false, note: null, latency_ms: 12 },
  };

  it("reuses specToCaseInstance and labels provenance from meta.source", () => {
    const out = v2SpecToCaseInstance(spec);
    expect(out.source).toBe("ai");
    expect(out.degraded).toBe(false);
    expect(out.case.provenance).toBe("generated");
    expect(out.case.seed).toBe(7);
    expect(validateCase(out.case)).toEqual({ ok: true, reasons: [] });
    const tpl = v2SpecToCaseInstance({ ...spec, meta: { ...spec.meta, source: "template", degraded: true } });
    expect(tpl.source).toBe("template");
    expect(tpl.degraded).toBe(true);
  });
});
