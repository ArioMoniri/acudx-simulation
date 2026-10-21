/**
 * AcuDx: multiplayer room types and pure helpers (Journey 6).
 *
 * Shapes of a room, its seats, participants, floor turns and debrief marks, plus
 * the role scopes. There are no seed rooms or example people here: the lobby
 * lists only rooms created on this device or received from the relay
 * (`components/room/roomStore.ts`, `multiplayer/server.mjs`), and every name on
 * a seat is a real signed-in participant or a labelled AI seat (Art. 50).
 *
 * Education only. No real patient data path.
 */

import type { Bilingual } from "@/data/schema";
import type { CaseInstance } from "@/domain/case";
import { NURSE_PROTOCOL_ORDERS, PARAMEDIC_INTERVENTIONS } from "@/domain/scopeOfPractice";

/* -------------------------------------------------------------------------- */
/* Roles                                                                       */
/* -------------------------------------------------------------------------- */

/** The three clinical seats a room offers (one holder each). */
export type ClinicalRole = "doctor" | "nurse" | "paramedic";

/** How a seat is held. AI-held seats are first-class but always labeled. */
export type SeatHolderKind = "human" | "ai" | "empty";

/** Live presence of a human participant, as the room snapshot reports it. */
export type Presence = "active" | "idle" | "reconnecting";

export interface RoleScope {
  role: ClinicalRole;
  /** One-line clinical scope shown on the role card (role select). */
  scope: Bilingual;
  /** What the human is scored on in this seat (assessment preview). */
  scoredOn: Bilingual;
  /** Whether this seat can place ANY order (server-enforced in production). */
  canOrder: boolean;
  /**
   * Standing-protocol / scope-of-practice orders this seat may initiate even
   * when `canOrder` is false (review 02 findings 24 and 25). Nurse: 12-lead
   * ECG, POC glucose, IV access, oxygen, urine hCG, standard bloods, monitoring
   * (nurse-driven triage ECG protocols, AJEM 2018
   * https://www.ajemjournal.com/article/S0735-6757(18)30097-4/fulltext).
   * Paramedic: the NHTSA 2019 national scope of practice interventions
   * (https://www.ems.gov/assets/National_EMS_Scope_of_Practice_Model_2019.pdf).
   */
  protocolOrders: readonly string[];
}

/**
 * Role scope table (Screen 6.2). Text-first, TR in the clinical register:
 * SBAR / escalation language localized, not machine-translated.
 */
export const ROLE_SCOPES: Record<ClinicalRole, RoleScope> = {
  doctor: {
    role: "doctor",
    scope: {
      en: "Lead the workup, order tests, commit the diagnosis and plan.",
      tr: "Tetkik sürecini yönet, istem gir, tanı ve tedavi planını onayla.",
    },
    scoredOn: {
      en: "Diagnostic reasoning, order stewardship, safe disposition.",
      tr: "Tanısal muhakeme, akılcı istem kullanımı, güvenli sevk kararı.",
    },
    canOrder: true,
    protocolOrders: [],
  },
  nurse: {
    role: "nurse",
    scope: {
      en: "Assess, monitor, execute and clarify orders, escalate concerns.",
      tr: "Değerlendir, monitörize et, istemleri uygula ve netleştir, kaygıları yükselt.",
    },
    scoredOn: {
      en: "Monitoring, SBAR handover, timely escalation, closed-loop response.",
      tr: "Monitörizasyon, SBAR devir, zamanında yükseltme, kapalı döngü yanıt.",
    },
    canOrder: false,
    protocolOrders: [...NURSE_PROTOCOL_ORDERS],
  },
  paramedic: {
    role: "paramedic",
    scope: {
      en: "Give the prehospital picture and a structured scene handover.",
      tr: "Hastane öncesi tabloyu ve yapılandırılmış olay yeri devrini sun.",
    },
    scoredOn: {
      en: "ATMIST/SBAR handover clarity, scene findings, completeness.",
      tr: "ATMIST/SBAR devir netliği, olay yeri bulguları, eksiksizlik.",
    },
    canOrder: false,
    protocolOrders: [...PARAMEDIC_INTERVENTIONS],
  },
};

/** The team-lead hat — worn ATOP a clinical role, never a displacing seat. */
export const TEAM_LEAD_HAT = {
  scoredOn: {
    en: "Delegation, situational awareness, closed-loop communication.",
    tr: "Görev dağılımı, durum farkındalığı, kapalı döngü iletişim.",
  } as Bilingual,
  scope: {
    en: "Run the team: assign tasks, keep the shared mental model, verify read-backs.",
    tr: "Ekibi yönet: görev ata, ortak durum modelini koru, geri okumaları doğrula.",
  } as Bilingual,
};

export const CLINICAL_ROLE_ORDER: ClinicalRole[] = ["doctor", "nurse", "paramedic"];

/* -------------------------------------------------------------------------- */
/* Participants + seats                                                        */
/* -------------------------------------------------------------------------- */

export interface Participant {
  id: string;
  /** Human display name, or a stable label for an AI participant. */
  name: string;
  kind: SeatHolderKind;
  /** Presence only meaningful for humans; AI participants are always "active". */
  presence: Presence;
  /** Program or cohort line from the participant's own profile. */
  affiliation?: Bilingual;
  /** Two-letter initials for the avatar chip. */
  initials: string;
}

