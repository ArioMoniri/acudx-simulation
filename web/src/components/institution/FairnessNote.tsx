import { useTranslation } from "react-i18next";
import { Scales, CheckCircle, WarningCircle } from "@phosphor-icons/react";
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
import { fairnessMetrics, fairnessCohort } from "@/data/institution";

/**
 * FairnessNote — the mandatory per-locale fairness read-out (IN-7, DC-2).
 *
 * Every metric is broken out TR vs EN. The load-bearing invariant is stated in
 * plain words: the CLINICAL axis must not track language. Accent / L2 form never
 * scores, so the clinical-band distributions match across subgroups; the higher
 * TR STT-fallback rate is shown transparently rather than hidden, framed as a
 * voice-path property, not a competence gap.
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

      {/* Headline invariant */}
      <div className="rounded-control border-l-2 border-brand bg-bg-subtle p-3">
        <p className="text-sm text-fg">{t("institution.fairness.invariant")}</p>
      </div>

      {/* TR vs EN table */}
      <TableWrap>
        <Table>
          <caption className="sr-only">
            {t("institution.fairness.tableCaption")}
          </caption>
          <THead>
            <Tr>
              <Th>{t("institution.fairness.metricCol")}</Th>
              <Th numeric>
                {t("institution.fairness.trCol", {
                  count: fairnessCohort.trLearners,
                })}
              </Th>
              <Th numeric>
                {t("institution.fairness.enCol", {
                  count: fairnessCohort.enLearners,
                })}
              </Th>
              <Th>{t("institution.fairness.statusCol")}</Th>
            </Tr>
          </THead>
          <TBody>
            {fairnessMetrics.map((m) => (
              <Tr key={m.id}>
                <Td className="font-medium text-fg">{t(m.labelKey)}</Td>
                <Td numeric className="text-xs">
                  {m.tr}
                </Td>
                <Td numeric className="text-xs">
                  {m.en}
                </Td>
                <Td>
                  {m.withinTolerance ? (
                    <Badge
                      tone="normal"
                      icon={
                        <CheckCircle weight="fill" className="h-3.5 w-3.5" />
                      }
                    >
                      {t("institution.fairness.withinTolerance")}
                    </Badge>
                  ) : (
                    <Badge
                      tone="caution"
                      icon={
                        <WarningCircle weight="fill" className="h-3.5 w-3.5" />
                      }
                    >
                      {t("institution.fairness.flagged")}
                    </Badge>
                  )}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableWrap>

      <p className="text-xs text-muted">{t("institution.fairness.footnote")}</p>
    </Card>
  );
}
