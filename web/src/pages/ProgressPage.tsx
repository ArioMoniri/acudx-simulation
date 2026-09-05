import { useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  ArrowUpRight,
  ArrowClockwise,
  CaretDown,
  Fire,
  Snowflake,
  Trophy,
  Target,
  SealCheck,
  Lock,
  TrendUp,
  TrendDown,
  Minus,
  CalendarCheck,
  Sparkle,
  Info,
  Heartbeat,
  ChatCentered,
  ShieldCheck,
  Handshake,
  Eye,
  CheckCircle,
  ClockCounterClockwise,
  X,
} from "@phosphor-icons/react";

import { PageContainer, PageHeader } from "@/components/shell";
import {
  Card,
  Badge,
  Button,
  Tooltip,
  SectionLabel,
  Stat,
  type StatTrend,
  TableWrap,
  Table,
  THead,
  TBody,
  Tr,
  Th,
  Td,
} from "@/components/ui";
import { CalibrationPlot, CitationPill, Sparkline } from "@/components";
import { useEntry, useLang } from "@/lib/useLang";
import { EASE } from "@/lib/motion";
import { cn } from "@/lib/cn";
import { type Band } from "@/data/mock";
import {
  MASTERY_BANDS,
  scheduleReview,
  REVIEW_GRADE_ORDER,
  type XpAward,
  type StreakDay,
  type MasteryDomain,
  type MasteryEvidence,
  type EpaProgress,
  type Badge as BadgeData,
  type BadgeIcon,
  type ReviewCard,
  type ReviewGrade,
} from "@/data/progress";
import {
  useCalibrationPoints,
  useCalibrationTrajectory,
  useCalibrationSessions,
  useDomainTrends,
  useMasteryDomains,
  useMasteryDetail,
  useEpaProgress,
  useBadges,
  useSelfComparison,
  useReviewQueue,
  gradeReview,
  useLevelState,
  useRecentXp,
  useStreakState,
  useProgressRecords,
} from "@/state/progressStore";

/* -------------------------------------------------------------------------- */
/* Small shared helpers                                                        */
/* -------------------------------------------------------------------------- */

/** Axis accent token for a domain group (◆ clinical vs ● communication). */
function axisAccent(axis: "clinical" | "communication"): string {
  return axis === "clinical"
    ? "var(--axis-clinical)"
    : "var(--axis-communication)";
}

const trendIcon = { up: TrendUp, down: TrendDown, steady: Minus } as const;

/**
 * Disclosure — a lightweight reveal for accordion detail. Animates opacity and
 * a small transform only (never height), and collapses to no motion under
 * prefers-reduced-motion, so it never triggers a layout animation.
 */
