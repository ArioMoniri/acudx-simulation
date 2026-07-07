import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { VitalCard } from "@/components/VitalCard";
import { stateMap } from "@/components/clinicalState";
import { PatientPortrait } from "@/components/PatientPortrait";
import { EncounterClock } from "../EncounterClock";
import { minutesOf } from "../labels";
import type {
  ClinicalState,
  Trend,
  VitalReading,
  Lang,
} from "@/data/mock";
import type {
  CaseInstance,
  TriageVitals,
  VitalsTrajectoryPoint,
} from "@/domain/case";

export interface FlowsheetTabProps {
  caseInstance: CaseInstance;
  lang: Lang;
  affectLabel: string;
}

/* -------------------------------------------------------------------------- */
/* Vitals -> ClinicalState (color-independent status; icon + label carry it)  */
/* -------------------------------------------------------------------------- */

function hrState(hr: number): ClinicalState {
  if (hr >= 130 || hr < 40) return "critical";
  if (hr >= 110 || hr < 50) return "warning";
  if (hr >= 100 || hr < 60) return "caution";
  return "normal";
}
function bpState(sys: number): ClinicalState {
  if (sys >= 200 || sys < 80) return "critical";
  if (sys >= 180 || sys < 90) return "warning";
  if (sys >= 160 || sys <= 100) return "caution";
  return "normal";
}
function rrState(rr: number): ClinicalState {
  if (rr >= 30 || rr < 8) return "critical";
  if (rr >= 24 || rr < 10) return "warning";
  if (rr >= 21 || rr < 12) return "caution";
  return "normal";
}
function spo2State(spo2: number): ClinicalState {
  if (spo2 < 88) return "critical";
  if (spo2 < 92) return "warning";
  if (spo2 < 95) return "caution";
  return "normal";
}
function tempState(t: number): ClinicalState {
  if (t >= 39.5 || t < 35) return "critical";
  if (t >= 38.5 || t < 35.5) return "warning";
  if (t >= 37.8 || t < 36) return "caution";
  return "normal";
}

function trendOf(series: number[]): Trend {
  if (series.length < 2) return "steady";
  const delta = series[series.length - 1] - series[0];
  if (Math.abs(delta) < 1) return "steady";
  return delta > 0 ? "rising" : "falling";
}

/** Build the five monitor VitalReadings from triage + trajectory history. */
function buildReadings(
  triage: TriageVitals,
  trajectory: VitalsTrajectoryPoint[],
): VitalReading[] {
  const hrHist = trajectory.map((p) => p.hr);
  const sysHist = trajectory.map((p) => p.systolic);
  const rrHist = trajectory.map((p) => p.rr);
  const spo2Hist = trajectory.map((p) => p.spo2);
  const tempHist = trajectory.map((p) => p.tempC);

  return [
    {
      key: "hr",
      labelKey: "hr",
      shortKey: "hrShort",
      value: String(triage.hr),
      unitKey: "bpm",
      history: hrHist.length ? hrHist : [triage.hr],
      state: hrState(triage.hr),
      trend: trendOf(hrHist),
    },
    {
      key: "bp",
      labelKey: "bp",
      shortKey: "bpShort",
      value: `${triage.systolic}/${triage.diastolic}`,
      history: sysHist.length ? sysHist : [triage.systolic],
      state: bpState(triage.systolic),
      trend: trendOf(sysHist),
    },
    {
      key: "rr",
      labelKey: "rr",
      shortKey: "rrShort",
      value: String(triage.rr),
      unitKey: "brpm",
      history: rrHist.length ? rrHist : [triage.rr],
      state: rrState(triage.rr),
      trend: trendOf(rrHist),
    },
    {
      key: "spo2",
      labelKey: "spo2",
      shortKey: "spo2Short",
      value: String(triage.spo2),
      unitKey: "percent",
      history: spo2Hist.length ? spo2Hist : [triage.spo2],
      state: spo2State(triage.spo2),
      trend: trendOf(spo2Hist),
    },
    {
      key: "temp",
      labelKey: "temp",
      shortKey: "tempShort",
      value: triage.tempC.toFixed(1),
      unitKey: "celsius",
      history: tempHist.length ? tempHist : [triage.tempC],
      state: tempState(triage.tempC),
      trend: trendOf(tempHist),
    },
  ];
}

/**
 * FlowsheetTab — the live dark vitals monitor (reused VitalCard) plus a nursing
 * flowsheet: vitals over time as a mono / tabular-nums table (docs §2.2). Status
 * is carried by an icon + text label per cell, never color alone (WCAG 1.4.1);
 * the whole monitor also has a visually-hidden table equivalent.
 */
