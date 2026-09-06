import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Translate, CaretDown, Check } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import {
  SUPPORTED_LANGUAGES,
  LANGUAGE_META,
  normalizeLanguage,
  applyDocumentLanguage,
  type Language,
} from "@/i18n";

/**
 * LanguageSwitcher — an accessible language menu listing every supported
 * language by its native name. Implemented as a button + listbox popover:
 *
 *  - listbox semantics (`role="listbox"` / `role="option"`, `aria-selected`)
 *  - roving focus via `aria-activedescendant`; Arrow/Home/End/Enter/Esc keys
 *  - scrollable so the growing set stays compact in the nav
 *  - applies `<html lang/dir>` on change (RTL languages such as Arabic flip
 *    the document), so the switch is the single place layout direction moves.
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { i18n, t } = useTranslation();
  const current = normalizeLanguage(i18n.resolvedLanguage);

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(0, SUPPORTED_LANGUAGES.indexOf(current)),
  );

  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const optionId = (index: number) => `${baseId}-opt-${index}`;

  // Close on outside pointer / focus leaving the widget.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // When opening, sync the active option to the current language and focus the
  // listbox so keyboard navigation begins immediately.
  useEffect(() => {
    if (!open) return;
    setActiveIndex(Math.max(0, SUPPORTED_LANGUAGES.indexOf(current)));
    const raf = requestAnimationFrame(() => listRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open, current]);

  function selectLanguage(lng: Language) {
    void i18n.changeLanguage(lng);
    // `applyDocumentLanguage` is also wired to i18next's `languageChanged`; call
    // it here too so lang/dir flip synchronously with the click.
    applyDocumentLanguage(lng);
    setOpen(false);
    buttonRef.current?.focus();
  }

  function moveActive(next: number) {
    const count = SUPPORTED_LANGUAGES.length;
    const clamped = (next + count) % count;
    setActiveIndex(clamped);
    // Keep the focused option scrolled into view within the popover.
    requestAnimationFrame(() =>
      document
        .getElementById(optionId(clamped))
        ?.scrollIntoView({ block: "nearest" }),
    );
  }

  function onListKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveActive(activeIndex + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveActive(activeIndex - 1);
        break;
      case "Home":
        event.preventDefault();
        moveActive(0);
        break;
      case "End":
        event.preventDefault();
        moveActive(SUPPORTED_LANGUAGES.length - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        selectLanguage(SUPPORTED_LANGUAGES[activeIndex]);
        break;
      case "Escape":
        event.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
        break;
      case "Tab":
        setOpen(false);
        break;
      default:
        break;
    }
  }

  function onButtonKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!open && (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      setOpen(true);
    }
  }

  const currentMeta = LANGUAGE_META[current];

  return (
    <div ref={rootRef} className={cn("relative inline-flex", className)}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onButtonKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-label={t("language.label")}
        title={t("language.label")}
        className={cn(
          "inline-flex min-h-8 items-center gap-1.5 rounded-control border border-border bg-bg-subtle px-2.5",
          "text-xs font-semibold text-fg",
          "transition-colors duration-200 ease-out focus-visible:outline-none",
          "hover:bg-surface",
        )}
      >
        <Translate weight="bold" className="h-4 w-4 text-muted" aria-hidden="true" />
        <span>{currentMeta.nativeName}</span>
        <CaretDown
          weight="bold"
          aria-hidden="true"
          className={cn(
            "h-3 w-3 text-muted transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          tabIndex={-1}
          aria-label={t("language.label")}
          aria-activedescendant={optionId(activeIndex)}
          onKeyDown={onListKeyDown}
          className={cn(
            "absolute end-0 top-[calc(100%+6px)] z-50 max-h-72 w-52 overflow-y-auto",
            "rounded-control border border-border bg-surface p-1 shadow-soft",
            "focus-visible:outline-none",
          )}
        >
          {SUPPORTED_LANGUAGES.map((lng, index) => {
            const meta = LANGUAGE_META[lng];
            const selected = lng === current;
            const active = index === activeIndex;
            return (
              <li
                key={lng}
                id={optionId(index)}
                role="option"
                aria-selected={selected}
                lang={lng}
                dir={meta.dir}
                onClick={() => selectLanguage(lng)}
                onMouseEnter={() => setActiveIndex(index)}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-chip px-2.5 py-1.5",
                  "text-sm transition-colors duration-150",
                  active ? "bg-bg-subtle text-fg" : "text-fg/90",
                )}
              >
                <Check
                  weight="bold"
                  aria-hidden="true"
                  className={cn(
                    "h-4 w-4 shrink-0 text-brand",
                    selected ? "opacity-100" : "opacity-0",
                  )}
                />
                <span className="flex-1 truncate font-medium">{meta.nativeName}</span>
                <span className="shrink-0 eyebrow">
                  {lng}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
