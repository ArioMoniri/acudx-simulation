/**
 * Educator case-authoring model — Journey 7,
 * docs/design/01 §7.1-7.4, docs/00-overview/04 §3 (GEN-*), requirements AU-1/AU-2.
 *
 * The authoring contract this module renders:
 *   - AI DRAFTS, the human is AUTHORITATIVE. Every AI-proposed clinical fact
 *     carries a provenance chip (grounding source + guideline version) and a
 *     LOCK control; nothing publishes until it is either cited-and-locked or
 *     edited-and-locked.
 *   - A CREDENTIALED CLINICIAN SIGN-OFF gate is enforced in code, not policy:
 *     publish is disabled until the co-sign box is checked and the AUTHENTICATED
 *     reviewer's real identity + role are recorded (profileStore, no fake name).
 *   - The drafting model is named at the TIER level only (DC-1), never a vendor.
 *   - Bilingual-aware: a case is only OFFERED in the locale a clinician-fluent
 *     reviewer actually co-signed; the other locale trails as reviewer-pending.
 *
 * P9 — the pipeline is REAL, not a single hardcoded ACS walk:
 *   - The Blueprint stage takes a real prompt (presentation family / specialty +
 *     difficulty) and generates the draft facts + rubric with `generateCase(...)`
 *     (src/domain/caseGen.ts). Every downstream stage reflects THAT draft.
 *   - "Publish" persists the case to a dependency-free localStorage store
 *     (`useSyncExternalStore`, mirroring progressStore). The published-cases list
 *     and the monitor counts read from that store — no fixed fixtures.
 *   - Timestamps are stamped at SAVE time (never Date.now at module load); the
 *     draft derivation is a pure function of a CaseInstance.
 *
 * Education only. Synthetic patients. No real patient data.
 *
 * -----------------------------------------------------------------------------
 * LEGACY COMPAT NOTE. The authoring barrel (src/components/authoring/index.ts)
 * still exports four components that the LIVE page no longer renders —
 * PipelineRail, BlueprintCard, SignOffGate, MonitorList. They are type-checked by
 * `tsc --noEmit`, so a handful of legacy exports below (`sampleBlueprint`,
 * `lockedFacts`, `signOffClinician`, `peerReviewSignals`, `versionHashes`,
 * `publishedCases`) are retained ONLY so those unused components keep compiling.
 * None of them feed the live AuthoringPage, which is driven entirely by the real
 * draft derivation + persisted store further down this file.
 * -----------------------------------------------------------------------------
 */

import { useSyncExternalStore } from "react";

import type { Bilingual, FeedbackDomainKey, Lang } from "@/data/mock";
import { getCitation } from "@/data/mock";
import { CODE_SYSTEMS } from "@/domain/fhir";
import type { CaseInstance } from "@/domain/case";
import {
  CHIEF_COMPLAINT_FAMILIES,
  type ChiefComplaintFamily,
} from "@/domain/caseGen";
import type { ProfileRole, UserProfile } from "@/state/profileStore";

/* -------------------------------------------------------------------------- */
/* The six-stage pipeline (AU-1: blueprint -> monitor)                         */
/* -------------------------------------------------------------------------- */

