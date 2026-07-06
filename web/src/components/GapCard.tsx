import { useTranslation } from "react-i18next";
import {
  Quotes,
  BookOpen,
  Target,
  ShieldWarning,
  Repeat,
} from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { getCitation } from "@/data/mock";
import type { FeedbackGap, Lang } from "@/data/mock";

export interface GapCardProps {
  gap: FeedbackGap;
  lang: Lang;
}

/**
 * GapCard — one evidence-anchored gap: a quoted transcript span, an actionable
 * next step, and a guideline citation. Safety-critical misses render in a
 * visually distinct, clearly-flagged frame (icon + explicit label + a hatched
 * accent bar), so the flag never relies on color alone.
 */
export function GapCard({ gap, lang }: GapCardProps) {
  const { t } = useTranslation();
  const citation = getCitation(gap.citationId);
  const critical = gap.safetyCritical;

  return (
    <article
      className={cn(
        "relative overflow-hidden rounded-card border bg-surface p-4 sm:p-5",
        critical
          ? "border-[color:var(--state-critical)]/50 shadow-soft-md"
          : "border-border shadow-soft",
      )}
    >
      {critical ? (
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-1"
          style={{
            backgroundImage:
              "repeating-linear-gradient(45deg, var(--state-critical) 0 8px, color-mix(in srgb, var(--state-critical) 45%, transparent) 8px 16px)",
          }}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {critical ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--state-critical)]/40 bg-[color-mix(in_srgb,var(--state-critical)_12%,transparent)] px-2.5 py-0.5 text-xs font-semibold text-[color:var(--state-critical)]">
            <ShieldWarning weight="fill" className="h-3.5 w-3.5" aria-hidden />
            {t("feedback.gap.safetyCritical")}
          </span>
        ) : null}
        <span className="text-xs font-medium uppercase tracking-wide text-muted">
          {t(`feedback.domains.${gap.domain}`)}
        </span>
        {gap.recurrence > 0 ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted">
            <Repeat weight="bold" className="h-3 w-3" aria-hidden />
            {t("feedback.gap.recurrence", { count: gap.recurrence })}
          </span>
        ) : null}
      </div>

      <h3 className="mt-2 text-base font-semibold tracking-tight text-fg">
        {gap.title[lang]}
      </h3>

      {/* Evidence span quoted from the transcript */}
      <div className="mt-3 flex items-start gap-2.5 rounded-control bg-bg-subtle p-3">
        <Quotes
          weight="fill"
          className="mt-0.5 h-4 w-4 shrink-0 text-muted"
          aria-hidden
        />
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
            {t("feedback.gap.evidence")}
          </p>
          <blockquote className="mt-1 text-sm italic text-fg">
            {gap.evidenceQuote[lang]}
          </blockquote>
        </div>
      </div>

      {/* Actionable next step */}
      <div className="mt-3 flex items-start gap-2.5">
        <Target
          weight="bold"
          className="mt-0.5 h-4 w-4 shrink-0 text-brand"
          aria-hidden
        />
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
            {t("feedback.gap.remediation")}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-fg">
            {gap.remediation[lang]}
          </p>
          {citation ? (
            <span className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-subtle px-2.5 py-0.5 text-xs font-medium text-muted">
              <BookOpen weight="bold" className="h-3 w-3" aria-hidden />
              {citation.label}
            </span>
          ) : null}
        </div>
      </div>
    </article>
  );
}
