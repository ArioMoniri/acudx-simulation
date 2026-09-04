/**
 * AcuDx — TrendMonitor: the monitor's trend screen.
 *
 * Small-multiples of the sampled effective-vitals series (`getVitalsSeries`) —
 * HR, SpO₂, BP, RR, Temp — each drawn over the elapsed window with a shaded
 * reference band, its current value and min/max, and an mm:ss time axis shared
 * across the stack. Vertical markers at `getTreatments` times let the learner
 * see a treatment and then the physiologic response that follows it. Updates
 * live on a light interval as the course evolves.
 *
 * Education only. No real patient data path. Stays dark in both themes via the
 * --monitor-* tokens.
 */

import { useEffect, useReducer } from "react";
import { useTranslation } from "react-i18next";
import { ChartLine, FirstAid } from "@phosphor-icons/react";

import { cn } from "@/lib/cn";
import {
  getEncounterClockMs,
  getTreatments,
  getVitalsSeries,
  useEncounterState,
} from "@/state/encounterStore";
import type { CurrentVitals } from "@/domain/clinicalCourse";

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

const PLOT_W = 300;
const PLOT_H = 64;

type TrendId = "hr" | "spo2" | "bp" | "rr" | "temp";

const LANE_COLOR: Record<TrendId, string> = {
  hr: "#3ce27f",
  spo2: "#22d3ee",
  bp: "#e6edf7",
  rr: "#f5d23f",
  temp: "#f7a35c",
};

const TREATMENT_COLOR = "#c084fc"; // violet marker, distinct from every trace

type SeriesPoint = { atMs: number } & CurrentVitals;

interface TrendParam {
  id: TrendId;
  band: [number, number];
  primary: (p: SeriesPoint) => number;
  secondary?: (p: SeriesPoint) => number;
  format: (n: number) => string;
}

const PARAMS: TrendParam[] = [
  { id: "hr", band: [60, 100], primary: (p) => p.hr, format: (n) => String(Math.round(n)) },
  { id: "spo2", band: [94, 100], primary: (p) => p.spo2, format: (n) => String(Math.round(n)) },
  {
    id: "bp",
    band: [90, 140],
    primary: (p) => p.systolic,
    secondary: (p) => p.diastolic,
    format: (n) => String(Math.round(n)),
  },
  { id: "rr", band: [12, 20], primary: (p) => p.rr, format: (n) => String(Math.round(n)) },
  { id: "temp", band: [36.5, 37.5], primary: (p) => p.tempC, format: (n) => n.toFixed(1) },
];

/* -------------------------------------------------------------------------- */
/* Small tick hook (SSR-safe)                                                 */
/* -------------------------------------------------------------------------- */

function useTick(ms: number, active: boolean): void {
  const [, force] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    const id = window.setInterval(() => force(), ms);
    return () => window.clearInterval(id);
  }, [ms, active]);
}

/* -------------------------------------------------------------------------- */
/* Geometry helpers                                                           */
/* -------------------------------------------------------------------------- */

function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function domainFor(series: SeriesPoint[], param: TrendParam): [number, number] {
  const vals: number[] = [];
  for (const p of series) {
    vals.push(param.primary(p));
    if (param.secondary) vals.push(param.secondary(p));
  }
  let lo = Math.min(param.band[0], ...vals);
  let hi = Math.max(param.band[1], ...vals);
  const pad = (hi - lo) * 0.14 || 1;
  lo -= pad;
  hi += pad;
  return [lo, hi];
}

