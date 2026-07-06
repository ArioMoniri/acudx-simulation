import { useTranslation } from "react-i18next";
import { Lightbulb, BookOpen } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import type { GuidanceHint, Lang } from "@/data/mock";
import { getCitation } from "@/data/mock";

export interface GuidanceCardProps {
  hint: GuidanceHint;
  lang: Lang;
  className?: string;
}

/**
 * GuidanceCard — a Socratic hint shown above the composer when guidance is on.
 * Always carries an evidence citation as a small pill, and is explicitly
 * labelled education-only. Uses the brand tint (not a state color).
 */
export function GuidanceCard({ hint, lang, className }: GuidanceCardProps) {
  const { t } = useTranslation();
  const citation = getCitation(hint.citationId);

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
          <div className="flex items-center gap-2">
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
          {citation ? (
            <span className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-surface px-2.5 py-0.5 text-xs font-medium text-brand">
              <BookOpen weight="bold" className="h-3 w-3" aria-hidden />
              {citation.label}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
