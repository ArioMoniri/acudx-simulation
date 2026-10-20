import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X, Plus, Users, Robot } from "@phosphor-icons/react";

import { Button, Switch, Field, Select } from "@/components/ui";
import { cn } from "@/lib/cn";
import { ROLE_ICON } from "./roleMeta";
import { CLINICAL_ROLE_ORDER, type ClinicalRole, type RoomLocale } from "@/data/rooms";
import { COMPLAINT_LABELS } from "@/data/caseLibrary";
import type { Lang } from "@/data/schema";
import { CHIEF_COMPLAINT_FAMILIES, type ChiefComplaintFamily } from "@/domain/caseGen";

export interface CreateRoomDialogProps {
  open: boolean;
  onClose: () => void;
  lang: Lang;
  /** Called with the presentation the room's case is requested for (or none for any),
   *  which roles are human seats (rest AI), the AI-backfill toggle and the shared
   *  encounter language. The case is generated on request by the model; resolves to
   *  an error code when that failed (the dialog shows it and stays open). */
  onCreate: (config: {
    family: ChiefComplaintFamily | null;
    humanRoles: ClinicalRole[];
    aiBackfill: boolean;
    locale: RoomLocale;
  }) => Promise<string | null> | void;
}

/**
 * CreateRoomDialog — Create Room flow (Screen 6.1). Pick a presentation (the room's
 * case is generated on request by the model, never picked from a list), choose which
 * of Doctor / Nurse / Paramedic are HUMAN seats vs AI-backfilled, and toggle
 * AI backfill for the rest. Focus is trapped to the panel, Escape closes, and
 * every control is labelled. Fully keyboard operable.
 */
