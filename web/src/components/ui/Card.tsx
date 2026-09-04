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
  sm: "p-4",
  md: "p-5",
  lg: "p-6 sm:p-7",
} as const;

const variants: Record<Variant, string> = {
  surface: "border border-border bg-surface",
  flat: "bg-transparent",
  inset: "border border-border bg-inset",
  interactive:
    "border border-border bg-surface transition-[border-color,box-shadow,transform] " +
    "duration-200 ease-out hover:border-border-strong hover:shadow-soft-md " +
    "focus-within:border-brand active:translate-y-px",
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
    <div className={cn("mb-3 flex flex-col gap-1", className)} {...props} />
  );
}

export function CardTitle({
  className,
  ...props
}: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        "text-base font-semibold tracking-tight text-fg",
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
  return <p className={cn("text-sm text-muted", className)} {...props} />;
}