export interface Seat {
  role: ClinicalRole;
  /** null when the seat is empty (open to take). */
  holder: Participant | null;
  /** Ready-check state in the lobby. */
  ready: boolean;
  /** Does this seat currently wear the team-lead hat? */
  teamLead: boolean;
}

/* -------------------------------------------------------------------------- */
/* Room                                                                        */
/* -------------------------------------------------------------------------- */

export type RoomStatus = "open" | "in-progress" | "debrief";
export type RoomLocale = "tr" | "en";

export interface Room {
  id: string;
  /** Room title authored by the host (realistic sim-session naming). */
  title: Bilingual;
  /**
   * Presentation key of the room (a chief-complaint family hint). Never a case: the
   * room's case is generated on request by the model through the same pipeline as
   * a solo encounter, at room creation or on first entry (review 06a P14, P15).
   */
  caseId: string;
  /** Generation thread of the room's case, once requested. */
  threadId?: string;
  /** Chief complaint shown on the lobby card (mirrors the case). */
  chiefComplaint: Bilingual;
  status: RoomStatus;
  /** One shared encounter locale for the whole room (roleplay coherence). */
  locale: RoomLocale;
  /** Human host (the room owner). */
  host: Participant;
  /** Six-character join code (the relay channel). */
  joinCode: string;
  /** Backfill empty roles with AI participants (on by default). */
  aiBackfill: boolean;
  seats: Seat[];
  /** ESI acuity mirrored from the case for the lobby card. */
  acuityESI: 1 | 2 | 3 | 4 | 5;
}

/* -------------------------------------------------------------------------- */
/* Participants                                                               */
/* -------------------------------------------------------------------------- */

function ai(role: ClinicalRole): Participant {
  const label: Record<ClinicalRole, string> = {
    doctor: "AcuDx Doctor",
    nurse: "AcuDx Nurse",
    paramedic: "AcuDx Paramedic",
  };
  const initials: Record<ClinicalRole, string> = {
    doctor: "AI",
    nurse: "AI",
    paramedic: "AI",
  };
  return {
    id: `ai-${role}`,
    name: label[role],
    kind: "ai",
    presence: "active",
    initials: initials[role],
  };
}

/**
 * The template of this device's own participant: "You" until the signed-in
 * profile supplies a name (roomStore `self()`), never an invented person.
 */
export const ME: Participant = { id: "u-me", name: "You", kind: "human", presence: "active", initials: "Y" };

/** The room's case: only ever the one generated on request for it (null before). */
export function roomCase(_room: Room, runtimeCase?: CaseInstance | null): CaseInstance | null {
  return runtimeCase ?? null;
}

/** After AI backfill, resolve the effective holder of a seat for rendering. */
export function effectiveHolder(seat: Seat, aiBackfill: boolean): Participant | null {
  if (seat.holder) return seat.holder;
  if (aiBackfill) return ai(seat.role);
  return null;
}

/** Count of filled (human or AI-backfilled) seats vs total. */
export function seatFill(room: Room): { filled: number; humans: number; total: number } {
  let filled = 0;
  let humans = 0;
  for (const s of room.seats) {
    const holder = effectiveHolder(s, room.aiBackfill);
    if (holder) filled += 1;
    if (s.holder?.kind === "human") humans += 1;
  }
  return { filled, humans, total: room.seats.length };
}

/* -------------------------------------------------------------------------- */
/* In-room floor and closed-loop comms                                         */
/* -------------------------------------------------------------------------- */

export type FloorEventKind =
  | "handover" // structured SBAR/ATMIST handover
  | "order" // an order was placed / requested
  | "ack" // closed-loop acknowledgement
  | "readback" // verbatim read-back of a locked clinical token
  | "escalate" // escalation / SBAR up
  | "assess"; // assessment / observation shared

export interface FloorEvent {
  id: string;
  /** Which seat spoke. */
  role: ClinicalRole;
  /** Was the speaker AI-held at that moment? */
  ai: boolean;
  kind: FloorEventKind;
  /** Encounter-clock offset label (mm:ss). */
  at: string;
  text: Bilingual;
  /**
   * For an order/readback that expects closed-loop confirmation: the state of
   * the loop. "open" = spoken, awaiting acknowledgement; "closed" = read back
   * and confirmed; undefined = not a closed-loop utterance.
   */
  loop?: "open" | "closed";
  /** Locked clinical token (drug/dose) that must be read back verbatim. */
  lockedToken?: string;
}

/* -------------------------------------------------------------------------- */
/* Debrief marks (individual leadership and team clinical)                    */
/* -------------------------------------------------------------------------- */

export interface DebriefMark {
  label: Bilingual;
  /** 0-100 score for the bar. */
  score: number;
  /** Short evidence note (the auditable line, learner's language). */
  note: Bilingual;
}

export interface DebriefData {
  /** Individual leadership marks (only if the learner wore the team-lead hat). */
  leadership: DebriefMark[];
  /** The team's shared clinical marks (AI seats excluded from human scoring). */
  teamClinical: DebriefMark[];
  /** Whether the learner wore the team-lead hat this run. */
  woreHat: boolean;
}
