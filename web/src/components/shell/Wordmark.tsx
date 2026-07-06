import { cn } from "@/lib/cn";

/**
 * Wordmark — the AcuDx logo: a gradient mark (teal->blue->pink, the ONE
 * place the gradient appears besides the app frame) + grotesk wordmark.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span
        aria-hidden="true"
        className="gradient-mark grid h-7 w-7 place-items-center rounded-[9px] text-white shadow-soft"
      >
        {/* Pulse glyph — clinical, not a generic swoosh */}
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 12h3l2-5 4 10 2-5h5" />
        </svg>
      </span>
      <span className="text-lg font-semibold tracking-tight text-fg">
        Acu<span className="gradient-text">Dx</span>
      </span>
    </span>
  );
}
