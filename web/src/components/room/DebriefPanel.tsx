import { useTranslation } from "react-i18next";
import { Crown, UsersThree, Info } from "@phosphor-icons/react";

import { cn } from "@/lib/cn";
import { acsDebrief, type DebriefMark } from "@/data/rooms";
import type { Lang } from "@/data/mock";

export interface DebriefPanelProps {
  lang: Lang;
}

/**
 * DebriefPanel — the debrief stub (Screen 6.4). Two clearly SEPARATED columns:
 * your INDIVIDUAL leadership marks (only if you wore the team-lead hat) and the
 * TEAM's shared CLINICAL marks — so a strong leader on a weak team (or the
 * reverse) is legible, and the two are never conflated. AI-held roles are
 * labelled and never scored as humans. Bars pair a numeric label with the fill
 * so the score is never colour- or width-only.
 */
export function DebriefPanel({ lang }: DebriefPanelProps) {
  const { t } = useTranslation();
  const data = acsDebrief;

  return (
    <section
      aria-label={t("rooms.debrief.label")}
      className="flex flex-col gap-4 rounded-card border border-border bg-surface p-4"
    >
      <div>
        <h2 className="text-sm font-semibold text-fg">{t("rooms.debrief.title")}</h2>
        <p className="mt-1 text-xs text-muted">{t("rooms.debrief.subtitle")}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Individual leadership marks */}
        <div className="rounded-control border border-border bg-bg-subtle p-3.5">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
            <Crown weight="fill" className="h-3.5 w-3.5 text-brand" aria-hidden />
            {t("rooms.debrief.individual")}
          </h3>
          {data.woreHat ? (
            <ul className="mt-3 flex flex-col gap-3">
              {data.leadership.map((m, i) => (
                <MarkRow key={i} mark={m} lang={lang} axis="communication" />
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs text-muted">{t("rooms.debrief.noHat")}</p>
          )}
        </div>

        {/* Team clinical marks */}
        <div className="rounded-control border border-border bg-bg-subtle p-3.5">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
            <UsersThree weight="fill" className="h-3.5 w-3.5" aria-hidden />
            {t("rooms.debrief.team")}
          </h3>
          <ul className="mt-3 flex flex-col gap-3">
            {data.teamClinical.map((m, i) => (
              <MarkRow key={i} mark={m} lang={lang} axis="clinical" />
            ))}
          </ul>
        </div>
      </div>

      <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted">
        <Info weight="bold" className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        {t("rooms.debrief.note")}
      </p>
    </section>
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
