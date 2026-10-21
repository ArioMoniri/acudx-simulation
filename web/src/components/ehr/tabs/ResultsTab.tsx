import { useEffect, useMemo, useState } from "react";
import { displayUnit, withUnit } from "@/lib/units";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import {
  Timer,
  Flask,
  Scan,
  Virus,
  ShieldWarning,
  WarningCircle,
  TrendUp,
  TrendDown,
  Minus,
  FastForward,
} from "@phosphor-icons/react";

import {
  Badge,
  Button,
  Card,
  SectionLabel,
  StatusDot,
  Switch,
  Table,
  TableWrap,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from "@/components/ui";
import { useReveal, useStagger } from "@/lib/motion";
import { stateMap } from "@/components/clinicalState";
import { StudyViewer, type EngineStudy } from "@/components/ehr/StudyViewer";
import { engineObservationToFhir, type ResultSource } from "@/lib/liveEncounter";
import type { OrderResult } from "@/lib/resultsApi";
import {
  conceptText,
  interpretationKey,
  interpretationToState,
  minutesOf,
  pick,
} from "../labels";
import {
  advanceSimTime,
  getDiscoveredImaging,
  getDiscoveredLabs,
  getEncounterClockMs,
  nextResultInMs,
  realWaitMs,
  retryEngineResult,
  useEncounterState,
} from "@/state/encounterStore";
import { formatSimMinutes } from "@/domain/serverCatalog";
import type { PlacedOrder, ResolvedResult } from "@/state/encounterStore";
import {
  getOrderableByCode,
  isPanelOrder,
  syntheticResultAt,
  evolveAnchor,
  type Orderable,
} from "@/domain/orderables";
import type { AdministeredTreatment } from "@/domain/clinicalCourse";
import type { CaseInstance, ImagingResult, LabResult } from "@/domain/case";
import type { Observation } from "@/domain/fhir";
import type { Bilingual, Lang } from "@/data/schema";

export interface ResultsTabProps {
  lang: Lang;
  /**
   * When Guidance is OFF the learner must read each imaging/ECG study
   * themselves: the interpretive read (report impression + curated teaching
   * caption) is hidden in favour of a neutral prompt. The image, modality,
   * timing, safety disclaimer, and license/attribution stay visible either way.
   * Lab values/ranges are the data the student reads and are never gated.
   */
  guidanceOn: boolean;
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

/**
 * A unified result row: engine observation, authored ground truth, or the
 * offline synthetic normal. `synthetic` is true only for the offline fallback
 * (labelled as such in the UI); `source` is the full provenance.
 */
interface ResultRow {
  id: string;
  observation: Observation;
  synthetic: boolean;
  source: ResultSource;
}

/** A resulted lab/blood-gas/POC order rendered as a complete analyte panel. */
interface PanelGroup {
  key: string;
  title: Bilingual;
  orderedAt?: number;
  resultedAt: number;
  clinicalEta: string;
  rows: ResultRow[];
  abnormalCount: number;
  source: ResultSource;
}

/** One draw of one analyte in a serial trend. */
interface TrendPoint {
  drawMs: number;
  resultedAt: number;
  observation: Observation;
  synthetic: boolean;
}

/** One analyte trended across serial draws (sparkline + delta). */
interface AnalyteTrend {
  code: string;
  label: Bilingual;
  unit?: string;
  ref?: string;
  decimals: number;
  numeric: boolean;
  points: TrendPoint[];
  latest: Observation;
  delta?: number;
  direction: "up" | "down" | "flat";
  anyAbnormal: boolean;
  anySynthetic: boolean;
}

/** A resulted lab/gas/POC order that was ordered SERIALLY → a trend table. */
interface TrendGroup {
  key: string;
  title: Bilingual;
  drawCount: number;
  orderedFirst: number;
  resultedLast: number;
  clinicalEta: string;
  analytes: AnalyteTrend[];
  abnormalCount: number;
  source: ResultSource;
}

/** A microbiology / narrative-report result (culture, viral panel, serology). */
interface MicroEntry {
  id: string;
  title: Bilingual;
  conclusion?: Bilingual;
  orderedAt?: number;
  resultedAt: number;
  clinicalEta: string;
  synthetic: boolean;
  abnormal: boolean;
  source: ResultSource;
}

/** A live order the reachable engine could not answer (shown with a retry, no values). */
interface UnavailableEntry {
  id: string;
  title: Bilingual;
  orderedAt: number;
  resultedAt: number;
  orderId: string;
  reason: string | null;
}

/** A unified imaging entry: engine study, ground-truth study, or offline synthetic normal. */
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
  source: ResultSource;
  /** The server engine's structured study (Live mode). */
  engine?: EngineStudy;
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
  if (/x-?ray|radiograph|cxr|axr|kub/.test(m)) return "X-ray";
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

/** The primary analyte code of an observation. */
function analyteCode(obs: Observation): string {
  return obs.code.coding[0]?.code ?? "";
}

/** Is an observation abnormal (any non-normal interpretation)? */
function isAbnormal(obs: Observation): boolean {
  return interpretationToState(obs.interpretation) !== "normal";
}

/**
 * ResultsTab — the resulted-data surface (docs §2.2 / §2.3). Progressive
 * disclosure holds: only ORDERED tests appear. A summary strip counts resulted
 * orders and flags abnormal / critical values; criticals surface in a dedicated
 * callout. Pending orders show a live "in progress · ETA" countdown.
 *
 * Every resulted lab / blood-gas / POC order renders as a COMPLETE analyte
 * panel — a dense table of individual measurands, each with a value, unit,
 * reference range and icon+text abnormal flag (never colour alone). Authored
 * ground truth takes precedence PER ANALYTE, so an abnormal creatinine sits
 * inside an otherwise-normal, fully-populated BMP. Microbiology / serology
 * orders render as narrative reports; every IMAGING order shows a REAL
 * representative image (the engine's matched, licensed image in Live mode, the
 * curated bundle offline). Any order the case carries no ground truth for still
 * resolves: through the server results engine in Live mode, or as the labelled
 * "offline synthetic normal" when the gateway is unreachable. Every panel and
 * study carries a provenance chip (engine, case record, offline synthetic).
 */
export function ResultsTab({ lang, guidanceOn }: ResultsTabProps) {
  const { t } = useTranslation();
  const state = useEncounterState();
  const [abnormalOnly, setAbnormalOnly] = useState(false);

  const caseInstance = state.caseInstance;
  const nowMs = getEncounterClockMs(state);
  // Live mode: an order is resulted only when the store resolved it (the engine
  // answered or the labelled fallback ran). Offline, the playback ETA suffices.
  const isResulted = (o: PlacedOrder) => o.resolved || (!state.liveEnabled && nowMs >= o.resultsReadyAt);
  const pending = state.orders.filter((o) => !isResulted(o));
  const nextWaitMs = nextResultInMs(state);
  useSecondTick(pending.length > 0);
  const resultByOrderId = useMemo(() => {
    const m = new Map<string, ResolvedResult>();
    for (const r of state.results) m.set(r.orderId, r);
    return m;
  }, [state.results]);

  const groundLabs = getDiscoveredLabs(state);
  const groundImaging = getDiscoveredImaging(state);

  // Ground-truth labs indexed by the order code that reveals them.
  const groundByCode = useMemo(() => {
    const m = new Map<string, LabResult[]>();
    for (const l of groundLabs) {
      const arr = m.get(l.orderCode) ?? [];
      arr.push(l);
      m.set(l.orderCode, arr);
    }
    return m;
  }, [groundLabs]);

  const treatments = state.treatments;

  // Result timestamps per code, chronological (one per resolved ground-truth draw).
  const resultsByCode = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const r of state.results) {
      const arr = m.get(r.code) ?? [];
      arr.push(r.at);
      m.set(r.code, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a - b);
    return m;
  }, [state.results]);

  // Resulted orders, GROUPED BY CODE so serial re-orders collapse into a trend.
  // Each draw's synthetic/ground-truth value is tied to the clinical course at
  // its placedAt (draw time) + treatments, so re-ordering later trends.
  const { panelGroups, trendGroups, microEntries, syntheticImaging, unavailableEntries } = useMemo(() => {
    const panels: PanelGroup[] = [];
    const trends: TrendGroup[] = [];
    const micro: MicroEntry[] = [];
    const imaging: ImagingEntry[] = [];
    const unavailable: UnavailableEntry[] = [];
    if (!caseInstance)
      return { panelGroups: panels, trendGroups: trends, microEntries: micro, syntheticImaging: imaging, unavailableEntries: unavailable };

    const groups = new Map<string, PlacedOrder[]>();
    for (const o of state.orders) {
      if (!isResulted(o)) continue;
      const arr = groups.get(o.code) ?? [];
      arr.push(o);
      groups.set(o.code, arr);
    }

    for (const [code, rawDraws] of groups) {
      const draws = [...rawDraws].sort((a, b) => a.placedAt - b.placedAt);
      const last = draws[draws.length - 1];
      const orderable = orderableFor(draws[0]);
      const ground = groundByCode.get(code) ?? [];
      const clinicalEta = lang === "tr" ? last.clinicalLabelTr : last.clinicalLabelEn;
      const times = resultsByCode.get(code) ?? [];
      const resultedAtAt = (i: number): number => times[i] ?? draws[i].resultsReadyAt;
      const engineAt = (i: number): OrderResult | undefined => resultByOrderId.get(draws[i].id)?.engine;
      const lastEngine = engineAt(draws.length - 1);
      // Review 2026-10-21: the reachable engine could not produce this result.
      // Show that honestly (with a retry), never an offline synthetic value.
      if (resultByOrderId.get(last.id)?.source === "engine-unavailable") {
        unavailable.push({ id: `unavail-${code}`, title: orderable.label, orderedAt: last.placedAt, resultedAt: resultedAtAt(draws.length - 1), orderId: last.id, reason: last.engineError ?? null });
        continue;
      }
      // The engine answered that there is nothing to sample (no effusion): say so.
      if (lastEngine && lastEngine.status === "unavailable" && lastEngine.kind !== "imaging") {
        micro.push({ id: `micro-${code}`, title: orderable.label, conclusion: lastEngine.message ? { en: lastEngine.message, tr: lastEngine.message } : undefined,
          orderedAt: last.placedAt, resultedAt: resultedAtAt(draws.length - 1), clinicalEta, synthetic: false, abnormal: false, source: "engine" });
        continue;
      }

      // Imaging. Live mode: the engine's structured study with its matched image
      // (or "unavailable" with findings only) for every placed study, including
      // one the case authored (the engine already honours authored findings).
      // Offline: a synthetic within-normal-limits study ONLY when the case
      // carries no ground-truth imaging for this order. Ground truth is rendered
      // separately (groundImagingEntries); `ground` above is ground LABS, so
      // without this imaging-specific guard an ordered study that HAS ground
      // truth would ALSO get a contradictory synthetic-normal entry (e.g. a real
      // ischaemia ECG shown next to a spurious "normal sinus rhythm" ECG).
      if (orderIsImaging(draws[0])) {
        const hasGroundImaging = groundImaging.some((im) => im.orderCode === code);
        if (lastEngine) {
          imaging.push(buildEngineImaging(last, orderable, lastEngine, lang, resultedAtAt(draws.length - 1)));
        } else if (!hasGroundImaging) {
          const syn = syntheticResultAt(orderable, caseInstance, { dynamic: true });
          imaging.push(
            buildSyntheticImaging(last, orderable, syn.report?.conclusion, lang, resultedAtAt(draws.length - 1)),
          );
        }
        continue;
      }

      // Microbiology / serology — narrative report (latest draw).
      if (orderable.category === "micro") {
        const resultedAt = resultedAtAt(draws.length - 1);
        if (lastEngine) {
          const lines = (lastEngine.observations ?? []).map((o) => `${o.name}: ${withUnit(o.value, o.unit)}`);
          const text = lines.join("; ") || lastEngine.message || "";
          micro.push({
            id: `micro-${code}`,
            title: orderable.label,
            conclusion: text ? { en: text, tr: text } : undefined,
            orderedAt: last.placedAt,
            resultedAt,
            clinicalEta,
            synthetic: false,
            abnormal: Boolean(lastEngine.abnormal),
            source: "engine",
          });
        } else if (ground.length) {
          const g = ground[0];
          micro.push({
            id: `micro-${code}`,
            title: orderable.label,
            conclusion: g.report?.conclusion ?? g.observation.valueString,
            orderedAt: last.placedAt,
            resultedAt,
            clinicalEta,
            synthetic: false,
            abnormal: ground.some((l) => isAbnormal(l.observation)),
            source: "case",
          });
        } else {
          const syn = syntheticResultAt(orderable, caseInstance, {
            dynamic: true,
            drawMs: last.placedAt,
            treatments,
          });
          micro.push({
            id: `micro-${code}`,
            title: orderable.label,
            conclusion: syn.report?.conclusion,
            orderedAt: last.placedAt,
            resultedAt,
            clinicalEta,
            synthetic: true,
            abnormal: !!syn.abnormal,
            source: "offline-synthetic-normal",
          });
        }
        continue;
      }

      // Labs / blood gas / POC — per-draw complete analyte panels. An engine
      // answer renders its observations verbatim (flags, ranges and deltas are
      // the server's); otherwise the authored / offline rows are built locally.
      const perDraw = draws.map((o, i) => {
        const engine = engineAt(i);
        return {
          order: o,
          resultedAt: resultedAtAt(i),
          rows: engine
            ? engineRows(code, engine, caseInstance.patient.id, resultedAtAt(i), i)
            : buildDrawRows(code, orderable, ground, caseInstance, {
                drawMs: o.placedAt,
                treatments,
                drawIndex: i,
              }),
        };
      });
      const populated = perDraw.filter((d) => d.rows.length > 0);
      if (populated.length === 0) continue;
      const source = dominantSource(populated.flatMap((d) => d.rows));

      if (populated.length === 1) {
        const d0 = populated[0];
        panels.push({
          key: code,
          title: orderable.label,
          orderedAt: d0.order.placedAt,
          resultedAt: d0.resultedAt,
          clinicalEta,
          rows: d0.rows,
          abnormalCount: d0.rows.filter((r) => isAbnormal(r.observation)).length,
          source,
        });
      } else {
        const tg = buildTrendGroup(code, orderable.label, clinicalEta, populated, source);
        if (tg) trends.push(tg);
      }
    }

    return { panelGroups: panels, trendGroups: trends, microEntries: micro, syntheticImaging: imaging, unavailableEntries: unavailable };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseInstance, state.orders, state.results, treatments, groundByCode, resultsByCode, resultByOrderId, nowMs, lang]);

  // Engine observations outside normal (Live mode) join the authored flags in
  // the summary badges and the critical callout.
  const engineFlagged = useMemo(() => {
    const abnormal: Array<{ id: string; label: string; value: string; unit: string }> = [];
    const critical: Array<{ id: string; label: string; value: string; unit: string }> = [];
    for (const r of state.results) {
      for (const o of r.engine?.observations ?? []) {
        const item = { id: `${r.orderId}-${o.loinc}`, label: o.short?.trim() || o.name, value: String(o.value), unit: o.unit };
        if (o.flag !== "N") abnormal.push(item);
        if (o.critical) critical.push(item);
      }
    }
    return { abnormal, critical };
  }, [state.results]);

  // Ground-truth imaging → unified entries (with dx-derived image queries).
  // In Live mode a study the engine answered is already listed above, so its
  // authored twin is skipped to avoid two readings of one order.
  const groundImagingEntries = useMemo<ImagingEntry[]>(() => {
    if (!caseInstance) return [];
    const engineCodes = new Set(state.results.filter((r) => r.engine).map((r) => r.code));
    return groundImaging
      .filter((im) => !engineCodes.has(im.orderCode))
      .map((im) => buildGroundImaging(im, caseInstance, state.orders, state.results, nowMs, lang));
  }, [caseInstance, groundImaging, state.orders, state.results, nowMs, lang]);

  const imagingEntries = [...groundImagingEntries, ...syntheticImaging].sort(
    (a, b) => a.resultedAt - b.resultedAt,
  );

  const abnormalLabs = useMemo(
    () => groundLabs.filter((l) => isAbnormal(l.observation)),
    [groundLabs],
  );
  const criticalLabs = useMemo(
    () => groundLabs.filter((l) => interpretationToState(l.observation.interpretation) === "critical"),
    [groundLabs],
  );
  const abnormalCount = abnormalLabs.length + engineFlagged.abnormal.length;
  const criticalItems = useMemo(
    () => [
      ...criticalLabs.map((l) => ({
        id: l.id,
        label: conceptText(l.observation.code, lang),
        value: String(l.observation.valueQuantity?.value ?? ""),
        unit: l.observation.valueQuantity?.unit ?? "",
      })),
      ...engineFlagged.critical,
    ],
    [criticalLabs, engineFlagged.critical, lang],
  );

  // Abnormal-only view: keep only abnormal analytes / non-normal reports.
  const shownPanels = abnormalOnly
    ? panelGroups
        .map((g) => ({ ...g, rows: g.rows.filter((r) => isAbnormal(r.observation)) }))
        .filter((g) => g.rows.length > 0)
    : panelGroups;
  const shownTrends = abnormalOnly
    ? trendGroups
        .map((g) => ({ ...g, analytes: g.analytes.filter((a) => a.anyAbnormal) }))
        .filter((g) => g.analytes.length > 0)
    : trendGroups;
  const shownMicro = abnormalOnly ? microEntries.filter((e) => e.abnormal) : microEntries;
  const shownImaging = abnormalOnly ? imagingEntries.filter((e) => !e.synthetic) : imagingEntries;

  const nothingOrdered = state.orders.length === 0;
  const resultedOrders = state.orders.filter(isResulted).length;
  const nothingAbnormalShown =
    abnormalOnly &&
    shownPanels.length === 0 &&
    shownTrends.length === 0 &&
    shownMicro.length === 0 &&
    shownImaging.length === 0;

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
          <Card padding="sm">
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <SummaryStat
                  label={t("ehr2.results.summaryHeading")}
                  value={t("ehr2.results.resultedOf", {
                    done: resultedOrders,
                    total: state.orders.length,
                  })}
                />
                {pending.length > 0 || abnormalCount > 0 || criticalItems.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {pending.length > 0 ? (
                      <Badge tone="caution" icon={<Timer weight="fill" className="h-3.5 w-3.5" aria-hidden />}>
                        {t("ehr2.results.pendingCount", { count: pending.length })}
                      </Badge>
                    ) : null}
                    {abnormalCount > 0 ? (
                      <Badge tone="warning" icon={<WarningCircle weight="fill" className="h-3.5 w-3.5" aria-hidden />}>
                        {t("ehr2.results.abnormalCount", { count: abnormalCount })}
                      </Badge>
                    ) : null}
                    {criticalItems.length > 0 ? (
                      <Badge tone="critical" icon={<ShieldWarning weight="fill" className="h-3.5 w-3.5" aria-hidden />}>
                        {t("ehr2.results.criticalCount", { count: criticalItems.length })}
                      </Badge>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {groundLabs.length > 0 || state.results.some((r) => r.engine) ? (
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
      {criticalItems.length > 0 ? (
        <motion.div {...criticalReveal}>
          <div
            className="border-s-2 bg-surface px-4 py-3"
            style={{
              borderColor: "var(--state-critical)",
              backgroundColor: "color-mix(in srgb, var(--state-critical) 6%, transparent)",
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
              {criticalItems.map((l) => (
                <li key={l.id} className="flex items-baseline justify-between gap-3 text-sm text-fg">
                  <span className="font-medium">{l.label}</span>
                  <span className="font-mono tabular-nums">
                    {l.value}
                    {l.unit ? <span className="ms-1 text-xs text-muted">{" "}{displayUnit(l.unit)}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted">{t("ehr2.results.criticalNote")}</p>
          </div>
        </motion.div>
      ) : null}

      {/* Pending orders: in progress on the sim clock, with preliminary reports */}
      {pending.length > 0 ? (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-1.5">
            <h3 className="flex items-center gap-1.5 text-[0.8125rem] font-semibold text-fg">
              <Timer weight="bold" className="h-4 w-4 text-muted" aria-hidden />
              {t("ehr.results.pendingHeading")}
            </h3>
            {nextWaitMs != null && nextWaitMs > 0 ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => advanceSimTime(nextWaitMs)}
                title={t("results3.advanceHint")}
                leadingIcon={<FastForward weight="bold" className="h-3.5 w-3.5" aria-hidden />}
              >
                {t("results3.advance", { time: formatSimMinutes(nextWaitMs / 60_000, lang) })}
              </Button>
            ) : null}
          </div>
          <ul className="flex flex-col gap-2">
            {pending.map((o, i) => {
              const leftMin = Math.max(0, (o.resultsReadyAt - nowMs) / 60_000);
              const clinicalEta = lang === "tr" ? o.clinicalLabelTr : o.clinicalLabelEn;
              const prelimDue = o.preliminaryAt != null && nowMs >= o.preliminaryAt;
              const failed = o.engineStatus === "error";
              return (
                <li key={`${o.code}-${i}`} data-chart-ref={o.code} className="flex flex-col gap-0.5 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-fg">
                      {lang === "tr" ? o.labelTr : o.labelEn}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="font-mono text-[11px] tabular-nums text-subtle">
                        {t("orders2.results.eta", { eta: clinicalEta })}
                      </span>
                      <Badge tone="caution" icon={<Timer weight="bold" className="h-3 w-3 motion-safe:animate-pulse" aria-hidden />}>
                        {prelimDue ? t("results3.preliminary") : t("results3.pending")}
                      </Badge>
                      <span className="font-mono text-[11px] tabular-nums text-[color:var(--state-caution)]">
                        {t("results3.readyIn", { time: formatSimMinutes(leftMin, lang) })}
                        {` · ${t("results3.realWait", { sec: Math.max(1, Math.ceil(realWaitMs(state, o) / 1000)) })}`}
                      </span>
                    </span>
                  </div>
                  {prelimDue && o.preliminaryText ? (
                    <p className="text-xs text-muted">
                      <span className="font-medium text-fg">{t("results3.preliminary")}:</span> {o.preliminaryText}
                    </p>
                  ) : null}
                  {failed ? (
                    <p className="flex flex-wrap items-center gap-2 text-xs text-[color:var(--state-warning)]">
                      <WarningCircle weight="fill" className="h-3.5 w-3.5" aria-hidden />
                      {t("results3.engineFailed")}
                      <Button size="sm" variant="ghost" onClick={() => retryEngineResult(o.id)}>
                        {t("results3.retry")}
                      </Button>
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* Live orders the reachable engine could not answer: no invented values */}
      {unavailableEntries.length > 0 ? (
        <section className="flex flex-col gap-2">
          {unavailableEntries.map((u) => (
            <Card key={u.id} padding="md">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-fg">
                  <WarningCircle weight="fill" className="h-4 w-4 text-[color:var(--state-warning)]" aria-hidden />
                  {pick(u.title, lang)}
                </span>
                <SourceChip source="engine-unavailable" />
              </div>
              <p className="mt-1 text-xs text-muted">{t("results3.unavailableBody")}</p>
            </Card>
          ))}
        </section>
      ) : null}

      {/* Laboratory results — serial trends first, then single-draw panels */}
      {shownPanels.length > 0 || shownTrends.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h3 className="flex items-center gap-1.5 border-b border-border pb-1.5 text-[0.8125rem] font-semibold text-fg">
            <Flask weight="bold" className="h-4 w-4 text-muted" aria-hidden />
            {t("ehr.results.labsHeading")}
          </h3>
          <div className="flex flex-col gap-5">
            {shownTrends.map((g) => (
              <TrendPanel key={`trend-${g.key}`} group={g} lang={lang} />
            ))}
            {shownPanels.map((g) => (
              <PanelTable key={g.key} group={g} lang={lang} />
            ))}
          </div>
        </section>
      ) : null}

      {/* Microbiology, serology & other narrative reports */}
      {shownMicro.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h3 className="flex items-center gap-1.5 border-b border-border pb-1.5 text-[0.8125rem] font-semibold text-fg">
            <Virus weight="bold" className="h-4 w-4 text-muted" aria-hidden />
            {t("labs2.results.microHeading")}
          </h3>
          <MicroList entries={shownMicro} lang={lang} />
        </section>
      ) : null}

      {/* Imaging — every study shows a REAL representative image */}
      {shownImaging.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h3 className="flex items-center gap-1.5 border-b border-border pb-1.5 text-[0.8125rem] font-semibold text-fg">
            <Scan weight="bold" className="h-4 w-4 text-muted" aria-hidden />
            {t("ehr.results.imagingHeading")}
          </h3>
          <ImagingList entries={shownImaging} lang={lang} guidanceOn={guidanceOn} />
        </section>
      ) : null}

      {nothingAbnormalShown ? (
        <Card padding="md">
          <p className="py-2 text-center text-xs italic text-muted">
            {t("ehr2.results.noAbnormal")}
          </p>
        </Card>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Panel builders                                                              */
/* -------------------------------------------------------------------------- */

/** Draw context: sample time + treatments-so-far + which serial draw this is. */
interface DrawCtx {
  drawMs: number;
  treatments: AdministeredTreatment[];
  drawIndex: number;
}

/**
 * Build the rows for ONE draw of a resulted lab/gas/POC order. A panel order
 * expands to its full analyte set; authored ground-truth analytes replace the
 * matching synthetic value (per-analyte precedence). The synthetic values are
 * condition-tuned AND tied to the clinical course at the draw time. On serial
 * re-draws (`drawIndex > 0`) an authored analyte is re-derived from its authored
 * value as an anchor via {@link evolveAnchor}, so the trend actually moves.
 */
function buildDrawRows(
  code: string,
  orderable: Orderable,
  ground: LabResult[],
  caseInstance: CaseInstance,
  ctx: DrawCtx,
): ResultRow[] {
  const first = ctx.drawIndex === 0;
  const groundByAnalyte = new Map<string, Observation>();
  for (const l of ground) {
    const key = analyteCode(l.observation);
    if (!groundByAnalyte.has(key)) groundByAnalyte.set(key, l.observation);
  }
  const OFFLINE: ResultSource = "offline-synthetic-normal";
  const groundRow = (obs: Observation, key: string): ResultRow =>
    first
      ? { id: `${code}-${key}`, observation: obs, synthetic: false, source: "case" }
      : { id: `${code}-${key}-d${ctx.drawIndex}`, observation: evolveAnchor(obs, caseInstance, ctx), synthetic: true, source: OFFLINE };

  if (!isPanelOrder(code)) {
    // Bespoke / uncatalogued code: authored ground truth (evolved on re-draws),
    // else a single condition/time-tuned synthetic line.
    if (ground.length > 0) return ground.map((l) => groundRow(l.observation, l.id));
    const syn = syntheticResultAt(orderable, caseInstance, { dynamic: true, ...ctx });
    return syn.observations.map((obs) => ({ id: `${code}-${obs.id}`, observation: obs, synthetic: true, source: OFFLINE }));
  }

  const syn = syntheticResultAt(orderable, caseInstance, { dynamic: true, ...ctx });
  const rows: ResultRow[] = [];
  const consumed = new Set<string>();

  for (const obs of syn.observations) {
    const key = analyteCode(obs);
    const gt = groundByAnalyte.get(key);
    if (gt) {
      consumed.add(key);
      rows.push(groundRow(gt, key));
    } else {
      rows.push({ id: `${code}-${obs.id}`, observation: obs, synthetic: true, source: OFFLINE });
    }
  }

  // Authored analytes that fall outside the modelled panel — append them.
  for (const l of ground) {
    const key = analyteCode(l.observation);
    if (consumed.has(key)) continue;
    consumed.add(key);
    rows.push(
      first
        ? { id: `${code}-extra-${l.id}`, observation: l.observation, synthetic: false, source: "case" }
        : { id: `${code}-extra-${l.id}-d${ctx.drawIndex}`, observation: evolveAnchor(l.observation, caseInstance, ctx), synthetic: true, source: OFFLINE },
    );
  }

  return rows;
}

/** Rows for one draw answered by the server results engine (Live mode). */
function engineRows(
  code: string,
  engine: OrderResult,
  patientId: string,
  resultedAt: number,
  drawIndex: number,
): ResultRow[] {
  return (engine.observations ?? []).map((obs) => ({
    id: `${code}-${obs.loinc}-e${drawIndex}`,
    observation: engineObservationToFhir(obs, patientId, resultedAt, `${code}-e${drawIndex}`),
    synthetic: false,
    source: "engine",
  }));
}

/** The provenance to label a group with: engine beats case beats offline. */
function dominantSource(rows: ResultRow[]): ResultSource {
  if (rows.some((r) => r.source === "engine")) return "engine";
  if (rows.some((r) => r.source === "case")) return "case";
  return "offline-synthetic-normal";
}

/** Trailing-decimal count of a numeric value, for consistent trend formatting. */
function decimalsOf(v: number | undefined): number {
  if (typeof v !== "number") return 0;
  const s = String(v);
  const i = s.indexOf(".");
  return i < 0 ? 0 : s.length - i - 1;
}

/**
 * Fold a code's serial draws into a per-analyte trend: each analyte carries its
 * value at every draw (aligned by analyte code), the latest value, and the delta
 * / direction from first to last draw for the sparkline + change indicator.
 */
function buildTrendGroup(
  code: string,
  title: Bilingual,
  clinicalEta: string,
  perDraw: Array<{ order: PlacedOrder; resultedAt: number; rows: ResultRow[] }>,
  source: ResultSource,
): TrendGroup | null {
  const seen = new Set<string>();
  const analyteOrder: string[] = [];
  for (const d of perDraw) {
    for (const r of d.rows) {
      const ac = analyteCode(r.observation);
      if (!seen.has(ac)) {
        seen.add(ac);
        analyteOrder.push(ac);
      }
    }
  }

  const analytes: AnalyteTrend[] = [];
  for (const ac of analyteOrder) {
    const points: TrendPoint[] = [];
    for (const d of perDraw) {
      const row = d.rows.find((r) => analyteCode(r.observation) === ac);
      if (!row) continue;
      points.push({ drawMs: d.order.placedAt, resultedAt: d.resultedAt, observation: row.observation, synthetic: row.synthetic });
    }
    if (points.length === 0) continue;
    const latest = points[points.length - 1].observation;
    const firstObs = points[0].observation;
    const lv = latest.valueQuantity?.value;
    const fv = firstObs.valueQuantity?.value;
    const numeric = typeof lv === "number";
    let delta: number | undefined;
    let direction: "up" | "down" | "flat" = "flat";
    if (typeof lv === "number" && typeof fv === "number") {
      delta = lv - fv;
      const eps = Math.abs(fv) * 0.01 + 1e-6;
      direction = delta > eps ? "up" : delta < -eps ? "down" : "flat";
    }
    analytes.push({
      code: ac,
      label: latest.code.text ?? { en: ac, tr: ac },
      unit: latest.valueQuantity?.unit,
      ref: latest.referenceRange,
      decimals: decimalsOf(lv),
      numeric,
      points,
      latest,
      delta,
      direction,
      anyAbnormal: points.some((p) => isAbnormal(p.observation)),
      anySynthetic: points.some((p) => p.synthetic),
    });
  }
  if (analytes.length === 0) return null;

  return {
    key: code,
    title,
    drawCount: perDraw.length,
    orderedFirst: perDraw[0].order.placedAt,
    resultedLast: perDraw[perDraw.length - 1].resultedAt,
    clinicalEta,
    analytes,
    abnormalCount: analytes.filter((a) => a.anyAbnormal).length,
    source,
  };
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
  // Match the representative image to what the REPORT concludes (the impression
  // the learner actually reads), so the picture can never contradict it — e.g. a
  // "No ST elevation" ischaemia read must not resolve to a STEMI tracing. Fall
  // back to an authored image query / the diagnosis only when there is no
  // conclusion to match on.
  const conclusion = im.report.conclusion ? pick(im.report.conclusion, lang) : "";
  const authored = im.imageQuery ? pick(im.imageQuery, lang) : dxEn;
  const query = `${conclusion || authored} ${modalityEn}`.trim();
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
    source: "case",
  };
}

/** An imaging or ECG study answered by the server engine, with its provenance. */
function buildEngineImaging(
  order: PlacedOrder,
  orderable: Orderable,
  engine: OrderResult,
  lang: Lang,
  resultedAt: number,
): ImagingEntry {
  const modalityEn = orderable.label.en;
  const report = engine.report;
  const ecg = engine.ecg ?? null;
  const impression = ecg ? ecg.measurements.interpretation : report?.impression ?? engine.reason ?? "";
  const study: EngineStudy = ecg
    ? { status: "ok", findings: [], impression, ecg }
    : {
        status: report?.image_status ?? "unavailable",
        image: report?.image ?? null,
        provenance: report?.provenance ?? null,
        findings: report?.findings ?? [],
        impression,
        reason: report?.image_reason ?? engine.reason ?? null,
      };
  return {
    id: `engine-${order.id}`,
    modality: orderable.label,
    conclusion: impression ? { en: impression, tr: impression } : undefined,
    query: `${impression} ${modalityEn}`.trim(),
    modalityShort: ecg ? "ECG" : modalityShort(modalityEn),
    orderedAt: order.placedAt,
    resultedAt,
    clinicalEta: lang === "tr" ? order.clinicalLabelTr : order.clinicalLabelEn,
    synthetic: false,
    source: "engine",
    engine: study,
  };
}

function buildSyntheticImaging(
  order: PlacedOrder,
  orderable: Orderable,
  conclusion: Bilingual | undefined,
  lang: Lang,
  resultedAt: number,
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
    resultedAt,
    clinicalEta: lang === "tr" ? order.clinicalLabelTr : order.clinicalLabelEn,
    synthetic: true,
    source: "offline-synthetic-normal",
  };
}

/**
 * A small secondary LOINC tag for an orderable that has a verified LOINC order
 * code. The human label is the heading; the code is reference detail only.
 */
function LoincTag({ code }: { code: string }) {
  const { t } = useTranslation();
  const loinc = getOrderableByCode(code)?.loinc;
  if (!loinc) return null;
  return (
    <span className="font-mono text-[10px] font-normal tabular-nums text-subtle" title={t("results3.loincTitle")}>
      LOINC {loinc}
    </span>
  );
}

/** Provenance chip: results engine, authored case record, or the offline synthetic normal. */
function SourceChip({ source }: { source: ResultSource }) {
  const { t } = useTranslation();
  const tone = source === "engine" ? "brand" : source === "case" ? "neutral" : "caution";
  return (
    <Badge tone={tone} variant="outline" className="shrink-0" title={t(`live2.results.sourceHint.${source}`)}>
      {t(`live2.results.source.${source}`)}
    </Badge>
  );
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
        <SectionLabel>{label}</SectionLabel>
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

/** One complete analyte panel: heading + timeline + dense value table. */
function PanelTable({ group, lang }: { group: PanelGroup; lang: Lang }) {
  const { t } = useTranslation();
  return (
    <section data-chart-ref={group.key}>
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h4 className="flex items-baseline gap-2 text-sm font-semibold text-fg">
          {pick(group.title, lang)}
          <span className="font-mono text-[11px] font-normal tabular-nums text-subtle">
            {t("labs2.results.analytes", { count: group.rows.length })}
          </span>
          <LoincTag code={group.key} />
          <SourceChip source={group.source} />
        </h4>
        <span className="font-mono text-[11px] tabular-nums text-muted">
          {group.orderedAt != null
            ? t("orders2.results.timeline", {
                ordered: minutesOf(group.orderedAt),
                resulted: minutesOf(group.resultedAt),
              })
            : t("ehr.results.reportedAt", { min: minutesOf(group.resultedAt) })}
        </span>
      </div>
      <TableWrap>
        <Table className="min-w-[460px]">
          <caption className="sr-only">
            {pick(group.title, lang)} — {t("ehr.results.labsCaption")}
          </caption>
          <THead>
            <Tr>
              <Th>{t("ehr.results.analyte")}</Th>
              <Th>{t("ehr.results.value")}</Th>
              <Th>{t("ehr.results.reference")}</Th>
              <Th>{t("ehr.results.flag")}</Th>
            </Tr>
          </THead>
          <TBody>
            {group.rows.map((r) => (
              <LabResultRow key={r.id} row={r} lang={lang} />
            ))}
          </TBody>
        </Table>
      </TableWrap>
    </section>
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
  // Synthetic + normal reads "WNL"; synthetic + abnormal shows the real flag but
  // is always tagged "est." so a modelled value is never mistaken for measured.
  const flagText =
    row.synthetic && !abnormal
      ? t("orders2.results.wnl")
      : t(`ehr.results.interp.${interpretationKey(obs.interpretation)}`);

  return (
    <Tr>
      <th scope="row" className="px-3 py-1.5 text-start align-middle font-medium text-fg">
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block h-3.5 w-0.5"
            style={{ backgroundColor: abnormal ? present.colorVar : "transparent" }}
          />
          {conceptText(obs.code, lang)}
        </span>
      </th>
      <Td className="font-mono tabular-nums">
        {obs.valueQuantity ? (
          <>
            {obs.valueQuantity.value}
            {obs.valueQuantity.unit ? (
              <span className="ms-1 text-xs text-muted">{" "}{displayUnit(obs.valueQuantity.unit)}</span>
            ) : null}
          </>
        ) : obs.valueString ? (
          pick(obs.valueString, lang)
        ) : (
          "—"
        )}
        {row.synthetic ? (
          <span className="ms-1.5 text-[10px] uppercase tracking-wide text-subtle" title={t("live2.results.sourceHint.offline-synthetic-normal")}>
            {t("live2.results.offlineShort")}
          </span>
        ) : null}
      </Td>
      <Td className="font-mono text-xs tabular-nums text-muted">
        {obs.referenceRange ?? "—"}
      </Td>
      <Td>
        {abnormal ? (
          <Badge tone={present.tone} icon={<Icon weight="fill" className="h-3.5 w-3.5" aria-hidden />}>
            {flagText}
          </Badge>
        ) : (
          <StatusDot tone="normal" size="sm" label={flagText} />
        )}
      </Td>
    </Tr>
  );
}

/** A tiny, dependency-free sparkline for a numeric serial trend. */
function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;
  const w = 84;
  const h = 24;
  const pad = 3;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const xs = values.map((_, i) => pad + (i * (w - 2 * pad)) / (values.length - 1));
  const ys = values.map((v) => h - pad - ((v - min) / span) * (h - 2 * pad));
  const d = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="shrink-0">
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      {xs.map((x, i) => (
        <circle key={i} cx={x} cy={ys[i]} r={1.7} fill={color} />
      ))}
    </svg>
  );
}

/** One serially-ordered lab/gas/POC order rendered as a per-analyte trend table. */
function TrendPanel({ group, lang }: { group: TrendGroup; lang: Lang }) {
  const { t } = useTranslation();
  return (
    <section>
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h4 className="flex items-baseline gap-2 text-sm font-semibold text-fg">
          {pick(group.title, lang)}
          <span className="font-mono text-[11px] font-normal tabular-nums text-subtle">
            {t("labs2.results.serialDraws", { count: group.drawCount, defaultValue: "{{count}} serial draws" })}
          </span>
          <SourceChip source={group.source} />
        </h4>
        <span className="font-mono text-[11px] tabular-nums text-muted">
          {t("orders2.results.timeline", {
            ordered: minutesOf(group.orderedFirst),
            resulted: minutesOf(group.resultedLast),
          })}
        </span>
      </div>
      <TableWrap>
        <Table className="min-w-[520px]">
          <caption className="sr-only">
            {pick(group.title, lang)} — {t("labs2.results.trendCaption", { defaultValue: "serial trend" })}
          </caption>
          <THead>
            <Tr>
              <Th>{t("ehr.results.analyte")}</Th>
              <Th>{t("labs2.results.latest", { defaultValue: "Latest" })}</Th>
              <Th>{t("labs2.results.trend", { defaultValue: "Trend" })}</Th>
              <Th>{t("labs2.results.change", { defaultValue: "Change" })}</Th>
              <Th>{t("ehr.results.flag")}</Th>
            </Tr>
          </THead>
          <TBody>
            {group.analytes.map((a) => (
              <TrendRow key={a.code} analyte={a} lang={lang} />
            ))}
          </TBody>
        </Table>
      </TableWrap>
    </section>
  );
}

/** One analyte row of a serial trend: latest value, sparkline, delta, flag. */
function TrendRow({ analyte, lang }: { analyte: AnalyteTrend; lang: Lang }) {
  const { t } = useTranslation();
  const latest = analyte.latest;
  const st = interpretationToState(latest.interpretation);
  const present = stateMap[st];
  const Icon = present.icon;
  const abnormal = st !== "normal";
  const latestSynthetic = analyte.points[analyte.points.length - 1].synthetic;
  const values = analyte.numeric
    ? analyte.points
        .map((p) => p.observation.valueQuantity?.value)
        .filter((v): v is number => typeof v === "number")
    : [];
  const DirIcon = analyte.direction === "up" ? TrendUp : analyte.direction === "down" ? TrendDown : Minus;
  const flagText =
    latestSynthetic && !abnormal
      ? t("orders2.results.wnl")
      : t(`ehr.results.interp.${interpretationKey(latest.interpretation)}`);
  const deltaText =
    typeof analyte.delta === "number"
      ? `${analyte.delta > 0 ? "+" : analyte.delta < 0 ? "−" : ""}${Math.abs(analyte.delta).toFixed(analyte.decimals)}`
      : "—";

  return (
    <Tr>
      <th scope="row" className="px-3 py-1.5 text-start align-middle font-medium text-fg">
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block h-3.5 w-0.5"
            style={{ backgroundColor: abnormal ? present.colorVar : "transparent" }}
          />
          {conceptText(latest.code, lang)}
        </span>
      </th>
      <Td className="font-mono tabular-nums">
        {latest.valueQuantity ? (
          <>
            {latest.valueQuantity.value}
            {analyte.unit ? <span className="ms-1 text-xs text-muted">{" "}{displayUnit(analyte.unit)}</span> : null}
          </>
        ) : latest.valueString ? (
          pick(latest.valueString, lang)
        ) : (
          "—"
        )}
        {latestSynthetic ? (
          <span className="ms-1.5 text-[10px] uppercase tracking-wide text-subtle" title={t("live2.results.sourceHint.offline-synthetic-normal")}>
            {t("live2.results.offlineShort")}
          </span>
        ) : null}
      </Td>
      <Td>
        {analyte.numeric && values.length >= 2 ? (
          <Sparkline values={values} color={present.colorVar} />
        ) : (
          <span className="font-mono text-[11px] tabular-nums text-muted">
            {analyte.points
              .map((p) =>
                p.observation.valueQuantity
                  ? String(p.observation.valueQuantity.value)
                  : p.observation.valueString
                    ? pick(p.observation.valueString, lang)
                    : "—",
              )
              .join(" → ")}
          </span>
        )}
      </Td>
      <Td>
        <span
          className="inline-flex items-center gap-1 font-mono text-xs tabular-nums"
          style={{ color: present.colorVar }}
        >
          <DirIcon weight="bold" className="h-3.5 w-3.5" aria-hidden />
          {deltaText}
          {analyte.unit && typeof analyte.delta === "number" ? (
            <span className="ms-0.5 text-[10px] text-muted">{" "}{displayUnit(analyte.unit)}</span>
          ) : null}
        </span>
      </Td>
      <Td>
        {abnormal ? (
          <Badge tone={present.tone} icon={<Icon weight="fill" className="h-3.5 w-3.5" aria-hidden />}>
            {flagText}
          </Badge>
        ) : (
          <StatusDot tone="normal" size="sm" label={flagText} />
        )}
      </Td>
    </Tr>
  );
}

/** Microbiology / serology narrative reports (no representative image). */
function MicroList({ entries, lang }: { entries: MicroEntry[]; lang: Lang }) {
  const { t } = useTranslation();
  const { container, item } = useStagger();

  return (
    <motion.ul {...container} className="flex flex-col gap-3">
      {entries.map((e) => {
        const st = e.abnormal ? stateMap.warning : stateMap.normal;
        const Icon = st.icon;
        return (
          <motion.li
            key={e.id}
            {...item}
            className="rounded-control border border-border bg-bg-subtle p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-fg">
                <Virus weight="bold" className="h-4 w-4 text-muted" aria-hidden />
                {pick(e.title, lang)}
                <SourceChip source={e.source} />
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
              <p className="mt-1.5 flex items-start gap-1.5 text-sm leading-relaxed text-fg">
                <Icon
                  weight="fill"
                  className="mt-0.5 h-3.5 w-3.5 shrink-0"
                  style={{ color: st.colorVar }}
                  aria-hidden
                />
                <span>
                  {pick(e.conclusion, lang)}
                  {e.synthetic ? (
                    <span className="ms-1 text-xs italic text-muted">
                      ({t("live2.results.source.offline-synthetic-normal")})
                    </span>
                  ) : null}
                </span>
              </p>
            ) : null}
          </motion.li>
        );
      })}
    </motion.ul>
  );
}

/** Imaging reports, each with a real representative image + ordered→resulted times. */
function ImagingList({
  entries,
  lang,
  guidanceOn,
}: {
  entries: ImagingEntry[];
  lang: Lang;
  guidanceOn: boolean;
}) {
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
            <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-fg">
              <Scan weight="bold" className="h-4 w-4 text-muted" aria-hidden />
              {pick(e.modality, lang)}
              <SourceChip source={e.source} />
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

          {/* Interpretive read — gated on Guidance. With Guidance OFF the learner
              reads the study themselves, so the report impression is replaced by
              a neutral prompt; the image, modality, timing, safety disclaimer and
              license/attribution below stay visible either way. */}
          {guidanceOn ? (
            e.conclusion ? (
              <p className="mt-1.5 text-sm leading-relaxed text-fg">
                <span className="font-medium text-muted">{t("ehr.results.impression")}: </span>
                {pick(e.conclusion, lang)}
                {e.synthetic ? (
                  <span className="ms-1 text-xs italic text-muted">
                    ({t("live2.results.source.offline-synthetic-normal")})
                  </span>
                ) : null}
              </p>
            ) : null
          ) : (
            <p className="mt-1.5 text-sm italic leading-relaxed text-muted">
              {t("ehr.results.interpretYourself", {
                defaultValue: "Interpret this study — enable Guidance for the read.",
              })}
            </p>
          )}

          <StudyViewer
            className="mt-3"
            query={e.query}
            modality={e.modalityShort}
            caption={e.conclusion ? pick(e.conclusion, lang) : undefined}
            showInterpretation={guidanceOn}
            engine={e.engine ?? null}
          />
        </motion.li>
      ))}
    </motion.ul>
  );
}
