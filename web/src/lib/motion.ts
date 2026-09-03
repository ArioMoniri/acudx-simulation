import { useReducedMotion } from "motion/react";
import type { MotionProps, Variants } from "motion/react";

/**
 * motion.ts — AcuDx shared motion system.
 *
 * A small, opinionated vocabulary for medkit-style micro-interactions on the
 * learner surfaces. Everything here is premium-restrained: gentle entrances,
 * a single canonical easing, and hover affordances that read as "calm and
 * clinical", never flashy.
 *
 * Hard rules baked in:
 * - Animate transform (`y`) and `opacity` ONLY. No width/height/top/left, so
 *   nothing here can trigger layout or reflow.
 * - Every consumer hook collapses to zero motion under `prefers-reduced-motion`
 *   (returns empty props), so there is no fade, no translate, and no motion
 *   sickness for readers who opt out.
 * - Timings are short and consistent so the whole product feels like one system.
 */

/* -------------------------------------------------------------------------- */
/* Tokens                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The canonical AcuDx easing — cubic-bezier(0.16, 1, 0.3, 1). A soft, decisive
 * "settle" curve: quick to leave, gently arriving. Used for every entrance and
 * hover so motion feels like one hand drew it.
 */
export const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** Durations in seconds. Deliberately brief — restraint over spectacle. */
export const DURATION = {
  /** Hover / press feedback. */
  fast: 0.18,
  /** The default entrance. */
  base: 0.42,
  /** Reserved for larger, rarer reveals. */
  slow: 0.6,
} as const;

/** Vertical travel for a fade-up, in pixels (transform only). */
const REVEAL_Y = 12;
/** How far a card rises on hover, in pixels (transform only). */
const HOVER_LIFT_Y = 4;
/** Gap between staggered siblings, in seconds. */
const STAGGER_GAP = 0.06;
/** Lead-in before the first staggered child, in seconds. */
const STAGGER_LEAD = 0.02;

/** The default entrance transition. */
const enterTransition = { duration: DURATION.base, ease: EASE } as const;

/* -------------------------------------------------------------------------- */
/* Variants (transform + opacity only)                                         */
/* -------------------------------------------------------------------------- */

/**
 * fadeUp — a single element rising a few pixels into place while fading in.
 * The `show` target is a resolver so an optional `custom={delay}` can offset it,
 * letting sibling sections cascade without a shared parent.
 */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: REVEAL_Y },
  show: (delay: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { ...enterTransition, delay },
  }),
};

/**
 * staggerContainer — an invisible orchestrator. It never changes appearance;
 * it only schedules its `staggerItem` children into view one after another.
 */
export const staggerContainer: Variants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: STAGGER_GAP,
      delayChildren: STAGGER_LEAD,
    },
  },
};

/** staggerItem — one child of a {@link staggerContainer}: the same fade-up. */
export const staggerItem: Variants = {
  hidden: { opacity: 0, y: REVEAL_Y },
  show: { opacity: 1, y: 0, transition: enterTransition },
};

/**
 * hoverLift — a card rising slightly toward the reader on hover. Transform only,
 * so it composites cleanly on top of any CSS shadow transition the card owns.
 */
export const hoverLift: Variants = {
  rest: { y: 0 },
  hover: { y: -HOVER_LIFT_Y, transition: { duration: DURATION.fast, ease: EASE } },
};

/* -------------------------------------------------------------------------- */
/* Reduced-motion-safe consumer hooks                                          */
/* -------------------------------------------------------------------------- */

/**
 * useReveal — entrance props for a standalone element (a section, a header).
 * Fades and rises into place on mount; pass `delay` to cascade siblings.
 * Returns no motion props when the reader prefers reduced motion.
 */
export function useReveal(delay = 0): MotionProps {
  const reduce = useReducedMotion();
  if (reduce) return {};
  return {
    variants: fadeUp,
    custom: delay,
    initial: "hidden",
    animate: "show",
  };
}

/**
 * useStagger — props for a group whose children should cascade in.
 *
 * Spread `container` on the wrapping element and `item` on each DIRECT motion
 * child; the children inherit the animation state and are scheduled by the
 * container. Children must not set their own `initial`/`animate`.
 *
 * Under reduced motion both are empty, so the group renders statically.
 */
export function useStagger(): { container: MotionProps; item: MotionProps } {
  const reduce = useReducedMotion();
  if (reduce) return { container: {}, item: {} };
  return {
    container: { variants: staggerContainer, initial: "hidden", animate: "show" },
    item: { variants: staggerItem },
  };
}

/**
 * useStaggerItem — the child half of {@link useStagger} for when a child lives
 * in its own component and cannot receive the `item` prop inline. Reference the
 * shared `staggerItem` variant; the nearest motion container drives the timing.
 */
export function useStaggerItem(): MotionProps {
  const reduce = useReducedMotion();
  if (reduce) return {};
  return { variants: staggerItem };
}

/**
 * useHoverLift — a gentle rise on hover for interactive cards. Pair it with the
 * card's own shadow transition. Press feedback is intentionally omitted here so
 * it never fights the Button component's built-in `active:scale`.
 * No motion under reduced-motion preference.
 */
export function useHoverLift(): MotionProps {
  const reduce = useReducedMotion();
  if (reduce) return {};
  return {
    whileHover: {
      y: -HOVER_LIFT_Y,
      transition: { duration: DURATION.fast, ease: EASE },
    },
  };
}
