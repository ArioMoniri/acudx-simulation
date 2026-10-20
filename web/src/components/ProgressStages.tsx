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
 * ProgressStages: a compact clinical stepper. Square numbered chips joined by
 * hairlines; the current stage is filled with the accent and carries
 * aria-current, completed stages carry a check. State is conveyed by icon,
 * text and position, never colour alone.
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
        className="flex items-center overflow-x-auto"
      >
        {stages.map((stage, i) => {
          const status =
            i < currentIndex ? "done" : i === currentIndex ? "current" : "todo";
          return (
            <li key={stage.key} className="flex shrink-0 items-center">
              <span
                aria-current={status === "current" ? "step" : undefined}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-chip px-2 text-xs font-medium",
                  "transition-colors duration-[120ms] ease-out",
                  status === "current" && "bg-fg text-bg",
                  status === "done" && "text-fg",
                  status === "todo" && "text-muted",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid h-4 w-4 place-items-center rounded-chip font-mono text-[0.625rem] font-semibold",
                    status === "current" && "bg-bg/20 text-bg",
                    status === "done" && "bg-brand text-on-brand",
                    status === "todo" && "border border-border-strong text-muted",
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
                    "mx-1 h-px w-5 shrink-0",
                    i < currentIndex ? "bg-brand" : "bg-border-strong",
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
