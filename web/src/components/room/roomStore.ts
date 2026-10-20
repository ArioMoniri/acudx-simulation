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
  type Participant,
  type Room,
  type Seat,
  type ClinicalRole,
  type RoomStatus,
  type RoomLocale,
  type FloorEvent,
  type FloorEventKind,
} from "@/data/rooms";
import type { Bilingual, Lang } from "@/data/mock";
import { generateCase, type ChiefComplaintFamily } from "@/domain/caseGen";
import type { CaseInstance } from "@/domain/case";
import { registerRoomCase } from "./roomCaseStore";
import {
  connectRoom,
  disconnect as transportDisconnect,
  relayAvailable,
  sendSnapshot,
  type RoomConnectionState,
  type RoomTransportStatus,
} from "@/lib/roomTransport";
import { getProfileState } from "@/state/profileStore";

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
  /**
   * The room's unique, GENERATED case, when it runs one (created / joined
   * multiplayer rooms). Carried in the room snapshot so every member shares the
   * same patient; undefined for the static seed rooms (which resolve their case
   * from `caseId`).
   */
  caseInstance?: CaseInstance;
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

/* -------------------------------------------------------------------------- */
/* Per-device identity                                                         */
/* -------------------------------------------------------------------------- */

/**
 * With a real transport, two devices (or two browser tabs) must be told apart so
 * they can hold DIFFERENT seats — otherwise one taking a seat would vacate the
 * other's. `ME` is a shared fixture ("You", id `u-me`), so this device seats
 * itself as `SELF`: a clone of `ME` with a stable, per-tab id. `sessionStorage`
 * scopes the id to this tab (each tab is a distinct participant) while surviving
 * a reload (so a reconnect keeps your seat). Falls back to an in-memory id when
 * storage is unavailable (private mode / SSR).
 */
const CLIENT_ID_KEY = "acudx-client-id";

function makeClientId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const stamp =
    typeof Date !== "undefined" ? Date.now().toString(36).slice(-4) : "0000";
  return `me-${rand}${stamp}`;
}

function resolveClientId(): string {
  try {
    if (typeof sessionStorage !== "undefined") {
      const existing = sessionStorage.getItem(CLIENT_ID_KEY);
      if (existing) return existing;
      const fresh = makeClientId();
      sessionStorage.setItem(CLIENT_ID_KEY, fresh);
      return fresh;
    }
  } catch {
    /* storage unavailable — fall through to an in-memory id */
  }
  return makeClientId();
}

const CLIENT_ID = resolveClientId();

/** Two-letter initials from a display name ("Deniz Yılmaz" -> "DY"). */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toLocaleUpperCase() || ME.initials;
}

/**
 * This device's seat identity, carried in every snapshot so the OTHER members
 * see the real person: the signed-in profile's name + initials (never the "You"
 * fixture, which is only ever correct on the device it belongs to) keyed by the
 * stable per-tab id. Read at call time because the profile can change after the
 * module loads (onboarding, account edits).
 */
function self(): Participant {
  const profile = getProfileState().profile;
  if (!profile?.onboarded) return { ...ME, id: CLIENT_ID };
  return {
    ...ME,
    id: CLIENT_ID,
    name: profile.fullName,
    initials: initialsOf(profile.fullName),
    affiliation: profile.institution
      ? { en: profile.institution, tr: profile.institution }
      : ME.affiliation,
  };
}

/**
 * Is this participant THIS device (its own per-tab id), or the legacy `ME`
 * fixture the pre-seated seed rooms use? The UI labels only these seats "You".
 */
export function isSelfParticipant(p: Participant | null | undefined): boolean {
  return p != null && (p.id === CLIENT_ID || p.id === ME.id);
}

/**
 * Which role (if any) THIS device currently sits in. Matches this device's own
 * id, and also the legacy `ME.id` so the pre-seated seed rooms (which use the
 * shared `ME` fixture) still resolve as "mine".
 */
function deriveMine(room: Room): ClinicalRole | null {
  return room.seats.find(isMine)?.role ?? null;
}

/** Is this seat held by THIS device (its own id, or the legacy ME fixture)? */
function isMine(seat: Seat): boolean {
  return isSelfParticipant(seat.holder);
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
      return { role, holder: self(), ready: true, teamLead: true };
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
  // Any local mutation that changes shared room state gets broadcast so the
  // other members converge (suppressed while applying a remote snapshot).
  broadcast(id);
}

