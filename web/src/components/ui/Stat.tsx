import { type ReactNode } from "react";
import { cn } from "@/lib/cn";

type StatSize = "sm" | "md" | "lg" | "xl";
type TrendDir = "up" | "down" | "flat";

export interface StatTrend {
  /** Displayed delta, e.g. "+12%" or "-3 pts". */
  value: ReactNode;
  /** Direction drives the color/arrow. `flat` is neutral. */
  dir?: TrendDir;
  /**
   * When true, "up" is the good direction (green) and "down" is bad (red).
   * When false (e.g. error rate, time-to-critical), the mapping inverts.
   * Default true. `flat` is always neutral.
   */
  goodUp?: boolean;
}

export interface StatProps {
  label: ReactNode;
  value: ReactNode;
  /** Small unit shown after the value (e.g. "bpm"). */
  unit?: ReactNode;
  /** Supporting line below (e.g. status, context). */
  hint?: ReactNode;
  /**
   * Accepted for API compatibility and not drawn: renewal 2 (2026-10-21) drops
   * the decorative glyph beside every metric label, the "icon + caps eyebrow on
   * every tile" pattern that made the panels read as generated.
   */
  icon?: ReactNode;
  /** Optional delta chip (unifies the old bespoke trend pills). */
  trend?: StatTrend;
  /** Use tabular monospace for the value (default true for numeric readouts). */
  mono?: boolean;
  /** Value type scale. */
  size?: StatSize;
  className?: string;
}

const valueSize: Record<StatSize, string> = {
  sm: "text-base",
  md: "text-[1.75rem]",
  lg: "text-[2rem]",
  xl: "text-[2.5rem]",
};

function trendClasses(dir: TrendDir, goodUp: boolean): string {
  if (dir === "flat") return "text-muted bg-bg-inset";
  const good = dir === "up" ? goodUp : !goodUp;
  return good
    ? "text-[color:var(--state-normal)] bg-[color-mix(in_srgb,var(--state-normal)_12%,transparent)]"
    : "text-[color:var(--state-critical)] bg-[color-mix(in_srgb,var(--state-critical)_12%,transparent)]";
}

const arrow: Record<TrendDir, string> = { up: "↑", down: "↓", flat: "→" };

/**
 * Stat — a single labeled metric. Token-driven; the one canonical stat/KPI
 * tile (replaces HomePage `StatTile` and institution `KpiCard`). Numeric
 * values are tabular so digits do not jitter on update: headline sizes (md
 * and up) set the figure in the Fraunces display serif with lining tabular
 * numerals (the v4 KPI voice), `sm` keeps Geist Mono for dense readouts.
 */
export function Stat({
  label,
  value,
  unit,
  hint,
  trend,
  mono = true,
  size = "md",
  className,
}: StatProps) {
  const dir = trend?.dir ?? "flat";
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span className="eyebrow">{label}</span>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="flex items-baseline gap-1">
          <span
            className={cn(
              "leading-none text-fg",
              valueSize[size],
              size === "sm"
                ? cn("font-semibold tracking-tight", mono && "font-mono")
                : "serif tnum font-medium [font-feature-settings:'lnum'_1,'tnum'_1]",
            )}
          >
            {value}
          </span>
          {unit ? (
            <span className="text-sm font-medium text-muted">{unit}</span>
          ) : null}
        </span>
        {trend ? (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-chip px-1 py-px",
              "text-xs font-semibold tabular-nums",
              trendClasses(dir, trend.goodUp ?? true),
            )}
          >
            <span aria-hidden="true">{arrow[dir]}</span>
            {trend.value}
          </span>
        ) : null}
      </div>
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </div>
  );
}