export const PIPELINE_STAGES = [
  "blueprint",
  "draft",
  "review",
  "psychometric",
  "publish",
  "monitor",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** Where a stage sits relative to the focused one. */
export type StageState = "done" | "active" | "pending";

export interface PipelineStageMeta {
  key: PipelineStage;
  /** Whether this stage is human-authoritative, AI-drafted, or automated. */
  actor: "ai" | "human" | "auto";
  state: StageState;
}

/**
 * The pipeline spine. The live stepper computes each node's display via
 * {@link stageDisplayState} from the focused index; `state` here is seed
 * metadata (also read by the legacy PipelineRail).
 */
export const pipelineStages: PipelineStageMeta[] = [
  { key: "blueprint", actor: "human", state: "active" },
  { key: "draft", actor: "ai", state: "pending" },
  { key: "review", actor: "human", state: "pending" },
  { key: "psychometric", actor: "auto", state: "pending" },
  { key: "publish", actor: "human", state: "pending" },
  { key: "monitor", actor: "auto", state: "pending" },
];

/** Derived display state for a pipeline node, given the focused stage. */
export function stageDisplayState(
  index: number,
  current: number,
  published: boolean,
): StageState {
  if (published && index <= current) return "done";
  if (index < current) return "done";
  if (index === current) return "active";
  return "pending";
}

/* -------------------------------------------------------------------------- */
/* Fact + rubric shapes (shared by the live page and the legacy components)    */
/* -------------------------------------------------------------------------- */

/**
 * A single AI-drafted clinical fact under review. It cannot reach a learner
 * until it is LOCKED, and it cannot be locked unless it carries a grounded
 * citation (citation-or-refuse extends into authoring). "flagged" facts are
 * ungrounded and block publish until resolved.
 */
export type FactStatus = "locked" | "edited-locked" | "open" | "flagged";

export type FactKind =
  | "persona"
  | "vitals"
  | "finding"
  | "result"
  | "medication"
  | "safety";

export interface LockedFact {
  id: string;
  kind: FactKind;
  claim: Bilingual;
  /** The guideline / knowledge source this fact is grounded to. */
  citationId: string;
  /** Optional guideline section anchor (e.g. "5.1"). */
  section?: string;
  status: FactStatus;
  /** True when a human edited the AI draft before locking (provenance trail). */
  humanEdited: boolean;
  /** Safety-critical facts are surfaced separately and always (INV-6). */
  safetyCritical: boolean;
}

export interface RubricItem {
  id: string;
  /** The graded behaviour. */
  behavior: Bilingual;
  domain: FeedbackDomainKey;
  axis: "clinical" | "communication";
  /** Relative weight (already normalised for display). */
  weight: number;
  safetyCritical: boolean;
  citationId: string;
  section?: string;
  /** Whether both TR and EN anchors have been authored + reviewed. */
  bilingualReady: boolean;
}

export interface DomainCoverage {
  domain: FeedbackDomainKey;
  axis: "clinical" | "communication";
  /** Rubric items covering this domain. */
  items: number;
}

/* -------------------------------------------------------------------------- */
/* Blueprint types                                                             */
/* -------------------------------------------------------------------------- */

/** country/council is independent of locale (INV-10). */
export interface ContentLocale {
  locale: "en" | "tr";
  /** Reviewed = a clinician-fluent reviewer signed the locale's content off. */
  status: "reviewed" | "in-review" | "not-started";
  /** Reviewer handle once reviewed, else null. */
  reviewer: string | null;
}

/** The static case-brief shape (legacy compat for BlueprintCard / SignOffGate). */
export interface CaseBlueprint {
  caseId: string;
  title: Bilingual;
  chiefComplaint: Bilingual;
  icd11: { code: string; label: Bilingual };
  icd10: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  difficultyBand: Bilingual;
  learnerLevel: Bilingual;
  country: string;
  council: string;
  contentLocales: ContentLocale[];
  objectives: Bilingual[];
}

/* -------------------------------------------------------------------------- */
/* Difficulty bands + demographic phrasing                                     */
/* -------------------------------------------------------------------------- */

/** Difficulty tier -> a bilingual band label (used by the blueprint summary). */
export const DIFFICULTY_BANDS: Record<1 | 2 | 3 | 4 | 5, Bilingual> = {
  1: { en: "Foundation", tr: "Temel" },
  2: { en: "Developing", tr: "Gelişen" },
  3: { en: "Core", tr: "Çekirdek" },
  4: { en: "Advanced", tr: "İleri" },
  5: { en: "Expert", tr: "Uzman" },
};

const GENDER_WORD: Record<CaseInstance["patient"]["gender"], Bilingual> = {
  male: { en: "man", tr: "erkek" },
  female: { en: "woman", tr: "kadın" },
  other: { en: "adult", tr: "yetişkin" },
  unknown: { en: "adult", tr: "yetişkin" },
};

function systemShort(system: string): string {
  if (system === CODE_SYSTEMS.icd10) return "ICD-10";
  if (system === CODE_SYSTEMS.icd11) return "ICD-11";
  if (system === CODE_SYSTEMS.dsm5tr) return "DSM-5-TR";
  if (system === CODE_SYSTEMS.loinc) return "LOINC";
  if (system === CODE_SYSTEMS.snomed) return "SNOMED CT";
  return "Code";
}

/* -------------------------------------------------------------------------- */
/* Draft derivation — a pure function of a generated CaseInstance              */
/* -------------------------------------------------------------------------- */

/** The blueprint the stages render, derived from the generated draft. */
export interface DraftBlueprint {
  caseId: string;
  title: Bilingual;
  chiefComplaint: Bilingual;
  diagnosis: Bilingual;
  /** e.g. "ICD-10 · I21.4". */
  codeLabel: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  difficultyBand: Bilingual;
  /** The requested presentation family / specialty, or null for a random draw. */
  family: ChiefComplaintFamily | null;
  familyLabel: Bilingual;
  redFlags: Bilingual[];
  objectives: Bilingual[];
  /** The citation the case-level facts are grounded to. */
  primaryCitationId: string;
  /** Human-readable set of guideline sources this draft cites. */
  guidelineSet: string;
}

/** Everything the interactive stages read for one generated draft. */
export interface DraftBundle {
  caseInstance: CaseInstance;
  blueprint: DraftBlueprint;
  facts: LockedFact[];
  rubric: RubricItem[];
  coverage: DomainCoverage[];
  /** How many of the six competency domains the rubric covers. */
  coveredDomains: number;
}

const DOMAIN_AXES: { key: FeedbackDomainKey; axis: "clinical" | "communication" }[] = [
  { key: "history", axis: "clinical" },
  { key: "exam", axis: "clinical" },
  { key: "reasoning", axis: "clinical" },
  { key: "management", axis: "clinical" },
  { key: "communication", axis: "communication" },
  { key: "professionalism", axis: "communication" },
];

function personaClaim(c: CaseInstance): Bilingual {
  const word = GENDER_WORD[c.patient.gender];
  const age = c.patient.ageYears;
  return {
    en: `Synthetic patient: ${age}-year-old ${word.en} presenting with ${c.chiefComplaint.en.toLowerCase()}.`,
    tr: `Sentetik hasta: ${age} yaşında ${word.tr}; ${c.chiefComplaint.tr} ile başvuruyor.`,
  };
}

function vitalsClaim(v: CaseInstance["triageVitals"]): Bilingual {
  return {
    en: `Triage vitals: HR ${v.hr}, BP ${v.systolic}/${v.diastolic}, RR ${v.rr}, SpO2 ${v.spo2}% on room air, temp ${v.tempC} C.`,
    tr: `Triyaj vitalleri: KH ${v.hr}, KB ${v.systolic}/${v.diastolic}, SS ${v.rr}, oda havasında SpO2 %${v.spo2}, ateş ${v.tempC} C.`,
  };
}

function labClaim(l: CaseInstance["groundTruth"]["labs"][number]): Bilingual {
  const o = l.observation;
  const name = o.code.coding[0]?.display ?? o.code.text?.en ?? "Result";
  const q = o.valueQuantity;
  const value = q ? `${q.value} ${q.unit}` : (o.valueString?.en ?? "");
  const valueTr = q ? `${q.value} ${q.unit}` : (o.valueString?.tr ?? "");
  const ref = o.referenceRange ? ` (ref ${o.referenceRange})` : "";
  return { en: `${name}: ${value}${ref}`, tr: `${name}: ${valueTr}${ref}` };
}

function imagingClaim(im: CaseInstance["groundTruth"]["imaging"][number]): Bilingual {
  const c = im.report.conclusion ?? im.modality;
  return {
    en: `${im.modality.en}: ${c.en}`,
    tr: `${im.modality.tr}: ${c.tr}`,
  };
}

/** Derive the AI-drafted, provenance-carrying facts from a generated case. */
function factsFromCase(c: CaseInstance, primaryCitationId: string): LockedFact[] {
  const seed = c.seed.toString(36);
  const facts: LockedFact[] = [
    {
      id: `f-${seed}-persona`,
      kind: "persona",
      claim: personaClaim(c),
      citationId: primaryCitationId,
      status: "open",
      humanEdited: false,
      safetyCritical: false,
    },
    {
      id: `f-${seed}-vitals`,
      kind: "vitals",
      claim: vitalsClaim(c.triageVitals),
      citationId: primaryCitationId,
      status: "open",
      humanEdited: false,
      safetyCritical: false,
    },
  ];

  c.groundTruth.exam
    .filter((e) => e.abnormal)
    .slice(0, 3)
    .forEach((e, i) => {
      facts.push({
        id: `f-${seed}-exam-${i}`,
        kind: "finding",
        claim: e.finding,
        citationId: primaryCitationId,
        status: "open",
        humanEdited: false,
        safetyCritical: false,
      });
    });

  c.groundTruth.labs.slice(0, 2).forEach((l, i) => {
    facts.push({
      id: `f-${seed}-lab-${i}`,
      kind: "result",
      claim: labClaim(l),
      citationId: primaryCitationId,
      status: "open",
      humanEdited: false,
      safetyCritical: false,
    });
  });

  const img = c.groundTruth.imaging[0];
  if (img) {
    facts.push({
      id: `f-${seed}-img`,
      kind: "result",
      claim: imagingClaim(img),
      citationId: primaryCitationId,
      status: "open",
      humanEdited: false,
      safetyCritical: false,
    });
  }

  c.redFlags.slice(0, 2).forEach((rf, i) => {
    facts.push({
      id: `f-${seed}-safety-${i}`,
      kind: "safety",
      claim: rf,
      citationId: primaryCitationId,
      status: "open",
      humanEdited: false,
      safetyCritical: true,
    });
  });

  return facts;
}

const ICE_ITEM = {
  en: "Elicited the patient's ideas, concerns, and expectations",
  tr: "Hastanın fikirlerini, endişelerini ve beklentilerini öğrendi",
};
const SHARE_ITEM = {
  en: "Shared the working diagnosis clearly without false reassurance",
  tr: "Çalışan tanıyı yanlış güvence vermeden açıkça paylaştı",
};
const ALLERGY_ITEM = {
  en: "Checked allergies before first-dose treatment",
  tr: "İlk doz tedaviden önce alerjileri sorguladı",
};
const REDFLAG_ITEM = {
  en: "Screened the can't-miss red flags before narrowing the differential",
  tr: "Ayırıcı tanıyı daraltmadan önce atlanmaması gereken kırmızı bayrakları taradı",
};
const EXAM_ITEM = {
  en: "Performed the focused examination that surfaces the key findings",
  tr: "Anahtar bulguları ortaya çıkaran odaklı muayeneyi yaptı",
};

/** Derive the weighted, domain-tagged, cited rubric from a generated case. */
function rubricFromCase(c: CaseInstance, primaryCitationId: string): RubricItem[] {
  const seed = c.seed.toString(36);
  const raw: RubricItem[] = [];

  c.expectedWorkup.forEach((w, i) => {
    const min = Math.max(1, Math.round(w.idealWindowMs / 60000));
    raw.push({
      id: `r-${seed}-w-${i}`,
      behavior: {
        en: `Ordered ${w.label.en} within ${min} minutes of arrival`,
        tr: `Varıştan sonraki ${min} dakika içinde ${w.label.tr} istedi`,
      },
      domain: w.kind === "procedure" ? "management" : "reasoning",
      axis: "clinical",
      weight: w.critical ? 3 : 2,
      safetyCritical: w.critical,
      citationId: w.citationId,
      bilingualReady: true,
    });
  });

  if (c.redFlags.length > 0) {
    raw.push({
      id: `r-${seed}-redflag`,
      behavior: REDFLAG_ITEM,
      domain: "history",
      axis: "clinical",
      weight: 2,
      safetyCritical: false,
      citationId: primaryCitationId,
      bilingualReady: true,
    });
  }

  if (c.groundTruth.exam.some((e) => e.abnormal)) {
    raw.push({
      id: `r-${seed}-exam`,
      behavior: EXAM_ITEM,
      domain: "exam",
      axis: "clinical",
      weight: 2,
      safetyCritical: false,
      citationId: primaryCitationId,
      bilingualReady: true,
    });
  }

  raw.push({
    id: `r-${seed}-allergy`,
    behavior: ALLERGY_ITEM,
    domain: "management",
    axis: "clinical",
    weight: 3,
    safetyCritical: true,
    citationId: primaryCitationId,
    bilingualReady: true,
  });
  raw.push({
    id: `r-${seed}-ice`,
    behavior: ICE_ITEM,
    domain: "communication",
    axis: "communication",
    weight: 2,
    safetyCritical: false,
    citationId: "tepdad-em",
    bilingualReady: true,
  });
  raw.push({
    id: `r-${seed}-share`,
    behavior: SHARE_ITEM,
    domain: "communication",
    axis: "communication",
    weight: 2,
    safetyCritical: false,
    citationId: "tepdad-em",
    bilingualReady: true,
  });

  // Normalise weights for display (percent of the whole, deterministic rounding).
  const total = raw.reduce((s, r) => s + r.weight, 0) || 1;
  return raw.map((r) => ({ ...r, weight: Math.round((r.weight / total) * 100) }));
}

function coverageFromRubric(rubric: RubricItem[]): DomainCoverage[] {
  return DOMAIN_AXES.map((d) => ({
    domain: d.key,
    axis: d.axis,
    items: rubric.filter((r) => r.domain === d.key).length,
  }));
}

function distinctCitationIds(facts: LockedFact[], rubric: RubricItem[]): string[] {
  const ids = new Set<string>();
  for (const f of facts) ids.add(f.citationId);
  for (const r of rubric) ids.add(r.citationId);
  return Array.from(ids);
}

function guidelineSetOf(citationIds: string[]): string {
  const labels = citationIds
    .map((id) => getCitation(id)?.label)
    .filter((l): l is string => Boolean(l));
  return Array.from(new Set(labels)).join(" · ");
}

/**
 * deriveDraft — the single pure transform from a generated {@link CaseInstance}
 * to the blueprint + facts + rubric + coverage the six stages render. Same case
 * in => same draft out; nothing here reads the clock.
 */
export function deriveDraft(
  c: CaseInstance,
  family: ChiefComplaintFamily | null,
): DraftBundle {
  const firstCritical = c.expectedWorkup.find((w) => w.critical) ?? c.expectedWorkup[0];
  const primaryCitationId = firstCritical?.citationId ?? "tepdad-em";

  const facts = factsFromCase(c, primaryCitationId);
  const rubric = rubricFromCase(c, primaryCitationId);
  const coverage = coverageFromRubric(rubric);
  const coveredDomains = coverage.filter((d) => d.items > 0).length;

  const word = GENDER_WORD[c.patient.gender];
  const coding = c.correctDiagnosis.code.coding[0];
  const diagnosis =
    c.correctDiagnosis.code.text ??
    (coding ? { en: coding.display, tr: coding.display } : c.chiefComplaint);
  const familyMeta = family
    ? CHIEF_COMPLAINT_FAMILIES.find((f) => f.id === family)
    : undefined;

  const objectives: Bilingual[] = [
    ...c.expectedWorkup
      .filter((w) => w.critical)
      .slice(0, 2)
      .map((w) => {
        const min = Math.max(1, Math.round(w.idealWindowMs / 60000));
        return {
          en: `Order ${w.label.en} within ${min} minutes for this presentation`,
          tr: `Bu tabloda ${min} dakika içinde ${w.label.tr} isteyin`,
        };
      }),
    { en: REDFLAG_ITEM.en, tr: REDFLAG_ITEM.tr },
    { en: ALLERGY_ITEM.en, tr: ALLERGY_ITEM.tr },
  ];

  const citationIds = distinctCitationIds(facts, rubric);

  const blueprint: DraftBlueprint = {
    caseId: c.id,
    title: {
      en: `${c.chiefComplaint.en} — ${c.patient.ageYears}-year-old ${word.en}`,
      tr: `${c.patient.ageYears} yaşında ${word.tr}: ${c.chiefComplaint.tr}`,
    },
    chiefComplaint: c.chiefComplaint,
    diagnosis,
    codeLabel: coding ? `${systemShort(coding.system)} · ${coding.code}` : "",
    difficulty: c.difficulty,
    difficultyBand: DIFFICULTY_BANDS[c.difficulty],
    family,
    familyLabel: familyMeta?.label ?? c.chiefComplaint,
    redFlags: c.redFlags,
    objectives,
    primaryCitationId,
    guidelineSet: guidelineSetOf(citationIds),
  };

  return { caseInstance: c, blueprint, facts, rubric, coverage, coveredDomains };
}

/* -------------------------------------------------------------------------- */
/* Draft-readiness signals (honest pre-flight, derived from the draft)         */
/* -------------------------------------------------------------------------- */

export interface ReadinessSignal {
  id: string;
  label: Bilingual;
  /** Pre-formatted value (locale-agnostic digits). */
  value: string;
  note: Bilingual;
  /** Whether this signal is inside the acceptable band. */
  ok: boolean;
}

/**
 * The pre-sign-off readiness read-out — real, checkable properties of THIS draft
 * (rubric size, safety coverage, domain breadth, differential breadth) rather
 * than fabricated pilot statistics.
 */
export function readinessSignals(draft: DraftBundle): ReadinessSignal[] {
  const safetyItems = draft.rubric.filter((r) => r.safetyCritical).length;
  const differentials = draft.caseInstance.differentials.length;
  return [
    {
      id: "rubric-items",
      label: { en: "Rubric items", tr: "Rubrik maddeleri" },
      value: String(draft.rubric.length),
      note: {
        en: "Weighted, domain-tagged behaviours derived from the draft's expected workup and communication.",
        tr: "Taslağın beklenen tetkik ve iletişiminden türeyen, ağırlıklı ve alan etiketli davranışlar.",
      },
      ok: draft.rubric.length >= 6,
    },
    {
      id: "safety-items",
      label: { en: "Safety-critical items", tr: "Güvenlik-kritik maddeler" },
      value: String(safetyItems),
      note: {
        en: "Behaviours a miss of which is a safety-critical error for this presentation.",
        tr: "Bu tabloda kaçırılması güvenlik açısından kritik hata olan davranışlar.",
      },
      ok: safetyItems >= 1,
    },
    {
      id: "domain-coverage",
      label: { en: "Domains covered", tr: "Kapsanan alanlar" },
      value: `${draft.coveredDomains} / 6`,
      note: {
        en: "Competency domains the rubric touches. Professionalism has no encounter instrument and stays uncovered.",
        tr: "Rubriğin dokunduğu yeterlilik alanları. Profesyonellik için karşılaşma aracı yok ve kapsanmaz.",
      },
      ok: draft.coveredDomains >= 4,
    },
    {
      id: "differentials",
      label: { en: "Differentials", tr: "Ayırıcı tanılar" },
      value: String(differentials),
      note: {
        en: "Distractor diagnoses the case discriminates against — the breadth of the decision.",
        tr: "Vakanın ayırt ettiği çeldirici tanılar — kararın genişliği.",
      },
      ok: differentials >= 2,
    },
  ];
}

/* -------------------------------------------------------------------------- */
/* Fact edit state + the publish gate (pure)                                   */
/* -------------------------------------------------------------------------- */

/** Live edit state for a single fact as the reviewer works through it. */
export interface FactEditState {
  status: FactStatus;
  /** True once a clinician edited the AI draft before locking. */
  humanEdited: boolean;
}

/** id -> live edit state. */
export type FactEditMap = Record<string, FactEditState>;

/** A fresh edit map seeded from a draft's facts (all AI-drafted, i.e. open). */
export function makeFactMap(facts: LockedFact[]): FactEditMap {
  const map: FactEditMap = {};
  for (const f of facts) map[f.id] = { status: f.status, humanEdited: f.humanEdited };
  return map;
}

/** A fact is "locked" for publish once it is locked or edited-and-locked. */
export function isFactLocked(status: FactStatus): boolean {
  return status === "locked" || status === "edited-locked";
}

/**
 * Facts that still block publish: flagged (ungrounded) or open (cited but not
 * yet locked). Publish stays disabled while this list is non-empty.
 */
export function publishBlockers(facts: LockedFact[], edits: FactEditMap): string[] {
  return facts
    .filter((f) => {
      const s = edits[f.id]?.status ?? f.status;
      return s === "flagged" || s === "open";
    })
    .map((f) => f.id);
}

export function factsClear(facts: LockedFact[], edits: FactEditMap): boolean {
  return publishBlockers(facts, edits).length === 0;
}

/** How many facts are currently locked (for the review-progress read-out). */
export function lockedCount(facts: LockedFact[], edits: FactEditMap): number {
  return facts.filter((f) => isFactLocked(edits[f.id]?.status ?? f.status)).length;
}

/**
 * FNV-1a 32-bit short hash — a deterministic 8-hex content fingerprint. Not a
 * cryptographic hash; it exists so the version identity visibly changes as the
 * reviewed content changes, then freezes at sign-off.
 */
export function shortHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Live case fingerprint recomputed from the current fact lock states. */
export function caseFingerprint(facts: LockedFact[], edits: FactEditMap): string {
  const parts = facts.map((f) => {
    const s = edits[f.id] ?? { status: f.status, humanEdited: f.humanEdited };
    return `${f.id}:${s.status}:${s.humanEdited ? 1 : 0}`;
  });
  return shortHash(parts.join("|"));
}

/** Rubric fingerprint over ids + weights + safety flags. */
export function rubricFingerprint(rubric: RubricItem[]): string {
  return shortHash(
    rubric.map((r) => `${r.id}:${r.weight}:${r.safetyCritical ? 1 : 0}`).join("|"),
  );
}

/* -------------------------------------------------------------------------- */
/* Reviewer identity — the REAL, authenticated co-signer (profileStore)        */
/* -------------------------------------------------------------------------- */

export interface ReviewerIdentity {
  /** The person's real full name from their profile. */
  name: string;
  roleKey: ProfileRole;
  /** Localised role label (no fabricated registration number). */
  role: Bilingual;
  institution: string;
  specialty?: string;
}

export const ROLE_LABELS: Record<ProfileRole, Bilingual> = {
  student: { en: "Medical student", tr: "Tıp öğrencisi" },
  resident: { en: "Resident physician", tr: "Asistan hekim" },
  educator: { en: "Clinician educator", tr: "Klinisyen eğitici" },
  dean: { en: "Faculty dean", tr: "Fakülte dekanı" },
  admin: { en: "Platform administrator", tr: "Platform yöneticisi" },
};

/**
 * The roles that hold real teaching-faculty credentials and may co-sign +
 * publish a case. Co-signing attests a case is safe for learners, so it is
 * gated to educators and deans — a student or resident cannot sign off, even
 * with a completed profile. This mirrors `profile.role` (the client-side
 * permission source today; a Supabase wave later makes it server-verified).
 */
export function isCredentialedRole(role: ProfileRole): boolean {
  return role === "educator" || role === "dean";
}

/**
 * Build the co-signer identity from the authenticated profile, or null.
 *
 * Returns null unless the profile is onboarded, carries a real name, AND holds
 * a credentialed teaching role (educator / dean). A non-credentialed account
 * (student / resident) yields null so it can never co-sign or publish a case
 * attributed to a fabricated credential.
 */
export function reviewerFromProfile(p: UserProfile | null): ReviewerIdentity | null {
  if (!p || !p.onboarded || p.fullName.trim() === "") return null;
  if (!isCredentialedRole(p.role)) return null;
  return {
    name: p.fullName,
    roleKey: p.role,
    role: ROLE_LABELS[p.role],
    institution: p.institution,
    specialty: p.specialty,
  };
}

/* -------------------------------------------------------------------------- */
/* Published-case store (persisted; useSyncExternalStore, dependency-free)      */
/* -------------------------------------------------------------------------- */

export interface PublishedCase {
  id: string;
  title: Bilingual;
  /** Short version hash pinned at publish (= case fingerprint). */
  versionHash: string;
  /** YYYY-MM-DD last-reviewed date (= publish date). */
  lastReviewed: string;
  /** Per-locale offer status. */
  locales: { locale: "en" | "tr"; offered: boolean }[];
  /** Live freshness-watch status; freshly published cases are "live". */
  status: "live" | "flagged" | "en-only";
  /** Why a case was flagged (guideline drift), else null. */
  flagReason: Bilingual | null;
  /** Stored encounter count; the live monitor shows the real progressStore count. */
  encounters: number;

  /* --- real authoring provenance (P9) --- */
  chiefComplaint: Bilingual;
  diagnosis: Bilingual;
  codeLabel: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  difficultyBand: Bilingual;
  /** ISO 8601 timestamp stamped at save time. */
  publishedAt: string;
  rubricHash: string;
  /** The authenticated clinician who co-signed. */
  reviewer: ReviewerIdentity;
  /** The locale the reviewer co-signed in (the offered locale). */
  reviewedLocale: Lang;
  guidelineSet: string;
  citationIds: string[];
  factCount: number;
  rubricItemCount: number;
  safetyCriticalCount: number;
  /** The full generated case, so "Open" can hand it to the encounter workspace. */
  caseInstance: CaseInstance;
}

/**
 * LEGACY COMPAT ONLY. The unused MonitorList component imports `publishedCases`.
 * There are deliberately NO fixtures — the live monitor reads the persisted store
 * below, and a fresh account starts with an honest empty library.
 */
export const publishedCases: PublishedCase[] = [];

export interface PublishInput {
  draft: DraftBundle;
  edits: FactEditMap;
  reviewer: ReviewerIdentity;
  /** The locale the reviewer co-signed in. */
  reviewedLocale: Lang;
  caseHash: string;
  rubricHash: string;
}

const STORE_KEY = "acudx-authored-cases:v1";

interface AuthoredState {
  cases: PublishedCase[];
}

function isBilingual(v: unknown): v is Bilingual {
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as Record<string, unknown>).en === "string" &&
    typeof (v as Record<string, unknown>).tr === "string"
  );
}