export function CreateRoomDialog({
  open,
  onClose,
  lang,
  onCreate,
}: CreateRoomDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);

  const [family, setFamily] = useState<ChiefComplaintFamily | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The learner always holds Doctor by default; the rest start AI-backfilled.
  const [humanRoles, setHumanRoles] = useState<ClinicalRole[]>(["doctor"]);
  const [aiBackfill, setAiBackfill] = useState(true);
  const [locale, setLocale] = useState<RoomLocale>(lang);

  // Reset the form each time the dialog opens.
  useEffect(() => {
    if (open) {
      setFamily(null);
      setBusy(false);
      setError(null);
      setHumanRoles(["doctor"]);
      setAiBackfill(true);
      setLocale(lang);
    }
  }, [open, lang]);

  // Escape to close; move focus into the panel on open.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const id = window.setTimeout(() => panelRef.current?.focus(), 0);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(id);
    };
  }, [open, onClose]);

  if (!open) return null;

  function toggleRole(role: ClinicalRole) {
    setHumanRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );
  }

  async function submit() {
    setBusy(true);
    setError(null);
    const failed = await onCreate({ family, humanRoles, aiBackfill, locale });
    setBusy(false);
    if (failed) setError(failed);
  }

  const locales: RoomLocale[] = ["tr", "en"];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        className="absolute inset-0 bg-black/40 motion-safe:animate-[fade-up_0.2s_ease-out]"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          "relative flex max-h-[90dvh] w-full max-w-lg flex-col overflow-y-auto",
          "rounded-t-card border border-border bg-surface p-5 shadow-soft-md sm:rounded-card sm:p-6",
          "focus-visible:outline-none",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id={titleId} className="text-lg font-semibold tracking-tight text-fg">
              {t("rooms.create.title")}
            </h2>
            <p className="mt-1 text-sm text-muted">{t("rooms.create.subtitle")}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("actions.close")}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-control text-muted hover:bg-bg-subtle hover:text-fg focus-visible:outline-none"
          >
            <X weight="bold" className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {/* Presentation the room's case is requested for */}
        <div className="mt-5">
          <Field label={t("rooms.create.caseLabel")}>
            {(aria) => (
              <Select
                {...aria}
                value={family ?? "any"}
                onChange={(e) => setFamily(e.target.value === "any" ? null : (e.target.value as ChiefComplaintFamily))}
              >
                <option value="any">{t("oncase.request.any")}</option>
                {CHIEF_COMPLAINT_FAMILIES.map((f) => (
                  <option key={f.id} value={f.id}>
                    {COMPLAINT_LABELS[f.id][lang]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <p className="mt-1.5 text-xs text-muted">
            {t("rooms.create.uniqueCaseHint", {
              defaultValue:
                "A fresh, unique patient is generated for each room and shared with everyone who joins.",
            })}
          </p>
          {error ? (
            <p role="alert" className="mt-1.5 text-xs text-[color:var(--state-caution)]">
              {t(`live2.gen.error.${error}`, { defaultValue: t("live2.gen.error.unknown", { code: error }) })}
            </p>
          ) : null}
        </div>

        {/* Role assignment */}
        <fieldset className="mt-5">
          <legend className="text-xs font-semibold uppercase tracking-wide text-muted">
            {t("rooms.create.rolesLabel")}
          </legend>
          <p className="mt-1 text-xs text-muted">{t("rooms.create.rolesHint")}</p>
          <div className="mt-2 flex flex-col gap-2">
            {CLINICAL_ROLE_ORDER.map((role) => {
              const isHuman = humanRoles.includes(role);
              const RoleIcon = ROLE_ICON[role];
              return (
                <label
                  key={role}
                  className="flex cursor-pointer items-center justify-between gap-3 rounded-control border border-border bg-bg-subtle px-3 py-2.5"
                >
                  <span className="inline-flex items-center gap-2 text-sm font-medium text-fg">
                    <RoleIcon weight="bold" className="h-4 w-4 text-muted" aria-hidden />
                    {t(`rooms.role.${role}`)}
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 text-xs font-medium",
                        isHuman ? "text-fg" : "text-brand",
                      )}
                    >
                      {isHuman ? (
                        <>
                          <Users weight="bold" className="h-3.5 w-3.5" aria-hidden />
                          {t("rooms.create.human")}
                        </>
                      ) : (
                        <>
                          <Robot weight="bold" className="h-3.5 w-3.5" aria-hidden />
                          {t("rooms.create.aiBacked")}
                        </>
                      )}
                    </span>
                    <Switch
                      checked={isHuman}
                      onCheckedChange={() => toggleRole(role)}
                      aria-label={t("rooms.create.roleToggle", {
                        role: t(`rooms.role.${role}`),
                      })}
                    />
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {/* AI backfill */}
        <label className="mt-5 flex items-center justify-between gap-3 rounded-control border border-border bg-bg-subtle px-3 py-2.5">
          <span>
            <span className="block text-sm font-medium text-fg">
              {t("rooms.create.backfillLabel")}
            </span>
            <span className="block text-xs text-muted">
              {t("rooms.create.backfillHint")}
            </span>
          </span>
          <Switch
            checked={aiBackfill}
            onCheckedChange={setAiBackfill}
            aria-label={t("rooms.create.backfillLabel")}
          />
        </label>

        {/* Encounter language */}
        <fieldset className="mt-5">
          <legend className="text-xs font-semibold uppercase tracking-wide text-muted">
            {t("rooms.create.localeLabel")}
          </legend>
          <p className="mt-1 text-xs text-muted">{t("rooms.create.localeHint")}</p>
          <div
            className="mt-2 inline-flex rounded-control border border-border bg-bg-subtle p-1"
            role="radiogroup"
            aria-label={t("rooms.create.localeLabel")}
          >
            {locales.map((loc) => {
              const selected = loc === locale;
              return (
                <button
                  key={loc}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setLocale(loc)}
                  className={cn(
                    "min-h-9 rounded-[7px] px-3 text-sm font-medium transition-colors duration-200 ease-out focus-visible:outline-none",
                    selected
                      ? "bg-surface text-fg shadow-soft"
                      : "text-muted hover:text-fg",
                  )}
                >
                  {t(`rooms.locale.${loc}`)}
                </button>
              );
            })}
          </div>
        </fieldset>

        {/* Actions */}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose}>
            {t("actions.cancel")}
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={busy}
            aria-busy={busy}
            leadingIcon={<Plus weight="bold" className="h-4 w-4" />}
          >
            {t("rooms.create.confirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}
