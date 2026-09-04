import { cn } from "@/lib/cn";

/**
 * Wordmark — the AcuDx logo. A confident, type-forward wordmark with NO symbol
 * and no app-icon tile (the generic template lockup): just the name set in
 * Manrope with tight tracking, leaning on the medical meaning of "Dx"
 * (diagnosis) rendered in the single brand accent (AMBOSS-style teal).
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
        "font-extrabold leading-none tracking-[-0.05em] [font-family:var(--font-display)]",
        sz,
        className,
      )}
    >
      <span className="text-fg">Acu</span>
      <span className="text-brand">Dx</span>
    </span>
  );
}
