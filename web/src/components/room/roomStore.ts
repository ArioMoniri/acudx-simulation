/**
 * AcuDx — multiplayer room store (Journey 6, the moat).
 *
 * A dependency-free reactive store (React `useSyncExternalStore`, the same
 * pattern as `src/state/encounterStore.ts`) that turns the static room fixtures
 * into a genuinely INTERACTIVE mock: create + join rooms, take / leave seats,
 * toggle AI backfill, raise a hand, grant + pass the floor, post floor turns,
 * close communication loops, and drive the room through its lifecycle phases.
 *
 * There is still NO real transport here. Production rides a self-hosted LiveKit
 * WebRTC room (docs/research/02, arch/07); this store is the believable local
 * projection every screen reads. All floor content is authored bilingual, the
 * same as the seed transcript in `data/rooms.ts`, so nothing here needs the UI
 * i18n bundle. AI-held seats stay first-class and always labelled (Art. 50).
 *
 * Education only. No real patient data path.
 */

import { useSyncExternalStore } from "react";
import {
  rooms as SEED_ROOMS,
  acsFloor,
  ME,
  CLINICAL_ROLE_ORDER,
  type Room,
  type Seat,
  type ClinicalRole,
  type RoomStatus,
  type RoomLocale,
  type FloorEvent,
  type FloorEventKind,
} from "@/data/rooms";
import type { Bilingual } from "@/data/mock";
import { getSeedCase } from "@/data/seedCases";

/* -------------------------------------------------------------------------- */
/* Runtime shapes                                                              */
/* -------------------------------------------------------------------------- */

/** Everything mutable about one live room. */
export interface RoomRuntime {
  room: Room;
  /** Running floor transcript (newest appended last). */
  floor: FloorEvent[];
  /** Roles whose holder has raised a hand, in raise order. */
  hands: ClinicalRole[];
  /** The role the team lead has granted the floor to (null = ambient turn). */
  floorHolder: ClinicalRole | null;
  /** Which seat THIS device holds (role), or null when only observing. */
  mine: ClinicalRole | null;
  /** Closed-loop confirmations this device completed (debrief signal). */
  loopsClosedByMe: number;
}

interface StoreState {
  /** Lobby order (created rooms are prepended). */
  order: string[];
  runtimes: Record<string, RoomRuntime>;
}

/* -------------------------------------------------------------------------- */
/* Clock offsets for posted floor turns (mm:ss, deterministic)                 */
/* -------------------------------------------------------------------------- */

function parseOffset(mmss: string): number {
  const [m, s] = mmss.split(":").map((n) => Number.parseInt(n, 10));
  return (Number.isFinite(m) ? m : 0) * 60 + (Number.isFinite(s) ? s : 0);
}

