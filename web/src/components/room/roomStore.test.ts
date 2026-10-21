// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

// The relay is not running under Vitest: the store must work single-device.
vi.mock("@/lib/roomTransport", () => ({
  connectRoom: vi.fn(),
  disconnect: vi.fn(),
  relayAvailable: () => false,
  sendSnapshot: vi.fn(),
}));

import * as roomData from "@/data/rooms";
import type { CaseInstance } from "@/domain/case";
import { createRoom, familyForRoomCase, getRoomsState, joinByCode } from "./roomStore";

const generated = {
  id: "gen-1",
  chiefComplaint: { en: "Fever and cough", tr: "Ateş ve öksürük" },
  acuityESI: 3,
} as unknown as CaseInstance;

describe("rooms lobby (no seed data in shipped paths)", () => {
  it("exports no example rooms, people, floor or debrief marks", () => {
    const names = Object.keys(roomData);
    for (const gone of ["rooms", "getRoom", "acsFloor", "acsDebrief"]) expect(names).not.toContain(gone);
    expect(roomData.ME.name).toBe("You");
    expect(roomData.ME.affiliation).toBeUndefined();
  });

  it("starts with an empty lobby", () => {
    const s = getRoomsState();
    expect(s.order).toEqual([]);
    expect(Object.keys(s.runtimes)).toEqual([]);
  });

  it("an unknown code joins nothing when no relay is reachable", async () => {
    await expect(joinByCode("ACS-7K2")).resolves.toBeNull();
    expect(getRoomsState().order).toEqual([]);
  });

  it("a created room is the only room listed, with an empty floor", () => {
    const id = createRoom({
      caseId: "room-fever", humanRoles: ["doctor"], aiBackfill: true, locale: "en",
      caseInstance: generated, threadId: "th-1",
    });
    const s = getRoomsState();
    expect(s.order).toEqual([id]);
    expect(s.runtimes[id].floor).toEqual([]);
    expect(s.runtimes[id].room.seats.filter((seat) => seat.holder?.kind === "human")).toHaveLength(1);
  });

  it("reads the requested family back from the room's case key", () => {
    expect(familyForRoomCase("room-chest-pain")).toBe("chest-pain");
    expect(familyForRoomCase("room-any")).toBeUndefined();
    expect(familyForRoomCase("em-acs-001")).toBeUndefined();
  });
});
