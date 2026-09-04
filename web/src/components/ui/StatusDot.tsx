import { type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type StatusTone =
  | "neutral"
  | "brand"
  | "normal"
  | "caution"
  | "warning"
  | "critical"
  | "esi-1"
  | "esi-2"
  | "esi-3"
  | "esi-4"
  | "esi-5";

const toneVar: Record<StatusTone, string> = {
  neutral: "var(--fg-subtle)",
  brand: "var(--brand-600)",
  normal: "var(--state-normal)",
  caution: "var(--state-caution)",
  warning: "var(--state-warning)",
  critical: "var(--state-critical)",
  "esi-1": "var(--esi-1)",
  "esi-2": "var(--esi-2)",
  "esi-3": "var(--esi-3)",
  "esi-4": "var(--esi-4)",
  "esi-5": "var(--esi-5)",
};

export interface StatusDotProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: StatusTone;
  /** Text label after the dot. Omit for a bare indicator (add aria-label). */
  label?: string;
  /** Pulse ring — reserve for live/critical states. */
  pulse?: boolean;
  size?: "sm" | "md";
}

/**
 * StatusDot — a colored dot + optional label. The tabular status treatment
 * used in tables and lists (Deel / Fresha / Attio). Because the label sits
 * beside the dot, meaning is never carried by color alone.
 */
export function StatusDot({
  tone = "neutral",
  label,
  pulse,
  size = "md",
  className,
  ...props
}: StatusDotProps) {
  const color = toneVar[tone];
  return (
    <span
      className={cn("inline-flex items-center gap-1.5", className)}
      {...props}
    >
      <span className="relative inline-flex shrink-0" aria-hidden={label ? "true" : undefined}>
        <span
          className={cn(
            "rounded-full",
            size === "sm" ? "h-1.5 w-1.5" : "h-2 w-2",
          )}
          style={{ backgroundColor: color }}
        />
        {pulse ? (
          <span
            className="absolute inset-0 rounded-full motion-reduce:hidden"
            style={{
              boxShadow: `0 0 0 0 ${color}`,
              animation: "pulse-ring 1.8s var(--ease-out) infinite",
            }}
          />
        ) : null}
      </span>
      {label ? (
        <span className="text-sm text-fg">{label}</span>
      ) : null}
    </span>
  );
}
