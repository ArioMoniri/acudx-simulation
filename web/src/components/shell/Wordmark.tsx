import { cn } from "@/lib/cn";

/**
 * Wordmark — the AcuDx logo. A crafted, single-accent instrument mark: a solid
 * ink tile carrying a precise ECG trace whose R-wave reads in the brand blue
 * (the one place brand color appears in the mark — no gradient), paired with a
 * Manrope wordmark. Built to look like a clinical instrument, not a template.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span
        aria-hidden="true"
        className="grid h-7 w-7 place-items-center rounded-[8px] bg-fg text-white ring-1 ring-inset ring-white/10 shadow-soft"
      >
        <svg viewBox="0 0 28 28" className="h-[26px] w-[26px]" fill="none">
          {/* ECG baseline + QRS — the instrument signature */}
          <path
            d="M5 16 H10.5 L12 8.5 L14.4 20.5 L16 13.5 H23"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.92"
          />
          {/* R-wave apex — the diagnostic reading, in brand blue */}
          <circle cx="12" cy="8.5" r="1.7" fill="var(--brand-600)" />
        </svg>
      </span>
      <span className="text-[1.15rem] font-bold leading-none tracking-[-0.03em] text-fg [font-family:var(--font-display)]">
        Acu<span className="text-brand">Dx</span>
      </span>
    </span>
  );
}
