/**
 * AcuDx — Start / session-setup options (Journey 1.3-1.5, docs/design/01).
 *
 * Screen-specific static content for the onboarding screen: the session MODE
 * (Solo vs AI · Multiplayer room · Observe), the participant ROLE
 * (Doctor / Nurse / Paramedic / Examiner), and the pickable chief-complaint
 * families. Kept out of schema.ts so the onboarding surface owns its own data.
 *
 * Education only. Synthetic content. No real patient data.
 */

import type { Bilingual } from "@/data/schema";
import { CHIEF_COMPLAINT_FAMILIES, type ChiefComplaintFamily } from "@/domain/caseGen";

/* -------------------------------------------------------------------------- */
/* Session mode                                                                */
/* -------------------------------------------------------------------------- */

export type SessionMode = "solo" | "multiplayer" | "observe";

export interface ModeOption {
  id: SessionMode;
  /** Phosphor icon name (resolved in the page to keep this file import-light). */
  icon: "User" | "UsersThree" | "Eye";
  label: Bilingual;
  description: Bilingual;
  /** Every mode leads to a real destination; kept for deep-link preselection. */
  available: boolean;
  /** Optional chip; no live mode is gated, so none is set today. */
  badge?: Bilingual;
}

export const MODE_OPTIONS: ModeOption[] = [
  {
    id: "solo",
    icon: "User",
    label: { en: "Solo with AI", tr: "Yapay zeka ile tek başına" },
    description: {
      en: "You run the encounter; the patient and any missing roles are played by AI.",
      tr: "Karşılaşmayı siz yürütürsünüz; hasta ve boş roller yapay zeka tarafından oynanır.",
    },
    available: true,
  },
  {
    id: "multiplayer",
    icon: "UsersThree",
    label: { en: "Multiplayer room", tr: "Çok oyunculu oda" },
    description: {
      en: "Several people share one live case, each in a distinct role; AI fills empty seats.",
      tr: "Birkaç kişi tek bir canlı olguyu paylaşır, her biri ayrı bir rolde; boş koltukları yapay zeka doldurur.",
    },
    available: true,
  },
  {
    id: "observe",
    icon: "Eye",
    label: { en: "Observe", tr: "İzle" },
    description: {
      en: "Watch an encounter unfold without taking a seat, then review the reasoning.",
      tr: "Bir koltuğa oturmadan karşılaşmayı izleyin, ardından muhakemeyi gözden geçirin.",
    },
    available: true,
  },
];

/* -------------------------------------------------------------------------- */
/* Participant role                                                            */
/* -------------------------------------------------------------------------- */

export type EncounterRole = "doctor" | "nurse" | "paramedic" | "examiner";

export interface RoleOption {
  id: EncounterRole;
  icon: "Stethoscope" | "FirstAid" | "Ambulance" | "ClipboardText";
  label: Bilingual;
  /** One-line plain-language scope note (docs/design/01 §1.3). */
  scope: Bilingual;
  available: boolean;
  badge?: Bilingual;
}

export const ROLE_OPTIONS: RoleOption[] = [
  {
    id: "doctor",
    icon: "Stethoscope",
    label: { en: "Doctor", tr: "Hekim" },
    scope: {
      en: "Take the history, examine, order the workup, and commit a diagnosis and plan.",
      tr: "Anamnez alın, muayene edin, tetkikleri isteyin, tanı ve planı belirleyin.",
    },
    available: true,
  },
  {
    id: "nurse",
    icon: "FirstAid",
    label: { en: "Nurse", tr: "Hemşire" },
    scope: {
      en: "Assess, monitor, and escalate with a clear handover. Not diagnosis-first.",
      tr: "Değerlendirin, izleyin ve net bir devirle yükseltin. Tanı öncelikli değildir.",
    },
    available: true,
  },
  {
    id: "paramedic",
    icon: "Ambulance",
    label: { en: "Paramedic", tr: "Paramedik" },
    scope: {
      en: "Work the prehospital picture: primary survey, stabilise, and hand over to the team.",
      tr: "Hastane öncesi tabloyu yönetin: birincil bakı, stabilizasyon ve ekibe devir.",
    },
    available: true,
  },
  {
    id: "examiner",
    icon: "ClipboardText",
    label: { en: "Examiner", tr: "Değerlendirici" },
    scope: {
      en: "Observe read-only and score against the rubric in a live room.",
      tr: "Canlı bir odada yalnızca okuma modunda gözlemleyin ve ölçüte göre puanlayın.",
    },
    available: true,
  },
];

/* -------------------------------------------------------------------------- */
/* Chief-complaint families (maps 1:1 onto caseGen constraints)                */
/* -------------------------------------------------------------------------- */

export interface ChiefComplaintOption {
  /** null = "Surprise me" (random draw across the presentation table). */
  id: ChiefComplaintFamily | null;
  /** Phosphor icon NAME (resolved to a component in StartPage's CC_ICON map). */
  icon: string;
  label: Bilingual;
  /** Short teaching hint about what this family rehearses. */
  hint: Bilingual;
}

/** Default first tile — a weighted random draw across every family. */
const SURPRISE_ME: ChiefComplaintOption = {
  id: null,
  icon: "Shuffle",
  label: { en: "Surprise me", tr: "Sürpriz olsun" },
  hint: {
    en: "Drawn by prevalence and teaching value across all families.",
    tr: "Tüm gruplardan sıklık ve öğretim değerine göre seçilir.",
  },
};

/**
 * The family tiles are DERIVED from the generator's canonical family list
 * (@/domain/caseGen `CHIEF_COMPLAINT_FAMILIES`), so EVERY organ-system family the
 * generator supports is targetable and any newly-added family surfaces
 * automatically. "Surprise me" (id:null) stays the default first tile.
 */
export const CHIEF_COMPLAINT_OPTIONS: ChiefComplaintOption[] = [
  SURPRISE_ME,
  ...CHIEF_COMPLAINT_FAMILIES.map((f) => ({
    id: f.id,
    icon: f.icon ?? "Heartbeat",
    label: f.label,
    hint: f.hint ?? { en: "", tr: "" },
  })),
];

/** Difficulty band descriptors for the 1-5 dial (docs/design/01 §1.4). */
export const DIFFICULTY_LABELS: Record<1 | 2 | 3 | 4 | 5, Bilingual> = {
  1: { en: "Gentle", tr: "Nazik" },
  2: { en: "Guided", tr: "Rehberli" },
  3: { en: "Core", tr: "Çekirdek" },
  4: { en: "Stretch", tr: "Zorlayıcı" },
  5: { en: "Expert", tr: "Uzman" },
};
