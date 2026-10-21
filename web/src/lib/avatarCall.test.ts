import { describe, expect, it, vi } from "vitest";

import { crossCorrelationLag, mouthRegion, resample, sessionBody } from "@/lib/avatarCall";
import { createVoiceApi } from "@/lib/voiceApi";

describe("crossCorrelationLag", () => {
  const pulse = (n: number, at: number[]) => Array.from({ length: n }, (_, i) => (at.includes(i) ? 1 : 0));

  it("finds the lag of motion behind audio", () => {
    const audio = pulse(60, [10, 11, 25, 26, 40]);
    const motion = pulse(60, [13, 14, 28, 29, 43]); // 3 steps later
    expect(crossCorrelationLag(audio, motion, 40)).toBe(120);
  });

  it("reports 0 for synchronous series and negatives for motion ahead of audio", () => {
    const a = pulse(50, [5, 20, 33]);
    expect(crossCorrelationLag(a, a, 40)).toBe(0);
    expect(crossCorrelationLag(pulse(50, [10, 25, 38]), pulse(50, [8, 23, 36]), 40)).toBe(-80);
  });

  it("returns null for flat or short series", () => {
    expect(crossCorrelationLag([0, 0, 0, 0, 0, 0, 0, 0, 0], [1, 2, 3, 4, 5, 6, 7, 8, 9], 40)).toBeNull();
    expect(crossCorrelationLag([1, 2], [1, 2], 40)).toBeNull();
  });
});

describe("resample", () => {
  it("puts irregular samples on a fixed grid", () => {
    const out = resample(
      [
        { t: 0, rms: 0.1, motion: 1, open: 10 },
        { t: 35, rms: 0.2, motion: 2, open: 20 },
        { t: 90, rms: 0.3, motion: 3, open: 30 },
      ],
      40,
    );
    expect(out.rms).toEqual([0.1, 0.2, 0.2]);
    expect(out.motion).toEqual([1, 2, 2]);
    expect(out.open).toEqual([10, 20, 20]);
  });

  it("openness recovers the lag of the mouth behind the voice", () => {
    // Uneven syllables (as in speech); the mouth opens 2 steps (80 ms) after the voice.
    const env = Array.from({ length: 120 }, (_, i) => Math.max(0, Math.sin((i / (6 + (i % 17) / 4)) * Math.PI)));
    const open = env.map((_, i) => (i >= 2 ? env[i - 2] : 0));
    expect(crossCorrelationLag(env, open, 40)).toBe(80);
    expect(crossCorrelationLag(open, env, 40)).toBe(-80);
  });
});

describe("sessionBody and mouthRegion", () => {
  it("carries the case state the typed turn uses", () => {
    const b = sessionBody({
      encounterId: "enc-1",
      photoId: "p04",
      lang: "tr",
      sex: "male",
      age: 58,
      context: { case_state: { narrative: ["x"] }, persona: { name: "Mehmet" } },
    });
    expect(b).toEqual({
      encounter_id: "enc-1",
      photo_id: "p04",
      lang: "tr",
      sex: "male",
      age: 58,
      case_state: { narrative: ["x"] },
      persona: { name: "Mehmet" },
      case_context: null,
    });
  });

  it("binds the call to the case thread so the server drives the face from the live state", () => {
    const b = sessionBody({ encounterId: "enc-1", photoId: "p04", lang: "en", threadId: "thr-9" });
    expect(b.thread_id).toBe("thr-9");
    expect(sessionBody({ encounterId: "e", photoId: "p01", lang: "en" }).thread_id).toBeUndefined();
  });

  it("looks at the lower half of the face", () => {
    const r = mouthRegion();
    expect(r.y).toBeGreaterThan(0.5);
    expect(r.x + r.w).toBeLessThanOrEqual(1);
  });

  it("places the mouth box from the runner's face box when the session has it", () => {
    const r = mouthRegion({ face_box: [100, 100, 300, 400], width: 400, height: 500 });
    expect(r.x).toBeCloseTo(160 / 400);
    expect(r.y).toBeCloseTo(286 / 500);
    expect(r.w).toBeCloseTo(80 / 400);
    expect(r.h).toBeCloseTo(90 / 500);
  });
});

describe("voiceApi avatar routes", () => {
  it("sends identity headers and maps a 503 to an explained fallback", async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/v1/voice/avatar/session")) {
        return new Response(JSON.stringify({ error: "avatar_unavailable", state: "worker_starting", reasons: ["gpu-worker: starting"], pending_launch: true }), { status: 503 });
      }
      return new Response(JSON.stringify({ sdp: "v=0", type: "answer", answer_ms: 12, init: init?.headers }), { status: 200 });
    });
    const api = createVoiceApi({ baseUrl: "/api", fetchFn: fetchFn as unknown as typeof fetch, identity: async () => ({ "X-User-Id": "u1" }) });
    const ses = await api.avatarSession({ encounter_id: "e" });
    expect(ses.ok).toBe(false);
    if (!ses.ok && "detail" in ses) expect(ses.detail.pending_launch).toBe(true);
    const offer = await api.avatarOffer("sess-123456", "v=0 offer");
    expect(offer.ok).toBe(true);
    const [, init] = fetchFn.mock.calls[1];
    expect((init?.headers as Record<string, string>)["X-User-Id"]).toBe("u1");
    expect(JSON.parse(String(init?.body))).toEqual({ session_id: "sess-123456", sdp: "v=0 offer", type: "offer" });
  });
});

describe("avatarPrepare", () => {
  it("asks the gateway to make the case's pictures before any call, signed in", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ state: "preparing" }), { status: 202 }));
    const api = createVoiceApi({ baseUrl: "/api", fetchFn: fetchFn as unknown as typeof fetch, identity: async () => ({ "X-User-Id": "u1" }) });
    const r = await api.avatarPrepare("thr-1", "p04");
    expect(r.ok).toBe(true);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/voice/avatar/prepare");
    expect(JSON.parse(String(init.body))).toEqual({ thread_id: "thr-1", photo_id: "p04" });
    expect((init.headers as Record<string, string>)["X-User-Id"]).toBe("u1");
  });
});
