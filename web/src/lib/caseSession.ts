/**
 * AcuDx: one learner request -> one case generated on request, played in flight.
 *
 * `requestCase` opens the staged stream (review 06a 4.6), starts the encounter the
 * moment the opening is playable (`opening.ready`), then keeps folding the layers the
 * server writes for the SAME thread into the running encounter (history clusters,
 * exam systems, treatment table, results, judge patches, branch events). A layer the
 * learner reaches before the continuation wrote it is fetched lazily
 * (`POST /v2/case/{thread_id}/layer/{layer}`).
 *
 * There is no fallback case of any kind: when the model cannot be reached the result
 * is an error, and the page says so and offers Retry (owner decision).
 *
 * Every case reaching the store passes the provenance guard (`assertModelSpec` and
 * `startGeneratedEncounter`): source "model" with its thread id.
 */

import {
  assertModelSpec,
  readCaseLayer,
  streamCaseGenV2,
  v2SpecToCaseInstance,
  type CaseGenV2Event,
  type CaseGenV2Meta,
  type CaseGenV2Request,
  type CaseGenV2Spec,
} from "@/lib/caseGenV2";
import { layerStatuses, type LayerStatus } from "@/lib/caseLayers";
import type { CaseGenerationMeta } from "@/lib/liveEncounter";
import type { BackendResult } from "@/lib/backend";
import {
  mergeGeneratedCase,
  setCaseLayers,
  setLayerRequester,
  startGeneratedEncounter,
} from "@/state/encounterStore";

/** Provenance record of a model case, from its meta block. */
export function generationFromMeta(meta: CaseGenV2Meta, threadId: string | null): CaseGenerationMeta {
  return {
    source: "model",
    threadId: meta.thread_id ?? threadId,
    council: meta.council
      ? { decision: meta.council.decision, vetoed: meta.council.vetoed, repairs: meta.council.repairs }
      : null,
    degraded: Boolean(meta.degraded),
    model: Array.isArray(meta.model) ? meta.model.join(", ") : meta.model ?? null,
    note: meta.note ?? null,
  };
}

export interface RequestCaseOptions {
  signal?: AbortSignal;
  /** Every stream event, in order (progress views). */
  onEvent?: (ev: CaseGenV2Event) => void;
  /** Called once when the encounter has started from the opening. */
  onPlayable?: (info: { threadId: string; spec: CaseGenV2Spec }) => void;
  /** Called when the thread is complete (every core layer written and judged). */
  onComplete?: (info: { threadId: string }) => void;
}

function layersOf(spec: CaseGenV2Spec | null | undefined): Record<string, LayerStatus> {
  return layerStatuses(spec?.meta?.layers ?? undefined);
}

/**
 * Request one case and play it. Resolves when the encounter has started (ok) or the
 * request failed before any case existed (error). Never throws.
 */
export async function requestCase(
  req: CaseGenV2Request,
  opts: RequestCaseOptions = {},
): Promise<BackendResult<{ threadId: string }>> {
  let threadId: string | null = null;
  let started = false;
  const inflight = new Set<string>();

  const start = (spec: CaseGenV2Spec | null, tid: string) => {
    if (started || !spec) return;
    assertModelSpec(spec);
    const adapted = v2SpecToCaseInstance(spec);
    threadId = spec.meta.thread_id ?? tid;
    startGeneratedEncounter(adapted.case, generationFromMeta(spec.meta, threadId), layersOf(spec));
    started = true;
    setLayerRequester((layer) => fetchLayer(layer));
    opts.onPlayable?.({ threadId: threadId!, spec });
  };

  const merge = (spec: CaseGenV2Spec | null | undefined, extra: Record<string, LayerStatus> = {}) => {
    if (!started || !threadId || !spec || opts.signal?.aborted) return;
    assertModelSpec(spec);
    mergeGeneratedCase(threadId, v2SpecToCaseInstance(spec).case, { ...layersOf(spec), ...extra });
  };

  const fetchLayer = (layer: string) => {
    if (!threadId || inflight.has(layer)) return;
    inflight.add(layer);
    const tid = threadId;
    setCaseLayers(tid, { [layer]: "pending" });
    void readCaseLayer(tid, layer, opts.signal ? { signal: opts.signal } : {}).then((res) => {
      inflight.delete(layer);
      if (res.ok) merge(res.data.spec, { [layer]: "ready" });
      else setCaseLayers(tid, { [layer]: "failed" });
    });
  };

  const res = await streamCaseGenV2(req, {
    ...(opts.signal ? { signal: opts.signal } : {}),
    onEvent: (ev) => {
      if (opts.signal?.aborted) return;
      opts.onEvent?.(ev);
      switch (ev.event) {
        case "start":
          threadId = ev.thread_id;
          break;
        case "opening.ready":
          start(ev.spec, ev.thread_id);
          break;
        case "layer.pending":
          if (threadId) setCaseLayers(threadId, { [ev.layer]: "pending" });
          break;
        case "layer.ready":
          merge(ev.spec, { [ev.layer]: "ready" });
          break;
        case "judge":
          if (ev.decision === "patched") merge(ev.spec);
          break;
        case "error":
          if (threadId && ev.stage && ev.stage !== "s1" && !ev.fatal) setCaseLayers(threadId, { [ev.stage]: "failed" });
          break;
        case "done":
          // A server that sends the whole case at once starts the encounter here.
          if (!started) start(ev.spec, ev.thread_id);
          else merge(ev.spec);
          if (threadId) opts.onComplete?.({ threadId });
          break;
        default:
          break;
      }
    },
  });
  if (!res.ok) return res;
  if (!started) {
    try {
      start(res.data.spec, res.data.thread_id);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.name : "not_model_generated" };
    }
  }
  if (!started) return { ok: false, error: "no_spec" };
  return { ok: true, data: { threadId: threadId ?? res.data.thread_id } };
}

/** Stop fetching layers for the previous case (the page unmounted or a new case starts). */
export function endCaseSession(): void {
  setLayerRequester(null);
}
