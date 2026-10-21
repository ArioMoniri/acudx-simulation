import { useTranslation } from "react-i18next";
import { Broadcast, Heartbeat } from "@phosphor-icons/react";

import { cn } from "@/lib/cn";
import type { CaseInstance } from "@/domain/case";
import type { CourseStatus, CurrentVitals } from "@/domain/clinicalCourse";

export interface CompactVitalsProps {
  caseInstance: CaseInstance;
  /**
   * Live effective vitals from the shared room course. When provided, the
   * monitor shows the patient RESPONDING (baseline + treatments) instead of the
   * static triage snapshot, so a med the nurse administers is visible here.
   */
  live?: CurrentVitals | null;
  /** Coarse trend of the shared course, rendered as an icon + text pill. */
  status?: CourseStatus | null;
  className?: string;
}

interface MiniVital {
  short: string;
  value: string;
  unit?: string;
}

/** Trend → accent colour (meaning is ALSO carried by the text label). */
const STATUS_COLOR: Record<CourseStatus, string> = {
  improving: "var(--state-normal)",
  stable: "var(--monitor-online)",
  deteriorating: "var(--state-warning)",
  critical: "var(--state-critical)",
};

/**
 * CompactVitals — the ONE dark surface in the room view: a condensed vitals
 * monitor. It reads the same authoritative Case State every role sees — a static
 * triage snapshot by default, or the LIVE shared course when `live` is passed,
 * so a treatment the nurse administers changes what the whole team's monitor
 * shows. Kept dark in both themes via the --monitor-* tokens. Values are tabular
 * mono; a table-equivalent below carries the same readings for assistive tech
 * (WCAG 1.3.1).
 */
export function CompactVitals({ caseInstance, live, status, className }: CompactVitalsProps) {
  const { t } = useTranslation();
  const v = live ?? caseInstance.triageVitals;

  const items: MiniVital[] = [
    { short: t("vitals.hrShort"), value: String(v.hr), unit: t("vitals.units.bpm") },
    { short: t("vitals.bpShort"), value: `${v.systolic}/${v.diastolic}` },
    { short: t("vitals.rrShort"), value: String(v.rr), unit: t("vitals.units.brpm") },
    { short: t("vitals.spo2Short"), value: String(v.spo2), unit: t("vitals.units.percent") },
    { short: t("vitals.tempShort"), value: v.tempC.toFixed(1), unit: t("vitals.units.celsius") },
  ];

  return (
    <section
      aria-label={t("vitals.title")}
      data-testid="room-monitor"
      className={cn("rounded-card border p-3.5", className)}
      style={{
        backgroundColor: "var(--monitor-bg)",
        borderColor: "var(--monitor-border)",
      }}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2
          className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide"
          style={{ color: "var(--monitor-dim)" }}
        >
          {t("vitals.title")}
          <span
            className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold tracking-normal"
            style={{
              color: "var(--monitor-bg)",
              backgroundColor: live ? "var(--monitor-online)" : "var(--monitor-dim)",
            }}
          >
            {live ? t("roomscollab.vitals.live") : t("roomscollab.vitals.triage")}
          </span>
        </h2>
        <div className="flex items-center gap-2">
          {status ? (
            <span
              className="inline-flex items-center gap-1 text-[11px] font-semibold"
              style={{ color: STATUS_COLOR[status] }}
            >
              <Heartbeat weight="fill" className="h-3.5 w-3.5" aria-hidden />
              {t(`roomscollab.status.${status}`)}
            </span>
          ) : null}
          <span
            className="inline-flex items-center gap-1.5 text-[11px] font-medium"
            style={{ color: "var(--monitor-online)" }}
          >
            <Broadcast weight="fill" className="h-3 w-3 motion-safe:animate-pulse" aria-hidden />
            {t("vitals.online")}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5" aria-hidden>
        {items.map((it) => (
          <div
            key={it.short}
            className="rounded-control border p-2"
            style={{
              borderColor: "var(--monitor-border)",
              backgroundColor: "color-mix(in srgb, var(--monitor-fg) 4%, transparent)",
            }}
          >
            <p
              className="text-[10px] font-medium uppercase tracking-wide"
              style={{ color: "var(--monitor-dim)" }}
            >
              {it.short}
            </p>
            <p
              className="mt-0.5 flex items-baseline gap-0.5 font-mono text-xl font-semibold leading-none"
              style={{ color: "var(--monitor-fg)" }}
            >
              {it.value}
              {it.unit ? (
                <span className="text-[10px] font-medium" style={{ color: "var(--monitor-dim)" }}>
                  {it.unit}
                </span>
              ) : null}
            </p>
          </div>
        ))}
      </div>

      {/* Table equivalent for assistive tech */}
      <table className="sr-only">
        <caption>{t("vitals.table.caption")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("vitals.table.vital")}</th>
            <th scope="col">{t("vitals.table.value")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.short}>
              <th scope="row">{it.short}</th>
              <td>
                {it.value}
                {it.unit ? ` ${it.unit}` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