function isPublishedCase(v: unknown): v is PublishedCase {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    isBilingual(o.title) &&
    typeof o.versionHash === "string" &&
    typeof o.publishedAt === "string" &&
    !!o.caseInstance &&
    typeof o.caseInstance === "object" &&
    typeof (o.caseInstance as Record<string, unknown>).id === "string" &&
    !!o.reviewer &&
    typeof o.reviewer === "object"
  );
}

function loadAuthored(): AuthoredState {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { cases: [] };
    const parsed = JSON.parse(raw) as unknown;
    const cases = Array.isArray(parsed) ? parsed.filter(isPublishedCase) : [];
    // Newest first.
    cases.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
    return { cases };
  } catch {
    return { cases: [] };
  }
}

function persistAuthored(next: AuthoredState): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(next.cases));
  } catch {
    /* storage unavailable — keep in-memory only */
  }
}

let authoredState: AuthoredState = loadAuthored();
const authoredListeners = new Set<() => void>();

function emitAuthored(): void {
  for (const l of authoredListeners) l();
}

function setAuthored(next: AuthoredState): void {
  authoredState = next;
  persistAuthored(next);
  emitAuthored();
}

/**
 * Persist a published case. Stamps the id + timestamp at SAVE time (never at
 * module load), prepends it (newest first), and returns the stored record.
 */