function buildLine(
  series: SeriesPoint[],
  accessor: (p: SeriesPoint) => number,
  end: number,
  dom: [number, number],
): string {
  const [lo, hi] = dom;
  const span = hi - lo || 1;
  let d = "";
  series.forEach((p, i) => {
    const x = end > 0 ? (p.atMs / end) * PLOT_W : 0;
    const y = PLOT_H - ((accessor(p) - lo) / span) * PLOT_H;
    d += `${i === 0 ? "M" : "L"} ${x.toFixed(1)},${y.toFixed(1)} `;
  });
  return d.trimEnd();
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

export interface TrendMonitorProps {
  className?: string;
}

export function TrendMonitor({ className }: TrendMonitorProps) {
  const { t } = useTranslation();
  const state = useEncounterState();
  useTick(2000, true);

  const series = getVitalsSeries(state);
  const treatments = getTreatments(state);
  const clockMs = getEncounterClockMs(state);
  const end = series.length ? series[series.length - 1].atMs : clockMs;

  const ready = series.length >= 2 && end > 0;

  const axisTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => formatClock(end * f));

  return (
    <section
      aria-label={t("monitor2.a11y.trendRegion")}
      className={cn("overflow-hidden rounded-card border", className)}
      style={{ backgroundColor: "var(--monitor-bg)", borderColor: "var(--monitor-border)" }}
    >
      <div className="flex items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-2">
          <ChartLine weight="bold" className="h-4 w-4" style={{ color: "var(--monitor-dim)" }} aria-hidden />
          <span className="text-sm font-semibold" style={{ color: "var(--monitor-fg)" }}>
            {t("monitor2.trendTitle")}
          </span>
        </div>
        {treatments.length ? (
          <span
            className="inline-flex items-center gap-1.5 text-[11px] font-medium"
            style={{ color: TREATMENT_COLOR }}
          >
            <FirstAid weight="fill" className="h-3.5 w-3.5" aria-hidden />
            {treatments.length} {t("monitor2.treatment")}
          </span>
        ) : null}
      </div>

      {!ready ? (
        <div
          className="mx-4 mb-4 rounded-control border border-dashed py-10 text-center text-xs"
          style={{ borderColor: "var(--monitor-border)", color: "var(--monitor-dim)" }}
        >
          {t("monitor2.trendAwaiting")}
        </div>
      ) : (
        <>
          <div className="border-t" style={{ borderColor: "var(--monitor-border)" }}>
            {PARAMS.map((param) => (
              <TrendRow
                key={param.id}
                param={param}
                series={series}
                treatments={treatments}
                end={end}
                nowLabel={t("monitor2.now")}
                minLabel={t("monitor2.min")}
                maxLabel={t("monitor2.max")}
                short={t(`monitor2.params.${param.id}.short`)}
                label={t(`monitor2.params.${param.id}.label`)}
                unit={t(`monitor2.params.${param.id}.unit`)}
              />
            ))}
          </div>

          {/* Shared mm:ss time axis (aligned to every chart's x-domain). */}
          <div
            className="flex justify-between px-4 py-2 font-mono text-[10px] tabular-nums"
            style={{ color: "var(--monitor-dim)" }}
            aria-hidden
          >
            {axisTicks.map((tick, i) => (
              <span key={i}>{tick}</span>
            ))}
          </div>

          {/* Concise summary for assistive tech. */}
          <p className="sr-only" aria-live="polite">
            {PARAMS.map((param) => {
              const last = series[series.length - 1];
              const cur = param.format(param.primary(last));
              const disp = param.id === "bp" ? `${cur}/${Math.round(param.secondary!(last))}` : cur;
              return `${t(`monitor2.params.${param.id}.label`)}: ${disp} ${t(
                `monitor2.params.${param.id}.unit`,
              )}. `;
            }).join("")}
            {treatments.length
              ? `${treatments.length} ${t("monitor2.treatment")}.`
              : ""}
          </p>
        </>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Trend row (one small multiple)                                             */
/* -------------------------------------------------------------------------- */

interface TrendRowProps {
  param: TrendParam;
  series: SeriesPoint[];
  treatments: { code: string; at: number }[];
  end: number;
  nowLabel: string;
  minLabel: string;
  maxLabel: string;
  short: string;
  label: string;
  unit: string;
}

function TrendRow({
  param,
  series,
  treatments,
  end,
  nowLabel,
  minLabel,
  maxLabel,
  short,
  label,
  unit,
}: TrendRowProps) {
  const color = LANE_COLOR[param.id];
  const dom = domainFor(series, param);
  const [lo, hi] = dom;
  const span = hi - lo || 1;

  const last = series[series.length - 1];
  const primaryVals = series.map(param.primary);
  const minV = Math.min(...primaryVals);
  const maxV = Math.max(...primaryVals);

  const curDisplay =
    param.id === "bp"
      ? `${param.format(param.primary(last))}/${Math.round(param.secondary!(last))}`
      : param.format(param.primary(last));

  const bandTopY = PLOT_H - ((param.band[1] - lo) / span) * PLOT_H;
  const bandBotY = PLOT_H - ((param.band[0] - lo) / span) * PLOT_H;

  const primaryLine = buildLine(series, param.primary, end, dom);
  const secondaryLine = param.secondary
    ? buildLine(series, param.secondary, end, dom)
    : null;

  return (
    <div className="flex items-center gap-3 border-t px-4 py-2.5 first:border-t-0" style={{ borderColor: "var(--monitor-border)" }}>
      {/* Label + readouts */}
      <div className="flex w-[104px] shrink-0 flex-col">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />
          <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--monitor-dim)" }}>
            <abbr title={label} className="no-underline">
              {short}
            </abbr>
          </span>
        </div>
        <div className="mt-0.5 flex items-baseline gap-1">
          <span className="font-mono text-xl font-semibold leading-none tabular-nums" style={{ color }}>
            {curDisplay}
          </span>
          <span className="text-[10px]" style={{ color: "var(--monitor-dim)" }}>
            {unit}
          </span>
        </div>
        <div className="mt-0.5 font-mono text-[10px] tabular-nums" style={{ color: "var(--monitor-dim)" }}>
          <span className="sr-only">{nowLabel} </span>
          {minLabel} {param.format(minV)} · {maxLabel} {param.format(maxV)}
        </div>
      </div>

      {/* Chart */}
      <div className="relative h-[64px] flex-1" style={{ minWidth: 0 }}>
        <svg
          viewBox={`0 0 ${PLOT_W} ${PLOT_H}`}
          preserveAspectRatio="none"
          className="h-full w-full"
          aria-hidden
        >
          {/* reference band */}
          <rect
            x={0}
            y={Math.min(bandTopY, bandBotY)}
            width={PLOT_W}
            height={Math.abs(bandBotY - bandTopY)}
            fill={color}
            opacity={0.1}
          />
          <line
            x1={0}
            x2={PLOT_W}
            y1={bandTopY}
            y2={bandTopY}
            stroke={color}
            strokeWidth={1}
            opacity={0.28}
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={0}
            x2={PLOT_W}
            y1={bandBotY}
            y2={bandBotY}
            stroke={color}
            strokeWidth={1}
            opacity={0.28}
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />

          {/* treatment markers */}
          {treatments.map((tx, i) => {
            const x = end > 0 ? (tx.at / end) * PLOT_W : 0;
            return (
              <line
                key={`${tx.code}-${i}`}
                x1={x}
                x2={x}
                y1={0}
                y2={PLOT_H}
                stroke={TREATMENT_COLOR}
                strokeWidth={1.2}
                strokeDasharray="2 3"
                opacity={0.8}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}

          {/* diastolic (secondary) line, fainter */}
          {secondaryLine ? (
            <path
              d={secondaryLine}
              fill="none"
              stroke={color}
              strokeWidth={1.3}
              strokeDasharray="3 2"
              opacity={0.55}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}

          {/* primary line */}
          <path
            d={primaryLine}
            fill="none"
            stroke={color}
            strokeWidth={1.7}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
    </div>
  );
}
