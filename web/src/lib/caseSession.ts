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
 * `followCase` binds a team-room member to the room's thread: it joins the thread with
 * the room's code (`POST /v2/case/{t}/join`) and follows its event log
 * (`GET /v2/case/{t}/events?follow=1`), so later layers, renderings and every member's
 * Director steps reach this device too (doc 15 section 12.7).
 *
 * Both install the same thread session: lazy layers, the debrief layer when the diagnosis
 * is committed, and renderings of the layers already seen when the UI language switches
 * away from the case's own language mid-encounter (an EN case to Turkish, a TR case to
 * English; one call per layer, cached on the thread; the source text stays authoritative).
 * A team room's order and task loop also travels on the thread (`task` events, doc 15
 * section 12.8), handed to the room's task listener.
 *
 * There is no fallback case of any kind: when the model cannot be reached the result
 * is an error, and the page says so and offers Retry (owner decision). A layer the
 * safety review rejected after its rewrite fails honestly (06b F30): its reason is kept
 * and the treatment table is regenerated once, then offered for Retry.
 *
 * Every case reaching the store passes the provenance guard (`assertModelSpec` and
 * `startGeneratedEncounter`): source "model" with its thread id.
 */

import i18n from "i18next";

import {
  assertModelSpec,
  bindRoomThread,
  followCaseEvents,
  joinRoomThread,
  readCaseLayer,
  renderCaseLayer,
  streamCaseGenV2,
  v2SpecToCaseInstance,
  type CaseGenV2Event,
  type CaseGenV2Meta,
  type CaseGenV2Request,
  type CaseGenV2Spec,
  type DebriefLayerData,
  type RoomTaskEvent,
} from "@/lib/caseGenV2";
import { layerStatuses, type LayerStatus } from "@/lib/caseLayers";
import type { CaseGenerationMeta } from "@/lib/liveEncounter";
import type { BackendResult } from "@/lib/backend";
import {
  applyThreadDirector,
  getEncounterSnapshot,
  mergeGeneratedCase,
  setCaseLayerFailure,
  setCaseLayers,
  setDebrief,
  setDebriefRequester,
  setLayerRequester,
  startGeneratedEncounter,
  subscribeEncounter,
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

/* -------------------------------------------------------------------------- */
/* Thread session: lazy layers, debrief, renderings, thread events             */
/* -------------------------------------------------------------------------- */

/** The layers a learner has seen, from the datum ids revealed so far (stable `uid`s). */
export function seenLayers(discovered: Iterable<string>, extra: { treatments?: boolean } = {}): string[] {
  const out = new Set<string>(["opening"]);
  for (const id of discovered) {
    const m = /((?:history|exam)\.[a-z_]+|event\.[a-z0-9_-]+)\.\d+$/.exec(id);
    if (m) out.add(m[1]);
    else if (/results\.(?:lab|img)\.\d+$/.test(id)) out.add("results");
  }
  if (extra.treatments) out.add("treatments");
  return [...out];
}

function uiLocale(): "en" | "tr" {
  return (i18n.language ?? "").toLowerCase().startsWith("tr") ? "tr" : "en";
}

/** Who applies the room's `task` events of the running thread (set by the room page). */
let taskListener: ((threadId: string, ev: RoomTaskEvent) => void) | null = null;

/** Register the team room's task listener (null to clear). */
export function setRoomTaskListener(fn: ((threadId: string, ev: RoomTaskEvent) => void) | null): void {
  taskListener = fn;
}

interface ThreadSession {
  threadId: string;
  handle: (ev: CaseGenV2Event) => void;
  fetchLayer: (layer: string) => void;
  dispose: () => void;
}

let active: ThreadSession | null = null;

function openSession(threadId: string, signal?: AbortSignal): ThreadSession {
  active?.dispose();
  const inflight = new Set<string>();
  const rendering = new Set<string>();
  const renderFailed = new Set<string>();
  const autoRetried = new Set<string>();
  let disposed = false;
  const opts = signal ? { signal } : {};

  const merge = (spec: CaseGenV2Spec | null | undefined, extra: Record<string, LayerStatus> = {}) => {
    if (disposed || !spec || signal?.aborted) return;
    assertModelSpec(spec);
    mergeGeneratedCase(threadId, v2SpecToCaseInstance(spec).case, { ...layersOf(spec), ...extra });
  };

  const fail = (layer: string, error: string, reason?: string, issues?: string[]) => {
    setCaseLayerFailure(threadId, layer, { error, ...(reason ? { reason } : {}), ...(issues ? { issues } : {}) });
    // 06b F30: a treatment table the safety review rejected is regenerated once, so the
    // panel's "being regenerated" is true; a second rejection waits for Retry.
    if (layer === "treatments" && error === "safety_veto" && !autoRetried.has(layer)) {
      autoRetried.add(layer);
      fetchLayer(layer);
    }
  };

  const fetchLayer = (layer: string) => {
    if (disposed || inflight.has(layer)) return;
    inflight.add(layer);
    setCaseLayers(threadId, { [layer]: "pending" });
    void readCaseLayer(threadId, layer, opts).then((res) => {
      inflight.delete(layer);
      if (res.ok) merge(res.data.spec, { [layer]: "ready" });
      else fail(layer, res.error);
    });
  };

  const fetchDebrief = (diagnosis: { code: string; display: string }) => {
    if (disposed) return;
    setDebrief(threadId, { status: "pending", error: null });
    void readCaseLayer(threadId, "debrief", { ...opts, body: { reason: "committed", diagnosis } }).then((res) => {
      if (disposed) return;
      if (res.ok) {
        setDebrief(threadId, { status: "ready", data: res.data.data as unknown as DebriefLayerData, error: null });
        syncRenderings();
      } else setDebrief(threadId, { status: "failed", error: res.error });
    });
  };

  /**
   * The UI language differs from the case's (TR UI on an EN case, EN UI on a TR case): render
   * every layer seen so far into the UI language (once per layer and locale; cached server-side).
   */
  const syncRenderings = () => {
    if (disposed) return;
    const target = uiLocale();
    const s = getEncounterSnapshot();
    const c = s.caseInstance;
    if (!c || s.generation?.threadId !== threadId || c.locale === target) return;
    const layers = seenLayers(s.discovered, { treatments: s.treatments.length > 0 && s.caseLayers.treatments === "ready" });
    if (s.debrief.status === "ready" && !s.debrief.rendered[target]) layers.push("debrief");
    for (const layer of layers) {
      const key = `${target}:${layer}`;
      if (rendering.has(key) || renderFailed.has(key)) continue;
      if (layer !== "opening" && layer !== "debrief" && s.caseLayers[layer] !== "ready") continue;
      rendering.add(key);
      void renderCaseLayer(threadId, layer, target, opts).then((res) => {
        if (disposed) return;
        if (!res.ok) {
          // The source text stays on screen; the next language switch asks again.
          rendering.delete(key);
          renderFailed.add(key);
          return;
        }
        if (layer === "debrief") setDebrief(threadId, { rendered: { [target]: res.data.data as unknown as DebriefLayerData } });
        else merge(res.data.spec);
      });
    }
  };

  const handle = (ev: CaseGenV2Event) => {
    if (disposed || signal?.aborted) return;
    switch (ev.event) {
      case "opening.ready":
        // A room member replaying the thread log learns every layer's status from the opening
        // (a treatment table not written yet keeps Administer blocked on this device too).
        merge(ev.spec);
        break;
      case "layer.pending":
        setCaseLayers(threadId, { [ev.layer]: "pending" });
        break;
      case "layer.ready":
        // The debrief another member's commit requested reaches every member of the room.
        if (ev.layer === "debrief" && ev.data) {
          setDebrief(threadId, { status: "ready", data: ev.data as unknown as DebriefLayerData, error: null });
          syncRenderings();
        }
        merge(ev.spec, { [ev.layer]: "ready" });
        break;
      case "layer.rendered":
        if (ev.layer === "debrief") {
          const loc = ev.locale === "en" ? "en" : "tr";
          setDebrief(threadId, { rendered: { [loc]: ev.data as unknown as DebriefLayerData } });
        } else merge(ev.spec);
        break;
      case "task":
        taskListener?.(threadId, ev);
        break;
      case "judge":
        if (ev.decision === "patched") merge(ev.spec);
        break;
      case "director":
        applyThreadDirector(threadId, ev);
        break;
      case "error":
        if (ev.stage && ev.stage !== "s1" && !ev.fatal && !ev.stage.startsWith("render:")) {
          fail(ev.stage, ev.error, ev.reason, ev.issues);
        }
        break;
      case "done":
        merge(ev.spec);
        break;
      default:
        break;
    }
  };

  setLayerRequester(fetchLayer);
  setDebriefRequester(fetchDebrief);
  const unsubscribe = subscribeEncounter(syncRenderings);
  const onLanguage = () => {
    renderFailed.clear();
    syncRenderings();
  };
  i18n.on("languageChanged", onLanguage);

  const session: ThreadSession = {
    threadId,
    handle,
    fetchLayer,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      i18n.off("languageChanged", onLanguage);
      if (active === session) {
        setLayerRequester(null);
        setDebriefRequester(null);
        active = null;
      }
    },
  };
  active = session;
  return session;
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
  let session: ThreadSession | null = null;

  const start = (spec: CaseGenV2Spec | null, tid: string) => {
    if (session || !spec) return;
    assertModelSpec(spec);
    const adapted = v2SpecToCaseInstance(spec);
    threadId = spec.meta.thread_id ?? tid;
    startGeneratedEncounter(adapted.case, generationFromMeta(spec.meta, threadId), layersOf(spec));
    session = openSession(threadId, opts.signal);
    opts.onPlayable?.({ threadId: threadId!, spec });
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
        case "done":
          // A server that sends the whole case at once starts the encounter here.
          if (!session) start(ev.spec, ev.thread_id);
          else session.handle(ev);
          if (threadId) opts.onComplete?.({ threadId });
          break;
        default:
          session?.handle(ev);
          break;
      }
    },
  });
  if (!res.ok) return res;
  if (!session) {
    try {
      start(res.data.spec, res.data.thread_id);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.name : "not_model_generated" };
    }
  }
  if (!session) return { ok: false, error: "no_spec" };
  return { ok: true, data: { threadId: threadId ?? res.data.thread_id } };
}

