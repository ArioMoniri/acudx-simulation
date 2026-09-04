import { useTranslation } from "react-i18next";
import { ArrowsLeftRight, ArrowRight, Path } from "@phosphor-icons/react";

import { Button } from "@/components/ui";
import { CLINICAL_ROLE_ORDER, type ClinicalRole } from "@/data/rooms";
import { handoff, type RoomCaseState } from "./roomCaseStore";
import type { Lang } from "@/data/mock";

export interface HandoffTimelineProps {
  roomId: string;
  state: RoomCaseState;
  actingRole: ClinicalRole;
  lang: Lang;
}

/** Format an encounter-clock offset (ms) as mm:ss. */
function mmss(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * HandoffTimeline — the shared record of who holds control and every role→role
 * pass. The acting role hands control to a teammate (paramedic → doctor →
 * nurse), and each pass is banked on the timeline as team-communication
 * evidence for the debrief. Directions and holders are text-labelled, never
 * colour alone.
 */
export function HandoffTimeline({ roomId, state, actingRole, lang }: HandoffTimelineProps) {
  const { t } = useTranslation();
  const roleName = (r: ClinicalRole) => t(`roomscollab.roles.${r}`);
  const targets = CLINICAL_ROLE_ORDER.filter((r) => r !== actingRole);

  return (
    <section
      aria-label={t("roomscollab.handoff.title")}
      className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
    >
      <div className="flex items-center gap-2">
        <ArrowsLeftRight weight="bold" className="h-4 w-4 text-brand" aria-hidden />
        <h2 className="text-sm font-semibold text-fg">{t("roomscollab.handoff.title")}</h2>
      </div>

      {/* Who holds control now */}
      <p className="text-xs text-muted">
        {t("roomscollab.handoff.holds", { role: roleName(state.floorRole) })}
      </p>

      {/* Pass control to a teammate */}
      <div className="flex flex-wrap gap-1.5">
        {targets.map((role) => (
          <Button
            key={role}
            size="sm"
            variant="secondary"
            onClick={() => handoff(roomId, actingRole, role)}
            aria-label={t("roomscollab.handoff.passAria", { role: roleName(role) })}
            leadingIcon={<ArrowRight weight="bold" className="h-3.5 w-3.5" />}
          >
            {t("roomscollab.handoff.pass", { role: roleName(role) })}
          </Button>
        ))}
      </div>

      {/* Recorded handoffs */}
      <div>
        <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">
          <Path weight="bold" className="h-3 w-3" aria-hidden />
          {t("roomscollab.handoff.timeline")}
        </div>
        {state.handoffs.length === 0 ? (
          <p className="mt-2 text-xs text-muted">{t("roomscollab.handoff.empty")}</p>
        ) : (
          <ol className="mt-2 flex flex-col gap-2">
            {state.handoffs.map((h) => (
              <li key={h.id} className="flex gap-2 text-xs">
                <span className="mt-0.5 font-mono tabular-nums text-muted">{mmss(h.at)}</span>
                <span className="min-w-0">
                  <span className="font-medium text-fg">
                    {t("roomscollab.handoff.arrow", {
                      from: roleName(h.from),
                      role: roleName(h.to),
                    })}
                  </span>
                  <span className="mt-0.5 block text-muted">{h.note[lang]}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
