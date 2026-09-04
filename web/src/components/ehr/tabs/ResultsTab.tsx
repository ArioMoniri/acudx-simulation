import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import {
  Timer,
  Flask,
  Scan,
  ShieldWarning,
} from "@phosphor-icons/react";

import { Card, Switch } from "@/components/ui";
import { useReveal, useStagger } from "@/lib/motion";
import { stateMap } from "@/components/clinicalState";
import { ConditionImage } from "@/components/ehr/ConditionImage";
import {
  conceptText,
  interpretationKey,
  interpretationToState,
  minutesOf,
  pick,
} from "../labels";
import {
  getDiscoveredImaging,
  getDiscoveredLabs,
  getEncounterClockMs,
  useEncounterState,
} from "@/state/encounterStore";
import type { PlacedOrder } from "@/state/encounterStore";
import {
  getOrderableByCode,
  hasGroundTruthResult,
  syntheticNormalResult,
  type Orderable,
} from "@/domain/orderables";
import type { CaseInstance, ImagingResult } from "@/domain/case";
import type { Observation } from "@/domain/fhir";
import type { Bilingual, Lang } from "@/data/mock";

export interface ResultsTabProps {
  lang: Lang;
}

/** Local 1 Hz tick so pending countdowns advance + synthetic orders finalise. */
function useSecondTick(active: boolean): void {
  const [, force] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => force((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [active]);
}

/** A unified result row: ground-truth lab OR synthetic within-normal value. */
interface ResultRow {
  id: string;
  observation: Observation;
  synthetic: boolean;
}

/** A unified imaging entry: ground-truth study OR synthetic normal study. */
interface ImagingEntry {
  id: string;
  modality: Bilingual;
  conclusion?: Bilingual;
  query: string;
  modalityShort: string;
  orderedAt?: number;
  resultedAt: number;
  clinicalEta: string;
  synthetic: boolean;
}

/** True when a placed order should render as imaging (shows a real image). */
function orderIsImaging(order: PlacedOrder): boolean {
  const o = getOrderableByCode(order.code);
  if (o) return o.kind === "imaging";
  return order.category.startsWith("imaging");
}

/** A short modality tag for the PACS-style viewer chrome. */
function modalityShort(modalityEn: string): string {
  const m = modalityEn.toLowerCase();
  if (/\bct\b|tomograph|ctpa|angiogram/.test(m)) return "CT";
  if (/x-?ray|radiograph|cxr|axr/.test(m)) return "X-ray";
  if (/ultrasound|\bus\b|doppler|pocus|echo/.test(m)) return "US";
  if (/mri|\bmr\b|magnetic/.test(m)) return "MRI";
  if (/ecg|ekg|electrocardio/.test(m)) return "ECG";
  return modalityEn;
}

/** Build a catalog-or-fallback orderable for a placed order. */
function orderableFor(order: PlacedOrder): Orderable {
  const found = getOrderableByCode(order.code);
  if (found) return found;
  const imaging = order.category.startsWith("imaging");
  return {
    code: order.code,
    label: { en: order.labelEn, tr: order.labelTr },
    kind: imaging ? "imaging" : "laboratory",
    category: imaging ? "imaging" : "labs",
  };
}

/**
 * ResultsTab — the resulted-data surface (docs §2.2 / §2.3). Progressive
 * disclosure holds: only ORDERED tests appear. A summary strip counts resulted
 * orders and flags abnormal / critical values; criticals surface in a dedicated
 * callout. Pending orders show a live "in progress · ETA" countdown. Ground-truth
 * labs render in a dense table with reference ranges and icon+text abnormal flags
 * (never colour alone). Every IMAGING order shows a REAL representative image via
 * ConditionImage. Orders the case carries no ground truth for still resolve — as
 * a plausible within-normal-limits result — so ANY order returns something, with
 * authored (abnormal) ground truth always taking precedence.
 */
export function ResultsTab({ lang }: ResultsTabProps) {
  const { t } = useTranslation();
  const state = useEncounterState();
  const [abnormalOnly, setAbnormalOnly] = useState(false);

  const caseInstance = state.caseInstance;
  const nowMs = getEncounterClockMs(state);
  const isResulted = (o: PlacedOrder) => o.resolved || nowMs >= o.resultsReadyAt;
  const pending = state.orders.filter((o) => !isResulted(o));
  useSecondTick(pending.length > 0);

  const groundLabs = getDiscoveredLabs(state);
  const groundImaging = getDiscoveredImaging(state);

  // Synthetic results for resulted orders the case has no ground truth for.
  const { syntheticLabRows, syntheticImaging } = useMemo(() => {
    const labs: ResultRow[] = [];
    const imaging: ImagingEntry[] = [];
    if (!caseInstance) return { syntheticLabRows: labs, syntheticImaging: imaging };
    for (const order of state.orders) {
      if (!isResulted(order)) continue;
      if (hasGroundTruthResult(caseInstance, order.code)) continue;
      const orderable = orderableFor(order);
      const syn = syntheticNormalResult(orderable, caseInstance);
      if (orderIsImaging(order)) {
        imaging.push(
          buildSyntheticImaging(order, orderable, syn.report?.conclusion, lang),
        );
      } else {
        for (const obs of syn.observations) {
          labs.push({ id: `${order.code}-${obs.id}`, observation: obs, synthetic: true });
        }
      }
    }
    return { syntheticLabRows: labs, syntheticImaging: imaging };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseInstance, state.orders, nowMs, lang]);

  // Ground-truth imaging → unified entries (with dx-derived image queries).
  const groundImagingEntries = useMemo<ImagingEntry[]>(() => {
    if (!caseInstance) return [];
    return groundImaging.map((im) =>
      buildGroundImaging(im, caseInstance, state.orders, state.results, nowMs, lang),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseInstance, groundImaging, state.orders, state.results, nowMs, lang]);

  const imagingEntries = [...groundImagingEntries, ...syntheticImaging].sort(
    (a, b) => a.resultedAt - b.resultedAt,
  );

  const abnormalLabs = useMemo(
    () => groundLabs.filter((l) => interpretationToState(l.observation.interpretation) !== "normal"),
    [groundLabs],
  );
  const criticalLabs = useMemo(
    () => groundLabs.filter((l) => interpretationToState(l.observation.interpretation) === "critical"),
    [groundLabs],
  );

  const groundRows: ResultRow[] = (abnormalOnly ? abnormalLabs : groundLabs).map((l) => ({
    id: l.id,
    observation: l.observation,
    synthetic: false,
  }));
  const shownLabRows = abnormalOnly ? groundRows : [...groundRows, ...syntheticLabRows];

  const nothingOrdered = state.orders.length === 0;
  const resultedOrders = state.orders.filter(isResulted).length;

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
              {groundLabs.length > 0 ? (
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
                <li key={l.id} className="flex items-baseline justify-between gap-3 text-sm text-fg">
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

      {/* Pending orders — in progress · ETA */}
      {pending.length > 0 ? (
        <Card padding="md">
          <h3 className="mb-2 text-sm font-semibold text-fg">
            {t("ehr.results.pendingHeading")}
          </h3>
          <ul className="flex flex-col gap-2">
            {pending.map((o, i) => {
              const etaSec = Math.max(0, Math.ceil((o.resultsReadyAt - nowMs) / 1000));
              const clinicalEta = lang === "tr" ? o.clinicalLabelTr : o.clinicalLabelEn;
              return (
                <li key={`${o.code}-${i}`} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate text-fg">
                    {lang === "tr" ? o.labelTr : o.labelEn}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="font-mono text-[11px] tabular-nums text-subtle">
                      {t("orders2.results.eta", { eta: clinicalEta })}
                    </span>
                    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] tabular-nums text-[color:var(--state-caution)]">
                      <Timer weight="bold" className="h-3.5 w-3.5 motion-safe:animate-pulse" aria-hidden />
                      {etaSec > 0
                        ? t("ehr2.results.readyIn", { sec: etaSec })
                        : t("ehr2.results.readyIn", { sec: 0 })}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      {/* Laboratory results (ground truth + synthetic normal) */}
      {shownLabRows.length > 0 ? (
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
                  <th scope="col" className="px-2 py-1.5 eyebrow">{t("ehr.results.analyte")}</th>
                  <th scope="col" className="px-2 py-1.5 eyebrow">{t("ehr.results.value")}</th>
                  <th scope="col" className="px-2 py-1.5 eyebrow">{t("ehr.results.reference")}</th>
                  <th scope="col" className="px-2 py-1.5 eyebrow">{t("ehr.results.flag")}</th>
                </tr>
              </thead>
              <tbody>
                {shownLabRows.map((r) => (
                  <LabResultRow key={r.id} row={r} lang={lang} />
                ))}
              </tbody>
            </table>
          </div>
          {abnormalOnly && shownLabRows.length === 0 ? (
            <p className="py-2 text-center text-xs italic text-muted">
              {t("ehr2.results.noAbnormal")}
            </p>
          ) : null}
        </Card>
      ) : null}

      {/* Imaging — every study shows a REAL representative image */}
      {imagingEntries.length > 0 ? (
        <Card padding="md">
          <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-fg">
            <Scan weight="bold" className="h-4 w-4 text-muted" aria-hidden />
            {t("ehr.results.imagingHeading")}
          </h3>
          <ImagingList entries={imagingEntries} lang={lang} />
        </Card>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Imaging entry builders                                                      */
/* -------------------------------------------------------------------------- */

function buildGroundImaging(
  im: ImagingResult,
  caseInstance: CaseInstance,
  orders: PlacedOrder[],
  results: { datumIds: string[]; at: number }[],
  nowMs: number,
  lang: Lang,
): ImagingEntry {
  const order = orders.find((o) => o.code === im.orderCode);
  const resolved = results.find((r) => r.datumIds.includes(im.id));
  const dxEn = conceptText(caseInstance.correctDiagnosis.code, "en");
  const modalityEn = im.modality.en;
  const query = im.imageQuery ? pick(im.imageQuery, lang) : `${dxEn} ${modalityEn}`;
  return {
    id: im.id,
    modality: im.modality,
    conclusion: im.report.conclusion,
    query,
    modalityShort: modalityShort(modalityEn),
    orderedAt: order?.placedAt,
    resultedAt: resolved?.at ?? order?.resultsReadyAt ?? nowMs,
    clinicalEta: order ? (lang === "tr" ? order.clinicalLabelTr : order.clinicalLabelEn) : "",
    synthetic: false,
  };
}

function buildSyntheticImaging(
  order: PlacedOrder,
  orderable: Orderable,
  conclusion: Bilingual | undefined,
  lang: Lang,
): ImagingEntry {
  const modalityEn = orderable.label.en;
  const isEcg = order.code === "11524-6";
  const query = isEcg ? "normal 12-lead ECG" : `normal ${modalityEn}`;
  return {
    id: `syn-${order.code}`,
    modality: orderable.label,
    conclusion,
    query,
    modalityShort: modalityShort(modalityEn),
    orderedAt: order.placedAt,
    resultedAt: order.resultsReadyAt,
    clinicalEta: lang === "tr" ? order.clinicalLabelTr : order.clinicalLabelEn,
    synthetic: true,
  };
}

/* -------------------------------------------------------------------------- */
/* Sub-components                                                              */
/* -------------------------------------------------------------------------- */

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
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</span>
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

/** One result row — ground truth (with abnormal flag) or synthetic normal. */
function LabResultRow({ row, lang }: { row: ResultRow; lang: Lang }) {
  const { t } = useTranslation();
  const obs = row.observation;
  const st = interpretationToState(obs.interpretation);
  const present = stateMap[st];
  const Icon = present.icon;
  const abnormal = st !== "normal";
  const flagText = row.synthetic
    ? t("orders2.results.wnl")
    : t(`ehr.results.interp.${interpretationKey(obs.interpretation)}`);

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
        {obs.valueQuantity ? (
          <>
            {obs.valueQuantity.value}
            {obs.valueQuantity.unit ? (
              <span className="ml-1 text-xs text-muted">{obs.valueQuantity.unit}</span>
            ) : null}
          </>
        ) : obs.valueString ? (
          pick(obs.valueString, lang)
        ) : (
          "—"
        )}
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
}

/** Imaging reports, each with a real representative image + ordered→resulted times. */
function ImagingList({ entries, lang }: { entries: ImagingEntry[]; lang: Lang }) {
  const { t } = useTranslation();
  const { container, item } = useStagger();

  return (
    <motion.ul {...container} className="flex flex-col gap-4">
      {entries.map((e) => (
        <motion.li
          key={e.id}
          {...item}
          className="rounded-control border border-border bg-bg-subtle p-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-sm font-medium text-fg">
              <Scan weight="bold" className="h-4 w-4 text-muted" aria-hidden />
              {pick(e.modality, lang)}
            </span>
            <span className="font-mono text-[11px] tabular-nums text-muted">
              {e.orderedAt != null
                ? t("orders2.results.timeline", {
                    ordered: minutesOf(e.orderedAt),
                    resulted: minutesOf(e.resultedAt),
                  })
                : t("ehr.results.reportedAt", { min: minutesOf(e.resultedAt) })}
            </span>
          </div>

          {e.clinicalEta ? (
            <p className="mt-0.5 font-mono text-[11px] tabular-nums text-subtle">
              {t("orders2.results.etaLabel", { eta: e.clinicalEta })}
            </p>
          ) : null}

          {e.conclusion ? (
            <p className="mt-1.5 text-sm leading-relaxed text-fg">
              <span className="font-medium text-muted">{t("ehr.results.impression")}: </span>
              {pick(e.conclusion, lang)}
              {e.synthetic ? (
                <span className="ml-1 text-xs italic text-muted">
                  ({t("orders2.results.wnl")})
                </span>
              ) : null}
            </p>
          ) : null}

          <ConditionImage
            className="mt-3"
            query={e.query}
            modality={e.modalityShort}
            caption={e.conclusion ? pick(e.conclusion, lang) : undefined}
          />
        </motion.li>
      ))}
    </motion.ul>
  );
}
