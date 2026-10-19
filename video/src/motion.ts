import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { DUR, EASE } from "./theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/**
 * fadeUp: the design system's one entrance. Opacity 0 to 1 and a 12 px rise
 * over DUR.base frames on the canonical easing, starting at `delay`.
 * Returns a style object (transform and opacity only, never layout).
 */
export function useFadeUp(delay = 0, distance = 12, duration: number = DUR.base) {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [delay, delay + duration], [0, 1], { ...clamp, easing: EASE });
  return {
    opacity: t,
    transform: `translateY(${(1 - t) * distance}px)`,
  };
}

/**
 * Scene envelope: fade in over DUR.scene frames at the start of the sequence
 * and fade out over DUR.scene frames before its end. Opacity only.
 */
export function useSceneFade() {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const tin = interpolate(frame, [0, DUR.scene], [0, 1], { ...clamp, easing: EASE });
  const tout = interpolate(
    frame,
    [durationInFrames - DUR.scene, durationInFrames],
    [1, 0],
    { ...clamp, easing: EASE },
  );
  return Math.min(tin, tout);
}

/** Linear progress 0..1 across the whole sequence, for slow pans. */
export function useProgress() {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return interpolate(frame, [0, durationInFrames], [0, 1], clamp);
}
