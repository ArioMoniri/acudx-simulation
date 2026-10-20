/**
 * Display form of a UCUM unit.
 *
 * Acceptance 2026-10-20 D-22: results read "16.810*9/L" (WBC 16.8, unit
 * 10*9/L) because the UCUM code was printed raw and the value and unit were
 * separated only by CSS margin. The display form is "x10^9/L" with a
 * superscript exponent ("×10⁹/L"), and callers put a real space before it.
 */
const SUPERSCRIPT: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻",
};

export function displayUnit(unit: string | undefined | null): string {
  const u = (unit ?? "").trim();
  if (!u) return "";
  return u.replace(/^10[*^](-?\d+)/, (_m, exp: string) => `×10${[...exp].map((c) => SUPERSCRIPT[c] ?? c).join("")}`);
}

/** "16.8 ×10⁹/L": value and unit with a real space between them. */
export function withUnit(value: string | number, unit: string | undefined | null): string {
  const d = displayUnit(unit);
  return d ? `${value} ${d}` : String(value);
}
