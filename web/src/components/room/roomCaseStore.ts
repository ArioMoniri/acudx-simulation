/**
 * AcuDx — shared room-encounter state (Journey 6, collaborative core).
 *
 * A dependency-free, event-sourced external store (the same
 * `useSyncExternalStore` pattern as `src/state/encounterStore.ts`) that models
 * ONE shared patient encounter worked by a MULTI-ROLE team. Where the solo
 * encounter store is a single-player projection, this store binds a room to a
 * single `CaseInstance` and coordinates the collaborative loop the spec calls
 * for: a doctor places an order, it lands as a TASK in the executing role's
 * queue, the nurse claims and completes it, and a completed medication task
 * feeds the clinical-course engine so the shared patient's vitals actually
 * respond.
 *
 * It is deliberately kept SEPARATE from `state/encounterStore.ts` so the two
 * never fight over the single-encounter singleton: the doctor's history-taking
 * interview can keep running on the solo store while the shared vitals + task
 * queue live here.
 *
 * Simulated locally: a single browser can switch its acting role and, with AI
 * backfill on, empty roles are driven by scripted, clearly-labelled actions
 * (Art. 50 transparency). There is NO real transport — production rides a
 * self-hosted LiveKit WebRTC room; this is the believable local projection.
 *
 * Every function that reads time takes it from an injectable clock; nothing
 * reads Date.now at module top level. Education only. No real patient data path.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  primaryCode,
  resolveReveal,
  type CaseInstance,
  type RevealDatumKind,
} from "@/domain/case";
import { TREATMENT_CATALOG } from "@/domain/treatments";
import { orderTiming, type OrderCategory } from "@/domain/orderCatalog";
import {
  courseStatus,
  currentVitals,
  type AdministeredTreatment,
  type CourseStatus,
  type CurrentVitals,
} from "@/domain/clinicalCourse";
import type { ClinicalRole } from "@/data/rooms";
import type { Bilingual } from "@/data/mock";

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
  /** Completed medication tasks, as administered treatments driving the course. */
  treatments: AdministeredTreatment[];
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

/** AI backfill pacing (compressed for a watchable demo). */
const AI_CLAIM_DELAY = 2200;
const AI_MED_COMPLETE_DELAY = 2600;

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

/* -------------------------------------------------------------------------- */
/* Binding                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Bind a room to a case, creating the shared course if absent. Idempotent for a
 * given (roomId, caseId): a re-mount will NOT wipe in-flight tasks. Pass a fresh
 * caseId (or call resetRoomCase first) to start over.
 */
export function bindRoomCase(
  roomId: string,
  caseInstance: CaseInstance,
  opts?: { actingRole?: ClinicalRole; aiBackfill?: boolean },
): void {
  const existing = state.rooms[roomId];
  if (existing && existing.caseInstance.id === caseInstance.id) {
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
    caseInstance,
    startTs: clock(),
    actingRole,
    aiBackfill: opts?.aiBackfill ?? true,
    floorRole: "doctor",
    tasks: [],
    results: [],
    treatments: [],
    discovered: new Set(),
    handoffs: [],
    events: [],
  };
  const ev = appendEvent(fresh, "bind", actingRole, false, caseInstance.id);
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

  // Timing: diagnostics carry a realistic turnaround; meds take effect on
  // administration (the effect itself ramps over its onset in the course engine).
  let etaLabel: Bilingual;
  let playbackMs: number;
  let category: OrderCategory;
  if (med) {
    etaLabel = { en: "on administration", tr: "uygulamada" };
    playbackMs = 0;
    category = "other";
  } else {
    const kindFhir = expectation?.kind ?? "laboratory";
    const timing = orderTiming(code, kindFhir, label);
    etaLabel = timing.clinicalLabel;
    playbackMs = timing.playbackMs;
    category = timing.category;
  }

  const detail: Bilingual | undefined =
    opts?.detail ?? (treatment?.route ? treatment.route : undefined);

  const task: RoomTask = {
    id: `${roomId}-t${s.tasks.length + 1}-${seqCounter}`,
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
  };
  const ev = appendEvent(s, "order", role, task.orderedByAi, task.id, {
    label,
    meta: { assignedRole, kind },
  });
  setRoom(roomId, { ...s, tasks: [...s.tasks, task], events: [...s.events, ev] });

  // AI backfill: if the executing role is not the human's current seat and
  // backfill is on, schedule a scripted claim (and, for meds, a completion).
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
}