function withSeats(room: Room, map: (seat: Seat) => Seat): Room {
  return { ...room, seats: room.seats.map(map) };
}

/* -------------------------------------------------------------------------- */
/* Realtime transport: pure relay + snapshot cache (see lib/roomTransport)     */
/* -------------------------------------------------------------------------- */

/** Wire shape of a room snapshot (device-local fields are intentionally omitted). */
interface RoomSnapshotWire {
  v: 1;
  /** Originating client id (debug aid; the relay itself excludes the sender). */
  origin: string;
  room: Room;
  floor: FloorEvent[];
  hands: ClinicalRole[];
  floorHolder: ClinicalRole | null;
  caseInstance: CaseInstance | null;
}

/**
 * The relay channel for a room is its shared JOIN CODE, so a room created on one
 * device and joined by code on another resolve to the SAME channel and the SAME
 * deterministic room id (`room-<CODE>`). Seed rooms keep their own ids but still
 * channel on their join code.
 */
function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

function roomIdForCode(code: string): string {
  return `room-${normalizeCode(code)}`;
}

// Single active connection at a time (this device is in one room).
let activeChannel: string | null = null;
let activeRoomId: string | null = null;
/** True while merging a remote snapshot — suppresses the echo re-broadcast. */
let applyingRemote = false;
/** Rooms materialized from a code-join that should auto-seat once populated. */
const pendingJoinSeat = new Set<string>();
/** Code-joins waiting for the host's snapshot, keyed by channel (join code). */
const pendingJoinResolvers = new Map<string, (roomId: string) => void>();
/** How long a code-join waits for the relay before the code is called unknown. */
const JOIN_TIMEOUT_MS = 4_000;

// Connection status, surfaced to the UI via `useRoomConnection`.
let connStatus: RoomTransportStatus = { state: "idle", peers: 0, channel: null };
const statusListeners = new Set<() => void>();

function emitStatus(): void {
  for (const l of statusListeners) l();
}

function setConnStatus(next: RoomTransportStatus): void {
  connStatus = next;
  emitStatus();
}

/** Connect this device to a room's channel (idempotent for the same channel). */
function connect(roomId: string, code: string): void {
  const channel = normalizeCode(code);
  activeChannel = channel;
  activeRoomId = roomId;
  connectRoom(channel, {
    onSnapshot: (data) => applyRemoteSnapshot(channel, data),
    onStatus: (s) => setConnStatus(s),
  });
}

/** Broadcast a room's current shared snapshot to the other members. */
function broadcast(id: string): void {
  if (applyingRemote) return;
  if (activeChannel == null || id !== activeRoomId) return;
  const rt = state.runtimes[id];
  if (!rt) return;
  const wire: RoomSnapshotWire = {
    v: 1,
    origin: CLIENT_ID,
    room: rt.room,
    floor: rt.floor,
    hands: rt.hands,
    floorHolder: rt.floorHolder,
    caseInstance: rt.caseInstance ?? null,
  };
  sendSnapshot(activeChannel, wire);
}

/**
 * Merge a snapshot received from another member into local state WITHOUT
 * re-broadcasting (echo-loop guard via `applyingRemote`). Device-local fields
 * (`loopsClosedByMe`) are preserved and `mine` is recomputed for THIS device, so
 * a shared last-write-wins replacement never clobbers per-device seat awareness.
 */
function applyRemoteSnapshot(channel: string, raw: unknown): void {
  const wire = raw as Partial<RoomSnapshotWire> | null;
  if (!wire || typeof wire !== "object" || !wire.room || !wire.room.id) return;
  const id = wire.room.id;

  applyingRemote = true;
  try {
    // Learn the concrete room id behind this channel (code-join started blind).
    if (channel === activeChannel) activeRoomId = id;

    const prev = state.runtimes[id];
    const merged: RoomRuntime = {
      room: wire.room,
      floor: wire.floor ?? [],
      hands: wire.hands ?? [],
      floorHolder: wire.floorHolder ?? null,
      mine: deriveMine(wire.room),
      loopsClosedByMe: prev?.loopsClosedByMe ?? 0,
      caseInstance: wire.caseInstance ?? prev?.caseInstance,
    };
    const order = state.order.includes(id) ? state.order : [id, ...state.order];
    state = { order, runtimes: { ...state.runtimes, [id]: merged } };
    emit();

    // Adopt the room's shared, unique case for the collaborative store.
    if (wire.caseInstance) registerRoomCase(id, wire.caseInstance);

    // A code-joiner takes an available seat once the room is populated. Deferred
    // so the seat mutation runs OUTSIDE `applyingRemote` and DOES broadcast.
    if (pendingJoinSeat.has(id) && merged.mine == null) {
      pendingJoinSeat.delete(id);
      queueMicrotask(() => joinRoom(id));
    }
    // The snapshot is the proof the code names a real, open room.
    pendingJoinResolvers.get(channel)?.(id);
  } finally {
    applyingRemote = false;
  }
}

