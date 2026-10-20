import { useTranslation } from "react-i18next";
import {
  Waveform,
  Crown,
  ShieldCheck,
  Hand,
  Microphone,
  SignIn,
  SignOut,
  CheckCircle,
  Circle,
} from "@phosphor-icons/react";

import { Badge, Button, Switch, StatusDot, type StatusTone } from "@/components/ui";
import { cn } from "@/lib/cn";
import { RoleAvatar } from "./RoleAvatar";
import { ROLE_ICON } from "./roleMeta";
import { EncounterClock } from "@/components/ehr";
import type { Presence } from "@/data/rooms";

/** Presence → StatusDot tone (label is always carried by the name/ready text). */
const PRESENCE_TONE: Record<Presence, StatusTone> = {
  active: "normal",
  idle: "caution",
  reconnecting: "warning",
};
import {
  effectiveHolder,
  CLINICAL_ROLE_ORDER,
  type Room,
  type ClinicalRole,
} from "@/data/rooms";
import { isSelfParticipant } from "./roomStore";

export interface ParticipantsPanelProps {
  room: Room;
  /** Which role currently holds the floor (is "speaking"). */
  speakingRole: ClinicalRole | null;
  /** The role this device sits in (highlighted as "you"), or null when observing. */
  mine?: ClinicalRole | null;
  /** Roles that have raised a hand, awaiting the floor. */
  raisedHands?: ClinicalRole[];
  /** The role the team lead has explicitly granted the floor to. */
  floorHolder?: ClinicalRole | null;
  /** Whether this device wears the team-lead hat (can grant the floor). */
  iAmLead?: boolean;
  /** Take an open or AI-held seat. */
  onTakeSeat?: (role: ClinicalRole) => void;
  /** Leave the seat this device holds. */
  onLeaveSeat?: () => void;
  /** Toggle the ready-check on this device's seat. */
  onToggleReady?: (role: ClinicalRole) => void;
  /** Move the team-lead hat onto a role. */
  onClaimLead?: (role: ClinicalRole) => void;
  /** Grant the floor to a role that has raised a hand. */
  onGrantFloor?: (role: ClinicalRole) => void;
  /** Turn AI backfill of empty seats on or off. */
  onToggleBackfill?: (on: boolean) => void;
}

/**
 * ParticipantsPanel — the in-room roster + shared team clock (Screen 6.3) with
 * live seat + turn control. Each seat shows its role, holder (human name or an
 * explicit AI-held badge, Art. 50), presence, the team-lead hat, and its turn
 * state. The learner can take an open or AI-held seat, leave, ready-check, and
 * (as team lead) hand off the lead and grant the floor to a raised hand. Every
 * live cue pairs an icon with a text label so nothing is colour- or motion-only.
 */
