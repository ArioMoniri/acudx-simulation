import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, Clock, BookOpen, Gauge } from "@phosphor-icons/react";
import { Card, Badge, Button } from "@/components/ui";
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

/** CaseCard — a single recommended EM case with difficulty, guideline, languages. */
export function CaseCard({ data, lang }: CaseCardProps) {
  const { t } = useTranslation();
  const dots = difficultyDots[data.difficulty];

  return (
    <Card
      padding="lg"
      className="group flex h-full flex-col gap-4 transition-shadow duration-300 ease-out hover:shadow-soft-md"
    >
      <div className="flex items-start justify-between gap-3">
        <Badge tone="neutral">{data.ageSex[lang]}</Badge>
        <span
          className="inline-flex items-center gap-1"
          aria-label={`${t("caseCard.difficulty")}: ${t(
            `caseCard.difficultyLevel.${data.difficulty}`,
          )}`}
        >
          <Gauge weight="bold" className="h-3.5 w-3.5 text-muted" aria-hidden />
          <span className="flex items-center gap-0.5" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  i < dots ? "bg-brand" : "bg-border",
                )}
              />
            ))}
          </span>
          <span className="text-xs font-medium text-muted">
            {t(`caseCard.difficultyLevel.${data.difficulty}`)}
          </span>
        </span>
      </div>

      <div className="flex-1">
        <h3 className="text-base font-semibold tracking-tight text-fg">
          {data.title[lang]}
        </h3>
        <p className="mt-1 text-sm text-muted">
          {data.setting[lang]} · {data.chiefComplaint[lang]}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-subtle px-2.5 py-0.5 text-xs font-medium text-muted">
          <BookOpen weight="bold" className="h-3 w-3" aria-hidden />
          {data.guidelineTag}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-subtle px-2.5 py-0.5 text-xs font-medium text-muted">
          <Clock weight="bold" className="h-3 w-3" aria-hidden />
          {t("caseCard.estimate", { minutes: data.estMinutes })}
        </span>
        <span
          className="inline-flex items-center gap-1 text-xs font-medium text-muted"
          aria-label={`${t("caseCard.languages")}: ${data.languages
            .map((l) => l.toUpperCase())
            .join(", ")}`}
        >
          {data.languages.map((l) => (
            <span
              key={l}
              aria-hidden
              className="rounded border border-border px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted"
            >
              {l}
            </span>
          ))}
        </span>
      </div>

      <Button
        asChild
        size="sm"
        variant="secondary"
        className="w-full justify-between"
        trailingIcon={<ArrowRight weight="bold" className="h-3.5 w-3.5" />}
      >
        <Link to="/encounter">{t("actions.startEncounter")}</Link>
      </Button>
    </Card>
  );
}
