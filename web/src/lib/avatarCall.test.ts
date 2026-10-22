import { describe, expect, it, vi } from "vitest";

import { crossCorrelation, crossCorrelationLag, mouthRegion, resample, selectedIcePath, sessionBody, utteranceSpan, waitForIce, playoutSample, receiverLagMs, highPass } from "@/lib/avatarCall";
import { createVoiceApi } from "@/lib/voiceApi";

describe("selectedIcePath", () => {
  it("reads the relay candidate and its TURN transport from the selected pair", () => {
    const rows: Record<string, Record<string, unknown>> = {
      T1: { id: "T1", type: "transport", selectedCandidatePairId: "P1" },
      P1: { id: "P1", type: "candidate-pair", state: "succeeded", localCandidateId: "L1", remoteCandidateId: "R1" },
      L1: { id: "L1", type: "local-candidate", candidateType: "relay", relayProtocol: "tls",
        url: "turns:turn.1-2-3-4.sslip.io:443?transport=tcp" },
      R1: { id: "R1", type: "remote-candidate", candidateType: "host" },
    };
    const report = { forEach: (cb: (r: Record<string, unknown>) => void) => Object.values(rows).forEach(cb), get: (id: string) => rows[id] };
    expect(selectedIcePath(report)).toEqual({ localType: "relay", relayProtocol: "tls",
      url: "turns:turn.1-2-3-4.sslip.io:443?transport=tcp", state: "succeeded" });
    expect(selectedIcePath({ forEach: () => {}, get: () => undefined })).toBeNull();
  });
});

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

