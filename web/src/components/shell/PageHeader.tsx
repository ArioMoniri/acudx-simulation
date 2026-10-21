import { type ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/cn";
import { SectionLabel } from "@/components/ui";

export interface Breadcrumb {
  label: ReactNode;
  to?: string;
}

export interface PageHeaderProps {
  /** Small uppercase eyebrow above the title. */
  eyebrow?: ReactNode;
  title: ReactNode;
  /** One supporting line under the title. */
  description?: ReactNode;
  /** Right-aligned actions (buttons, toggles). */
  actions?: ReactNode;
  /** Chips / meta rendered under the description (e.g. a resume pill). */
  meta?: ReactNode;
  /** Breadcrumb trail above the title (the last crumb is the current page). */
  breadcrumbs?: Breadcrumb[];
  /**
   * `clinical` (default): compact, hairline-ruled, for every working surface.
   * `marketing`: the display size, for the landing page only.
   */
  tone?: "clinical" | "marketing";
  className?: string;
}

/**
 * PageHeader: the single page-title primitive. A dense title row with the
 * actions on the right and a hairline under it (Jobber, Whop), an optional
 * breadcrumb trail above it, and the display size reserved for the landing.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  meta,
  breadcrumbs,
  tone = "clinical",
  className,
}: PageHeaderProps) {
  const marketing = tone === "marketing";
  return (
    <header
      className={cn(
        "flex flex-col gap-3",
        !marketing && "border-b border-border pb-5 pt-1",
        className,
      )}
    >
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <ol className="flex flex-wrap items-center gap-1 text-xs text-muted">
          {breadcrumbs.map((c, i) => {
            const last = i === breadcrumbs.length - 1;
            return (
              <li key={i} className="flex items-center gap-1">
                {i > 0 ? (
                  <span aria-hidden className="text-border-strong">
                    /
                  </span>
                ) : null}
                {c.to && !last ? (
                  <Link to={c.to} className="hover:text-fg">
                    {c.label}
                  </Link>
                ) : (
                  <span aria-current={last ? "page" : undefined} className={last ? "text-fg" : undefined}>
                    {c.label}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      ) : null}
      <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between")}>
        <div className={cn("flex min-w-0 flex-col", marketing ? "gap-3" : "gap-1")}>
          {eyebrow ? <SectionLabel>{eyebrow}</SectionLabel> : null}
          <h1
            className={cn(
              "text-fg",
              marketing
                ? "display text-[2rem] leading-[1.1] sm:text-[2.5rem] lg:text-[2.75rem]"
                : "display text-[1.625rem] sm:text-[2rem]",
            )}
          >
            {title}
          </h1>
          {description ? (
            <p
              className={cn(
                "text-muted",
                marketing ? "max-w-xl text-base sm:text-lg" : "mt-1 max-w-2xl text-sm",
              )}
            >
              {description}
            </p>
          ) : null}
          {meta ? <div className="mt-1 flex flex-wrap items-center gap-2">{meta}</div> : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}
