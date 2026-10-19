import { cn } from "@/lib/cn";

/**
 * Wordmark — the AcuDx logo lockup for the shell: the "acute trace" mark
 * followed by the name set in Manrope with tight tracking, "Dx" (diagnosis)
 * in the single brand accent.
 *
 * The mark is the master geometry from `web/public/brand/acudx-mark.svg`
 * (viewBox 256, stroke 32, round caps, mitred 60 degree apex), inlined so it
 * follows `currentColor` and therefore the theme: `--axis-clinical` is the
 * brand blue (#2563eb) on light and the lightened clinical blue (#60a5fa) on
 * dark, which is exactly the light/dark pair the brand files use. Brand rules, clear space and the full
 * file set live in `web/public/brand/README.md` and
 * `docs/design/02-brand-identity.md`.
 */
export function Wordmark({
  className,
  size = "md",
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const sz =
    size === "lg"
      ? "text-[1.75rem]"
      : size === "sm"
        ? "text-[1.05rem]"
        : "text-[1.2rem]";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[0.3em] font-extrabold leading-none tracking-[-0.05em] [font-family:var(--font-display)]",
        sz,
        className,
      )}
    >
      <AcuDxMark className="h-[1.15em] w-[1.15em] text-axis-clinical" />
      <span>
        <span className="text-fg">Acu</span>
        <span className="text-axis-clinical">Dx</span>
      </span>
    </span>
  );
}

/**
 * AcuDxMark — the symbol alone, as inline SVG in `currentColor`.
 * Decorative by default (the adjacent text carries the name); pass `title`
 * when the mark stands on its own.
 */
export function AcuDxMark({
  className,
  title,
}: {
  className?: string;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 256 256"
      className={cn("shrink-0", className)}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="32"
        strokeLinecap="round"
      >
        <path
          d="M31 212 L128 44 L225 212"
          strokeLinejoin="miter"
          strokeMiterlimit="4"
        />
        <path d="M14 158 H242" />
      </g>
    </svg>
  );
}