describe("crossCorrelation and utteranceSpan (whole-line lip offset, live 2026-10-21)", () => {
  const env = (n: number, shift = 0) =>
    Array.from({ length: n }, (_, i) => Math.max(0, Math.sin(((i - shift) / (5 + ((i - shift + 40) % 13) / 3)) * Math.PI)));

  it("scores how much the lag can be trusted", () => {
    const voice = env(200);
    const strong = crossCorrelation(voice, env(200, 2), 40);
    expect(strong?.lagMs).toBe(80);
    expect(strong!.score).toBeGreaterThan(0.8);
    // a mouth that does not follow the voice (a picture switch mid-line, a wrong mouth box): low score
    const unrelated = Array.from({ length: 200 }, (_, i) => ((i * 7919) % 97) / 97);
    expect(crossCorrelation(voice, unrelated, 40)!.score).toBeLessThan(0.3);
  });

  it("spans a long reply to the end of its voice, not a guessed duration", () => {
    const samples = [] as { t: number; rms: number; motion: number; open: number }[];
    // 3 s of silence (the question being answered), 12.6 s of voice with short pauses, then silence
    for (let t = 0; t < 18_500; t += 40) {
      const speaking = t >= 3000 && t < 15_600 && Math.floor(t / 900) % 5 !== 0;
      samples.push({ t, rms: speaking ? 0.2 : 0, motion: 0, open: 0 });
    }
    const during = utteranceSpan(samples, 0, 14_000);
    expect(during.done).toBe(false);
    const after = utteranceSpan(samples, 0, 18_500);
    expect(after.first).toBe(3000);
    expect(after.last).toBeGreaterThan(15_000);
    expect(after.done).toBe(true);
    expect(utteranceSpan(samples, 16_000, 18_500)).toEqual({ first: null, last: null, done: false });
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

describe("waitForIce", () => {
  function fakePc() {
    const listeners: Record<string, ((e: unknown) => void)[]> = {};
    return {
      iceGatheringState: "gathering" as RTCIceGatheringState,
      addEventListener: (k: string, f: (e: unknown) => void) => { (listeners[k] ??= []).push(f); },
      removeEventListener: (k: string, f: (e: unknown) => void) => { listeners[k] = (listeners[k] ?? []).filter((x) => x !== f); },
      emit: (k: string, e: unknown) => (listeners[k] ?? []).forEach((f) => f(e)),
      count: (k: string) => (listeners[k] ?? []).length,
    };
  }

  it("goes on shortly after the first relay candidate instead of waiting for every TURN URL", async () => {
    vi.useFakeTimers();
    const pc = fakePc();
    let done = false;
    void waitForIce(pc as unknown as RTCPeerConnection, 4000, 300).then(() => { done = true; });
    pc.emit("icecandidate", { candidate: { type: "host", candidate: "candidate:1 1 udp 1 10.0.0.1 5000 typ host" } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(done).toBe(false); // a host candidate is not enough for a relay-only call
    pc.emit("icecandidate", { candidate: { type: "relay", candidate: "candidate:2 1 udp 1 1.2.3.4 49160 typ relay" } });
    await vi.advanceTimersByTimeAsync(299);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(done).toBe(true); // 1.3 s instead of the 4 s timeout
    expect(pc.count("icecandidate")).toBe(0);
    vi.useRealTimers();
  });

  it("still resolves on complete gathering or on the timeout", async () => {
    vi.useFakeTimers();
    const pc = fakePc();
    let done = false;
    void waitForIce(pc as unknown as RTCPeerConnection, 4000).then(() => { done = true; });
    pc.iceGatheringState = "complete";
    pc.emit("icegatheringstatechange", {});
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
    const pc2 = fakePc();
    let done2 = false;
    void waitForIce(pc2 as unknown as RTCPeerConnection, 4000).then(() => { done2 = true; });
    await vi.advanceTimersByTimeAsync(4001);
    expect(done2).toBe(true);
    vi.useRealTimers();
  });
});

describe("receiverLagMs", () => {
  const stats = (rows: Record<string, unknown>[]) => ({ forEach: (cb: (r: Record<string, unknown>) => void) => rows.forEach(cb) });

  it("reads the receive-side desync from the playout timestamps (picture newer than the voice = lips early)", () => {
    const cur = playoutSample(stats([
      { type: "inbound-rtp", kind: "audio", estimatedPlayoutTimestamp: 3_900_000_000_000, jitterBufferDelay: 2.6, jitterBufferEmittedCount: 10 },
      { type: "inbound-rtp", kind: "video", estimatedPlayoutTimestamp: 3_900_000_000_185, jitterBufferDelay: 1.5, jitterBufferEmittedCount: 10 },
      { type: "candidate-pair", nominated: true },
    ]));
    expect(receiverLagMs(null, cur)).toBe(-185);
  });

  it("falls back to the jitter-buffer delays over the last interval (video held longer = lips late)", () => {
    const prev = playoutSample(stats([
      { type: "inbound-rtp", kind: "audio", jitterBufferDelay: 10, jitterBufferEmittedCount: 100 },
      { type: "inbound-rtp", kind: "video", jitterBufferDelay: 5, jitterBufferEmittedCount: 50 },
    ]));
    const cur = playoutSample(stats([
      { type: "inbound-rtp", kind: "audio", jitterBufferDelay: 10 + 50 * 0.1, jitterBufferEmittedCount: 150 },
      { type: "inbound-rtp", kind: "video", jitterBufferDelay: 5 + 25 * 0.25, jitterBufferEmittedCount: 75 },
    ]));
    expect(receiverLagMs(prev, cur)).toBe(150);
    expect(receiverLagMs(null, cur)).toBeNull();
    expect(receiverLagMs(cur, cur)).toBeNull();
  });
});

describe("the lip meter on any portrait", () => {
  const env = (n: number, shift = 0) =>
    Array.from({ length: n }, (_, i) => Math.max(0, Math.sin(((i - shift) / (5 + ((i - shift + 40) % 13) / 3)) * Math.PI)));

  it("finds the lag of a mouth box that gets brighter as the mouth opens (teeth)", () => {
    const voice = env(200);
    const brighter = env(200, 3).map((v) => 1 - v);
    expect(crossCorrelation(voice, brighter, 40)!.score).toBeLessThan(0.3);   // the old meter: no lock
    const cc = crossCorrelation(highPass(voice), highPass(brighter), 40, 600, true);
    expect(cc?.lagMs).toBe(120);
    expect(cc!.score).toBeGreaterThan(0.6);
  });

  it("ignores a slow change in the mouth box (a crossfade to another picture mid-line)", () => {
    const voice = env(200);
    const open = env(200, -2).map((v, i) => 0.5 * v + (i > 100 ? 2 : 0));
    const cc = crossCorrelation(highPass(voice), highPass(open), 40, 600, true);
    expect(cc?.lagMs).toBe(-80);
    expect(cc!.score).toBeGreaterThan(0.5);
  });
});
