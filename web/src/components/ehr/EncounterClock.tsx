import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Clock } from "@phosphor-icons/react";

import { cn } from "@/lib/cn";
import { getEncounterClockMs, useEncounterState } from "@/state/encounterStore";
import { formatClock } from "./labels";

export interface EncounterClockProps {
  /** "chip" for the toolbar, "inline" for the storyboard rail. */
  variant?: "chip" | "inline";
  /** Render on a dark surface (storyboard/monitor). */
  onDark?: boolean;
  className?: string;
}

/**
 * EncounterClock — the running sim-clock (docs §2.1). Reads the store's start
 * timestamp reactively and ticks once a second so timing stays salient (the
 * process metrics are measured against guideline windows, docs §4). Tabular
 * mono so digits do not jitter.
 */
export function EncounterClock({
  variant = "chip",
  onDark = false,
  className,
}: EncounterClockProps) {
  const { t } = useTranslation();
  const state = useEncounterState();
  const started = state.startTs != null;

  // Local 1 Hz tick; the offset itself is derived from the store clock so tests
  // that inject a clock still read correctly.
  const [, force] = useState(0);
  useEffect(() => {
    if (!started) return;
    const id = window.setInterval(() => force((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [started]);

  const label = formatClock(getEncounterClockMs(state));

  if (variant === "inline") {
    return (
      <span
        className={cn("inline-flex items-center gap-1.5 text-xs", className)}
        style={onDark ? { color: "var(--monitor-dim)" } : undefined}
        aria-label={t("ehr.clock.label")}
      >
        <Clock weight="bold" className="h-3.5 w-3.5" aria-hidden />
        <span className="font-mono tabular-nums" aria-live="off">
          {label}
        </span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-subtle px-2.5 py-1 text-xs font-medium text-fg",
        className,
      )}
      aria-label={t("ehr.clock.label")}
    >
      <Clock weight="bold" className="h-3.5 w-3.5 text-muted" aria-hidden />
      <span className="font-mono tabular-nums">{label}</span>
    </span>
  );
}
