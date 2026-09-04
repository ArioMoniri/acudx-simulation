/**
 * AcuDx — LiveVitalsMonitor: a bedside ICU/ED patient monitor.
 *
 * Reads the live encounter store (never a divergent copy): numerics come from
 * `getCurrentVitals` — already reflecting administered treatments — re-read on a
 * light interval so they evolve with the course; the coarse `getCourseStatus`
 * drives the alarm banner; the sim clock comes from `getEncounterClockMs`.
 *
 * Each parameter is a color-coded lane (ECG/HR green, SpO₂/pleth cyan, arterial
 * BP white, RR yellow, Temp amber) with a live scrolling waveform (rAF, scrolling
 * at the physiologic rate) and a big tabular numeric with unit + hi/lo alarm
 * limits. Values crossing clinical thresholds turn amber/red and the lane flashes.
 *
 * Accessibility: a visually-hidden table mirrors the current numerics in an
 * aria-live region; alarms are announced via an assertive status region; every
 * color-coded value also carries its label and units as text. Under
 * prefers-reduced-motion the waveforms render a static representative trace with
 * no animation. Guards against SSR / no-DOM.
 *
 * Education only. No real patient data path. The monitor stays dark in both
 * themes via the --monitor-* tokens.
 */

import {
  useEffect,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import {
  Broadcast,
  Drop,
  Heartbeat,
  Thermometer,
  Warning,
  WarningOctagon,
  WaveSine,
  Wind,
  type Icon,
} from "@phosphor-icons/react";

import { cn } from "@/lib/cn";
import {
  getCourseStatus,
  getCurrentVitals,
  getEncounterClockMs,
  useEncounterState,
} from "@/state/encounterStore";
import type { CourseStatus, CurrentVitals } from "@/domain/clinicalCourse";
import {
  arterialPath,
  ecgPath,
  flatlinePath,
  hrToHz,
  plethPath,
  respirationPath,
  rrToHz,
  spo2ToAmplitude,
  type WaveformSpec,
} from "./waveforms";

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

const WAVE_W = 260;
const WAVE_H = 60;

type LaneId = "hr" | "spo2" | "bp" | "rr" | "temp";
type Level = "normal" | "warning" | "critical";

/** Classic monitor hues — fixed (the monitor is always dark). */
const LANE_COLOR: Record<LaneId, string> = {
  hr: "#3ce27f",
  spo2: "#22d3ee",
  bp: "#e6edf7",
  rr: "#f5d23f",
  temp: "#f7a35c",
};

const ICONS: Record<LaneId, Icon> = {
  hr: Heartbeat,
  spo2: Drop,
  bp: WaveSine,
  rr: Wind,
  temp: Thermometer,
};

/** Displayed hi/lo alarm limits (like a real monitor's limit annunciators). */
const LIMITS: Record<LaneId, { lo?: number; hi?: number }> = {
  hr: { lo: 50, hi: 120 },
  spo2: { lo: 92 },
  bp: { lo: 90, hi: 160 },
  rr: { lo: 10, hi: 24 },
  temp: { lo: 36.0, hi: 38.3 },
};

const LANE_ORDER: LaneId[] = ["hr", "spo2", "bp", "rr", "temp"];
const WAVE_LANES = new Set<LaneId>(["hr", "spo2", "bp", "rr"]);

/** Per-parameter clinical level from the driving value. */
function levelFor(id: LaneId, v: CurrentVitals): Level {
  switch (id) {
    case "hr":
      if (v.hr > 150 || v.hr < 40) return "critical";
      if (v.hr > 120 || v.hr < 50) return "warning";
      return "normal";
    case "spo2":
      if (v.spo2 < 88) return "critical";
      if (v.spo2 < 92) return "warning";
      return "normal";
    case "bp":
      if (v.systolic < 80 || v.systolic > 220) return "critical";
      if (v.systolic < 90 || v.systolic > 180) return "warning";
      return "normal";
    case "rr":
      if (v.rr > 34 || v.rr < 8) return "critical";
      if (v.rr > 24 || v.rr < 10) return "warning";
      return "normal";
    case "temp":
      if (v.tempC > 40 || v.tempC < 35) return "critical";
      if (v.tempC > 38.3 || v.tempC < 36) return "warning";
      return "normal";
  }
}

const LEVEL_CSS: Record<Level, string | null> = {
  normal: null,
  warning: "var(--state-warning)",
  critical: "var(--state-critical)",
};

/* -------------------------------------------------------------------------- */
/* Small hooks (SSR-safe)                                                     */
/* -------------------------------------------------------------------------- */

/** Re-render on a light interval so clock/numerics track the running course. */
function useTick(ms: number, active: boolean): void {
  const [, force] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    const id = window.setInterval(() => force(), ms);
    return () => window.clearInterval(id);
  }, [ms, active]);
}