export function publishCase(input: PublishInput): PublishedCase {
  const { draft, reviewer, reviewedLocale, caseHash, rubricHash } = input;
  const now = new Date();
  const publishedAt = now.toISOString();
  const locales: { locale: "en" | "tr"; offered: boolean }[] = [
    { locale: "en", offered: reviewedLocale === "en" },
    { locale: "tr", offered: reviewedLocale === "tr" },
  ];
  const safetyCriticalCount =
    draft.rubric.filter((r) => r.safetyCritical).length +
    draft.facts.filter((f) => f.safetyCritical).length;

  const record: PublishedCase = {
    id: `pub-${now.getTime().toString(36)}-${shortHash(caseHash + publishedAt)}`,
    title: draft.blueprint.title,
    versionHash: caseHash,
    lastReviewed: publishedAt.slice(0, 10),
    locales,
    status: reviewedLocale === "en" ? "en-only" : "live",
    flagReason: null,
    encounters: 0,
    chiefComplaint: draft.blueprint.chiefComplaint,
    diagnosis: draft.blueprint.diagnosis,
    codeLabel: draft.blueprint.codeLabel,
    difficulty: draft.blueprint.difficulty,
    difficultyBand: draft.blueprint.difficultyBand,
    publishedAt,
    rubricHash,
    reviewer,
    reviewedLocale,
    guidelineSet: draft.blueprint.guidelineSet,
    citationIds: distinctCitationIds(draft.facts, draft.rubric),
    factCount: draft.facts.length,
    rubricItemCount: draft.rubric.length,
    safetyCriticalCount,
    caseInstance: draft.caseInstance,
  };

  setAuthored({ cases: [record, ...authoredState.cases] });
  return record;
}

