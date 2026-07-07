import { useTranslation } from "react-i18next";
import { Scales, CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { Card } from "@/components/ui";
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
      <div className="overflow-x-auto" tabIndex={0}>
        <table className="w-full text-left text-sm">
          <caption className="sr-only">
            {t("institution.fairness.tableCaption")}
          </caption>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="py-2 pr-3 font-semibold text-fg">
                {t("institution.fairness.metricCol")}
              </th>
              <th scope="col" className="py-2 pr-3 font-semibold text-fg">
                {t("institution.fairness.trCol", {
                  count: fairnessCohort.trLearners,
                })}
              </th>
              <th scope="col" className="py-2 pr-3 font-semibold text-fg">
                {t("institution.fairness.enCol", {
                  count: fairnessCohort.enLearners,
                })}
              </th>
              <th scope="col" className="py-2 font-semibold text-fg">
                {t("institution.fairness.statusCol")}
              </th>
            </tr>
          </thead>
          <tbody>
            {fairnessMetrics.map((m) => (
              <tr key={m.id} className="border-b border-border/60">
                <th scope="row" className="py-2 pr-3 font-medium text-fg">
                  {t(m.labelKey)}
                </th>
                <td className="py-2 pr-3 font-mono text-xs text-fg">{m.tr}</td>
                <td className="py-2 pr-3 font-mono text-xs text-fg">{m.en}</td>
                <td className="py-2">
                  <span
                    className="inline-flex items-center gap-1 text-xs font-medium"
                    style={{
                      color: m.withinTolerance
                        ? "var(--state-normal)"
                        : "var(--state-caution)",
                    }}
                  >
                    {m.withinTolerance ? (
                      <CheckCircle weight="fill" className="h-3.5 w-3.5" aria-hidden />
                    ) : (
                      <WarningCircle weight="fill" className="h-3.5 w-3.5" aria-hidden />
                    )}
                    {m.withinTolerance
                      ? t("institution.fairness.withinTolerance")
                      : t("institution.fairness.flagged")}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted">{t("institution.fairness.footnote")}</p>
    </Card>
  );
}
