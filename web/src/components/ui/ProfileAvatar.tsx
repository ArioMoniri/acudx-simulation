/* -------------------------------------------------------------------------- */
/* Generated avatar (deterministic and offline: no photo, no external asset)  */
/* -------------------------------------------------------------------------- */

/** Fixed, pleasant hues for the named seeds; unknown seeds hash to a hue. */
const SEED_HUE: Record<string, number> = {
  aster: 262,
  cobalt: 214,
  verdant: 152,
  amber: 38,
  magenta: 322,
  slate: 220,
};

function hueForSeed(seed: string): number {
  if (seed in SEED_HUE) return SEED_HUE[seed];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

export function ProfileAvatar({
  seed,
  name,
  size = 40,
  className,
}: {
  seed: string;
  name: string;
  size?: number;
  className?: string;
}) {
  const hue = hueForSeed(seed);
  return (
    <span
      aria-hidden="true"
      className={className}
      style={{
        display: "inline-grid",
        placeItems: "center",
        width: size,
        height: size,
        // Never squeezed by a flex row (it rendered as an oval beside long names).
        flexShrink: 0,
        minWidth: size,
        borderRadius: "9999px",
        // Muted chroma (42%) so no seed reads as a neon badge; 29% lightness keeps white initials at 4.5:1 or better on every hue.
        background: `hsl(${hue} 42% 29%)`,
        color: "#fff",
        fontWeight: 600,
        fontSize: Math.max(11, Math.round(size * 0.38)),
        lineHeight: 1,
        letterSpacing: "0.01em",
        userSelect: "none",
      }}
    >
      {initialsOf(name)}
    </span>
  );
}
