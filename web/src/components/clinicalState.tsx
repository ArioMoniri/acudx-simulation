import {
  CheckCircle,
  Warning,
  WarningCircle,
  ShieldWarning,
  type Icon,
} from "@phosphor-icons/react";
import type { ClinicalState, Trend } from "@/data/mock";
import type { BadgeProps } from "@/components/ui";

/**
 * Clinical-state presentation map. Meaning is NEVER carried by color alone:
 * every state resolves to a distinct icon + a translated text label
 * (i18n key `states.<state>`), satisfying WCAG 1.4.1.
 */
export interface StatePresentation {
  icon: Icon;
  /** CSS custom property token for the state color. */
  colorVar: string;
  /** Badge tone that pairs with this state. */
  tone: NonNullable<BadgeProps["tone"]>;
  /** i18n key for the human-readable status label. */
  labelKey: string;
}

export const stateMap: Record<ClinicalState, StatePresentation> = {
  normal: {
    icon: CheckCircle,
    colorVar: "var(--state-normal)",
    tone: "normal",
    labelKey: "states.normal",
  },
  caution: {
    icon: Warning,
    colorVar: "var(--state-caution)",
    tone: "caution",
    labelKey: "states.caution",
  },
  warning: {
    icon: WarningCircle,
    colorVar: "var(--state-warning)",
    tone: "warning",
    labelKey: "states.warning",
  },
  critical: {
    icon: ShieldWarning,
    colorVar: "var(--state-critical)",
    tone: "critical",
    labelKey: "states.critical",
  },
};

/** Unicode arrow used in the text/table equivalent for a vital trend. */
export const trendGlyph: Record<Trend, string> = {
  rising: "↑",
  falling: "↓",
  steady: "→",
};
