import { Check } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import type { EncounterStageMeta, Lang } from "@/data/schema";

export interface ProgressStagesProps {
  stages: EncounterStageMeta[];
  /** Index of the stage currently in progress. */
  currentIndex: number;
  lang: Lang;
  /** Accessible label for the ordered list of stages. */
  ariaLabel: string;
}

/**
 * ProgressStages — a horizontal clinical stepper. The current stage is marked
 * with aria-current and a filled brand node; completed stages carry a check.
 * State is conveyed by icon + text + position, never color alone.
 */
export function ProgressStages({
  stages,
  currentIndex,
  lang,
  ariaLabel,
}: ProgressStagesProps) {
  return (
    <nav aria-label={ariaLabel}>
      <ol
        tabIndex={0}
        aria-label={ariaLabel}
        className="flex items-center gap-1 overflow-x-auto pb-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        {stages.map((stage, i) => {
          const status =
            i < currentIndex ? "done" : i === currentIndex ? "current" : "todo";
          return (
            <li key={stage.key} className="flex shrink-0 items-center">
              <span
                aria-current={status === "current" ? "step" : undefined}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                  "transition-colors duration-200 ease-out",
                  status === "current" &&
                    "bg-brand text-white shadow-soft",
                  status === "done" && "bg-brand-tint text-brand",
                  status === "todo" && "bg-bg-subtle text-muted",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid h-4 w-4 place-items-center rounded-full text-[10px] font-semibold",
                    status === "current" && "bg-white/25 text-white",
                    status === "done" && "bg-brand/15 text-brand",
                    status === "todo" &&
                      "border border-border text-muted",
                  )}
                >
                  {status === "done" ? (
                    <Check weight="bold" className="h-2.5 w-2.5" />
                  ) : (
                    i + 1
                  )}
                </span>
                {stage.label[lang]}
              </span>
              {i < stages.length - 1 ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    "mx-0.5 h-px w-4 shrink-0",
                    i < currentIndex ? "bg-brand/40" : "bg-border",
                  )}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
