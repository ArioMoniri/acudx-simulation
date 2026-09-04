import { useTranslation } from "react-i18next";
import { BookOpenText } from "@phosphor-icons/react";

import { cn } from "@/lib/cn";

/**
 * CredibilityStrip — a restrained, monochrome citation band under the hero.
 * Names the guideline bodies AcuDx grounds its hints and feedback in as plain
 * text (no fake logos), so the claim reads as sourced rather than decorative.
 */
export function CredibilityStrip({ className }: { className?: string }) {
  const { t } = useTranslation();
  const sources = t("landing2.credibility.sources")
    .split("·")
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <div
      className={cn(
        "flex flex-col gap-3 border-y border-border py-4",
        "sm:flex-row sm:items-center sm:justify-between sm:gap-6",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <BookOpenText
          weight="bold"
          className="h-4 w-4 shrink-0 text-subtle"
          aria-hidden
        />
        <p className="text-sm text-muted">
          <span className="font-medium text-fg">
            {t("landing2.credibility.label")}
          </span>
          <span className="hidden text-subtle sm:inline">
            {" · "}
            {t("landing2.credibility.note")}
          </span>
        </p>
      </div>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {sources.map((src) => (
          <li
            key={src}
            className="text-xs font-medium uppercase tracking-[0.08em] text-subtle"
          >
            {src}
          </li>
        ))}
      </ul>
    </div>
  );
}
