import { describe, it, expect, vi } from "vitest";
import {
  buildTtsBody,
  createVoiceApi,
  firstAudioLatency,
  parseTtsHeaders,
  pickPlaybackStrategy,
} from "@/lib/voiceApi";

type Call = { url: string; init: RequestInit };

function fakeFetch(responses: Array<{ status: number; body?: unknown; headers?: Record<string, string>; raw?: BodyInit }>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    const next = responses.shift() ?? { status: 200, body: {} };
    const headers = { "content-type": "application/json", ...(next.headers ?? {}) };
    const body = next.raw !== undefined ? next.raw : next.body === undefined ? null : JSON.stringify(next.body);
    return new Response(body, { status: next.status, headers });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const base = "http://gateway.test/api";

describe("buildTtsBody", () => {
  it("normalizes language, clamps age and text, defaults to mp3", () => {
    const body = buildTtsBody({ text: " Merhaba ".padEnd(1400, "x"), lang: "tr-TR", sex: "female", age: 67.6 });
    expect(body.lang).toBe("tr");
    expect(body.age).toBe(68);
    expect(body.format).toBe("mp3");
    expect((body.text as string).length).toBe(1200);
    expect(body.voice_id).toBeUndefined();
  });
  it("passes an explicit voice id and a clamped speed", () => {
    const body = buildTtsBody({ text: "hi", lang: "en", sex: "male", age: 30, voiceId: "v1", speed: 3 });
    expect(body.voice_id).toBe("v1");
    expect(body.speed).toBe(2);
  });
});

describe("parseTtsHeaders", () => {
  it("reads provenance and duration, tolerating missing values", () => {
    const h = new Headers({
      "content-type": "audio/wav; charset=binary",
      "x-audio-duration-ms": "500",
      "x-voice-provider": "gpu-worker",
      "x-voice-adapter": "openai_compatible",
      "x-voice-model": "chatterbox-multilingual",
      "x-voice-source": "gpu_worker",
      "x-voice-id": "acudx_tr_female",
      "x-voice-ttfb-ms": "180",
    });
    expect(parseTtsHeaders(h)).toEqual({
      contentType: "audio/wav",
      durationMs: 500,
      provider: "gpu-worker",
      adapter: "openai_compatible",
      model: "chatterbox-multilingual",
      source: "gpu_worker",
      voiceId: "acudx_tr_female",
      ttfbMs: 180,
    });
    const bare = parseTtsHeaders(new Headers());
    expect(bare.contentType).toBe("audio/mpeg");
    expect(bare.durationMs).toBeNull();
    expect(bare.provider).toBeNull();
  });
});

describe("pickPlaybackStrategy", () => {
  const env = (hasMediaSource: boolean, supported: boolean) => ({
    hasMediaSource,
    isTypeSupported: () => supported,
  });
  it("streams MP3 through MediaSource when the browser supports it", () => {
    expect(pickPlaybackStrategy("audio/mpeg", env(true, true))).toBe("mediasource");
    expect(pickPlaybackStrategy("audio/mpeg; codecs=mp3", env(true, true))).toBe("mediasource");
  });
  it("falls back to a chunked blob for WAV, unsupported codecs or no MediaSource", () => {
    expect(pickPlaybackStrategy("audio/wav", env(true, true))).toBe("blob");
    expect(pickPlaybackStrategy("audio/mpeg", env(true, false))).toBe("blob");
    expect(pickPlaybackStrategy("audio/mpeg", env(false, true))).toBe("blob");
    expect(pickPlaybackStrategy("audio/mpeg", { hasMediaSource: true, isTypeSupported: () => { throw new Error("x"); } })).toBe("blob");
  });
});

describe("firstAudioLatency", () => {
  it("rounds and never goes negative", () => {
    expect(firstAudioLatency(100, 523.4)).toBe(423);
    expect(firstAudioLatency(100, 90)).toBe(0);
  });
});

describe("createVoiceApi", () => {
  it("fetches capabilities", async () => {
    const caps = { airgapped: true, tts: { enabled: false }, stt: { enabled: false }, avatar: { enabled: false } };
    const { fn, calls } = fakeFetch([{ status: 200, body: caps }]);
    const api = createVoiceApi({ baseUrl: base, fetchFn: fn });
    const r = await api.capabilities();
    expect(r).toEqual({ ok: true, data: caps });
    expect(calls[0].url).toBe(`${base}/v1/voice/capabilities`);
    expect(calls[0].init.method).toBe("GET");
  });

  it("posts the recording as multipart with a language hint", async () => {
    const stt = { text: "Göğsüm ağrıyor", language: "tr", confidence: 0.9, provider: "dg" };
    const { fn, calls } = fakeFetch([{ status: 200, body: stt }]);
    const api = createVoiceApi({ baseUrl: base, fetchFn: fn });
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
    const r = await api.transcribe(blob, { lang: "tr-TR" });
    expect(r.ok).toBe(true);
    expect(calls[0].url).toBe(`${base}/v1/voice/stt`);
    const fd = calls[0].init.body as FormData;
    expect(fd.get("lang")).toBe("tr");
    const file = fd.get("file") as File;
    expect(file.name).toBe("dictation.webm");
    expect(file.size).toBe(3);
  });

  it("maps a 503 on synthesize to 'unavailable' with the gateway's reasons", async () => {
    const { fn } = fakeFetch([{ status: 503, body: { error: "tts_unavailable", reasons: ["eleven: refused by AIRGAPPED"] } }]);
    const api = createVoiceApi({ baseUrl: base, fetchFn: fn });
    const r = await api.synthesize({ text: "hi", lang: "en", sex: "male", age: 40 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("unavailable");
      expect(r.reasons).toEqual(["eleven: refused by AIRGAPPED"]);
    }
  });

  it("tells a booting worker (pending_launch) from a permanent refusal on a 503", async () => {
    const { fn } = fakeFetch([
      { status: 503, body: { error: "tts_unavailable", airgapped: false, pending_launch: true, reasons: ["gpu-worker: starting"] } },
      { status: 503, body: { error: "tts_unavailable", airgapped: true, pending_launch: false, reasons: [] } },
    ]);
    const api = createVoiceApi({ baseUrl: base, fetchFn: fn });
    const booting = await api.synthesize({ text: "hi", lang: "en", sex: "male", age: 40 });
    const refused = await api.synthesize({ text: "hi", lang: "en", sex: "male", age: 40 });
    expect(booting).toMatchObject({ ok: false, error: "unavailable", pendingLaunch: true, airgapped: false });
    expect(refused).toMatchObject({ ok: false, error: "unavailable", pendingLaunch: false, airgapped: true });
  });

  it("wakes the GPU worker with a signed POST /v1/voice/warm", async () => {
    const { fn, calls } = fakeFetch([{ status: 200, body: { ready: false, pending_launch: true, refusal: null } }]);
    const api = createVoiceApi({ baseUrl: base, fetchFn: fn, identity: async () => ({ "X-User-Id": "stu-7" }) });
    const r = await api.warm();
    expect(r).toEqual({ ok: true, data: { ready: false, pending_launch: true, refusal: null } });
    expect(calls[0].url).toBe(`${base}/v1/voice/warm`);
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.headers as Record<string, string>)["X-User-Id"]).toBe("stu-7");
  });

  it("returns the streaming response and parsed headers on success", async () => {
    const { fn, calls } = fakeFetch([
      { status: 200, raw: new Uint8Array([0xff, 0xfb, 0x90]), headers: { "content-type": "audio/mpeg", "x-voice-provider": "eleven", "x-voice-ttfb-ms": "95" } },
    ]);
    const api = createVoiceApi({ baseUrl: base, fetchFn: fn });
    const r = await api.synthesize({ text: "Merhaba", lang: "tr", sex: "female", age: 70 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.meta.provider).toBe("eleven");
      expect(r.meta.ttfbMs).toBe(95);
      expect(r.meta.contentType).toBe("audio/mpeg");
      expect(new Uint8Array(await r.response.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xfb, 0x90]));
    }
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ text: "Merhaba", lang: "tr", sex: "female", age: 70, format: "mp3" });
  });

  it("maps other HTTP failures and network errors without throwing", async () => {
    const { fn } = fakeFetch([{ status: 502, body: { error: "upstream" } }]);
    const api = createVoiceApi({ baseUrl: base, fetchFn: fn });
    const r = await api.synthesize({ text: "hi", lang: "en", sex: "male", age: 40 });
    expect(r).toEqual({ ok: false, error: "http_502", status: 502 });
    const boom = vi.fn(async () => { throw new TypeError("offline"); }) as unknown as typeof fetch;
    const api2 = createVoiceApi({ baseUrl: base, fetchFn: boom });
    expect(await api2.capabilities()).toEqual({ ok: false, error: "network" });
  });

  it("requests a room token for an encounter", async () => {
    const tok = { url: "wss://lk", token: "jwt", room: "acudx-abc", identity: "learner-1", renderer: "simli", ttl_s: 900 };
    const { fn, calls } = fakeFetch([{ status: 200, body: tok }]);
    const api = createVoiceApi({ baseUrl: base, fetchFn: fn });
    const r = await api.roomToken("enc-1", { name: "Learner" });
    expect(r).toEqual({ ok: true, data: tok });
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ encounter_id: "enc-1", name: "Learner" });
  });
});
