import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Variant = "surface" | "flat" | "inset" | "interactive";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Surface treatment:
   *  - `surface` (default): hairline-bordered white surface, NO resting shadow
   *    (crafted-clinical default — depth comes from the border, not a float).
   *  - `flat`: no border, sits directly on the page ground (for nested groups).
   *  - `inset`: recessed well on `bg-inset` (for sub-panels, empty states).
   *  - `interactive`: bordered surface that lifts on hover (nav / clickable cards).
   */
  variant?: Variant;
  /** Opt-in resting elevation (overlays, popovers, the rare floating card). */
  elevated?: boolean;
  /** Inner padding preset. */
  padding?: "none" | "sm" | "md" | "lg";
}

const paddings = {
  none: "",
  sm: "p-3",
  md: "p-4",
  lg: "p-5",
} as const;

const variants: Record<Variant, string> = {
  surface: "border border-border bg-surface",
  flat: "bg-transparent",
  inset: "border border-border bg-inset",
  interactive:
    "border border-border bg-surface transition-[border-color,background-color] " +
    "duration-[120ms] ease-out hover:border-border-strong hover:bg-surface-2 " +
    "focus-within:border-brand",
};

/** Card — hairline-bordered surface. Depth is drawn, not floated. */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { variant = "surface", elevated, padding = "md", className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        "rounded-card text-fg",
        variants[variant],
        elevated && "shadow-soft-md",
        paddings[padding],
        className,
      )}
      {...props}
    />
  );
});

export function CardHeader({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("mb-3 flex flex-col gap-0.5", className)} {...props} />
  );
}

export function CardTitle({
  className,
  ...props
}: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        "text-sm font-semibold tracking-tight text-fg",
        className,
      )}
      {...props}
    />
  );
}

export function CardDescription({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-xs text-muted", className)} {...props} />;
}
