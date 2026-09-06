import { useTranslation } from "react-i18next";
import { Student, ChalkboardTeacher, Buildings } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { VIEW_AS_ROLES, useViewAs, type ViewAsRole } from "@/lib/viewAs";

const roleIcon: Record<ViewAsRole, typeof Student> = {
  learner: Student,
  educator: ChalkboardTeacher,
  dean: Buildings,
};

/**
 * RoleSwitcher — the "View as" demo control. A compact segmented control that
 * changes which nav surfaces are shown (learner / educator / dean), mirroring
 * the LanguageSwitcher pattern: one row, medkit tokens, keyboard + SR friendly.
 * The icon is decorative; the visible role name carries the meaning (never
 * icon-only), and the label is hidden on the narrowest widths but announced.
 */
export function RoleSwitcher({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { role, setRole } = useViewAs();

  return (
    <div className={cn("inline-flex items-center gap-1.5", className)}>
      <span
        className="hidden text-[11px] font-medium uppercase tracking-wide text-muted lg:inline"
        aria-hidden="true"
      >
        {t("role.viewAs")}
      </span>
      <div
        role="group"
        aria-label={t("role.viewAs")}
        className="inline-flex items-center rounded-control border border-border bg-bg-subtle p-0.5"
      >
        {VIEW_AS_ROLES.map((r) => {
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
                "inline-flex min-h-8 items-center gap-1.5 rounded-[7px] px-2.5 text-xs font-semibold",
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
