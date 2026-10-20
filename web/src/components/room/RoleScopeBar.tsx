import { useTranslation } from "react-i18next";
import {
  Hand,
  HandPalm,
  ArrowFatUp,
  ChatCircleText,
  ClipboardText,
  Lock,
  Microphone,
  Eye,
} from "@phosphor-icons/react";

import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { ROLE_ICON } from "./roleMeta";
import { ROLE_SCOPES, type ClinicalRole } from "@/data/rooms";
import type { Lang } from "@/data/schema";

export interface RoleScopeBarProps {
  role: ClinicalRole;
  lang: Lang;
  /** Whether this seat wears the team-lead hat (adds delegation affordances). */
  teamLead: boolean;
  /** True when this device only observes (holds no seat): actions are disabled. */
  observer?: boolean;
  /** This seat has raised its hand and is waiting to be brought in. */
  handRaised?: boolean;
  /** This seat currently holds the floor. */
  hasFloor?: boolean;
  /** Raise a hand to request the floor. */
  onRequestFloor?: () => void;
  /** Lower a previously raised hand. */
  onLowerHand?: () => void;
  /** Release the floor back to the team. */
  onPassFloor?: () => void;
  /** Post an SBAR escalation to the floor. */
  onEscalate?: () => void;
  /** Post a delegated task assignment to the floor (team lead). */
  onDelegate?: () => void;
  /** Flag a concern for the doctor (non-ordering seats). */
  onPromptDoctor?: () => void;
}

/**
 * RoleScopeBar — the scoped action bar (Screen 6.3). Shows the seat's clinical
 * scope in text, plus role-appropriate affordances that now genuinely act on the
 * shared room state: request / pass the floor, SBAR escalate, delegate, and (for
 * seats that cannot order) prompt the doctor. Every posted action lands on the
 * team floor and is logged as assessment evidence. Turn state (hand raised, hold
 * the floor) is reflected in text and icon, never colour alone. No live network
 * here; production routes these through the authoritative Case State.
 */
export function RoleScopeBar({
  role,
  lang,
  teamLead,
  observer = false,
  handRaised = false,
  hasFloor = false,
  onRequestFloor,
  onLowerHand,
  onPassFloor,
  onEscalate,
  onDelegate,
  onPromptDoctor,
}: RoleScopeBarProps) {
  const { t } = useTranslation();
  const scope = ROLE_SCOPES[role];
  const RoleIcon = ROLE_ICON[role];

  return (
    <section
      aria-label={t("rooms.inroom.floorControlsLabel")}
      className="rounded-card border border-border bg-surface p-4"
    >
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-control",
            observer ? "bg-bg-subtle text-muted" : "bg-brand-tint text-brand",
          )}
        >
          {observer ? (
            <Eye weight="bold" className="h-5 w-5" aria-hidden />
          ) : (
            <RoleIcon weight="bold" className="h-5 w-5" aria-hidden />
          )}
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-fg">
            {observer
              ? t("rooms.inroom.observer")
              : t("rooms.inroom.yourScope", { role: t(`rooms.role.${role}`) })}
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            {observer ? t("rooms.inroom.observerScope") : scope.scope[lang]}
          </p>
        </div>
      </div>

      {/* Floor hold banner */}
      {hasFloor && !observer ? (
        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 rounded-control border border-brand bg-brand-tint px-3 py-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand">
            <Microphone weight="fill" className="h-4 w-4" aria-hidden />
            {t("rooms.inroom.youHaveFloor")}
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={onPassFloor}
            leadingIcon={<HandPalm weight="bold" className="h-4 w-4" />}
          >
            {t("rooms.inroom.passFloor")}
          </Button>
        </div>
      ) : null}

      {/* Raised-hand banner */}
      {handRaised && !hasFloor && !observer ? (
        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 rounded-control border border-border bg-bg-subtle px-3 py-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-fg">
            <Hand weight="fill" className="h-4 w-4 text-brand" aria-hidden />
            {t("rooms.inroom.youRaised")}
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={onLowerHand}
            leadingIcon={<HandPalm weight="bold" className="h-4 w-4" />}
          >
            {t("rooms.inroom.lowerHand")}
          </Button>
        </div>
      ) : null}

      {/* Scoped affordances */}
      {!observer ? (
        <div className="mt-3.5 flex flex-wrap gap-2">
          {!hasFloor && !handRaised ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={onRequestFloor}
              leadingIcon={<Hand weight="bold" className="h-4 w-4" />}
            >
              {t("rooms.inroom.requestFloor")}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="secondary"
            onClick={onEscalate}
            leadingIcon={<ArrowFatUp weight="bold" className="h-4 w-4" />}
          >
            {t("rooms.inroom.escalateSbar")}
          </Button>
          {teamLead ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={onDelegate}
              leadingIcon={<ClipboardText weight="bold" className="h-4 w-4" />}
            >
              {t("rooms.inroom.delegate")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* Order rights (server-enforced) */}
      {observer ? null : scope.canOrder ? (
        <p className="mt-3 text-[11px] text-muted">{t("rooms.inroom.canOrderNote")}</p>
      ) : (
        <>
          <div className="mt-3 flex items-start gap-2 rounded-control border border-border bg-bg-subtle px-3 py-2">
            <Lock weight="bold" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
            <p className="text-[11px] leading-relaxed text-muted">
              {t("rooms.inroom.cannotOrderNote")}
            </p>
          </div>
          <button
            type="button"
            onClick={onPromptDoctor}
            className={cn(
              "mt-2.5 inline-flex min-h-9 items-center gap-1.5 rounded-control px-2 text-xs font-medium text-brand",
              "hover:bg-brand-tint focus-visible:outline-none",
            )}
          >
            <ChatCircleText weight="bold" className="h-3.5 w-3.5" aria-hidden />
            {t("rooms.inroom.promptDoctor")}
          </button>
        </>
      )}
    </section>
  );
}
