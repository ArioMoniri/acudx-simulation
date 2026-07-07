/**
 * AcuDx — multiplayer room mock data (Journey 6, the moat).
 *
 * Believable realtime lobby + in-room state WITHOUT any real transport: mock
 * presence, mock floor control, mock closed-loop comms. Production rides a
 * self-hosted LiveKit WebRTC room (docs/research/02, arch/07); here every
 * seat, participant, and utterance is static, deterministic fixture data.
 *
 * Roles map to the crisis-resource-management team the spec calls for
 * (doctor + nurse + paramedic + a team-lead HAT worn atop a clinical role).
 * AI-backfilled seats are first-class participants, always clearly labeled
 * (Art. 50 transparency). No public leaderboards, no "Jane Doe" placeholders.
 *
 * Education only. No real patient data path.
 */

import type { Bilingual } from "@/data/mock";
import type { CaseInstance } from "@/domain/case";
import { getSeedCase } from "@/data/seedCases";

/* -------------------------------------------------------------------------- */
/* Roles                                                                       */
/* -------------------------------------------------------------------------- */

/** The three clinical seats a room offers (one holder each). */
export type ClinicalRole = "doctor" | "nurse" | "paramedic";

/** How a seat is held. AI-held seats are first-class but always labeled. */
export type SeatHolderKind = "human" | "ai" | "empty";

/** Live presence for a human participant (mock projection of the room state). */
export type Presence = "active" | "idle" | "reconnecting";

export interface RoleScope {
  role: ClinicalRole;
  /** One-line clinical scope shown on the role card (role select). */
  scope: Bilingual;
  /** What the human is scored on in this seat (assessment preview). */
  scoredOn: Bilingual;
  /** Whether this seat can place orders (server-enforced in production). */
  canOrder: boolean;
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
  /** Program / cohort line for humans (realistic, no institution placeholder). */
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
  /** The seed case this room runs. */
  caseId: string;
  /** Chief complaint shown on the lobby card (mirrors the case). */
  chiefComplaint: Bilingual;
  status: RoomStatus;
  /** One shared encounter locale for the whole room (roleplay coherence). */
  locale: RoomLocale;
  /** Human host (the room owner). */
  host: Participant;
  /** Six-character join code (mock). */
  joinCode: string;
  /** Backfill empty roles with AI participants (on by default). */
  aiBackfill: boolean;
  seats: Seat[];
  /** ESI acuity mirrored from the case for the lobby card. */
  acuityESI: 1 | 2 | 3 | 4 | 5;
}

/* -------------------------------------------------------------------------- */
/* Fixture participants (realistic clinical trainees, TR cohort)              */
/* -------------------------------------------------------------------------- */

function human(
  id: string,
  name: string,
  initials: string,
  presence: Presence,
  affiliation: Bilingual,
): Participant {
  return { id, name, kind: "human", presence, initials, affiliation };
}

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

const emine = human("u-emine", "Emine Korkmaz", "EK", "active", {
  en: "Emergency Medicine, PGY-2",
  tr: "Acil Tıp, Asistan 2. yıl",
});
const baris = human("u-baris", "Barış Aktaş", "BA", "active", {
  en: "Nursing, senior student",
  tr: "Hemşirelik, son sınıf",
});
const selin = human("u-selin", "Selin Yıldız", "SY", "idle", {
  en: "Paramedic program, year 2",
  tr: "Paramedik programı, 2. yıl",
});
const kerem = human("u-kerem", "Kerem Öztürk", "KÖ", "active", {
  en: "Emergency Medicine, PGY-3",
  tr: "Acil Tıp, Asistan 3. yıl",
});
const ayla = human("u-ayla", "Ayla Şen", "AŞ", "reconnecting", {
  en: "Nursing, new graduate",
  tr: "Hemşirelik, yeni mezun",
});

/**
 * The signed-in learner (this device). Kept separate so the lobby can show
 * "you" and the in-room view can scope to the learner's seat.
 */
export const ME: Participant = human("u-me", "You", "SN", "active", {
  en: "Emergency Medicine, PGY-1",
  tr: "Acil Tıp, Asistan 1. yıl",
});

