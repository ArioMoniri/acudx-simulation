/**
 * Educator case-authoring mock data — Journey 7,
 * docs/design/01 §7.1-7.4, docs/00-overview/04 §3 (GEN-*), requirements AU-1/AU-2.
 *
 * The authoring contract this data renders:
 *   - AI DRAFTS, the human is AUTHORITATIVE. Every AI-proposed clinical fact
 *     carries a provenance chip (grounding source + guideline version) and a
 *     LOCK control; nothing publishes until it is either cited-and-locked or
 *     edited-and-locked.
 *   - A CREDENTIALED CLINICIAN SIGN-OFF gate is enforced in code, not policy:
 *     publish is disabled until the co-sign box is checked and identity +
 *     credential are recorded. On approval the case + rubric freeze with
 *     case_version_hash / rubric_version_hash.
 *   - The drafting model is named at the TIER level only (DC-1), never a vendor.
 *   - Bilingual-aware: a case is only OFFERED in a locale whose text + rubric
 *     passed clinician-fluent review; TR can trail EN (per-locale review status).
 *
 * The sample case is realistic emergency-medicine content (adult chest pain /
 * suspected ACS), grounded in real guideline sources, with de-identified
 * synthetic patient details. No real names, no "Acme".
 */

import type { Bilingual, FeedbackDomainKey } from "@/data/mock";

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

/** Where the sample case is in the pipeline right now. */
export type StageState = "done" | "active" | "pending";

export interface PipelineStageMeta {
  key: PipelineStage;
  /** Whether this stage is human-authoritative, AI-drafted, or automated. */
  actor: "ai" | "human" | "auto";
  state: StageState;
}

/**
 * The sample case sits at the expert-review stage: blueprint and AI draft are
 * done, review is in progress, and the downstream stages are pending. This is
 * the human-authoritative core of the loop (Screen 7.2).
 */
export const pipelineStages: PipelineStageMeta[] = [
  { key: "blueprint", actor: "human", state: "done" },
  { key: "draft", actor: "ai", state: "done" },
  { key: "review", actor: "human", state: "active" },
  { key: "psychometric", actor: "auto", state: "pending" },
  { key: "publish", actor: "human", state: "pending" },
  { key: "monitor", actor: "auto", state: "pending" },
];

/* -------------------------------------------------------------------------- */
/* Blueprint (Screen 7.1) — the case brief the AI drafted from                 */
/* -------------------------------------------------------------------------- */

export interface CaseBlueprint {
  /** Human-readable case id (shown in the editor header). */
  caseId: string;
  title: Bilingual;
  chiefComplaint: Bilingual;
  /** ICD-11 code + label, the sampling axis (docs/00-overview/04 §3.1). */
  icd11: { code: string; label: Bilingual };
  icd10: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  difficultyBand: Bilingual;
  learnerLevel: Bilingual;
  /** country/council is independent of locale (INV-10). */
  country: string;
  council: string;
  /** Locales this case targets, with independent review status. */
  contentLocales: ContentLocale[];
  /** Learning objectives the rubric must cover. */
  objectives: Bilingual[];
}

export interface ContentLocale {
  locale: "en" | "tr";
  /** Reviewed = a clinician-fluent reviewer signed the locale's content off. */
  status: "reviewed" | "in-review" | "not-started";
  /** Reviewer handle once reviewed, else null. */
  reviewer: string | null;
}

