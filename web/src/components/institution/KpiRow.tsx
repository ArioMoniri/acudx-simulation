import { useTranslation } from "react-i18next";
import {
  UsersThree,
  Pulse,
  ChartLineUp,
  Target,
  ShieldCheck,
  ArrowsClockwise,
} from "@phosphor-icons/react";
import { Card, Stat, type StatTrend } from "@/components/ui";
import { useLang } from "@/lib/useLang";
import { institutionKpis, type InstitutionKpi } from "@/data/institution";

/** One glyph per headline metric so the band reads as six distinct instruments. */
const kpiIcon: Record<string, typeof UsersThree> = {
  "kpi-active": UsersThree,
  "kpi-encounters": Pulse,
  "kpi-competence": ChartLineUp,
  "kpi-calibration": Target,
  "kpi-safety": ShieldCheck,
  "kpi-remediation": ArrowsClockwise,
};

/** Map the KPI polarity + trend onto the Stat trend slot (colour is never the only signal). */
function trendDir(kpi: InstitutionKpi): "up" | "down" | "flat" {
  if (kpi.polarity === "neutral" || kpi.trend === "steady") return "flat";
  return kpi.trend === "up" ? "up" : "down";
}

/** Worded direction for screen readers, so movement is legible without colour (INV-5). */
function directionKey(kpi: InstitutionKpi): string {
  if (kpi.trend === "steady" || kpi.polarity === "neutral")
    return "institution.kpi.steady";
  const good =
    kpi.polarity === "higherBetter" ? kpi.trend === "up" : kpi.trend === "down";
  return good ? "institution.kpi.improving" : "institution.kpi.worsening";
}

/** KpiRow — the six headline institutional metrics, on the canonical Stat tile. */
export function KpiRow() {
  const { t } = useTranslation();
  const lang = useLang();

  return (
    <ul
      aria-label={t("institution.kpi.sectionLabel")}
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
    >
      {institutionKpis.map((kpi) => {
        const Icon = kpiIcon[kpi.id];
        const trend: StatTrend = {
          value: (
            <>
              {kpi.delta}
              <span className="sr-only"> {t(directionKey(kpi))}</span>
            </>
          ),
          dir: trendDir(kpi),
          goodUp: kpi.polarity !== "lowerBetter",
        };
        return (
          <li key={kpi.id} className="h-full">
            <Card variant="surface" padding="md" className="h-full">
              <Stat
                label={t(kpi.labelKey)}
                value={kpi.value}
                unit={kpi.unit ? kpi.unit[lang] : undefined}
                hint={t(kpi.hintKey)}
                icon={
                  Icon ? (
                    <Icon weight="bold" className="h-3.5 w-3.5" aria-hidden />
                  ) : undefined
                }
                trend={trend}
              />
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
