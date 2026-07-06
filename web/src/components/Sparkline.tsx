import { useId } from "react";
import { cn } from "@/lib/cn";

export interface SparklineProps {
  /** Numeric series, oldest to newest. */
  data: number[];
  /** Stroke color — a CSS color or custom property, e.g. "var(--state-caution)". */
  color?: string;
  /** Fill a soft area under the line. */
  filled?: boolean;
  width?: number;
  height?: number;
  className?: string;
  /** Accessible label; the SVG is otherwise decorative alongside a text readout. */
  ariaLabel?: string;
}

/**
 * Sparkline — a tiny, dependency-free inline SVG line chart.
 * Purely presentational: numeric meaning is always shown as text next to it,
 * so the chart is aria-hidden unless an explicit label is provided.
 */
export function Sparkline({
  data,
  color = "var(--brand-600)",
  filled = false,
  width = 96,
  height = 28,
  className,
  ariaLabel,
}: SparklineProps) {
  const gradId = useId();
  const pad = 2;
  const n = data.length;

  if (n < 2) {
    return (
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className={className}
        aria-hidden={ariaLabel ? undefined : true}
        role={ariaLabel ? "img" : undefined}
        aria-label={ariaLabel}
      />
    );
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;

  const points = data.map((v, i) => {
    const x = pad + (i / (n - 1)) * innerW;
    const y = pad + innerH - ((v - min) / span) * innerH;
    return [x, y] as const;
  });

  const line = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");

  const area =
    `${line} L${points[n - 1][0].toFixed(1)} ${height - pad} ` +
    `L${points[0][0].toFixed(1)} ${height - pad} Z`;

  const [lastX, lastY] = points[n - 1];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={cn("overflow-visible", className)}
      aria-hidden={ariaLabel ? undefined : true}
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel}
      preserveAspectRatio="none"
    >
      {filled ? (
        <>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.18" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${gradId})`} stroke="none" />
        </>
      ) : null}
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={lastX} cy={lastY} r={2.25} fill={color} />
    </svg>
  );
}
