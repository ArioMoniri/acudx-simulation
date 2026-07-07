import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  Users,
  Broadcast,
  DotsThreeCircle,
  Warning,
} from "@phosphor-icons/react";

import { Card, Badge, Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { RoleAvatar } from "./RoleAvatar";
import { ROLE_ICON } from "./roleMeta";
import {
  effectiveHolder,
  seatFill,
  CLINICAL_ROLE_ORDER,
  type Room,
} from "@/data/rooms";
import type { Lang } from "@/data/mock";

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
  const fill = seatFill(room);

  const statusTone =
    room.status === "in-progress"
      ? "caution"
      : room.status === "debrief"
        ? "neutral"
        : "normal";

  return (
    <Card
      padding="lg"
      className="flex h-full flex-col gap-4 transition-shadow duration-300 ease-out hover:shadow-soft-md"
    >
      {/* Title row */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold tracking-tight text-fg">
            {room.title[lang]}
          </h3>
          <p className="mt-1 text-sm text-muted">{room.chiefComplaint[lang]}</p>
        </div>
        <Badge
          tone={statusTone}
          icon={
            room.status === "in-progress" ? (
              <Broadcast weight="fill" className="h-3 w-3" aria-hidden />
            ) : room.status === "debrief" ? (
              <DotsThreeCircle weight="fill" className="h-3 w-3" aria-hidden />
            ) : undefined
          }
        >
          {t(`rooms.status.${room.status}`)}
        </Badge>
      </div>

      {/* Meta chips */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-subtle px-2.5 py-0.5 text-xs font-medium text-muted">
          {t(`rooms.locale.${room.locale}`)}
        </span>
        <span
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium"
          style={{
            color: "var(--state-caution)",
            backgroundColor:
              "color-mix(in srgb, var(--state-caution) 16%, transparent)",
          }}
        >
          <Warning weight="fill" className="h-3 w-3" aria-hidden />
          {t("ehr.banner.esi", { level: room.acuityESI })}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-subtle px-2.5 py-0.5 text-xs font-medium text-muted">
          <Users weight="bold" className="h-3 w-3" aria-hidden />
          {t("rooms.card.seatsFilled", { filled: fill.filled, total: fill.total })}
        </span>
      </div>

      {/* Role roster (compact) */}
      <ul
        className="flex flex-col gap-1.5"
        aria-label={t("rooms.card.rosterLabel")}
      >
        {CLINICAL_ROLE_ORDER.map((role) => {
          const seat = room.seats.find((s) => s.role === role);
          if (!seat) return null;
          const holder = effectiveHolder(seat, room.aiBackfill);
          const RoleIcon = ROLE_ICON[role];
          return (
            <li
              key={role}
              className="flex items-center justify-between gap-2 rounded-control border border-border bg-bg-subtle px-2.5 py-1.5"
            >
              <span className="inline-flex items-center gap-2 text-sm text-fg">
                <RoleIcon weight="bold" className="h-4 w-4 text-muted" aria-hidden />
                {t(`rooms.role.${role}`)}
                {seat.teamLead ? (
                  <Badge tone="brand" className="ml-0.5">
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

      {/* Host + action */}
      <div className="mt-auto flex items-center justify-between gap-3 pt-1">
        <span className="inline-flex items-center gap-2 text-xs text-muted">
          <RoleAvatar participant={room.host} size="sm" />
          {t("rooms.card.hostedBy", {
            name: room.host.id === "u-me" ? t("rooms.you") : room.host.name,
          })}
        </span>
        <Button
          asChild
          size="sm"
          variant={room.status === "open" ? "primary" : "secondary"}
          trailingIcon={<ArrowRight weight="bold" className="h-3.5 w-3.5" />}
        >
          <Link to={`/rooms/${room.id}`}>
            {room.status === "in-progress"
              ? t("rooms.card.rejoin")
              : t("rooms.card.takeSeat")}
          </Link>
        </Button>
      </div>
    </Card>
  );
}