/* -------------------------------------------------------------------------- */
/* Seat builders                                                              */
/* -------------------------------------------------------------------------- */

function seat(
  role: ClinicalRole,
  holder: Participant | null,
  ready: boolean,
  teamLead = false,
): Seat {
  return { role, holder, ready, teamLead };
}

/* -------------------------------------------------------------------------- */
/* Rooms                                                                       */
/* -------------------------------------------------------------------------- */

export const rooms: Room[] = [
  {
    id: "acs-morning",
    title: {
      en: "Morning resus: chest pain team drill",
      tr: "Sabah resüsitasyon: göğüs ağrısı ekip provası",
    },
    caseId: "em-acs-001",
    chiefComplaint: {
      en: "Central chest pain radiating to the left arm",
      tr: "Sol kola yayılan orta hat göğüs ağrısı",
    },
    status: "open",
    locale: "tr",
    host: emine,
    joinCode: "ACS-7K2",
    aiBackfill: true,
    acuityESI: 2,
    seats: [
      seat("doctor", emine, true, true),
      seat("nurse", baris, false),
      seat("paramedic", null, false),
    ],
  },
  {
    id: "sah-headache",
    title: {
      en: "Thunderclap headache: escalation practice",
      tr: "Gök gürültüsü baş ağrısı: yükseltme pratiği",
    },
    caseId: "em-sah-002",
    chiefComplaint: {
      en: "Sudden worst-ever headache",
      tr: "Aniden başlayan hayatının en şiddetli baş ağrısı",
    },
    status: "open",
    locale: "tr",
    host: kerem,
    joinCode: "SAH-9M4",
    aiBackfill: true,
    acuityESI: 2,
    seats: [
      seat("doctor", kerem, true, true),
      seat("nurse", ayla, true),
      seat("paramedic", ai("paramedic"), true),
    ],
  },
  {
    id: "pe-nightshift",
    title: {
      en: "Breathless patient: prehospital to bedside",
      tr: "Nefes darlığı: hastane öncesinden başucuna",
    },
    caseId: "em-pe-004",
    chiefComplaint: {
      en: "Sudden breathlessness and pleuritic chest pain",
      tr: "Ani nefes darlığı ve plöretik göğüs ağrısı",
    },
    status: "in-progress",
    locale: "en",
    host: selin,
    joinCode: "PE-3T8",
    aiBackfill: true,
    acuityESI: 2,
    seats: [
      seat("doctor", ai("doctor"), true),
      seat("nurse", baris, true),
      seat("paramedic", selin, true, true),
    ],
  },
  {
    id: "appy-solo",
    title: {
      en: "Right lower quadrant pain: solo lead + AI team",
      tr: "Sağ alt kadran ağrısı: tek lider + yapay zeka ekip",
    },
    caseId: "em-appy-003",
    chiefComplaint: {
      en: "Right lower quadrant abdominal pain",
      tr: "Sağ alt kadran karın ağrısı",
    },
    status: "open",
    locale: "en",
    host: ME,
    joinCode: "APP-5R1",
    aiBackfill: true,
    acuityESI: 3,
    seats: [
      seat("doctor", ME, false, true),
      seat("nurse", ai("nurse"), true),
      seat("paramedic", ai("paramedic"), true),
    ],
  },
];

/** Look up a room by id. */
export function getRoom(id: string): Room | undefined {
  return rooms.find((r) => r.id === id);
}

