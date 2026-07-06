import { type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface StatProps {
  label: ReactNode;
  value: ReactNode;
  /** Small unit shown after the value (e.g. "bpm"). */
  unit?: ReactNode;
  /** Supporting line below (e.g. status, trend). */
  hint?: ReactNode;
  /** Use tabular monospace for the value (default true for numeric readouts). */
  mono?: boolean;
  className?: string;
}

/**
 * Stat — a single labeled metric. Token-driven; numeric values default to
 * tabular monospace so digits do not jitter when they update.
 */
export function Stat({
  label,
  value,
  unit,
  hint,
  mono = true,
  className,
}: StatProps) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span className="text-xs font-medium uppercase tracking-wide text-muted">
        {label}
      </span>
      <span className="flex items-baseline gap-1">
        <span
          className={cn(
            "text-2xl font-semibold leading-none text-fg",
            mono && "font-mono",
          )}
        >
          {value}
        </span>
        {unit ? (
          <span className="text-sm font-medium text-muted">{unit}</span>
        ) : null}
      </span>
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </div>
  );
}
