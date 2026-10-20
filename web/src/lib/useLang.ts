import { useTranslation } from "react-i18next";
import { useReducedMotion } from "motion/react";
import type { Lang } from "@/data/schema";

/** Resolve the active UI language as the narrow "en" | "tr" union used by bilingual content. */
export function useLang(): Lang {
  const { i18n } = useTranslation();
  return ((i18n.resolvedLanguage ?? "en").split("-")[0] as Lang) === "tr"
    ? "tr"
    : "en";
}

/**
 * useEntry — shared entry motion props for key sections.
 * Animates only transform/opacity and collapses to no motion when the user
 * prefers reduced motion.
 */
export function useEntry(delay = 0) {
  const reduce = useReducedMotion();
  return {
    initial: reduce ? undefined : { opacity: 0, y: 12 },
    animate: reduce ? undefined : { opacity: 1, y: 0 },
    transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] as const, delay },
  };
}
