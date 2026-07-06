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
   * carried by color alone (WCAG 1.4.1).
   */
  icon?: ReactNode;
}

// Border + tinted text on a soft tint. Text label is always present.
const tones: Record<Tone, string> = {
  neutral: "bg-bg-subtle text-muted border-border",
  brand: "bg-brand-tint text-brand border-transparent",
  normal:
    "border-transparent text-[color:var(--state-normal)] bg-[color-mix(in_srgb,var(--state-normal)_14%,transparent)]",
  caution:
    "border-transparent text-[color:var(--state-caution)] bg-[color-mix(in_srgb,var(--state-caution)_16%,transparent)]",
  warning:
    "border-transparent text-[color:var(--state-warning)] bg-[color-mix(in_srgb,var(--state-warning)_16%,transparent)]",
  critical:
    "border-transparent text-[color:var(--state-critical)] bg-[color-mix(in_srgb,var(--state-critical)_15%,transparent)]",
};

/** Badge — small pill. Clinical tones pair an icon with the text label. */
export function Badge({
  tone = "neutral",
  icon,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5",
        "text-xs font-medium leading-5",
        tones[tone],
        className,
      )}
      {...props}
    >
      {icon ? (
        <span className="shrink-0" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {children}
    </span>
  );
}
