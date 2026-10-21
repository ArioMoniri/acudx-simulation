/**
 * workerWake: the on-demand GPU worker, woken when the learner starts the patient call.
 *
 * The worker (patient voice, live video) is strictly on demand: opening a case never
 * starts it; the call start does (`wakeOnCallStart`, POST /v1/voice/warm, which answers
 * at once). The call then watches /v1/voice/capabilities (`watchWorker`) until the live
 * video can start or the launch failed, with no fixed number of tries while the call is
 * active, and stops as soon as the call ends or the tile unmounts.
 */

import type { VoiceApi, VoiceCapabilities, WorkerWake } from "@/lib/voiceApi";

/** What the call tile shows while the worker is not serving live video yet. */
export type WakeStatus =
  | { kind: "waking"; minutes: number }
  | { kind: "ready" }
  | { kind: "failed"; detail: string | null };

/** Typical cold boot when the gateway did not say (seconds). */
export const DEFAULT_BOOT_ESTIMATE_S = 600;
/** How often the call re-reads the capabilities while the worker boots. */
export const WAKE_POLL_MS = 15_000;

/** Whole minutes left on the boot estimate (at least 1). */
export function etaMinutes(wake: Pick<WorkerWake, "elapsed_s" | "estimate_s"> | null | undefined): number {
  const estimate = wake?.estimate_s ?? DEFAULT_BOOT_ESTIMATE_S;
  const elapsed = wake?.elapsed_s ?? 0;
  return Math.max(1, Math.ceil((estimate - elapsed) / 60));
}

/** True when the capabilities say a live video call can start now (GPU runner or Tavus). */
export function liveVideoReady(caps: VoiceCapabilities): boolean {
  const av = caps.avatar;
  return !!av?.enabled && (av.transport === "webrtc" || av.transport === "tavus");
}

/** Read one capabilities answer as a wake status. */
export function wakeStatus(caps: VoiceCapabilities): WakeStatus {
  if (liveVideoReady(caps)) return { kind: "ready" };
  const gpu = caps.gpu_worker;
  if (!gpu) return { kind: "failed", detail: null };
  if (gpu.wake?.state === "failed") return { kind: "failed", detail: gpu.wake.detail ?? null };
  if (!gpu.ready && !gpu.can_launch && gpu.wake?.state !== "starting") {
    return { kind: "failed", detail: gpu.refusal?.reason ?? null };
  }
  const runner = caps.avatar?.state;
  if (gpu.ready && (runner === "disabled" || runner === "failed" || runner === "error")) {
    return { kind: "failed", detail: caps.avatar.reasons?.[0] ?? runner };
  }
  // Booting, or up but the live-video runner is still being built: keep waiting.
  return { kind: "waking", minutes: etaMinutes(gpu.wake) };
}

/**
 * The call started (a user gesture): wake the worker. Resolves with the first status to
 * show; "failed" when the gateway refuses to launch (air-gapped, not configured, budget).
 */
export async function wakeOnCallStart(api: Pick<VoiceApi, "warm">): Promise<WakeStatus> {
  const res = await api.warm();
  if (!res.ok) return { kind: "waking", minutes: etaMinutes(null) };
  if (res.data.ready) return { kind: "ready" };
  if (res.data.pending_launch) return { kind: "waking", minutes: etaMinutes(null) };
  return { kind: "failed", detail: res.data.refusal?.reason ?? null };
}

export interface WatchOptions {
  api: Pick<VoiceApi, "capabilities">;
  /** False once the call ended (or the tile unmounted): the watch stops. */
  isActive: () => boolean;
  /** Every status read, including the final ready / failed one. */
  onStatus: (status: WakeStatus, caps: VoiceCapabilities) => void;
  intervalMs?: number;
}

/**
 * Re-read the capabilities now and every `intervalMs` until the live video is ready or
 * the launch failed (no try limit while the call is active). Returns a stop function.
 */
export function watchWorker({ api, isActive, onStatus, intervalMs = WAKE_POLL_MS }: WatchOptions): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stop = () => {
    stopped = true;
    if (timer != null) clearTimeout(timer);
    timer = null;
  };
  const tick = async () => {
    timer = null;
    if (stopped || !isActive()) return stop();
    const res = await api.capabilities({ timeoutMs: 6000 });
    if (stopped || !isActive()) return stop();
    if (res.ok) {
      const status = wakeStatus(res.data);
      onStatus(status, res.data);
      if (status.kind !== "waking") return stop();
    }
    timer = setTimeout(() => void tick(), intervalMs);
  };
  void tick();
  return stop;
}
