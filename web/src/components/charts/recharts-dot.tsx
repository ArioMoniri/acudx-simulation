/**
 * Vendored from evilcharts (https://evilcharts.com, https://github.com/legions-developer/evilcharts),
 * shadcn registry item "recharts-dot". MIT License. Copyright (c) 2026 Gurbinder
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
 * associated documentation files, to deal in the Software without restriction, subject to the MIT
 * License terms (see the upstream LICENSE). THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
 *
 * AcuDx adaptations: imports point at `@/lib/cn` and `@/components/charts/*`, React 19 `use()` is
 * `useContext()` for React 18, and shadcn colour utilities are mapped onto the AcuDx Tailwind v4
 * tokens from web/src/index.css (text-fg, text-muted, bg-surface, border-border, text-brand).
 */
import { cn } from "@/lib/cn";
import * as React from "react";

export type DotVariant = "default" | "border" | "colored-border";

type ChartDotProps = {
  cx?: number;
  cy?: number;
  dataKey: string;
  chartId: string;
  className?: string;
  fillOpacity?: number;
  type?: DotVariant;
  /** Optional SVG <mask> id — lets the dot share an area's intro reveal wipe. */
  maskId?: string;
};

const ChartDot = React.memo(function ChartDot({
  cx,
  cy,
  dataKey,
  chartId,
  className,
  fillOpacity = 1,
  type = "default",
  maskId,
}: ChartDotProps) {
  const dotId = React.useId().replace(/:/g, "");
  const gradientUrl = `url(#${chartId}-colors-${String(dataKey)})`;

  if (cx === undefined || cy === undefined) return null;

  switch (type) {
    case "border":
      return (
        <PrimaryBorderDot
          cx={cx}
          cy={cy}
          dotId={dotId}
          fillOpacity={fillOpacity}
          gradientUrl={gradientUrl}
          className={className}
          maskId={maskId}
        />
      );
    case "colored-border":
      return (
        <ColoredBorderDot
          cx={cx}
          cy={cy}
          dotId={dotId}
          fillOpacity={fillOpacity}
          gradientUrl={gradientUrl}
          className={className}
          maskId={maskId}
        />
      );
    default:
      return (
        <DefaultDot
          cx={cx}
          cy={cy}
          dotId={dotId}
          fillOpacity={fillOpacity}
          gradientUrl={gradientUrl}
          className={className}
          maskId={maskId}
        />
      );
  }
});

type DotVariantProps = {
  cx: number;
  cy: number;
  dotId: string;
  fillOpacity: number;
  gradientUrl: string;
  className?: string;
  maskId?: string;
};

const DefaultDot = React.memo(
  ({ cx, cy, dotId, fillOpacity, gradientUrl, className, maskId }: DotVariantProps) => {
    const r = 3;
    return (
      <g className={className} mask={maskId ? `url(#${maskId})` : undefined}>
        <defs>
          <clipPath id={`dot-clip-${dotId}`}>
            <circle cx={cx} cy={cy} r={r} />
          </clipPath>
        </defs>
        {/* Full-width gradient rectangle clipped to dot shape */}
        <rect
          x="0"
          y={cy - r}
          width="100%"
          height={r * 2}
          fill={gradientUrl}
          fillOpacity={fillOpacity}
          clipPath={`url(#dot-clip-${dotId})`}
        />
      </g>
    );
  },
);

DefaultDot.displayName = "DefaultDot";

const PrimaryBorderDot = React.memo(
  ({ cx, cy, dotId, fillOpacity, gradientUrl, className, maskId }: DotVariantProps) => {
    const r = 6;
    const strokeWidth = 5;
    return (
      <g className={cn(className, "text-surface")} mask={maskId ? `url(#${maskId})` : undefined}>
        <defs>
          <clipPath id={`dot-clip-${dotId}`}>
            <circle cx={cx} cy={cy} r={r} />
          </clipPath>
        </defs>
        {/* Background stroke (border) */}
        <circle cx={cx} cy={cy} r={r} fill="currentColor" />
        {/* Inner gradient circle clipped */}
        <rect
          x="0"
          y={cy - (r - strokeWidth / 2)}
          width="100%"
          height={(r - strokeWidth / 2) * 2}
          fill={gradientUrl}
          fillOpacity={fillOpacity}
          clipPath={`url(#dot-clip-inner-${dotId})`}
        />
        <defs>
          <clipPath id={`dot-clip-inner-${dotId}`}>
            <circle cx={cx} cy={cy} r={r - strokeWidth / 2} />
          </clipPath>
        </defs>
      </g>
    );
  },
);

PrimaryBorderDot.displayName = "PrimaryBorderDot";

const ColoredBorderDot = React.memo(
  ({ cx, cy, dotId, fillOpacity, gradientUrl, className, maskId }: DotVariantProps) => {
    const r = 3;
    const strokeWidth = 1;
    return (
      <g className={cn(className, "text-surface")} mask={maskId ? `url(#${maskId})` : undefined}>
        <defs>
          <clipPath id={`dot-clip-${dotId}`}>
            <circle cx={cx} cy={cy} r={r + strokeWidth / 2} />
          </clipPath>
        </defs>
        {/* Gradient stroke (border) via clipped rect */}
        <rect
          x="0"
          y={cy - r - strokeWidth / 2}
          width="100%"
          height={(r + strokeWidth / 2) * 2}
          fill={gradientUrl}
          fillOpacity={fillOpacity}
          clipPath={`url(#dot-clip-${dotId})`}
        />
        {/* Inner solid fill */}
        <circle cx={cx} cy={cy} r={r - strokeWidth / 2} fill="currentColor" />
      </g>
    );
  },
);

ColoredBorderDot.displayName = "ColoredBorderDot";

export { ChartDot };
