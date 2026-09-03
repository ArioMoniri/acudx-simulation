import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import {
  ChatCircleText,
  Stethoscope,
  Flask,
  ClipboardText,
  ListChecks,
  FileText,
  Compass,
  ArrowsClockwise,
  Circle,
} from "@phosphor-icons/react";

import { Card } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useStagger } from "@/lib/motion";
import { minutesOf, pick } from "../labels";
import { getOffTaskCount, useEncounterState } from "@/state/encounterStore";
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

type FilterKey = "all" | "question" | "exam" | "order" | "result";

const FILTERS: { key: FilterKey; labelKey: string }[] = [
  { key: "all", labelKey: "ehr2.chartReview.filterAll" },
  { key: "question", labelKey: "ehr2.chartReview.filterQuestions" },
  { key: "exam", labelKey: "ehr2.chartReview.filterExam" },
  { key: "order", labelKey: "ehr2.chartReview.filterOrders" },
  { key: "result", labelKey: "ehr2.chartReview.filterResults" },
];

/**
 * ChartReviewTab — read-only prior context: the triage note (given at start)
 * plus the encounter timeline derived from the event-sourced log. An activity
 * summary counts the moves made so far (and any off-task drift), and the
 * timeline can be filtered by activity type. The timeline is exactly what the
 * process-metrics layer scores against (docs §4); process-aware markers such as
 * "repeated" or "no new information" surface here so the student can see their
 * own trail of actions in order.
 */
export function ChartReviewTab({ caseInstance, lang }: ChartReviewTabProps) {
  const { t } = useTranslation();
  const state = useEncounterState();
  const { encounter, triageVitals, patient } = caseInstance;
  const [filter, setFilter] = useState<FilterKey>("all");

  // Show meaningful actions in causal order; skip the initial stage anchor.
  const timeline = useMemo(
    () =>
      [...state.events].filter((e) => e.type !== "stage").sort((a, b) => a.seq - b.seq),
    [state.events],
  );

  const counts = useMemo(() => {
    const c = { question: 0, exam: 0, order: 0, result: 0 };
    for (const e of timeline) {
      if (e.type in c) c[e.type as keyof typeof c] += 1;
    }
    return c;
  }, [timeline]);

  const offTask = getOffTaskCount(state);

  const shown = filter === "all" ? timeline : timeline.filter((e) => e.type === filter);

  const { container, item } = useStagger();

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

      {/* Activity summary */}
      <Card padding="md">
        <h3 className="mb-3 text-sm font-semibold text-fg">
          {t("ehr2.chartReview.summaryHeading")}
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <ActivityStat icon={<ChatCircleText weight="bold" className="h-4 w-4" />} value={counts.question} label={t("ehr2.chartReview.questions")} />
          <ActivityStat icon={<Stethoscope weight="bold" className="h-4 w-4" />} value={counts.exam} label={t("ehr2.chartReview.exams")} />
          <ActivityStat icon={<Flask weight="bold" className="h-4 w-4" />} value={counts.order} label={t("ehr2.chartReview.orders")} />
          <ActivityStat icon={<FileText weight="bold" className="h-4 w-4" />} value={counts.result} label={t("ehr2.chartReview.results")} />
        </div>
        {offTask > 0 ? (
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-control bg-bg-subtle px-2.5 py-1.5 text-xs text-muted">
            <Compass weight="bold" className="h-3.5 w-3.5" aria-hidden />
            <span className="font-medium text-fg">{offTask}</span>
            {t("ehr2.chartReview.offTask")}
            <span className="text-muted/80">· {t("ehr2.chartReview.offTaskHint")}</span>
          </p>
        ) : null}
      </Card>

      {/* Encounter timeline (from the event log) */}
      <Card padding="md">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-fg">
            {t("ehr.chartReview.timeline")}
          </h3>
          {timeline.length > 0 ? (
            <div
              role="group"
              aria-label={t("ehr2.chartReview.filterLabel")}
              className="flex flex-wrap items-center gap-1"
            >
              {FILTERS.map((f) => {
                const active = filter === f.key;
                return (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setFilter(f.key)}
                    aria-pressed={active}
                    className={cn(
                      "rounded-full px-2.5 py-1 text-xs font-medium",
                      "transition-colors duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                      active
                        ? "bg-brand text-white"
                        : "border border-border bg-surface text-muted hover:bg-bg-subtle hover:text-fg",
                    )}
                  >
                    {t(f.labelKey)}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        {timeline.length === 0 ? (
          <p className="text-xs italic text-muted">
            {t("ehr.chartReview.timelineEmpty")}
          </p>
        ) : shown.length === 0 ? (
          <p className="text-xs italic text-muted">
            {t("ehr2.chartReview.emptyFiltered")}
          </p>
        ) : (
          <motion.ol {...container} className="flex flex-col">
            {shown.map((ev) => (
              <motion.li key={ev.seq} {...item}>
                <TimelineRow ev={ev} label={describeEvent(ev, t)} />
              </motion.li>
            ))}
          </motion.ol>
        )}
      </Card>
    </div>
  );
}

/** A labeled count in the activity summary. */
function ActivityStat({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-control border border-border bg-bg-subtle px-3 py-2">
      <span aria-hidden className="text-muted">
        {icon}
      </span>
      <span className="flex flex-col leading-tight">
        <span className="font-mono text-lg font-semibold tabular-nums text-fg">
          {value}
        </span>
        <span className="text-[11px] text-muted">{label}</span>
      </span>
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

  // Process-aware markers (from the event-sourced meta). Never leak diagnostic
  // correctness here; only surface neutral process signals.
  const redundant = ev.meta?.redundant === true;
  const noNewInfo =
    (ev.type === "question" || ev.type === "exam") && ev.meta?.hit === false;

  return (
    <li className="flex items-start gap-2.5 border-l border-border py-1.5 pl-3">
      <span
        aria-hidden
        className="-ml-[1.4rem] mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-border bg-surface text-muted"
      >
        {EVENT_ICON[ev.type]}
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-sm text-fg">{label}</span>
        {redundant || noNewInfo ? (
          <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-bg-subtle px-1.5 py-px text-[10px] font-medium text-muted align-middle">
            {redundant ? (
              <ArrowsClockwise weight="bold" className="h-3 w-3" aria-hidden />
            ) : (
              <Circle weight="bold" className="h-2.5 w-2.5" aria-hidden />
            )}
            {redundant
              ? t("ehr2.chartReview.repeated")
              : t("ehr2.chartReview.noNewInfo")}
          </span>
        ) : null}
      </span>
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
