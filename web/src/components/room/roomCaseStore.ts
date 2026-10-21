/**
 * AcuDx: shared room-encounter state (Journey 6, collaborative core).
 *
 * A dependency-free external store (the `useSyncExternalStore` pattern of
 * `src/state/encounterStore.ts`) for the room's collaborative loop: a doctor places an
 * order, it lands as a TASK in the executing role's queue, the nurse claims and completes it.
 *
 * The patient is the room's THREAD (doc 15 section 12.8), never a client course:
 *  - every order, claim and completion is posted to the thread (`POST /v2/case/{t}/task`)
 *    and reaches every member as a `task` event (`applyThreadTask`), so all devices show
 *    the same queue;
 *  - a medication task is administered through the solo encounter's own path
 *    (`administerTreatment`: five rights, allergy band, MAR, then a Director step on the
 *    server), and is refused while the thread's treatment table is pending or rejected
 *    (`treatmentsLocked`, 06b F30); the Director's step fans out to every member, whose
 *    monitor follows the same server vitals;
 *  - nothing here computes vitals: the room's monitor reads the encounter store.
 *
 * Scripted AI backfill (clearly labelled, Art. 50 transparency) only drives a role that no
 * person holds, and only from the device that placed the order, through the same path.
 *
 * Every function that reads time takes it from an injectable clock; nothing reads Date.now
 * at module top level. Education only. No real patient data path.
 */

import { useSyncExternalStore } from "react";
import {
  primaryCode,
  resolveReveal,
  type CaseInstance,
  type RevealDatumKind,
} from "@/domain/case";
import { TREATMENT_CATALOG } from "@/domain/treatments";
import { orderTiming, type OrderCategory } from "@/domain/orderCatalog";
import type { ClinicalRole } from "@/data/rooms";
import type { Bilingual } from "@/data/schema";
import { postRoomTask, type RoomTaskEvent, type RoomTaskRequest, type RoomThreadTask } from "@/lib/caseGenV2";
import {
  DIRECTOR_CLIENT_ID,
  administerTreatment,
  getEncounterSnapshot,
  treatmentsLocked,
} from "@/state/encounterStore";

/* -------------------------------------------------------------------------- */
/* Shapes                                                                      */
/* -------------------------------------------------------------------------- */

/** The kind of work a task represents (drives who executes + what completing does). */
export type RoomTaskKind = "medication" | "diagnostic" | "intervention";

/** Task lifecycle: ordered → claimed by an executor → executed. */
export type RoomTaskStatus = "pending" | "claimed" | "done";

/** A single order handed from one role to another as an executable task. */
export interface RoomTask {
  id: string;
  /** Order / treatment code (RxNorm / LOINC / synthetic). */
  code: string;
  kind: RoomTaskKind;
  label: Bilingual;
  /** Optional dose / route / scope line. */
  detail?: Bilingual;
  /** Who placed the order (the doctor, in the base loop). */
  orderedBy: ClinicalRole;
  orderedByAi: boolean;
  /** Which role is expected to execute it (nurse for meds/labs, etc.). */
  assignedRole: ClinicalRole;
  status: RoomTaskStatus;
  /** Encounter-clock offsets (ms) for each transition. */
  createdAt: number;
  claimedAt?: number;
  completedAt?: number;
  claimedBy?: ClinicalRole;
  claimedByAi?: boolean;
  completedBy?: ClinicalRole;
  completedByAi?: boolean;
  /** Realistic turnaround shown to the team (bilingual; NOT the playback time). */
  etaLabel: Bilingual;
  /** Compressed real ms before a diagnostic result resolves after completion. */
  playbackMs: number;
  category: OrderCategory;
  /** A medication task: the bedside check the executing member ran (five rights, allergy). */
  mar?: RoomThreadTask["mar"];
  /** Done but withheld: the bedside check blocked the dose, nothing entered the course. */
  withheld?: boolean;
  /** Placed on this device (only that device runs AI backfill for it). */
  local?: boolean;
}

