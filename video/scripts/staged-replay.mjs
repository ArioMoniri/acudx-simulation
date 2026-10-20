/**
 * The recorded live model case, replayed as the staged stream with its real
 * pacing visible (opening first, then the layers of the same thread).
 *
 * Source: web/e2e/helpers/liveCase.ts `LIVE_CASES`, the recorded Qwen3-14B
 * output of the 2026-10-20 acceptance run (server/tests/fixtures/live) that
 * the e2e suite replays. Nothing is authored here: the opening spec carries
 * the recorded demographics, chief complaint and triage vitals, and each
 * `layer.ready` adds the recorded history, exam, treatment and result rows of
 * that layer, in the order and roughly at the pace the staged generator writes
 * them (docs/architecture/15 section 12). The final `done` carries the whole
 * recorded spec, exactly as liveCase.ts `stagedStream` serves it.
 *
 * `route.fulfill` in Playwright cannot stream, so `installStagedReplay`
 * answers the generate request inside the page with a streamed Response; the
 * client reads the events as they are written.
 */
const HISTORY = {
  presenting: ["onset", "location", "character", "radiation", "severity", "timing", "aggravating", "relieving"],
  associated: ["associated-symptoms", "red-flags", "risk-factors", "ice"],
  background: ["past-medical-history", "medications", "allergies", "family-history", "social-history"],
};
const EXAM = {
  general: ["general-inspection", "vitals-recheck"],
  cardiovascular: ["cardiovascular"],
  respiratory: ["respiratory"],
  abdominal: ["abdominal"],
  neurological: ["neurological"],
  msk_skin: ["musculoskeletal", "skin"],
  ent_special: ["ent", "focused-special"],
};

/** The layers the recorded spec fills, in the staged generator's order. */
export function layerPlan(spec) {
  const plan = [];
  for (const [c, intents] of Object.entries(HISTORY)) {
    const has = spec.hpi.some((h) => intents.includes(h.intent));
    if (has || c === "background") plan.push(`history.${c}`);
  }
  for (const [s, mans] of Object.entries(EXAM)) {
    if (spec.exam.some((e) => mans.includes(e.maneuver))) plan.push(`exam.${s}`);
  }
  plan.push("treatments", "results");
  return plan;
}

/** The recorded spec as it stands once the given layers are written. */
export function specWith(rec, threadId, ready, plan) {
  const full = rec.spec;
  const has = (l) => ready.includes(l);
  const hist = (h) => Object.entries(HISTORY).some(([c, i]) => has(`history.${c}`) && i.includes(h.intent));
  const exam = (e) => Object.entries(EXAM).some(([s, m]) => has(`exam.${s}`) && m.includes(e.maneuver));
  const bg = has("history.background");
  return {
    ...full,
    hpi: full.hpi.filter(hist),
    exam: full.exam.filter(exam),
    pmh_en: bg ? full.pmh_en : "",
    pmh_tr: bg ? full.pmh_tr : "",
    meds_en: bg ? full.meds_en : "",
    meds_tr: bg ? full.meds_tr : "",
    allergies_en: bg ? full.allergies_en : "",
    allergies_tr: bg ? full.allergies_tr : "",
    treatments: has("treatments") ? full.treatments : [],
    labs: has("results") ? full.labs : [],
    imaging: has("results") ? full.imaging : [],
    meta: {
      ...full.meta,
      thread_id: threadId,
      pipeline: "staged",
      layers: Object.fromEntries(plan.map((l) => [l, has(l) ? "ready" : "pending"])),
    },
  };
}

/** [delayMs, event, data] in order: start, opening.delta*, kernel, opening.ready, layers, done. */
export function stagedEvents(rec, threadId, { pace = 1 } = {}) {
  const ms = (n) => Math.round(n * pace);
  const plan = layerPlan(rec.spec);
  const ev = [];
  ev.push([0, "start", { thread_id: threadId, stages: ["s1", "history", "exam", "treatments", "results"], eta_ms: { s1: 15000 } }]);
  ev.push([ms(900), "opening.delta", { path: "chief_complaint", value: rec.spec.chief_complaint_en }]);
  ev.push([ms(500), "opening.delta", { path: "demographics.age", value: rec.spec.demographics.age }]);
  for (const [k, v] of Object.entries(rec.spec.triage_vitals)) ev.push([ms(260), "opening.delta", { path: `triage_vitals.${k}`, value: v }]);
  ev.push([ms(500), "kernel", { status: "ready" }]);
  ev.push([
    ms(400),
    "opening.ready",
    { thread_id: threadId, opening: {}, spec: specWith(rec, threadId, [], plan), timings: { t_first_text_ms: 1800, t_opening_ms: 14000 } },
  ]);
  const ready = [];
  for (const layer of plan) {
    ev.push([ms(700), "layer.pending", { layer, reason: "continuation" }]);
    ready.push(layer);
    ev.push([ms(1500), "layer.ready", { layer, data: {}, spec: specWith(rec, threadId, [...ready], plan) }]);
  }
  ev.push([ms(400), "done", { thread_id: threadId, spec: { ...rec.spec, meta: { ...rec.spec.meta, thread_id: threadId } } }]);
  return ev;
}

/**
 * Serve every POST /api/v2/case/generate/stream of `context` from the recorded
 * live cases, paced. Playwright's `route.fulfill` delivers a body at once, so
 * the interception sits one step earlier: an init script wraps `window.fetch`
 * for that one path and answers with a streamed Response whose events come
 * from `stagedEvents` (computed here, in Node, from LIVE_CASES). Every other
 * request is untouched.
 *
 * `onGenerate({ body, rec, threadId })` runs before the stream starts (the
 * recorder stores the same thread in the local gateway's CaseStore there).
 * Returns the list of served cases.
 */
export async function installStagedReplay(context, cases, { pace = 1, onGenerate } = {}) {
  const served = [];
  let next = 0;
  await context.exposeBinding("__acudxStagedReplay", async (_source, bodyText) => {
    let body = {};
    try {
      body = JSON.parse(bodyText || "{}");
    } catch {
      body = {};
    }
    const rec = cases[next % cases.length];
    const threadId = `walkthrough-${next}-${rec.thread_id}`;
    next += 1;
    served.push({ rec, threadId });
    if (onGenerate) await onGenerate({ body, rec, threadId });
    return stagedEvents(rec, threadId, { pace });
  });
  await context.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (url.pathname !== "/api/v2/case/generate/stream" || method !== "POST") return original(input, init);
      const bodyText = typeof init?.body === "string" ? init.body : input instanceof Request ? await input.clone().text() : "";
      const events = await window.__acudxStagedReplay(bodyText);
      const enc = new TextEncoder();
      const signal = init?.signal;
      let id = 1;
      const stream = new ReadableStream({
        async start(controller) {
          for (const [delay, event, data] of events) {
            // watchdog: allow recording harness pacing of a recorded stream, never shipped
            if (delay) await new Promise((ok) => setTimeout(ok, delay));
            if (signal?.aborted) return controller.close();
            controller.enqueue(enc.encode(`id: ${id++}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          }
          controller.close();
        },
      });
      return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
    };
  });
  return served;
}