/** Remove a published case from the persisted library. */
export function removePublishedCase(id: string): void {
  setAuthored({ cases: authoredState.cases.filter((c) => c.id !== id) });
}

/** Read the persisted published cases without subscribing. */
export function getPublishedCases(): PublishedCase[] {
  return authoredState.cases;
}

function subscribeAuthored(listener: () => void): () => void {
  authoredListeners.add(listener);
  return () => {
    authoredListeners.delete(listener);
  };
}

/** Live published-cases list (newest first), driven by the persisted store. */
export function usePublishedCases(): PublishedCase[] {
  return useSyncExternalStore(
    subscribeAuthored,
    () => authoredState.cases,
    () => authoredState.cases,
  );
}

/* -------------------------------------------------------------------------- */
/* Interactive authoring UI state + reducer                                    */
/* -------------------------------------------------------------------------- */

export interface FrozenVersion {
  caseHash: string;
  rubricHash: string;
}

/** The whole interactive authoring surface, as one serialisable state. */
export interface AuthoringUIState {
  /** Index into {@link pipelineStages} for the focused stage. */
  stageIndex: number;
  /** The generated draft, or null before a blueprint has been generated. */
  draft: DraftBundle | null;
  /** id -> live fact edit state (seeded from the draft). */
  edits: FactEditMap;
  /** Credentialed clinician has ticked the co-sign box. */
  cosigned: boolean;
  published: boolean;
  /** Version hashes frozen on publish; null until then. */
  frozen: FrozenVersion | null;
  /** Id of the persisted case created on publish (for the monitor highlight). */
  publishedId: string | null;
}

