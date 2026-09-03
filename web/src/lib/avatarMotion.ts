/**
 * AcuDx — avatarMotion: reusable idle-animation helpers for the procedural
 * patient avatar (issue #2). All motion is CSS-keyframe based so it is fully
 * self-contained (air-gap friendly), lives inside the SVG, and is neutralised
 * two ways under prefers-reduced-motion: the global rule in index.css AND the
 * `enabled` gate here (we simply do not attach the animated classes).
 *
 * The affect + clinical-sign channel *shapes* the idle motion so the animation
 * never contradicts the words: respiratory distress speeds and deepens the
 * breathing cycle and lifts the shoulders (accessory-muscle use); drowsiness /
 * reduced LOC droops the lids and slows the blink; anxiety adds a faint tremor.
 *
 * This module is a leaf: it imports nothing from the components, so there is no
 * import cycle with PatientPortrait / PatientAvatar.
 */

/* -------------------------------------------------------------------------- */
/* Motion parameters                                                           */
/* -------------------------------------------------------------------------- */

export interface AvatarMotionInput {
  /** Baseline affect label, lower-cased (e.g. "anxious", "drowsy"). */
  affect: string;
  /** 0..1 strength of the affect. */
  affectIntensity: number;
  /** 0..1 respiratory-distress sign intensity. */
  respiratoryDistress: number;
  /** 0..1 reduced level-of-consciousness sign intensity. */
  reducedLoc: number;
  /** 0..1 diaphoresis sign intensity (drives sweat-bead motion). */
  diaphoresis: number;
  /** prefers-reduced-motion result — when true, all motion is disabled. */
  reducedMotion: boolean;
}

export interface AvatarMotionParams {
  /** Whole inhale→exhale cycle, ms. */
  breatheDurationMs: number;
  /** Torso vertical travel, px (viewBox units). */
  breatheAmplitude: number;
  /** Extra shoulder scaleY on inhale (accessory-muscle use), 0..~0.05. */
  shoulderLift: number;
  /** Average time between blinks, ms. */
  blinkDurationMs: number;
  /** Resting lid closure 0 (wide) .. 0.6 (heavy droop). */
  lidRest: number;
  /** Gentle full-body sway cycle, ms. */
  swayDurationMs: number;
  /** Head tremor travel, px. 0 disables the tremor group. */
  tremorAmplitude: number;
  /** Sweat-bead fall cycle, ms. 0 disables beads. */
  beadDurationMs: number;
  /** Master gate — false under reduced motion. */
  enabled: boolean;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp01(t);
}

/**
 * Derive idle-motion parameters from affect + clinical signs. Pure and
 * deterministic so the avatar, monitor, and caption always agree.
 */
export function computeAvatarMotion(input: AvatarMotionInput): AvatarMotionParams {
  const {
    affect,
    affectIntensity,
    respiratoryDistress,
    reducedLoc,
    diaphoresis,
    reducedMotion,
  } = input;

  const a = (affect || "").toLowerCase();
  const ai = clamp01(affectIntensity);
  const distress = clamp01(respiratoryDistress);
  const loc = clamp01(reducedLoc);

  // ---- Breathing: calm ~4.4s, tachypnoeic distress down toward ~1.5s -------
  let breatheDurationMs = lerp(4400, 1500, distress);
  let breatheAmplitude = lerp(0.5, 1.15, distress);
  // Anxious / distressed patients breathe a little quicker even without the sign.
  if (a === "anxious" || a === "distressed") {
    breatheDurationMs *= lerp(1, 0.82, ai);
  }
  // Drowsy / reduced LOC breathe slower and shallower.
  if (a === "drowsy" || loc > 0.2) {
    breatheDurationMs = lerp(breatheDurationMs, 5200, Math.max(loc, a === "drowsy" ? 0.6 : 0));
    breatheAmplitude = lerp(breatheAmplitude, 0.35, loc);
  }
  const shoulderLift = lerp(0, 0.05, distress);

  // ---- Blink: base ~4.5s; anxious quicker, drowsy slower + heavier ---------
  let blinkDurationMs = 4500;
  if (a === "anxious") blinkDurationMs = lerp(4500, 3000, ai);
  if (a === "drowsy" || loc > 0.2) blinkDurationMs = lerp(4500, 7200, Math.max(loc, a === "drowsy" ? 0.6 : 0));
  const lidRest = clamp01(Math.max(loc * 0.6, a === "drowsy" ? 0.42 * Math.max(ai, 0.6) : 0));

  // ---- Sway + tremor -------------------------------------------------------
  const swayDurationMs = lerp(7000, 5200, Math.max(ai * 0.5, distress));
  let tremorAmplitude = 0;
  if (a === "anxious" || a === "distressed" || a === "irritable") {
    tremorAmplitude = lerp(0, 0.22, ai);
  }
  // A drowsy patient is still, not trembling.
  if (a === "drowsy" || loc > 0.4) tremorAmplitude = 0;

  const beadDurationMs = diaphoresis > 0.15 ? lerp(3200, 1900, diaphoresis) : 0;

  return {
    breatheDurationMs: Math.round(breatheDurationMs),
    breatheAmplitude: Number(breatheAmplitude.toFixed(3)),
    shoulderLift: Number(shoulderLift.toFixed(3)),
    blinkDurationMs: Math.round(blinkDurationMs),
    lidRest: Number(lidRest.toFixed(3)),
    swayDurationMs: Math.round(swayDurationMs),
    tremorAmplitude: Number(tremorAmplitude.toFixed(3)),
    beadDurationMs: Math.round(beadDurationMs),
    enabled: !reducedMotion,
  };
}

