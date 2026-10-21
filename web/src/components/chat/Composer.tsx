import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowUp,
  ArrowSquareOut,
  Flask,
  ListBullets,
  Microphone,
  Phone,
  PhoneCall,
  Stethoscope,
  ChatCircleDots,
  type Icon,
} from "@phosphor-icons/react";

import { cn } from "@/lib/cn";
import {
  matchManeuvers,
  matchTargets,
  parseSlash,
  searchOrderables,
  type NavigateTarget,
  type SlashCommandName,
} from "@/lib/chatActions";
import type { Orderable } from "@/domain/orderables";
import type { ExamManeuver } from "@/domain/case";

/** One row of the slash menu. */
type SlashItem =
  | { kind: "command"; id: string; command: SlashCommandName; label: string; hint: string }
  | { kind: "order"; id: string; orderable: Orderable; label: string; hint: string }
  | { kind: "exam"; id: string; maneuver: ExamManeuver; label: string; hint: string }
  | { kind: "go"; id: string; target: NavigateTarget; label: string; hint: string };

const COMMAND_ICON: Record<SlashCommandName, Icon> = {
  order: Flask,
  exam: Stethoscope,
  go: ArrowSquareOut,
  ask: ChatCircleDots,
};

export interface ComposerProps {
  value: string;
  onChange: (v: string) => void;
  /** Send free text (the one send path for typed and suggested questions). */
  onSend: (text: string) => void;
  /** A reply is in flight: Enter waits instead of sending. */
  busy: boolean;
  lang: "en" | "tr";
  maneuvers: readonly ExamManeuver[];
  maneuverLabel: (m: ExamManeuver) => string;
  onSlashOrder: (o: Orderable) => void;
  onSlashExam: (m: ExamManeuver) => void;
  /** Absent when the pane cannot navigate (the /go command is then hidden). */
  onSlashGo?: (target: NavigateTarget) => void;
  suggestionsOpen: boolean;
  suggestionsId: string;
  onToggleSuggestions: (open?: boolean) => void;
  mic?: { supported: boolean; listening: boolean; onToggle: () => void };
  call: { on: boolean; onToggle: () => void };
}

/**
 * Composer: free text first (docs/design/05-chat.md section 3.2). A growing
 * textarea that keeps the placeholder the e2e suites and capture scripts use;
 * Enter sends, Shift+Enter breaks the line, "/" opens the command menu
 * (/order, /exam, /go, /ask) as an ARIA combobox listbox driven by the arrow
 * keys, Enter or Tab, and Escape. The toolbar carries the suggestions drawer
 * toggle, dictation, the voice-call entry point and Send.
 */
