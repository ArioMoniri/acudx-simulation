import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  TrendUp,
  TrendDown,
  Target,
  Lock,
  ArrowLeft,
  ArrowRight,
  FunnelSimple,
} from "@phosphor-icons/react";
import { Card } from "@/components/ui";
import { CitationPill } from "@/components";
import { cn } from "@/lib/cn";
import { useLang } from "@/lib/useLang";
import {
  aggregateCalibration,
  axisOfDomain,
  type AggregateCalibrationTopic,
  type CalibrationDirection,
} from "@/data/institution";

type DirectionFilter = "all" | CalibrationDirection;
type AxisFilter = "all" | "clinical" | "communication";

/** Directional token + icon per calibration direction (never colour-only). */
const dirMeta: Record<
  CalibrationDirection,
  { color: string; icon: typeof TrendUp }
> = {
  over: { color: "var(--calib-over)", icon: TrendUp },
  under: { color: "var(--calib-under)", icon: TrendDown },
  well: { color: "var(--calib-well)", icon: Target },
};

/** The most-actionable overconfident topic drives the headline curriculum signal. */
function headlineTopic(): AggregateCalibrationTopic {
  return [...aggregateCalibration].sort((a, b) => b.gapPct - a.gapPct)[0];
}

/* -------------------------------------------------------------------------- */
/* Filter chip                                                                 */
/* -------------------------------------------------------------------------- */

function FilterChip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
        selected
          ? "border-brand bg-brand-tint text-brand"
          : "border-border bg-surface text-muted hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Topic row                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A single topic row. The directional gap is drawn as a bar spanning out from a
 * centre "well-calibrated" line: overconfident bars extend RIGHT (calib-over),
 * underconfident bars extend LEFT (calib-under). Direction is carried by
 * position + an arrow icon + a text word, never colour alone.
 */
