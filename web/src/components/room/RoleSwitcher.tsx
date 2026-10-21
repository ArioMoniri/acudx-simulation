import { useTranslation } from "react-i18next";
import { UserSwitch, Cpu } from "@phosphor-icons/react";

import { cn } from "@/lib/cn";
import { ROLE_ICON } from "./roleMeta";
import { CLINICAL_ROLE_ORDER, type ClinicalRole } from "@/data/rooms";
import type { Lang } from "@/data/schema";

export interface RoleSwitcherProps {
  actingRole: ClinicalRole;
  lang: Lang;
  /** Roles currently driven by scripted AI (shown with a labelled hint). */
  aiRoles?: ClinicalRole[];
  onSwitch: (role: ClinicalRole) => void;
}

/**
 * RoleSwitcher — the single-browser role picker that makes the collaborative
 * model playable solo: switch which seat you are acting as on the SAME shared
 * patient. The seat you leave is picked up by scripted, clearly-labelled AI
 * (Art. 50) when backfill is on, so the doctor→nurse handoff can be driven end
 * to end from one device. The active seat is carried by an icon + text, never
 * colour alone.
 */
export function RoleSwitcher({ actingRole, aiRoles = [], onSwitch }: RoleSwitcherProps) {
  const { t } = useTranslation();

  return (
    <section
      aria-label={t("roomscollab.acting.label")}
      className="rounded-card border border-border bg-surface p-3.5"
    >
      <div className="flex items-center gap-2">
        <UserSwitch weight="bold" className="h-4 w-4 text-brand" aria-hidden />
        <h2 className="text-[1.0625rem] text-fg">
          {t("roomscollab.acting.as", { role: t(`roomscollab.roles.${actingRole}`) })}
        </h2>
      </div>

      <div
        className="mt-3 grid grid-cols-3 gap-1.5"
        role="group"
        aria-label={t("roomscollab.acting.switch")}
      >
        {CLINICAL_ROLE_ORDER.map((role) => {
          const RoleIcon = ROLE_ICON[role];
          const active = role === actingRole;
          const aiHeld = !active && aiRoles.includes(role);
          return (
            <button
              key={role}
              type="button"
              aria-pressed={active}
              onClick={() => onSwitch(role)}
              className={cn(
                "flex min-h-[68px] flex-col items-center justify-center gap-1 rounded-control border px-2 py-2.5 text-xs font-medium transition-colors duration-200 focus-visible:outline-none",
                active
                  ? "border-brand bg-brand-tint text-brand"
                  : "border-border bg-bg-subtle text-muted hover:border-brand hover:text-fg",
              )}
            >
              <RoleIcon weight="bold" className="h-5 w-5" aria-hidden />
              <span className="text-fg">{t(`roomscollab.roles.${role}`)}</span>
              {aiHeld ? (
                <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-brand">
                  <Cpu weight="bold" className="h-3 w-3" aria-hidden />
                  {t("rooms.seat.aiHeld")}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <p className="mt-2.5 text-[11px] leading-relaxed text-muted">{t("roomscollab.acting.hint")}</p>
    </section>
  );
}
