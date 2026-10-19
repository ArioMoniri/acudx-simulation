import { Easing } from "remotion";

/**
 * Tokens lifted from docs/design/00-design-system.md and web/src/lib/motion.ts
 * so the film moves and looks like the product: one easing, brief durations,
 * brand blue as the only accent, Manrope display over Inter body.
 */
export const EASE = Easing.bezier(0.16, 1, 0.3, 1);

export const FPS = 30;

/** Durations in frames at 30 fps (motion.ts: fast 0.18 s, base 0.42 s, slow 0.6 s). */
export const DUR = {
  fast: 5,
  base: 13,
  slow: 18,
  /** Scene-level fades: slower than UI motion, still restrained. */
  scene: 20,
} as const;

export const COLOR = {
  bg: "#ffffff",
  bgSubtle: "#f8fafc",
  surface: "#ffffff",
  border: "#e2e8f0",
  fg: "#0f172a",
  muted: "#64748b",
  brand: "#2563eb",
  brandTint: "#eff6ff",
  /** The always-dark monitor palette (the one dark surface in the system). */
  monitorBg: "#0b1220",
  monitorFg: "#e2e8f0",
  monitorMuted: "#94a3b8",
  monitorTrace: "#2dd4bf",
} as const;

export const FONT = {
  display: "'Manrope', 'Inter', system-ui, sans-serif",
  body: "'Inter', system-ui, sans-serif",
  mono: "'Geist Mono', ui-monospace, monospace",
} as const;

export const REPO_URL = "github.com/ArioMoniri/acudx-simulation";
