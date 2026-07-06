import { type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/**
 * Skeleton — layout-shaped loading placeholder.
 * Shimmer is CSS-only and collapses to a static tint under reduced-motion.
 */
export function Skeleton({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative overflow-hidden rounded-control bg-bg-subtle",
        "before:absolute before:inset-0 before:-translate-x-full",
        "before:bg-gradient-to-r before:from-transparent",
        "before:via-[color-mix(in_srgb,var(--fg)_6%,transparent)] before:to-transparent",
        "before:animate-[shimmer_1.6s_ease-out_infinite]",
        "motion-reduce:before:hidden",
        className,
      )}
      {...props}
    />
  );
}