export const INITIAL_STAGE_INDEX = 0;
const LAST_STAGE = pipelineStages.length - 1;
const MONITOR_STAGE = pipelineStages.findIndex((s) => s.key === "monitor");

export function makeInitialAuthoringState(): AuthoringUIState {
  return {
    stageIndex: INITIAL_STAGE_INDEX,
    draft: null,
    edits: {},
    cosigned: false,
    published: false,
    frozen: null,
    publishedId: null,
  };
}

export type AuthoringAction =
  | { type: "generate"; caseInstance: CaseInstance; family: ChiefComplaintFamily | null }
  | { type: "setStage"; index: number }
  | { type: "next" }
  | { type: "prev" }
  | { type: "lock"; id: string }
  | { type: "editLock"; id: string }
  | { type: "ground"; id: string }
  | { type: "unlock"; id: string }
  | { type: "cosign"; value: boolean }
  | {
      type: "publish";
      publishedId: string;
      caseHash: string;
      rubricHash: string;
      /** The co-signer holds a credentialed teaching role (educator / dean). */
      credentialed: boolean;
    }
  | { type: "reset" };

function clampStage(i: number): number {
  return Math.max(0, Math.min(LAST_STAGE, i));
}

function setFact(edits: FactEditMap, id: string, next: FactEditState): FactEditMap {
  if (!edits[id]) return edits;
  return { ...edits, [id]: next };
}

