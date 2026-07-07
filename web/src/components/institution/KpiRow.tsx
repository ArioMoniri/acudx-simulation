import { useTranslation } from "react-i18next";
import { TrendUp, TrendDown, Minus } from "@phosphor-icons/react";
import { Card } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useLang } from "@/lib/useLang";
import { institutionKpis, type InstitutionKpi } from "@/data/institution";

const trendIcon = { up: TrendUp, down: TrendDown, steady: Minus } as const;

/** Is this KPI's movement a good thing, given its polarity? (worded, not colour-only) */
function isGood(kpi: InstitutionKpi): boolean | null {
  if (kpi.trend === "steady" || kpi.polarity === "neutral") return null;
  if (kpi.polarity === "higherBetter") return kpi.trend === "up";
  return kpi.trend === "down";
}

function KpiCard({ kpi }: { kpi: InstitutionKpi }) {
  const { t } = useTranslation();
  const lang = useLang();
  const TrendIcon = trendIcon[kpi.trend];
  const good = isGood(kpi);
  const directionWord = t(
    good === null
      ? "institution.kpi.steady"
      : good
        ? "institution.kpi.improving"
        : "institution.kpi.worsening",
  );

  return (
    <Card padding="md" className="flex flex-col gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-muted">
        {t(kpi.labelKey)}
      </span>
      <span className="flex items-baseline gap-1">
        <span className="font-mono text-3xl font-semibold leading-none text-fg">
          {kpi.value}
        </span>
        {kpi.unit ? (
          <span className="text-sm font-medium text-muted">
            {kpi.unit[lang]}
          </span>
        ) : null}
      </span>
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold",
            good === null
              ? "text-muted"
              : good
                ? "text-[color:var(--state-normal)]"
                : "text-[color:var(--state-caution)]",
          )}
          style={{
            backgroundColor:
              good === null
                ? "var(--bg-subtle)"
                : good
                  ? "color-mix(in srgb, var(--state-normal) 14%, transparent)"
                  : "color-mix(in srgb, var(--state-caution) 16%, transparent)",
          }}
        >
          <TrendIcon weight="bold" className="h-3 w-3" aria-hidden />
          {kpi.delta}
          <span className="sr-only">{directionWord}</span>
        </span>
      </div>
      <p className="text-xs text-muted">{t(kpi.hintKey)}</p>
    </Card>
  );
}

/** KpiRow — the six headline institutional metrics across the top of the dashboard. */
export function KpiRow() {
  const { t } = useTranslation();
  return (
    <ul
      aria-label={t("institution.kpi.sectionLabel")}
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
    >
      {institutionKpis.map((kpi) => (
        <li key={kpi.id}>
          <KpiCard kpi={kpi} />
        </li>
      ))}
    </ul>
  );
}
