import { useTranslation } from "react-i18next";
import {
  Hand,
  ArrowFatUp,
  ChatCircleText,
  ClipboardText,
  Lock,
} from "@phosphor-icons/react";

import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { ROLE_ICON } from "./roleMeta";
import { ROLE_SCOPES, type ClinicalRole } from "@/data/rooms";
import type { Lang } from "@/data/mock";

export interface RoleScopeBarProps {
  role: ClinicalRole;
  lang: Lang;
  /** Whether this seat wears the team-lead hat (adds delegation affordances). */
  teamLead: boolean;
}

/**
 * RoleScopeBar — the scoped action bar (Screen 6.3). Shows the seat's clinical
 * scope in text, plus role-appropriate affordances: request the floor, hand off,
 * SBAR / escalate. A seat that cannot order (nurse, paramedic) sees a clear
 * "prompt the doctor" affordance instead, and the note that the request is
 * logged as assessment evidence (server-enforced order rights). No live network
 * here — production routes these through the authoritative Case State.
 */
export function RoleScopeBar({ role, lang, teamLead }: RoleScopeBarProps) {
  const { t } = useTranslation();
  const scope = ROLE_SCOPES[role];
  const RoleIcon = ROLE_ICON[role];

  return (
    <section
      aria-label={t("rooms.inroom.actionsLabel")}
      className="rounded-card border border-border bg-surface p-4"
    >
      <div className="flex items-start gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-control bg-brand-tint text-brand">
          <RoleIcon weight="bold" className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-fg">
            {t("rooms.inroom.yourScope", { role: t(`rooms.role.${role}`) })}
          </h2>
          <p className="mt-0.5 text-xs text-muted">{scope.scope[lang]}</p>
        </div>
      </div>

      {/* Scoped affordances */}
      <div className="mt-3.5 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" leadingIcon={<Hand weight="bold" className="h-4 w-4" />}>
          {t("rooms.inroom.requestFloor")}
        </Button>
        <Button size="sm" variant="secondary" leadingIcon={<ArrowFatUp weight="bold" className="h-4 w-4" />}>
          {t("rooms.inroom.escalateSbar")}
        </Button>
        {teamLead ? (
          <Button size="sm" variant="secondary" leadingIcon={<ClipboardText weight="bold" className="h-4 w-4" />}>
            {t("rooms.inroom.delegate")}
          </Button>
        ) : null}
      </div>

      {/* Order rights (server-enforced) */}
      {scope.canOrder ? (
        <p className="mt-3 text-[11px] text-muted">{t("rooms.inroom.canOrderNote")}</p>
      ) : (
        <div className="mt-3 flex items-start gap-2 rounded-control border border-border bg-bg-subtle px-3 py-2">
          <Lock weight="bold" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
          <p className="text-[11px] leading-relaxed text-muted">
            {t("rooms.inroom.cannotOrderNote")}
          </p>
        </div>
      )}

      <button
        type="button"
        className={cn(
          "mt-2.5 inline-flex min-h-9 items-center gap-1.5 rounded-control px-2 text-xs font-medium text-brand",
          "hover:bg-brand-tint focus-visible:outline-none",
        )}
      >
        <ChatCircleText weight="bold" className="h-3.5 w-3.5" aria-hidden />
        {t("rooms.inroom.promptDoctor")}
      </button>
    </section>
  );
}
