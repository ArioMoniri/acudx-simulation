import { useTranslation } from "react-i18next";
import { Scales, WarningCircle, Info } from "@phosphor-icons/react";
import {
  Card,
  Badge,
  TableWrap,
  Table,
  THead,
  TBody,
  Tr,
  Th,
  Td,
} from "@/components/ui";

/**
 * The four fairness metrics a real multi-learner cohort would break out by
 * language subgroup. These are LABELS only (structural catalog) — no values are
 * asserted here.
 */
const FAIRNESS_METRIC_KEYS = [
  "institution.fairness.metric.clinicalBand",
  "institution.fairness.metric.commBand",
  "institution.fairness.metric.refusalRate",
  "institution.fairness.metric.sttFallback",
] as const;

/**
 * FairnessNote — the mandatory per-locale fairness read-out (IN-7, DC-2), made
 * honest.
 *
 * A per-language (TR vs EN) subgroup fairness audit needs a multi-learner cohort
 * from a connected institution data source. A single local learner provides no
 * subgroup to compare, so this panel states the load-bearing invariant and shows
 * an explicit "insufficient data" state for each metric rather than inventing
 * subgroup numbers.
 */
export function FairnessNote() {
  const { t } = useTranslation();

  return (
    <Card padding="lg" className="flex flex-col gap-4">
      <div className="flex items-start gap-2.5">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-control bg-bg-subtle text-brand"
          aria-hidden
        >
          <Scales weight="bold" className="h-4.5 w-4.5" />
        </span>
        <div>
          <h3 className="text-lg font-semibold tracking-tight text-fg">
            {t("institution.fairness.title")}
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            {t("institution.fairness.subtitle")}
          </p>
        </div>
      </div>

      {/* Headline invariant (structural, always true) */}
      <div className="rounded-control border-l-2 border-brand bg-bg-subtle p-3">
        <p className="text-sm text-fg">{t("institution.fairness.invariant")}</p>
      </div>

      {/* Honest data-source note */}
      <div className="flex items-start gap-2 rounded-control border border-border bg-surface p-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
        <p className="text-xs text-muted">
          {t("institution.fairness.needsSource", {
            defaultValue:
              "A per-language subgroup audit (TR vs EN) needs a multi-learner cohort from a connected institution data source. A single local learner has no subgroup to compare, so no fairness metric is asserted here.",
          })}
        </p>
      </div>

      {/* Metric catalog with an explicit insufficient-data state */}
      <TableWrap>
        <Table>
          <caption className="sr-only">
            {t("institution.fairness.tableCaption")}
          </caption>
          <THead>
            <Tr>
              <Th>{t("institution.fairness.metricCol")}</Th>
              <Th>{t("institution.fairness.statusCol")}</Th>
            </Tr>
          </THead>
          <TBody>
            {FAIRNESS_METRIC_KEYS.map((key) => (
              <Tr key={key}>
                <Td className="font-medium text-fg">{t(key)}</Td>
                <Td>
                  <Badge
                    tone="neutral"
                    icon={<WarningCircle weight="fill" className="h-3.5 w-3.5" />}
                  >
                    {t("institution.fairness.insufficientData", {
                      defaultValue: "Insufficient data",
                    })}
                  </Badge>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableWrap>

      <p className="text-xs text-muted">
        {t("institution.fairness.footnote")}
      </p>
    </Card>
  );
}
