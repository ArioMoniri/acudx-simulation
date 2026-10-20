import { type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/**
 * Skeleton: a layout-shaped loading surface.
 * A slow opacity pulse (no gradient sweep) that collapses to a static tint under reduced-motion.
 */
export function Skeleton({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative overflow-hidden rounded-control bg-bg-inset",
        "motion-safe:animate-pulse motion-safe:[animation-duration:1.6s]",
        className,
      )}
      {...props}
    />
  );
}
