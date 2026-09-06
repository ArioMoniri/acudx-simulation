import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Heartbeat } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";

/* -------------------------------------------------------------------------- */
/* ECG trace                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Build an ECG-like path (repeating P-QRS-T complexes) as an SVG `d` string.
 * Amplitudes are fractions of `amp`; positive is "up" on screen (smaller y).
 *
 * The geometry is a PERIODIC tile computed once (deterministic — no clock or
 * random reads). The "live" sweep is a GPU-cheap CSS transform on the group,
 * so the path itself is never recomputed per frame.
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
const BEAT_W = 64;
// Draw enough whole beats to fill the viewport PLUS spare periods on the right,
// so the group can be swept left by exactly one beat and loop seamlessly (the
// waveform is periodic with BEAT_W, so frame at -BEAT_W === frame at 0).
const ECG_BEATS = Math.ceil(ECG_W / BEAT_W) + 3;
const ECG_D = ecgPath({ beats: ECG_BEATS, beatW: BEAT_W, baseY: 32, amp: 17, startX: 0 });

/* -------------------------------------------------------------------------- */
/* Vitals                                                                     */
/* -------------------------------------------------------------------------- */

interface Vital {
  /** i18n key under landing2.monitor for the full (accessible) name. */
  key: "hr" | "bp" | "spo2" | "rr";
  abbr: string;
  /** Canonical baseline value (also what reduced-motion viewers see). */
  value: string;
  unit: string;
}

const VITALS: readonly Vital[] = [
  { key: "hr", abbr: "HR", value: "84", unit: "bpm" },
  { key: "bp", abbr: "BP", value: "128/76", unit: "mmHg" },
  { key: "spo2", abbr: "SpO₂", value: "98", unit: "%" },
  { key: "rr", abbr: "RR", value: "16", unit: "/min" },
];

/**
 * Gentle, deterministic drift for a vital as a function of elapsed seconds —
 * smooth sines around the canonical baseline (no Math.random, no Date.now). Each
 * vital stays inside a tight physiological band so the monitor "breathes"
 * without ever reading alarming. Reduced-motion viewers never call this.
 */
function liveVital(key: Vital["key"], sec: number): string {
  switch (key) {
    case "hr":
      return String(84 + Math.round(3 * Math.sin(sec / 5)));
    case "bp": {
      const sys = 128 + Math.round(4 * Math.sin(sec / 9));
      const dia = 76 + Math.round(3 * Math.sin(sec / 9 + 0.6));
      return `${sys}/${dia}`;
    }
    case "spo2":
      return String(98 + Math.round(Math.sin(sec / 7 + 1)));
    case "rr":
      return String(16 + Math.round(1.4 * Math.sin(sec / 6 + 2)));
  }
}

/** Track the OS "reduce motion" preference so we can freeze all animation. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return reduced;
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * VitalsMonitorTile — a compact, *living* bedside-monitor readout for the
 * landing hero. Renders on the always-dark `--monitor-*` palette (identical in
 * light and dark themes): a live-sweeping ECG trace (a CSS transform on a
 * periodic SVG tile) and vitals that drift gently within physiological bands.
 * The tile shows the product working instead of blurbing it.
 *
 * All motion is GPU-cheap and reduced-motion-safe: under
 * `prefers-reduced-motion` the sweep stops and the vitals sit at their canonical
 * baseline. Announced to assistive tech as a single labelled image, and every
 * moving number is aria-hidden so a screen reader is not walked through churning
 * digits.
 */
export function VitalsMonitorTile({ className }: { className?: string }) {
  const { t } = useTranslation();
  const reduced = usePrefersReducedMotion();
  const [sec, setSec] = useState(0);

  // Advance a ~1 Hz clock, but only when motion is allowed. Driven by rAF (not
  // setInterval) so it pauses with the tab and never reads the wall clock at
  // module load; state updates at most once per second to keep re-renders cheap.
  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const start = performance.now();
    let lastBucket = -1;
    const loop = (now: number) => {
      const elapsed = (now - start) / 1000;
      const bucket = Math.floor(elapsed);
      if (bucket !== lastBucket) {
        lastBucket = bucket;
        setSec(elapsed);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  return (
    <div
      role="img"
      aria-label={t("landing2.monitor.aria")}
      className={cn(
        "select-none rounded-card border border-monitor-border bg-monitor-bg p-4 text-monitor-fg shadow-soft-md sm:p-5",
        className,
      )}
    >
      {/* Scoped keyframes for the ECG sweep; frozen under reduced motion. */}
      <style>{`
        .acudx-ecg-sweep {
          animation: acudx-ecg-sweep 0.86s linear infinite;
          will-change: transform;
        }
        @keyframes acudx-ecg-sweep {
          from { transform: translateX(0); }
          to { transform: translateX(-${BEAT_W}px); }
        }
        @media (prefers-reduced-motion: reduce) {
          .acudx-ecg-sweep { animation: none; }
        }
      `}</style>

      {/* Header: bay + live status */}
      <div className="flex items-center justify-between gap-3" aria-hidden="true">
        <span className="inline-flex items-center gap-2">
          <Heartbeat
            weight="fill"
            className="h-4 w-4 text-monitor-online motion-safe:animate-pulse"
          />
          <span className="text-[13px] font-semibold tracking-tight text-monitor-fg">
            {t("landing2.monitor.unit")}
          </span>
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-monitor-online opacity-60 motion-safe:animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-monitor-online" />
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-monitor-online">
            {t("landing2.monitor.status")}
          </span>
        </span>
      </div>

      {/* ECG trace — a static baseline with a periodic waveform swept left. */}
      <div className="mt-3 overflow-hidden" aria-hidden="true">
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
          <g className="acudx-ecg-sweep">
            <path
              d={ECG_D}
              fill="none"
              stroke="var(--monitor-online)"
              strokeWidth={1.75}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        </svg>
        <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.14em] text-monitor-dim">
          {t("landing2.monitor.trace")}
        </p>
      </div>

      {/* Vitals grid — values drift gently while motion is allowed. */}
      <div className="mt-3 grid grid-cols-2 gap-2" aria-hidden="true">
        {VITALS.map((v) => (
          <div
            key={v.key}
            className="rounded-control border border-monitor-border px-3 py-2.5"
            style={{
              backgroundColor:
                "color-mix(in srgb, var(--monitor-fg) 4%, transparent)",
            }}
          >
            <p
              className="text-[10px] font-semibold uppercase tracking-[0.12em] text-monitor-dim"
              title={t(`landing2.monitor.${v.key}`)}
            >
              {v.abbr}
            </p>
            <p className="mt-1 flex items-baseline gap-1 font-mono leading-none">
              <span className="tnum text-2xl font-semibold text-monitor-fg">
                {reduced ? v.value : liveVital(v.key, sec)}
              </span>
              <span className="text-[11px] font-medium text-monitor-dim">
                {v.unit}
              </span>
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