export function Composer({
  value,
  onChange,
  onSend,
  busy,
  lang,
  maneuvers,
  maneuverLabel,
  onSlashOrder,
  onSlashExam,
  onSlashGo,
  suggestionsOpen,
  suggestionsId,
  onToggleSuggestions,
  mic,
  call,
}: ComposerProps) {
  const { t } = useTranslation();
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const hintId = useId();
  const [active, setActive] = useState(0);
  const [menuDismissed, setMenuDismissed] = useState(false);

  const slash = parseSlash(value);
  const items = useMemo<SlashItem[]>(() => {
    if (!slash) return [];
    const available = (c: SlashCommandName) => c !== "go" || Boolean(onSlashGo);
    if (!slash.hasArg || !slash.command) {
      return slash.candidates.filter(available).map((c) => ({
        kind: "command" as const,
        id: `cmd-${c}`,
        command: c,
        label: `/${c}`,
        hint: t(`chat.slash.${c}`),
      }));
    }
    switch (slash.command) {
      case "order":
        return searchOrderables(slash.arg).map((o) => ({
          kind: "order" as const,
          id: `order-${o.code}`,
          orderable: o,
          label: lang === "tr" ? o.label.tr : o.label.en,
          hint: o.panel ?? o.category,
        }));
      case "exam":
        return matchManeuvers(slash.arg, maneuvers, maneuverLabel).map((m) => ({
          kind: "exam" as const,
          id: `exam-${m}`,
          maneuver: m,
          label: maneuverLabel(m),
          hint: t("chat.slash.exam"),
        }));
      case "go":
        if (!onSlashGo) return [];
        return matchTargets(slash.arg, (x) => t(`chat.targets.${x}`)).map((x) => ({
          kind: "go" as const,
          id: `go-${x}`,
          target: x,
          label: t(`chat.targets.${x}`),
          hint: t("chat.slash.go"),
        }));
      case "ask":
        return [
          {
            kind: "command" as const,
            id: "cmd-ask",
            command: "ask" as const,
            label: "/ask",
            hint: t("chat.slash.ask"),
          },
        ];
    }
  }, [slash, lang, maneuvers, maneuverLabel, onSlashGo, t]);

  const menuOpen = Boolean(slash) && !menuDismissed;
  const activeIndex = items.length ? Math.min(active, items.length - 1) : -1;

  // A new draft re-opens a dismissed menu and resets the highlighted row.
  function change(v: string) {
    setActive(0);
    if (!v.startsWith("/")) setMenuDismissed(false);
    onChange(v);
  }

  // Grow with the text up to six lines.
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  function choose(item: SlashItem) {
    switch (item.kind) {
      case "command":
        if (item.command === "ask") {
          change("");
          onToggleSuggestions(true);
        } else {
          change(`/${item.command} `);
        }
        break;
      case "order":
        change("");
        onSlashOrder(item.orderable);
        break;
      case "exam":
        change("");
        onSlashExam(item.maneuver);
        break;
      case "go":
        change("");
        onSlashGo?.(item.target);
        break;
    }
    areaRef.current?.focus();
  }

  function submit() {
    const text = value.trim();
    if (!text || busy) return;
    if (slash) {
      if (activeIndex >= 0) choose(items[activeIndex]);
      return;
    }
    onSend(text);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (menuOpen && items.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => (i + 1) % items.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => (i - 1 + items.length) % items.length);
        return;
      }
      if (e.key === "Tab" && activeIndex >= 0) {
        e.preventDefault();
        choose(items[activeIndex]);
        return;
      }
    }
    if (e.key === "Escape" && menuOpen) {
      e.preventDefault();
      e.stopPropagation();
      setMenuDismissed(true);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  const activeId = menuOpen && activeIndex >= 0 ? `${listId}-${items[activeIndex].id}` : undefined;
  const canSend = value.trim().length > 0 && !busy && !slash;

  return (
    <div className="relative">
      {menuOpen ? (
        <div className="absolute inset-x-0 bottom-full z-20 mb-1.5 overflow-hidden rounded-control border border-border-strong bg-surface shadow-[var(--shadow-pop)]">
          <p className="border-b border-border px-3 py-1.5 text-[11px] font-medium text-subtle">{t("chat.slash.menuLabel")}</p>
          <ul id={listId} role="listbox" aria-label={t("chat.slash.menuLabel")} className="max-h-60 overflow-y-auto py-1">
            {items.length === 0 ? (
              <li role="presentation" className="px-3 py-2 text-sm text-muted">
                {t("chat.slash.noMatches")}
              </li>
            ) : (
              items.map((item, i) => {
                const ItemIcon =
                  item.kind === "command"
                    ? COMMAND_ICON[item.command]
                    : item.kind === "order"
                      ? Flask
                      : item.kind === "exam"
                        ? Stethoscope
                        : ArrowSquareOut;
                return (
                  <li
                    key={item.id}
                    id={`${listId}-${item.id}`}
                    role="option"
                    aria-selected={i === activeIndex}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(item)}
                    onMouseEnter={() => setActive(i)}
                    className={cn(
                      "flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm",
                      i === activeIndex ? "bg-brand-tint text-fg" : "text-fg",
                    )}
                  >
                    <ItemIcon weight="bold" className="h-4 w-4 shrink-0 text-subtle" aria-hidden />
                    <span className={cn("min-w-0 truncate", item.kind === "command" && "font-mono text-[0.8125rem]")}>
                      {item.label}
                    </span>
                    <span className="ms-auto shrink-0 truncate text-xs text-subtle">{item.hint}</span>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}

      <div className="rounded-control border border-border-strong bg-surface focus-within:border-brand focus-within:ring-1 focus-within:ring-brand">
        <label htmlFor="acudx-ask" className="sr-only">
          {t("scopeGuard.composer.label")}
        </label>
        <textarea
          ref={areaRef}
          id="acudx-ask"
          rows={1}
          value={value}
          onChange={(e) => change(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t("scopeGuard.composer.placeholder")}
          autoComplete="off"
          spellCheck
          role="combobox"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-describedby={hintId}
          className="block max-h-40 min-h-[2.75rem] w-full resize-none bg-transparent px-3 pb-1 pt-2.5 text-sm leading-relaxed text-fg placeholder:text-subtle focus:outline-none"
        />
        <div className="flex items-center gap-1 px-1.5 pb-1.5">
          <ToolButton
            label={t("chat.composer.suggestions")}
            pressed={suggestionsOpen}
            expanded={suggestionsOpen}
            controls={suggestionsId}
            onClick={() => onToggleSuggestions()}
            icon={<ListBullets weight="bold" className="h-4 w-4" aria-hidden />}
            showLabel
          />
          <span className="ms-auto" />
          {mic?.supported ? (
            <ToolButton
              label={
                mic.listening
                  ? t("ehr.interview.voiceInput.stop", { defaultValue: "Stop dictation" })
                  : t("ehr.interview.voiceInput.mic", { defaultValue: "Dictate" })
              }
              pressed={mic.listening}
              onClick={mic.onToggle}
              icon={<Microphone weight="bold" className="h-4 w-4" aria-hidden />}
              dot={mic.listening}
            />
          ) : null}
          <ToolButton
            label={call.on ? t("chat.composer.callOn") : t("chat.composer.callOff")}
            pressed={call.on}
            onClick={call.onToggle}
            icon={
              call.on ? (
                <PhoneCall weight="fill" className="h-4 w-4" aria-hidden />
              ) : (
                <Phone weight="bold" className="h-4 w-4" aria-hidden />
              )
            }
          />
          <button
            type="button"
            onClick={submit}
            disabled={!canSend}
            aria-label={t("scopeGuard.composer.send")}
            title={t("scopeGuard.composer.send")}
            className="grid h-8 w-8 place-items-center rounded-control bg-brand text-on-brand transition-colors duration-[120ms] hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 disabled:bg-bg-inset disabled:text-subtle"
          >
            <ArrowUp weight="bold" className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
      <p id={hintId} className="mt-1.5 px-0.5 text-[11px] text-subtle">
        {mic?.listening ? (
          <span className="text-brand">{t("ehr.interview.voiceInput.listening", { defaultValue: "Listening" })}</span>
        ) : (
          t("chat.composer.hint")
        )}
      </p>
    </div>
  );
}

function ToolButton({
  label,
  pressed,
  expanded,
  controls,
  onClick,
  icon,
  showLabel,
  dot,
}: {
  label: string;
  pressed?: boolean;
  expanded?: boolean;
  controls?: string;
  onClick: () => void;
  icon: React.ReactNode;
  showLabel?: boolean;
  dot?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={expanded === undefined ? pressed : undefined}
      aria-expanded={expanded}
      aria-controls={controls}
      aria-label={showLabel ? undefined : label}
      title={label}
      className={cn(
        "relative inline-flex h-8 items-center gap-1.5 rounded-control text-[0.8125rem] font-medium transition-colors duration-[120ms]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
        showLabel ? "px-2" : "w-8 justify-center",
        pressed ? "bg-brand-tint text-brand" : "text-muted hover:bg-bg-inset hover:text-fg",
      )}
    >
      {icon}
      {showLabel ? <span>{label}</span> : null}
      {dot ? <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-brand motion-safe:animate-pulse" aria-hidden /> : null}
    </button>
  );
}
