import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { etaMinutes, wakeOnCallStart, wakeStatus, watchWorker } from "@/lib/workerWake";
import type { VideoWake, VoiceApi, VoiceCapabilities, WorkerWake } from "@/lib/voiceApi";

function caps(over: {
  avatarEnabled?: boolean;
  ready?: boolean;
  canLaunch?: boolean;
  wake?: Partial<WorkerWake>;
  runner?: string;
}): VoiceCapabilities {
  const engine = { enabled: true, provider: "gpu-worker", source: "gpu_worker" as const, adapter: null, model: null, languages: [], reasons: [] };
  return {
    airgapped: false,
    tts: engine,
    stt: engine,
    avatar: {
      enabled: !!over.avatarEnabled,
      provider: "gpu-worker",
      transport: "webrtc",
      renderer: "musetalk",
      state: over.runner,
      reasons: over.runner ? [`gpu-worker avatar: ${over.runner}`] : [],
    },
    gpu_worker: {
      ready: over.ready ?? false,
      can_launch: over.canLaunch ?? true,
      refusal: over.canLaunch === false ? { reason: "budget", message: "daily budget reached" } : null,
      wake: { state: "starting", detail: null, elapsed_s: 120, estimate_s: 600, ...over.wake },
    },
  };
}

describe("wakeOnCallStart", () => {
  it("wakes the worker once and reads the answer", async () => {
    const warm = vi.fn(async () => ({ ok: true as const, data: { ready: false, pending_launch: true, refusal: null } }));
    expect(await wakeOnCallStart({ warm } as unknown as VoiceApi)).toEqual({ kind: "waking", minutes: 10 });
    expect(warm).toHaveBeenCalledTimes(1);
  });

  it("is ready at once when a worker is up, and failed when the gateway refuses to launch", async () => {
    const ready = { warm: async () => ({ ok: true as const, data: { ready: true, pending_launch: false, refusal: null } }) };
    expect(await wakeOnCallStart(ready as unknown as VoiceApi)).toEqual({ kind: "ready" });
    const refused = {
      warm: async () => ({
        ok: true as const,
        data: { ready: false, pending_launch: false, refusal: { reason: "airgapped", message: "AIRGAPPED=true" } },
      }),
    };
    expect(await wakeOnCallStart(refused as unknown as VoiceApi)).toEqual({ kind: "failed", detail: "airgapped" });
  });
});

describe("wakeStatus", () => {
  it("reads ready, booting with an estimate, and failures", () => {
    expect(wakeStatus(caps({ avatarEnabled: true, ready: true }))).toEqual({ kind: "ready" });
    expect(wakeStatus(caps({}))).toEqual({ kind: "waking", minutes: 8 });
    expect(wakeStatus(caps({ wake: { state: "failed", detail: "launch failed (WorkerFailed)" } }))).toEqual({
      kind: "failed",
      detail: "launch failed (WorkerFailed)",
    });
    expect(wakeStatus(caps({ canLaunch: false, wake: { state: "idle" } }))).toEqual({ kind: "failed", detail: "budget" });
    expect(wakeStatus(caps({ ready: true, runner: "disabled" })).kind).toBe("failed");
    // Up, but the runner is still being built: keep waiting.
    expect(wakeStatus(caps({ ready: true, runner: "building", wake: { state: "ready" } })).kind).toBe("waking");
  });

  it("never estimates less than a minute", () => {
    expect(etaMinutes({ elapsed_s: 900, estimate_s: 600 })).toBe(1);
    expect(etaMinutes(null)).toBe(10);
  });
});

describe("watchWorker", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  it("keeps polling while the call is active (no fixed try limit) and stops once ready", async () => {
    let n = 0;
    const capabilities = vi.fn(async () => {
      n += 1;
      return { ok: true as const, data: n < 60 ? caps({}) : caps({ avatarEnabled: true, ready: true }) };
    });
    const seen: string[] = [];
    watchWorker({ api: { capabilities } as unknown as VoiceApi, isActive: () => true, onStatus: (s) => seen.push(s.kind), intervalMs: 1000 });
    for (let i = 0; i < 70; i++) {
      await flush();
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(capabilities).toHaveBeenCalledTimes(60);
    expect(seen.at(-1)).toBe("ready");
    expect(seen.filter((k) => k === "waking")).toHaveLength(59);
  });

  it("stops when the call ends or the tile unmounts", async () => {
    let active = true;
    const capabilities = vi.fn(async () => ({ ok: true as const, data: caps({}) }));
    const stop = watchWorker({ api: { capabilities } as unknown as VoiceApi, isActive: () => active, onStatus: () => {}, intervalMs: 1000 });
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    await flush();
    expect(capabilities).toHaveBeenCalledTimes(2);
    active = false;
    await vi.advanceTimersByTimeAsync(5000);
    expect(capabilities).toHaveBeenCalledTimes(2);

    const capabilities2 = vi.fn(async () => ({ ok: true as const, data: caps({}) }));
    const stop2 = watchWorker({ api: { capabilities: capabilities2 } as unknown as VoiceApi, isActive: () => true, onStatus: () => {}, intervalMs: 1000 });
    await flush();
    stop2();
    await vi.advanceTimersByTimeAsync(5000);
    expect(capabilities2).toHaveBeenCalledTimes(1);
    stop();
  });

  it("stops on a failed launch", async () => {
    const capabilities = vi.fn(async () => ({ ok: true as const, data: caps({ wake: { state: "failed", detail: "x" } }) }));
    const onStatus = vi.fn();
    watchWorker({ api: { capabilities } as unknown as VoiceApi, isActive: () => true, onStatus, intervalMs: 1000 });
    await flush();
    await vi.advanceTimersByTimeAsync(5000);
    expect(capabilities).toHaveBeenCalledTimes(1);
    expect(onStatus.mock.calls[0][0]).toEqual({ kind: "failed", detail: "x" });
  });
});

describe("the live video stage (avatar.wake)", () => {
  function withVideo(wake: VideoWake, over: Parameters<typeof caps>[0] = {}): VoiceCapabilities {
    const c = caps(over);
    return { ...c, avatar: { ...c.avatar, wake } };
  }

  it("names the stage and gives progress and the minutes left to live video", () => {
    const machine = wakeStatus(withVideo({ stage: "machine", elapsed_s: 300, estimate_s: 1200, progress: 0.25 }));
    expect(machine).toEqual({ kind: "waking", minutes: 15, stage: "machine", progress: 0.25 });
    // The worker answers but the runner is still building: the estimate keeps counting down, it
    // does not restart at the machine's 10 minutes.
    const services = wakeStatus(
      withVideo({ stage: "video_services", elapsed_s: 900, estimate_s: 1200, progress: 0.75, runner: "building" },
        { ready: true, runner: "building", wake: { state: "ready", elapsed_s: null } }),
    );
    expect(services).toEqual({ kind: "waking", minutes: 5, stage: "video_services", progress: 0.75 });
  });

  it("past the estimate it still says at least a minute, and a failed stage carries its reason", () => {
    expect(wakeStatus(withVideo({ stage: "video_services", elapsed_s: 1500, estimate_s: 1200, progress: 0.95 }, { ready: true })))
      .toEqual({ kind: "waking", minutes: 1, stage: "video_services", progress: 0.95 });
    expect(wakeStatus(withVideo({ stage: "failed", elapsed_s: null, estimate_s: 1200, progress: 0, detail: "insufficient_vram" }, { ready: true })))
      .toEqual({ kind: "failed", detail: "insufficient_vram" });
  });
});
