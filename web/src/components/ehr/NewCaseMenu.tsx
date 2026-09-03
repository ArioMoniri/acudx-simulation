import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Shuffle, Sparkle, CaretDown, Sliders, Stack } from "@phosphor-icons/react";

import { Button } from "@/components/ui";
import { seedCases } from "@/data/seedCases";
import type { ChiefComplaintFamily } from "@/domain/caseGen";
import type { CaseInstance } from "@/domain/case";
import type { Lang } from "@/data/mock";
import { pick } from "./labels";

export interface NewCaseMenuProps {
  lang: Lang;
  /** Generate a fresh random case. */
  onRandom: () => void;
  /** Generate a constrained case (chief complaint + difficulty). */
  onConstrained: (
    chiefComplaint: ChiefComplaintFamily,
    difficulty: 1 | 2 | 3 | 4 | 5,
  ) => void;
  /** Load one of the curated seed cases by id. */
  onLoadSeed: (id: string) => void;
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
 * Offers a fully random case (default), a constrained case (chief complaint +
 * difficulty 1-5), and the curated seed cases. Built as a lightweight,
 * keyboard-accessible popover (Escape to close, click-outside to dismiss) so no
 * extra dependency is needed.
 */
export function NewCaseMenu({
  lang,
  onRandom,
  onConstrained,
  onLoadSeed,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        <CaretDown weight="bold" className="ml-0.5 h-3.5 w-3.5" aria-hidden />
      </Button>

      {open ? (
        <div
          id={panelId}
          role="menu"
          aria-label={t("ehr.newCase.menuLabel")}
          className="absolute right-0 z-40 mt-2 w-72 origin-top-right rounded-card border border-border bg-surface p-3 shadow-soft-md motion-safe:animate-[fade-up_0.16s_ease-out]"
        >
          {/* Random */}
          <button
            ref={firstItemRef}
            type="button"
            role="menuitem"
            onClick={() => {
              onRandom();
              close();
            }}
            className="flex w-full items-center gap-2 rounded-control px-2.5 py-2 text-left text-sm text-fg hover:bg-bg-subtle focus-visible:outline-none"
          >
            <Shuffle weight="bold" className="h-4 w-4 text-brand" aria-hidden />
            <span>
              <span className="block font-medium">{t("ehr.newCase.random")}</span>
              <span className="block text-xs text-muted">
                {t("ehr.newCase.randomHint")}
              </span>
            </span>
          </button>

          {/* Constrained */}
          <div className="mt-2 rounded-control border border-border p-2.5">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
              <Sliders weight="bold" className="h-3.5 w-3.5" aria-hidden />
              {t("ehr.newCase.constrained")}
            </p>

            <label htmlFor={`${panelId}-cc`} className="mt-2 block text-xs font-medium text-fg">
              {t("ehr.newCase.chiefComplaint")}
            </label>
            <select
              id={`${panelId}-cc`}
              value={complaint}
              onChange={(e) => setComplaint(e.target.value as ChiefComplaintFamily)}
              className="mt-1 w-full rounded-control border border-border bg-surface px-2.5 py-1.5 text-sm text-fg focus-visible:outline-none"
            >
              {CHIEF_COMPLAINTS.map((c) => (
                <option key={c} value={c}>
                  {t(`ehr.chiefComplaint.${camel(c)}`)}
                </option>
              ))}
            </select>

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

          {/* Seed cases */}
          <div className="mt-2 border-t border-border pt-2">
            <p className="flex items-center gap-1.5 px-2.5 text-xs font-semibold uppercase tracking-wide text-muted">
              <Stack weight="bold" className="h-3.5 w-3.5" aria-hidden />
              {t("ehr.newCase.seedHeading")}
            </p>
            <ul className="mt-1 max-h-40 overflow-y-auto">
              {seedCases.map((c: CaseInstance) => (
                <li key={c.id}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onLoadSeed(c.id);
                      close();
                    }}
                    className="w-full truncate rounded-control px-2.5 py-1.5 text-left text-sm text-fg hover:bg-bg-subtle focus-visible:outline-none"
                  >
                    {pick(c.chiefComplaint, lang)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
