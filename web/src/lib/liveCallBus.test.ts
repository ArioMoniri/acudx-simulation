import { beforeEach, describe, expect, it } from "vitest";
import {
  consumeServerSpoken,
  lastSent,
  liveCallFor,
  markSent,
  markServerSpoken,
  registerLiveCall,
  resetLiveCallBus,
} from "@/lib/liveCallBus";

describe("liveCallBus", () => {
  beforeEach(() => resetLiveCallBus());

  it("offers the live call only while its voice is on, and forgets it on unregister", () => {
    let voice = true;
    const off = registerLiveCall({ threadId: "thr-1", sessionId: "ses-1", voiceOn: () => voice });
    expect(liveCallFor("thr-1")).toBe("ses-1");
    expect(liveCallFor("thr-2")).toBeNull();
    expect(liveCallFor(null)).toBeNull();
    voice = false;
    expect(liveCallFor("thr-1")).toBeNull();
    voice = true;
    off();
    expect(liveCallFor("thr-1")).toBeNull();
  });

  it("a newer call on the same thread is not removed by the older one's unregister", () => {
    const offOld = registerLiveCall({ threadId: "thr-1", sessionId: "old", voiceOn: () => true });
    registerLiveCall({ threadId: "thr-1", sessionId: "new", voiceOn: () => true });
    offOld();
    expect(liveCallFor("thr-1")).toBe("new");
  });

  it("a reply the server spoke is consumed once, matched on the words (Turkish included)", () => {
    const reply = "Dün öğleden sonra başladı doktor bey,  başımın sağ tarafında. Işığa bakınca gözüm yanıyor; ğüşiöçİ.";
    markServerSpoken(reply, { sentAt: 1234, sessionId: "ses-1" });
    expect(consumeServerSpoken(reply.replace("  ", " "))).toEqual({ sentAt: 1234, sessionId: "ses-1" });
    expect(consumeServerSpoken(reply)).toBeNull();
    // decomposed Unicode (e.g. pasted text) is the same line
    markServerSpoken("şikâyet", { sentAt: 1, sessionId: "s" });
    expect(consumeServerSpoken("şikâyet".normalize("NFD"))).not.toBeNull();
  });

  it("remembers when the question was sent per thread", () => {
    markSent("thr-1", 42);
    expect(lastSent("thr-1")).toBe(42);
    expect(lastSent("thr-9")).toBeNull();
  });
});