/** A resolved diagnostic result revealed into the shared state after a task. */
export interface RoomResult {
  taskId: string;
  code: string;
  datumKind: RevealDatumKind;
  datumIds: string[];
  at: number;
}

/** A recorded role→role handoff / floor-control pass. */
export interface RoomHandoff {
  id: string;
  from: ClinicalRole;
  to: ClinicalRole;
  at: number;
  note: Bilingual;
}

export type RoomCaseEventType =
  | "bind"
  | "role-switch"
  | "order"
  | "claim"
  | "complete"
  | "result"
  | "handoff";

/** An event-sourced entry for the shared room encounter (audit + debrief). */
export interface RoomCaseEvent {
  seq: number;
  type: RoomCaseEventType;
  at: number;
  role: ClinicalRole;
  ai: boolean;
  /** taskId | code | role, depending on type. */
  ref: string;
  label?: Bilingual;
  meta?: Record<string, unknown>;
}

export interface RoomCaseState {
  roomId: string;
  caseInstance: CaseInstance;
  /** Shared course start timestamp (ms) — the team clock anchor. */
  startTs: number;
  /** The role THIS device is currently acting as. */
  actingRole: ClinicalRole;
  /** Backfill empty roles with scripted, labelled AI actions. */
  aiBackfill: boolean;
  /** Who holds floor / decision control right now. */
  floorRole: ClinicalRole;
  tasks: RoomTask[];
  results: RoomResult[];
  /** Revealed datum ids in the shared encounter (labs/imaging). */
  discovered: ReadonlySet<string>;
  handoffs: RoomHandoff[];
  events: RoomCaseEvent[];
}

/* -------------------------------------------------------------------------- */
/* Clock (injectable; never read at module top level)                         */
/* -------------------------------------------------------------------------- */

type Clock = () => number;
let clock: Clock = () => Date.now();

/** Override the clock (tests). Returns a restore function. */
export function __setRoomClock(c: Clock): () => void {
  const prev = clock;
  clock = c;
  return () => {
    clock = prev;
  };
}

/* -------------------------------------------------------------------------- */
/* Store internals                                                             */
/* -------------------------------------------------------------------------- */

interface StoreState {
  rooms: Record<string, RoomCaseState>;
}

let state: StoreState = { rooms: {} };
let seqCounter = 0;
const listeners = new Set<() => void>();
const timers = new Set<ReturnType<typeof setTimeout>>();

/** AI backfill pacing (compressed so a learner can follow it). */
const AI_CLAIM_DELAY = 2200;
const AI_MED_COMPLETE_DELAY = 2600;

/** The thread each room plays (set by the room page once the room follows it). */
const roomThreads: Record<string, string> = {};
/** Roles currently held by scripted AI per room (seats nobody holds, backfill on). */
const roomAiRoles: Record<string, ReadonlySet<ClinicalRole>> = {};
/** Per-device task id prefix (task ids must be unique across the room's devices). */
const TASK_PREFIX = DIRECTOR_CLIENT_ID;

/** Bind a room to its thread (null to unbind): every task transition is posted to it. */
export function setRoomThread(roomId: string, threadId: string | null): void {
  if (threadId) roomThreads[roomId] = threadId;
  else delete roomThreads[roomId];
}

/** The roles scripted AI holds in this room right now (empty seats with backfill on). */
export function setRoomAiRoles(roomId: string, roles: readonly ClinicalRole[]): void {
  roomAiRoles[roomId] = new Set(roles);
}

function publish(roomId: string, req: RoomTaskRequest): Promise<boolean> {
  const threadId = roomThreads[roomId];
  if (!threadId) return Promise.resolve(false);
  return postRoomTask(threadId, { ...req, client_id: DIRECTOR_CLIENT_ID }).then((res) => res.ok);
}

function wireTask(t: RoomTask): RoomThreadTask {
  return {
    id: t.id,
    code: t.code,
    kind: t.kind,
    label_en: t.label.en,
    label_tr: t.label.tr,
    ...(t.detail ? { detail_en: t.detail.en, detail_tr: t.detail.tr } : {}),
    ordered_by: t.orderedBy,
    assigned_role: t.assignedRole,
    ai: t.orderedByAi,
  };
}

