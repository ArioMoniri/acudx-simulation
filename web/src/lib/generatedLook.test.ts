import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOOK_FOLLOW_MS, LOOK_POLL_MS, startLookWatch, subscribeGeneratedLook, type GeneratedLook } from "@/lib/generatedLook";
import type { AvatarLook } from "@/lib/voiceApi";

const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

function api(looks: AvatarLook[], status?: number) {
  let i = 0;
  return {
    avatarLook: vi.fn(async () =>
      status ? { ok: false as const, error: `http_${status}`, status } : { ok: true as const, data: looks[Math.min(i++, looks.length - 1)] },
    ),
    avatarLookImage: vi.fn(async (_t: string, _p: string, key: string) => ({ ok: true as const, data: new Blob([key]) })),
  };
}

describe("generated look watcher", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("polls while the pictures are made, then shows the picture for the patient now", async () => {
    const a = api([
      { state: "preparing", has_image: false },
      { state: "ready", has_image: true, key: "k1", exact: true },
    ]);
    const seen: GeneratedLook[] = [];
    let n = 0;
    const stop = startLookWatch("thr", "p04", (l) => seen.push(l), { api: a, createUrl: () => `blob:${++n}`, revokeUrl: vi.fn() });
    await flush();
    expect(seen.at(-1)?.state).toBe("preparing");
    await vi.advanceTimersByTimeAsync(LOOK_POLL_MS);
    await flush();
    expect(seen.at(-1)).toEqual({ url: "blob:1", key: "k1", exact: true, state: "ready" });
    expect(a.avatarLookImage).toHaveBeenCalledWith("thr", "p04", "k1", expect.anything());
    stop();
  });

  it("follows a Director step to the next picture and frees the old one", async () => {
    const a = api([
      { state: "ready", has_image: true, key: "k1", exact: true },
      { state: "ready", has_image: true, key: "k2", exact: false },
    ]);
    const revoke = vi.fn();
    const seen: GeneratedLook[] = [];
    let n = 0;
    const stop = startLookWatch("thr", "p04", (l) => seen.push(l), { api: a, createUrl: () => `blob:${++n}`, revokeUrl: revoke });
    await flush();
    await vi.advanceTimersByTimeAsync(LOOK_FOLLOW_MS);
    await flush();
    expect(seen.at(-1)?.key).toBe("k2");
    expect(revoke).toHaveBeenCalledWith("blob:1");
    stop();
    expect(revoke).toHaveBeenCalledWith("blob:2");
  });

  it("stops on a 404 (no case thread): the case portrait stays", async () => {
    const a = api([], 404);
    const stop = startLookWatch("thr", "p04", () => {}, { api: a, createUrl: () => "x", revokeUrl: () => {} });
    await flush();
    await vi.advanceTimersByTimeAsync(LOOK_POLL_MS * 3);
    expect(a.avatarLook).toHaveBeenCalledTimes(1);
    stop();
  });

  it("shares one watcher between surfaces of the same case", async () => {
    const a = api([{ state: "ready", has_image: true, key: "k1", exact: true }]);
    const deps = { api: a, createUrl: () => "blob:1", revokeUrl: () => {} };
    const l1 = vi.fn();
    const l2 = vi.fn();
    const s1 = subscribeGeneratedLook("thr", "p04", l1, deps);
    const s2 = subscribeGeneratedLook("thr", "p04", l2, deps);
    await flush();
    expect(a.avatarLook).toHaveBeenCalledTimes(1);
    expect(l1).toHaveBeenCalled();
    expect(l2).toHaveBeenCalled();
    s1();
    s2();
  });
});
