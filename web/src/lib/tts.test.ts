import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The server path hands the response to playTtsStream; a stand-in reports first audio and ends at once.
vi.mock("@/lib/voiceApi", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/voiceApi")>();
  return {
    ...mod,
    playTtsStream: (_res: Response, _a: HTMLAudioElement, opts: { onFirstAudio?: (ms: number) => void }) => {
      opts.onFirstAudio?.(42);
      return { strategy: "blob" as const, done: Promise.resolve() };
    },
  };
});

import {
  configureTts,
  estimateSpeechMs,
  lastSpeechEngine,
  pickBrowserVoice,
  resetTtsForTests,
  speakAsPatient,
  ttsMaybeAvailable,
  unlockTts,
  type SpeechEngine,
} from "@/lib/tts";
import type { TtsResult, VoiceApi } from "@/lib/voiceApi";

class FakeAudio {
  preload = "";
  crossOrigin = "";
  muted = false;
  src = "";
  currentTime = 0;
  play() {
    return Promise.resolve();
  }
  pause() {}
  addEventListener() {}
  removeEventListener() {}
}

class FakeUtterance {
  lang = "";
  voice: unknown = null;
  pitch = 1;
  rate = 1;
  volume = 1;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}

type Voice = { name: string; lang: string; localService: boolean; default: boolean };

let spoken: FakeUtterance[] = [];
let voices: Voice[] = [];

function installBrowser() {
  spoken = [];
  voices = [
    { name: "Microsoft Ahmet Online (Natural) - Turkish (Turkey)", lang: "tr-TR", localService: false, default: false },
    { name: "Microsoft Emel Online (Natural) - Turkish (Turkey)", lang: "tr-TR", localService: false, default: false },
    { name: "Samantha", lang: "en-US", localService: true, default: true },
    { name: "Google UK English Male", lang: "en-GB", localService: false, default: false },
  ];
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  vi.stubGlobal("speechSynthesis", {
    speak: (u: FakeUtterance) => {
      spoken.push(u);
      queueMicrotask(() => u.onstart?.());
    },
    cancel: () => {},
    pause: () => {},
    resume: () => {},
    getVoices: () => voices,
  });
}

function fakeApi(results: TtsResult[]) {
  const calls: string[] = [];
  const api = {
    synthesize: async (req: { text: string }) => {
      calls.push(req.text);
      return results.shift() ?? { ok: false, error: "network" };
    },
  } as unknown as VoiceApi;
  return { api, calls };
}

const ok = (): TtsResult => ({
  ok: true,
  response: new Response(new Uint8Array([1])),
  meta: { contentType: "audio/mpeg", durationMs: 900, provider: "gpu-worker", adapter: null, model: null, source: "gpu_worker", voiceId: null, ttfbMs: 10 },
});
const pending = (): TtsResult => ({ ok: false, error: "unavailable", status: 503, pendingLaunch: true, airgapped: false });
const refused = (): TtsResult => ({ ok: false, error: "unavailable", status: 503, pendingLaunch: false, airgapped: true });

async function say(text: string, lang = "tr", sex: "male" | "female" = "female") {
  const starts: SpeechEngine[] = [];
  const ended = vi.fn();
  const began = await speakAsPatient(text, { lang, sex, age: 60, onStart: (_ms, engine) => starts.push(engine), onEnded: ended });
  await Promise.resolve();
  await Promise.resolve();
  return { began, starts, ended };
}

describe("speakAsPatient while the GPU worker boots", () => {
  beforeEach(() => {
    resetTtsForTests();
    installBrowser();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("speaks with the browser on a pending 503, keeps asking, and switches to the server once ready", async () => {
    const { api, calls } = fakeApi([pending(), ok()]);
    configureTts(api);
    const first = await say("Göğsüm ağrıyor");
    expect(first.began).toBe(true);
    expect(first.starts).toEqual(["browser"]);
    expect(spoken).toHaveLength(1);
    expect(spoken[0].lang).toBe("tr-TR");
    expect((spoken[0].voice as Voice).name).toContain("Emel");
    // The clip keeps playing until the speech really ends.
    expect(first.ended).not.toHaveBeenCalled();
    spoken[0].onend?.();
    expect(first.ended).toHaveBeenCalledTimes(1);
    expect(ttsMaybeAvailable()).toBe(true); // pending never latches

    const second = await say("Daha iyiyim");
    expect(calls).toEqual(["Göğsüm ağrıyor", "Daha iyiyim"]);
    expect(second.starts).toEqual(["server"]);
    expect(lastSpeechEngine()).toBe("server");
    expect(spoken).toHaveLength(1);
  });

  it("stops asking the gateway only after a permanent refusal, and the browser still speaks", async () => {
    const { api, calls } = fakeApi([refused(), ok()]);
    configureTts(api);
    await say("Hello", "en", "male");
    expect(ttsMaybeAvailable()).toBe(false);
    const again = await say("Still here", "en", "male");
    expect(calls).toEqual(["Hello"]);
    expect(again.starts).toEqual(["browser"]);
    expect((spoken[1].voice as Voice).name).toBe("Google UK English Male");
  });

  it("falls back to the browser on a network error or timeout without latching", async () => {
    const { api } = fakeApi([{ ok: false, error: "timeout" }]);
    configureTts(api);
    const r = await say("Nefes alamıyorum");
    expect(r.starts).toEqual(["browser"]);
    expect(ttsMaybeAvailable()).toBe(true);
  });

  it("returns false (text-timed animation) when neither the gateway nor the browser can speak", async () => {
    vi.stubGlobal("speechSynthesis", undefined);
    const { api } = fakeApi([pending()]);
    configureTts(api);
    const r = await say("Merhaba");
    expect(r.began).toBe(false);
  });

  it("primes the browser speech once inside the unlocking gesture", () => {
    unlockTts();
    unlockTts();
    expect(spoken).toHaveLength(1);
    expect(spoken[0].volume).toBe(0);
  });
});

describe("pickBrowserVoice", () => {
  const list: Voice[] = [
    { name: "Microsoft Ahmet - Turkish (Turkey)", lang: "tr-TR", localService: true, default: false },
    { name: "Microsoft Emel - Turkish (Turkey)", lang: "tr-TR", localService: true, default: false },
    { name: "Microsoft Zira - English (United States)", lang: "en-US", localService: true, default: true },
    { name: "Microsoft David - English (United States)", lang: "en-US", localService: true, default: false },
    { name: "Google US English", lang: "en_US", localService: false, default: false },
  ];

  it("matches the case language and the patient's sex", () => {
    expect(pickBrowserVoice(list, "tr", "female")?.name).toContain("Emel");
    expect(pickBrowserVoice(list, "tr", "male")?.name).toContain("Ahmet");
    expect(pickBrowserVoice(list, "en", "female")?.name).toContain("Zira");
    expect(pickBrowserVoice(list, "en-GB", "male")?.name).toContain("David");
  });

  it("prefers a same-language voice of unknown sex over one of the other sex", () => {
    const enOnly = [list[2], list[4]];
    expect(pickBrowserVoice(enOnly, "en", "male")?.name).toBe("Google US English");
  });

  it("returns null when no installed voice speaks the language", () => {
    expect(pickBrowserVoice(list.slice(2), "tr", "female")).toBeNull();
  });

  it("estimates a spoken length with a floor", () => {
    expect(estimateSpeechMs("Evet")).toBe(1200);
    expect(estimateSpeechMs("x".repeat(100))).toBe(7500);
  });
});
