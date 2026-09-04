import { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * DescriptionList + KeyValue — dense clinical key/value rows (the EHR "record
 * details" pattern: Attio / Heidi). Labels are muted, values are foreground;
 * the pair aligns on a shared column so a stack of them reads as a real chart
 * panel rather than free-floating text.
 */

export interface DescriptionListProps extends HTMLAttributes<HTMLDListElement> {
  /** `rows` (default): label left, value right. `stacked`: label above value. */
  layout?: "rows" | "stacked";
  /** Draw hairline separators between rows. */
  divided?: boolean;
}

export function DescriptionList({
  layout = "rows",
  divided = false,
  className,
  children,
  ...props
}: DescriptionListProps) {
  return (
    <dl
      data-layout={layout}
      className={cn(
        "group/dl text-sm",
        divided && "[&>div]:border-t [&>div]:border-border [&>div:first-child]:border-t-0",
        className,
      )}
      {...props}
    >
      {children}
    </dl>
  );
}

export interface KeyValueProps {
  label: ReactNode;
  value: ReactNode;
  /** Render the value in tabular monospace (measurements, ids, dates). */
  mono?: boolean;
  className?: string;
}

export function KeyValue({ label, value, mono, className }: KeyValueProps) {
  return (
    <div
      className={cn(
        "gap-1 py-1.5",
        // rows layout: two-column; stacked layout: single column
        "group-data-[layout=rows]/dl:grid group-data-[layout=rows]/dl:grid-cols-[minmax(7rem,auto)_1fr] group-data-[layout=rows]/dl:items-baseline group-data-[layout=rows]/dl:gap-x-4",
        className,
      )}
    >
      <dt className="text-muted group-data-[layout=stacked]/dl:eyebrow">
        {label}
      </dt>
      <dd
        className={cn(
          "font-medium text-fg group-data-[layout=rows]/dl:text-right",
          mono && "font-mono tabular-nums",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
