import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Crown,
  UsersThree,
  Info,
  ArrowsClockwise,
  Prescription,
  Syringe,
  CheckCircle,
  ArrowsLeftRight,
} from "@phosphor-icons/react";

import { cn } from "@/lib/cn";
import { Card, SectionLabel } from "@/components/ui";
import { acsDebrief, type DebriefData, type DebriefMark } from "@/data/rooms";
import type { Lang } from "@/data/schema";

/** The collaborative order→execution loop, earned from the live session. */
export interface DebriefLoopStats {
  ordersPlaced: number;
  tasksDone: number;
  tasksTotal: number;
  medsGiven: number;
  handoffs: number;
}

export interface DebriefPanelProps {
  lang: Lang;
  /** Debrief marks to render. Defaults to the ACS drill fixture. */
  data?: DebriefData;
  /** Whether this device wore the team-lead hat (overrides `data.woreHat`). */
  woreHat?: boolean;
  /** Live closed-loop tally from THIS session (shown as a real signal). */
  loopsClosed?: { closed: number; total: number };
  /** Live collaborative order→execution loop from the shared room case. */
  loop?: DebriefLoopStats;
  /** True once the session has ended; otherwise the marks are illustrative. */
  live?: boolean;
}

/**
 * DebriefPanel — the debrief (Screen 6.4). Two clearly SEPARATED columns: your
 * INDIVIDUAL leadership marks (only if you wore the team-lead hat) and the TEAM's
 * shared CLINICAL marks — so a strong leader on a weak team (or the reverse) is
 * legible, and the two are never conflated. AI-held roles are labelled and never
 * scored as humans. Bars pair a numeric label with the fill so the score is
 * never colour- or width-only. When a live session drives it, the closed-loop
 * tally the learner actually completed is surfaced as a real, earned signal.
 */
export function DebriefPanel({
  lang,
  data = acsDebrief,
  woreHat,
  loopsClosed,
  loop,
  live = false,
}: DebriefPanelProps) {
  const { t } = useTranslation();
  const showLeadership = woreHat ?? data.woreHat;

  return (
    <section
      aria-label={t("rooms.debrief.label")}
      className="flex flex-col gap-4 rounded-card border border-border bg-surface p-4"
    >
      <div>
        <h2 className="text-[1.0625rem] text-fg">{t("rooms.debrief.title")}</h2>
        <p className="mt-1 text-xs text-muted">{t("rooms.debrief.subtitle")}</p>
      </div>

      {/* Live closed-loop signal earned this session */}
      {loopsClosed ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-control bg-inset px-3 py-2.5">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-fg">
            <ArrowsClockwise weight="bold" className="h-3.5 w-3.5 text-brand" aria-hidden />
            {t("rooms.debrief.loopsClosed")}
          </span>
          <span className="tnum text-sm font-semibold text-fg">
            {t("rooms.debrief.loopsValue", { closed: loopsClosed.closed, total: loopsClosed.total })}
          </span>
        </div>
      ) : null}

      {/* Live collaborative order→execution loop */}
      {loop ? (
        <div className="rounded-control border border-border bg-inset p-3">
          <SectionLabel icon={<ArrowsLeftRight weight="bold" className="h-3.5 w-3.5 text-brand" aria-hidden />}>
            {t("roomscollab.debrief.loopTitle")}
          </SectionLabel>
          <dl className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <LoopStat
              icon={<Prescription weight="bold" className="h-4 w-4" aria-hidden />}
              label={t("roomscollab.debrief.ordersPlaced")}
              value={String(loop.ordersPlaced)}
            />
            <LoopStat
              icon={<CheckCircle weight="bold" className="h-4 w-4" aria-hidden />}
              label={t("roomscollab.debrief.tasksExecuted")}
              value={`${loop.tasksDone}/${loop.tasksTotal}`}
            />
            <LoopStat
              icon={<Syringe weight="bold" className="h-4 w-4" aria-hidden />}
              label={t("roomscollab.debrief.medsGiven")}
              value={String(loop.medsGiven)}
            />
            <LoopStat
              icon={<ArrowsLeftRight weight="bold" className="h-4 w-4" aria-hidden />}
              label={t("roomscollab.debrief.handoffs")}
              value={String(loop.handoffs)}
            />
          </dl>
          <p className="mt-2.5 text-[11px] leading-relaxed text-muted">
            {t("roomscollab.debrief.note")}
          </p>
        </div>
      ) : null}

      {!live ? (
        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted">
          <Info weight="bold" className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {t("rooms.debrief.pending")}
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {/* Individual leadership marks */}
        <Card variant="inset" padding="sm">
          <SectionLabel
            icon={<Crown weight="fill" className="h-3.5 w-3.5 text-brand" aria-hidden />}
          >
            {t("rooms.debrief.individual")}
          </SectionLabel>
          {showLeadership ? (
            <ul className="mt-3 flex flex-col gap-3">
              {data.leadership.map((m, i) => (
                <MarkRow key={i} mark={m} lang={lang} axis="communication" />
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs text-muted">{t("rooms.debrief.noHat")}</p>
          )}
        </Card>

        {/* Team clinical marks */}
        <Card variant="inset" padding="sm">
          <SectionLabel
            icon={<UsersThree weight="fill" className="h-3.5 w-3.5" aria-hidden />}
          >
            {t("rooms.debrief.team")}
          </SectionLabel>
          <ul className="mt-3 flex flex-col gap-3">
            {data.teamClinical.map((m, i) => (
              <MarkRow key={i} mark={m} lang={lang} axis="clinical" />
            ))}
          </ul>
        </Card>
      </div>

      <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted">
        <Info weight="bold" className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        {t("rooms.debrief.note")}
      </p>
    </section>
  );
}

function LoopStat({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-control bg-surface px-2.5 py-2">
      <span className="inline-flex items-center gap-1 text-muted">{icon}</span>
      <span className="font-mono text-lg font-semibold leading-none tabular-nums text-fg">{value}</span>
      <span className="text-[11px] leading-tight text-muted">{label}</span>
    </div>
  );
}

function MarkRow({
  mark,
  lang,
  axis,
}: {
  mark: DebriefMark;
  lang: Lang;
  axis: "clinical" | "communication";
}) {
  const color = axis === "clinical" ? "var(--axis-clinical)" : "var(--axis-communication)";
  return (
    <li>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-fg">{mark.label[lang]}</span>
        <span className="font-mono text-sm font-semibold tabular-nums text-fg">
          {mark.score}
          <span className="text-xs font-medium text-muted">/100</span>
        </span>
      </div>
      <div
        className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-border"
        role="img"
        aria-label={`${mark.label[lang]}: ${mark.score}/100`}
      >
        <span
          className={cn("block h-full rounded-full")}
          style={{ width: `${mark.score}%`, backgroundColor: color }}
        />
      </div>
      <p className="mt-1 text-xs text-muted">{mark.note[lang]}</p>
    </li>
  );
}
