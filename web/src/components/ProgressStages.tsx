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
 * ProgressStages: a compact clinical stepper that always fits its row (no
 * horizontal scroll, owner 2026-10-21). Each stage is an equal segment with a
 * 2 px rule on top (cobalt once reached), its number and its label. On a
 * narrow row only the current stage keeps its visible label and takes the
 * spare width; the others show their number and keep the label for assistive
 * tech and as a tooltip. State is conveyed by the check, the rule, text and
 * aria-current, never colour alone.
 */
export function ProgressStages({
  stages,
  currentIndex,
  lang,
  ariaLabel,
}: ProgressStagesProps) {
  return (
    <nav aria-label={ariaLabel} className="min-w-0">
      <ol aria-label={ariaLabel} className="flex w-full min-w-0 items-stretch gap-1">
        {stages.map((stage, i) => {
          const status =
            i < currentIndex ? "done" : i === currentIndex ? "current" : "todo";
          const label = stage.label[lang];
          return (
            <li
              key={stage.key}
              title={label}
              className={cn(
                "flex min-w-0 flex-col gap-1",
                status === "current" ? "flex-[3] md:flex-[1.75]" : "flex-1",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "h-0.5 w-full",
                  status === "todo" ? "bg-border-strong" : "bg-brand",
                )}
              />
              <span
                aria-current={status === "current" ? "step" : undefined}
                className={cn(
                  "flex min-w-0 items-center gap-1.5 text-xs",
                  status === "current" && "font-semibold text-fg",
                  status === "done" && "text-fg",
                  status === "todo" && "text-muted",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid h-4 w-4 shrink-0 place-items-center rounded-chip font-mono text-[0.625rem] font-semibold",
                    status === "current" && "bg-fg text-bg",
                    status === "done" && "bg-brand text-on-brand",
                    status === "todo" && "border border-border-strong text-muted",
                  )}
                >
                  {status === "done" ? <Check weight="bold" className="h-2.5 w-2.5" /> : i + 1}
                </span>
                <span
                  className={cn(
                    "min-w-0 truncate",
                    status !== "current" && "sr-only md:not-sr-only",
                  )}
                >
                  {label}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