export const sampleBlueprint: CaseBlueprint = {
  caseId: "ACS-EM-0247",
  title: {
    en: "Acute chest pain in a 58-year-old man",
    tr: "58 yaşında erkekte akut göğüs ağrısı",
  },
  chiefComplaint: { en: "Central chest pain", tr: "Orta hat göğüs ağrısı" },
  icd11: {
    code: "BA41",
    label: {
      en: "Acute coronary syndrome",
      tr: "Akut koroner sendrom",
    },
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

/* -------------------------------------------------------------------------- */
/* Locked facts + provenance (Screen 7.2, the human-authoritative core)        */
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

/**
 * The case ground-truth facts, as they appear in the review editor. Most are
 * locked; one persona line was human-edited before locking; one vitals fact is
 * still open (cited, not yet locked); and one drug-interaction fact is FLAGGED
 * because the draft could not be grounded, which blocks publish (Screen 7.2
 * error state). This is the "sample case being reviewed with cited guideline
 * facts" the screen requires.
 */
export const lockedFacts: LockedFact[] = [
  {
    id: "fact-persona",
    kind: "persona",
    claim: {
      en: "Synthetic patient: 58-year-old man, retired teacher, presents with 40 minutes of central pressure-like chest pain radiating to the left arm, with nausea and diaphoresis.",
      tr: "Sentetik hasta: 58 yaşında erkek, emekli öğretmen; 40 dakikadır sol kola yayılan, baskı tarzında orta hat göğüs ağrısı, bulantı ve terleme ile başvuruyor.",
    },
    citationId: "esc-acs-2023",
    section: "3.2",
    status: "edited-locked",
    humanEdited: true,
    safetyCritical: false,
  },
  {
    id: "fact-vitals",
    kind: "vitals",
    claim: {
      en: "Triage vitals: HR 96, BP 148/92, RR 18, SpO2 96% on room air, temp 36.8 C, pain 7/10.",
      tr: "Triyaj vitalleri: KH 96, KB 148/92, SS 18, oda havasında SpO2 %96, ateş 36,8 C, ağrı 7/10.",
    },
    citationId: "nice-ng185",
    status: "open",
    humanEdited: false,
    safetyCritical: false,
  },
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
    id: "fact-troponin",
    kind: "result",
    claim: {
      en: "High-sensitivity troponin T: 62 ng/L at 0 h, rising to 210 ng/L at 1 h (0/1 h algorithm rule-in).",
      tr: "Yüksek duyarlıklı troponin T: 0. saatte 62 ng/L, 1. saatte 210 ng/L'ye yükseliyor (0/1 saat algoritması ile tanı doğrulama).",
    },
    citationId: "esc-acs-2023",
    section: "5.3",
    status: "locked",
    humanEdited: false,
    safetyCritical: false,
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
  {
    id: "fact-interaction",
    kind: "safety",
    claim: {
      en: "Draft interaction note for concurrent anticoagulation could not be grounded to the TR national formulary and is held for review.",
      tr: "Eşzamanlı antikoagülasyon için taslak etkileşim notu TR ulusal formülerine dayandırılamadı ve inceleme için bekletiliyor.",
    },
    citationId: "titck-formulary",
    status: "flagged",
    humanEdited: false,
    safetyCritical: true,
  },
];

/* -------------------------------------------------------------------------- */
/* Rubric items (Screen 7.2) — behaviour, anchors, weight, safety flag         */
/* -------------------------------------------------------------------------- */

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

/**
 * A representative slice of the 10 to 40 rubric items (docs/design/01 §7.2).
 * Weighted, domain-tagged, safety-flagged, and cited. The two safety-critical
 * items (ECG timing, allergy check) mirror the locked safety facts above.
 */
export const rubricItems: RubricItem[] = [
  {
    id: "rub-ecg",
    behavior: {
      en: "Ordered a 12-lead ECG within 10 minutes of arrival",
      tr: "Varıştan sonraki 10 dakika içinde 12 derivasyonlu EKG istedi",
    },
    domain: "reasoning",
    axis: "clinical",
    weight: 18,
    safetyCritical: true,
    citationId: "esc-acs-2023",
    section: "5.1",
    bilingualReady: true,
  },
  {
    id: "rub-redflag",
    behavior: {
      en: "Screened cardiac red flags before narrowing the differential",
      tr: "Ayırıcı tanıyı daraltmadan önce kardiyak kırmızı bayrakları taradı",
    },
    domain: "history",
    axis: "clinical",
    weight: 14,
    safetyCritical: false,
    citationId: "nice-ng185",
    bilingualReady: true,
  },
  {
    id: "rub-allergy",
    behavior: {
      en: "Checked allergies before prescribing first-dose aspirin",
      tr: "İlk doz aspirini reçete etmeden önce alerjileri sorguladı",
    },
    domain: "management",
    axis: "clinical",
    weight: 16,
    safetyCritical: true,
    citationId: "esc-acs-2023",
    section: "6.2",
    bilingualReady: true,
  },
  {
    id: "rub-troponin",
    behavior: {
      en: "Interpreted the 0/1 h troponin trend rather than a single value",
      tr: "Tek bir değer yerine 0/1 saat troponin eğilimini yorumladı",
    },
    domain: "reasoning",
    axis: "clinical",
    weight: 12,
    safetyCritical: false,
    citationId: "esc-acs-2023",
    section: "5.3",
    bilingualReady: true,
  },
  {
    id: "rub-ice",
    behavior: {
      en: "Elicited the patient's ideas, concerns, and expectations",
      tr: "Hastanın fikirlerini, endişelerini ve beklentilerini öğrendi",
    },
    domain: "communication",
    axis: "communication",
    weight: 12,
    safetyCritical: false,
    citationId: "tepdad-em",
    bilingualReady: true,
  },
  {
    id: "rub-news",
    behavior: {
      en: "Shared the working diagnosis clearly without false reassurance",
      tr: "Çalışan tanıyı yanlış güvence vermeden açıkça paylaştı",
    },
    domain: "communication",
    axis: "communication",
    weight: 10,
    safetyCritical: false,
    citationId: "tepdad-em",
    bilingualReady: false,
  },
];

/* -------------------------------------------------------------------------- */
/* Domain coverage (Screen 7.2 live "coverage" indicator)                      */
/* -------------------------------------------------------------------------- */

export interface DomainCoverage {
  domain: FeedbackDomainKey;
  axis: "clinical" | "communication";
  /** Rubric items covering this domain. */
  items: number;
}

/** Which of the six domains the current rubric covers (all six here). */
export const domainCoverage: DomainCoverage[] = [
  { domain: "history", axis: "clinical", items: 2 },
  { domain: "exam", axis: "clinical", items: 2 },
  { domain: "reasoning", axis: "clinical", items: 4 },
  { domain: "management", axis: "clinical", items: 3 },
  { domain: "communication", axis: "communication", items: 3 },
  { domain: "professionalism", axis: "communication", items: 1 },
];

/* -------------------------------------------------------------------------- */
/* Psychometric / peer review (Screen: peer + psychometric stage)              */
/* -------------------------------------------------------------------------- */

export interface PeerReviewSignal {
  id: string;
  labelKey: string;
  /** Pre-formatted value (locale-agnostic digits). */
  value: string;
  /** Short read-out of what the signal means. */
  note: Bilingual;
  /** Whether this signal is inside the acceptable band. */
  ok: boolean;
}

/**
 * The peer + psychometric pre-flight, shown before sign-off. These are the
 * item-quality signals a reviewer weighs: inter-rater agreement on the rubric,
 * a small pilot pass rate, a difficulty read, and a DIF (differential item
 * functioning) check across TR and EN (the fairness pre-gate, DC-2). The pilot
 * cohort is de-identified and small; nothing here is a public metric.
 */
export const peerReviewSignals: PeerReviewSignal[] = [
  {
    id: "peer-agreement",
    labelKey: "authoring.psychometric.agreement",
    value: "2",
    note: {
      en: "Two peer clinicians reviewed the rubric anchors; both endorsed the safety-critical items.",
      tr: "İki akran hekim rubrik çapalarını inceledi; her ikisi de güvenlik açısından kritik maddeleri onayladı.",
    },
    ok: true,
  },
  {
    id: "peer-kappa",
    labelKey: "authoring.psychometric.kappa",
    value: "0,81",
    note: {
      en: "Inter-rater agreement on a 12-transcript pilot; above the 0.70 gate for reporting a band.",
      tr: "12 transkriptlik pilotta değerlendiriciler arası uyum; bant bildirimi için 0,70 eşiğinin üzerinde.",
    },
    ok: true,
  },
  {
    id: "peer-difficulty",
    labelKey: "authoring.psychometric.difficulty",
    value: "0,58",
    note: {
      en: "Pilot pass proportion; sits in the target range for a Core-level case.",
      tr: "Pilot geçme oranı; Çekirdek düzeyi bir vaka için hedef aralıkta.",
    },
    ok: true,
  },
  {
    id: "peer-dif",
    labelKey: "authoring.psychometric.dif",
    value: "TR / EN",
    note: {
      en: "No differential item functioning detected between TR and EN pilots on the clinical axis.",
      tr: "Klinik eksende TR ve EN pilotları arasında farklı madde işleyişi saptanmadı.",
    },
    ok: true,
  },
];

/* -------------------------------------------------------------------------- */
/* Sign-off gate (Screen 7.3) — credentialed clinician co-sign                 */
/* -------------------------------------------------------------------------- */

export interface Credential {
  /** Reviewer display name (real clinician credential, not "Jane Doe"). */
  name: string;
  /** Registered credential + council. */
  credential: Bilingual;
  /** Medical registration number (synthetic but realistic format). */
  registration: string;
  role: Bilingual;
}

/** The credentialed clinician whose co-sign the publish gate requires. */
export const signOffClinician: Credential = {
  name: "Dr. Elif Kaya",
  credential: {
    en: "Emergency Medicine specialist, TTB reg.",
    tr: "Acil Tıp uzmanı, TTB kaydı",
  },
  registration: "TR-EM-40912",
  role: {
    en: "Case lead reviewer",
    tr: "Vaka baş değerlendiricisi",
  },
};

/**
 * The version hashes the case + rubric freeze into on approval (Screen 7.3).
 * Shown as the provenance the published case carries; a monospace short hash
 * is the auditable identity a learner encounter and its feedback pin to.
 */
export const versionHashes = {
  caseVersionHash: "c7a1f9e2",
  rubricVersionHash: "9b3d0e14",
  guidelineSet: "ESC ACS 2023 · NICE NG185 · TEPDAD-UÇEP 2024",
};

/* -------------------------------------------------------------------------- */
/* Published & monitored cases (Screen 7.4)                                    */
/* -------------------------------------------------------------------------- */

export interface PublishedCase {
  id: string;
  title: Bilingual;
  /** Short version hash pinned at publish. */
  versionHash: string;
  lastReviewed: string;
  /** Per-locale offer status. */
  locales: { locale: "en" | "tr"; offered: boolean }[];
  /** Live freshness-watch status; "flagged" links back to review (7.2). */
  status: "live" | "flagged" | "en-only";
  /** Why a case was flagged (guideline drift), else null. */
  flagReason: Bilingual | null;
  /** Encounters run against this case (de-identified count, never a ranking). */
  encounters: number;
}

/**
 * The author's monitored, published cases. One is fully live in TR + EN, one is
 * flagged by the freshness watch because a guideline it cites changed (links
 * back to review, never auto-rewritten), and one is published EN-only awaiting
 * a Turkish clinician-fluent reviewer (the per-locale gate, Screen 7.3 TR gate).
 */
export const publishedCases: PublishedCase[] = [
  {
    id: "pub-01",
    title: {
      en: "Acute chest pain in a 58-year-old man",
      tr: "58 yaşında erkekte akut göğüs ağrısı",
    },
    versionHash: "c7a1f9e2",
    lastReviewed: "2026-05-14",
    locales: [
      { locale: "en", offered: true },
      { locale: "tr", offered: true },
    ],
    status: "live",
    flagReason: null,
    encounters: 148,
  },
  {
    id: "pub-02",
    title: {
      en: "Sudden severe headache in a 34-year-old woman",
      tr: "34 yaşında kadında ani şiddetli baş ağrısı",
    },
    versionHash: "4e82ab07",
    lastReviewed: "2025-11-02",
    locales: [
      { locale: "en", offered: true },
      { locale: "tr", offered: true },
    ],
    status: "flagged",
    flagReason: {
      en: "The cited subarachnoid-haemorrhage pathway was updated; review before the next cohort.",
      tr: "Atıf yapılan subaraknoid kanama yolağı güncellendi; bir sonraki kohorttan önce inceleyin.",
    },
    encounters: 96,
  },
  {
    id: "pub-03",
    title: {
      en: "Breathlessness in a 71-year-old man with COPD",
      tr: "KOAH'lı 71 yaşında erkekte nefes darlığı",
    },
    versionHash: "1af5d930",
    lastReviewed: "2026-06-01",
    locales: [
      { locale: "en", offered: true },
      { locale: "tr", offered: false },
    ],
    status: "en-only",
    flagReason: null,
    encounters: 42,
  },
];