/**
 * The single source of truth for the authoring gate. Generating a blueprint
 * seeds the draft; publish only takes effect when the co-sign box is ticked AND
 * every fact is grounded and locked. The store write itself is performed by the
 * page (an explicit side effect) and its id/hashes flow back through `publish`.
 */
export function authoringReducer(
  state: AuthoringUIState,
  action: AuthoringAction,
): AuthoringUIState {
  switch (action.type) {
    case "generate": {
      const draft = deriveDraft(action.caseInstance, action.family);
      return {
        ...state,
        draft,
        edits: makeFactMap(draft.facts),
        cosigned: false,
        published: false,
        frozen: null,
        publishedId: null,
      };
    }
    case "setStage":
      return { ...state, stageIndex: clampStage(action.index) };
    case "next":
      return { ...state, stageIndex: clampStage(state.stageIndex + 1) };
    case "prev":
      return { ...state, stageIndex: clampStage(state.stageIndex - 1) };
    case "lock": {
      const cur = state.edits[action.id];
      if (!cur || cur.status !== "open") return state;
      return {
        ...state,
        edits: setFact(state.edits, action.id, { ...cur, status: "locked" }),
      };
    }
    case "editLock": {
      const cur = state.edits[action.id];
      if (!cur || cur.status !== "open") return state;
      return {
        ...state,
        edits: setFact(state.edits, action.id, {
          status: "edited-locked",
          humanEdited: true,
        }),
      };
    }
    case "ground": {
      const cur = state.edits[action.id];
      if (!cur || cur.status !== "flagged") return state;
      return {
        ...state,
        edits: setFact(state.edits, action.id, {
          status: "edited-locked",
          humanEdited: true,
        }),
      };
    }
    case "unlock": {
      const cur = state.edits[action.id];
      if (!cur || !isFactLocked(cur.status)) return state;
      // Unlocking re-opens the fact, which re-blocks publish (the gate is live).
      return {
        ...state,
        cosigned: false,
        edits: setFact(state.edits, action.id, { ...cur, status: "open" }),
      };
    }
    case "cosign":
      return { ...state, cosigned: action.value };
    case "publish": {
      // Hard gate: a draft, co-signed by a CREDENTIALED clinician (educator /
      // dean), and no ungrounded/unlocked facts. The credential check is
      // enforced here, not just in the page, so a non-credentialed account can
      // never publish even if it reaches this action.
      if (
        !state.draft ||
        !state.cosigned ||
        !action.credentialed ||
        !factsClear(state.draft.facts, state.edits)
      ) {
        return state;
      }
      return {
        ...state,
        published: true,
        frozen: { caseHash: action.caseHash, rubricHash: action.rubricHash },
        publishedId: action.publishedId,
        stageIndex: MONITOR_STAGE < 0 ? state.stageIndex : MONITOR_STAGE,
      };
    }
    case "reset":
      return makeInitialAuthoringState();
    default:
      return state;
  }
}

