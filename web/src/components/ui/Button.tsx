import {
  cloneElement,
  forwardRef,
  isValidElement,
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Optional trailing icon shown inside a soft circle (CTA affordance). */
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
  /**
   * Busy state. Shows a spinner in the leading slot, disables the control, and
   * sets `aria-busy`. The label is kept so the button width stays stable.
   */
  loading?: boolean;
}

const base =
  "inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap " +
  "rounded-control select-none transition-[background-color,color,box-shadow,transform] " +
  "duration-150 ease-out active:scale-[0.98] disabled:opacity-50 " +
  "disabled:pointer-events-none focus-visible:outline-none no-underline";

const variants: Record<Variant, string> = {
  // The ONE locked accent CTA — flat, no float.
  primary: "bg-brand text-white hover:bg-brand-hover",
  secondary: "bg-surface text-fg border border-border-strong hover:bg-bg-subtle",
  ghost: "bg-transparent text-fg hover:bg-bg-subtle",
  danger:
    "bg-[color:var(--state-critical)] text-white hover:brightness-95",
};

// Tighter, software-grade heights. Min target stays comfortable at md/lg.
const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[0.8125rem] min-w-8",
  md: "h-9 px-4 text-sm min-w-9",
  lg: "h-11 px-6 text-[0.9375rem] min-w-11",
};

const circleSizes: Record<Size, string> = {
  sm: "h-4 w-4 -me-0.5",
  md: "h-5 w-5 -me-1",
  lg: "h-6 w-6 -me-1.5",
};

const spinnerSizes: Record<Size, string> = {
  sm: "h-3.5 w-3.5",
  md: "h-4 w-4",
  lg: "h-5 w-5",
};

/** Inline busy spinner. Inherits the button text color via currentColor. */
function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn("animate-spin", className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

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
            variant === "primary" || variant === "danger"
              ? "bg-white/20"
              : "bg-brand-tint text-brand",
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
    loading = false,
    disabled,
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

  // While busy, the spinner takes over the leading slot (keeping the label).
  const leading = loading ? <Spinner className={spinnerSizes[size]} /> : leadingIcon;

  const content = renderContent(variant, size, leading, trailingIcon, children);

  if (asChild && isValidElement(children)) {
    // Clone the single child (e.g. a <Link>) and apply button styling + slots.
    const child = children as ReactElement<{
      className?: string;
      children?: ReactNode;
      "aria-busy"?: boolean;
      "aria-disabled"?: boolean;
    }>;
    return cloneElement(
      child,
      {
        className: cn(classes, loading && "pointer-events-none", child.props.className),
        ...(loading ? { "aria-busy": true, "aria-disabled": true } : {}),
      },
      renderContent(variant, size, leading, trailingIcon, child.props.children),
    );
  }

  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {content}
    </button>
  );
});
