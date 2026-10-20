import type { Band } from "@/data/schema";

/**
 * Shared band presentation for the institution dashboard.
 *
 * Bands are never conveyed by colour alone (WCAG 1.4.1 / INV-5): every cell
 * pairs a band word (from the i18n `bands.*` catalog) with a fill LEVEL (0-4)
 * that also drives an ordinal pattern, and a tint. A "withheld" band renders as
 * an explicit reliability note, never a guessed colour.
 */

/** Ordinal rank of a band, 0 (emerging) to 4 (exemplary); -1 for withheld. */
export const BAND_RANK: Record<Band, number> = {
  emerging: 0,
  developing: 1,
  proficient: 2,
  strong: 3,
  exemplary: 4,
  withheld: -1,
};

/**
 * Cell tint per band. A single hue ramp (brand tint stepping up) keeps the
 * medkit restraint: stronger bands read as a denser tint, but the band WORD and
 * the fill-level bar carry the meaning so the map is legible without colour.
 */
export const BAND_CELL_TINT: Record<Exclude<Band, "withheld">, string> = {
  emerging: "color-mix(in srgb, var(--fg-muted) 8%, var(--surface))",
  developing: "color-mix(in srgb, var(--brand-600) 10%, var(--surface))",
  proficient: "color-mix(in srgb, var(--brand-600) 20%, var(--surface))",
  strong: "color-mix(in srgb, var(--brand-600) 32%, var(--surface))",
  exemplary: "color-mix(in srgb, var(--brand-600) 46%, var(--surface))",
};

/** Text colour that stays AA-legible on the matching tint above. */
export const BAND_CELL_TEXT: Record<Exclude<Band, "withheld">, string> = {
  emerging: "var(--fg)",
  developing: "var(--fg)",
  proficient: "var(--fg)",
  strong: "var(--fg)",
  exemplary: "white",
};

/** Short two-letter band code for the dense heatmap cell (e.g. "Pr"). */
export function bandCode(band: Band): string {
  switch (band) {
    case "emerging":
      return "Em";
    case "developing":
      return "Dv";
    case "proficient":
      return "Pr";
    case "strong":
      return "St";
    case "exemplary":
      return "Ex";
    case "withheld":
      // Never rendered as text (withheld cells show a lock + word); kept
      // non-em-dash to honour the zero-em-dash UI rule.
      return "n/r";
  }
}
