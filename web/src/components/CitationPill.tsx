import { useTranslation } from "react-i18next";
import { ArrowSquareOut, BookOpen, CloudSlash } from "@phosphor-icons/react";
import { Tooltip } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  useGuidelineCitation,
  type CitationView,
} from "@/lib/guidelinesApi";
import type { Lang } from "@/data/schema"; // watchdog: allow (shared schema hub, type only)

export interface CitationPillProps {
  /** A verified GuidelineStatement id (or a legacy alias; see guidelinesApi). */
  citationId: string;
  lang: Lang;
  /** Optional guideline section anchor, e.g. "5.1" -> "NICE NG185 §5.1". */
  section?: string;
  /**
   * When the caller already holds the citation payload (tips / grounding), pass
   * it to render synchronously without a round trip.
   */
  citation?: CitationView | null;
  className?: string;
}

/**
 * CitationPill — a guideline citation chip backed by the VERIFIED statement
 * store. It renders the source body + edition as the chip, reveals the source
 * title, edition, verification date and the exact verified passage on
 * hover/focus, and links to the source URL (new tab). When the backend is off
 * or the statement is not verified it renders an explicit "source unavailable"
 * chip; it never falls back to hard-coded citation text.
 */
export function CitationPill({ citationId, lang, section, citation, className }: CitationPillProps) {
  const { t } = useTranslation();
  const fetched = useGuidelineCitation(citation ? "" : citationId, lang);
  const view = citation ?? fetched.citation;
  const status = citation ? "ready" : fetched.status;

  if (status === "loading") {
    return (
      <span
        aria-busy="true"
        className={cn(
          "inline-flex h-6 min-w-[5rem] animate-pulse items-center rounded-full border border-border bg-bg-subtle px-2.5",
          className,
        )}
      >
        <span className="sr-only">{t("guidance3.citation.loading", { defaultValue: "Loading citation" })}</span>
      </span>
    );
  }

  if (!view) {
    return (
      <Tooltip
        content={
          <p className="max-w-xs text-muted">
            {t("guidance3.citation.unavailableBody", {
              defaultValue:
                "This source has not been verified against its document, so it is not shown. Nothing here is invented.",
            })}
          </p>
        }
      >
        <span
          role="status"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border border-dashed border-border bg-bg-subtle px-2.5 py-0.5 text-xs font-medium text-subtle",
            className,
          )}
        >
          <CloudSlash weight="bold" className="h-3 w-3" aria-hidden />
          {t("guidance3.citation.unavailable", { defaultValue: "Source unavailable" })}
        </span>
      </Tooltip>
    );
  }

  const label = section ? `${view.label} §${section}` : view.label;
  const verified = view.verifiedAt ? view.verifiedAt.slice(0, 10) : "";

  return (
    <Tooltip
      content={
        <div className="flex max-w-sm flex-col gap-1 text-start">
          <p className="font-medium text-fg">{label}</p>
          <p className="text-muted">{view.title}</p>
          <p className="text-muted">
            {view.body}
            {view.edition ? ` · ${view.edition}` : ""}
          </p>
          {view.quote ? (
            <p className="border-s-2 border-border ps-2 text-[11px] italic leading-snug text-muted">
              {view.quote.length > 240 ? `${view.quote.slice(0, 239)}…` : view.quote}
            </p>
          ) : null}
          <p className="text-[10px] uppercase tracking-wide text-muted">
            {verified
              ? t("guidance3.citation.verified", { defaultValue: "Verified {{date}}", date: verified })
              : t("guidance3.citation.unverifiedDate", { defaultValue: "Verification date unknown" })}
            {view.doi ? ` · DOI ${view.doi}` : ""}
          </p>
        </div>
      }
    >
      <a
        href={view.url || undefined}
        target="_blank"
        rel="noreferrer"
        aria-label={t("feedback.process.citationAria", { source: label })}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-subtle px-2.5 py-0.5 text-xs font-medium text-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
          className,
        )}
      >
        <BookOpen weight="bold" className="h-3 w-3" aria-hidden />
        {label}
        {view.url ? <ArrowSquareOut weight="bold" className="h-3 w-3 opacity-70" aria-hidden /> : null}
      </a>
    </Tooltip>
  );
}
