/**
 * AcuDx — CommandPalette: a ⌘K / Ctrl-K launcher for the encounter workspace.
 *
 * Presentation-only. The owner (EncounterPage) supplies a flat `commands` list;
 * the palette handles search, grouping, keyboard navigation, and running the
 * chosen command. Every command's side effect lives in its `run` closure — the
 * palette knows nothing about tabs, cases, or the store.
 *
 * Accessible modal (role="dialog" + aria-modal), focus trap, Escape to close,
 * scroll lock, and focus restored to the trigger on close — mirroring the
 * PatientViewer pattern. Type to filter (label + keywords), ↑/↓ to move the
 * highlight, Enter to run + close.
 *
 * Education only. Synthetic content — no real patient data path.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MagnifyingGlass } from "@phosphor-icons/react";

import { cn } from "@/lib/cn";

export interface Command {
  id: string;
  label: string;
  /** Short trailing hint, e.g. a shortcut digit. */
  hint?: string;
  /** Localized group heading; commands with the same section render together. */
  section?: string;
  /** Extra match text (not shown) so a command surfaces under related terms. */
  keywords?: string;
  run: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commands: Command[];
}

/** Groups preserving first-seen section order, each item carrying its flat index. */
interface CommandGroup {
  section: string;
  items: { cmd: Command; index: number }[];
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableWithin(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

export function CommandPalette({ open, onClose, commands }: CommandPaletteProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const listId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const activeItemRef = useRef<HTMLButtonElement | null>(null);

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  // The filtered, flat command list. Highlight + Enter operate on this order.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => {
      const hay = `${c.label} ${c.keywords ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [commands, query]);

  // Grouped view for rendering; each item remembers its index within `filtered`.
  const groups = useMemo(() => {
    const order = new Map<string, CommandGroup>();
    filtered.forEach((cmd, index) => {
      const section = cmd.section ?? "";
      let group = order.get(section);
      if (!group) {
        group = { section, items: [] };
        order.set(section, group);
      }
      group.items.push({ cmd, index });
    });
    return Array.from(order.values());
  }, [filtered]);

  // Reset search + highlight each time the palette opens.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
    }
  }, [open]);

  // Keep the highlight in range as the filter narrows the list.
  useEffect(() => {
    setActiveIndex((i) => {
      if (filtered.length === 0) return 0;
      return Math.min(i, filtered.length - 1);
    });
  }, [filtered.length]);

  // Scroll the highlighted row into view when navigating with the keyboard.
  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, filtered.length]);

  // Focus trap + Escape + scroll lock; restore focus to the opener on close.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;

    const focusId = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 0);

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const focusables = focusableWithin(panel);
      if (focusables.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKey, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prevOverflow;
      window.clearTimeout(focusId);
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  function runAt(index: number) {
    const cmd = filtered[index];
    if (!cmd) return;
    cmd.run();
    onClose();
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (filtered.length ? (i + 1) % filtered.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) =>
        filtered.length ? (i - 1 + filtered.length) % filtered.length : 0,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      runAt(activeIndex);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIndex(Math.max(0, filtered.length - 1));
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        className="absolute inset-0 bg-black/50 motion-safe:animate-[fade-up_0.15s_ease-out]"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          "relative flex max-h-[70dvh] w-full max-w-xl flex-col overflow-hidden",
          "rounded-card border border-border bg-surface shadow-soft-md",
          "focus-visible:outline-none motion-safe:animate-[fade-up_0.2s_ease-out]",
        )}
      >
        <h2 id={titleId} className="sr-only">
          {t("commandPalette.title", { defaultValue: "Command palette" })}
        </h2>

        {/* Search */}
        <div className="flex items-center gap-2 border-b border-border px-3.5">
          <MagnifyingGlass
            weight="bold"
            className="h-4 w-4 shrink-0 text-muted"
            aria-hidden
          />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={t("commandPalette.placeholder", {
              defaultValue: "Search commands…",
            })}
            className="h-12 w-full border-0 bg-transparent text-sm text-fg placeholder:text-muted focus:outline-none"
          />
        </div>

        {/* Results */}
        <div
          id={listId}
          role="listbox"
          aria-label={t("commandPalette.title", { defaultValue: "Command palette" })}
          className="flex-1 overflow-y-auto p-1.5"
        >
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted">
              {t("commandPalette.empty", { defaultValue: "No commands found." })}
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.section || "_"} className="mb-1 last:mb-0">
                {group.section ? (
                  <p className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                    {group.section}
                  </p>
                ) : null}
                <ul className="flex flex-col gap-0.5">
                  {group.items.map(({ cmd, index }) => {
                    const isActive = index === activeIndex;
                    return (
                      <li key={cmd.id}>
                        <button
                          ref={isActive ? activeItemRef : undefined}
                          type="button"
                          role="option"
                          aria-selected={isActive}
                          onClick={() => runAt(index)}
                          onMouseMove={() => setActiveIndex(index)}
                          className={cn(
                            "flex w-full items-center justify-between gap-3 rounded-control px-2.5 py-2 text-start text-sm transition-colors",
                            isActive
                              ? "bg-brand-tint text-fg"
                              : "text-fg hover:bg-bg-subtle",
                          )}
                        >
                          <span className="min-w-0 truncate">{cmd.label}</span>
                          {cmd.hint ? (
                            <kbd
                              className={cn(
                                "shrink-0 rounded-control border border-border px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums",
                                isActive ? "text-brand" : "text-muted",
                              )}
                            >
                              {cmd.hint}
                            </kbd>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
