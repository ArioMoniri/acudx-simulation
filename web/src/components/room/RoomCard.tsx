import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "@phosphor-icons/react";

import { Badge, Button, SectionLabel, StatusDot } from "@/components/ui";
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
import type { Lang } from "@/data/schema";

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
    // One room as a ruled row of the lobby list (Linear grouped list, Stripe
    // table rows) rather than a card in a uniform grid: the case on the left,
    // the roster in the middle, host and action on the right; stacked on a phone.
    <article
      aria-label={room.title[lang]}
      className="grid gap-x-6 gap-y-3 py-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,12rem)] lg:items-start"
    >
      {/* Case, status and meta */}
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="min-w-0 text-[0.9375rem] font-semibold leading-snug text-fg">
            {room.title[lang]}
          </h3>
          <StatusDot
            tone={STATUS_TONE[room.status]}
            pulse={live}
            size="sm"
            label={t(`rooms.status.${room.status}`)}
            className="shrink-0 text-xs"
          />
        </div>
        <p className="text-sm text-muted">{room.chiefComplaint[lang]}</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">
            <StatusDot tone={`esi-${room.acuityESI}` as const} size="sm" aria-hidden="true" />
            <span className="font-medium text-fg">
              {t("ehr.banner.esi", { level: room.acuityESI })}
            </span>
          </span>
          <span className="inline-flex items-center gap-1">
            <span>{t("rooms3.card.seats")}</span>
            <span className="tnum font-medium text-fg">
              {fill.filled}/{fill.total}
            </span>
          </span>
          <span>{t(`rooms.locale.${room.locale}`)}</span>
          <span className="inline-flex items-center gap-1">
            <span>{t("rooms.card.code")}</span>
            <span className="font-mono tracking-wide text-fg">{room.joinCode}</span>
          </span>
        </div>
      </div>

      {/* Role roster: avatar, name, role. The avatar leads every line so faces
          and initials sit on one vertical axis whatever the name length. */}
      <div className="min-w-0">
        <SectionLabel className="mb-1 lg:sr-only">{t("rooms.card.rosterLabel")}</SectionLabel>
        <ul className="flex flex-col gap-1.5">
          {CLINICAL_ROLE_ORDER.map((role) => {
            const seat = room.seats.find((s) => s.role === role);
            if (!seat) return null;
            const holder = effectiveHolder(seat, room.aiBackfill);
            const RoleIcon = ROLE_ICON[role];
            return (
              <li key={role} className="flex min-w-0 items-center gap-2 text-sm">
                {holder ? (
                  <RoleAvatar participant={holder} size="xs" />
                ) : (
                  <span
                    aria-hidden
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-dashed border-border-strong text-muted"
                  >
                    <RoleIcon weight="bold" className="h-3 w-3" />
                  </span>
                )}
                <span
                  className={cn(
                    "min-w-0 truncate",
                    holder?.kind === "ai" ? "text-brand" : holder ? "text-fg" : "text-muted",
                  )}
                >
                  {holder
                    ? holder.kind === "ai"
                      ? t("rooms.seat.aiHeld")
                      : holder.name
                    : t("rooms.seat.open")}
                </span>
                <span className="shrink-0 text-xs text-muted">{t(`rooms.role.${role}`)}</span>
                {seat.teamLead ? (
                  <Badge tone="brand" className="shrink-0">
                    {t("rooms.teamLead.hat")}
                  </Badge>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>

      {/* Host + action */}
      <div className="flex items-center justify-between gap-3 lg:flex-col lg:items-end">
        <span className="inline-flex min-w-0 items-center gap-2 text-xs text-muted">
          <RoleAvatar participant={room.host} size="xs" />
          <span className="truncate">
            {t("rooms.card.hostedBy", {
              name: isSelfParticipant(room.host) ? t("rooms.you") : room.host.name,
            })}
          </span>
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
    </article>
  );
}