/* -------------------------------------------------------------------------- */
/* Legacy compat data (unused barrel components only — see the header note)     */
/* -------------------------------------------------------------------------- */

/** Legacy sample brief for the unused BlueprintCard / SignOffGate components. */
export const sampleBlueprint: CaseBlueprint = {
  caseId: "ACS-EM-0247",
  title: {
    en: "Acute chest pain in a 58-year-old man",
    tr: "58 yaşında erkekte akut göğüs ağrısı",
  },
  chiefComplaint: { en: "Central chest pain", tr: "Orta hat göğüs ağrısı" },
  icd11: {
    code: "BA41",
    label: { en: "Acute coronary syndrome", tr: "Akut koroner sendrom" },
  },
  icd10: "I20.0",
  difficulty: 3,
  difficultyBand: { en: "Core", tr: "Çekirdek" },
  learnerLevel: { en: "Year 5 to intern", tr: "5. sınıf ile intern" },
  country: "TR",
  council: "TEPDAD / UÇEP",
  contentLocales: [
    { locale: "en", status: "reviewed", reviewer: "Dr. E. Kaya" },
    { locale: "tr", status: "in-review", reviewer: "Dr. S. Demir" },
  ],
  objectives: [
    {
      en: "Order a 12-lead ECG within 10 minutes for suspected ACS",
      tr: "AKS şüphesinde ilk 10 dakikada 12 derivasyonlu EKG istemek",
    },
    {
      en: "Screen for red flags before narrowing the differential",
      tr: "Ayırıcı tanıyı daraltmadan önce kırmızı bayrakları taramak",
    },
    {
      en: "Check allergies before first-dose aspirin",
      tr: "İlk doz aspirinden önce alerjileri sorgulamak",
    },
    {
      en: "Communicate a working diagnosis without false reassurance",
      tr: "Yanlış güvence vermeden çalışan tanıyı iletmek",
    },
  ],
};

/** Legacy sample facts for the unused SignOffGate component. */
export const lockedFacts: LockedFact[] = [
  {
    id: "fact-ecg",
    kind: "finding",
    claim: {
      en: "12-lead ECG shows 1.5 mm ST depression in leads V4 to V6 with T-wave inversion; no ST elevation.",
      tr: "12 derivasyonlu EKG'de V4-V6'da 1,5 mm ST çökmesi ve T dalga inversiyonu; ST yükselmesi yok.",
    },
    citationId: "esc-acs-2023",
    section: "5.1",
    status: "locked",
    humanEdited: false,
    safetyCritical: true,
  },
  {
    id: "fact-aspirin",
    kind: "medication",
    claim: {
      en: "Expected first-dose management: aspirin 300 mg orally after allergy check, plus analgesia titrated to pain.",
      tr: "Beklenen ilk doz yönetimi: alerji kontrolünden sonra 300 mg oral aspirin ve ağrıya göre titre edilen analjezi.",
    },
    citationId: "esc-acs-2023",
    section: "6.2",
    status: "edited-locked",
    humanEdited: true,
    safetyCritical: true,
  },
];

export interface PeerReviewSignal {
  id: string;
  labelKey: string;
  value: string;
  note: Bilingual;
  ok: boolean;
}

/** Legacy peer-review signals for the unused SignOffGate component. */
export const peerReviewSignals: PeerReviewSignal[] = [
  {
    id: "peer-agreement",
    labelKey: "authoring.psychometric.agreement",
    value: "2",
    note: {
      en: "Two peer clinicians reviewed the rubric anchors.",
      tr: "İki akran hekim rubrik çapalarını inceledi.",
    },
    ok: true,
  },
];

export interface Credential {
  name: string;
  credential: Bilingual;
  registration: string;
  role: Bilingual;
}

/** Legacy credential for the unused SignOffGate component. */
export const signOffClinician: Credential = {
  name: "Dr. Elif Kaya",
  credential: {
    en: "Emergency Medicine specialist",
    tr: "Acil Tıp uzmanı",
  },
  registration: "",
  role: { en: "Case lead reviewer", tr: "Vaka baş değerlendiricisi" },
};

/** Legacy version hashes for the unused SignOffGate component. */
export const versionHashes = {
  caseVersionHash: "c7a1f9e2",
  rubricVersionHash: "9b3d0e14",
  guidelineSet: "ESC ACS 2023 · NICE NG185 · TEPDAD-UÇEP 2024",
};
