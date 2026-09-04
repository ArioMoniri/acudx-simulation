import { useTranslation } from "react-i18next";
import { Heartbeat } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";

/* -------------------------------------------------------------------------- */
/* ECG trace                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Build an ECG-like path (repeating P-QRS-T complexes) as an SVG `d` string.
 * Amplitudes are fractions of `amp`; positive is "up" on screen (smaller y).
 * Static geometry — computed once at module load, never animated.
 */
function ecgPath(opts: {
  beats: number;
  beatW: number;
  baseY: number;
  amp: number;
  startX: number;
}): string {
  const { beats, beatW, baseY, amp, startX } = opts;
  // [xFraction within a beat, yOffset up]
  const shape: ReadonlyArray<readonly [number, number]> = [
    [0.0, 0],
    [0.12, 0],
    [0.17, 0.16], // P wave
    [0.22, 0],
    [0.3, 0], // PR segment
    [0.33, -0.14], // Q
    [0.37, 1.0], // R spike
    [0.41, -0.3], // S
    [0.46, 0],
    [0.62, 0],
    [0.72, 0.32], // T wave
    [0.82, 0],
    [1.0, 0],
  ];
  let d = "";
  for (let b = 0; b < beats; b++) {
    for (let i = 0; i < shape.length; i++) {
      const [xf, yo] = shape[i];
      const x = startX + (b + xf) * beatW;
      const y = baseY - yo * amp;
      d += `${b === 0 && i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)} `;
    }
  }
  return d.trim();
}

const ECG_W = 268;
const ECG_H = 56;
const ECG_D = ecgPath({ beats: 4, beatW: 64, baseY: 32, amp: 17, startX: 6 });

/* -------------------------------------------------------------------------- */
/* Vitals                                                                     */
/* -------------------------------------------------------------------------- */

interface Vital {
  /** i18n key under landing2.monitor for the full (accessible) name. */
  key: "hr" | "bp" | "spo2" | "rr";
  abbr: string;
  value: string;
  unit: string;
}

const VITALS: readonly Vital[] = [
  { key: "hr", abbr: "HR", value: "84", unit: "bpm" },
  { key: "bp", abbr: "BP", value: "128/76", unit: "mmHg" },
  { key: "spo2", abbr: "SpO₂", value: "98", unit: "%" },
  { key: "rr", abbr: "RR", value: "16", unit: "/min" },
];

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * VitalsMonitorTile — a compact, genuine-looking bedside monitor readout for
 * the landing hero. Renders on the always-dark `--monitor-*` palette (identical
 * in light and dark themes), with a real ECG trace and tabular vitals. Values
 * are static and synthetic; the tile shows the product instead of blurbing it.
 *
 * Announced to assistive tech as a single labelled image so a screen reader is
 * not walked through a wall of decorative numbers.
 */
export function VitalsMonitorTile({ className }: { className?: string }) {
  const { t } = useTranslation();

  return (
    <div
      role="img"
      aria-label={t("landing2.monitor.aria")}
      className={cn(
        "select-none rounded-card border p-4 shadow-soft-md sm:p-5",
        className,
      )}
      style={{
        backgroundColor: "var(--monitor-bg)",
        borderColor: "var(--monitor-border)",
        color: "var(--monitor-fg)",
      }}
    >
      {/* Header: bay + live status */}
      <div className="flex items-center justify-between gap-3" aria-hidden="true">
        <span className="inline-flex items-center gap-2">
          <Heartbeat
            weight="fill"
            className="h-4 w-4"
            style={{ color: "var(--monitor-online)" }}
          />
          <span
            className="text-[13px] font-semibold tracking-tight"
            style={{ color: "var(--monitor-fg)" }}
          >
            {t("landing2.monitor.unit")}
          </span>
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span
              className="absolute inline-flex h-full w-full rounded-full opacity-60 motion-safe:animate-ping"
              style={{ backgroundColor: "var(--monitor-online)" }}
            />
            <span
              className="relative inline-flex h-2 w-2 rounded-full"
              style={{ backgroundColor: "var(--monitor-online)" }}
            />
          </span>
          <span
            className="text-[10px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: "var(--monitor-online)" }}
          >
            {t("landing2.monitor.status")}
          </span>
        </span>
      </div>

      {/* ECG trace */}
      <div className="mt-3" aria-hidden="true">
        <svg
          viewBox={`0 0 ${ECG_W} ${ECG_H}`}
          className="h-14 w-full"
          preserveAspectRatio="none"
          role="presentation"
        >
          {/* faint baseline */}
          <line
            x1="0"
            y1={ECG_H / 2}
            x2={ECG_W}
            y2={ECG_H / 2}
            stroke="var(--monitor-border)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={ECG_D}
            fill="none"
            stroke="var(--monitor-online)"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <p
          className="mt-1 text-[10px] font-medium uppercase tracking-[0.14em]"
          style={{ color: "var(--monitor-dim)" }}
        >
          {t("landing2.monitor.trace")}
        </p>
      </div>

      {/* Vitals grid */}
      <div className="mt-3 grid grid-cols-2 gap-2" aria-hidden="true">
        {VITALS.map((v) => (
          <div
            key={v.key}
            className="rounded-control border px-3 py-2.5"
            style={{
              borderColor: "var(--monitor-border)",
              backgroundColor:
                "color-mix(in srgb, var(--monitor-fg) 4%, transparent)",
            }}
          >
            <p
              className="text-[10px] font-semibold uppercase tracking-[0.12em]"
              style={{ color: "var(--monitor-dim)" }}
              title={t(`landing2.monitor.${v.key}`)}
            >
              {v.abbr}
            </p>
            <p className="mt-1 flex items-baseline gap-1 font-mono leading-none">
              <span
                className="tnum text-2xl font-semibold"
                style={{ color: "var(--monitor-fg)" }}
              >
                {v.value}
              </span>
              <span
                className="text-[11px] font-medium"
                style={{ color: "var(--monitor-dim)" }}
              >
                {v.unit}
              </span>
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
