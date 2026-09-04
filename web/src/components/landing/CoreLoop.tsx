import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import {
  ChatCircleText,
  ClipboardText,
  ListChecks,
  Target,
  CaretRight,
  ArrowsClockwise,
  type Icon,
} from "@phosphor-icons/react";

import { Card } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useStagger } from "@/lib/motion";

interface LoopStep {
  key: "interview" | "chart" | "decision" | "feedback";
  ordinal: string;
  icon: Icon;
  to: string;
}

/**
 * The four moves of one encounter, in order. The first three all happen inside
 * the live encounter shell (/encounter); the fourth opens the feedback report.
 */
const STEPS: readonly LoopStep[] = [
  { key: "interview", ordinal: "01", icon: ChatCircleText, to: "/encounter" },
  { key: "chart", ordinal: "02", icon: ClipboardText, to: "/encounter" },
  { key: "decision", ordinal: "03", icon: ListChecks, to: "/encounter" },
  { key: "feedback", ordinal: "04", icon: Target, to: "/feedback" },
];

/**
 * CoreLoop — the dominant horizontal stepper for the landing "how a case runs"
 * section. One hairline band (not four equal cards): numbered, connected steps
 * that flow left to right on desktop and stack on mobile, closing with a
 * loop-back caption. Each step links into the live demo so a reviewer can walk
 * the product. Restrained stagger entrance, reduced-motion safe.
 */
export function CoreLoop() {
  const { t } = useTranslation();
  const stagger = useStagger();

  return (
    <Card variant="surface" padding="lg">
      <motion.ol
        {...stagger.container}
        className="flex flex-col lg:flex-row lg:items-stretch"
      >
        {STEPS.map((step, i) => {
          const StepIcon = step.icon;
          return (
            <motion.li
              key={step.key}
              {...stagger.item}
              className="flex flex-col lg:flex-1 lg:flex-row lg:items-stretch"
            >
              <Link
                to={step.to}
                className={cn(
                  "group flex h-full flex-1 flex-col gap-2 rounded-control p-3",
                  "transition-colors duration-200 ease-out hover:bg-bg-subtle",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                )}
              >
                <div className="flex items-center gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-control bg-brand-tint text-brand">
                    <StepIcon weight="bold" className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="eyebrow tnum text-subtle">
                    {step.ordinal}
                  </span>
                </div>
                <h3 className="text-base font-semibold tracking-tight text-fg">
                  {t(`landing2.loop.steps.${step.key}.title`)}
                </h3>
                <p className="text-sm leading-relaxed text-muted">
                  {t(`landing2.loop.steps.${step.key}.body`)}
                </p>
              </Link>

              {/* Connector — right caret on desktop, down caret on mobile */}
              {i < STEPS.length - 1 ? (
                <span
                  className="flex items-center justify-center py-1 lg:px-1 lg:py-0"
                  aria-hidden="true"
                >
                  <CaretRight
                    weight="bold"
                    className="h-4 w-4 rotate-90 text-subtle lg:rotate-0"
                  />
                </span>
              ) : null}
            </motion.li>
          );
        })}
      </motion.ol>

      <p className="mt-4 inline-flex items-center gap-2 border-t border-border pt-4 text-xs text-muted">
        <ArrowsClockwise weight="bold" className="h-4 w-4 text-brand" aria-hidden />
        {t("landing2.loop.cycle")}
      </p>
    </Card>
  );
}
