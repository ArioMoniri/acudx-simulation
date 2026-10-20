import { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type Tone =
  | "neutral"
  | "brand"
  | "normal"
  | "caution"
  | "warning"
  | "critical";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  /**
   * Icon slot. For clinical states this is REQUIRED so meaning is never
   * carried by color alone (WCAG 1.4.1). A `dot` also satisfies this.
   */
  icon?: ReactNode;
  /** Leading status dot in the tone color (tabular status treatment). */
  dot?: boolean;
  /** `soft` (default) = tinted fill; `outline` = hairline chip on surface. */
  variant?: "soft" | "outline";
}

const dotColor: Record<Tone, string> = {
  neutral: "var(--fg-subtle)",
  brand: "var(--brand-600)",
  normal: "var(--state-normal)",
  caution: "var(--state-caution)",
  warning: "var(--state-warning)",
  critical: "var(--state-critical)",
};

// Soft: tinted text on a soft tint. Text label is always present.
const soft: Record<Tone, string> = {
  neutral: "bg-bg-inset text-muted border-transparent",
  brand: "bg-brand-tint text-brand border-transparent",
  normal:
    "border-transparent text-[color:var(--state-normal)] bg-[color-mix(in_srgb,var(--state-normal)_12%,transparent)]",
  caution:
    "border-transparent text-[color:var(--state-caution)] bg-[color-mix(in_srgb,var(--state-caution)_12%,transparent)]",
  warning:
    "border-transparent text-[color:var(--state-warning)] bg-[color-mix(in_srgb,var(--state-warning)_12%,transparent)]",
  critical:
    "border-transparent text-[color:var(--state-critical)] bg-[color-mix(in_srgb,var(--state-critical)_12%,transparent)]",
};

// Outline: hairline chip on surface. Clinical tones carry meaning through a
// tone-colored border (not text color alone), so the outline variant no longer
// fails WCAG 1.4.1 — every tone is distinguishable by its border, and the
// leading `dot` remains available as a second, shape-based channel.
const outline: Record<Tone, string> = {
  neutral: "bg-surface text-muted border-border",
  brand: "bg-surface text-brand border-brand-tint-2",
  normal: "bg-surface text-[color:var(--state-normal)] border-[color:var(--state-normal)]",
  caution:
    "bg-surface text-[color:var(--state-caution)] border-[color:var(--state-caution)]",
  warning:
    "bg-surface text-[color:var(--state-warning)] border-[color:var(--state-warning)]",
  critical:
    "bg-surface text-[color:var(--state-critical)] border-[color:var(--state-critical)]",
};

/** Badge: a 4 px chip (Linear-style label). Clinical tones pair an icon or dot with the label. */
export function Badge({
  tone = "neutral",
  icon,
  dot,
  variant = "soft",
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-chip border px-1.5 py-px",
        "text-[0.6875rem] font-medium leading-4 tracking-[0.01em]",
        variant === "soft" ? soft[tone] : outline[tone],
        className,
      )}
      {...props}
    >
      {dot ? (
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: dotColor[tone] }}
        />
      ) : null}
      {icon ? (
        <span className="shrink-0" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {children}
    </span>
  );
}
