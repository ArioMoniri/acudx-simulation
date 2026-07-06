import { type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface PageContainerProps extends HTMLAttributes<HTMLDivElement> {
  /** Constrain width. "wide" for the encounter split, "prose" for reading. */
  width?: "default" | "wide" | "prose";
}

const widths = {
  default: "max-w-6xl",
  wide: "max-w-7xl",
  prose: "max-w-3xl",
} as const;

/** PageContainer — centered, padded page column with generous whitespace. */
export function PageContainer({
  width = "default",
  className,
  ...props
}: PageContainerProps) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-4 py-8 sm:px-6 sm:py-10",
        widths[width],
        className,
      )}
      {...props}
    />
  );
}
