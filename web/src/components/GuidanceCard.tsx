import { useTranslation } from "react-i18next";
import { Lightbulb, BookOpen, ShieldCheck } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { Tooltip } from "@/components/ui";
import type { GuidanceHint, Lang } from "@/data/mock";
import { getCitation } from "@/data/mock";
import { getGuidanceProvenance } from "@/data/guidance";

export interface GuidanceCardProps {
  hint: GuidanceHint;
  lang: Lang;
  className?: string;
  /**
   * When the learner's step falls outside every grounded guideline, the card
   * renders an abstain state instead of a hint (guidance holds back rather than
   * guess). Optional and defaults to `false`, so existing callers that pass
   * only `{ hint, lang }` keep the original hint behaviour.
   */
  abstained?: boolean;
}

/**
 * GuidanceCard — a Socratic hint shown above the composer when guidance is on.
 *
 * Every hint is education-only and anchored to a specific guideline. The
 * citation is not a bare label: it is a focusable provenance pill that reveals
 * the issuing body, edition, evidence grade, and both review dates on hover or
 * keyboard focus (WCAG 2.2 — reachable and dismissible). The card also carries
 * a standing note that guidance abstains outside the scope a hint is grounded
 * in, and it can render a full abstain state when `abstained` is set.
 */
export function GuidanceCard({ hint, lang, className, abstained = false }: GuidanceCardProps) {
  const { t } = useTranslation();

  if (abstained) {
    return (
      <div
        role="note"
        aria-label={t("encounter.guidance.title")}
        className={cn(
          "rounded-card border border-border bg-bg-subtle p-3.5",
          "motion-safe:animate-[fade-up_var(--dur-base)_var(--ease-out)]",
          className,
        )}
      >
        <div className="flex items-start gap-2.5">
          <span
            aria-hidden="true"
            className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-border/60 text-muted"
          >
            <ShieldCheck weight="fill" className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-fg">
              {t("encounter.guidance.abstained")}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              {t("encounter.guidance.abstain.emptyBody")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const provenance = getGuidanceProvenance(hint.citationId, lang);
  // Fallback so any citation without an enriched provenance record still shows
  // a basic, correct label rather than nothing.
  const fallbackCitation = provenance ? null : getCitation(hint.citationId);
  const pillLabel = provenance?.label ?? fallbackCitation?.label ?? null;

  return (
    <div
      role="note"
      aria-label={t("encounter.guidance.title")}
      className={cn(
        "rounded-card border border-brand/30 bg-brand-tint/60 p-3.5",
        "motion-safe:animate-[fade-up_var(--dur-base)_var(--ease-out)]",
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand/15 text-brand"
        >
          <Lightbulb weight="fill" className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-brand">
              {t("encounter.guidance.title")}
            </span>
            <span className="rounded-full bg-brand/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-brand">
              {t("encounter.guidance.educationOnly")}
            </span>
          </div>

          <p className="mt-1 text-sm leading-relaxed text-fg">
            {hint.text[lang]}
          </p>

          {pillLabel ? (
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
              {provenance ? (
                <Tooltip
                  content={
                    <div className="flex flex-col gap-1 text-left">
                      <p className="font-medium text-fg">{provenance.label}</p>
                      <p className="text-muted">
                        {t("encounter.guidance.provenance.issuer", {
                          organization: provenance.organization,
                          edition: provenance.edition,
                        })}
                      </p>
                      <p className="text-muted">{provenance.source}</p>
                      {provenance.evidenceGrade ? (
                        <p className="text-muted">
                          {t("encounter.guidance.provenance.evidence", {
                            grade: provenance.evidenceGrade,
                          })}
                        </p>
                      ) : null}
                      <p className="text-[10px] uppercase tracking-wide text-muted">
                        {t("encounter.guidance.provenance.reviewed", {
                          date: provenance.lastReviewed,
                        })}
                        {" · "}
                        {t("encounter.guidance.provenance.nextReview", {
                          date: provenance.nextReview,
                        })}
                      </p>
                    </div>
                  }
                >
                  <button
                    type="button"
                    aria-label={t("encounter.guidance.provenance.aria", {
                      source: provenance.label,
                    })}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-surface px-2.5 py-0.5",
                      "text-xs font-medium text-brand transition-colors hover:border-brand/50",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                    )}
                  >
                    <BookOpen weight="bold" className="h-3 w-3" aria-hidden />
                    {provenance.label}
                  </button>
                </Tooltip>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-surface px-2.5 py-0.5 text-xs font-medium text-brand">
                  <BookOpen weight="bold" className="h-3 w-3" aria-hidden />
                  {pillLabel}
                </span>
              )}

              {provenance ? (
                <span className="text-xs text-muted">
                  {t("encounter.guidance.provenance.reviewed", {
                    date: provenance.lastReviewed,
                  })}
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="mt-3 flex items-start gap-1.5 border-t border-brand/15 pt-2.5">
            <ShieldCheck
              weight="fill"
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand/70"
              aria-hidden
            />
            <p className="text-xs leading-relaxed text-muted">
              <span className="font-medium text-fg">
                {t("encounter.guidance.abstain.title")}.
              </span>{" "}
              {provenance
                ? t("encounter.guidance.abstain.note", { scope: provenance.scopeLabel })
                : t("encounter.guidance.abstain.noteGeneric")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