export function ParticipantsPanel({
  room,
  speakingRole,
  mine = null,
  raisedHands = [],
  floorHolder = null,
  iAmLead = false,
  onTakeSeat,
  onLeaveSeat,
  onToggleReady,
  onClaimLead,
  onGrantFloor,
  onToggleBackfill,
}: ParticipantsPanelProps) {
  const { t } = useTranslation();
  const interactive = Boolean(onTakeSeat || onLeaveSeat);

  return (
    <section
      aria-label={t("rooms.inroom.participantsLabel")}
      className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
    >
      {/* Header + shared team clock */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-fg">
          {t("rooms.inroom.participants")}
        </h2>
        <span className="inline-flex items-center gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
            {t("rooms.inroom.teamClock")}
          </span>
          <EncounterClock variant="chip" />
        </span>
      </div>

      <ul className="flex flex-col gap-2">
        {CLINICAL_ROLE_ORDER.map((role) => {
          const seat = room.seats.find((s) => s.role === role);
          if (!seat) return null;
          const holder = effectiveHolder(seat, room.aiBackfill);
          const RoleIcon = ROLE_ICON[role];
          const speaking = speakingRole === role;
          const hasFloor = floorHolder === role;
          // "You" is THIS device only: its own per-tab id (or the legacy seed
          // fixture). A remote joiner's seat shows the joiner's profile name.
          const isMe = isSelfParticipant(holder) || mine === role;
          const isAi = holder?.kind === "ai";
          const isHandRaised = raisedHands.includes(role) && !hasFloor;

          return (
            <li
              key={role}
              className={cn(
                "flex flex-col gap-2 rounded-control border px-3 py-2.5",
                speaking ? "border-brand bg-brand-tint" : "border-border bg-bg-subtle",
              )}
            >
              <div className="flex items-center gap-3">
                {holder ? (
                  <RoleAvatar participant={holder} size="sm" />
                ) : (
                  <span
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-dashed border-border text-muted"
                    aria-hidden
                  >
                    <RoleIcon weight="bold" className="h-4 w-4" />
                  </span>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 text-sm font-medium text-fg">
                      <RoleIcon weight="bold" className="h-3.5 w-3.5 text-muted" aria-hidden />
                      {t(`rooms.role.${role}`)}
                    </span>
                    {seat.teamLead ? (
                      <Badge tone="brand" icon={<Crown weight="fill" className="h-3 w-3" aria-hidden />}>
                        {t("rooms.teamLead.hat")}
                      </Badge>
                    ) : null}
                    {isMe ? (
                      <Badge tone="neutral" icon={<ShieldCheck weight="fill" className="h-3 w-3" aria-hidden />}>
                        {t("rooms.you")}
                      </Badge>
                    ) : null}
                  </div>

                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
                    {holder ? (
                      isAi ? (
                        <span className="font-medium text-brand">
                          {t("rooms.seat.aiHeld")}
                        </span>
                      ) : (
                        <>
                          <StatusDot
                            tone={PRESENCE_TONE[holder.presence]}
                            size="sm"
                            aria-hidden="true"
                          />
                          <span className="truncate text-muted">
                            {isSelfParticipant(holder) ? t("rooms.you") : holder.name}
                          </span>
                          <span className="text-muted" aria-hidden>·</span>
                          <span className="inline-flex items-center gap-1 text-muted">
                            {seat.ready ? (
                              <CheckCircle weight="fill" className="h-3 w-3 text-[color:var(--state-normal)]" aria-hidden />
                            ) : (
                              <Circle weight="bold" className="h-3 w-3" aria-hidden />
                            )}
                            {seat.ready ? t("rooms.inroom.ready") : t("rooms.inroom.notReady")}
                          </span>
                        </>
                      )
                    ) : (
                      <span className="font-medium text-muted">{t("rooms.seat.open")}</span>
                    )}
                  </div>
                </div>

                {/* Turn cue — icon + text, never colour/motion alone */}
                {speaking ? (
                  <span
                    className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand px-2 py-0.5 text-[11px] font-medium text-white"
                    aria-live="polite"
                  >
                    {hasFloor ? (
                      <Microphone weight="fill" className="h-3.5 w-3.5" aria-hidden />
                    ) : (
                      <Waveform weight="fill" className="h-3.5 w-3.5 motion-safe:animate-pulse" aria-hidden />
                    )}
                    {hasFloor ? t("rooms.inroom.hasFloor") : t("rooms.inroom.speaking")}
                  </span>
                ) : isHandRaised ? (
                  <span
                    className="inline-flex shrink-0 items-center gap-1 rounded-full border border-brand px-2 py-0.5 text-[11px] font-medium text-brand"
                    aria-live="polite"
                  >
                    <Hand weight="fill" className="h-3.5 w-3.5 motion-safe:animate-pulse" aria-hidden />
                    {t("rooms.inroom.handRaised")}
                  </span>
                ) : null}
              </div>

              {/* Seat controls */}
              {interactive ? (
                <div
                  className="flex flex-wrap items-center gap-1.5"
                  aria-label={t("rooms.inroom.seatControlsLabel")}
                >
                  {isMe ? (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={onLeaveSeat}
                        aria-label={t("rooms.inroom.leaveSeatAria", { role: t(`rooms.role.${role}`) })}
                        leadingIcon={<SignOut weight="bold" className="h-3.5 w-3.5" />}
                      >
                        {t("rooms.inroom.leaveSeat")}
                      </Button>
                      <Button
                        size="sm"
                        variant={seat.ready ? "secondary" : "primary"}
                        onClick={() => onToggleReady?.(role)}
                        aria-label={t("rooms.inroom.toggleReadyAria", { role: t(`rooms.role.${role}`) })}
                        leadingIcon={
                          seat.ready ? (
                            <Circle weight="bold" className="h-3.5 w-3.5" />
                          ) : (
                            <CheckCircle weight="bold" className="h-3.5 w-3.5" />
                          )
                        }
                      >
                        {seat.ready ? t("rooms.inroom.notReady") : t("rooms.inroom.ready")}
                      </Button>
                    </>
                  ) : holder == null || isAi ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => onTakeSeat?.(role)}
                      aria-label={t("rooms.inroom.takeSeatAria", { role: t(`rooms.role.${role}`) })}
                      leadingIcon={<SignIn weight="bold" className="h-3.5 w-3.5" />}
                    >
                      {t("rooms.inroom.takeThisSeat")}
                    </Button>
                  ) : null}

                  {/* Lead can grant the floor to a raised hand */}
                  {iAmLead && isHandRaised ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => onGrantFloor?.(role)}
                      aria-label={t("rooms.inroom.giveFloorAria", { role: t(`rooms.role.${role}`) })}
                      leadingIcon={<Microphone weight="bold" className="h-3.5 w-3.5" />}
                    >
                      {t("rooms.inroom.giveFloor")}
                    </Button>
                  ) : null}

                  {/* Lead can hand off the lead hat */}
                  {iAmLead && !seat.teamLead && onClaimLead ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onClaimLead(role)}
                      aria-label={t("rooms.inroom.makeLeadAria", { role: t(`rooms.role.${role}`) })}
                      leadingIcon={<Crown weight="bold" className="h-3.5 w-3.5" />}
                    >
                      {t("rooms.inroom.makeLead")}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {/* AI backfill toggle */}
      {onToggleBackfill ? (
        <label className="flex items-center justify-between gap-3 rounded-control border border-border bg-bg-subtle px-3 py-2">
          <span className="text-xs font-medium text-fg">
            {t("rooms.inroom.backfillInline")}
          </span>
          <Switch
            checked={room.aiBackfill}
            onCheckedChange={onToggleBackfill}
            aria-label={t("rooms.inroom.backfillInlineAria")}
          />
        </label>
      ) : null}

      <p className="text-[11px] leading-relaxed text-muted">
        {t("rooms.inroom.aiNote")}
      </p>
    </section>
  );
}
