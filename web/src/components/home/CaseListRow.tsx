import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "@phosphor-icons/react";
import { StatusDot, type StatusTone } from "@/components/ui";
import type { Lang, RecommendedCase } from "@/data/schema";

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
 * CaseListRow: a recommended case as one dense worklist row (Linear): the
 * case reference in mono, the presentation as the title, a muted meta line,
 * the difficulty as a status dot, the estimate right-aligned, and the start
 * affordance at the end. Rows are hairline-divided by the parent list.
 */
export function CaseListRow({ data, lang, to = "/encounter" }: CaseListRowProps) {
  const { t } = useTranslation();
  const caseRef = data.id.toUpperCase();

  return (
    <Link
      to={to}
      className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-2.5 transition-colors duration-[120ms] hover:bg-surface-2 md:grid-cols-[6.5rem_minmax(0,1fr)_6.5rem_4rem_auto]"
    >
      <span className="hidden font-mono text-xs text-subtle md:block" aria-label={t("home2.caseCode")}>
        {caseRef}
      </span>
      <span className="min-w-0">
        <span className="block text-[0.8125rem] font-semibold leading-snug text-fg">{data.title[lang]}</span>
        <span className="block truncate text-xs text-muted">
          {data.chiefComplaint[lang]} · {data.ageSex[lang]} · {data.setting[lang]} · {data.guidelineTag}
        </span>
      </span>
      <span className="hidden md:block">
        <StatusDot
          tone={difficultyTone[data.difficulty]}
          label={t(`caseCard.difficultyLevel.${data.difficulty}`)}
          size="sm"
        />
      </span>
      <span className="hidden font-mono text-xs text-muted md:block md:text-end">
        {t("caseCard.estimate", { minutes: data.estMinutes })}
      </span>
      <span className="inline-flex items-center gap-1 text-xs font-medium text-brand">
        {t("home2.startCase")}
        <ArrowRight weight="bold" className="h-3.5 w-3.5" aria-hidden />
      </span>
    </Link>
  );
}
