import { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface DividerProps extends HTMLAttributes<HTMLDivElement> {
  /** Optional centered label (e.g. "or", a section break). */
  label?: ReactNode;
  orientation?: "horizontal" | "vertical";
}

/** Divider — a single hairline rule, optionally labelled. */
export function Divider({
  label,
  orientation = "horizontal",
  className,
  ...props
}: DividerProps) {
  if (orientation === "vertical") {
    return (
      <div
        role="separator"
        aria-orientation="vertical"
        className={cn("w-px self-stretch bg-border", className)}
        {...props}
      />
    );
  }
  if (!label) {
    return (
      <div
        role="separator"
        className={cn("h-px w-full bg-border", className)}
        {...props}
      />
    );
  }
  return (
    <div
      role="separator"
      className={cn("flex items-center gap-3", className)}
      {...props}
    >
      <span className="h-px flex-1 bg-border" />
      <span className="eyebrow">{label}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