/**
 * Chief-complaint family for each curated seed case, so a room's freshly
 * generated case matches the presentation the host picked in the dialog.
 */
const SEED_FAMILY: Record<string, ChiefComplaintFamily> = {
  "em-acs-001": "chest-pain",
  "em-sah-002": "headache",
  "em-appy-003": "abdominal-pain",
  "em-pe-004": "dyspnea",
  "em-panic-005": "chest-pain",
};

/** The chief-complaint family a seed case id maps to (for constrained generation). */
export function familyForSeedCase(caseId: string): ChiefComplaintFamily | undefined {
  return SEED_FAMILY[caseId];
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
  /** Chief-complaint family to constrain generation to (from the dialog). */
  family?: ChiefComplaintFamily;
  /** A pre-generated case (else one is minted here). */
  caseInstance?: CaseInstance;
}): string {
  const locale = (config.locale ?? "tr") as Lang;
  // Each room runs a fresh, UNIQUE generated case (not a fixed seed), matched to
  // the presentation family the host chose. Carried in the snapshot so every
  // member shares the same patient.
  const family = config.family ?? familyForSeedCase(config.caseId);
  const caseInstance: CaseInstance =
    config.caseInstance ??
    generateCase(
      family
        ? { seedMode: "constrained", chiefComplaint: family, locale }
        : { seedMode: "random", locale },
    );
  const chiefComplaint: Bilingual = caseInstance.chiefComplaint;

  // Deterministic id from the shared join code so a device that joins by code
  // resolves to the SAME room id (and channel) as the creator.
  const joinCode = makeJoinCode(config.caseId);
  const id = roomIdForCode(joinCode);
  const { seats, mine } = buildSeats(
    config.humanRoles.length ? config.humanRoles : ["doctor"],
  );
  const room: Room = {
    id,
    title: {
      en: `Team drill: ${chiefComplaint.en}`,
      tr: `Ekip provası: ${chiefComplaint.tr}`,
    },
    // Keep the seed template id so the solo history interview stays coherent;
    // the collaborative store uses the generated case via the registry.
    caseId: config.caseId,
    chiefComplaint,
    status: "open",
    locale: config.locale ?? "tr",
    host: self(),
    joinCode,
    aiBackfill: config.aiBackfill,
    acuityESI: caseInstance.acuityESI,
    seats,
  };
  const runtime: RoomRuntime = {
    // Use the GENERATED case id so the opening floor is the generic, chief-
    // complaint-driven handover (the authored ACS transcript is specific to the
    // ACS seed patient and would not match a freshly generated case).
    room,
    floor: starterFloor(caseInstance.id, chiefComplaint),
    hands: [],
    floorHolder: null,
    mine,
    loopsClosedByMe: 0,
    caseInstance,
  };
  state = {
    order: [id, ...state.order],
    runtimes: { ...state.runtimes, [id]: runtime },
  };
  // Register the shared case, then connect + seed the relay so members converge.
  registerRoomCase(id, caseInstance);
  emit();
  connect(id, joinCode);
  broadcast(id);
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
 * Seat this device into an available seat of a room it is not yet in (no-op on
 * the seating step when already seated, or when every seat is held by a human).
 * Also connects the transport so the room syncs across devices, even when it was
 * entered directly (e.g. from a room card) rather than via a join code.
 */
export function joinRoom(id: string): void {
  const rt = state.runtimes[id];
  if (!rt) return;
  if (activeRoomId !== id) connect(id, rt.room.joinCode);
  if (rt.mine != null) return;
  const role = firstAvailableSeat(rt.room);
  if (role) takeSeat(id, role);
}

/**
 * Resolve a join code and seat this device into the first seat a teammate can
 * take (an open or AI-held seat). Resolves to the room id, or to `null` when no
 * open room matches the code:
 *
 *   - a room present locally (a seed room, or one created on this device) joins
 *     synchronously (the promise is already settled);
 *   - otherwise the room lives on ANOTHER device, so this device subscribes to
 *     the code's channel and waits a bounded {@link JOIN_TIMEOUT_MS} for the
 *     relay's cached snapshot to prove the room exists. No snapshot in time, or
 *     no relay reachable at all, means the code is unknown: nothing is
 *     materialized and the lobby keeps the learner where they are.
 */
export function joinByCode(code: string): Promise<string | null> {
  const wanted = normalizeCode(code);
  if (!wanted) return Promise.resolve(null);

  // 1) Already present locally.
  const localId = state.order.find(
    (rid) => normalizeCode(state.runtimes[rid]?.room.joinCode ?? "") === wanted,
  );
  if (localId) {
    joinRoom(localId);
    return Promise.resolve(localId);
  }

  // 2) Remote room: only a relay can prove it exists.
  if (!relayAvailable()) return Promise.resolve(null);
  const id = roomIdForCode(wanted);
  return new Promise((resolve) => {
    let settled = false;
    // watchdog: allow bounded wait for the relay's cached snapshot, not a simulated server
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      pendingJoinResolvers.delete(wanted);
      pendingJoinSeat.delete(id);
      if (activeChannel === wanted && !state.runtimes[id]) {
        transportDisconnect();
        activeChannel = null;
        activeRoomId = null;
      }
      resolve(null);
    }, JOIN_TIMEOUT_MS);
    pendingJoinResolvers.set(wanted, (roomId) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pendingJoinResolvers.delete(wanted);
      resolve(roomId);
    });
    pendingJoinSeat.add(id);
    connect(id, wanted);
  });
}

