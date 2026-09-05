import { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface SectionLabelProps extends HTMLAttributes<HTMLDivElement> {
  /** Optional small leading icon (muted). */
  icon?: ReactNode;
  /** Optional trailing content (count, action) pushed to the right. */
  trailing?: ReactNode;
}

/**
 * SectionLabel — the canonical eyebrow/section marker: 11px, uppercase,
 * tracked, subtle. Replaces the hand-rolled uppercase spans scattered across
 * the dashboards so every section reads from the same type key.
 */
export function SectionLabel({
  icon,
  trailing,
  className,
  children,
  ...props
}: SectionLabelProps) {
  return (
    <div
      className={cn("flex items-center gap-2", className)}
      {...props}
    >
      {icon ? (
        <span className="text-subtle" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className="eyebrow">{children}</span>
      {trailing ? <span className="ms-auto">{trailing}</span> : null}
    </div>
  );
}
