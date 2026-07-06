import {
  cloneElement,
  forwardRef,
  isValidElement,
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Optional trailing icon shown inside a circle (primary CTA affordance). */
  trailingIcon?: ReactNode;
  /** Leading icon, inline (no circle). */
  leadingIcon?: ReactNode;
  fullWidth?: boolean;
  /**
   * Render as the single child element (e.g. a router <Link>) instead of a
   * <button>, so an anchor is never nested inside a button. All button styling
   * and the icon affordances are applied to the child.
   */
  asChild?: boolean;
}

const base =
  "inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap " +
  "rounded-control select-none transition-[background-color,color,box-shadow,transform] " +
  "duration-200 ease-out active:scale-[0.98] disabled:opacity-50 " +
  "disabled:pointer-events-none focus-visible:outline-none no-underline";

const variants: Record<Variant, string> = {
  // The ONE locked accent CTA.
  primary: "bg-brand text-white hover:bg-brand-hover shadow-soft",
  secondary:
    "bg-surface text-fg border border-border hover:bg-bg-subtle shadow-soft",
  ghost: "bg-transparent text-fg hover:bg-bg-subtle",
};

// Min 24px target; touch-comfortable at md/lg.
const sizes: Record<Size, string> = {
  sm: "h-9 px-3 text-sm min-w-9",
  md: "h-11 px-5 text-[0.95rem] min-w-11",
  lg: "h-12 px-6 text-base min-w-12",
};

const circleSizes: Record<Size, string> = {
  sm: "h-5 w-5 -mr-1",
  md: "h-6 w-6 -mr-1.5",
  lg: "h-7 w-7 -mr-2",
};

function renderContent(
  variant: Variant,
  size: Size,
  leadingIcon: ReactNode,
  trailingIcon: ReactNode,
  children: ReactNode,
) {
  return (
    <>
      {leadingIcon ? (
        <span className="shrink-0" aria-hidden="true">
          {leadingIcon}
        </span>
      ) : null}
      <span>{children}</span>
      {trailingIcon ? (
        <span
          aria-hidden="true"
          className={cn(
            "inline-flex shrink-0 items-center justify-center rounded-full",
            variant === "primary" ? "bg-white/20" : "bg-brand-tint text-brand",
            circleSizes[size],
          )}
        >
          {trailingIcon}
        </span>
      ) : null}
    </>
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    trailingIcon,
    leadingIcon,
    fullWidth,
    asChild = false,
    className,
    children,
    type = "button",
    ...props
  },
  ref,
) {
  const classes = cn(
    base,
    variants[variant],
    sizes[size],
    fullWidth && "w-full",
    className,
  );

  const content = renderContent(
    variant,
    size,
    leadingIcon,
    trailingIcon,
    children,
  );

  if (asChild && isValidElement(children)) {
    // Clone the single child (e.g. a <Link>) and apply button styling + slots.
    const child = children as ReactElement<{
      className?: string;
      children?: ReactNode;
    }>;
    return cloneElement(
      child,
      { className: cn(classes, child.props.className) },
      renderContent(
        variant,
        size,
        leadingIcon,
        trailingIcon,
        child.props.children,
      ),
    );
  }

  return (
    <button ref={ref} type={type} className={classes} {...props}>
      {content}
    </button>
  );
});
