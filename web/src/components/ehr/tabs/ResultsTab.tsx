import { useTranslation } from "react-i18next";
import { Timer, FileText, Flask, Broadcast } from "@phosphor-icons/react";

import { Card } from "@/components/ui";
import { stateMap } from "@/components/clinicalState";
import {
  conceptText,
  interpretationKey,
  interpretationToState,
  minutesOf,
  pick,
} from "../labels";
import {
  getDiscoveredLabs,
  getDiscoveredImaging,
  useEncounterState,
} from "@/state/encounterStore";
import type { Lang } from "@/data/mock";

export interface ResultsTabProps {
  lang: Lang;
}

/**
 * ResultsTab — shows ONLY what was ordered (docs §2.2 / §2.3). Pending orders
 * appear until the store timer resolves them; resulted labs render with their
 * reference range and an abnormal flag carried by an icon + text label (never
 * color alone, WCAG 1.4.1); imaging renders as a narrative report.
 */
export function ResultsTab({ lang }: ResultsTabProps) {
  const { t } = useTranslation();
  const state = useEncounterState();

  const labs = getDiscoveredLabs(state);
  const imaging = getDiscoveredImaging(state);
  const pending = state.orders.filter((o) => !o.resolved);

  const nothingOrdered = state.orders.length === 0;

  return (
    <div className="flex flex-col gap-4">
      {nothingOrdered ? (
        <Card padding="lg" className="text-center">
          <p className="text-sm text-muted">{t("ehr.results.none")}</p>
        </Card>
      ) : null}

      {/* Pending orders */}
      {pending.length > 0 ? (
        <Card padding="md">
          <h3 className="mb-2 text-sm font-semibold text-fg">
            {t("ehr.results.pendingHeading")}
          </h3>
          <ul className="flex flex-col gap-1.5">
            {pending.map((o, i) => (
              <li
                key={`${o.code}-${i}`}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <span className="text-fg">
                  {lang === "tr" ? o.labelTr : o.labelEn}
                </span>
                <span className="inline-flex items-center gap-1 text-xs font-medium text-[color:var(--state-caution)]">
                  <Timer weight="bold" className="h-3.5 w-3.5 motion-safe:animate-pulse" aria-hidden />
                  {t("ehr.orders.pending")}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* Laboratory results */}
      {labs.length > 0 ? (
        <Card padding="md">
          <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-fg">
            <Flask weight="bold" className="h-4 w-4 text-muted" aria-hidden />
            {t("ehr.results.labsHeading")}
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[460px] border-collapse text-sm">
              <caption className="sr-only">{t("ehr.results.labsCaption")}</caption>
              <thead>
                <tr className="border-b border-border text-left">
                  <th scope="col" className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                    {t("ehr.results.analyte")}
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                    {t("ehr.results.value")}
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                    {t("ehr.results.reference")}
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                    {t("ehr.results.flag")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {labs.map((l) => {
                  const obs = l.observation;
                  const st = interpretationToState(obs.interpretation);
                  const present = stateMap[st];
                  const Icon = present.icon;
                  const flagText = t(
                    `ehr.results.interp.${interpretationKey(obs.interpretation)}`,
                  );
                  return (
                    <tr key={l.id} className="border-b border-border last:border-b-0">
                      <th scope="row" className="px-2 py-2 text-left font-medium text-fg">
                        {conceptText(obs.code, lang)}
                      </th>
                      <td className="px-2 py-2 font-mono tabular-nums text-fg">
                        {obs.valueQuantity?.value}
                        {obs.valueQuantity?.unit ? (
                          <span className="ml-1 text-xs text-muted">
                            {obs.valueQuantity.unit}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-2 py-2 font-mono text-xs tabular-nums text-muted">
                        {obs.referenceRange ?? "—"}
                      </td>
                      <td className="px-2 py-2">
                        <span
                          className="inline-flex items-center gap-1 text-xs font-medium"
                          style={{ color: present.colorVar }}
                        >
                          <Icon weight="fill" className="h-3.5 w-3.5" aria-hidden />
                          {flagText}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {/* Imaging / diagnostic reports */}
      {imaging.length > 0 ? (
        <Card padding="md">
          <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-fg">
            <Broadcast weight="bold" className="h-4 w-4 text-muted" aria-hidden />
            {t("ehr.results.imagingHeading")}
          </h3>
          <ul className="flex flex-col gap-3">
            {imaging.map((im) => {
              const resolvedAt = state.results.find((r) =>
                r.datumIds.includes(im.id),
              )?.at;
              return (
                <li
                  key={im.id}
                  className="rounded-control border border-border bg-bg-subtle p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-sm font-medium text-fg">
                      <FileText weight="bold" className="h-4 w-4 text-muted" aria-hidden />
                      {pick(im.modality, lang)}
                    </span>
                    {resolvedAt != null ? (
                      <span className="font-mono text-[11px] tabular-nums text-muted">
                        {t("ehr.results.reportedAt", { min: minutesOf(resolvedAt) })}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1.5 text-sm leading-relaxed text-fg">
                    <span className="font-medium text-muted">
                      {t("ehr.results.impression")}:{" "}
                    </span>
                    {im.report.conclusion ? pick(im.report.conclusion, lang) : ""}
                  </p>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
