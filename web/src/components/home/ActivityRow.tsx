import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, ShieldWarning } from "@phosphor-icons/react";
import { Badge, StatusDot } from "@/components/ui";
import type { Band, Lang, RecentFeedbackItem } from "@/data/schema";

/** Band → badge tone. Communication/clinical bands share the same scale. */
const bandTone: Record<Band, "brand" | "normal" | "neutral"> = {
  exemplary: "normal",
  strong: "brand",
  proficient: "brand",
  developing: "neutral",
  emerging: "neutral",
  withheld: "neutral",
};

export interface ActivityRowProps {
  item: RecentFeedbackItem;
  lang: Lang;
}

/**
 * ActivityRow — one recent-feedback entry as a compact activity line: a status
 * dot (safety-critical vs clean), the case, the single takeaway, a band chip,
 * and a right-aligned timestamp. Rows are hairline-divided by the parent list,
 * so the column reads as an Attio-style feed rather than a stack of cards.
 */
export function ActivityRow({ item, lang }: ActivityRowProps) {
  const { t } = useTranslation();
  const when =
    item.daysAgo === 0
      ? t("recentFeedback.today")
      : t("recentFeedback.daysAgo", { count: item.daysAgo });

  return (
    <Link
      to="/feedback"
      className="group flex gap-3 px-4 py-3.5 transition-colors duration-200 ease-out hover:bg-bg-subtle focus-visible:outline-none"
    >
      <StatusDot
        tone={item.hadSafetyMiss ? "critical" : "normal"}
        size="md"
        className="mt-1.5 shrink-0"
        aria-label={t(
          item.hadSafetyMiss
            ? "recentFeedback.safetyFlag"
            : "recentFeedback.noSafety",
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-sm font-medium text-fg">
            {item.caseTitle[lang]}
          </p>
          <span className="tnum shrink-0 text-xs text-subtle">{when}</span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-sm text-muted">
          {item.takeaway[lang]}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge tone={bandTone[item.topBand] ?? "neutral"} dot>
            {t(`bands.${item.topBand}`)}
          </Badge>
          {item.hadSafetyMiss ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[color:var(--state-critical)]">
              <ShieldWarning weight="fill" className="h-3 w-3" aria-hidden />
              {t("recentFeedback.safetyFlag")}
            </span>
          ) : null}
        </div>
      </div>
      <ArrowRight
        weight="bold"
        className="mt-1 h-4 w-4 shrink-0 text-subtle transition-transform duration-200 ease-out group-hover:translate-x-0.5"
        aria-hidden
      />
    </Link>
  );
}
