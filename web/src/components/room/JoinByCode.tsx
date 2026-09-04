import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Keyhole, ArrowRight, Warning } from "@phosphor-icons/react";

import { Button, Card, TextInput } from "@/components/ui";
import { cn } from "@/lib/cn";

export interface JoinByCodeProps {
  /** Resolve + join a room by code. Returns true on success, false if unknown. */
  onJoin: (code: string) => boolean;
}

/**
 * JoinByCode — the join half of the lobby (Screen 6.1). A teammate shares the
 * room's invite code; entering it takes an open seat and drops the learner into
 * the room. The field is fully labelled, the failure state is announced through
 * an aria-live region, and the control is keyboard operable end to end.
 */
export function JoinByCode({ onJoin }: JoinByCodeProps) {
  const { t } = useTranslation();
  const inputId = useId();
  const errorId = useId();
  const [code, setCode] = useState("");
  const [error, setError] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;
    const ok = onJoin(trimmed);
    setError(!ok);
  }

  return (
    <Card padding="md" className="flex flex-col gap-3">
      <div className="flex items-start gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-control bg-brand-tint text-brand">
          <Keyhole weight="bold" className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-fg">{t("rooms.join.title")}</h2>
          <p className="mt-0.5 text-xs text-muted">{t("rooms.join.subtitle")}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="flex-1">
          <label htmlFor={inputId} className="sr-only">
            {t("rooms.join.label")}
          </label>
          <TextInput
            id={inputId}
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              if (error) setError(false);
            }}
            placeholder={t("rooms.join.placeholder")}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-invalid={error || undefined}
            aria-describedby={error ? errorId : undefined}
            className={cn(
              "h-11 font-mono uppercase tracking-wide",
              "placeholder:font-sans placeholder:normal-case placeholder:tracking-normal",
            )}
          />
        </div>
        <Button
          type="submit"
          disabled={!code.trim()}
          trailingIcon={<ArrowRight weight="bold" className="h-3.5 w-3.5" />}
        >
          {t("rooms.join.action")}
        </Button>
      </form>

      <p id={errorId} role="status" aria-live="polite" className="min-h-0">
        {error ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[color:var(--state-warning)]">
            <Warning weight="fill" className="h-3.5 w-3.5" aria-hidden />
            {t("rooms.join.notFound")}
          </span>
        ) : null}
      </p>
    </Card>
  );
}
