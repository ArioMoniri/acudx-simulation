import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Student, ChalkboardTeacher, Buildings, Wrench, CaretDown } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { useProfile } from "@/state/profileStore";
import { permittedVantages, useViewAs, type ViewAsRole } from "@/lib/viewAs";

const roleIcon: Record<ViewAsRole, typeof Student> = {
  learner: Student,
  educator: ChalkboardTeacher,
  dean: Buildings,
  admin: Wrench,
};

/**
 * RoleSwitcher — the "View as" preview control. A compact segmented control that
 * previews which nav surfaces are shown, WITHIN permission: it renders only the
 * vantages the real profile role permits (see `permittedVantages`), so a student
 * or resident sees no educator/dean options and a dean can preview all three
 * downward. Mirrors the LanguageSwitcher pattern: one row, medkit tokens,
 * keyboard + SR friendly. The icon is decorative; the visible role name carries
 * the meaning (never icon-only), and the label is hidden on the narrowest widths
 * but announced.
 */
export interface RoleSwitcherProps {
  className?: string;
  /**
   * `segmented` (default) is the full control with every vantage visible;
   * `menu` collapses it into one labelled select so the TopNav right cluster
   * fits inside a 768px viewport without overflowing the page.
   */
  variant?: "segmented" | "menu";
}

export function RoleSwitcher({ className, variant = "segmented" }: RoleSwitcherProps) {
  const { t } = useTranslation();
  const { role, setRole } = useViewAs();
  const profile = useProfile();
  const selectId = useId();

  // Only the vantages the REAL profile role permits (single source of truth).
  const vantages: ViewAsRole[] = profile?.onboarded
    ? permittedVantages(profile.role)
    : ["learner"];

  // A single permitted vantage is nothing to switch between — hide the control
  // entirely (a student/resident gets no "View as" affordance at all).
  if (vantages.length <= 1) return null;

  if (variant === "menu") {
    const Icon = roleIcon[role];
    return (
      <div className={cn("relative inline-flex items-center", className)}>
        <label htmlFor={selectId} className="sr-only">
          {t("role.viewAs")}
        </label>
        <Icon
          weight="bold"
          className="pointer-events-none absolute start-2.5 h-4 w-4 text-muted"
          aria-hidden="true"
        />
        <select
          id={selectId}
          value={role}
          onChange={(e) => setRole(e.target.value as ViewAsRole)}
          title={t("role.viewAs")}
          className={cn(
            "h-9 appearance-none rounded-control border border-border bg-bg-subtle ps-8 pe-7",
            "text-xs font-semibold text-fg transition-colors duration-200 ease-out",
            "hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
          )}
        >
          {vantages.map((r) => (
            <option key={r} value={r}>
              {t(`role.${r}`)}
            </option>
          ))}
        </select>
        <CaretDown
          weight="bold"
          className="pointer-events-none absolute end-2.5 h-3 w-3 text-muted"
          aria-hidden="true"
        />
      </div>
    );
  }

  return (
    <div className={cn("inline-flex items-center gap-1.5", className)}>
      <span
        className="hidden eyebrow lg:inline"
        aria-hidden="true"
      >
        {t("role.viewAs")}
      </span>
      <div
        role="group"
        aria-label={t("role.viewAs")}
        className="inline-flex items-center rounded-control border border-border bg-bg-subtle p-0.5"
      >
        {vantages.map((r) => {
          const active = role === r;
          const Icon = roleIcon[r];
          return (
            <button
              key={r}
              type="button"
              onClick={() => setRole(r)}
              aria-pressed={active}
              aria-label={t("role.viewAsRole", { role: t(`role.${r}`) })}
              title={t("role.viewAsRole", { role: t(`role.${r}`) })}
              className={cn(
                "inline-flex min-h-8 items-center gap-1.5 rounded-chip px-2.5 text-xs font-semibold",
                "transition-colors duration-200 ease-out focus-visible:outline-none",
                active
                  ? "bg-surface text-fg shadow-soft"
                  : "text-muted hover:text-fg",
              )}
            >
              <Icon weight="bold" className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">{t(`role.${r}`)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
