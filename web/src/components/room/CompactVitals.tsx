import { useTranslation } from "react-i18next";
import { Broadcast } from "@phosphor-icons/react";

import { cn } from "@/lib/cn";
import type { CaseInstance } from "@/domain/case";

export interface CompactVitalsProps {
  caseInstance: CaseInstance;
  className?: string;
}

interface MiniVital {
  short: string;
  value: string;
  unit?: string;
}

/**
 * CompactVitals — the ONE dark surface in the room view: a condensed vitals
 * monitor built from the case triage vitals (the same authoritative Case State
 * every role reads — never a divergent copy). Kept dark in both themes via the
 * --monitor-* tokens. Values are tabular mono; a table-equivalent below carries
 * the same readings for assistive tech (WCAG 1.3.1).
 */
export function CompactVitals({ caseInstance, className }: CompactVitalsProps) {
  const { t } = useTranslation();
  const v = caseInstance.triageVitals;

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
      className={cn("rounded-card border p-3.5", className)}
      style={{
        backgroundColor: "var(--monitor-bg)",
        borderColor: "var(--monitor-border)",
      }}
    >
      <div className="mb-3 flex items-center justify-between">
        <h2
          className="text-xs font-semibold uppercase tracking-wide"
          style={{ color: "var(--monitor-dim)" }}
        >
          {t("vitals.title")}
        </h2>
        <span
          className="inline-flex items-center gap-1.5 text-[11px] font-medium"
          style={{ color: "var(--monitor-online)" }}
        >
          <Broadcast weight="fill" className="h-3 w-3 motion-safe:animate-pulse" aria-hidden />
          {t("vitals.online")}
        </span>
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
