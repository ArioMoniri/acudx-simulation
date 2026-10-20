import { type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface PageContainerProps extends HTMLAttributes<HTMLDivElement> {
  /** Constrain width. "wide" for the encounter and consoles, "prose" for reading. */
  width?: "default" | "wide" | "prose";
}

const widths = {
  default: "max-w-6xl",
  wide: "max-w-[1600px]",
  prose: "max-w-3xl",
} as const;

/** PageContainer: the padded page column. 16 px gutters on phone, 24 px from md. */
export function PageContainer({
  width = "default",
  className,
  ...props
}: PageContainerProps) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-4 py-5 md:px-6 md:py-6",
        widths[width],
        className,
      )}
      {...props}
    />
  );
}