/* -------------------------------------------------------------------------- */
/* Actions — seats                                                             */
/* -------------------------------------------------------------------------- */

/** Move this device into a seat, vacating any seat it already held. */
export function takeSeat(id: string, role: ClinicalRole): void {
  const rt = state.runtimes[id];
  if (!rt) return;
  const room = withSeats(rt.room, (seat) => {
    if (seat.role === role) return { ...seat, holder: self(), ready: true };
    if (isMine(seat)) return { ...seat, holder: null, ready: false };
    return seat;
  });
  patch(id, { room });
}

/** Vacate the seat this device holds (AI backfill can pick it up on render). */
export function leaveSeat(id: string): void {
  const rt = state.runtimes[id];
  if (!rt) return;
  const room = withSeats(rt.room, (seat) =>
    isMine(seat) ? { ...seat, holder: null, ready: false } : seat,
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

/* -------------------------------------------------------------------------- */
/* Connection status (for a "Live · N connected" vs "Local" indicator)         */
/* -------------------------------------------------------------------------- */

export interface RoomConnection {
  /** True only when this device is live-synced on THIS room. */
  live: boolean;
  /** Fine-grained transport state for this room. */
  state: RoomConnectionState;
  /** Members in the room channel (including this device) when live. */
  peers: number;
}

function subscribeStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

function getStatusSnapshot(): RoomTransportStatus {
  return connStatus;
}

/**
 * Reactive connection status for a room, so the UI can show "Live · N connected"
 * vs "Local". Returns a local/idle status for any room that is not the one this
 * device is currently synced on.
 */
export function useRoomConnection(id: string | undefined): RoomConnection {
  const s = useSyncExternalStore(
    subscribeStatus,
    getStatusSnapshot,
    getStatusSnapshot,
  );
  const onThisRoom = !!id && id === activeRoomId;
  const live = onThisRoom && s.state === "live";
  return {
    live,
    state: onThisRoom ? s.state : "idle",
    peers: live ? s.peers : 0,
  };
}

/** Leave the active room's channel (stops syncing; safe to call anytime). */
export function leaveRoomTransport(): void {
  activeChannel = null;
  activeRoomId = null;
  transportDisconnect();
  setConnStatus({ state: "idle", peers: 0, channel: null });
}