/* -------------------------------------------------------------------------- */
/* CSS custom properties for the SVG root                                      */
/* -------------------------------------------------------------------------- */

/** CSS variables consumed by the injected keyframes. Spread onto the SVG root. */
export function motionVars(p: AvatarMotionParams): Record<string, string> {
  return {
    "--acudx-av-breathe-dur": `${p.breatheDurationMs}ms`,
    "--acudx-av-breathe-amp": `${p.breatheAmplitude}`,
    "--acudx-av-shoulder-lift": `${1 + p.shoulderLift}`,
    "--acudx-av-blink-dur": `${p.blinkDurationMs}ms`,
    "--acudx-av-lid-rest": `${p.lidRest}`,
    "--acudx-av-sway-dur": `${p.swayDurationMs}ms`,
    "--acudx-av-tremor-amp": `${p.tremorAmplitude}`,
    "--acudx-av-bead-dur": `${p.beadDurationMs}ms`,
  };
}

/* -------------------------------------------------------------------------- */
/* Keyframes (injected once into <head>)                                       */
/* -------------------------------------------------------------------------- */

export const AVATAR_STYLE_ID = "acudx-avatar-motion";

/**
 * The stylesheet is transform/opacity only (compositor-friendly). Every
 * animated node uses `transform-box: fill-box` so origins are element-local.
 * A local reduced-motion guard is included so the stylesheet is safe to reuse
 * anywhere, independent of the global rule.
 */
export function avatarKeyframesCss(): string {
  return `
.acudx-av * { transform-box: fill-box; }
.acudx-av__breathe {
  transform-origin: 50% 100%;
  animation: acudx-av-breathe var(--acudx-av-breathe-dur, 4400ms) ease-in-out infinite;
}
.acudx-av__shoulders {
  transform-origin: 50% 100%;
  animation: acudx-av-shoulders var(--acudx-av-breathe-dur, 4400ms) ease-in-out infinite;
}
.acudx-av__sway {
  transform-origin: 50% 90%;
  animation: acudx-av-sway var(--acudx-av-sway-dur, 7000ms) ease-in-out infinite;
}
.acudx-av__tremor {
  transform-origin: 50% 50%;
  animation: acudx-av-tremor 220ms steps(2, end) infinite;
}
.acudx-av__lid {
  transform-origin: center top;
  transform: scaleY(var(--acudx-av-lid-rest, 0));
  animation: acudx-av-blink var(--acudx-av-blink-dur, 4500ms) ease-in-out infinite;
}
.acudx-av__bead {
  transform-origin: center top;
  animation: acudx-av-bead var(--acudx-av-bead-dur, 2600ms) ease-in infinite;
}
.acudx-av__bead--2 { animation-delay: 1100ms; }
@keyframes acudx-av-breathe {
  0%, 100% { transform: translateY(0); }
  45% { transform: translateY(calc(var(--acudx-av-breathe-amp, 0.5) * -1px)); }
}
@keyframes acudx-av-shoulders {
  0%, 100% { transform: scaleY(1); }
  45% { transform: scaleY(var(--acudx-av-shoulder-lift, 1)); }
}
@keyframes acudx-av-sway {
  0%, 100% { transform: translateX(-0.25px) rotate(-0.5deg); }
  50% { transform: translateX(0.25px) rotate(0.5deg); }
}
@keyframes acudx-av-tremor {
  0%, 100% { transform: translate(calc(var(--acudx-av-tremor-amp, 0) * -1px), 0); }
  50% { transform: translate(var(--acudx-av-tremor-amp, 0) * 1px, 0); }
}
@keyframes acudx-av-blink {
  0%, 90%, 100% { transform: scaleY(var(--acudx-av-lid-rest, 0)); }
  94%, 97% { transform: scaleY(1); }
}
@keyframes acudx-av-bead {
  0% { opacity: 0; transform: translateY(0); }
  15% { opacity: 0.9; }
  100% { opacity: 0; transform: translateY(7px); }
}
@media (prefers-reduced-motion: reduce) {
  .acudx-av__breathe, .acudx-av__shoulders, .acudx-av__sway,
  .acudx-av__tremor, .acudx-av__lid, .acudx-av__bead {
    animation: none !important;
  }
  .acudx-av__lid { transform: scaleY(var(--acudx-av-lid-rest, 0)); }
}
`.trim();
}

/**
 * Inject the keyframes once. Idempotent and SSR-safe (no-op without document).
 * Called from an effect in the renderer so every avatar shares one stylesheet.
 */
export function ensureAvatarStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(AVATAR_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = AVATAR_STYLE_ID;
  style.textContent = avatarKeyframesCss();
  document.head.appendChild(style);
}
