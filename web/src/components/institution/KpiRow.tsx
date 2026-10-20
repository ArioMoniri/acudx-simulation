import { useTranslation } from "react-i18next";
import {
  Pulse,
  Target,
  ShieldCheck,
  ChartLineUp,
  Gauge,
  GridNine,
} from "@phosphor-icons/react";
import { Card, Stat, type StatTrend } from "@/components/ui";
import { useLang } from "@/lib/useLang";
import { useProgressRecords } from "@/state/progressStore";
import { deriveInstitutionKpis, type InstitutionKpi } from "@/data/institution";

/** One glyph per headline metric so the band reads as six distinct instruments. */
const kpiIcon: Record<string, typeof Pulse> = {
  "kpi-recorded": Pulse,
  "kpi-accuracy": ChartLineUp,
  "kpi-safety": ShieldCheck,
  "kpi-calibration": Target,
  "kpi-competence": Gauge,
  "kpi-coverage": GridNine,
};

/** Map the KPI polarity + trend onto the Stat trend slot (colour is never the only signal). */
function trendDir(kpi: InstitutionKpi): "up" | "down" | "flat" {
  if (kpi.polarity === "neutral" || kpi.trend === "steady") return "flat";
  return kpi.trend === "up" ? "up" : "down";
}

/** Worded direction for screen readers, so movement is legible without colour (INV-5). */
function directionKey(kpi: InstitutionKpi): { key: string; def: string } {
  if (kpi.trend === "steady" || kpi.polarity === "neutral")
    return { key: "institution.kpi.steady", def: "steady" };
  const good =
    kpi.polarity === "higherBetter" ? kpi.trend === "up" : kpi.trend === "down";
  return good
    ? { key: "institution.kpi.improving", def: "improving" }
    : { key: "institution.kpi.worsening", def: "needs attention" };
}

/** KpiRow — six honest headline metrics derived from the learner's OWN records. */
export function KpiRow() {
  const { t } = useTranslation();
  const lang = useLang();
  const records = useProgressRecords();
  const kpis = deriveInstitutionKpis(records);

  return (
    <ul
      aria-label={t("institution.kpi.ownSectionLabel", {
        defaultValue: "Your headline metrics",
      })}
      className="grid gap-px overflow-hidden rounded-card border border-border bg-border sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
    >
      {kpis.map((kpi) => {
        const Icon = kpiIcon[kpi.id];
        const dir = directionKey(kpi);
        const trend: StatTrend | undefined = kpi.delta
          ? {
              value: (
                <>
                  {kpi.delta}
                  <span className="sr-only"> {t(dir.key, { defaultValue: dir.def })}</span>
                </>
              ),
              dir: trendDir(kpi),
              goodUp: kpi.polarity !== "lowerBetter",
            }
          : undefined;
        return (
          <li key={kpi.id} className="h-full bg-surface">
            <Card variant="flat" padding="md" className="h-full">
              <Stat
                label={t(kpi.labelKey, { defaultValue: kpi.labelDefault })}
                value={kpi.value}
                unit={kpi.unit ? kpi.unit[lang] : undefined}
                hint={t(kpi.hintKey, { defaultValue: kpi.hintDefault })}
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