function Disclosure({
  id,
  labelledBy,
  className,
  children,
}: {
  id?: string;
  labelledBy?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      id={id}
      role={labelledBy ? "region" : undefined}
      aria-labelledby={labelledBy}
      initial={reduce ? false : { opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: EASE }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/**
 * Segmented — a small single-select control (medkit pill group). Each option is
 * an individually focusable button with `aria-pressed`, so meaning never rests
 * on color alone and keyboard users reach every choice.
 */
function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = "md",
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  size?: "sm" | "md";
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-1 rounded-control border border-border bg-bg-subtle p-1"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "inline-flex items-center justify-center rounded-[7px] font-medium",
              "transition-colors duration-200 ease-out focus-visible:outline-none",
              "focus-visible:ring-2 focus-visible:ring-brand",
              size === "sm"
                ? "min-h-8 px-2.5 text-xs"
                : "min-h-9 px-3 text-sm",
              active
                ? "bg-surface text-fg shadow-soft"
                : "text-muted hover:text-fg",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Section: Level + XP                                                          */
/* -------------------------------------------------------------------------- */

const xpReasonIcon = {
  calibrationTightened: Target,
  gapClosed: CheckCircle,
  bandUp: TrendUp,
  epaEntrusted: SealCheck,
  safetyNetting: ShieldCheck,
} as const;

function LevelCard() {
  const { t } = useTranslation();
  const lang = useLang();
  const labelId = useId();
  const levelState = useLevelState();
  const recentXp = useRecentXp();
  const pct = Math.round(
    (levelState.xpIntoLevel / levelState.xpForNextLevel) * 100,
  );
  const remaining = levelState.xpForNextLevel - levelState.xpIntoLevel;

  return (
    <Card padding="md" className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <SectionLabel icon={<Trophy weight="bold" className="h-3.5 w-3.5" />}>
          {t("progress.level.eyebrow", { level: levelState.level })} ·{" "}
          {levelState.title[lang]}
        </SectionLabel>
        <span className="shrink-0 text-end">
          <span className="block font-mono text-sm font-semibold text-fg">
            {levelState.xpTotal.toLocaleString(lang)}
          </span>
          <span className="block text-[11px] text-muted">
            {t("progress.level.xpTotal")}
          </span>
        </span>
      </div>

      {/* XP progress toward next level */}
      <div>
        <div className="flex items-center justify-between gap-2">
          <span id={labelId} className="text-sm font-medium text-fg">
            {t("progress.level.toNext", { level: levelState.level + 1 })}
          </span>
          <span className="font-mono text-sm text-muted">
            {levelState.xpIntoLevel}/{levelState.xpForNextLevel}
          </span>
        </div>
        <div
          className="mt-2 h-2.5 overflow-hidden rounded-full bg-bg-subtle"
          role="progressbar"
          aria-labelledby={labelId}
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuetext={t("progress.level.valueText", { percent: pct })}
        >
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-500 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-muted">
          {t("progress.level.remaining", { xp: remaining })}
        </p>
      </div>

      {/* Why you earned it — XP reads as competence gain, not grinding */}
      {recentXp.length > 0 ? (
        <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          {t("progress.level.whyHeading")}
        </p>
        <ul className="mt-2.5 flex flex-col gap-2.5">
          {recentXp.map((award: XpAward) => {
            const Icon = xpReasonIcon[award.reason];
            return (
              <li key={award.id} className="flex items-start gap-2.5">
                <span
                  className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-tint text-brand"
                  aria-hidden
                >
                  <Icon weight="bold" className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1 text-sm text-fg">
                  {award.detail[lang]}
                </span>
                <span className="shrink-0 font-mono text-xs font-semibold text-brand">
                  +{award.amount}
                </span>
              </li>
            );
          })}
        </ul>
        </div>
      ) : null}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Section: Forgiving streak                                                    */
/* -------------------------------------------------------------------------- */

const streakDayStyle: Record<StreakDay["state"], string> = {
  practised:
    "bg-[color-mix(in_srgb,var(--state-normal)_16%,transparent)] text-[color:var(--state-normal)]",
  freeze:
    "bg-[color-mix(in_srgb,var(--axis-clinical)_14%,transparent)] text-[color:var(--axis-clinical)]",
  rest: "bg-bg-subtle text-muted",
  today: "border border-brand bg-brand-tint text-brand",
  upcoming: "border border-dashed border-border bg-surface text-muted",
};

function StreakDayCell({ day, logged }: { day: StreakDay; logged: boolean }) {
  const { t } = useTranslation();
  // When today's rep is logged, today reads as practised.
  const state: StreakDay["state"] =
    day.state === "today" && logged ? "practised" : day.state;
  const label = t(`progress.streak.dayState.${state}`);

  return (
    <li className="flex flex-1 flex-col items-center gap-1.5">
      <Tooltip content={label}>
        <span
          tabIndex={0}
          role="img"
          aria-label={`${t(`progress.streak.weekday.${day.key}`)}: ${label}`}
          className={cn(
            "grid h-9 w-full place-items-center rounded-control",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
            streakDayStyle[state],
          )}
        >
          {state === "freeze" ? (
            <Snowflake weight="fill" className="h-4 w-4" aria-hidden />
          ) : state === "practised" ? (
            <CheckCircle weight="fill" className="h-4 w-4" aria-hidden />
          ) : state === "today" ? (
            <Fire weight="bold" className="h-4 w-4" aria-hidden />
          ) : null}
        </span>
      </Tooltip>
      <span className="text-[10px] font-medium text-muted" aria-hidden>
        {t(`progress.streak.weekday.${day.key}`)}
      </span>
    </li>
  );
}

function StreakCard() {
  const { t } = useTranslation();
  const streakState = useStreakState();
  const [logged, setLogged] = useState(streakState.todayDone);
  const current = streakState.currentDays + (logged && !streakState.todayDone ? 1 : 0);

  return (
    <Card padding="md" className="flex h-full flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <SectionLabel icon={<Fire weight="fill" className="h-3.5 w-3.5" />}>
            {t("progress.streak.eyebrow")}
          </SectionLabel>
          <p className="text-2xl font-semibold leading-none text-fg">
            <span className="font-mono">{current}</span>{" "}
            <span className="text-base font-medium text-muted">
              {t("progress.streak.days")}
            </span>
          </p>
        </div>
        <span className="shrink-0 text-end">
          <span className="block font-mono text-sm font-semibold text-fg">
            {streakState.bestDays}
          </span>
          <span className="block text-[11px] text-muted">
            {t("progress.streak.best")}
          </span>
        </span>
      </div>

      {/* Last 7 days */}
      <ul
        className="flex items-center justify-between gap-1.5"
        aria-label={t("progress.streak.weekLabel")}
      >
        {streakState.week.map((d) => (
          <StreakDayCell key={d.key} day={d} logged={logged} />
        ))}
      </ul>

      {/* Log today's single rep — a satisfying, low-pressure daily action */}
      {logged ? (
        <div className="flex items-start gap-2.5 rounded-control bg-[color-mix(in_srgb,var(--state-normal)_12%,transparent)] p-3">
          <CheckCircle
            weight="fill"
            className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--state-normal)]"
            aria-hidden
          />
          <div>
            <p className="text-sm font-medium text-fg">
              {t("progress2.streak.logged")}
            </p>
            <p className="text-xs text-muted">
              {t("progress2.streak.protectedToday")}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted">{t("progress2.streak.logHint")}</p>
          <Button
            size="sm"
            variant="secondary"
            leadingIcon={<CheckCircle weight="bold" className="h-4 w-4" />}
            onClick={() => setLogged(true)}
          >
            {t("progress2.streak.logRep")}
          </Button>
        </div>
      )}
      <span aria-live="polite" className="sr-only">
        {logged ? t("progress2.streak.logAnnounce", { days: current }) : ""}
      </span>

      {/* Freeze / grace — a rough week never breaks the streak */}
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center gap-2.5 rounded-control bg-bg-subtle p-3">
          <Snowflake
            weight="fill"
            className="h-4 w-4 shrink-0 text-[color:var(--axis-clinical)]"
            aria-hidden
          />
          <p className="text-sm text-fg">
            {t("progress.streak.freezes", {
              left: streakState.freezesLeft,
              total: streakState.freezesTotal,
            })}
          </p>
        </div>
        {streakState.graceActive ? (
          <div className="flex items-start gap-2.5 rounded-control bg-bg-subtle p-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
            <p className="text-sm text-muted">
              {t("progress.streak.graceNote")}
            </p>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Section: Mastery map (competency x level grid) — expandable detail          */
/* -------------------------------------------------------------------------- */

/** A compact bars view of a domain's recent band trajectory. */
function BandHistoryMeter({
  history,
  accent,
}: {
  history: Exclude<Band, "withheld">[];
  accent: string;
}) {
  const { t } = useTranslation();
  return (
    <ul className="flex items-end gap-1.5" aria-hidden>
      {history.map((band, i) => {
        const step = MASTERY_BANDS.indexOf(band);
        const h = 8 + step * 5; // taller bar = higher band
        return (
          <li key={i} className="flex flex-col items-center gap-1">
            <span
              className="w-6 rounded-full"
              style={{
                height: `${h}px`,
                backgroundColor: accent,
                opacity: i === history.length - 1 ? 1 : 0.4,
              }}
            />
            <span className="text-[9px] font-medium text-muted">
              {t(`bands.${band}`)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function EvidenceItem({ ev }: { ev: MasteryEvidence }) {
  const { t } = useTranslation();
  const lang = useLang();
  const ago =
    ev.daysAgo <= 0
      ? t("progress2.mastery.evidenceToday")
      : t("progress2.mastery.evidenceAgo", { count: ev.daysAgo });
  return (
    <li className="flex flex-col gap-0.5 border-l-2 border-border ps-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-fg">{ev.case[lang]}</span>
        <span className="shrink-0 text-[11px] text-muted">{ago}</span>
      </div>
      <span className="text-xs text-muted">{ev.note[lang]}</span>
    </li>
  );
}

function MasteryRow({ domain }: { domain: MasteryDomain }) {
  const { t } = useTranslation();
  const lang = useLang();
  const accent = axisAccent(domain.axis);
  const name = t(`feedback.domains.${domain.key}`);
  const rowLabelId = useId();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const detail = useMasteryDetail(domain.key);
  const withheld = domain.band === "withheld";

  const achievedIndex = withheld
    ? -1
    : MASTERY_BANDS.indexOf(domain.band as Exclude<Band, "withheld">);
  const nextBand = withheld ? undefined : MASTERY_BANDS[achievedIndex + 1];

  const TrendIcon =
    domain.deltaBand > 0
      ? trendIcon.up
      : domain.deltaBand < 0
        ? trendIcon.down
        : trendIcon.steady;
  const trendKey =
    domain.deltaBand > 0 ? "up" : domain.deltaBand < 0 ? "down" : "steady";

  return (
    <div
      className={cn(
        "rounded-control border p-3.5",
        withheld
          ? "border-dashed border-border bg-bg-subtle"
          : "border-border bg-surface",
      )}
    >
      {/* Header — a real toggle button revealing evidence and next steps */}
      <button
        type="button"
        id={rowLabelId}
        aria-expanded={open}
        aria-controls={detail ? panelId : undefined}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-[6px] text-start",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
        )}
      >
        <span className="inline-flex items-center gap-2 text-sm font-medium text-fg">
          <span
            aria-hidden
            className={cn(
              "h-2.5 w-2.5 shrink-0",
              domain.axis === "clinical" ? "rotate-45" : "rounded-full",
            )}
            style={{ backgroundColor: accent }}
          />
          {name}
        </span>
        <span className="inline-flex items-center gap-2">
          {withheld ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-0.5 text-xs font-medium text-muted">
              <Lock weight="bold" className="h-3 w-3" aria-hidden />
              {t("bands.withheld")}
            </span>
          ) : (
            <>
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold"
                style={{
                  color: accent,
                  backgroundColor: `color-mix(in srgb, ${accent} 14%, transparent)`,
                }}
              >
                <SealCheck weight="fill" className="h-3 w-3" aria-hidden />
                {t(`bands.${domain.band}`)}
              </span>
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-[11px] font-medium",
                  domain.deltaBand > 0
                    ? "text-[color:var(--state-normal)]"
                    : "text-muted",
                )}
              >
                <TrendIcon weight="bold" className="h-3 w-3" aria-hidden />
                <span className="sr-only">
                  {t(`progress.mastery.delta.${trendKey}`)}
                </span>
                <span aria-hidden>
                  {t(`progress.mastery.deltaShort.${trendKey}`)}
                </span>
              </span>
            </>
          )}
          <CaretDown
            weight="bold"
            aria-hidden
            className={cn(
              "h-4 w-4 shrink-0 text-muted transition-transform duration-200",
              open && "rotate-180",
            )}
          />
        </span>
      </button>

      {/* At-a-glance band meter (kept visible), or reliability note when withheld */}
      {withheld ? (
        <p className="mt-2 text-xs text-muted">
          {t("progress.mastery.notEnough", { count: domain.evidenceCount })}
        </p>
      ) : (
        <div
          className="mt-3 grid grid-cols-5 items-end gap-1"
          role="img"
          aria-label={t("progress.mastery.rowAria", {
            domain: name,
            band: t(`bands.${domain.band}`),
          })}
        >
          {MASTERY_BANDS.map((step, i) => {
            const reached = i <= achievedIndex;
            const isAchieved = i === achievedIndex;
            return (
              <div key={step} className="flex flex-col items-center gap-1">
                <span
                  className={cn(
                    "w-full rounded-full transition-all duration-300 ease-out",
                    isAchieved ? "h-3" : "h-1.5",
                  )}
                  style={{
                    backgroundColor: reached ? accent : "var(--border)",
                    opacity: reached && !isAchieved ? 0.45 : 1,
                  }}
                />
                <span
                  className={cn(
                    "text-[9px] font-medium leading-tight",
                    isAchieved ? "text-fg" : "text-muted",
                  )}
                >
                  {t(`bands.${step}`)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Expandable detail: what moved it, next step, evidence */}
      {open && detail ? (
        <Disclosure
          id={panelId}
          labelledBy={rowLabelId}
          className="mt-3.5 flex flex-col gap-3.5 border-t border-border pt-3.5"
        >
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              {t("progress2.mastery.movedByHeading")}
            </p>
            <p className="mt-1 text-sm text-fg">{detail.movedBy[lang]}</p>
          </div>

          <div className="rounded-control bg-bg-subtle p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              {nextBand
                ? t("progress2.mastery.nextHeading", {
                    band: t(`bands.${nextBand}`),
                  })
                : t("progress2.mastery.unlockHeading")}
            </p>
            <p className="mt-1 text-sm text-fg">
              {nextBand || withheld
                ? detail.nextStep[lang]
                : t("progress2.mastery.topBand")}
            </p>
          </div>

          {detail.bandHistory.length > 0 ? (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                {t("progress2.mastery.historyHeading")}
              </p>
              <div className="mt-2">
                <BandHistoryMeter history={detail.bandHistory} accent={accent} />
              </div>
            </div>
          ) : null}

          {detail.evidence.length > 0 ? (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                {t("progress2.mastery.evidenceHeading")}
              </p>
              <ul className="mt-2 flex flex-col gap-2.5">
                {detail.evidence.map((ev) => (
                  <EvidenceItem key={ev.id} ev={ev} />
                ))}
              </ul>
            </div>
          ) : null}

          {detail.reviewCardId ? (
            <a
              href="#spaced-review"
              className="inline-flex w-fit items-center gap-1 text-sm font-medium text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-[4px]"
            >
              {t("progress2.mastery.practise")}
              <ArrowRight weight="bold" className="h-3.5 w-3.5" aria-hidden />
            </a>
          ) : null}
        </Disclosure>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Section: EPAs — expandable entrustment ladder                               */
/* -------------------------------------------------------------------------- */

function EpaRow({ epa }: { epa: EpaProgress }) {
  const { t } = useTranslation();
  const lang = useLang();
  const assessed = epa.assessed;
  const entrusted = assessed && epa.level >= 4;
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <li className="flex flex-col gap-2 rounded-control border border-border bg-surface p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 shrink-0 rounded-full border border-border bg-bg-subtle px-2 py-0.5 font-mono text-[11px] font-semibold text-fg">
            {epa.code}
          </span>
          <span className="min-w-0 text-sm text-fg">{epa.title[lang]}</span>
        </div>
        {!assessed ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-dashed border-border bg-bg-subtle px-2 py-0.5 text-xs font-medium text-muted">
            <Lock weight="bold" className="h-3 w-3" aria-hidden />
            {t("progress4.epa.notAssessed", { defaultValue: "Not yet assessed" })}
          </span>
        ) : entrusted ? (
          <Badge tone="normal">
            <SealCheck weight="fill" className="h-3 w-3" aria-hidden />
            {t("progress.epa.entrusted")}
          </Badge>
        ) : (
          <span className="shrink-0 text-xs font-medium text-muted">
            {t("progress.epa.levelShort", { level: epa.level })}
          </span>
        )}
      </div>

      {/* 5-step entrustment scale */}
      <div
        className="flex items-center gap-1"
        role="img"
        aria-label={t("progress.epa.scaleAria", {
          code: epa.code,
          level: assessed ? epa.level : 0,
        })}
      >
        {[1, 2, 3, 4, 5].map((lvl) => {
          const reached = assessed && lvl <= epa.level;
          return (
            <span
              key={lvl}
              className="h-1.5 flex-1 rounded-full"
              style={{
                backgroundColor: reached
                  ? entrusted
                    ? "var(--state-normal)"
                    : "var(--axis-clinical)"
                  : "var(--border)",
              }}
              aria-hidden
            />
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1 rounded-[4px] text-xs font-medium text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          {open ? t("progress2.epa.collapse") : t("progress2.epa.expand")}
          <CaretDown
            weight="bold"
            aria-hidden
            className={cn(
              "h-3.5 w-3.5 transition-transform duration-200",
              open && "rotate-180",
            )}
          />
        </button>
        <CitationPill citationId={epa.citationId} lang={lang} />
      </div>

      {open ? (
        <Disclosure
          id={panelId}
          className="mt-1 flex flex-col gap-1.5 border-t border-border pt-2.5"
        >
          <p className="sr-only">
            {t("progress2.epa.ladderAria", { code: epa.code, level: epa.level })}
          </p>
          <ol className="flex flex-col gap-1.5">
            {[1, 2, 3, 4, 5].map((lvl) => {
              const isCurrent = lvl === epa.level;
              const isNext = lvl === epa.level + 1;
              const reached = lvl <= epa.level;
              return (
                <li
                  key={lvl}
                  className={cn(
                    "flex items-center gap-2.5 rounded-control px-2.5 py-1.5",
                    isCurrent ? "bg-brand-tint" : "bg-transparent",
                  )}
                >
                  <span
                    className={cn(
                      "grid h-5 w-5 shrink-0 place-items-center rounded-full font-mono text-[10px] font-semibold",
                      reached
                        ? "bg-brand text-white"
                        : "border border-border bg-surface text-muted",
                    )}
                    aria-hidden
                  >
                    {lvl}
                  </span>
                  <span
                    className={cn(
                      "flex-1 text-xs",
                      isCurrent ? "font-medium text-fg" : "text-muted",
                    )}
                  >
                    {t(`progress.epa.level.${lvl}`)}
                  </span>
                  {isCurrent ? (
                    <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-brand">
                      {t("progress2.epa.current")}
                    </span>
                  ) : isNext ? (
                    <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted">
                      {t("progress2.epa.next")}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ol>
          {epa.level >= 5 ? (
            <p className="text-[11px] text-muted">
              {t("progress2.epa.atCeiling")}
            </p>
          ) : null}
        </Disclosure>
      ) : null}
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Section: Badges — filterable                                                */
/* -------------------------------------------------------------------------- */

const badgeIconMap: Record<BadgeIcon, typeof Heartbeat> = {
  heartbeat: Heartbeat,
  chatCentered: ChatCentered,
  shieldCheck: ShieldCheck,
  target: Target,
  handshake: Handshake,
  eye: Eye,
};

function BadgeTile({ badge }: { badge: BadgeData }) {
  const { t } = useTranslation();
  const lang = useLang();
  const Icon = badgeIconMap[badge.icon];
  const pct = Math.round((badge.progress ?? 0) * 100);

  return (
    <li
      className={cn(
        "flex flex-col gap-2.5 rounded-card border p-4",
        badge.earned
          ? "border-border bg-surface"
          : "border-dashed border-border bg-bg-subtle",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "grid h-10 w-10 shrink-0 place-items-center rounded-control",
            badge.earned
              ? "bg-brand-tint text-brand"
              : "bg-surface text-muted",
          )}
          aria-hidden
        >
          <Icon weight={badge.earned ? "fill" : "regular"} className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-semibold text-fg">{badge.title[lang]}</p>
            {badge.earned ? (
              <SealCheck
                weight="fill"
                className="h-3.5 w-3.5 shrink-0 text-[color:var(--state-normal)]"
                aria-label={t("progress.badges.earned")}
              />
            ) : null}
          </div>
          <p className="mt-0.5 text-xs text-muted">{badge.description[lang]}</p>
        </div>
      </div>

      {!badge.earned && badge.nextStep ? (
        <div className="mt-1">
          <div
            className="h-1.5 overflow-hidden rounded-full bg-surface"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t("progress.badges.progressAria", {
              badge: badge.title[lang],
              percent: pct,
            })}
          >
            <div
              className="h-full rounded-full bg-brand"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-1.5 text-[11px] text-muted">{badge.nextStep[lang]}</p>
        </div>
      ) : null}
    </li>
  );
}

type BadgeFilter = "all" | "earned" | "inProgress";

function BadgesSection() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<BadgeFilter>("all");
  const badges = useBadges();
  const earnedCount = badges.filter((b) => b.earned).length;

  const shown = useMemo(() => {
    if (filter === "earned") return badges.filter((b) => b.earned);
    if (filter === "inProgress") return badges.filter((b) => !b.earned);
    return badges;
  }, [filter, badges]);

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-center gap-2">
          <Trophy weight="bold" className="h-5 w-5 text-brand" aria-hidden />
          <h2 className="text-lg font-semibold tracking-tight text-fg">
            {t("progress.badges.heading")}
          </h2>
        </div>
        <span className="text-sm text-muted">
          {t("progress.badges.count", {
            earned: earnedCount,
            total: badges.length,
          })}
        </span>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        {t("progress.badges.subtitle")}
      </p>

      <div className="mt-4">
        <Segmented<BadgeFilter>
          ariaLabel={t("progress2.badges.filterAria")}
          value={filter}
          onChange={setFilter}
          size="sm"
          options={[
            { value: "all", label: t("progress2.badges.all") },
            { value: "earned", label: t("progress2.badges.earned") },
            { value: "inProgress", label: t("progress2.badges.inProgress") },
          ]}
        />
      </div>

      {shown.length > 0 ? (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((b) => (
            <BadgeTile key={b.id} badge={b} />
          ))}
        </ul>
      ) : (
        <p className="mt-4 rounded-control border border-dashed border-border bg-bg-subtle p-4 text-sm text-muted">
          {filter === "earned"
            ? t("progress2.badges.emptyEarned")
            : t("progress2.badges.emptyInProgress")}
        </p>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Section: Calibration trajectory — interactive session scrubber              */
/* -------------------------------------------------------------------------- */

type TrajectoryMetric = "gap" | "brier";

function FocusChart({
  series,
  selected,
  color,
}: {
  series: number[];
  selected: number;
  color: string;
}) {
  const gradId = useId();
  const w = 300;
  const h = 96;
  const pad = 8;
  const n = series.length;
  const denom = n > 1 ? n - 1 : 1;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const pts = series.map((v, i) => {
    const x = pad + (i / denom) * (w - 2 * pad);
    const y = pad + (h - 2 * pad) - ((v - min) / span) * (h - 2 * pad);
    return [x, y] as const;
  });
  const line = pts
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");
  const area =
    `${line} L${pts[n - 1][0].toFixed(1)} ${h - pad} ` +
    `L${pts[0][0].toFixed(1)} ${h - pad} Z`;
  const [selX] = pts[selected];

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-24 w-full"
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.16" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} stroke="none" />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* Selected-session guide + marker */}
      <line
        x1={selX}
        y1={pad}
        x2={selX}
        y2={h - pad}
        stroke="var(--border)"
        strokeWidth={1}
        strokeDasharray="3 3"
        vectorEffect="non-scaling-stroke"
      />
      {pts.map(([x, y], i) => (
        <circle
          key={i}
          cx={x}
          cy={y}
          r={i === selected ? 4 : 2}
          fill={i === selected ? color : "var(--surface)"}
          stroke={color}
          strokeWidth={i === selected ? 2 : 1.25}
        />
      ))}
    </svg>
  );
}

function TrajectoryFocus() {
  const { t } = useTranslation();
  const calibrationSessions = useCalibrationSessions();
  const [metric, setMetric] = useState<TrajectoryMetric>("gap");
  const [selected, setSelected] = useState(() => calibrationSessions.length - 1);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const isGap = metric === "gap";
  const color = isGap ? "var(--brand-600)" : "var(--axis-communication)";
  const series = calibrationSessions.map((s) => (isGap ? s.gap : s.brier));
  // Clamp against the live session count (records may have grown since mount).
  const sel = Math.max(0, Math.min(selected, calibrationSessions.length - 1));
  const session = calibrationSessions[sel];
  const value = isGap ? session.gap : session.brier;

  const metricLabel = isGap
    ? t("progress2.trajectory.metricGap")
    : t("progress2.trajectory.metricBrier");

  // Change since the first session (improvement is a smaller number here).
  const first = series[0];
  const deltaBetter = first - value; // positive = improved
  let changeText: string;
  let changeGood = false;
  if (Math.abs(deltaBetter) < 1e-9) {
    changeText = t("progress2.trajectory.flat");
  } else if (deltaBetter > 0) {
    changeGood = true;
    changeText = isGap
      ? t("progress2.trajectory.betterGap", {
          points: Math.round(deltaBetter * 100),
        })
      : t("progress2.trajectory.betterBrier", {
          value: deltaBetter.toFixed(2),
        });
  } else {
    changeText = t("progress2.trajectory.worse", {
      value: isGap
        ? `${Math.round(-deltaBetter * 100)}`
        : (-deltaBetter).toFixed(2),
    });
  }

  function onScrubKey(e: React.KeyboardEvent) {
    const n = calibrationSessions.length;
    let next = sel;
    if (e.key === "ArrowRight" || e.key === "ArrowDown")
      next = Math.min(n - 1, sel + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
      next = Math.max(0, sel - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    else return;
    e.preventDefault();
    setSelected(next);
    refs.current[next]?.focus();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          {t("progress2.trajectory.focusHeading")}
        </p>
        <Segmented<TrajectoryMetric>
          ariaLabel={t("progress2.trajectory.metricAria")}
          value={metric}
          onChange={setMetric}
          size="sm"
          options={[
            { value: "gap", label: t("progress2.trajectory.metricGap") },
            { value: "brier", label: t("progress2.trajectory.metricBrier") },
          ]}
        />
      </div>

      {/* Readout for the selected session */}
      <div className="rounded-control bg-bg-subtle p-3.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted">
            {t("progress2.trajectory.selected", { label: session.label })}
          </span>
          <span className="font-mono text-2xl font-semibold leading-none text-fg">
            {isGap ? Math.round(value * 100) : value.toFixed(2)}
            {isGap ? <span className="text-base text-muted">%</span> : null}
          </span>
        </div>
        <div className="mt-3">
          <FocusChart series={series} selected={sel} color={color} />
        </div>
        <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-medium">
          <TrendDown
            weight="bold"
            aria-hidden
            className={cn(
              "h-3 w-3",
              changeGood
                ? "text-[color:var(--state-normal)]"
                : "text-muted",
            )}
          />
          <span
            className={
              changeGood ? "text-[color:var(--state-normal)]" : "text-muted"
            }
          >
            {t("progress2.trajectory.sinceFirst")}: {changeText}
          </span>
        </p>
      </div>

      {/* Accessible scrubber: one radio per session, arrow-key navigable */}
      <div
        role="radiogroup"
        aria-label={t("progress2.trajectory.sessionsAria")}
        onKeyDown={onScrubKey}
        className="flex items-center gap-1"
      >
        {calibrationSessions.map((s, i) => {
          const active = i === sel;
          const sVal = isGap ? s.gap : s.brier;
          const readout = isGap
            ? `${Math.round(sVal * 100)}%`
            : sVal.toFixed(2);
          return (
            <button
              key={s.label}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              onClick={() => setSelected(i)}
              aria-label={t("progress2.trajectory.sessionAria", {
                label: s.label,
                metric: metricLabel,
                value: readout,
              })}
              className={cn(
                "flex-1 rounded-control py-2 text-center text-[11px] font-medium",
                "transition-colors duration-150 focus-visible:outline-none",
                "focus-visible:ring-2 focus-visible:ring-brand",
                active
                  ? "bg-brand-tint text-brand"
                  : "bg-bg-subtle text-muted hover:text-fg",
              )}
            >
              {s.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TrajectoryCard() {
  const { t } = useTranslation();
  const lang = useLang();
  const calibrationSessions = useCalibrationSessions();
  const domainTrends = useDomainTrends();
  const calibrationPoints = useCalibrationPoints();
  const calibrationTrajectory = useCalibrationTrajectory();

  // Honest empty state — no fabricated trajectory before any encounter.
  if (calibrationSessions.length === 0) {
    return (
      <Card padding="lg">
        <div className="rounded-control border border-dashed border-border bg-bg-subtle p-6 text-center">
          <p className="text-sm font-medium text-fg">
            {t("progress.trajectory.empty")}
          </p>
          <p className="mt-1 text-xs text-muted">
            {t("progress.trajectoryEmptyHint")}
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card padding="lg" className="flex flex-col gap-5">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
        {/* Interactive session-by-session focus + per-domain small multiples */}
        <div className="flex flex-col gap-5">
          <TrajectoryFocus />

          {domainTrends.length > 0 ? (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              {t("progress.trajectory.perDomain")}
            </p>
            <ul className="mt-2.5 grid gap-2 sm:grid-cols-2">
              {domainTrends.map((d) => {
                const first = d.gaps[0];
                const last = d.gaps[d.gaps.length - 1];
                const improved = last < first;
                const dropPts = Math.round((first - last) * 100);
                const name = t(`feedback.domains.${d.domain}`);
                return (
                  <li
                    key={d.domain}
                    className="flex items-center gap-3 rounded-control border border-border bg-surface p-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-fg">
                        {name}
                      </p>
                      <p className="text-[11px] text-muted">
                        {t("progress.trajectory.domainNow", {
                          percent: Math.round(last * 100),
                        })}
                      </p>
                    </div>
                    <Sparkline
                      data={d.gaps}
                      color={
                        improved ? "var(--state-normal)" : "var(--fg-muted)"
                      }
                      className="h-6 w-16 shrink-0"
                      ariaLabel={t("progress.trajectory.domainSpark", {
                        domain: name,
                        points: dropPts,
                      })}
                    />
                  </li>
                );
              })}
            </ul>
          </div>
          ) : null}
        </div>

        {/* The signature calibration scatter, reused */}
        <div className="flex flex-col gap-3">
          <CalibrationPlot
            points={calibrationPoints}
            trajectory={calibrationTrajectory}
            lang={lang}
            small
          />
          <div className="flex items-start gap-2 rounded-control bg-bg-subtle p-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
            <p className="text-xs text-muted">
              {t("calibration.trajectoryArrow")} ·{" "}
              {t("home.noPublicLeaderboard")}
            </p>
          </div>
          <Link
            to="/feedback"
            className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline focus-visible:outline-none"
          >
            {t("progress.trajectory.openReport")}
            <ArrowUpRight weight="bold" className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Section: Spaced-repetition queue (FSRS) — interactive review session        */
/* -------------------------------------------------------------------------- */

const reviewStateTone: Record<
  ReviewCard["state"],
  "caution" | "brand" | "neutral"
> = {
  due: "caution",
  learning: "brand",
  scheduled: "neutral",
};

/** Per-grade accent token; label + hint always carry the meaning in text too. */
const gradeAccent: Record<ReviewGrade, string> = {
  again: "var(--state-critical)",
  hard: "var(--state-caution)",
  good: "var(--state-normal)",
  easy: "var(--brand-600)",
};

const gradeLabelKey: Record<ReviewGrade, string> = {
  again: "progress2.review.gradeAgain",
  hard: "progress2.review.gradeHard",
  good: "progress2.review.gradeGood",
  easy: "progress2.review.gradeEasy",
};

const gradeHintKey: Record<ReviewGrade, string> = {
  again: "progress2.review.hintAgain",
  hard: "progress2.review.hintHard",
  good: "progress2.review.hintGood",
  easy: "progress2.review.hintEasy",
};

function ReviewTableRow({
  card,
  justGraded,
}: {
  card: ReviewCard;
  justGraded: boolean;
}) {
  const { t } = useTranslation();
  const lang = useLang();
  const recallPct = Math.round(card.retrievability * 100);
  const dueNow = card.dueInDays <= 0;
  const dueLabel = dueNow
    ? t("progress.review.dueNow")
    : t("progress.review.dueInDays", { count: card.dueInDays });

  return (
    <Tr>
      <Td className="min-w-[16rem]">
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-fg">
              {card.prompt[lang]}
            </span>
            {justGraded ? (
              <Badge tone="normal" dot>
                <CheckCircle weight="fill" className="h-3 w-3" aria-hidden />
                {t("progress2.review.justGraded")}
              </Badge>
            ) : null}
          </div>
          <CitationPill citationId={card.citationId} lang={lang} />
        </div>
      </Td>
      <Td>
        <span
          className="inline-block whitespace-nowrap rounded-chip px-1.5 py-0.5 font-mono text-[11px] font-medium text-fg"
          style={{
            backgroundColor:
              "color-mix(in srgb, var(--fg-muted) 12%, transparent)",
          }}
        >
          {t(`feedback.domains.${card.domain}` as const)}
        </span>
      </Td>
      <Td numeric>{recallPct}%</Td>
      <Td numeric>{card.stabilityDays}d</Td>
      <Td className="whitespace-nowrap">
        <span className={cn("text-sm", dueNow ? "font-medium text-fg" : "text-muted")}>
          {dueLabel}
        </span>
      </Td>
      <Td>
        <Badge tone={reviewStateTone[card.state]} dot>
          {card.state === "due" ? (
            <Fire weight="fill" className="h-3 w-3" aria-hidden />
          ) : card.state === "learning" ? (
            <Sparkle weight="fill" className="h-3 w-3" aria-hidden />
          ) : (
            <CalendarCheck weight="bold" className="h-3 w-3" aria-hidden />
          )}
          {t(`progress.review.state.${card.state}`)}
        </Badge>
      </Td>
    </Tr>
  );
}

interface ReviewSessionState {
  remaining: ReviewCard[];
  completed: string[];
  size: number;
  announce: string;
}

type ReviewFilter = "all" | ReviewCard["state"];

function ReviewSection() {
  const { t } = useTranslation();

  // The queue is the REAL, persisted review store (derived from encounter gaps
  // with an FSRS schedule). Grading writes back to it via `gradeReview`.
  const queue = useReviewQueue();
  const [reviewedIds, setReviewedIds] = useState<string[]>([]);
  const [session, setSession] = useState<ReviewSessionState | null>(null);
  const [filter, setFilter] = useState<ReviewFilter>("all");

  const dueCount = queue.filter((c) => c.state === "due").length;

  function startSession(from: ReviewCard[]) {
    const due = from.filter((c) => c.state === "due").map((c) => ({ ...c }));
    if (due.length === 0) return;
    setSession({ remaining: due, completed: [], size: due.length, announce: "" });
  }

  function reviewAgain() {
    setReviewedIds([]);
    startSession(queue);
  }

  function grade(g: ReviewGrade) {
    if (!session || session.remaining.length === 0) return;
    const current = session.remaining[0];
    const sched = scheduleReview(current, g);
    const updated: ReviewCard = {
      ...current,
      stabilityDays: sched.stabilityDays,
      retrievability: sched.retrievability,
      dueInDays: sched.intervalDays,
      state: sched.state,
    };

    // Persist the grade to the real review store (survives reload, shared with
    // the Feedback page's spaced-repetition CTA).
    gradeReview(current.id, g);

    const gradeLabel = t(gradeLabelKey[g]);
    const scheduleText =
      g === "again"
        ? t("progress2.review.scheduleAgain")
        : t("progress2.review.scheduleNext", {
            count: sched.intervalDays,
            stability: sched.stabilityDays,
          });
    const announce = t("progress2.review.announce", {
      grade: gradeLabel,
      schedule: scheduleText,
    });

    const rest = session.remaining.slice(1);
    if (g === "again") {
      // A lapse returns the card later in the same session.
      setSession({
        ...session,
        remaining: [...rest, updated],
        announce,
      });
    } else {
      setReviewedIds((ids) =>
        ids.includes(current.id) ? ids : [...ids, current.id],
      );
      setSession({
        ...session,
        remaining: rest,
        completed: [...session.completed, current.id],
        announce,
      });
    }
  }

  const filteredQueue =
    filter === "all" ? queue : queue.filter((c) => c.state === filter);

  const current = session?.remaining[0];
  const done = session !== null && session.remaining.length === 0;

  // Next due day for the summary (smallest positive interval left in the queue).
  const upcoming = queue.map((c) => c.dueInDays).filter((d) => d > 0);
  const nextDue = upcoming.length > 0 ? Math.min(...upcoming) : null;

  return (
    <div id="spaced-review" className="scroll-mt-24">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ClockCounterClockwise
            weight="bold"
            className="h-5 w-5 text-brand"
            aria-hidden
          />
          <h2 className="text-lg font-semibold tracking-tight text-fg">
            {t("progress.review.heading")}
          </h2>
          {dueCount > 0 ? (
            <Badge tone="caution">
              <Fire weight="fill" className="h-3 w-3" aria-hidden />
              {t("progress.review.dueBadge", { count: dueCount })}
            </Badge>
          ) : null}
        </div>
        {!session && dueCount > 0 ? (
          <Button
            size="sm"
            leadingIcon={<Sparkle weight="bold" className="h-4 w-4" />}
            onClick={() => startSession(queue)}
          >
            {t("progress2.review.start")}
          </Button>
        ) : null}
      </div>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        {t("progress.review.subtitle")}
      </p>

      {/* Active review session */}
      {session ? (
        <Card
          padding="lg"
          className="mt-4 flex flex-col gap-4"
          aria-label={t("progress2.review.sessionAria")}
        >
          {done ? (
            <ReviewSummary
              reviewedCount={session.completed.length || reviewedIds.length}
              nextDue={nextDue}
              onAgain={reviewAgain}
              onClose={() => setSession(null)}
            />
          ) : current ? (
            <ReviewSessionCard
              card={current}
              index={Math.min(session.completed.length + 1, session.size)}
              total={session.size}
              onGrade={grade}
              onClose={() => setSession(null)}
            />
          ) : null}
          <span aria-live="polite" className="sr-only">
            {session.announce}
          </span>
        </Card>
      ) : null}

      {/* Queue list with a state filter */}
      <div className="mt-4">
        <Segmented<ReviewFilter>
          ariaLabel={t("progress2.review.filterAria")}
          value={filter}
          onChange={setFilter}
          size="sm"
          options={[
            { value: "all", label: t("progress2.review.all") },
            { value: "due", label: t("progress2.review.due") },
            { value: "learning", label: t("progress2.review.learning") },
            { value: "scheduled", label: t("progress2.review.scheduled") },
          ]}
        />
      </div>

      {dueCount === 0 && !session ? (
        <p className="mt-3 rounded-control border border-dashed border-border bg-bg-subtle p-4 text-sm text-muted">
          {t("progress2.review.allClear")}
        </p>
      ) : null}

      {filteredQueue.length > 0 ? (
        <TableWrap className="mt-3">
          <Table>
            <caption className="sr-only">
              {t("progress3.review.tableCaption")}
            </caption>
            <THead>
              <Tr>
                <Th>{t("progress3.review.col.prompt")}</Th>
                <Th>{t("progress3.review.col.domain")}</Th>
                <Th numeric>{t("progress3.review.col.recall")}</Th>
                <Th numeric>{t("progress3.review.col.stability")}</Th>
                <Th>{t("progress3.review.col.due")}</Th>
                <Th>{t("progress3.review.col.state")}</Th>
              </Tr>
            </THead>
            <TBody>
              {filteredQueue.map((c) => (
                <ReviewTableRow
                  key={c.id}
                  card={c}
                  justGraded={reviewedIds.includes(c.id)}
                />
              ))}
            </TBody>
          </Table>
        </TableWrap>
      ) : (
        <p className="mt-3 rounded-control border border-dashed border-border bg-bg-subtle p-4 text-sm text-muted">
          {t("progress2.review.empty")}
        </p>
      )}
    </div>
  );
}

function ReviewSessionCard({
  card,
  index,
  total,
  onGrade,
  onClose,
}: {
  card: ReviewCard;
  index: number;
  total: number;
  onGrade: (g: ReviewGrade) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const lang = useLang();

  function onKeyDown(e: React.KeyboardEvent) {
    const map: Record<string, ReviewGrade> = {
      "1": "again",
      "2": "hard",
      "3": "good",
      "4": "easy",
    };
    const g = map[e.key];
    if (g) {
      e.preventDefault();
      onGrade(g);
    }
  }

  return (
    <div onKeyDown={onKeyDown}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-wide text-muted">
          {t("progress2.review.progress", { current: index, total })}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("progress2.review.close")}
          className="grid h-7 w-7 place-items-center rounded-full text-muted hover:bg-bg-subtle hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <X weight="bold" className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="mt-3 rounded-control bg-bg-subtle p-4">
        <div className="flex items-center justify-between gap-2">
          <span
            className="inline-block rounded-full px-1.5 py-0.5 font-mono text-[11px] font-medium text-fg"
            style={{
              backgroundColor:
                "color-mix(in srgb, var(--fg-muted) 12%, transparent)",
            }}
          >
            {t(`feedback.domains.${card.domain}` as const)}
          </span>
          <CitationPill citationId={card.citationId} lang={lang} />
        </div>
        <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
          {t("progress2.review.promptLabel")}
        </p>
        <p className="mt-1 text-base font-medium text-fg">
          {card.prompt[lang]}
        </p>
      </div>

      <p className="mt-4 text-sm font-medium text-fg">
        {t("progress2.review.gradePrompt")}
      </p>
      <div
        className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4"
        role="group"
        aria-label={t("progress2.review.gradeAria")}
      >
        {REVIEW_GRADE_ORDER.map((g, i) => {
          const preview = scheduleReview(card, g);
          const previewText =
            g === "again"
              ? t("progress2.review.previewLater")
              : t("progress2.review.previewDays", {
                  count: preview.intervalDays,
                });
          return (
            <button
              key={g}
              type="button"
              onClick={() => onGrade(g)}
              className="flex flex-col items-start gap-1 rounded-control border border-border bg-surface p-3 text-start transition-colors hover:bg-bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <span className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: gradeAccent[g] }}
                  aria-hidden
                />
                <span className="text-sm font-semibold text-fg">
                  {t(gradeLabelKey[g])}
                </span>
                <span
                  className="font-mono text-[10px] text-muted"
                  aria-hidden
                >
                  {i + 1}
                </span>
              </span>
              <span className="text-[11px] text-muted">
                {t(gradeHintKey[g])}
              </span>
              <span className="font-mono text-[11px] font-medium text-fg">
                {previewText}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-muted">
        {t("progress2.review.keyboardHint")}
      </p>
    </div>
  );
}

function ReviewSummary({
  reviewedCount,
  nextDue,
  onAgain,
  onClose,
}: {
  reviewedCount: number;
  nextDue: number | null;
  onAgain: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-3 py-2 text-center">
      <span
        className="grid h-12 w-12 place-items-center rounded-full bg-[color-mix(in_srgb,var(--state-normal)_16%,transparent)] text-[color:var(--state-normal)]"
        aria-hidden
      >
        <CheckCircle weight="fill" className="h-6 w-6" />
      </span>
      <div>
        <p className="text-base font-semibold text-fg">
          {t("progress2.review.doneHeading")}
        </p>
        <p className="mt-1 max-w-md text-sm text-muted">
          {t("progress2.review.doneBody", { count: reviewedCount })}
        </p>
        <p className="mt-1 text-sm font-medium text-fg">
          {nextDue !== null
            ? t("progress2.review.doneNextDue", { count: nextDue })
            : t("progress2.review.doneNoneDue")}
        </p>
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={<ArrowClockwise weight="bold" className="h-4 w-4" />}
          onClick={onAgain}
        >
          {t("progress2.review.again")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          {t("progress2.review.close")}
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Section: Self-comparison (your own trend — never a fabricated cohort rank)   */
/* -------------------------------------------------------------------------- */

function SelfComparisonCard() {
  const { t } = useTranslation();
  const self = useSelfComparison();
  const improved = self.improvementPct > 0;
  const worse = self.improvementPct < 0;

  return (
    <Card padding="lg" className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-control bg-bg-subtle text-muted"
          aria-hidden
        >
          <Eye weight="bold" className="h-4.5 w-4.5" />
        </span>
        <div>
          <h3 className="text-base font-semibold tracking-tight text-fg">
            {t("progress4.self.heading", {
              defaultValue: "Your progress, measured against you",
            })}
          </h3>
          <p className="mt-1 max-w-md text-sm text-muted">
            {t("progress4.self.explainer", {
              defaultValue:
                "Private by design: you are compared only to your own earlier sessions, never ranked against other learners.",
            })}
          </p>
        </div>
      </div>

      {self.hasBaseline ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-control bg-bg-subtle p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              {t("progress4.self.baseline", { defaultValue: "First session gap" })}
            </p>
            <p className="mt-1 font-mono text-2xl font-semibold leading-none text-fg">
              {self.baselineGapPct}
              <span className="text-base text-muted">%</span>
            </p>
          </div>
          <div className="rounded-control bg-bg-subtle p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              {t("progress4.self.latest", { defaultValue: "Latest session gap" })}
            </p>
            <p className="mt-1 font-mono text-2xl font-semibold leading-none text-fg">
              {self.latestGapPct}
              <span className="text-base text-muted">%</span>
            </p>
          </div>
          <div className="rounded-control bg-bg-subtle p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              {t("progress4.self.change", { defaultValue: "Change vs. baseline" })}
            </p>
            <p
              className={cn(
                "mt-1 font-mono text-2xl font-semibold leading-none",
                improved ? "text-[color:var(--state-normal)]" : "text-fg",
              )}
            >
              {improved ? "−" : worse ? "+" : "±"}
              {Math.abs(self.improvementPct)}
              <span className="text-base text-muted"> pp</span>
            </p>
            <p className="mt-2 text-xs text-muted">
              {improved
                ? t("progress4.self.tighter", {
                    defaultValue:
                      "Your calibration gap has tightened since your first session.",
                  })
                : worse
                  ? t("progress4.self.wider", {
                      defaultValue:
                        "Your calibration gap is wider than your first session.",
                    })
                  : t("progress4.self.flat", {
                      defaultValue: "No change since your first session yet.",
                    })}
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-control border border-dashed border-border bg-bg-subtle p-4 text-sm text-muted">
          {t("progress4.self.needMore", {
            defaultValue:
              "Complete at least two encounters to compare your latest calibration against your own baseline.",
          })}
        </div>
      )}

      {/* Honest note: a real de-identified cohort comparison needs a backend
          that does not exist in this offline build — so no cohort rank or
          percentile is shown. */}
      <div className="flex items-start gap-2.5 rounded-control border border-dashed border-border bg-bg-subtle p-4">
        <ShieldCheck
          weight="bold"
          className="mt-0.5 h-4 w-4 shrink-0 text-muted"
          aria-hidden
        />
        <p className="text-sm text-muted">
          {t("progress4.self.cohortUnavailable", {
            defaultValue:
              "Comparison against a de-identified cohort is not available in this offline build — no cohort ranking or percentile is shown.",
          })}
        </p>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

/** ProgressPage — the returning-learner hub (Journey 5). */
export function ProgressPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const header = useEntry();
  const snapshot = useEntry(0.06);
  const mastery = useEntry(0.1);
  const trajectory = useEntry(0.14);
  const momentum = useEntry(0.18);
  const badgesEntry = useEntry(0.2);
  const review = useEntry(0.24);
  const cohort = useEntry(0.28);

  // Real, earned progress (empty for a new user → honest empty states).
  const records = useProgressRecords();
  const masteryDomains = useMasteryDomains();
  const epaProgress = useEpaProgress();
  const reviewCards = useReviewQueue();
  const levelState = useLevelState();
  const streakState = useStreakState();
  const calibrationTrajectory = useCalibrationTrajectory();
  const hasHistory = records.length > 0;

  const clinicalMastery = useMemo(
    () => masteryDomains.filter((d) => d.axis === "clinical"),
    [masteryDomains],
  );
  const commMastery = useMemo(
    () => masteryDomains.filter((d) => d.axis === "communication"),
    [masteryDomains],
  );

  // Snapshot readouts — the calibration gap now vs. its first tracked session
  // (smaller is better), and how many cards are due for review.
  const calibGapNow =
    calibrationTrajectory.length > 0
      ? Math.round(calibrationTrajectory[calibrationTrajectory.length - 1] * 100)
      : null;
  const calibGapFirst =
    calibrationTrajectory.length > 0
      ? Math.round(calibrationTrajectory[0] * 100)
      : 0;
  const calibNarrowed = calibGapNow == null ? 0 : calibGapFirst - calibGapNow;
  const calibTrend: StatTrend | undefined =
    calibGapNow != null && calibrationTrajectory.length > 1 && calibNarrowed !== 0
      ? {
          value: t("progress3.snapshot.gapTrend", {
            points: Math.abs(calibNarrowed),
          }),
          dir: calibNarrowed > 0 ? "down" : "up",
          goodUp: false,
        }
      : undefined;
  const dueReviews = reviewCards.filter((c) => c.state === "due").length;

  return (
    <PageContainer className="flex flex-col gap-10">
      {/* Header */}
      <motion.div {...header}>
        <PageHeader
          eyebrow={t("progress.eyebrow")}
          title={t("progress.title")}
          description={t("progress.subtitle")}
          meta={
            <span className="inline-flex items-center gap-1.5 text-xs text-muted">
              <Lock weight="bold" className="h-3.5 w-3.5" aria-hidden />
              {t("home.noPublicLeaderboard")}
            </span>
          }
        />
      </motion.div>

      {/* Snapshot strip — level, streak, calibration and review at a glance. */}
      <motion.section
        {...snapshot}
        aria-label={t("progress.level.sectionLabel")}
      >
        <Card padding="none" className="overflow-hidden">
          <div className="grid grid-cols-2 gap-px bg-border lg:grid-cols-4">
            <div className="bg-surface p-5">
              <Stat
                size="lg"
                label={t("progress3.snapshot.level")}
                value={levelState.level}
                icon={<Trophy weight="bold" className="h-3.5 w-3.5" />}
                hint={levelState.title[lang]}
              />
            </div>
            <div className="bg-surface p-5">
              <Stat
                size="lg"
                label={t("progress3.snapshot.streak")}
                value={streakState.currentDays}
                unit={t("progress3.snapshot.streakUnit")}
                icon={<Fire weight="fill" className="h-3.5 w-3.5" />}
                hint={t("progress.streak.best") + ": " + streakState.bestDays}
              />
            </div>
            <div className="bg-surface p-5">
              <Stat
                size="lg"
                label={t("progress3.snapshot.calibrationGap")}
                value={calibGapNow == null ? "—" : calibGapNow}
                unit={calibGapNow == null ? undefined : "%"}
                icon={<Target weight="bold" className="h-3.5 w-3.5" />}
                trend={calibTrend}
              />
            </div>
            <div className="bg-surface p-5">
              <Stat
                size="lg"
                label={t("progress3.snapshot.reviewsDue")}
                value={dueReviews}
                unit={t("progress3.snapshot.reviewsUnit")}
                icon={
                  <ClockCounterClockwise weight="bold" className="h-3.5 w-3.5" />
                }
                hint={
                  dueReviews > 0
                    ? t("progress.review.subtitle")
                    : t("progress2.review.allClear")
                }
              />
            </div>
          </div>
        </Card>
      </motion.section>

      {/* Mastery map */}
      <motion.section {...mastery} aria-label={t("progress.mastery.heading")}>
        <div className="flex items-center gap-2">
          <Target weight="bold" className="h-5 w-5 text-brand" aria-hidden />
          <h2 className="text-lg font-semibold tracking-tight text-fg">
            {t("progress.mastery.heading")}
          </h2>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          {t("progress.mastery.subtitle")}
        </p>

        {!hasHistory ? (
          <p className="mt-4 rounded-control border border-dashed border-border bg-bg-subtle p-4 text-sm text-muted">
            {t("progress.mastery.empty")}
          </p>
        ) : null}

        <div className="mt-4 grid gap-6 md:grid-cols-2">
          {/* Clinical group */}
          <div>
            <div className="mb-2.5 flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 rotate-45"
                style={{ backgroundColor: "var(--axis-clinical)" }}
                aria-hidden
              />
              <h3 className="text-sm font-semibold uppercase tracking-wide text-fg">
                {t("feedback.clinicalGroup")}
              </h3>
            </div>
            <div className="flex flex-col gap-2.5">
              {clinicalMastery.map((d) => (
                <MasteryRow key={d.key} domain={d} />
              ))}
            </div>
          </div>

          {/* Communication group */}
          <div>
            <div className="mb-2.5 flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: "var(--axis-communication)" }}
                aria-hidden
              />
              <h3 className="text-sm font-semibold uppercase tracking-wide text-fg">
                {t("feedback.communicationGroup")}
              </h3>
            </div>
            <div className="flex flex-col gap-2.5">
              {commMastery.map((d) => (
                <MasteryRow key={d.key} domain={d} />
              ))}
            </div>
          </div>
        </div>

        {/* Key EPAs entrusted */}
        <div className="mt-6">
          <div className="flex items-center gap-2">
            <SealCheck
              weight="bold"
              className="h-4 w-4 text-brand"
              aria-hidden
            />
            <h3 className="text-sm font-semibold uppercase tracking-wide text-fg">
              {t("progress.epa.heading")}
            </h3>
          </div>
          <p className="mt-1 text-xs text-muted">{t("progress.epa.subtitle")}</p>
          <ul className="mt-3 grid gap-2.5 md:grid-cols-2">
            {epaProgress.map((epa) => (
              <EpaRow key={epa.id} epa={epa} />
            ))}
          </ul>
        </div>
      </motion.section>

      {/* Calibration trajectory */}
      <motion.section {...trajectory}>
        <div className="flex items-center gap-2">
          <TrendDown weight="bold" className="h-5 w-5 text-brand" aria-hidden />
          <h2 className="text-lg font-semibold tracking-tight text-fg">
            {t("progress.trajectory.heading")}
          </h2>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          {t("progress.trajectory.subtitle")}
        </p>
        <div className="mt-3">
          <TrajectoryCard />
        </div>
      </motion.section>

      {/* Momentum — level detail + forgiving streak (supporting, not the lead). */}
      <motion.section
        {...momentum}
        aria-label={t("progress.level.sectionLabel")}
      >
        <SectionLabel className="mb-3">
          {t("progress.level.sectionLabel")}
        </SectionLabel>
        <div className="grid gap-5 lg:grid-cols-2">
          <LevelCard />
          <StreakCard />
        </div>
      </motion.section>

      {/* Badges */}
      <motion.section {...badgesEntry} aria-label={t("progress.badges.heading")}>
        <BadgesSection />
      </motion.section>

      {/* Spaced-repetition queue */}
      <motion.section {...review} aria-label={t("progress.review.heading")}>
        <ReviewSection />
      </motion.section>

      {/* Self-comparison (your own trend; no fabricated cohort) */}
      <motion.section
        {...cohort}
        aria-label={t("progress4.self.heading", {
          defaultValue: "Your progress, measured against you",
        })}
      >
        <SelfComparisonCard />
      </motion.section>
    </PageContainer>
  );
}