export interface FollowCaseOptions {
  signal: AbortSignal;
  /** Called once access is settled: `owner` when this learner requested the thread. */
  onAccess?: (info: { owner: boolean }) => void;
}

/**
 * Bind this device to a team room's thread and follow it: the learner who requested the
 * thread binds it to the room's code (the server accepts that only from the owner), every
 * other member joins with the code; all then follow the thread's event log, so later
 * layers, renderings and every member's Director steps land here. The encounter must
 * already run this thread. Resolves when the follow stops (unmount, or no access).
 */
export async function followCase(
  threadId: string,
  roomCode: string,
  opts: FollowCaseOptions,
): Promise<"aborted" | "forbidden" | "error"> {
  const bound = await bindRoomThread(threadId, roomCode, { signal: opts.signal });
  const owner = bound.ok;
  const access = owner ? bound : await joinRoomThread(threadId, roomCode, { signal: opts.signal });
  if (opts.signal.aborted) return "aborted";
  if (!access.ok) return access.status === 404 ? "forbidden" : "error";
  opts.onAccess?.({ owner });
  // The host's request already runs a session on this thread; a member opens its own and
  // closes it with the follow.
  const reused = active?.threadId === threadId ? active : null;
  const session = reused ?? openSession(threadId, opts.signal);
  if (!reused) opts.signal.addEventListener("abort", () => session.dispose(), { once: true });
  return followCaseEvents(threadId, { signal: opts.signal, onEvent: session.handle, after: 0 });
}

/** Stop fetching layers for the previous case (the page unmounted or a new case starts). */
export function endCaseSession(): void {
  active?.dispose();
  setLayerRequester(null);
  setDebriefRequester(null);
}
