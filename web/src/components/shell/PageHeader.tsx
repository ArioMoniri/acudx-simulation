import { type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { SectionLabel } from "@/components/ui";

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
  /**
   * `clinical` (default): compact, no gradient dot — for dashboards and EHR
   * surfaces. `marketing`: larger display type — for the landing surface only.
   */
  tone?: "clinical" | "marketing";
  className?: string;
}

/**
 * PageHeader — the single page-title primitive. Replaces the eyebrow-pill +
 * h1 + subtitle block that was copied verbatim onto six pages. Differentiates
 * clinical dashboards from the marketing surface so every screen no longer
 * opens identically.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  meta,
  tone = "clinical",
  className,
}: PageHeaderProps) {
  const marketing = tone === "marketing";
  return (
    <header
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between",
        marketing ? "gap-5" : "gap-3",
        className,
      )}
    >
      <div className={cn("flex flex-col", marketing ? "gap-3" : "gap-1.5")}>
        {eyebrow ? <SectionLabel>{eyebrow}</SectionLabel> : null}
        <h1
          className={cn(
            "font-semibold tracking-tight text-fg",
            marketing
              ? "text-3xl sm:text-4xl md:text-5xl"
              : "text-xl sm:text-2xl",
          )}
        >
          {title}
        </h1>
        {description ? (
          <p
            className={cn(
              "text-muted",
              marketing ? "max-w-xl text-base sm:text-lg" : "max-w-2xl text-sm",
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
    </header>
  );
}