function TopicRow({ topic }: { topic: AggregateCalibrationTopic }) {
  const { t } = useTranslation();
  const lang = useLang();
  const meta = dirMeta[topic.direction];
  const DirIcon = meta.icon;
  const magnitude = Math.min(Math.abs(topic.gapPct), 30);
  const widthPct = (magnitude / 30) * 50; // half-track max
  const directionWord = t(
    `institution.calibration.direction.${topic.direction}`,
  );

  return (
    <li className="flex flex-col gap-2 rounded-control border border-border bg-surface p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "h-2.5 w-2.5 shrink-0",
              topic.domain === "communication" ||
                topic.domain === "professionalism"
                ? "rounded-full"
                : "rotate-45",
            )}
            style={{
              backgroundColor:
                topic.domain === "communication" ||
                topic.domain === "professionalism"
                  ? "var(--axis-communication)"
                  : "var(--axis-clinical)",
            }}
            aria-hidden
          />
          <span className="text-sm font-medium text-fg">
            {topic.topic[lang]}
          </span>
        </div>
        <span
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
          style={{
            color: meta.color,
            backgroundColor: `color-mix(in srgb, ${meta.color} 14%, transparent)`,
          }}
        >
          <DirIcon weight="bold" className="h-3 w-3" aria-hidden />
          {directionWord}
        </span>
      </div>

      {/* Directional gap bar around a centre identity line */}
      <div
        className="relative h-6"
        role="img"
        aria-label={t("institution.calibration.rowAria", {
          topic: topic.topic[lang],
          direction: directionWord,
          points: Math.abs(topic.gapPct),
        })}
      >
        <div
          className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border"
          aria-hidden
        />
        {/* underconfident half (left) */}
        <div className="absolute inset-y-0 left-0 right-1/2 flex items-center justify-end pr-1">
          {topic.direction === "under" ? (
            <span
              className="h-3 rounded-l-full"
              style={{ width: `${widthPct}%`, backgroundColor: meta.color }}
              aria-hidden
            />
          ) : null}
        </div>
        {/* overconfident half (right) */}
        <div className="absolute inset-y-0 left-1/2 right-0 flex items-center pl-1">
          {topic.direction === "over" ? (
            <span
              className="h-3 rounded-r-full"
              style={{ width: `${widthPct}%`, backgroundColor: meta.color }}
              aria-hidden
            />
          ) : topic.direction === "well" ? (
            <span
              className="ml-[-4px] inline-flex items-center gap-1 text-[11px] font-medium"
              style={{ color: meta.color }}
              aria-hidden
            >
              <Target weight="fill" className="h-3 w-3" />
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span
          className="font-mono text-xs font-semibold"
          style={{ color: meta.color }}
        >
          {topic.gapPct > 0 ? "+" : ""}
          {topic.gapPct} {t("institution.calibration.ppShort")}
        </span>
        <span className="text-[11px] text-muted">
          {t("institution.calibration.learnerCount", { count: topic.learners })}
        </span>
      </div>

      <p className="text-xs text-muted">{topic.signal[lang]}</p>
      <CitationPill citationId={topic.citationId} lang={lang} />
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Section                                                                     */
/* -------------------------------------------------------------------------- */

/** AggregateCalibration — cohort systematic over/under-confidence by topic, filterable (IN-4). */
export function AggregateCalibration() {
  const { t } = useTranslation();
  const lang = useLang();
  const headline = headlineTopic();

  const [dir, setDir] = useState<DirectionFilter>("all");
  const [axis, setAxis] = useState<AxisFilter>("all");

  const filtered = useMemo(
    () =>
      aggregateCalibration.filter(
        (topic) =>
          (dir === "all" || topic.direction === dir) &&
          (axis === "all" || axisOfDomain(topic.domain) === axis),
      ),
    [dir, axis],
  );

  const hasFilter = dir !== "all" || axis !== "all";

  const directionOptions: { id: DirectionFilter; label: string }[] = [
    { id: "all", label: t("institution.calibration.filter.all") },
    { id: "over", label: t("institution.calibration.direction.over") },
    { id: "under", label: t("institution.calibration.direction.under") },
    { id: "well", label: t("institution.calibration.direction.well") },
  ];
  const axisOptions: { id: AxisFilter; label: string }[] = [
    { id: "all", label: t("institution.calibration.filter.all") },
    { id: "clinical", label: t("institution.calibration.filter.clinical") },
    {
      id: "communication",
      label: t("institution.calibration.filter.communication"),
    },
  ];

  return (
    <Card padding="lg" className="flex flex-col gap-4">
      <div>
        <h3 className="text-lg font-semibold tracking-tight text-fg">
          {t("institution.calibration.title")}
        </h3>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          {t("institution.calibration.subtitle")}
        </p>
      </div>

      {/* Headline curriculum signal (always the cohort-wide priority) */}
      <div className="rounded-control bg-bg-subtle p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          {t("institution.calibration.headline")}
        </p>
        <p className="mt-1.5 text-sm text-fg">
          {t("institution.calibration.headlineBody", {
            topic: headline.topic[lang],
            points: headline.gapPct,
          })}
        </p>
      </div>

      {/* Filter toolbar */}
      <div className="flex flex-col gap-2.5 rounded-control border border-border bg-surface p-3">
        <div className="flex items-center gap-1.5">
          <FunnelSimple
            weight="bold"
            className="h-3.5 w-3.5 text-muted"
            aria-hidden
          />
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">
            {t("institution.calibration.filter.heading")}
          </span>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-5">
          <div
            role="group"
            aria-label={t("institution.calibration.filter.directionLabel")}
            className="flex flex-wrap items-center gap-1.5"
          >
            <span className="text-[11px] font-medium text-muted">
              {t("institution.calibration.filter.directionLabel")}
            </span>
            {directionOptions.map((opt) => (
              <FilterChip
                key={opt.id}
                selected={dir === opt.id}
                onClick={() => setDir(opt.id)}
              >
                {opt.label}
              </FilterChip>
            ))}
          </div>
          <div
            role="group"
            aria-label={t("institution.calibration.filter.axisLabel")}
            className="flex flex-wrap items-center gap-1.5"
          >
            <span className="text-[11px] font-medium text-muted">
              {t("institution.calibration.filter.axisLabel")}
            </span>
            {axisOptions.map((opt) => (
              <FilterChip
                key={opt.id}
                selected={axis === opt.id}
                onClick={() => setAxis(opt.id)}
              >
                {opt.label}
              </FilterChip>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-muted" role="status" aria-live="polite">
            {t("institution.calibration.filter.showing", {
              count: filtered.length,
              total: aggregateCalibration.length,
            })}
          </p>
          {hasFilter ? (
            <button
              type="button"
              onClick={() => {
                setDir("all");
                setAxis("all");
              }}
              className="text-[11px] font-semibold text-brand underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              {t("institution.calibration.filter.reset")}
            </button>
          ) : null}
        </div>
      </div>

      {/* Direction legend (over / under / well) */}
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <li className="inline-flex items-center gap-1.5">
          <ArrowRight
            weight="bold"
            className="h-3 w-3"
            style={{ color: "var(--calib-over)" }}
            aria-hidden
          />
          <span className="text-[11px] text-muted">
            {t("institution.calibration.direction.over")}
          </span>
        </li>
        <li className="inline-flex items-center gap-1.5">
          <ArrowLeft
            weight="bold"
            className="h-3 w-3"
            style={{ color: "var(--calib-under)" }}
            aria-hidden
          />
          <span className="text-[11px] text-muted">
            {t("institution.calibration.direction.under")}
          </span>
        </li>
        <li className="inline-flex items-center gap-1.5">
          <Target
            weight="fill"
            className="h-3 w-3"
            style={{ color: "var(--calib-well)" }}
            aria-hidden
          />
          <span className="text-[11px] text-muted">
            {t("institution.calibration.direction.well")}
          </span>
        </li>
      </ul>

      {filtered.length > 0 ? (
        <ul className="grid gap-2.5 sm:grid-cols-2">
          {filtered.map((topic) => (
            <TopicRow key={topic.id} topic={topic} />
          ))}
        </ul>
      ) : (
        <p className="rounded-control border border-dashed border-border bg-bg-subtle px-3 py-6 text-center text-sm text-muted">
          {t("institution.calibration.filter.empty")}
        </p>
      )}

      {/* Privacy invariant: aggregate only, never an individual's calibration */}
      <div className="flex items-start gap-2 rounded-control bg-bg-subtle px-3 py-2">
        <Lock
          weight="bold"
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted"
          aria-hidden
        />
        <p className="text-xs text-muted">
          {t("institution.calibration.privacyNote")}
        </p>
      </div>
    </Card>
  );
}
