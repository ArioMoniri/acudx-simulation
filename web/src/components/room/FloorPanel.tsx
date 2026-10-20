import { useTranslation } from "react-i18next";
import {
  ArrowBendUpLeft,
  CheckCircle,
  Repeat,
  Broadcast,
  ArrowFatUp,
  ClipboardText,
  Stethoscope,
  Lock,
} from "@phosphor-icons/react";

import { cn } from "@/lib/cn";
import { RoleAvatar } from "./RoleAvatar";
import { ROLE_ICON } from "./roleMeta";
import {
  effectiveHolder,
  type Room,
  type FloorEvent,
  type FloorEventKind,
} from "@/data/rooms";
import type { Lang } from "@/data/schema";

export interface FloorPanelProps {
  room: Room;
  events: FloorEvent[];
  lang: Lang;
  /** True for an utterance that is still awaiting the learner's read-back. */
  openLoopId: string | null;
  /** Acknowledge / read back the open-loop utterance (closes the loop). */
  onCloseLoop: (id: string) => void;
}

const KIND_ICON: Record<FloorEventKind, typeof CheckCircle> = {
  handover: ClipboardText,
  order: Stethoscope,
  ack: CheckCircle,
  readback: Repeat,
  escalate: ArrowFatUp,
  assess: Broadcast,
};

/**
 * FloorPanel — the room's shared floor (Screen 6.3): a running transcript of
 * turns with each speaker's role + human/AI attribution, and the closed-loop
 * communication affordance. An order awaiting confirmation shows an "acknowledge
 * / read-back" control; acting on it closes the loop and the locked clinical
 * token (drug + dose) is read back verbatim. AI turns are labelled in text.
 */
export function FloorPanel({
  room,
  events,
  lang,
  openLoopId,
  onCloseLoop,
}: FloorPanelProps) {
  const { t } = useTranslation();

  return (
    <section
      aria-label={t("rooms.inroom.floorLabel")}
      className="flex min-h-[360px] flex-col rounded-card border border-border bg-surface"
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Broadcast weight="bold" className="h-4 w-4 text-brand" aria-hidden />
        <h2 className="text-[1.0625rem] text-fg">{t("rooms.inroom.floor")}</h2>
      </div>

      <ol
        tabIndex={0}
        aria-label={t("rooms.inroom.floor")}
        className="flex flex-1 flex-col gap-3 overflow-y-auto p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        {events.map((ev) => {
          const seat = room.seats.find((s) => s.role === ev.role);
          const holder = seat ? effectiveHolder(seat, room.aiBackfill) : null;
          const RoleIcon = ROLE_ICON[ev.role];
          const KindIcon = KIND_ICON[ev.kind];
          const isOpenLoop = ev.id === openLoopId;

          return (
            <li key={ev.id} className="flex gap-2.5">
              {holder ? (
                <RoleAvatar participant={holder} size="sm" />
              ) : (
                <span
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-bg-subtle text-muted"
                  aria-hidden
                >
                  <RoleIcon weight="bold" className="h-4 w-4" />
                </span>
              )}

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="font-semibold text-fg">{t(`rooms.role.${ev.role}`)}</span>
                  {ev.ai ? (
                    <span className="rounded-full bg-brand-tint px-1.5 py-0.5 font-medium text-brand">
                      {t("rooms.seat.aiHeld")}
                    </span>
                  ) : null}
                  <span className="inline-flex items-center gap-1 text-muted">
                    <KindIcon weight="bold" className="h-3 w-3" aria-hidden />
                    {t(`rooms.floorKind.${ev.kind}`)}
                  </span>
                  <span className="font-mono tabular-nums text-muted">{ev.at}</span>
                </div>

                <p className="mt-1 text-sm text-fg">{ev.text[lang]}</p>

                {/* Locked clinical token — must be read back verbatim */}
                {ev.lockedToken ? (
                  <span className="mt-1.5 inline-flex items-center gap-1 rounded-control border border-border bg-bg-subtle px-2 py-0.5 font-mono text-xs font-medium text-fg">
                    <Lock weight="bold" className="h-3 w-3 text-muted" aria-hidden />
                    {ev.lockedToken}
                  </span>
                ) : null}

                {/* Closed-loop status */}
                {ev.loop === "closed" ? (
                  <span className="mt-1.5 flex items-center gap-1 text-xs font-medium text-[color:var(--state-normal)]">
                    <CheckCircle weight="fill" className="h-3.5 w-3.5" aria-hidden />
                    {t("rooms.inroom.loopClosed")}
                  </span>
                ) : isOpenLoop ? (
                  <button
                    type="button"
                    onClick={() => onCloseLoop(ev.id)}
                    className={cn(
                      "mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-control border px-3 text-xs font-medium",
                      "border-brand bg-brand-tint text-brand transition-colors duration-200",
                      "hover:bg-brand hover:text-on-brand focus-visible:outline-none active:scale-[0.98]",
                    )}
                  >
                    <ArrowBendUpLeft weight="bold" className="h-3.5 w-3.5" aria-hidden />
                    {ev.lockedToken
                      ? t("rooms.inroom.readBackToken", { token: ev.lockedToken })
                      : t("rooms.inroom.acknowledge")}
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      <p className="border-t border-border px-4 py-2.5 text-[11px] leading-relaxed text-muted">
        {t("rooms.inroom.floorNote")}
      </p>
    </section>
  );
}
