import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { ArrowsClockwise } from "@phosphor-icons/react";

import { cn } from "@/lib/cn";
import { useStagger } from "@/lib/motion";

interface LoopStep {
  key: "interview" | "chart" | "decision" | "feedback";
  ordinal: string;
  to: string;
}

/**
 * The four moves of one encounter, in order. The first three happen inside
 * the live encounter shell (/encounter); the fourth opens the feedback report.
 */
const STEPS: readonly LoopStep[] = [
  { key: "interview", ordinal: "01", to: "/encounter" },
  { key: "chart", ordinal: "02", to: "/encounter" },
  { key: "decision", ordinal: "03", to: "/encounter" },
  { key: "feedback", ordinal: "04", to: "/feedback" },
];

/**
 * CoreLoop: the loop as a numbered, hairline-divided list (editorial, not a
 * card grid). Each row links into the live product. A short stagger entrance,
 * reduced-motion safe.
 */
export function CoreLoop({ className }: { className?: string }) {
  const { t } = useTranslation();
  const stagger = useStagger();

  return (
    <div className={className}>
      <motion.ol {...stagger.container} className="divide-y divide-border border-y border-border">
        {STEPS.map((step) => (
          <motion.li key={step.key} {...stagger.item}>
            <Link
              to={step.to}
              className={cn(
                "group grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-3 py-3.5 sm:grid-cols-[3rem_minmax(0,14rem)_minmax(0,1fr)] sm:gap-x-5",
                "transition-colors duration-[120ms] ease-out hover:bg-surface",
              )}
            >
              <span className="font-mono text-[0.8125rem] text-subtle">{step.ordinal}</span>
              <h3 className="text-[0.9375rem] font-semibold tracking-tight text-fg">
                {t(`landing2.loop.steps.${step.key}.title`)}
              </h3>
              <p className="col-start-2 text-[0.8125rem] leading-relaxed text-muted sm:col-start-3">
                {t(`landing2.loop.steps.${step.key}.body`)}
              </p>
            </Link>
          </motion.li>
        ))}
      </motion.ol>
      <p className="mt-3 inline-flex items-center gap-2 text-xs text-muted">
        <ArrowsClockwise weight="bold" className="h-3.5 w-3.5 text-subtle" aria-hidden />
        {t("landing2.loop.cycle")}
      </p>
    </div>
  );
}
