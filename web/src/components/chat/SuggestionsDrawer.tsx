import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, MagnifyingGlass, Stethoscope, ChatCircleText } from "@phosphor-icons/react";

import { cn } from "@/lib/cn";
import type { ExamManeuver, QuestionIntent } from "@/domain/case";

/**
 * SuggestionsDrawer: the question catalogue, demoted from the primary input to
 * a collapsible drawer above the composer (docs/design/05-chat.md section 3.3).
 * A history suggestion sends its natural question through the same send path
 * as typed text; an examination suggestion performs the manoeuvre. A filter
 * narrows both lists; Escape closes the drawer and returns focus to the
 * composer.
 */
type DrawerProps = {
  id: string;
  open: boolean;
  onClose: () => void;
  intents: readonly QuestionIntent[];
  maneuvers: readonly ExamManeuver[];
  intentLabel: (i: QuestionIntent) => string;
  maneuverLabel: (m: ExamManeuver) => string;
  asked: ReadonlySet<string>;
  examined: ReadonlySet<string>;
  onAsk: (intent: QuestionIntent) => void;
  onExam: (m: ExamManeuver) => void;
};

export function SuggestionsDrawer(props: DrawerProps) {
  // The body unmounts when closed, so the filter resets each time it opens.
  if (!props.open) return <div id={props.id} hidden />;
  return <DrawerBody {...props} />;
}

function DrawerBody({
  id,
  onClose,
  intents,
  maneuvers,
  intentLabel,
  maneuverLabel,
  asked,
  examined,
  onAsk,
  onExam,
}: DrawerProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState("");

  const q = filter.trim().toLowerCase();
  const shownIntents = intents.filter((i) => !q || intentLabel(i).toLowerCase().includes(q));
  const shownManeuvers = maneuvers.filter((m) => !q || maneuverLabel(m).toLowerCase().includes(q));

  return (
    <section
      id={id}
      aria-label={t("chat.drawer.title")}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
      className="max-h-[min(20rem,36dvh)] overflow-y-auto overscroll-contain border-t border-border bg-bg-subtle px-3 py-3 sm:px-5"
    >
      <div className="relative mb-3">
        <MagnifyingGlass
          weight="bold"
          className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle"
          aria-hidden
        />
        <label htmlFor={`${id}-filter`} className="sr-only">
          {t("chat.drawer.filter")}
        </label>
        <input
          id={`${id}-filter`}
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t("chat.drawer.filter")}
          className="h-8 w-full rounded-control border border-border bg-surface ps-8 pe-2 text-sm text-fg placeholder:text-subtle focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        />
      </div>

      {shownIntents.length === 0 && shownManeuvers.length === 0 ? (
        <p className="text-sm text-muted">{t("chat.drawer.noMatches")}</p>
      ) : null}

      {shownIntents.length > 0 ? (
        <Group title={t("chat.drawer.history")} icon={<ChatCircleText weight="bold" className="h-3.5 w-3.5" aria-hidden />}>
          {shownIntents.map((i) => (
            <SuggestionButton key={i} label={intentLabel(i)} done={asked.has(i)} onClick={() => onAsk(i)} />
          ))}
        </Group>
      ) : null}

      {shownManeuvers.length > 0 ? (
        <Group
          title={t("chat.drawer.exam")}
          icon={<Stethoscope weight="bold" className="h-3.5 w-3.5" aria-hidden />}
          className="mt-3"
        >
          {shownManeuvers.map((m) => (
            <SuggestionButton key={m} label={maneuverLabel(m)} done={examined.has(m)} onClick={() => onExam(m)} />
          ))}
        </Group>
      ) : null}
    </section>
  );
}

function Group({
  title,
  icon,
  className,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-subtle">
        {icon}
        {title}
      </h3>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function SuggestionButton({ label, done, onClick }: { label: string; done: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={done}
      className={cn(
        "inline-flex min-h-8 items-center gap-1 rounded-control border px-2.5 py-1 text-[0.8125rem]",
        "transition-colors duration-[120ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
        done
          ? "border-transparent bg-brand-tint text-brand"
          : "border-border bg-surface text-fg hover:border-border-strong",
      )}
    >
      {done ? <Check weight="bold" className="h-3 w-3" aria-hidden /> : null}
      {label}
    </button>
  );
}
