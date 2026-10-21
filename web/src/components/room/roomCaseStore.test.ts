// @vitest-environment jsdom
/**
 * The room's order and task loop runs on the shared thread (doc 15 section 12.8):
 *  - a medication task is administered through the same path as the solo encounter
 *    (five rights, allergy band, MAR, a Director step on the server), never on a client course;
 *  - Administer is refused while the thread's treatment table is pending or vetoed;
 *  - orders, claims and completions travel on the thread as `task` events, applied once;
 *  - another member's treatment step moves this device's monitor to the same vitals.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as roomCase from "./roomCaseStore";
import {
  applyThreadTask,
  bindRoomCase,
  claimTask,
  completeTask,
  peekRoomCase,
  placeOrderAs,
  resetRoomCase,
  setRoomAiRoles,
  setRoomThread,
} from "./roomCaseStore";
import { v2SpecToCaseInstance, type CaseGenV2Spec, type RoomThreadTask } from "@/lib/caseGenV2";
import {
  DIRECTOR_CLIENT_ID,
  __flushLive,
  applyThreadDirector,
  getCurrentVitals,
  getEncounterSnapshot,
  resetEncounter,
  setCaseLayers,
  setLiveEnabled,
  startGeneratedEncounter,
} from "@/state/encounterStore";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

function spec(extra: Partial<CaseGenV2Spec> = {}): CaseGenV2Spec {
  return {
    seed: 11,
    locale: "en",
    condition: { icd11: "1G40", icd10: "A41.9", label_en: "Sepsis", label_tr: "Sepsis", system: "infectious" },
    demographics: { age: 54, sex: "male", name_hint: "Deniz A." },
    chief_complaint_en: "Fever and chills",
    chief_complaint_tr: "Fever and chills",
    acuity_esi: 2,
    difficulty: 3,
    hpi: [{ uid: "op.0", intent: "onset", answer_en: "Since this morning.", answer_tr: "Since this morning.", red_flag: false }],
    exam: [],
    triage_vitals: { hr: 120, systolic: 98, diastolic: 60, rr: 24, spo2: 94, tempC: 39.4 },
    vitals_trajectory: [{ atMs: 0, hr: 120, systolic: 98, diastolic: 60, rr: 24, spo2: 94, tempC: 39.4 }],
    labs: [],
    imaging: [],
    treatments: [],
    disposition: "admit-ward",
    allergies_en: "Penicillin (rash)",
    allergies_tr: "Penicillin (rash)",
    ...extra,
    meta: {
      source: "model", generator: "v2", pipeline: "staged", model: "acudx-llm", condition_id: "sepsis_uncomplicated",
      thread_id: "th-room", degraded: false, note: null, latency_ms: 9000, layers: { treatments: "pending" },
    },
  } as CaseGenV2Spec;
}

const DIRECTOR_VITALS = { hr: 104, systolic: 108, diastolic: 66, rr: 20, spo2: 96, tempC: 38.6 };

interface Call {
  url: string;
  body: Record<string, unknown> | null;
}

let calls: Call[] = [];
const realFetch = globalThis.fetch;

function serve(): void {
  calls = [];
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ url: u.replace(/^.*\/v2/, ""), body });
    if (u.endsWith("/director/step")) {
      return json({
        thread_id: "th-room",
        case_state: { t_ms: 90_000 },
        patient_visible_changes: { t_ms: 90_000, vitals: DIRECTOR_VITALS, new_facts: [], complications_fired: [], trace: [] },
        director_notes: [],
        layers_pending: [],
      });
    }
    if (u.endsWith("/task")) return json({ thread_id: "th-room", task: { id: body?.task } });
    return json({}, 404);
  }) as typeof fetch;
}

function start(): void {
  const c = v2SpecToCaseInstance(spec()).case;
  startGeneratedEncounter(c, { source: "model", threadId: "th-room", council: null, degraded: false, model: null, note: null },
    { treatments: "pending" });
  bindRoomCase("r1", c, { actingRole: "nurse", aiBackfill: false });
  setRoomThread("r1", "th-room");
}

beforeEach(() => {
  serve();
  setLiveEnabled(true);
  start();
});

afterEach(async () => {
  await __flushLive();
  setLiveEnabled(false);
  resetRoomCase("r1");
  setRoomThread("r1", null);
  resetEncounter();
  globalThis.fetch = realFetch;
});

const taskCalls = () => calls.filter((c) => c.url.endsWith("/task"));
const directorCalls = () => calls.filter((c) => c.url.endsWith("/director/step"));

describe("room administration goes through the shared thread", () => {
  it("has no client-only course in the room store", () => {
    expect("useRoomVitals" in roomCase).toBe(false);
    expect("roomVitalsAt" in roomCase).toBe(false);
    expect("roomCourseStatusAt" in roomCase).toBe(false);
    expect("treatments" in peekRoomCase("r1")!).toBe(false);
  });

  it("refuses Administer while the treatment table is pending or vetoed", async () => {
    const id = placeOrderAs("r1", "doctor", "161")!;
    expect(completeTask("r1", "nurse", id)).toBe(false);
    setCaseLayers("th-room", { treatments: "failed" });
    expect(completeTask("r1", "nurse", id)).toBe(false);
    await tick();
    expect(peekRoomCase("r1")!.tasks[0].status).toBe("pending");
    expect(getEncounterSnapshot().mar).toHaveLength(0);
    expect(directorCalls()).toHaveLength(0);
    expect(taskCalls().map((c) => c.body?.op)).toEqual(["order"]);
  });

  it("administers through the five rights, the MAR and a Director step on the thread", async () => {
    setCaseLayers("th-room", { treatments: "ready" });
    const id = placeOrderAs("r1", "doctor", "161")!;
    claimTask("r1", "nurse", id);
    expect(completeTask("r1", "nurse", id)).toBe(true);
    await __flushLive();
    await tick();
    const s = getEncounterSnapshot();
    expect(s.mar).toHaveLength(1);
    expect(s.mar[0]).toMatchObject({ administeredBy: "nurse", outcome: "given" });
    expect(s.treatments.map((t) => t.code)).toEqual(["161"]);
    // The Director steps the thread (server-held state), never a client case.
    expect(directorCalls()).toHaveLength(1);
    expect(directorCalls()[0].body).toMatchObject({ thread_id: "th-room", action: { kind: "treatment", ref: "161" } });
    expect(directorCalls()[0].body).not.toHaveProperty("case_state");
    // The monitor shows the Director's vitals.
    expect(getCurrentVitals(getEncounterSnapshot())?.hr).toBe(DIRECTOR_VITALS.hr);
    // Order, claim and completion travel on the thread for every member.
    const ops = taskCalls().map((c) => c.body?.op);
    expect(ops).toEqual(["order", "claim", "complete"]);
    const done = taskCalls()[2].body!;
    expect(done).toMatchObject({ role: "nurse", mar: { outcome: "given", allergy_conflict: false } });
    expect(done.client_id).toBe(DIRECTOR_CLIENT_ID);
    expect(peekRoomCase("r1")!.tasks[0]).toMatchObject({ status: "done", completedBy: "nurse" });
  });

  it("withholds a drug the allergy band names: MAR blocked, no Director step", async () => {
    setCaseLayers("th-room", { treatments: "ready" });
    const id = placeOrderAs("r1", "doctor", "pip-tazo")!;
    expect(completeTask("r1", "nurse", id)).toBe(true);
    await __flushLive();
    await tick();
    const s = getEncounterSnapshot();
    expect(s.mar[0].outcome).toBe("blocked");
    expect(s.treatments).toHaveLength(0);
    expect(directorCalls()).toHaveLength(0);
    expect(taskCalls().at(-1)?.body).toMatchObject({ op: "complete", mar: { outcome: "blocked", allergy_conflict: true } });
    expect(peekRoomCase("r1")!.tasks[0].withheld).toBe(true);
  });
});

describe("tasks and treatment steps from other members", () => {
  it("applies a remote order and its completion once", () => {
    const task: RoomThreadTask = {
      id: "tab-x-1", code: "161", kind: "medication", label_en: "Paracetamol", label_tr: "Parasetamol",
      ordered_by: "doctor", assigned_role: "nurse", status: "pending" as const,
    };
    applyThreadTask("r1", { op: "order", task, client_id: "tab-x" });
    applyThreadTask("r1", { op: "order", task, client_id: "tab-x" });
    expect(peekRoomCase("r1")!.tasks).toHaveLength(1);
    expect(peekRoomCase("r1")!.tasks[0]).toMatchObject({ id: "tab-x-1", status: "pending", assignedRole: "nurse" });
    applyThreadTask("r1", { op: "complete", task: { ...task, status: "done", completed_by: "nurse", mar: { outcome: "given" } } });
    // A late replay of the claim never moves a done task back.
    applyThreadTask("r1", { op: "claim", task: { ...task, status: "claimed", claimed_by: "nurse" } });
    expect(peekRoomCase("r1")!.tasks[0]).toMatchObject({ status: "done", completedBy: "nurse" });
    expect(taskCalls()).toHaveLength(0); // applying never posts back
  });

  it("does not let AI backfill take a task whose role a person holds", async () => {
    setRoomAiRoles("r1", []);
    const id = placeOrderAs("r1", "doctor", "161", { ai: false })!;
    await tick(10);
    expect(peekRoomCase("r1")!.tasks.find((t) => t.id === id)?.status).toBe("pending");
  });

  it("another member's treatment step moves this monitor to the same vitals", () => {
    setCaseLayers("th-room", { treatments: "ready" });
    applyThreadDirector("th-room", {
      thread_id: "th-room", client_id: "tab-nurse", action: { kind: "treatment", ref: "161" },
      case_state: { t_ms: 90_000 } as never,
      patient_visible_changes: { t_ms: 90_000, vitals: DIRECTOR_VITALS, new_facts: [], complications_fired: [], trace: [] } as never,
      director_notes: [],
    });
    const s = getEncounterSnapshot();
    expect(getCurrentVitals(s)?.hr).toBe(DIRECTOR_VITALS.hr);
    // The shared course carries the treatment on this device too (same ramps from now on).
    expect(s.treatments.map((t) => t.code)).toEqual(["161"]);
    // The same step arriving on a second stream of the thread is applied once.
    applyThreadDirector("th-room", {
      thread_id: "th-room", client_id: "tab-nurse", action: { kind: "treatment", ref: "161" },
      case_state: { t_ms: 90_000 } as never,
      patient_visible_changes: { t_ms: 90_000, vitals: DIRECTOR_VITALS, new_facts: [], complications_fired: [], trace: [] } as never,
      director_notes: [],
    });
    expect(getEncounterSnapshot().treatments).toHaveLength(1);
    expect(getEncounterSnapshot().director.steps).toBe(1);
  });
});
