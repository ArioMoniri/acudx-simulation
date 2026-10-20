import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import type { TranscriptRole } from "@/data/schema";

export interface ChatMessageProps {
  role: TranscriptRole;
  text: string;
  /** Small affect caption shown under the patient avatar (patient turns only). */
  affect?: string;
}

/**
 * ChatMessage — a single transcript bubble.
 * Doctor (you) is right-aligned in the brand accent; the AI patient is
 * left-aligned on a neutral surface with a small avatar and affect caption.
 */
export function ChatMessage({ role, text, affect }: ChatMessageProps) {
  const { t } = useTranslation();
  const isDoctor = role === "doctor";
  const speaker = isDoctor ? t("encounter.you") : t("encounter.patient");

  return (
    <div
      className={cn(
        "flex w-full items-end gap-2.5",
        isDoctor ? "flex-row-reverse" : "flex-row",
      )}
    >
      {!isDoctor ? (
        <span
          aria-hidden="true"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border bg-bg-subtle text-sm font-semibold text-muted"
        >
          {/* Simple monogram avatar (not a photo) */}
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden>
            <circle cx="12" cy="8" r="3.4" fill="currentColor" opacity="0.65" />
            <path
              d="M5 19c0-3.4 3.1-5.5 7-5.5s7 2.1 7 5.5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              opacity="0.65"
            />
          </svg>
        </span>
      ) : null}

      <div className={cn("flex max-w-[78%] flex-col", isDoctor && "items-end")}>
        <span className="px-1 text-[11px] font-medium text-muted">
          {speaker}
        </span>
        <div
          className={cn(
            "mt-0.5 rounded-card px-3.5 py-2.5 text-sm leading-relaxed",
            isDoctor
              ? "rounded-br-md bg-brand text-on-brand"
              : "rounded-bl-md border border-border bg-surface text-fg",
          )}
        >
          {text}
        </div>
        {!isDoctor && affect ? (
          <span className="mt-1 px-1 text-[11px] italic text-muted">
            {affect}
          </span>
        ) : null}
      </div>
    </div>
  );
}