/** Track prefers-reduced-motion; false when there is no DOM. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/* -------------------------------------------------------------------------- */
/* Waveform helpers                                                           */
/* -------------------------------------------------------------------------- */

function laneSpec(id: LaneId, v: CurrentVitals, timeSec: number): WaveformSpec | null {
  switch (id) {
    case "hr":
      return { width: WAVE_W, height: WAVE_H, rateHz: hrToHz(v.hr), timeSec, windowSec: 4.5 };
    case "spo2":
      return {
        width: WAVE_W,
        height: WAVE_H,
        rateHz: hrToHz(v.hr),
        timeSec,
        windowSec: 4.5,
        amplitude: spo2ToAmplitude(v.spo2),
      };
    case "bp":
      return { width: WAVE_W, height: WAVE_H, rateHz: hrToHz(v.hr), timeSec, windowSec: 4.5 };
    case "rr":
      return { width: WAVE_W, height: WAVE_H, rateHz: rrToHz(v.rr), timeSec, windowSec: 10 };
    default:
      return null;
  }
}

function pathForLane(id: LaneId, v: CurrentVitals, timeSec: number): string {
  const spec = laneSpec(id, v, timeSec);
  if (!spec) return flatlinePath(WAVE_W, WAVE_H, 0.5);
  if (id === "hr") return ecgPath(spec);
  if (id === "spo2") return plethPath(spec);
  if (id === "bp") return arterialPath(spec);
  return respirationPath(spec);
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

export interface LiveVitalsMonitorProps {
  /** Patient / bed label slot rendered in the top strip. */
  label?: ReactNode;
  className?: string;
}

const FLASH_KEYFRAMES = `
@keyframes acudx-lane-flash {
  0%, 100% { background-color: transparent; }
  50% { background-color: color-mix(in srgb, var(--acudx-flash) 22%, transparent); }
}`;

export function LiveVitalsMonitor({ label, className }: LiveVitalsMonitorProps) {
  const { t } = useTranslation();
  const state = useEncounterState();
  const reduced = useReducedMotion();
  useTick(1000, true);

  const vitals = getCurrentVitals(state);
  const status = getCourseStatus(state);
  const clockMs = getEncounterClockMs(state);

  const vitalsRef = useRef<CurrentVitals | null>(vitals);
  vitalsRef.current = vitals;

  const pathRefs = useRef<Partial<Record<LaneId, SVGPathElement | null>>>({});

  const hasVitals = vitals != null;
  const animate = !reduced && hasVitals;

  // rAF loop: scroll each waveform at its physiologic rate. Reads the latest
  // vitals via a ref so it never needs to re-subscribe.
  useEffect(() => {
    if (!animate) return;
    if (typeof window === "undefined" || typeof requestAnimationFrame === "undefined") return;
    let raf = 0;
    const start = performance.now();
    const frame = (now: number) => {
      const tSec = (now - start) / 1000;
      const v = vitalsRef.current;
      if (v) {
        for (const id of WAVE_LANES) {
          const el = pathRefs.current[id];
          if (el) el.setAttribute("d", pathForLane(id, v, tSec));
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [animate]);

  /* ----- Empty state (before an encounter starts) ----- */
  if (!vitals) {
    return (
      <section
        aria-label={t("monitor2.a11y.region")}
        className={cn("rounded-card border p-5", className)}
        style={{ backgroundColor: "var(--monitor-bg)", borderColor: "var(--monitor-border)" }}
      >
        <TopStrip label={label} online={false} clock="--:--" t={t} />
        <div
          className="mt-6 flex flex-col items-center justify-center gap-2 rounded-control border border-dashed py-12 text-center"
          style={{ borderColor: "var(--monitor-border)" }}
        >
          <Broadcast weight="regular" className="h-6 w-6" style={{ color: "var(--monitor-dim)" }} aria-hidden />
          <p className="font-mono text-sm font-semibold" style={{ color: "var(--monitor-fg)" }}>
            {t("monitor2.awaiting")}
          </p>
          <p className="max-w-xs text-xs" style={{ color: "var(--monitor-dim)" }}>
            {t("monitor2.awaitingHint")}
          </p>
        </div>
      </section>
    );
  }

  const map = Math.round(vitals.diastolic + (vitals.systolic - vitals.diastolic) / 3);
  const alarmActive = status === "deteriorating" || status === "critical";

  const laneLevels: Record<LaneId, Level> = {
    hr: levelFor("hr", vitals),
    spo2: levelFor("spo2", vitals),
    bp: levelFor("bp", vitals),
    rr: levelFor("rr", vitals),
    temp: levelFor("temp", vitals),
  };
  const offending = LANE_ORDER.filter((id) => laneLevels[id] !== "normal").map((id) =>
    t(`monitor2.params.${id}.short`),
  );
  const statusLabel = status ? t(`monitor2.status.${status}`) : "";
  const announce = alarmActive
    ? t("monitor2.a11y.alarmAnnounce", {
        status: statusLabel,
        params: offending.length ? offending.join(", ") : statusLabel,
      })
    : "";

  const clock = formatClock(clockMs);

  const displayValue: Record<LaneId, string> = {
    hr: String(vitals.hr),
    spo2: String(vitals.spo2),
    bp: `${vitals.systolic}/${vitals.diastolic}`,
    rr: String(vitals.rr),
    temp: vitals.tempC.toFixed(1),
  };

  const tableRows = LANE_ORDER.map((id) => ({
    id,
    label: t(`monitor2.params.${id}.label`),
    value: `${displayValue[id]} ${t(`monitor2.params.${id}.unit`)}`.trim(),
    status: t(`monitor2.status.${statusWord(laneLevels[id])}`),
  }));

  return (
    <section
      aria-label={t("monitor2.a11y.region")}
      className={cn("overflow-hidden rounded-card border", className)}
      style={{ backgroundColor: "var(--monitor-bg)", borderColor: "var(--monitor-border)" }}
    >
      <style>{FLASH_KEYFRAMES}</style>

      <div className="p-4">
        <TopStrip label={label} online clock={clock} t={t} />
      </div>

      {/* Alarm banner (visible) — gated on the overall course status. */}
      {alarmActive ? (
        <div
          aria-hidden="true"
          className="mx-4 mb-3 flex items-center gap-2 rounded-control border px-3 py-2"
          style={{
            borderColor: status === "critical" ? "var(--state-critical)" : "var(--state-warning)",
            backgroundColor: `color-mix(in srgb, ${
              status === "critical" ? "var(--state-critical)" : "var(--state-warning)"
            } 16%, transparent)`,
            color: status === "critical" ? "var(--state-critical)" : "var(--state-warning)",
          }}
        >
          {status === "critical" ? (
            <WarningOctagon weight="fill" className="h-4 w-4 shrink-0 motion-safe:animate-pulse" aria-hidden />
          ) : (
            <Warning weight="fill" className="h-4 w-4 shrink-0 motion-safe:animate-pulse" aria-hidden />
          )}
          <span className="text-xs font-semibold uppercase tracking-wide">
            {t("monitor2.alarm")} · {statusLabel}
          </span>
          {offending.length ? (
            <span className="font-mono text-xs font-semibold">{offending.join(" · ")}</span>
          ) : null}
        </div>
      ) : null}

      {/* Assertive announcer for assistive tech. */}
      <div role="status" aria-live="assertive" className="sr-only">
        {announce}
      </div>

      {/* Lanes */}
      <div className="border-t" style={{ borderColor: "var(--monitor-border)" }}>
        {LANE_ORDER.map((id) => (
          <Lane
            key={id}
            id={id}
            level={laneLevels[id]}
            value={displayValue[id]}
            unit={t(`monitor2.params.${id}.unit`)}
            label={t(`monitor2.params.${id}.label`)}
            short={t(`monitor2.params.${id}.short`)}
            extra={id === "bp" ? `${t("monitor2.params.map.short")} ${map}` : undefined}
            limitLoLabel={t("monitor2.limitLo")}
            limitHiLabel={t("monitor2.limitHi")}
            reduced={reduced}
            initialD={
              reduced && WAVE_LANES.has(id)
                ? pathForLane(id, vitals, clockMs / 1000)
                : undefined
            }
            registerRef={(el) => {
              pathRefs.current[id] = el;
            }}
          />
        ))}
      </div>

      {/* Visually-hidden numeric mirror (aria-live polite). */}
      <div aria-live="polite">
        <table className="sr-only">
          <caption>{t("monitor2.a11y.tableCaption")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("monitor2.a11y.colParam")}</th>
              <th scope="col">{t("monitor2.a11y.colValue")}</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((row) => (
              <tr key={row.id}>
                <th scope="row">{row.label}</th>
                <td>
                  {row.value} — {row.status}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Sub-parts                                                                  */
/* -------------------------------------------------------------------------- */

function TopStrip({
  label,
  online,
  clock,
  t,
}: {
  label?: ReactNode;
  online: boolean;
  clock: string;
  t: (k: string) => string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0 truncate text-sm font-semibold" style={{ color: "var(--monitor-fg)" }}>
        {label ?? t("monitor2.title")}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span
          className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide"
          style={{ color: online ? "var(--monitor-online)" : "var(--monitor-dim)" }}
        >
          <Broadcast
            weight="fill"
            className={cn("h-3 w-3", online && "motion-safe:animate-pulse")}
            aria-hidden
          />
          {online ? t("monitor2.online") : t("monitor2.offline")}
        </span>
        <span className="inline-flex items-baseline gap-1">
          <span className="text-[10px] uppercase tracking-wide" style={{ color: "var(--monitor-dim)" }}>
            {t("monitor2.elapsed")}
          </span>
          <span className="font-mono text-sm font-semibold tabular-nums" style={{ color: "var(--monitor-fg)" }}>
            {clock}
          </span>
        </span>
      </div>
    </div>
  );
}

interface LaneProps {
  id: LaneId;
  level: Level;
  value: string;
  unit: string;
  label: string;
  short: string;
  extra?: string;
  limitLoLabel: string;
  limitHiLabel: string;
  reduced: boolean;
  initialD?: string;
  registerRef: (el: SVGPathElement | null) => void;
}

function Lane({
  id,
  level,
  value,
  unit,
  label,
  short,
  extra,
  limitLoLabel,
  limitHiLabel,
  reduced,
  initialD,
  registerRef,
}: LaneProps) {
  const laneColor = LANE_COLOR[id];
  const alertColor = LEVEL_CSS[level];
  const valueColor = alertColor ?? laneColor;
  const flashing = level !== "normal";
  const hasWave = WAVE_LANES.has(id);
  const limits = LIMITS[id];

  const IconCmp = ICONS[id];

  // Lane flashes when the parameter is out of range. Reduced motion is honored
  // globally (the app's CSS collapses animation duration), leaving a static tint.
  const laneStyle: CSSProperties = flashing
    ? ({
        borderColor: "var(--monitor-border)",
        animation: "acudx-lane-flash 1.1s var(--ease-out) infinite",
        boxShadow: `inset 3px 0 0 0 ${valueColor}`,
        "--acudx-flash": valueColor,
      } as unknown as CSSProperties)
    : { borderColor: "var(--monitor-border)" };

  return (
    <div className="flex items-stretch gap-3 border-t px-4 py-3 first:border-t-0" style={laneStyle}>
      {/* Waveform (or flat baseline for Temp) */}
      <div className="relative h-[60px] flex-1 overflow-hidden rounded-control" style={{ minWidth: 0 }}>
        <svg
          viewBox={`0 0 ${WAVE_W} ${WAVE_H}`}
          preserveAspectRatio="none"
          className="h-full w-full"
          aria-hidden
        >
          {/* faint isoelectric baseline for rhythm */}
          <line
            x1={0}
            x2={WAVE_W}
            y1={WAVE_H * (id === "rr" ? 0.5 : 0.68)}
            y2={WAVE_H * (id === "rr" ? 0.5 : 0.68)}
            stroke="var(--monitor-border)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          {hasWave ? (
            <path
              ref={registerRef}
              d={initialD}
              fill="none"
              stroke={valueColor}
              strokeWidth={1.6}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              opacity={reduced ? 0.95 : 1}
            />
          ) : (
            <path
              d={flatlinePath(WAVE_W, WAVE_H, 0.5)}
              fill="none"
              stroke={valueColor}
              strokeWidth={1.4}
              strokeDasharray="2 4"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              opacity={0.7}
            />
          )}
        </svg>
      </div>

      {/* Numeric readout */}
      <div className="flex w-[128px] shrink-0 flex-col justify-center">
        <div className="flex items-center gap-1.5">
          <IconCmp weight="fill" className="h-3.5 w-3.5 shrink-0" style={{ color: laneColor }} aria-hidden />
          <span
            className="text-[11px] font-semibold uppercase tracking-wide"
            style={{ color: "var(--monitor-dim)" }}
          >
            <abbr title={label} className="no-underline">
              {short}
            </abbr>
          </span>
        </div>
        <div className="mt-0.5 flex items-baseline gap-1">
          <span
            className="font-mono text-[2rem] font-semibold leading-none tabular-nums"
            style={{ color: valueColor }}
          >
            {value}
          </span>
          <span className="text-[11px] font-medium" style={{ color: "var(--monitor-dim)" }}>
            {unit}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2 text-[10px] font-medium tabular-nums" style={{ color: "var(--monitor-dim)" }}>
          {extra ? (
            <span className="font-mono" style={{ color: "var(--monitor-fg)" }}>
              {extra}
            </span>
          ) : null}
          {limits.hi != null ? (
            <span>
              {limitHiLabel} {limits.hi}
            </span>
          ) : null}
          {limits.lo != null ? (
            <span>
              {limitLoLabel} {limits.lo}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Utils                                                                      */
/* -------------------------------------------------------------------------- */

function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function statusWord(level: Level): CourseStatus {
  if (level === "critical") return "critical";
  if (level === "warning") return "deteriorating";
  return "stable";
}