export function FlowsheetTab({ caseInstance, affectLabel }: FlowsheetTabProps) {
  const { t } = useTranslation();
  const { triageVitals, groundTruth } = caseInstance;
  const trajectory = groundTruth.vitalsTrajectory;

  const readings = useMemo(
    () => buildReadings(triageVitals, trajectory),
    [triageVitals, trajectory],
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,360px)_1fr]">
      {/* Dark vitals monitor */}
      <section
        aria-label={t("vitals.title")}
        className="rounded-card border p-4"
        style={{
          backgroundColor: "var(--monitor-bg)",
          borderColor: "var(--monitor-border)",
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5" aria-hidden>
              <span
                className="absolute inline-flex h-full w-full rounded-full opacity-75 motion-safe:animate-ping"
                style={{ backgroundColor: "var(--monitor-online)" }}
              />
              <span
                className="relative inline-flex h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: "var(--monitor-online)" }}
              />
            </span>
            <span
              className="text-xs font-semibold uppercase tracking-wide"
              style={{ color: "var(--monitor-online)" }}
            >
              {t("vitals.online")}
            </span>
          </div>
          <EncounterClock variant="inline" onDark />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2.5">
          {readings.map((v) => (
            <VitalCard key={v.key} vital={v} />
          ))}
        </div>

        {/* Visually-hidden table equivalent for the monitor snapshot */}
        <table className="sr-only">
          <caption>{t("vitals.table.caption")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("vitals.table.vital")}</th>
              <th scope="col">{t("vitals.table.value")}</th>
              <th scope="col">{t("vitals.table.status")}</th>
              <th scope="col">{t("vitals.table.trend")}</th>
            </tr>
          </thead>
          <tbody>
            {readings.map((v) => (
              <tr key={v.key}>
                <th scope="row">{t(`vitals.${v.labelKey}`)}</th>
                <td>
                  {v.value}
                  {v.unitKey ? ` ${t(`vitals.units.${v.unitKey}`)}` : ""}
                </td>
                <td>{t(`states.${v.state}`)}</td>
                <td>{t(`vitals.trend.${v.trend}`)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-3">
          <PatientPortrait
            caption={affectLabel}
            name={caseInstance.patient.name}
          />
        </div>
      </section>

      {/* Flowsheet — vitals over time */}
      <section className="overflow-hidden rounded-card border border-border bg-surface">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-fg">
            {t("ehr.flowsheet.title")}
          </h3>
          <p className="text-xs text-muted">{t("ehr.flowsheet.subtitle")}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <caption className="sr-only">{t("ehr.flowsheet.caption")}</caption>
            <thead>
              <tr className="border-b border-border text-left">
                <th scope="col" className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
                  {t("ehr.flowsheet.time")}
                </th>
                {["hrShort", "bpShort", "rrShort", "spo2Short", "tempShort"].map((k) => (
                  <th
                    key={k}
                    scope="col"
                    className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted"
                  >
                    {t(`vitals.${k}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {trajectory.map((p, i) => (
                <FlowsheetRow key={i} point={p} minLabel={t("ehr.flowsheet.minute", { min: minutesOf(p.atMs) })} />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/** One flowsheet row. Each cell pairs the value with a status icon + sr label. */
function FlowsheetRow({
  point,
  minLabel,
}: {
  point: VitalsTrajectoryPoint;
  minLabel: string;
}) {
  const { t } = useTranslation();

  const cells: { value: string; state: ClinicalState }[] = [
    { value: String(point.hr), state: hrState(point.hr) },
    { value: `${point.systolic}/${point.diastolic}`, state: bpState(point.systolic) },
    { value: String(point.rr), state: rrState(point.rr) },
    { value: String(point.spo2), state: spo2State(point.spo2) },
    { value: point.tempC.toFixed(1), state: tempState(point.tempC) },
  ];

  return (
    <tr className="border-b border-border last:border-b-0">
      <th
        scope="row"
        className="whitespace-nowrap px-3 py-2 text-left font-mono text-xs tabular-nums text-muted"
      >
        {minLabel}
      </th>
      {cells.map((c, i) => {
        const present = stateMap[c.state];
        const Icon = present.icon;
        return (
          <td key={i} className="px-3 py-2">
            <span className="inline-flex items-center gap-1.5 font-mono tabular-nums text-fg">
              {c.value}
              <Icon
                weight="fill"
                className="h-3.5 w-3.5 shrink-0"
                style={{ color: present.colorVar }}
                aria-hidden
              />
              <span className="sr-only">{t(present.labelKey)}</span>
            </span>
          </td>
        );
      })}
    </tr>
  );
}
