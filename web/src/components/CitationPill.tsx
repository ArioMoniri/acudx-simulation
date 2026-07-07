import { useTranslation } from "react-i18next";
import { BookOpen } from "@phosphor-icons/react";
import { Tooltip } from "@/components/ui";
import { getCitation, type Lang } from "@/data/mock";

export interface CitationPillProps {
  citationId: string;
  lang: Lang;
  /** Optional guideline section anchor, e.g. "5.1" -> "ESC ACS 2023 §5.1". */
  section?: string;
}

/**
 * CitationPill — a small guideline citation that reveals its provenance
 * (full source title + last-reviewed date) on hover/focus. Reused wherever a
 * process finding or treatment behavior is cited (docs/00-overview/04 §4.2:
 * every finding, including correct ones, is cited to a specific guideline).
 *
 * The pill is a real focusable button so keyboard users reach the provenance;
 * the accessible name always includes the citation label and section (WCAG 2.2).
 */
export function CitationPill({ citationId, lang, section }: CitationPillProps) {
  const { t } = useTranslation();
  const citation = getCitation(citationId);
  if (!citation) return null;

  const label = section ? `${citation.label} §${section}` : citation.label;

  return (
    <Tooltip
      content={
        <div className="flex flex-col gap-1">
          <p className="font-medium text-fg">{label}</p>
          <p className="text-muted">{citation.source[lang]}</p>
          <p className="text-[10px] uppercase tracking-wide text-muted">
            {t("feedback.process.lastReviewed", { date: citation.lastReviewed })}
          </p>
        </div>
      }
    >
      <button
        type="button"
        aria-label={t("feedback.process.citationAria", { source: label })}
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-subtle px-2.5 py-0.5 text-xs font-medium text-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <BookOpen weight="bold" className="h-3 w-3" aria-hidden />
        {label}
      </button>
    </Tooltip>
  );
}