/**
 * Complete a task as `role`. A MEDICATION completion applies the treatment via
 * the clinical-course engine (an administered treatment from now on), so the
 * shared patient's vitals respond. A DIAGNOSTIC completion sends the sample and
 * schedules its result to resolve after a realistic (compressed) turnaround.
 */
export function completeTask(
  roomId: string,
  role: ClinicalRole,
  taskId: string,
  ai = false,
): void {
  const s = state.rooms[roomId];
  if (!s) return;
  const target = s.tasks.find((t) => t.id === taskId);
  if (!target || target.status === "done") return;

  const at = elapsedMsOf(s);

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
    }),
    (t, st) => appendEvent(st, "complete", role, ai, t.id, { label: t.label }),
    (t) =>
      t.kind === "medication"
        ? { treatments: [...s.treatments, { code: t.code, at }] }
        : {},
  );

  if (target.kind === "medication") {
    // Emit an "administer" note is folded into the complete event above; the
    // treatment is now part of the course and drives currentVitals over time.
    return;
  }

  // Diagnostic: resolve the result after the compressed turnaround.
  schedule(() => resolveDiagnostic(roomId, taskId), target.playbackMs);
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
 * When AI backfill is on and the task's executing role is NOT the human's
 * current seat, drive it with scripted actions: claim shortly after the order,
 * then (for meds) administer, or (for diagnostics) collect + send so the result
 * resolves on its own timer. Each transition re-checks that no human has taken
 * over in the meantime.
 */
function maybeScheduleAi(roomId: string, taskId: string): void {
  schedule(() => {
    const s = state.rooms[roomId];
    if (!s || !s.aiBackfill) return;
    const t = s.tasks.find((x) => x.id === taskId);
    if (!t || t.status !== "pending") return;
    // Only backfill a role the human is not currently occupying.
    if (t.assignedRole === s.actingRole) return;
    claimTask(roomId, t.assignedRole, taskId, true);
    schedule(() => {
      const s2 = state.rooms[roomId];
      if (!s2 || !s2.aiBackfill) return;
      const t2 = s2.tasks.find((x) => x.id === taskId);
      if (!t2 || t2.status !== "claimed") return;
      if (t2.claimedByAi !== true) return; // a human took it over
      if (t2.assignedRole === s2.actingRole) return;
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

/** The shared patient's effective vitals at `elapsedMs` (baseline + treatments). */
export function roomVitalsAt(s: RoomCaseState, elapsedMs: number): CurrentVitals {
  return currentVitals(s.caseInstance, elapsedMs, s.treatments);
}

/** Coarse trend of the shared course at `elapsedMs`. */
export function roomCourseStatusAt(s: RoomCaseState, elapsedMs: number): CourseStatus {
  return courseStatus(s.caseInstance, elapsedMs, s.treatments);
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

/**
 * Live vitals for the shared patient: recomputed from the course on a 1s tick
 * (so treatment ramps animate) AND whenever the store changes. Returns nulls
 * until the room is bound.
 */
export function useRoomVitals(roomId: string | undefined): {
  vitals: CurrentVitals | null;
  status: CourseStatus | null;
  elapsedMs: number;
} {
  const s = useRoomCaseState(roomId);
  const [, force] = useState(0);
  useEffect(() => {
    const iv = window.setInterval(() => force((n) => (n + 1) % 1_000_000), 1000);
    return () => window.clearInterval(iv);
  }, []);
  if (!s) return { vitals: null, status: null, elapsedMs: 0 };
  const elapsedMs = elapsedMsOf(s);
  return {
    vitals: roomVitalsAt(s, elapsedMs),
    status: roomCourseStatusAt(s, elapsedMs),
    elapsedMs,
  };
}
