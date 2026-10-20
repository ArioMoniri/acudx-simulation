import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BrowserContext, Page } from "@playwright/test";

/**
 * Recorded live cases (server/tests/fixtures/live/*.json): real Qwen3-14B output
 * from the acceptance run of 2026-10-20, replayed as the staged SSE stream of
 * POST /v2/case/generate/stream (review 06a 4.6). Every learner case is generated
 * on request, so an e2e run without a model replays one of these instead of the
 * gateway; nothing else (no seed, no template) can open an encounter.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const LIVE_DIR = join(HERE, "../../../server/tests/fixtures/live");

export interface LiveRecord {
  thread_id: string;
  spec: {
    seed: number;
    demographics: { name_hint: string; age: number; sex: string };
    chief_complaint_en: string;
    triage_vitals: Record<string, number>;
    meta: { condition_id: string; thread_id?: string; source: string };
    [k: string]: unknown;
  };
}

export const LIVE_CASES: LiveRecord[] = ["accepted-meningitis", "accepted-tuberculosis", "fever-fever_and_rigors", "fever-fever_and_cough"].map(
  (name) => JSON.parse(readFileSync(join(LIVE_DIR, `${name}.json`), "utf8")) as LiveRecord,
);

function sse(event: string, data: unknown, id: number): string {
  return `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** The recorded case as the staged stream: start, opening.delta*, kernel, opening.ready, done. */
export function stagedStream(rec: LiveRecord, threadId: string): string {
  const spec = { ...rec.spec, meta: { ...rec.spec.meta, thread_id: threadId } };
  let id = 1;
  let out = sse("start", { thread_id: threadId, stages: ["s1", "history", "exam", "treatments", "results"], eta_ms: { s1: 15000 } }, id++);
  out += sse("opening.delta", { path: "chief_complaint", value: rec.spec.chief_complaint_en }, id++);
  out += sse("opening.delta", { path: "demographics.age", value: rec.spec.demographics.age }, id++);
  for (const [k, v] of Object.entries(rec.spec.triage_vitals)) {
    out += sse("opening.delta", { path: `triage_vitals.${k}`, value: v }, id++);
  }
  out += sse("kernel", { status: "ready" }, id++);
  out += sse("opening.ready", { thread_id: threadId, opening: {}, spec, timings: { t_first_text_ms: 1800, t_opening_ms: 14000 } }, id++);
  out += sse("done", { thread_id: threadId, spec }, id++);
  return out;
}

/**
 * Serve the recorded live cases for every generate request of this context (the
 * rest of /api stays as the caller set it up). Consecutive requests rotate through
 * the recordings, so two requests give two different cases.
 */
export async function replayLiveCases(target: BrowserContext | Page): Promise<{ served: LiveRecord[] }> {
  const served: LiveRecord[] = [];
  let next = 0;
  await target.route(
    (url) => url.pathname === "/api/v2/case/generate/stream" || url.pathname === "/api/v2/case/generate",
    async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const rec = LIVE_CASES[next % LIVE_CASES.length];
      const threadId = `e2e-${next}-${rec.thread_id}`;
      next += 1;
      served.push(rec);
      if (new URL(route.request().url()).pathname.endsWith("/stream")) {
        return route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: stagedStream(rec, threadId) });
      }
      return route.fulfill({ json: { thread_id: threadId, spec: { ...rec.spec, meta: { ...rec.spec.meta, thread_id: threadId } } } });
    },
  );
  return { served };
}
