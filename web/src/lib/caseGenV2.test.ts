// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import {
  directorStep,
  followCaseEvents,
  generateCaseV2,
  parseSseBuffer,
  streamCaseGenV2,
  v2SpecToCaseInstance,
  type CaseGenV2Spec,
} from "@/lib/caseGenV2";
import { validateCase } from "@/domain/caseGen";
import { createProfile, resetProfile } from "@/state/profileStore";

/** Capture the JSON body of the next fetch and answer with `reply`. */
function captureFetch(reply: unknown = {}) {
  const bodies: unknown[] = [];
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return bodies;
}

describe("learner_id on the v2 requests (architecture 15 section 10)", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    resetProfile();
  });

  it("omits learner_id when no profile is active", async () => {
    const bodies = captureFetch();
    await directorStep({ action: { kind: "question", ref: "onset" } });
    expect(bodies[0]).not.toHaveProperty("learner_id");
  });

  it("fills learner_id from the active profile on director steps and generation", async () => {
    const p = createProfile({ fullName: "L", role: "student", institution: "U", language: "en", avatarSeed: "aster" });
    const bodies = captureFetch();
    await directorStep({ action: { kind: "question", ref: "onset" } });
    await generateCaseV2({ system: "cardiology" });
    expect(bodies[0]).toMatchObject({ learner_id: p.localId, action: { kind: "question", ref: "onset" } });
    expect(bodies[1]).toMatchObject({ learner_id: p.localId, system: "cardiology" });
  });

  it("keeps an explicit learner_id (or null) set by the caller", async () => {
    createProfile({ fullName: "L", role: "student", institution: "U", language: "en", avatarSeed: "aster" });
    const bodies = captureFetch();
    await directorStep({ action: { kind: "question", ref: "onset" }, learner_id: "faculty-preview" });
    await generateCaseV2({ learner_id: null });
    expect(bodies[0]).toMatchObject({ learner_id: "faculty-preview" });
    expect(bodies[1]).toMatchObject({ learner_id: null });
  });

  it("sends learner_id on the streaming generator too", async () => {
    const p = createProfile({ fullName: "L", role: "student", institution: "U", language: "en", avatarSeed: "aster" });
    const bodies: unknown[] = [];
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ error: "model_unreachable" }), { status: 503, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    await streamCaseGenV2({ system: "cardiology" }, { onEvent: () => undefined });
    expect(bodies[0]).toMatchObject({ learner_id: p.localId });
  });
});

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

describe("Turkish text on the Director's event stream (live 2026-10-21 mojibake)", () => {
  const mood = "korkmuş, kafası karışık; ı ş ğ ü ö ç İ";
  const bytesOf = (s: string) => new TextEncoder().encode(s);

  it("decodes UTF-8 split anywhere, even inside a character, and ignores a wrong charset label", async () => {
    const wire = bytesOf(sse("director", { id: 3, affect: { mood_tr: mood, mood_en: "frightened" } }));
    // one byte per chunk: every multi-byte letter (ş = C5 9F, ı = C4 B1, İ = C4 B0) is split
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const b of wire) controller.enqueue(new Uint8Array([b]));
        controller.close();
      },
    });
    const realFetch = globalThis.fetch;
    let served = false;
    globalThis.fetch = (async () => {
      if (served) return new Response(null, { status: 404 });
      served = true;
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream; charset=windows-1251" } });
    }) as typeof fetch;
    const ctl = new AbortController();
    const seen: unknown[] = [];
    try {
      const out = await followCaseEvents("thr-tr", {
        signal: ctl.signal,
        reconnectDelayMs: 1,
        onEvent: (e) => seen.push(e),
      });
      expect(out).toBe("forbidden");
    } finally {
      globalThis.fetch = realFetch;
    }
    const ev = seen[0] as { affect?: { mood_tr?: string } };
    expect(ev.affect?.mood_tr).toBe(mood);
    expect(JSON.stringify(seen)).not.toMatch(/Е|џ|Д/);
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

  it("keeps only coded treatment responses with minute-scale onsets", () => {
    const out = v2SpecToCaseInstance({
      ...spec,
      treatments: [
        { code: "", label_en: "NPO", label_tr: "Ağızdan yok", appropriateness: "neutral", effects: [] },
        {
          code: "iv_fluids", label_en: "IV fluid resuscitation", label_tr: "IV sıvı", appropriateness: "indicated",
          effects: [{ key: "systolic", delta: 15, onsetMs: 300_000 }],
        },
      ],
      meta: { ...spec.meta, gap_filled: ["labs", "imaging", "red_flags"], council: { decision: "accept", rounds: 1, repairs: 0, vetoed: false, issues: [], notes: ["opinion"] } },
    });
    const responses = out.case.treatmentResponses ?? [];
    expect(responses.map((r) => r.treatmentCode)).toEqual(["iv_fluids"]);
    expect(responses[0].effects[0].onsetMs).toBe(300_000);
    expect(out.meta.gap_filled).toEqual(["labs", "imaging", "red_flags"]);
  });
});
