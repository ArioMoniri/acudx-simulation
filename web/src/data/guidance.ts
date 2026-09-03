import { getCitation, type Bilingual, type Lang } from "@/data/mock";

/* -------------------------------------------------------------------------- */
/* Guidance provenance                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Provenance metadata layered on top of a base {@link import("@/data/mock").Citation}.
 *
 * It lives here — not in `mock.ts` — so this polish can ship without editing a
 * file other engineers are writing to. The records are joined to the base
 * citation by `citationId` at read time (see {@link getGuidanceProvenance}).
 *
 * Domain content that reads differently in each language (issuing body,
 * evidence grade, scope phrase) is stored as {@link Bilingual}, mirroring how
 * `mock.ts` already stores `Citation.source`. Purely structural UI chrome
 * (labels, aria strings) lives in `i18n/features/guidance2.*.json` instead.
 */
export interface GuidanceProvenance {
  citationId: string;
  /** Full name of the issuing body, e.g. "European Society of Cardiology". */
  organization: Bilingual;
  /** Edition or document identifier, standardized and language-neutral. */
  edition: string;
  /** The source's own recommendation grade, when it publishes one. */
  evidenceGrade?: Bilingual;
  /** How often the local snapshot is re-reviewed, in months. */
  reviewCadenceMonths: number;
  /** Stable id of the clinical scope this snapshot is validated for. */
  scope: GuidanceScopeKey;
  /** Human phrase for the covered scope, used by the abstain note. */
  scopeLabel: Bilingual;
}

/**
 * Clinical scope a guideline snapshot is validated for. It drives the
 * abstain-when-out-of-scope note: when a learner's step moves outside the
 * scope a hint is grounded in, guidance holds back rather than guess.
 */
export type GuidanceScopeKey =
  | "acs-triage"
  | "acs-diagnosis"
  | "emergency-competency"
  | "drug-safety";

const PROVENANCE: Record<string, GuidanceProvenance> = {
  "esc-acs-2023": {
    citationId: "esc-acs-2023",
    organization: {
      en: "European Society of Cardiology",
      tr: "Avrupa Kardiyoloji Derneği",
    },
    edition: "2023",
    evidenceGrade: { en: "Class I, Level B", tr: "Sınıf I, Düzey B" },
    reviewCadenceMonths: 24,
    scope: "acs-diagnosis",
    scopeLabel: {
      en: "acute coronary syndrome diagnosis and early management",
      tr: "akut koroner sendrom tanısı ve erken yönetimi",
    },
  },
  "nice-ng185": {
    citationId: "nice-ng185",
    organization: {
      en: "National Institute for Health and Care Excellence",
      tr: "Ulusal Sağlık ve Bakım Mükemmeliyet Enstitüsü (NICE)",
    },
    edition: "NG185 · 2020",
    evidenceGrade: { en: "Strong recommendation", tr: "Güçlü öneri" },
    reviewCadenceMonths: 18,
    scope: "acs-triage",
    scopeLabel: {
      en: "acute coronary syndrome triage",
      tr: "akut koroner sendrom triyajı",
    },
  },
  "tepdad-em": {
    citationId: "tepdad-em",
    organization: {
      en: "Association for Evaluation and Accreditation of Medical Education Programs",
      tr: "Tıp Eğitimi Programları Değerlendirme ve Akreditasyon Derneği (TEPDAD)",
    },
    edition: "2020",
    reviewCadenceMonths: 36,
    scope: "emergency-competency",
    scopeLabel: {
      en: "core emergency presentation competencies",
      tr: "temel acil başvuru yeterlilikleri",
    },
  },
  "titck-formulary": {
    citationId: "titck-formulary",
    organization: {
      en: "Turkish Medicines and Medical Devices Agency",
      tr: "Türkiye İlaç ve Tıbbi Cihaz Kurumu (TİTCK)",
    },
    edition: "2025",
    reviewCadenceMonths: 12,
    scope: "drug-safety",
    scopeLabel: {
      en: "medicines safety and interactions",
      tr: "ilaç güvenliği ve etkileşimleri",
    },
  },
};

/* -------------------------------------------------------------------------- */
/* Date helpers                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Format an ISO snapshot date for a locale, e.g. "2 Nov 2024" / "2 Kas 2024".
 * Falls back to the raw ISO string if the value or the environment's Intl
 * support is missing, so the card never renders "Invalid Date".
 */
export function formatReviewDate(iso: string, lang: Lang): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(lang === "tr" ? "tr-TR" : "en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(parsed);
  } catch {
    return iso;
  }
}

/** Add whole months to an ISO date, returning `yyyy-mm-dd`. */
function addMonths(iso: string, months: number): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  parsed.setMonth(parsed.getMonth() + months);
  return parsed.toISOString().slice(0, 10);
}

/* -------------------------------------------------------------------------- */
/* Read model                                                                 */
/* -------------------------------------------------------------------------- */

/** Flattened, locale-resolved provenance the card renders directly. */
export interface GuidanceProvenanceView {
  citationId: string;
  /** Short label, e.g. "ESC ACS 2023". */
  label: string;
  /** Full source title from the base citation. */
  source: string;
  organization: string;
  edition: string;
  evidenceGrade?: string;
  scope: GuidanceScopeKey;
  scopeLabel: string;
  reviewCadenceMonths: number;
  /** Raw ISO last-reviewed date (for `<time datetime>`). */
  lastReviewedISO: string;
  /** Localized last-reviewed date. */
  lastReviewed: string;
  /** Raw ISO next-review-due date (last reviewed + cadence). */
  nextReviewISO: string;
  /** Localized next-review-due date. */
  nextReview: string;
}

/**
 * Join a base citation to its enriched provenance and resolve every field for
 * one language. Returns `undefined` when either the base citation or the
 * provenance record is missing, so callers can fall back gracefully.
 */
export function getGuidanceProvenance(
  citationId: string,
  lang: Lang,
): GuidanceProvenanceView | undefined {
  const citation = getCitation(citationId);
  const provenance = PROVENANCE[citationId];
  if (!citation || !provenance) return undefined;

  const nextReviewISO = addMonths(citation.lastReviewed, provenance.reviewCadenceMonths);

  return {
    citationId,
    label: citation.label,
    source: citation.source[lang],
    organization: provenance.organization[lang],
    edition: provenance.edition,
    evidenceGrade: provenance.evidenceGrade?.[lang],
    scope: provenance.scope,
    scopeLabel: provenance.scopeLabel[lang],
    reviewCadenceMonths: provenance.reviewCadenceMonths,
    lastReviewedISO: citation.lastReviewed,
    lastReviewed: formatReviewDate(citation.lastReviewed, lang),
    nextReviewISO,
    nextReview: formatReviewDate(nextReviewISO, lang),
  };
}
