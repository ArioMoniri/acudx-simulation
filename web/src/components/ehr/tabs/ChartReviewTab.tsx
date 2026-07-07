import { useTranslation } from "react-i18next";
import {
  ChatCircleText,
  Stethoscope,
  Flask,
  ClipboardText,
  ListChecks,
  FileText,
} from "@phosphor-icons/react";

import { Card } from "@/components/ui";
import { minutesOf, pick } from "../labels";
import { useEncounterState } from "@/state/encounterStore";
import type { EncounterEvent, EncounterEventType } from "@/state/encounterStore";
import type { Lang } from "@/data/mock";
import type { CaseInstance } from "@/domain/case";

export interface ChartReviewTabProps {
  caseInstance: CaseInstance;
  lang: Lang;
}

const EVENT_ICON: Record<EncounterEventType, React.ReactNode> = {
  question: <ChatCircleText weight="bold" className="h-3.5 w-3.5" />,
  exam: <Stethoscope weight="bold" className="h-3.5 w-3.5" />,
  order: <Flask weight="bold" className="h-3.5 w-3.5" />,
  result: <FileText weight="bold" className="h-3.5 w-3.5" />,
  diagnosis: <ListChecks weight="bold" className="h-3.5 w-3.5" />,
  note: <ClipboardText weight="bold" className="h-3.5 w-3.5" />,
  stage: <ClipboardText weight="bold" className="h-3.5 w-3.5" />,
};

/**
 * ChartReviewTab — read-only prior context: the triage note (given at start)
 * plus the encounter timeline derived from the event-sourced log. The timeline
 * is exactly what the process-metrics layer scores against (docs §4), surfaced
 * here so the student can see their own trail of actions in order.
 */
export function ChartReviewTab({ caseInstance, lang }: ChartReviewTabProps) {
  const { t } = useTranslation();
  const state = useEncounterState();
  const { encounter, triageVitals, patient } = caseInstance;

  // Show meaningful actions in causal order; skip the initial stage anchor.
  const timeline = [...state.events]
    .filter((e) => e.type !== "stage")
    .sort((a, b) => a.seq - b.seq);

  return (
    <div className="flex flex-col gap-4">
      {/* Triage note (available prior context) */}
      <Card padding="md">
        <h3 className="mb-1 text-sm font-semibold text-fg">
          {t("ehr.chartReview.triageNote")}
        </h3>
        <p className="text-xs text-muted">
          {t("ehr.chartReview.triageMeta", {
            class: t(`ehr.encounterClass.${encounter.class}`),
          })}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-fg">
          {t("ehr.chartReview.triageBody", {
            age: patient.ageYears,
            complaint: pick(encounter.reason, lang),
          })}
        </p>
        <p className="mt-2 font-mono text-xs text-muted">
          {t("vitals.hrShort")} {triageVitals.hr} · {t("vitals.bpShort")}{" "}
          {triageVitals.systolic}/{triageVitals.diastolic} · {t("vitals.rrShort")}{" "}
          {triageVitals.rr} · {t("vitals.spo2Short")} {triageVitals.spo2}% ·{" "}
          {t("vitals.tempShort")} {triageVitals.tempC.toFixed(1)}
          {t("vitals.units.celsius")}
        </p>
      </Card>

      {/* Encounter timeline (from the event log) */}
      <Card padding="md">
        <h3 className="mb-3 text-sm font-semibold text-fg">
          {t("ehr.chartReview.timeline")}
        </h3>
        {timeline.length === 0 ? (
          <p className="text-xs italic text-muted">
            {t("ehr.chartReview.timelineEmpty")}
          </p>
        ) : (
          <ol className="flex flex-col">
            {timeline.map((ev) => (
              <TimelineRow key={ev.seq} ev={ev} label={describeEvent(ev, t)} />
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

function TimelineRow({
  ev,
  label,
}: {
  ev: EncounterEvent;
  label: string;
}) {
  const { t } = useTranslation();
  return (
    <li className="flex items-start gap-2.5 border-l border-border py-1.5 pl-3">
      <span
        aria-hidden
        className="-ml-[1.4rem] mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-border bg-surface text-muted"
      >
        {EVENT_ICON[ev.type]}
      </span>
      <span className="min-w-0 flex-1 text-sm text-fg">{label}</span>
      <span className="shrink-0 font-mono text-xs tabular-nums text-muted">
        {t("ehr.chartReview.atMin", { min: minutesOf(ev.at) })}
      </span>
    </li>
  );
}

/** Human-readable one-liner for a timeline event. */
function describeEvent(
  ev: EncounterEvent,
  t: (k: string, o?: Record<string, unknown>) => string,
): string {
  const ref = ev.ref;
  switch (ev.type) {
    case "question":
      return t("ehr.timeline.question", {
        intent: t(`ehr.intents.${camel(ref)}`, { defaultValue: ref }),
      });
    case "exam":
      return t("ehr.timeline.exam", {
        maneuver: t(`ehr.maneuvers.${camel(ref)}`, { defaultValue: ref }),
      });
    case "order":
      return t("ehr.timeline.order", { code: ref });
    case "result":
      return t("ehr.timeline.result", { code: ref });
    case "diagnosis":
      return t("ehr.timeline.diagnosis", {
        dx: (ev.meta?.display as string) ?? ref,
      });
    case "note":
      return t("ehr.timeline.note");
    default:
      return ref;
  }
}

function camel(s: string): string {
  return s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}
