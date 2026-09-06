import { useTranslation } from "react-i18next";
import { Student, ChalkboardTeacher, Buildings } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { useProfile } from "@/state/profileStore";
import { permittedVantages, useViewAs, type ViewAsRole } from "@/lib/viewAs";

const roleIcon: Record<ViewAsRole, typeof Student> = {
  learner: Student,
  educator: ChalkboardTeacher,
  dean: Buildings,
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
export function RoleSwitcher({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { role, setRole } = useViewAs();
  const profile = useProfile();

  // Only the vantages the REAL profile role permits (single source of truth).
  const vantages: ViewAsRole[] = profile?.onboarded
    ? permittedVantages(profile.role)
    : ["learner"];

  // A single permitted vantage is nothing to switch between — hide the control
  // entirely (a student/resident gets no "View as" affordance at all).
  if (vantages.length <= 1) return null;

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
