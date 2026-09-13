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
  Pill,
  ClockCounterClockwise,
} from "@phosphor-icons/react";

import { Badge, Card, SectionLabel, Stat } from "@/components/ui";
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
  treatment: <Pill weight="bold" className="h-3.5 w-3.5" />,
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
 * ChartReviewTab — read-only prior context, rendered as a crisp clinical chart
 * summary in the Epic/AMBOSS record language: the triage note (given at start)
 * with a presenting-vitals monitor strip, an "activity so far" counter row, and
 * the encounter timeline derived from the event-sourced log. An activity summary
 * counts the moves made so far (and any off-task drift), and the timeline can be
 * filtered by activity type. The timeline is exactly what the process-metrics
 * layer scores against (docs §4); process-aware markers such as "repeated" or
 * "no new information" surface here so the student can see their own trail of
 * actions in order.
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

  const encounterClassLabel = t(`ehr.encounterClass.${encounter.class}`);

  return (
    <div className="flex flex-col gap-4">
      {/* Triage note — the prior context given at arrival. */}
      <Card padding="md">
        <SectionLabel
          icon={<ClipboardText weight="bold" className="h-3.5 w-3.5" aria-hidden />}
          trailing={
            <Badge tone="brand" variant="outline">
              {encounterClassLabel}
            </Badge>
          }
        >
          {t("ehr.chartReview.triageNote")}
        </SectionLabel>

        <p className="mt-1 text-xs text-muted">
          {t("ehr.chartReview.triageMeta", { class: encounterClassLabel })}
        </p>

        <p className="mt-3 text-sm leading-relaxed text-fg">
          {t("ehr.chartReview.triageBody", {
            age: patient.ageYears,
            complaint: pick(encounter.reason, lang),
          })}
        </p>

        {/* Presenting vitals — hairline-divided monitor strip, banner treatment. */}
        <div className="mt-4">
          <span className="eyebrow">
            {t("ehr.chartReview.triageVitals", { defaultValue: "Presenting vitals" })}
          </span>
          <div className="mt-1.5 flex flex-wrap items-stretch gap-x-4 gap-y-2 rounded-control border border-border bg-bg-subtle px-3 py-2.5 [&>div:not(:first-child)]:border-l [&>div:not(:first-child)]:border-border [&>div:not(:first-child)]:ps-4">
            <VitalCell label={t("vitals.hrShort")} value={`${triageVitals.hr}`} />
            <VitalCell
              label={t("vitals.bpShort")}
              value={`${triageVitals.systolic}/${triageVitals.diastolic}`}
            />
            <VitalCell label={t("vitals.rrShort")} value={`${triageVitals.rr}`} />
            <VitalCell label={t("vitals.spo2Short")} value={`${triageVitals.spo2}%`} />
            <VitalCell
              label={t("vitals.tempShort")}
              value={`${triageVitals.tempC.toFixed(1)}${t("vitals.units.celsius")}`}
            />
          </div>
        </div>
      </Card>

      {/* Activity so far — counters for the moves made this encounter. */}
      <Card padding="md">
        <SectionLabel
          className="mb-3"
          icon={<ListChecks weight="bold" className="h-3.5 w-3.5" aria-hidden />}
        >
          {t("ehr2.chartReview.summaryHeading")}
        </SectionLabel>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <ActivityStat
            icon={<ChatCircleText weight="bold" className="h-4 w-4" />}
            value={counts.question}
            label={t("ehr2.chartReview.questions")}
          />
          <ActivityStat
            icon={<Stethoscope weight="bold" className="h-4 w-4" />}
            value={counts.exam}
            label={t("ehr2.chartReview.exams")}
          />
          <ActivityStat
            icon={<Flask weight="bold" className="h-4 w-4" />}
            value={counts.order}
            label={t("ehr2.chartReview.orders")}
          />
          <ActivityStat
            icon={<FileText weight="bold" className="h-4 w-4" />}
            value={counts.result}
            label={t("ehr2.chartReview.results")}
          />
        </div>
        {offTask > 0 ? (
          <div className="mt-3 flex items-start gap-2 rounded-control border border-border bg-bg-subtle px-2.5 py-2 text-xs text-muted">
            <Compass weight="bold" className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="min-w-0">
              <span className="font-semibold text-fg">{offTask}</span>{" "}
              {t("ehr2.chartReview.offTask")}
              <span className="text-subtle"> · {t("ehr2.chartReview.offTaskHint")}</span>
            </span>
          </div>
        ) : null}
      </Card>

      {/* Encounter timeline — the ordered trail scored by the process layer. */}
      <Card padding="md">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <SectionLabel
            icon={<ClockCounterClockwise weight="bold" className="h-3.5 w-3.5" aria-hidden />}
          >
            {t("ehr.chartReview.timeline")}
          </SectionLabel>
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
          <p className="rounded-control border border-dashed border-border bg-bg-subtle px-3 py-6 text-center text-xs italic text-muted">
            {t("ehr.chartReview.timelineEmpty")}
          </p>
        ) : shown.length === 0 ? (
          <p className="rounded-control border border-dashed border-border bg-bg-subtle px-3 py-6 text-center text-xs italic text-muted">
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

/** One cell of the presenting-vitals strip: eyebrow field over a mono value. */
function VitalCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="eyebrow">{label}</span>
      <span className="font-mono text-sm tabular-nums text-fg">{value}</span>
    </div>
  );
}

/** A labeled count in the activity summary, built on the canonical Stat tile. */
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
    <div className="rounded-control border border-border bg-bg-subtle px-3 py-2.5">
      <Stat size="sm" icon={icon} value={value} label={label} />
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
    <div className="relative border-s border-border py-2 ps-5">
      {/* Node — sits centered on the continuous rail, breaking the hairline. */}
      <span
        aria-hidden
        className="absolute -start-3 top-1.5 grid h-6 w-6 place-items-center rounded-full border border-border-strong bg-surface text-muted"
      >
        {EVENT_ICON[ev.type]}
      </span>
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 text-sm text-fg">
          {label}
          {redundant || noNewInfo ? (
            <span className="ms-2 inline-flex items-center gap-1 rounded-full bg-bg-subtle px-1.5 py-px align-middle text-[10px] font-medium text-muted">
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
      </div>
    </div>
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
    case "treatment":
      return t("treatments.timeline", {
        name: (ev.meta?.display as string) ?? ref,
      });
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
