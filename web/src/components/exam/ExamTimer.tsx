import { useEffect, useRef, useState } from "react";
import { Timer } from "@phosphor-icons/react";

import { cn } from "@/lib/cn";
import { formatClock } from "@/domain/summative";

export interface ExamTimerProps {
  /** Absolute expiry, epoch ms. Change (via the parent `key`) to reset. */
  deadline: number;
  /** Fired exactly once when the countdown reaches zero. */
  onExpire: () => void;
  /** Seconds below which the countdown reads as "warning". */
  warnAtSeconds?: number;
  className?: string;
}

/**
 * ExamTimer — the proctored per-case countdown. Ticks off wall-clock against an
 * absolute `deadline`, renders `M:SS`, shifts to a warning tone under
 * `warnAtSeconds`, and calls `onExpire` once at zero. The parent resets it by
 * changing the React `key` for each new case.
 */
export function ExamTimer({
  deadline,
  onExpire,
  warnAtSeconds = 60,
  className,
}: ExamTimerProps) {
  const [remainingMs, setRemainingMs] = useState(() => Math.max(0, deadline - Date.now()));
  const firedRef = useRef(false);
  // Keep the latest onExpire without re-arming the interval each render.
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    firedRef.current = false;
    setRemainingMs(Math.max(0, deadline - Date.now()));

    let id = 0;
    const tick = () => {
      const left = Math.max(0, deadline - Date.now());
      setRemainingMs(left);
      if (left <= 0 && !firedRef.current) {
        firedRef.current = true;
        window.clearInterval(id);
        onExpireRef.current();
      }
    };
    id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [deadline]);

  const expired = remainingMs <= 0;
  const warning = !expired && remainingMs <= warnAtSeconds * 1000;

  return (
    <span
      role="timer"
      aria-live={warning ? "polite" : "off"}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-control border px-2.5 py-1",
        "font-mono text-sm font-semibold tabular-nums",
        expired || warning
          ? "border-transparent text-[color:var(--state-critical)] bg-[color-mix(in_srgb,var(--state-critical)_12%,transparent)]"
          : "border-border bg-surface text-fg",
        className,
      )}
    >
      <Timer weight="bold" className="h-4 w-4" aria-hidden="true" />
      {formatClock(remainingMs)}
    </span>
  );
}
