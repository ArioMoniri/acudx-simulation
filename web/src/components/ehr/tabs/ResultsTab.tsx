import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import {
  Timer,
  FileText,
  Flask,
  Broadcast,
  ShieldWarning,
  SealCheck,
} from "@phosphor-icons/react";

import { Card, Switch } from "@/components/ui";
import { useReveal, useStagger } from "@/lib/motion";
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
  getEncounterClockMs,
  useEncounterState,
} from "@/state/encounterStore";
import type { LabResult } from "@/domain/case";
import type { Lang } from "@/data/mock";

export interface ResultsTabProps {
  lang: Lang;
}

/** Local 1 Hz tick so pending-result countdowns advance between store events. */
function useSecondTick(active: boolean): void {
  const [, force] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => force((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [active]);
}

/**
 * ResultsTab — shows ONLY what was ordered (docs §2.2 / §2.3). A summary strip
 * counts how many orders have resulted and flags abnormal / critical values;
 * critical values (HH/LL) surface in a dedicated callout. Pending orders show a
 * live turnaround countdown until the store timer resolves them; resulted labs
 * render with their reference range and an abnormal flag carried by an icon +
 * text label (never color alone, WCAG 1.4.1); imaging renders as a narrative
 * report. New results fade in as the store reveals them.
 */
export function ResultsTab({ lang }: ResultsTabProps) {
  const { t } = useTranslation();
  const state = useEncounterState();
  const [abnormalOnly, setAbnormalOnly] = useState(false);

  const labs = getDiscoveredLabs(state);
  const imaging = getDiscoveredImaging(state);
  const pending = state.orders.filter((o) => !o.resolved);
  useSecondTick(pending.length > 0);
  const nowMs = getEncounterClockMs(state);

  const nothingOrdered = state.orders.length === 0;
  const resultedOrders = state.orders.filter((o) => o.resolved).length;

  const abnormalLabs = useMemo(
    () => labs.filter((l) => interpretationToState(l.observation.interpretation) !== "normal"),
    [labs],
  );
  const criticalLabs = useMemo(
    () => labs.filter((l) => interpretationToState(l.observation.interpretation) === "critical"),
    [labs],
  );

  const shownLabs = abnormalOnly ? abnormalLabs : labs;

  const summaryReveal = useReveal();
  const criticalReveal = useReveal(0.04);

  return (
    <div className="flex flex-col gap-4">
      {nothingOrdered ? (
        <Card padding="lg" className="text-center">
          <p className="text-sm text-muted">{t("ehr.results.none")}</p>
        </Card>
      ) : (
        <motion.div {...summaryReveal}>
          <Card padding="md">
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <SummaryStat
                  label={t("ehr2.results.summaryHeading")}
                  value={t("ehr2.results.resultedOf", {
                    done: resultedOrders,
                    total: state.orders.length,
                  })}
                />
                {pending.length > 0 ? (
                  <SummaryStat
                    value={t("ehr2.results.pendingCount", { count: pending.length })}
                    tone="caution"
                  />
                ) : null}
                {abnormalLabs.length > 0 ? (
                  <SummaryStat
                    value={t("ehr2.results.abnormalCount", { count: abnormalLabs.length })}
                    tone="warning"
                  />
                ) : null}
                {criticalLabs.length > 0 ? (
                  <SummaryStat
                    value={t("ehr2.results.criticalCount", { count: criticalLabs.length })}
                    tone="critical"
                  />
                ) : null}
              </div>
              {labs.length > 0 ? (
                <div className="flex items-center gap-2 text-xs text-muted">
                  <Switch
                    id="results-abnormal-only"
                    checked={abnormalOnly}
                    onCheckedChange={setAbnormalOnly}
                    aria-label={t("ehr2.results.filterAbnormal")}
                  />
                  <label htmlFor="results-abnormal-only" className="cursor-pointer select-none">
                    {t("ehr2.results.filterAbnormal")}
                  </label>
                </div>
              ) : null}
            </div>
          </Card>
        </motion.div>
      )}

      {/* Critical values callout */}
      {criticalLabs.length > 0 ? (
        <motion.div {...criticalReveal}>
          <div
            className="rounded-card border p-4"
            style={{
              borderColor: "color-mix(in srgb, var(--state-critical) 40%, transparent)",
              backgroundColor: "color-mix(in srgb, var(--state-critical) 8%, transparent)",
            }}
          >
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
              <ShieldWarning
                weight="fill"
                className="h-4 w-4"
                style={{ color: "var(--state-critical)" }}
                aria-hidden
              />
              {t("ehr2.results.criticalHeading")}
            </h3>
            <ul className="mt-2 flex flex-col gap-1">
              {criticalLabs.map((l) => (
                <li
                  key={l.id}
                  className="flex items-baseline justify-between gap-3 text-sm text-fg"
                >
                  <span className="font-medium">{conceptText(l.observation.code, lang)}</span>
                  <span className="font-mono tabular-nums">
                    {l.observation.valueQuantity?.value}
                    {l.observation.valueQuantity?.unit ? (
                      <span className="ml-1 text-xs text-muted">
                        {l.observation.valueQuantity.unit}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted">{t("ehr2.results.criticalNote")}</p>
          </div>
        </motion.div>
      ) : null}

      {/* Pending orders */}
      {pending.length > 0 ? (
        <Card padding="md">
          <h3 className="mb-2 text-sm font-semibold text-fg">
            {t("ehr.results.pendingHeading")}
          </h3>
          <ul className="flex flex-col gap-2">
            {pending.map((o, i) => {
              const etaSec = Math.max(0, Math.ceil((o.resultsReadyAt - nowMs) / 1000));
              return (
                <li
                  key={`${o.code}-${i}`}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span className="min-w-0 truncate text-fg">
                    {lang === "tr" ? o.labelTr : o.labelEn}
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1.5 font-mono text-[11px] tabular-nums text-[color:var(--state-caution)]">
                    <Timer weight="bold" className="h-3.5 w-3.5 motion-safe:animate-pulse" aria-hidden />
                    {etaSec > 0
                      ? t("ehr2.results.readyIn", { sec: etaSec })
                      : t("ehr.orders.pending")}
                  </span>
                </li>
              );
            })}
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
          {shownLabs.length === 0 ? (
            <p className="py-2 text-center text-xs italic text-muted">
              {t("ehr2.results.noAbnormal")}
            </p>
          ) : (
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
                  {shownLabs.map((l) => (
                    <LabRow key={l.id} lab={l} lang={lang} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {/* Imaging / diagnostic reports */}
      {imaging.length > 0 ? (
        <Card padding="md">
          <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-fg">
            <Broadcast weight="bold" className="h-4 w-4 text-muted" aria-hidden />
            {t("ehr.results.imagingHeading")}
          </h3>
          <ImagingList lang={lang} />
        </Card>
      ) : null}
    </div>
  );
}

/** A compact labeled figure in the result summary strip. */
function SummaryStat({
  label,
  value,
  tone,
}: {
  label?: string;
  value: React.ReactNode;
  tone?: "caution" | "warning" | "critical";
}) {
  const colorVar =
    tone === "critical"
      ? "var(--state-critical)"
      : tone === "warning"
        ? "var(--state-warning)"
        : tone === "caution"
          ? "var(--state-caution)"
          : undefined;
  return (
    <div className="flex flex-col gap-0.5">
      {label ? (
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
          {label}
        </span>
      ) : null}
      <span
        className="text-sm font-semibold text-fg"
        style={colorVar ? { color: colorVar } : undefined}
      >
        {value}
      </span>
    </div>
  );
}

/** One laboratory result row with an abnormal accent + icon-and-label flag. */
function LabRow({ lab, lang }: { lab: LabResult; lang: Lang }) {
  const { t } = useTranslation();
  const obs = lab.observation;
  const st = interpretationToState(obs.interpretation);
  const present = stateMap[st];
  const Icon = present.icon;
  const abnormal = st !== "normal";
  const flagText = t(`ehr.results.interp.${interpretationKey(obs.interpretation)}`);

  return (
    <tr className="border-b border-border last:border-b-0">
      <th scope="row" className="px-2 py-2 text-left font-medium text-fg">
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block h-3.5 w-0.5 rounded-full"
            style={{ backgroundColor: abnormal ? present.colorVar : "transparent" }}
          />
          {conceptText(obs.code, lang)}
        </span>
      </th>
      <td className="px-2 py-2 font-mono tabular-nums text-fg">
        {obs.valueQuantity?.value}
        {obs.valueQuantity?.unit ? (
          <span className="ml-1 text-xs text-muted">{obs.valueQuantity.unit}</span>
        ) : null}
      </td>
      <td className="px-2 py-2 font-mono text-xs tabular-nums text-muted">
        {obs.referenceRange ?? "-"}
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
}

/** Imaging reports, staggered in as they resolve. */
function ImagingList({ lang }: { lang: Lang }) {
  const { t } = useTranslation();
  const state = useEncounterState();
  const imaging = getDiscoveredImaging(state);
  const { container, item } = useStagger();

  return (
    <motion.ul {...container} className="flex flex-col gap-3">
      {imaging.map((im) => {
        const resolvedAt = state.results.find((r) => r.datumIds.includes(im.id))?.at;
        return (
          <motion.li
            key={im.id}
            {...item}
            className="rounded-control border border-border bg-bg-subtle p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-sm font-medium text-fg">
                <FileText weight="bold" className="h-4 w-4 text-muted" aria-hidden />
                {pick(im.modality, lang)}
              </span>
              <span className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[color:var(--state-normal)]">
                  <SealCheck weight="fill" className="h-3.5 w-3.5" aria-hidden />
                  {t("ehr2.results.finalReport")}
                </span>
                {resolvedAt != null ? (
                  <span className="font-mono text-[11px] tabular-nums text-muted">
                    {t("ehr.results.reportedAt", { min: minutesOf(resolvedAt) })}
                  </span>
                ) : null}
              </span>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-fg">
              <span className="font-medium text-muted">{t("ehr.results.impression")}: </span>
              {im.report.conclusion ? pick(im.report.conclusion, lang) : ""}
            </p>
          </motion.li>
        );
      })}
    </motion.ul>
  );
}