function formatOffset(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** The next turn lands ~22s after the latest one on the floor. */
function nextOffset(floor: FloorEvent[]): string {
  const last = floor[floor.length - 1];
  const base = last ? parseOffset(last.at) : 0;
  return formatOffset(base + 22);
}

/* -------------------------------------------------------------------------- */
/* Seat + room builders (pure)                                                 */
/* -------------------------------------------------------------------------- */

function cloneSeat(seat: Seat): Seat {
  return { role: seat.role, holder: seat.holder, ready: seat.ready, teamLead: seat.teamLead };
}

function cloneRoom(room: Room): Room {
  return { ...room, seats: room.seats.map(cloneSeat) };
}

/** Which role (if any) this device currently sits in. */
function deriveMine(room: Room): ClinicalRole | null {
  return room.seats.find((s) => s.holder?.id === ME.id)?.role ?? null;
}

let joinCounter = 0;
function makeJoinCode(caseId: string): string {
  const stem = (caseId.split("-")[1] ?? "rm").toUpperCase().slice(0, 3);
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let tail = "";
  for (let i = 0; i < 3; i += 1) {
    tail += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `${stem}-${tail}${(joinCounter += 1) % 10}`;
}

let roomCounter = 0;

/**
 * A short, believable opening floor for a freshly created room: a structured
 * prehospital handover keyed to the case, then the lead's first order awaiting a
 * closed-loop read-back. The ACS drill reuses its richer authored transcript.
 */
function starterFloor(caseId: string, chiefComplaint: Bilingual): FloorEvent[] {
  if (caseId === "em-acs-001") return acsFloor.map((e) => ({ ...e }));
  return [
    {
      id: `${caseId}-h1`,
      role: "paramedic",
      ai: true,
      kind: "handover",
      at: "00:18",
      text: {
        en: `Structured scene handover: ${chiefComplaint.en}. Vitals and timeline passed to the team, IV access in place.`,
        tr: `Yapılandırılmış olay yeri devri: ${chiefComplaint.tr}. Vital bulgular ve zaman çizelgesi ekibe aktarıldı, damar yolu açık.`,
      },
    },
    {
      id: `${caseId}-o1`,
      role: "doctor",
      ai: false,
      kind: "order",
      at: "00:55",
      text: {
        en: "Put the patient on the monitor and start the first-line orders. Please confirm.",
        tr: "Hastayı monitöre bağlayın ve ilk basamak istemleri başlatın. Lütfen onaylayın.",
      },
      loop: "open",
    },
  ];
}

function buildSeats(
  humanRoles: ClinicalRole[],
): { seats: Seat[]; mine: ClinicalRole | null } {
  // This device (the creator) takes the first requested human role; the rest of
  // the human roles open as seats a teammate can take; unlisted roles are left
  // empty so AI backfill can hold them.
  const myRole = CLINICAL_ROLE_ORDER.find((r) => humanRoles.includes(r)) ?? null;
  const seats = CLINICAL_ROLE_ORDER.map<Seat>((role) => {
    if (role === myRole) {
      return { role, holder: ME, ready: true, teamLead: true };
    }
    return { role, holder: null, ready: false, teamLead: false };
  });
  return { seats, mine: myRole };
}

/* -------------------------------------------------------------------------- */
/* Store internals                                                             */
/* -------------------------------------------------------------------------- */

function seedState(): StoreState {
  const runtimes: Record<string, RoomRuntime> = {};
  const order: string[] = [];
  for (const seed of SEED_ROOMS) {
    const room = cloneRoom(seed);
    runtimes[room.id] = {
      room,
      floor: starterFloor(room.caseId, room.chiefComplaint),
      hands: [],
      floorHolder: null,
      mine: deriveMine(room),
      loopsClosedByMe: 0,
    };
    order.push(room.id);
  }
  return { order, runtimes };
}

let state: StoreState = seedState();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/** Replace one room's runtime immutably and notify subscribers. */
function patch(id: string, next: Partial<RoomRuntime>): void {
  const current = state.runtimes[id];
  if (!current) return;
  const merged: RoomRuntime = { ...current, ...next };
  // Keep `mine` in lockstep with seat holders whenever seats changed.
  if (next.room) merged.mine = deriveMine(next.room);
  state = { ...state, runtimes: { ...state.runtimes, [id]: merged } };
  emit();
}

function withSeats(room: Room, map: (seat: Seat) => Seat): Room {
  return { ...room, seats: room.seats.map(map) };
}

/* -------------------------------------------------------------------------- */
/* Actions — lobby                                                             */
/* -------------------------------------------------------------------------- */

/** Create a room from the dialog config and return its new id. */
export function createRoom(config: {
  caseId: string;
  humanRoles: ClinicalRole[];
  aiBackfill: boolean;
  locale?: RoomLocale;
}): string {
  const seedCase = getSeedCase(config.caseId);
  const chiefComplaint: Bilingual =
    seedCase?.chiefComplaint ?? { en: "Undifferentiated presentation", tr: "Ayrımlaşmamış tablo" };
  const id = `local-${config.caseId}-${(roomCounter += 1)}`;
  const { seats, mine } = buildSeats(
    config.humanRoles.length ? config.humanRoles : ["doctor"],
  );
  const room: Room = {
    id,
    title: {
      en: `Team drill: ${chiefComplaint.en}`,
      tr: `Ekip provası: ${chiefComplaint.tr}`,
    },
    caseId: config.caseId,
    chiefComplaint,
    status: "open",
    locale: config.locale ?? "tr",
    host: ME,
    joinCode: makeJoinCode(config.caseId),
    aiBackfill: config.aiBackfill,
    acuityESI: seedCase?.acuityESI ?? 3,
    seats,
  };
  const runtime: RoomRuntime = {
    room,
    floor: starterFloor(config.caseId, chiefComplaint),
    hands: [],
    floorHolder: null,
    mine,
    loopsClosedByMe: 0,
  };
  state = {
    order: [id, ...state.order],
    runtimes: { ...state.runtimes, [id]: runtime },
  };
  emit();
  return id;
}

/** The first seat a teammate can take (an open seat, else an AI-held one). */
function firstAvailableSeat(room: Room): ClinicalRole | null {
  const target =
    room.seats.find((s) => s.holder == null) ??
    room.seats.find((s) => s.holder?.kind === "ai");
  return target?.role ?? null;
}

/**
 * Seat this device into an available seat of a room it is not yet in (no-op when
 * already seated, or when every seat is held by a human).
 */
export function joinRoom(id: string): void {
  const rt = state.runtimes[id];
  if (!rt || rt.mine != null) return;
  const role = firstAvailableSeat(rt.room);
  if (role) takeSeat(id, role);
}

/**
 * Resolve a join code to a room id and seat this device into the first seat a
 * teammate can take (an open or AI-held seat). Returns null for an unknown code.
 */
export function joinByCode(code: string): string | null {
  const wanted = code.trim().toUpperCase();
  if (!wanted) return null;
  const id = state.order.find(
    (rid) => state.runtimes[rid]?.room.joinCode.toUpperCase() === wanted,
  );
  if (!id) return null;
  joinRoom(id);
  return id;
}

/* -------------------------------------------------------------------------- */
/* Actions — seats                                                             */
/* -------------------------------------------------------------------------- */

/** Move this device into a seat, vacating any seat it already held. */
export function takeSeat(id: string, role: ClinicalRole): void {
  const rt = state.runtimes[id];
  if (!rt) return;
  const room = withSeats(rt.room, (seat) => {
    if (seat.role === role) return { ...seat, holder: ME, ready: true };
    if (seat.holder?.id === ME.id) return { ...seat, holder: null, ready: false };
    return seat;
  });
  patch(id, { room });
}

/** Vacate the seat this device holds (AI backfill can pick it up on render). */
export function leaveSeat(id: string): void {
  const rt = state.runtimes[id];
  if (!rt) return;
  const room = withSeats(rt.room, (seat) =>
    seat.holder?.id === ME.id ? { ...seat, holder: null, ready: false } : seat,
  );
  patch(id, { room });
}

/** Flip the ready-check on a seat (only meaningful for a human-held seat). */
export function toggleReady(id: string, role: ClinicalRole): void {
  const rt = state.runtimes[id];
  if (!rt) return;
  const room = withSeats(rt.room, (seat) =>
    seat.role === role ? { ...seat, ready: !seat.ready } : seat,
  );
  patch(id, { room });
}

/** Turn AI backfill for empty seats on or off. */
export function setBackfill(id: string, on: boolean): void {
  const rt = state.runtimes[id];
  if (!rt) return;
  patch(id, { room: { ...rt.room, aiBackfill: on } });
}

/** Move the team-lead hat onto one role (worn atop the clinical seat). */
export function claimLead(id: string, role: ClinicalRole): void {
  const rt = state.runtimes[id];
  if (!rt) return;
  const room = withSeats(rt.room, (seat) => ({ ...seat, teamLead: seat.role === role }));
  patch(id, { room });
}

/* -------------------------------------------------------------------------- */
/* Actions — floor / turn control                                             */
/* -------------------------------------------------------------------------- */

/** Raise a hand for a role (idempotent; a seat holding the floor is skipped). */
export function raiseHand(id: string, role: ClinicalRole): void {
  const rt = state.runtimes[id];
  if (!rt || rt.floorHolder === role || rt.hands.includes(role)) return;
  patch(id, { hands: [...rt.hands, role] });
}

/** Lower a previously raised hand. */
export function lowerHand(id: string, role: ClinicalRole): void {
  const rt = state.runtimes[id];
  if (!rt) return;
  patch(id, { hands: rt.hands.filter((r) => r !== role) });
}

/** Grant the floor to a role, clearing its raised hand. */
export function grantFloor(id: string, role: ClinicalRole): void {
  const rt = state.runtimes[id];
  if (!rt) return;
  patch(id, { floorHolder: role, hands: rt.hands.filter((r) => r !== role) });
}

/** Release the floor back to ambient turn-taking. */
export function passFloor(id: string): void {
  const rt = state.runtimes[id];
  if (!rt) return;
  patch(id, { floorHolder: null });
}

/** Append a floor turn (id + clock offset filled in for the caller). */
export function postFloorEvent(
  id: string,
  ev: {
    role: ClinicalRole;
    ai: boolean;
    kind: FloorEventKind;
    text: Bilingual;
    loop?: "open" | "closed";
    lockedToken?: string;
  },
): void {
  const rt = state.runtimes[id];
  if (!rt) return;
  const full: FloorEvent = {
    id: `${id}-e${rt.floor.length + 1}`,
    at: nextOffset(rt.floor),
    ...ev,
  };
  patch(id, { floor: [...rt.floor, full] });
}

/** Escalate up the chain (SBAR) — posts a structured escalation turn. */
export function escalateFloor(id: string, role: ClinicalRole, ai = false): void {
  postFloorEvent(id, {
    role,
    ai,
    kind: "escalate",
    text: {
      en: "SBAR escalation: the patient is not improving on the current plan. I need a senior review at the bedside now.",
      tr: "SBAR yükseltme: hasta mevcut planla düzelmiyor. Şimdi başucunda kıdemli değerlendirmesi istiyorum.",
    },
  });
}

/** Delegate a task (team lead) — posts a named assignment to the floor. */
export function delegateFloor(id: string, role: ClinicalRole, ai = false): void {
  postFloorEvent(id, {
    role,
    ai,
    kind: "handover",
    text: {
      en: "Task assignment: nurse takes monitoring and access, paramedic keeps the timeline. Read back your tasks.",
      tr: "Görev dağılımı: hemşire monitörizasyon ve damar yolunu alsın, paramedik zaman çizelgesini tutsun. Görevlerinizi geri okuyun.",
    },
    loop: "open",
  });
}

/** Prompt the doctor — a non-ordering seat flags a concern (logged as evidence). */
export function promptDoctorFloor(id: string, role: ClinicalRole, ai = false): void {
  postFloorEvent(id, {
    role,
    ai,
    kind: "escalate",
    text: {
      en: "Flagging for the doctor: my findings suggest we should reassess the plan. Requesting a decision.",
      tr: "Doktora bildiriyorum: bulgularım planı yeniden değerlendirmemiz gerektiğini gösteriyor. Karar bekliyorum.",
    },
  });
}

/**
 * Close an open communication loop: flip the order to confirmed, append a
 * verbatim read-back turn from the acknowledging seat, and (when a human did it)
 * bank the closed loop as a leadership signal for the debrief.
 */
export function closeLoop(id: string, eventId: string): void {
  const rt = state.runtimes[id];
  if (!rt) return;
  const target = rt.floor.find((e) => e.id === eventId);
  if (!target) return;
  const byRole: ClinicalRole = rt.mine ?? "nurse";
  const byHuman = rt.mine != null;
  const readbackText: Bilingual = target.lockedToken
    ? {
        en: `Read-back: ${target.lockedToken}, confirmed.`,
        tr: `Geri okuma: ${target.lockedToken}, onaylandı.`,
      }
    : {
        en: "Read-back: order confirmed and actioned.",
        tr: "Geri okuma: istem onaylandı ve uygulandı.",
      };
  const readback: FloorEvent = {
    id: `${id}-rb${rt.floor.length + 1}`,
    role: byRole,
    ai: !byHuman,
    kind: "readback",
    at: nextOffset(rt.floor),
    text: readbackText,
    loop: "closed",
  };
  const floor = rt.floor.map((e) =>
    e.id === eventId ? { ...e, loop: "closed" as const } : e,
  );
  patch(id, {
    floor: [...floor, readback],
    loopsClosedByMe: rt.loopsClosedByMe + (byHuman ? 1 : 0),
  });
}

/* -------------------------------------------------------------------------- */
/* Actions — lifecycle                                                         */
/* -------------------------------------------------------------------------- */

/** Move the room through its lifecycle (open -> in-progress -> debrief). */
export function setPhase(id: string, status: RoomStatus): void {
  const rt = state.runtimes[id];
  if (!rt) return;
  const next: Partial<RoomRuntime> = { room: { ...rt.room, status } };
  if (status === "debrief") {
    next.hands = [];
    next.floorHolder = null;
  }
  patch(id, next);
}

/* -------------------------------------------------------------------------- */
/* Derivations (pure)                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Closed-loop tally across a floor transcript. Only the loop INITIATORS (orders
 * and delegated assignments) are counted; the read-back / acknowledgement turns
 * that carry a mirrored loop flag are the confirmation, not a separate loop.
 */
export function closedLoopStats(floor: FloorEvent[]): { closed: number; total: number } {
  let closed = 0;
  let total = 0;
  for (const e of floor) {
    if (e.kind === "readback" || e.kind === "ack") continue;
    if (e.loop === "open" || e.loop === "closed") {
      total += 1;
      if (e.loop === "closed") closed += 1;
    }
  }
  return { closed, total };
}

/** The first open-loop turn awaiting a read-back, if any. */
export function openLoopEvent(floor: FloorEvent[]): FloorEvent | null {
  return floor.find((e) => e.loop === "open") ?? null;
}

/* -------------------------------------------------------------------------- */
/* Subscription + hooks                                                        */
/* -------------------------------------------------------------------------- */

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): StoreState {
  return state;
}

/** Read the whole store reactively (stable reference until an action fires). */
export function useRoomsStore(): StoreState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Ordered list of rooms for the lobby. */
export function useRoomList(): Room[] {
  const s = useRoomsStore();
  return s.order
    .map((id) => s.runtimes[id]?.room)
    .filter((r): r is Room => Boolean(r));
}

/** One room's runtime, or undefined if the id is unknown. */
export function useRoomRuntime(id: string | undefined): RoomRuntime | undefined {
  const s = useRoomsStore();
  return id ? s.runtimes[id] : undefined;
}

/** Non-reactive lookup (e.g. inside an event handler). */
export function peekRoom(id: string): RoomRuntime | undefined {
  return state.runtimes[id];
}
