import { useTranslation } from "react-i18next";
import { Waveform, Crown, ShieldCheck } from "@phosphor-icons/react";

import { Badge } from "@/components/ui";
import { cn } from "@/lib/cn";
import { RoleAvatar } from "./RoleAvatar";
import { ROLE_ICON, PRESENCE_COLOR } from "./roleMeta";
import { EncounterClock } from "@/components/ehr";
import {
  effectiveHolder,
  CLINICAL_ROLE_ORDER,
  type Room,
  type ClinicalRole,
} from "@/data/rooms";

export interface ParticipantsPanelProps {
  room: Room;
  /** Which role currently holds the floor (is "speaking"). */
  speakingRole: ClinicalRole | null;
  /** The seat this device is scoped to (highlighted as "you"). */
  myRole: ClinicalRole;
}

/**
 * ParticipantsPanel — the in-room roster + shared team clock (Screen 6.3).
 * Each seat shows its role, the holder (human name or an explicit AI-held
 * badge, Art. 50), live presence, the team-lead hat, and a "speaking now" cue.
 * The speaking cue pairs an animated icon with a text label so it is never
 * colour- or motion-only. The team clock is shared across the whole room.
 */
export function ParticipantsPanel({
  room,
  speakingRole,
  myRole,
}: ParticipantsPanelProps) {
  const { t } = useTranslation();

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
          const isMe = role === myRole;

          return (
            <li
              key={role}
              className={cn(
                "flex items-center gap-3 rounded-control border px-3 py-2.5",
                speaking
                  ? "border-brand bg-brand-tint"
                  : "border-border bg-bg-subtle",
              )}
            >
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

                <div className="mt-0.5 flex items-center gap-1.5 text-xs">
                  {holder ? (
                    holder.kind === "ai" ? (
                      <span className="font-medium text-brand">
                        {t("rooms.seat.aiHeld")}
                      </span>
                    ) : (
                      <>
                        <span
                          className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: PRESENCE_COLOR[holder.presence] }}
                          aria-hidden
                        />
                        <span className="truncate text-muted">
                          {holder.id === "u-me" ? t("rooms.you") : holder.name}
                        </span>
                        <span className="text-muted">·</span>
                        <span className="text-muted">
                          {t(`rooms.presence.${holder.presence}`)}
                        </span>
                      </>
                    )
                  ) : (
                    <span className="font-medium text-muted">{t("rooms.seat.open")}</span>
                  )}
                </div>
              </div>

              {/* Speaking cue — icon + text, never colour/motion alone */}
              {speaking ? (
                <span
                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand px-2 py-0.5 text-[11px] font-medium text-white"
                  aria-live="polite"
                >
                  <Waveform
                    weight="fill"
                    className="h-3.5 w-3.5 motion-safe:animate-pulse"
                    aria-hidden
                  />
                  {t("rooms.inroom.speaking")}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>

      <p className="text-[11px] leading-relaxed text-muted">
        {t("rooms.inroom.aiNote")}
      </p>
    </section>
  );
}
