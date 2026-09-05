import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, BookOpen, Clock, FirstAidKit } from "@phosphor-icons/react";
import {
  Badge,
  Card,
  SectionLabel,
  StatusDot,
  type StatusTone,
} from "@/components/ui";
import type { Lang, RecommendedCase } from "@/data/mock";

/**
 * Difficulty maps to a status tone so the tier reads at a glance without a
 * separate legend: foundation = settled (normal), core = brand, advanced =
 * caution. Meaning is always paired with the text label beside the dot.
 */
const difficultyTone: Record<RecommendedCase["difficulty"], StatusTone> = {
  foundation: "normal",
  core: "brand",
  advanced: "caution",
};

export interface CaseListRowProps {
  data: RecommendedCase;
  lang: Lang;
  /** Where the row navigates (defaults to the live encounter). */
  to?: string;
}

/**
 * CaseListRow — a recommended case as a real information-hierarchy row rather
 * than an icon-chip + blurb card: specialty eyebrow, title, a monospace case
 * reference, difficulty as a StatusDot, and a muted meta row. The whole row is
 * one interactive surface (hairline that firms on hover), so it stays calm
 * until the reader reaches for it.
 */
export function CaseListRow({ data, lang, to = "/encounter" }: CaseListRowProps) {
  const { t } = useTranslation();
  const caseRef = data.id.toUpperCase();

  return (
    <Link to={to} className="group block rounded-card focus-visible:outline-none">
      <Card variant="interactive" padding="md" className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <SectionLabel
            icon={<FirstAidKit weight="bold" className="h-3.5 w-3.5" />}
          >
            {data.setting[lang]}
          </SectionLabel>
          <StatusDot
            tone={difficultyTone[data.difficulty]}
            label={t(`caseCard.difficultyLevel.${data.difficulty}`)}
            size="sm"
          />
        </div>

        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <h3 className="text-base font-semibold tracking-tight text-fg">
            {data.title[lang]}
          </h3>
          <span
            className="tnum font-mono text-xs tracking-tight text-subtle"
            aria-label={t("home2.caseCode")}
          >
            {caseRef}
          </span>
        </div>

        <p className="text-sm text-muted">
          {data.chiefComplaint[lang]} · {data.ageSex[lang]}
        </p>

        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted">
          <Badge
            tone="neutral"
            variant="outline"
            icon={<BookOpen weight="bold" className="h-3 w-3" />}
          >
            {data.guidelineTag}
          </Badge>
          <span className="inline-flex items-center gap-1.5">
            <Clock weight="bold" className="h-3.5 w-3.5" aria-hidden />
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
                className="rounded border border-border px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted"
              >
                {l}
              </span>
            ))}
          </span>
          <span className="ms-auto inline-flex items-center gap-1 font-medium text-brand">
            {t("home2.startCase")}
            <ArrowRight
              weight="bold"
              className="h-3.5 w-3.5 transition-transform duration-200 ease-out group-hover:translate-x-0.5"
              aria-hidden
            />
          </span>
        </div>
      </Card>
    </Link>
  );
}