function emit(): void {
  for (const l of listeners) l();
}

function setRoom(id: string, next: RoomCaseState): void {
  state = { rooms: { ...state.rooms, [id]: next } };
  emit();
}

/** Elapsed shared-course ms for a room (0-floored). */
function elapsedMsOf(s: RoomCaseState): number {
  return Math.max(0, clock() - s.startTs);
}

function schedule(fn: () => void, ms: number): void {
  const timer = setTimeout(() => {
    timers.delete(timer);
    fn();
  }, Math.max(0, ms));
  timers.add(timer);
}

function appendEvent(
  s: RoomCaseState,
  type: RoomCaseEventType,
  role: ClinicalRole,
  ai: boolean,
  ref: string,
  extra?: { label?: Bilingual; meta?: Record<string, unknown> },
): RoomCaseEvent {
  return {
    seq: seqCounter++,
    type,
    at: elapsedMsOf(s),
    role,
    ai,
    ref,
    ...(extra?.label ? { label: extra.label } : {}),
    ...(extra?.meta ? { meta: extra.meta } : {}),
  };
}

/* -------------------------------------------------------------------------- */
/* Classification helpers (pure)                                              */
/* -------------------------------------------------------------------------- */

const TREATMENT_CODES = new Set(TREATMENT_CATALOG.map((t) => t.code));

/** Is this order a medication the nurse administers (vs a diagnostic)? */
export function isMedicationCode(code: string): boolean {
  return TREATMENT_CODES.has(code);
}

/** The catalog entry for a treatment code, if any. */
export function treatmentFor(code: string) {
  return TREATMENT_CATALOG.find((t) => t.code === code);
}

/** Default executing role for an order (the nurse runs meds, labs, and bedside tasks). */
function defaultExecutor(): ClinicalRole {
  return "nurse";
}

/** Turnaround of an order: diagnostics carry a realistic one; meds act on administration. */
function timingFor(
  s: RoomCaseState,
  code: string,
  med: boolean,
  label: Bilingual,
): { etaLabel: Bilingual; playbackMs: number; category: OrderCategory } {
  if (med) return { etaLabel: { en: "on administration", tr: "uygulamada" }, playbackMs: 0, category: "other" };
  const expectation = s.caseInstance.expectedWorkup.find((w) => primaryCode(w.code) === code);
  const timing = orderTiming(code, expectation?.kind ?? "laboratory", label);
  return { etaLabel: timing.clinicalLabel, playbackMs: timing.playbackMs, category: timing.category };
}

/* -------------------------------------------------------------------------- */
/* Generated-case registry (the room's unique, shared case)                    */
/* -------------------------------------------------------------------------- */

/**
 * Each multiplayer room runs a freshly GENERATED, unique case (not a fixed seed
 * case). The case is minted once by the room creator and carried in the room
 * snapshot, so every member ends up with the SAME `CaseInstance` here. This
 * registry is that shared source of truth, keyed by room id.
 *
 * `bindRoomCase` — which `RoomPage` still calls with a fallback seed case —
 * transparently prefers the registered generated case, so the collaborative
 * vitals + task loop all run on the same unique patient for the whole team.
 */
const roomCaseRegistry: Record<string, CaseInstance> = {};

/**
 * Register the generated case for a room (called by the room store on create
 * and whenever a remote snapshot brings the shared case in). If the room is
 * already bound to a DIFFERENT case (e.g. the snapshot arrived after the first
 * bind), rebind so the team adopts the shared case; there is no in-flight work
 * to lose at that point (this happens at join time).
 */
