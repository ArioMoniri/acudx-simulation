import { useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import {
  ArrowRight,
  ArrowUpRight,
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
} from "@phosphor-icons/react";

import { PageContainer } from "@/components/shell";
import { Card, Badge, Button, Switch } from "@/components/ui";
import { CalibrationPlot, CitationPill, Sparkline } from "@/components";
import { useEntry, useLang } from "@/lib/useLang";
import { cn } from "@/lib/cn";
import {
  calibrationPoints,
  calibrationTrajectory,
  type Band,
} from "@/data/mock";
import {
  levelState,
  recentXp,
  streakState,
  masteryDomains,
  MASTERY_BANDS,
  epaProgress,
  badges,
  calibrationSessions,
  domainTrends,
  reviewQueue,
  dueNowCount,
  cohortComparison,
  type XpAward,
  type StreakDay,
  type MasteryDomain,
  type EpaProgress,
  type Badge as BadgeData,
  type BadgeIcon,
  type ReviewCard,
} from "@/data/progress";

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
  const pct = Math.round(
    (levelState.xpIntoLevel / levelState.xpForNextLevel) * 100,
  );
  const remaining = levelState.xpForNextLevel - levelState.xpIntoLevel;

  return (
    <Card padding="lg" className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span
            className="grid h-11 w-11 shrink-0 place-items-center rounded-control bg-brand-tint text-brand"
            aria-hidden
          >
            <Trophy weight="bold" className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              {t("progress.level.eyebrow", { level: levelState.level })}
            </p>
            <p className="text-lg font-semibold tracking-tight text-fg">
              {levelState.title[lang]}
            </p>
          </div>
        </div>
        <span className="shrink-0 text-right">
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

function StreakCard() {
  const { t } = useTranslation();

  return (
    <Card padding="lg" className="flex h-full flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span
            className="grid h-11 w-11 shrink-0 place-items-center rounded-control text-[color:var(--state-warning)]"
            style={{
              backgroundColor:
                "color-mix(in srgb, var(--state-warning) 14%, transparent)",
            }}
            aria-hidden
          >
            <Fire weight="fill" className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              {t("progress.streak.eyebrow")}
            </p>
            <p className="text-2xl font-semibold leading-tight text-fg">
              <span className="font-mono">{streakState.currentDays}</span>{" "}
              <span className="text-base font-medium text-muted">
                {t("progress.streak.days")}
              </span>
            </p>
          </div>
        </div>
        <span className="shrink-0 text-right">
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
          <li key={d.key} className="flex flex-1 flex-col items-center gap-1.5">
            <span
              className={cn(
                "grid h-9 w-full place-items-center rounded-control",
                streakDayStyle[d.state],
              )}
              aria-hidden
            >
              {d.state === "freeze" ? (
                <Snowflake weight="fill" className="h-4 w-4" />
              ) : d.state === "practised" ? (
                <CheckCircle weight="fill" className="h-4 w-4" />
              ) : d.state === "today" ? (
                <Fire weight="bold" className="h-4 w-4" />
              ) : null}
            </span>
            <span className="text-[10px] font-medium text-muted">
              {t(`progress.streak.weekday.${d.key}`)}
            </span>
            <span className="sr-only">
              {t(`progress.streak.dayState.${d.state}`)}
            </span>
          </li>
        ))}
      </ul>

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
/* Section: Mastery map (competency x level grid)                              */
/* -------------------------------------------------------------------------- */

function MasteryRow({ domain }: { domain: MasteryDomain }) {
  const { t } = useTranslation();
  const accent = axisAccent(domain.axis);
  const name = t(`feedback.domains.${domain.key}`);
  const rowLabelId = useId();

  if (domain.band === "withheld") {
    return (
      <div className="rounded-control border border-dashed border-border bg-bg-subtle p-3.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-fg">{name}</span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-0.5 text-xs font-medium text-muted">
            <Lock weight="bold" className="h-3 w-3" aria-hidden />
            {t("bands.withheld")}
          </span>
        </div>
        <p className="mt-1.5 text-xs text-muted">
          {t("progress.mastery.notEnough", { count: domain.evidenceCount })}
        </p>
      </div>
    );
  }

  const achievedIndex = MASTERY_BANDS.indexOf(
    domain.band as Exclude<Band, "withheld">,
  );
  const TrendIcon =
    domain.deltaBand > 0
      ? trendIcon.up
      : domain.deltaBand < 0
        ? trendIcon.down
        : trendIcon.steady;
  const trendKey =
    domain.deltaBand > 0 ? "up" : domain.deltaBand < 0 ? "down" : "steady";

  return (
    <div className="rounded-control border border-border bg-surface p-3.5">
      <div className="flex items-center justify-between gap-2">
        <span
          id={rowLabelId}
          className="inline-flex items-center gap-2 text-sm font-medium text-fg"
        >
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
            <span aria-hidden>{t(`progress.mastery.deltaShort.${trendKey}`)}</span>
          </span>
        </span>
      </div>

      {/* Five-step band meter (achieved step carries fill + position) */}
      <div
        className="mt-3 grid grid-cols-5 items-end gap-1"
        role="img"
        aria-labelledby={rowLabelId}
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
    </div>
  );
}

function EpaRow({ epa }: { epa: EpaProgress }) {
  const { t } = useTranslation();
  const lang = useLang();
  const entrusted = epa.level >= 4;

  return (
    <li className="flex flex-col gap-2 rounded-control border border-border bg-surface p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 shrink-0 rounded-full border border-border bg-bg-subtle px-2 py-0.5 font-mono text-[11px] font-semibold text-fg">
            {epa.code}
          </span>
          <span className="min-w-0 text-sm text-fg">{epa.title[lang]}</span>
        </div>
        {entrusted ? (
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
          level: epa.level,
        })}
      >
        {[1, 2, 3, 4, 5].map((lvl) => {
          const reached = lvl <= epa.level;
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
        <span className="text-xs text-muted">
          {t("progress.epa.demonstrations", { count: epa.demonstrations })}
        </span>
        <CitationPill citationId={epa.citationId} lang={lang} />
      </div>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Section: Badges                                                              */
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

/* -------------------------------------------------------------------------- */
/* Section: Calibration trajectory (small multiples + trend)                   */
/* -------------------------------------------------------------------------- */

function domainGap(gaps: number[]): { first: number; last: number } {
  return { first: gaps[0], last: gaps[gaps.length - 1] };
}

function TrajectoryCard() {
  const { t } = useTranslation();
  const lang = useLang();

  const gapSeries = calibrationSessions.map((s) => s.gap);
  const brierSeries = calibrationSessions.map((s) => s.brier);
  const gapNow = Math.round(gapSeries[gapSeries.length - 1] * 100);
  const gapStart = Math.round(gapSeries[0] * 100);
  const gapDrop = gapStart - gapNow;

  return (
    <Card padding="lg" className="flex flex-col gap-5">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
        {/* Headline gap + Brier sparklines */}
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-control bg-bg-subtle p-3.5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">
                {t("progress.trajectory.gapLabel")}
              </p>
              <p className="mt-1 font-mono text-2xl font-semibold leading-none text-fg">
                {gapNow}
                <span className="text-base text-muted">%</span>
              </p>
              <div className="mt-2 flex items-center gap-2">
                <Sparkline
                  data={gapSeries}
                  color="var(--brand-600)"
                  filled
                  className="h-7 w-24"
                />
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[color:var(--state-normal)]">
                  <TrendDown weight="bold" className="h-3 w-3" aria-hidden />
                  {t("progress.trajectory.gapDrop", { points: gapDrop })}
                </span>
              </div>
            </div>
            <div className="rounded-control bg-bg-subtle p-3.5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">
                {t("progress.trajectory.brierLabel")}
              </p>
              <p className="mt-1 font-mono text-2xl font-semibold leading-none text-fg">
                {brierSeries[brierSeries.length - 1].toFixed(2)}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <Sparkline
                  data={brierSeries}
                  color="var(--axis-communication)"
                  filled
                  className="h-7 w-24"
                />
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted">
                  <TrendDown weight="bold" className="h-3 w-3" aria-hidden />
                  {t("progress.trajectory.lowerBetter")}
                </span>
              </div>
            </div>
          </div>

          {/* Per-domain small multiples */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              {t("progress.trajectory.perDomain")}
            </p>
            <ul className="mt-2.5 grid gap-2 sm:grid-cols-2">
              {domainTrends.map((d) => {
                const { first, last } = domainGap(d.gaps);
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
                        improved
                          ? "var(--state-normal)"
                          : "var(--fg-muted)"
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
/* Section: Spaced-repetition queue (FSRS)                                      */
/* -------------------------------------------------------------------------- */

const reviewStateTone: Record<
  ReviewCard["state"],
  "caution" | "brand" | "neutral"
> = {
  due: "caution",
  learning: "brand",
  scheduled: "neutral",
};

function ReviewRow({ card }: { card: ReviewCard }) {
  const { t } = useTranslation();
  const lang = useLang();
  const recallPct = Math.round(card.retrievability * 100);
  const dueLabel =
    card.dueInDays <= 0
      ? t("progress.review.dueNow")
      : t("progress.review.dueInDays", { count: card.dueInDays });

  return (
    <li className="flex flex-col gap-2.5 rounded-control border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 flex-1 text-sm font-medium text-fg">
          {card.prompt[lang]}
        </p>
        <Badge tone={reviewStateTone[card.state]}>
          {card.state === "due" ? (
            <Fire weight="fill" className="h-3 w-3" aria-hidden />
          ) : card.state === "learning" ? (
            <Sparkle weight="fill" className="h-3 w-3" aria-hidden />
          ) : (
            <CalendarCheck weight="bold" className="h-3 w-3" aria-hidden />
          )}
          {t(`progress.review.state.${card.state}`)}
        </Badge>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted">
          <span
            className="inline-block rounded-full px-1.5 py-0.5 font-mono text-[11px] font-medium text-fg"
            style={{
              backgroundColor:
                "color-mix(in srgb, var(--fg-muted) 12%, transparent)",
            }}
          >
            {t(`feedback.domains.${card.domain}` as const)}
          </span>
        </span>
        <span className="text-xs text-muted">
          {t("progress.review.recall", { percent: recallPct })}
        </span>
        <span className="text-xs text-muted">
          {t("progress.review.stability", { days: card.stabilityDays })}
        </span>
        <span className="text-xs font-medium text-fg">{dueLabel}</span>
        <span className="ml-auto">
          <CitationPill citationId={card.citationId} lang={lang} />
        </span>
      </div>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Section: Opt-in cohort comparison (improvement only, never a leaderboard)   */
/* -------------------------------------------------------------------------- */

function CohortCard() {
  const { t } = useTranslation();
  const [optedIn, setOptedIn] = useState(cohortComparison.optedIn);
  const switchId = useId();

  return (
    <Card padding="lg" className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span
            className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-control bg-bg-subtle text-muted"
            aria-hidden
          >
            <Eye weight="bold" className="h-4.5 w-4.5" />
          </span>
          <div>
            <h3 className="text-base font-semibold tracking-tight text-fg">
              {t("progress.cohort.heading")}
            </h3>
            <p className="mt-1 max-w-md text-sm text-muted">
              {t("progress.cohort.explainer")}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <label
            htmlFor={switchId}
            className="text-xs font-medium text-muted"
          >
            {optedIn ? t("progress.cohort.on") : t("progress.cohort.off")}
          </label>
          <Switch
            id={switchId}
            checked={optedIn}
            onCheckedChange={setOptedIn}
            aria-label={t("progress.cohort.toggleAria")}
          />
        </div>
      </div>

      {optedIn ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-control bg-bg-subtle p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              {t("progress.cohort.yourImprovement")}
            </p>
            <p className="mt-1 font-mono text-2xl font-semibold leading-none text-[color:var(--state-normal)]">
              +{cohortComparison.yourImprovementPct}
              <span className="text-base text-muted"> pp</span>
            </p>
            <p className="mt-2 text-xs text-muted">
              {t("progress.cohort.vsMedian", {
                median: cohortComparison.cohortMedianImprovementPct,
              })}
            </p>
          </div>
          <div className="rounded-control bg-bg-subtle p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              {t("progress.cohort.percentileLabel")}
            </p>
            <p className="mt-1 font-mono text-2xl font-semibold leading-none text-fg">
              {cohortComparison.improvementPercentile}
              <span className="text-base text-muted">th</span>
            </p>
            <p className="mt-2 text-xs text-muted">
              {t("progress.cohort.percentileNote", {
                size: cohortComparison.cohortSize,
              })}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2.5 rounded-control border border-dashed border-border bg-bg-subtle p-4">
          <ShieldCheck
            weight="bold"
            className="mt-0.5 h-4 w-4 shrink-0 text-muted"
            aria-hidden
          />
          <p className="text-sm text-muted">{t("progress.cohort.offNote")}</p>
        </div>
      )}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

/** ProgressPage — the returning-learner hub (Journey 5). */
export function ProgressPage() {
  const { t } = useTranslation();
  const header = useEntry();
  const topRow = useEntry(0.06);
  const mastery = useEntry(0.1);
  const trajectory = useEntry(0.14);
  const badgesEntry = useEntry(0.18);
  const review = useEntry(0.22);
  const cohort = useEntry(0.26);

  const clinicalMastery = useMemo(
    () => masteryDomains.filter((d) => d.axis === "clinical"),
    [],
  );
  const commMastery = useMemo(
    () => masteryDomains.filter((d) => d.axis === "communication"),
    [],
  );

  const earnedBadges = badges.filter((b) => b.earned).length;

  return (
    <PageContainer className="flex flex-col gap-10">
      {/* Header */}
      <motion.header {...header} className="max-w-3xl">
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
          <span className="gradient-mark h-1.5 w-1.5 rounded-full" aria-hidden />
          {t("progress.eyebrow")}
        </span>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
          {t("progress.title")}
        </h1>
        <p className="mt-3 max-w-2xl text-lg text-muted">
          {t("progress.subtitle")}
        </p>
        <p className="mt-3 inline-flex items-center gap-2 text-xs text-muted">
          <Lock weight="bold" className="h-3.5 w-3.5" aria-hidden />
          {t("home.noPublicLeaderboard")}
        </p>
      </motion.header>

      {/* Level + XP | Streak */}
      <motion.section
        {...topRow}
        aria-label={t("progress.level.sectionLabel")}
        className="grid gap-6 lg:grid-cols-2"
      >
        <LevelCard />
        <StreakCard />
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
          <TrendDown
            weight="bold"
            className="h-5 w-5 text-brand"
            aria-hidden
          />
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

      {/* Badges */}
      <motion.section {...badgesEntry} aria-label={t("progress.badges.heading")}>
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex items-center gap-2">
            <Trophy weight="bold" className="h-5 w-5 text-brand" aria-hidden />
            <h2 className="text-lg font-semibold tracking-tight text-fg">
              {t("progress.badges.heading")}
            </h2>
          </div>
          <span className="text-sm text-muted">
            {t("progress.badges.count", {
              earned: earnedBadges,
              total: badges.length,
            })}
          </span>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          {t("progress.badges.subtitle")}
        </p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {badges.map((b) => (
            <BadgeTile key={b.id} badge={b} />
          ))}
        </ul>
      </motion.section>

      {/* Spaced-repetition queue */}
      <motion.section {...review} aria-label={t("progress.review.heading")}>
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
            {dueNowCount > 0 ? (
              <Badge tone="caution">
                <Fire weight="fill" className="h-3 w-3" aria-hidden />
                {t("progress.review.dueBadge", { count: dueNowCount })}
              </Badge>
            ) : null}
          </div>
          <Button
            size="sm"
            asChild
            trailingIcon={<ArrowRight weight="bold" className="h-4 w-4" />}
          >
            <Link to="/cases">{t("progress.review.startReview")}</Link>
          </Button>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          {t("progress.review.subtitle")}
        </p>
        <ul className="mt-4 flex flex-col gap-2.5">
          {reviewQueue.map((c) => (
            <ReviewRow key={c.id} card={c} />
          ))}
        </ul>
      </motion.section>

      {/* Opt-in cohort comparison */}
      <motion.section {...cohort} aria-label={t("progress.cohort.heading")}>
        <CohortCard />
      </motion.section>
    </PageContainer>
  );
}
