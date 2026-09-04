import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, Clock, BookOpen, Gauge } from "@phosphor-icons/react";
import { Card, Badge, Button, SectionLabel } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { RecommendedCase, Lang } from "@/data/mock";

const difficultyDots: Record<RecommendedCase["difficulty"], number> = {
  foundation: 1,
  core: 2,
  advanced: 3,
};

export interface CaseCardProps {
  data: RecommendedCase;
  lang: Lang;
}

/**
 * CaseCard — a single recommended EM case. Re-crafted to the "clinical
 * instrument" language: a setting eyebrow leads into the title, the chief
 * complaint reads as the supporting line, and facets (guideline, time,
 * languages) sit on a hairline meta row above a footer that pairs the
 * difficulty read-out with the start action. Hierarchy does the work — no
 * icon-chip square, no resting shadow.
 */
export function CaseCard({ data, lang }: CaseCardProps) {
  const { t } = useTranslation();
  const dots = difficultyDots[data.difficulty];

  return (
    <Card
      variant="interactive"
      padding="md"
      className="group flex h-full flex-col gap-3"
    >
      {/* Setting eyebrow → title, with the demographic chip pinned right */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <SectionLabel>{data.setting[lang]}</SectionLabel>
          <h3 className="mt-1 text-base font-semibold leading-snug tracking-tight text-fg">
            {data.title[lang]}
          </h3>
        </div>
        <Badge tone="neutral" variant="outline" className="shrink-0">
          {data.ageSex[lang]}
        </Badge>
      </div>

      <p className="text-sm text-muted">{data.chiefComplaint[lang]}</p>

      {/* Meta row (pushed to the bottom so cards align on a shared baseline) */}
      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border pt-3 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <BookOpen weight="bold" className="h-3.5 w-3.5 text-subtle" aria-hidden />
          {data.guidelineTag}
        </span>
        <span className="inline-flex items-center gap-1.5 font-medium">
          <Clock weight="bold" className="h-3.5 w-3.5 text-subtle" aria-hidden />
          {t("caseCard.estimate", { minutes: data.estMinutes })}
        </span>
        <span
          className="inline-flex items-center gap-1"
          aria-label={`${t("caseCard.languages")}: ${data.languages
            .map((l) => l.toUpperCase())
            .join(", ")}`}
        >
          {data.languages.map((l) => (
            <span
              key={l}
              aria-hidden
              className="rounded border border-border px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-subtle"
            >
              {l}
            </span>
          ))}
        </span>
      </div>

      {/* Footer: difficulty read-out + start action */}
      <div className="flex items-center justify-between gap-3">
        <span
          className="inline-flex items-center gap-1.5"
          aria-label={`${t("caseCard.difficulty")}: ${t(
            `caseCard.difficultyLevel.${data.difficulty}`,
          )}`}
        >
          <Gauge weight="bold" className="h-3.5 w-3.5 text-subtle" aria-hidden />
          <span className="flex items-center gap-0.5" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  i < dots ? "bg-brand" : "bg-border-strong",
                )}
              />
            ))}
          </span>
          <span className="text-xs font-medium text-muted">
            {t(`caseCard.difficultyLevel.${data.difficulty}`)}
          </span>
        </span>

        <Button
          asChild
          size="sm"
          variant="secondary"
          trailingIcon={<ArrowRight weight="bold" className="h-3.5 w-3.5" />}
        >
          <Link to="/encounter">{t("actions.startEncounter")}</Link>
        </Button>
      </div>
    </Card>
  );
}
