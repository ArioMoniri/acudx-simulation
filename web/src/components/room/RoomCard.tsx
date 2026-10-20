import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, Users } from "@phosphor-icons/react";

import { Card, Badge, Button, SectionLabel, StatusDot } from "@/components/ui";
import { cn } from "@/lib/cn";
import { RoleAvatar } from "./RoleAvatar";
import { ROLE_ICON } from "./roleMeta";
import { isSelfParticipant, joinRoom } from "./roomStore";
import {
  effectiveHolder,
  seatFill,
  CLINICAL_ROLE_ORDER,
  type Room,
} from "@/data/rooms";
import type { Lang } from "@/data/mock";

/** Room status → StatusDot tone. `in-progress` is the live/active state. */
const STATUS_TONE = {
  open: "normal",
  "in-progress": "caution",
  debrief: "neutral",
} as const;

export interface RoomCardProps {
  room: Room;
  lang: Lang;
}

/**
 * RoomCard — one open room in the lobby list (Screen 6.1). Shows the case,
 * roles filled vs needed, host, locale, acuity, and a live-presence line. AI
 * backfill is announced in text, never colour-only. "Take a seat" routes into
 * the room.
 */
export function RoomCard({ room, lang }: RoomCardProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const fill = seatFill(room);
  const live = room.status === "in-progress";

  // Entering from the lobby genuinely takes an open seat, then routes in.
  function enterRoom() {
    joinRoom(room.id);
    navigate(`/rooms/${room.id}`);
  }

  return (
    <Card
      variant="interactive"
      padding="lg"
      className="flex h-full flex-col gap-4"
    >
      {/* Title row + live status */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold tracking-tight text-fg">
            {room.title[lang]}
          </h3>
          <p className="mt-1 text-sm text-muted">{room.chiefComplaint[lang]}</p>
        </div>
        <StatusDot
          tone={STATUS_TONE[room.status]}
          pulse={live}
          label={t(`rooms.status.${room.status}`)}
          className="shrink-0"
        />
      </div>

      {/* Meta line — acuity, seats, locale, code (hierarchy, not chip soup) */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-border py-2.5 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <StatusDot
            tone={`esi-${room.acuityESI}` as const}
            size="sm"
            aria-hidden="true"
          />
          <span className="font-medium text-fg">
            {t("ehr.banner.esi", { level: room.acuityESI })}
          </span>
        </span>
        <span className="inline-flex items-center gap-1.5 text-muted">
          <Users weight="bold" className="h-3.5 w-3.5" aria-hidden />
          <span className="text-muted">{t("rooms3.card.seats")}</span>
          <span className="tnum font-medium text-fg">
            {fill.filled}/{fill.total}
          </span>
        </span>
        <span className="inline-flex items-center gap-1.5 text-muted">
          <span>{t(`rooms.locale.${room.locale}`)}</span>
        </span>
        <span className="ms-auto inline-flex items-center gap-1.5 text-muted">
          <span>{t("rooms.card.code")}</span>
          <span className="font-mono tracking-wide text-fg">{room.joinCode}</span>
        </span>
      </div>

      {/* Role roster (compact hairline rows) */}
      <div className="flex flex-col gap-2">
        <SectionLabel>{t("rooms.card.rosterLabel")}</SectionLabel>
        <ul className="flex flex-col divide-y divide-border">
          {CLINICAL_ROLE_ORDER.map((role) => {
            const seat = room.seats.find((s) => s.role === role);
            if (!seat) return null;
            const holder = effectiveHolder(seat, room.aiBackfill);
            const RoleIcon = ROLE_ICON[role];
            return (
              <li
                key={role}
                className="flex items-center justify-between gap-2 py-1.5"
              >
                <span className="inline-flex items-center gap-2 text-sm text-fg">
                  <RoleIcon weight="bold" className="h-4 w-4 text-muted" aria-hidden />
                  {t(`rooms.role.${role}`)}
                  {seat.teamLead ? (
                    <Badge tone="brand" className="ms-0.5">
                      {t("rooms.teamLead.hat")}
                    </Badge>
                  ) : null}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  {holder ? (
                    <>
                      <span
                        className={cn(
                          "text-xs",
                          holder.kind === "ai" ? "text-brand" : "text-muted",
                        )}
                      >
                        {holder.kind === "ai"
                          ? t("rooms.seat.aiHeld")
                          : holder.name}
                      </span>
                      <RoleAvatar participant={holder} size="sm" />
                    </>
                  ) : (
                    <span className="text-xs font-medium text-muted">
                      {t("rooms.seat.open")}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Host + action */}
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-3">
        <span className="inline-flex items-center gap-2 text-xs text-muted">
          <RoleAvatar participant={room.host} size="sm" />
          {t("rooms.card.hostedBy", {
            name: isSelfParticipant(room.host) ? t("rooms.you") : room.host.name,
          })}
        </span>
        <Button
          size="sm"
          variant={room.status === "open" ? "primary" : "secondary"}
          onClick={enterRoom}
          trailingIcon={<ArrowRight weight="bold" className="h-3.5 w-3.5" />}
        >
          {live ? t("rooms.card.rejoin") : t("rooms.card.takeSeat")}
        </Button>
      </div>
    </Card>
  );
}