/** Resolve the CaseInstance a room runs (from the seed library). */
export function roomCase(room: Room): CaseInstance | undefined {
  return getSeedCase(room.caseId);
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
/* In-room floor + closed-loop comms transcript (mock realtime)               */
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

/**
 * A short, believable floor transcript for the ACS team room. Shows closed-loop
 * communication: the doctor orders, the nurse reads back the locked token, the
 * loop closes. AI turns are explicitly flagged.
 */
export const acsFloor: FloorEvent[] = [
  {
    id: "f1",
    role: "paramedic",
    ai: false,
    kind: "handover",
    at: "00:20",
    text: {
      en: "ATMIST handover: 58-year-old man, central chest pain 40 minutes, diaphoretic, prehospital aspirin 300 mg given, GCS 15.",
      tr: "ATMIST devir: 58 yaşında erkek, 40 dakikadır orta hat göğüs ağrısı, terli, hastane öncesi 300 mg aspirin verildi, GKS 15.",
    },
  },
  {
    id: "f2",
    role: "doctor",
    ai: false,
    kind: "order",
    at: "01:05",
    text: {
      en: "12-lead ECG now, and troponin. Nurse, please confirm.",
      tr: "Hemen 12 derivasyonlu EKG ve troponin. Hemşire, lütfen onaylayın.",
    },
    loop: "closed",
  },
  {
    id: "f3",
    role: "nurse",
    ai: false,
    kind: "ack",
    at: "01:14",
    text: {
      en: "Read-back: 12-lead ECG and troponin, on it now.",
      tr: "Geri okuma: 12 derivasyonlu EKG ve troponin, hemen yapıyorum.",
    },
    loop: "closed",
  },
  {
    id: "f4",
    role: "doctor",
    ai: false,
    kind: "order",
    at: "02:30",
    text: {
      en: "Give aspirin 300 mg oral if not already, and GTN 0.4 mg sublingual. Confirm the doses.",
      tr: "Verilmediyse 300 mg aspirin oral, ve 0.4 mg dilaltı GTN. Dozları onaylayın.",
    },
    loop: "open",
    lockedToken: "GTN 0.4 mg SL",
  },
  {
    id: "f5",
    role: "nurse",
    ai: true,
    kind: "assess",
    at: "02:52",
    text: {
      en: "Monitor update: HR 104, BP 148/92, SpO2 95% on room air. Pain now 7/10.",
      tr: "Monitör güncelleme: KH 104, TA 148/92, SpO2 %95 oda havasında. Ağrı şimdi 7/10.",
    },
  },
];

/* -------------------------------------------------------------------------- */
/* Debrief marks (individual leadership ⟂ team clinical) — mock               */
/* -------------------------------------------------------------------------- */

export interface DebriefMark {
  label: Bilingual;
  /** 0-100 score for the mock bar. */
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

export const acsDebrief: DebriefData = {
  woreHat: true,
  leadership: [
    {
      label: { en: "Delegation", tr: "Görev dağılımı" },
      score: 82,
      note: {
        en: "Assigned ECG and troponin with named owners inside 90 seconds.",
        tr: "EKG ve troponini 90 saniye içinde adı belirtilen kişilere atadı.",
      },
    },
    {
      label: { en: "Situational awareness", tr: "Durum farkındalığı" },
      score: 74,
      note: {
        en: "Re-summarised the shared picture after the vitals update.",
        tr: "Vital güncellemesinden sonra ortak tabloyu yeniden özetledi.",
      },
    },
    {
      label: { en: "Closed-loop communication", tr: "Kapalı döngü iletişim" },
      score: 68,
      note: {
        en: "Two of three orders were read back and confirmed; one loop left open.",
        tr: "Üç istemin ikisi geri okundu ve onaylandı; bir döngü açık kaldı.",
      },
    },
  ],
  teamClinical: [
    {
      label: { en: "Timely ECG", tr: "Zamanında EKG" },
      score: 88,
      note: {
        en: "12-lead obtained within the first-ECG target window.",
        tr: "12 derivasyonlu EKG ilk-EKG hedef aralığında alındı.",
      },
    },
    {
      label: { en: "Guideline-concordant therapy", tr: "Kılavuza uygun tedavi" },
      score: 79,
      note: {
        en: "Aspirin and anti-ischaemic therapy matched the ACS pathway.",
        tr: "Aspirin ve anti-iskemik tedavi AKS yolağıyla uyumluydu.",
      },
    },
    {
      label: { en: "Safe escalation", tr: "Güvenli yükseltme" },
      score: 84,
      note: {
        en: "Cardiology activated once the ECG changes were confirmed.",
        tr: "EKG değişiklikleri doğrulanınca kardiyoloji aktive edildi.",
      },
    },
  ],
};