export function registerRoomCase(roomId: string, caseInstance: CaseInstance): void {
  roomCaseRegistry[roomId] = caseInstance;
  const existing = state.rooms[roomId];
  if (existing && existing.caseInstance.id !== caseInstance.id) {
    bindRoomCase(roomId, caseInstance, {
      actingRole: existing.actingRole,
      aiBackfill: existing.aiBackfill,
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Binding                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Bind a room to a case, creating the shared course if absent. Idempotent for a
 * given (roomId, caseId): a re-mount will NOT wipe in-flight tasks. Pass a fresh
 * caseId (or call resetRoomCase first) to start over.
 *
 * When a generated case is registered for this room, it takes precedence over
 * the passed `caseInstance` (a seed fallback), so every member runs the same
 * unique, shared case.
 */
export function bindRoomCase(
  roomId: string,
  caseInstance: CaseInstance,
  opts?: { actingRole?: ClinicalRole; aiBackfill?: boolean },
): void {
  const effective = roomCaseRegistry[roomId] ?? caseInstance;
  const existing = state.rooms[roomId];
  if (existing && existing.caseInstance.id === effective.id) {
    // Keep progress; only reconcile acting role / backfill if explicitly given.
    let next = existing;
    if (opts?.actingRole && opts.actingRole !== existing.actingRole) {
      next = { ...next, actingRole: opts.actingRole };
    }
    if (opts?.aiBackfill != null && opts.aiBackfill !== existing.aiBackfill) {
      next = { ...next, aiBackfill: opts.aiBackfill };
    }
    if (next !== existing) setRoom(roomId, next);
    return;
  }
  const actingRole = opts?.actingRole ?? "doctor";
  const fresh: RoomCaseState = {
    roomId,
    caseInstance: effective,
    startTs: clock(),
    actingRole,
    aiBackfill: opts?.aiBackfill ?? true,
    floorRole: "doctor",
    tasks: [],
    results: [],
    discovered: new Set(),
    handoffs: [],
    events: [],
  };
  const ev = appendEvent(fresh, "bind", actingRole, false, effective.id);
  setRoom(roomId, { ...fresh, events: [ev] });
}

/** Clear a room's shared course (and its pending timers are left to no-op). */
export function resetRoomCase(roomId: string): void {
  if (!state.rooms[roomId]) return;
  const { [roomId]: _drop, ...rest } = state.rooms;
  void _drop;
  state = { rooms: rest };
  emit();
}

/* -------------------------------------------------------------------------- */
/* Role assignment + floor control                                            */
/* -------------------------------------------------------------------------- */

/** Switch the role this device is acting as (single-browser role play). */
export function setActingRole(roomId: string, role: ClinicalRole): void {
  const s = state.rooms[roomId];
  if (!s || s.actingRole === role) return;
  const ev = appendEvent(s, "role-switch", role, false, role);
  setRoom(roomId, { ...s, actingRole: role, events: [...s.events, ev] });
}

/** Turn scripted AI backfill of empty roles on or off. */
export function setRoomAiBackfill(roomId: string, on: boolean): void {
  const s = state.rooms[roomId];
  if (!s || s.aiBackfill === on) return;
  setRoom(roomId, { ...s, aiBackfill: on });
}

/**
 * Hand control from one role to another and record it on the shared timeline
 * (the floor-control pass + a structured handoff note).
 */
export function handoff(
  roomId: string,
  from: ClinicalRole,
  to: ClinicalRole,
  note?: Bilingual,
): void {
  const s = state.rooms[roomId];
  if (!s || from === to) return;
  const at = elapsedMsOf(s);
  const entry: RoomHandoff = {
    id: `${roomId}-ho${s.handoffs.length + 1}`,
    from,
    to,
    at,
    note:
      note ?? {
        en: "Structured handoff: shared mental model and open tasks passed on.",
        tr: "Yapılandırılmış devir: ortak durum modeli ve açık görevler aktarıldı.",
      },
  };
  const ev = appendEvent(s, "handoff", from, false, to, {
    label: entry.note,
    meta: { from, to },
  });
  setRoom(roomId, {
    ...s,
    floorRole: to,
    handoffs: [...s.handoffs, entry],
    events: [...s.events, ev],
  });
}

/* -------------------------------------------------------------------------- */
/* The order → task → execute loop                                            */
/* -------------------------------------------------------------------------- */

/**
 * Place an order as `role` (only an ordering role, e.g. the doctor). Creates a
 * TASK routed to the executing role's queue. A medication order becomes an
 * administration task the nurse runs; a diagnostic order becomes a collect/send
 * task with a realistic turnaround. Returns the new task id (or null).
 */
export function placeOrderAs(
  roomId: string,
  role: ClinicalRole,
  code: string,
  opts?: {
    label?: Bilingual;
    detail?: Bilingual;
    assignedRole?: ClinicalRole;
    ai?: boolean;
  },
): string | null {
  const s = state.rooms[roomId];
  if (!s) return null;

  const med = isMedicationCode(code);
  const kind: RoomTaskKind = med ? "medication" : "diagnostic";
  const assignedRole = opts?.assignedRole ?? defaultExecutor();

  // Resolve the label from the treatment catalog / expected workup if absent.
  const treatment = treatmentFor(code);
  const expectation = s.caseInstance.expectedWorkup.find(
    (w) => primaryCode(w.code) === code,
  );
  const label: Bilingual =
    opts?.label ??
    treatment?.label ??
    expectation?.label ?? { en: code, tr: code };

  // Timing: diagnostics carry a realistic turnaround; meds take effect on administration
  // (the effect is the Director's, on the server).
  const { etaLabel, playbackMs, category } = timingFor(s, code, med, label);

  // Review 02 finding 9: a medication task always carries dose + route (the
  // formulary adult default) so the executing role can verify the five rights.
  const doseRoute: Bilingual | undefined =
    treatment && treatment.defaultDose && treatment.route
      ? {
          en: `${treatment.defaultDose.amount} ${treatment.defaultDose.unit} ${treatment.route.en}`,
          tr: `${treatment.defaultDose.amount} ${treatment.defaultDose.unit} ${treatment.route.tr}`,
        }
      : treatment?.route;
  const detail: Bilingual | undefined =
    opts?.detail && doseRoute
      ? { en: `${doseRoute.en} · ${opts.detail.en}`, tr: `${doseRoute.tr} · ${opts.detail.tr}` }
      : (opts?.detail ?? doseRoute);

  const task: RoomTask = {
    id: `${TASK_PREFIX}-${roomId}-t${s.tasks.length + 1}-${seqCounter}`,
    code,
    kind,
    label,
    ...(detail ? { detail } : {}),
    orderedBy: role,
    orderedByAi: opts?.ai ?? false,
    assignedRole,
    status: "pending",
    createdAt: elapsedMsOf(s),
    etaLabel,
    playbackMs,
    category,
    local: true,
  };
  const ev = appendEvent(s, "order", role, task.orderedByAi, task.id, {
    label,
    meta: { assignedRole, kind },
  });
  setRoom(roomId, { ...s, tasks: [...s.tasks, task], events: [...s.events, ev] });
  void publish(roomId, { op: "order", task: wireTask(task), role });

  // AI backfill: only a role scripted AI holds (no person in that seat, backfill on).
  maybeScheduleAi(roomId, task.id);
  return task.id;
}

function updateTask(
  roomId: string,
  taskId: string,
  patch: (t: RoomTask, s: RoomCaseState) => RoomTask,
  event?: (t: RoomTask, s: RoomCaseState) => RoomCaseEvent,
  extra?: (t: RoomTask, s: RoomCaseState) => Partial<RoomCaseState>,
): void {
  const s = state.rooms[roomId];
  if (!s) return;
  const target = s.tasks.find((t) => t.id === taskId);
  if (!target) return;
  const nextTask = patch(target, s);
  const nextTasks = s.tasks.map((t) => (t.id === taskId ? nextTask : t));
  const events = event ? [...s.events, event(nextTask, s)] : s.events;
  const base: RoomCaseState = { ...s, tasks: nextTasks, events };
  const merged = extra ? { ...base, ...extra(nextTask, s) } : base;
  setRoom(roomId, merged);
}

/** Claim a pending task for a role (nurse picking up the doctor's order). */
export function claimTask(
  roomId: string,
  role: ClinicalRole,
  taskId: string,
  ai = false,
): void {
  const s = state.rooms[roomId];
  if (!s) return;
  const target = s.tasks.find((t) => t.id === taskId);
  if (!target || target.status !== "pending") return;
  updateTask(
    roomId,
    taskId,
    (t, st) => ({
      ...t,
      status: "claimed",
      claimedBy: role,
      claimedByAi: ai,
      claimedAt: elapsedMsOf(st),
    }),
    (t, st) => appendEvent(st, "claim", role, ai, t.id, { label: t.label }),
  );
  void publish(roomId, { op: "claim", task: { id: taskId, ai }, role });
}

/** True while a medication task cannot be given: no safe treatment table on the thread yet. */
export function administrationLocked(): boolean {
  return treatmentsLocked(getEncounterSnapshot());
}

/**
 * Complete a task as `role`. A MEDICATION is administered through the solo encounter's own
 * path (`administerTreatment`: five rights and the allergy band, a MAR line, then a Director
 * step on the room's thread, which every member receives); it is refused (returns false,
 * nothing changes) while the thread's treatment table is pending or rejected. A dose the
 * bedside check blocks is recorded as done-but-withheld. A DIAGNOSTIC completion sends the
 * sample and schedules its result after a realistic (compressed) turnaround.
 */
export function completeTask(
  roomId: string,
  role: ClinicalRole,
  taskId: string,
  ai = false,
): boolean {
  const s = state.rooms[roomId];
  if (!s) return false;
  const target = s.tasks.find((t) => t.id === taskId);
  if (!target || target.status === "done") return false;

  let mar: RoomThreadTask["mar"] | undefined;
  if (target.kind === "medication") {
    if (administrationLocked()) return false;
    const rec = administerTreatment(target.code, target.label, { administeredBy: role });
    if (!rec) return false;
    mar = {
      outcome: rec.outcome,
      failures: rec.checks.failures.map((f) => f.code),
      allergy_conflict: rec.allergy.conflict,
    };
  }
  const withheld = mar?.outcome === "blocked";
  markDone(roomId, taskId, role, ai, mar);
  const prior = target;
  void publish(roomId, { op: "complete", task: { id: taskId, ai }, role, ...(mar ? { mar } : {}) }).then((ok) => {
    // The server refused it (the table was vetoed meanwhile): the task is not done.
    if (!ok && target.kind === "medication" && !withheld) restoreTask(roomId, prior);
  });

  if (target.kind !== "medication") schedule(() => resolveDiagnostic(roomId, taskId), target.playbackMs);
  return true;
}

function markDone(
  roomId: string,
  taskId: string,
  role: ClinicalRole,
  ai: boolean,
  mar: RoomThreadTask["mar"] | undefined,
): void {
  const s = state.rooms[roomId];
  if (!s) return;
  const at = elapsedMsOf(s);
  const withheld = mar?.outcome === "blocked";
  updateTask(
    roomId,
    taskId,
    (t) => ({
      ...t,
      status: "done",
      // Auto-claim on the spot if it was completed straight from pending.
      claimedBy: t.claimedBy ?? role,
      claimedByAi: t.claimedByAi ?? ai,
      claimedAt: t.claimedAt ?? at,
      completedBy: role,
      completedByAi: ai,
      completedAt: at,
      ...(mar ? { mar } : {}),
      ...(withheld ? { withheld: true } : {}),
    }),
    (t, st) =>
      appendEvent(st, "complete", role, ai, t.id, {
        label: t.label,
        meta: withheld
          ? { withheld: "bedside-check", failures: (mar?.failures ?? []).join(",") }
          : { mar: Boolean(mar), detail: t.detail?.en ?? "" },
      }),
  );
}

function restoreTask(roomId: string, prior: RoomTask): void {
  const s = state.rooms[roomId];
  if (!s) return;
  setRoom(roomId, { ...s, tasks: s.tasks.map((t) => (t.id === prior.id ? prior : t)) });
}

/* -------------------------------------------------------------------------- */
/* Tasks from the thread (other members' orders, claims and completions)       */
/* -------------------------------------------------------------------------- */

const STATUS_RANK: Record<RoomTaskStatus, number> = { pending: 0, claimed: 1, done: 2 };
const ROLES: readonly ClinicalRole[] = ["doctor", "nurse", "paramedic"];
const asRole = (r: unknown, fallback: ClinicalRole): ClinicalRole =>
  ROLES.includes(r as ClinicalRole) ? (r as ClinicalRole) : fallback;

/**
 * Apply one `task` event of the room's thread. Idempotent: an order is added once, a
 * transition only moves forward (pending, claimed, done), and this device's own events
 * are already applied. Never posts back.
 */
export function applyThreadTask(roomId: string, ev: RoomTaskEvent): void {
  const s = state.rooms[roomId];
  const wt = ev.task;
  if (!s || !wt?.id) return;
  const existing = s.tasks.find((t) => t.id === wt.id);
  const status: RoomTaskStatus = wt.status ?? (ev.op === "complete" ? "done" : ev.op === "claim" ? "claimed" : "pending");
  const at = elapsedMsOf(s);
  if (!existing) {
    if (!wt.code || !wt.kind) return;
    const label: Bilingual = { en: wt.label_en ?? wt.code, tr: wt.label_tr ?? wt.label_en ?? wt.code };
    const timing = timingFor(s, wt.code, wt.kind === "medication", label);
    const task: RoomTask = {
      id: wt.id,
      code: wt.code,
      kind: wt.kind,
      label,
      ...(wt.detail_en ? { detail: { en: wt.detail_en, tr: wt.detail_tr ?? wt.detail_en } } : {}),
      orderedBy: asRole(wt.ordered_by, "doctor"),
      orderedByAi: Boolean(wt.ai),
      assignedRole: asRole(wt.assigned_role, "nurse"),
      status,
      createdAt: at,
      ...timing,
      ...(status !== "pending"
        ? { claimedAt: at, claimedBy: asRole(wt.claimed_by, asRole(wt.assigned_role, "nurse")), claimedByAi: Boolean(wt.claimed_ai) }
        : {}),
      ...(status === "done"
        ? { completedAt: at, completedBy: asRole(wt.completed_by, asRole(wt.assigned_role, "nurse")), completedByAi: Boolean(wt.completed_ai) }
        : {}),
      ...(wt.mar ? { mar: wt.mar, ...(wt.mar.outcome === "blocked" ? { withheld: true } : {}) } : {}),
    };
    const evt = appendEvent(s, "order", task.orderedBy, task.orderedByAi, task.id, {
      label,
      meta: { assignedRole: task.assignedRole, kind: task.kind, remote: true },
    });
    setRoom(roomId, { ...s, tasks: [...s.tasks, task], events: [...s.events, evt] });
    if (status === "done" && task.kind !== "medication") schedule(() => resolveDiagnostic(roomId, task.id), task.playbackMs);
    return;
  }
  if (STATUS_RANK[status] <= STATUS_RANK[existing.status]) return;
  if (status === "claimed") {
    updateTask(
      roomId,
      wt.id,
      (t) => ({ ...t, status: "claimed", claimedBy: asRole(wt.claimed_by, t.assignedRole), claimedByAi: Boolean(wt.claimed_ai), claimedAt: at }),
      (t, st) => appendEvent(st, "claim", t.claimedBy ?? t.assignedRole, Boolean(wt.claimed_ai), t.id, { label: t.label }),
    );
    return;
  }
  markDone(roomId, wt.id, asRole(wt.completed_by, existing.assignedRole), Boolean(wt.completed_ai), wt.mar);
  if (existing.kind !== "medication") schedule(() => resolveDiagnostic(roomId, wt.id), existing.playbackMs);
}

/** Reveal a completed diagnostic's result into the shared state. */
function resolveDiagnostic(roomId: string, taskId: string): void {
  const s = state.rooms[roomId];
  if (!s) return;
  const task = s.tasks.find((t) => t.id === taskId);
  if (!task || task.status !== "done") return;
  if (s.results.some((r) => r.taskId === taskId)) return;

  const resolved = resolveReveal(s.caseInstance, { kind: "order", ref: task.code });
  const at = elapsedMsOf(s);
  const result: RoomResult = {
    taskId,
    code: task.code,
    datumKind: resolved?.datumKind ?? "lab",
    datumIds: resolved?.datumIds ?? [],
    at,
  };
  const nextDiscovered = new Set(s.discovered);
  for (const id of result.datumIds) nextDiscovered.add(id);
  const ev = appendEvent(s, "result", task.assignedRole, task.completedByAi ?? false, task.id, {
    label: task.label,
    meta: { datumKind: result.datumKind },
  });
  setRoom(roomId, {
    ...s,
    results: [...s.results, result],
    discovered: nextDiscovered,
    events: [...s.events, ev],
  });
}

/* -------------------------------------------------------------------------- */
/* Scripted AI backfill (clearly labelled)                                     */
/* -------------------------------------------------------------------------- */

/**
 * When AI backfill is on and scripted AI holds the task's executing role (no person in that
 * seat on any device), drive it from the device that placed the order: claim shortly after,
 * then administer through the same shared path as a person (refused while the treatment
 * table is missing), or collect and send a diagnostic. Each transition re-checks that no
 * person has taken over in the meantime.
 */
function aiHolds(s: RoomCaseState, role: ClinicalRole): boolean {
  return role !== s.actingRole && (roomAiRoles[s.roomId]?.has(role) ?? false);
}

function maybeScheduleAi(roomId: string, taskId: string): void {
  schedule(() => {
    const s = state.rooms[roomId];
    if (!s || !s.aiBackfill) return;
    const t = s.tasks.find((x) => x.id === taskId);
    if (!t || t.status !== "pending" || !t.local) return;
    if (!aiHolds(s, t.assignedRole)) return;
    claimTask(roomId, t.assignedRole, taskId, true);
    schedule(() => {
      const s2 = state.rooms[roomId];
      if (!s2 || !s2.aiBackfill) return;
      const t2 = s2.tasks.find((x) => x.id === taskId);
      if (!t2 || t2.status !== "claimed") return;
      if (t2.claimedByAi !== true) return; // a person took it over
      if (!aiHolds(s2, t2.assignedRole)) return;
      completeTask(roomId, t2.assignedRole, taskId, true);
    }, AI_MED_COMPLETE_DELAY);
  }, AI_CLAIM_DELAY);
}

/* -------------------------------------------------------------------------- */
/* Derivations (pure)                                                          */
/* -------------------------------------------------------------------------- */

/** Tasks queued for a given executing role (newest last), any status. */
export function tasksForRole(s: RoomCaseState, role: ClinicalRole): RoomTask[] {
  return s.tasks.filter((t) => t.assignedRole === role);
}

/** Open (not-done) tasks for a role — the live work queue. */
export function openTasksForRole(s: RoomCaseState, role: ClinicalRole): RoomTask[] {
  return s.tasks.filter((t) => t.assignedRole === role && t.status !== "done");
}

/** Count of tasks by status across the whole room (for headline chips). */
export function taskTally(s: RoomCaseState): {
  pending: number;
  claimed: number;
  done: number;
  total: number;
} {
  let pending = 0;
  let claimed = 0;
  let done = 0;
  for (const t of s.tasks) {
    if (t.status === "pending") pending += 1;
    else if (t.status === "claimed") claimed += 1;
    else done += 1;
  }
  return { pending, claimed, done, total: s.tasks.length };
}

/** Medication tasks actually given (done and not withheld by the bedside check). */
export function medsGiven(s: RoomCaseState): number {
  return s.tasks.filter((t) => t.kind === "medication" && t.status === "done" && !t.withheld).length;
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

/** Non-reactive peek (event handlers). */
export function peekRoomCase(roomId: string): RoomCaseState | undefined {
  return state.rooms[roomId];
}

/** Read one room's shared case state reactively. */
export function useRoomCaseState(roomId: string | undefined): RoomCaseState | null {
  const store = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return roomId ? store.rooms[roomId] ?? null : null;
}
