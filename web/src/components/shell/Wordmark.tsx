import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Wordmark — the AcuDx logo lockup for the shell: the "pulse seal" mark
 * followed by the name set in Manrope with tight tracking, "Dx" (diagnosis)
 * in the single brand accent.
 *
 * The mark is the master geometry from `web/public/brand/acudx-mark.svg`
 * (viewBox 256: a rounded tile, 12 to 244 with rx 58, split in two by one
 * 60 degree deflection of a monitor trace; the trace is real negative space,
 * so the two pieces are explicit outlines). It is inlined so it follows
 * `currentColor` and therefore the theme: `--brand-mark` is Pulse cobalt on
 * paper and the lightened cobalt on dark and on the ink rail (where the ink
 * scope re-points the token). The tile is sized to
 * 1.16 x the cap height and spaced 0.2 cap from the name, matching
 * `acudx-lockup-horizontal.svg`. Brand rules, clear space and the full file
 * set live in `web/public/brand/README.md` and
 * `docs/design/02-brand-identity.md`.
 */
export function Wordmark({
  className,
  size = "md",
  mark,
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
  /** Replaces the static symbol (the landing hero passes the Lottie mark). */
  mark?: ReactNode;
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
        "wordmark inline-flex items-center gap-[0.12em] leading-none",
        sz,
        className,
      )}
    >
      {mark ?? <AcuDxMark className="h-[0.92em] w-[0.92em] text-brand-mark" />}
      <span>
        <span className="text-fg">Acu</span>
        <span className="text-brand-mark">Dx</span>
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
      <g fill="currentColor">
        <path d="M12 158 H62.2 L128 44 L193.8 158 H244 V70 A58 58 0 0 0 186 12 H70 A58 58 0 0 0 12 70 Z" />
        <path d="M12 186 H78.3 L128 100 L177.7 186 H244 V186 A58 58 0 0 1 186 244 H70 A58 58 0 0 1 12 186 Z" />
      </g>
    </svg>
  );
}
