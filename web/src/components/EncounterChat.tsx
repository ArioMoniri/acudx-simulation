import { useTranslation } from "react-i18next";
import { ChatMessage } from "./ChatMessage";
import { cn } from "@/lib/cn";
import type { TranscriptTurn, Lang } from "@/data/mock";

export interface EncounterChatProps {
  turns: TranscriptTurn[];
  lang: Lang;
  /** Show the patient typing indicator at the bottom. */
  patientTyping?: boolean;
  /** Affect caption keyed per patient turn id (falls back to a default). */
  affectByTurn?: Record<string, string>;
  className?: string;
}

/** EncounterChat — the scrollable transcript column of the encounter. */
export function EncounterChat({
  turns,
  lang,
  patientTyping = false,
  affectByTurn,
  className,
}: EncounterChatProps) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        "flex flex-col gap-4 overflow-y-auto px-1 py-2",
        className,
      )}
      role="log"
      aria-live="polite"
      aria-label={t("encounter.transcriptLabel")}
    >
      {turns.map((turn) => (
        <ChatMessage
          key={turn.id}
          role={turn.role}
          text={turn[lang]}
          affect={
            turn.role === "patient"
              ? affectByTurn?.[turn.id] ?? t("encounter.affect.distress")
              : undefined
          }
        />
      ))}

      {patientTyping ? (
        <div className="flex items-end gap-2.5" aria-live="polite">
          <span
            aria-hidden="true"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border bg-bg-subtle text-muted"
          >
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
          <div className="rounded-card rounded-bl-md border border-border bg-surface px-3.5 py-3">
            <span className="sr-only">{t("encounter.aiTyping")}</span>
            <span className="flex items-center gap-1" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-1.5 w-1.5 rounded-full bg-muted/60 motion-safe:animate-[fade-up_1s_ease-in-out_infinite]"
                  style={{ animationDelay: `${i * 160}ms` }}
                />
              ))}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
