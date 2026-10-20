import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Sparkle, CaretDown, Sliders } from "@phosphor-icons/react";

import { Button, SectionLabel, Select } from "@/components/ui";
import type { ChiefComplaintFamily } from "@/domain/caseGen";
import type { Lang } from "@/data/schema";

export interface NewCaseMenuProps {
  /** Kept for callers; the menu labels come from i18n. */
  lang?: Lang;
  /** Generate a fresh random case. */
  onRandom: () => void;
  /** Generate a constrained case (chief complaint + difficulty). */
  onConstrained: (
    chiefComplaint: ChiefComplaintFamily,
    difficulty: 1 | 2 | 3 | 4 | 5,
  ) => void;
}

const CHIEF_COMPLAINTS: ChiefComplaintFamily[] = [
  "chest-pain",
  "headache",
  "abdominal-pain",
  "dyspnea",
];

function camel(s: string): string {
  return s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * NewCaseMenu — the case-generation control in the workspace toolbar (docs §3).
 * Offers a fresh case (default) and a constrained request (chief complaint +
 * difficulty 1-5). Both are generated on request by the model; there is no
 * curated, seed or published list to start from (owner decision). Built as a lightweight,
 * keyboard-accessible popover (Escape to close, click-outside to dismiss) so no
 * extra dependency is needed.
 */
export function NewCaseMenu({
  onRandom,
  onConstrained,
}: NewCaseMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [complaint, setComplaint] = useState<ChiefComplaintFamily>("chest-pain");
  const [difficulty, setDifficulty] = useState<1 | 2 | 3 | 4 | 5>(3);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  // Close and return focus to the trigger (used for Escape + item selection so
  // keyboard users are never dropped at the top of the document).
  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  // Dismiss on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false); // outside click: leave focus where the pointer landed
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
    // `close` is stable enough for this handler; open toggling re-binds it.
  }, [open]);

  // Move focus into the menu when it opens so the popover is keyboard-usable.
  useEffect(() => {
    if (open) firstItemRef.current?.focus();
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <Button
        ref={triggerRef}
        variant="secondary"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={panelId}
        leadingIcon={<Sparkle weight="bold" className="h-4 w-4" />}
      >
        {t("ehr.newCase.button")}
        <CaretDown weight="bold" className="ms-0.5 h-3.5 w-3.5" aria-hidden />
      </Button>

      {open ? (
        <div
          id={panelId}
          role="menu"
          aria-label={t("ehr.newCase.menuLabel")}
          className="absolute right-0 z-40 mt-2 w-72 origin-top-right rounded-card border border-border bg-surface p-3 shadow-soft-md motion-safe:animate-[fade-up_0.16s_ease-out]"
        >
          {/* Primary: endless, fresh, non-repeating case (the default action) */}
          <button
            ref={firstItemRef}
            type="button"
            role="menuitem"
            onClick={() => {
              onRandom();
              close();
            }}
            className="flex w-full items-center gap-2.5 rounded-control bg-brand px-3 py-2.5 text-start text-sm font-semibold text-on-brand transition-colors hover:bg-brand-hover focus-visible:outline-none"
          >
            <Sparkle weight="fill" className="h-5 w-5 shrink-0" aria-hidden />
            <span className="min-w-0">
              <span className="block">{t("livegen.endless")}</span>
              <span className="block text-xs font-normal text-white/80">
                {t("livegen.endlessHint")}
              </span>
            </span>
          </button>

          {/* Secondary: constrain the draw */}
          <div className="mt-2.5 rounded-control border border-border p-2.5">
            <SectionLabel icon={<Sliders weight="bold" className="h-3.5 w-3.5" aria-hidden />}>
              {t("ehr.newCase.constrained")}
            </SectionLabel>

            <label htmlFor={`${panelId}-cc`} className="mt-2 block text-xs font-medium text-fg">
              {t("ehr.newCase.chiefComplaint")}
            </label>
            <div className="mt-1">
              <Select
                id={`${panelId}-cc`}
                value={complaint}
                onChange={(e) => setComplaint(e.target.value as ChiefComplaintFamily)}
              >
                {CHIEF_COMPLAINTS.map((c) => (
                  <option key={c} value={c}>
                    {t(`ehr.chiefComplaint.${camel(c)}`)}
                  </option>
                ))}
              </Select>
            </div>

            <label htmlFor={`${panelId}-diff`} className="mt-2 block text-xs font-medium text-fg">
              {t("ehr.newCase.difficulty")}: {difficulty}
            </label>
            <input
              id={`${panelId}-diff`}
              type="range"
              min={1}
              max={5}
              step={1}
              value={difficulty}
              onChange={(e) => setDifficulty(Number(e.target.value) as 1 | 2 | 3 | 4 | 5)}
              className="mt-1 w-full accent-[color:var(--brand-600)]"
              aria-valuetext={t("ehr.newCase.difficultyLevel", { level: difficulty })}
            />
            <div className="mt-1 flex justify-between text-[10px] text-muted">
              <span>{t("ehr.newCase.diffMin")}</span>
              <span>{t("ehr.newCase.diffMax")}</span>
            </div>

            <Button
              size="sm"
              fullWidth
              className="mt-2.5"
              onClick={() => {
                onConstrained(complaint, difficulty);
                close();
              }}
            >
              {t("ehr.newCase.generate")}
            </Button>
          </div>

        </div>
      ) : null}
    </div>
  );
}
