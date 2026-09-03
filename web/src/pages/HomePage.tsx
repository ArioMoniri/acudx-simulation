import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import {
  ArrowRight,
  TrendUp,
  TrendDown,
  Trophy,
  Fire,
  Target,
  ShieldWarning,
  CheckCircle,
  SealCheck,
  ArrowUpRight,
} from "@phosphor-icons/react";

import { PageContainer } from "@/components/shell";
import { Card, Button, Badge } from "@/components/ui";
import { CaseCard, CalibrationPlot } from "@/components";
import {
  dashboardStats,
  recommendedCases,
  recentFeedback,
  calibrationPoints,
  calibrationTrajectory,
  type DashboardStat,
  type RecentFeedbackItem,
} from "@/data/mock";
import { useLang } from "@/lib/useLang";
import {
  useReveal,
  useStagger,
  useStaggerItem,
  useHoverLift,
} from "@/lib/motion";
import { cn } from "@/lib/cn";

const statIcon: Record<DashboardStat["key"], typeof Trophy> = {
  completed: Trophy,
  streak: Fire,
  gap: Target,
};

function StatTile({ stat }: { stat: DashboardStat }) {
  const { t } = useTranslation();
  const lang = useLang();
  const item = useStaggerItem();
  const lift = useHoverLift();
  const Icon = statIcon[stat.key];
  const TrendIcon = stat.trend === "up" ? TrendUp : TrendDown;
  // "good" direction gets the normal-state color; otherwise stays muted.
  const trendGood =
    (stat.trend === "up" && stat.upIsGood) ||
    (stat.trend === "down" && !stat.upIsGood);

  return (
    <motion.div {...item} {...lift} className="flex">
      <Card
        padding="lg"
        className="flex h-full w-full flex-col gap-3 transition-shadow duration-300 ease-out hover:shadow-soft-md"
      >
        <div className="flex items-center justify-between">
          <span className="grid h-9 w-9 place-items-center rounded-control bg-brand-tint text-brand">
            <Icon weight="bold" className="h-4.5 w-4.5" aria-hidden />
          </span>
          {stat.trend ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                trendGood
                  ? "text-[color:var(--state-normal)] bg-[color-mix(in_srgb,var(--state-normal)_14%,transparent)]"
                  : "text-muted bg-bg-subtle",
              )}
            >
              <TrendIcon weight="bold" className="h-3 w-3" aria-hidden />
              {t(stat.trend === "up" ? "stats.trendingUp" : "stats.trendingDown")}
            </span>
          ) : null}
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted">
            {t(`stats.${stat.key}`)}
          </p>
          <p className="mt-0.5 font-mono text-3xl font-semibold leading-none text-fg">
            {stat.value}
          </p>
          <p className="mt-1.5 text-xs text-muted">{stat.caption[lang]}</p>
        </div>
      </Card>
    </motion.div>
  );
}

const bandTone: Record<string, "brand" | "normal" | "neutral"> = {
  exemplary: "normal",
  strong: "brand",
  proficient: "brand",
  developing: "neutral",
  emerging: "neutral",
};

function RecentRow({ item }: { item: RecentFeedbackItem }) {
  const { t } = useTranslation();
  const lang = useLang();
  const row = useStaggerItem();
  const when =
    item.daysAgo === 0
      ? t("recentFeedback.today")
      : t("recentFeedback.daysAgo", { count: item.daysAgo });

  return (
    <motion.li {...row}>
      <Link
        to="/feedback"
        className={cn(
          "group flex items-start gap-3 rounded-control border border-border bg-surface p-3.5",
          "transition-colors duration-200 ease-out hover:bg-bg-subtle focus-visible:outline-none",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full",
            item.hadSafetyMiss
              ? "bg-[color-mix(in_srgb,var(--state-critical)_14%,transparent)] text-[color:var(--state-critical)]"
              : "bg-[color-mix(in_srgb,var(--state-normal)_14%,transparent)] text-[color:var(--state-normal)]",
          )}
        >
          {item.hadSafetyMiss ? (
            <ShieldWarning weight="fill" className="h-4 w-4" />
          ) : (
            <CheckCircle weight="fill" className="h-4 w-4" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-medium text-fg">
              {item.caseTitle[lang]}
            </p>
            <span className="shrink-0 text-xs text-muted">{when}</span>
          </div>
          <p className="mt-0.5 text-sm text-muted">{item.takeaway[lang]}</p>
          <div className="mt-1.5 flex items-center gap-2">
            <Badge tone={bandTone[item.topBand] ?? "neutral"}>
              <SealCheck weight="fill" className="h-3 w-3" aria-hidden />
              {t(`bands.${item.topBand}`)}
            </Badge>
            <span className="text-[11px] text-muted">
              {item.hadSafetyMiss
                ? t("recentFeedback.safetyFlag")
                : t("recentFeedback.noSafety")}
            </span>
          </div>
        </div>
        <ArrowRight
          weight="bold"
          className="mt-1 h-4 w-4 shrink-0 text-muted transition-transform duration-200 ease-out group-hover:translate-x-0.5"
          aria-hidden
        />
      </Link>
    </motion.li>
  );
}

/** HomePage — the premium clinical dashboard. */
export function HomePage() {
  const { t } = useTranslation();
  const lang = useLang();
  const header = useReveal();
  const cta = useReveal(0.06);
  const snapshot = useReveal(0.12);
  const casesHead = useReveal(0.16);
  const recentHead = useReveal(0.2);
  const stats = useStagger();
  const cards = useStagger();
  const recent = useStagger();
  const cardLift = useHoverLift();

  return (
    <PageContainer className="flex flex-col gap-10">
      {/* Welcome header */}
      <motion.header {...header} className="max-w-3xl">
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
          <span className="gradient-mark h-1.5 w-1.5 rounded-full" aria-hidden />
          {t("home.greetingEyebrow")}
        </span>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
          {t("home.welcome")}
        </h1>
        <p className="mt-3 max-w-2xl text-lg text-muted">
          {t("home.welcomeSub")}
        </p>
      </motion.header>

      {/* Primary CTA + resume chip */}
      <motion.section {...cta} className="flex flex-wrap items-center gap-3">
        <Button
          asChild
          size="lg"
          trailingIcon={<ArrowRight weight="bold" className="h-4 w-4" />}
        >
          <Link to="/encounter">{t("home.primaryCtaContinue")}</Link>
        </Button>
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-sm text-muted">
          <span
            className="h-2 w-2 rounded-full bg-brand motion-safe:animate-pulse"
            aria-hidden
          />
          {t("home.resumeChip")}
        </span>
        <span className="ml-auto hidden text-xs text-muted sm:inline">
          {t("home.noPublicLeaderboard")}
        </span>
      </motion.section>

      {/* Stat tiles */}
      <section aria-label={t("home.statsHeading")}>
        <motion.div {...stats.container} className="grid gap-4 sm:grid-cols-3">
          {dashboardStats.map((s) => (
            <StatTile key={s.key} stat={s} />
          ))}
        </motion.div>
      </section>

      {/* Calibration snapshot + recommended cases */}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,320px)_1fr]">
        <motion.section {...snapshot}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold tracking-tight text-fg">
              {t("home.snapshotHeading")}
            </h2>
          </div>
          <p className="mt-1 text-sm text-muted">{t("home.snapshotSub")}</p>
          <Card padding="lg" className="mt-3">
            <CalibrationPlot
              points={calibrationPoints}
              trajectory={calibrationTrajectory}
              lang={lang}
              small
            />
            <Link
              to="/feedback"
              className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline focus-visible:outline-none"
            >
              {t("calibration.title")}
              <ArrowUpRight weight="bold" className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </Card>
        </motion.section>

        <section>
          <motion.div {...casesHead}>
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold tracking-tight text-fg">
                {t("home.recommendedHeading")}
              </h2>
              <Link
                to="/encounter"
                className="text-sm font-medium text-brand hover:underline focus-visible:outline-none"
              >
                {t("home.viewAllCases")}
              </Link>
            </div>
            <p className="mt-1 text-sm text-muted">{t("home.recommendedSub")}</p>
          </motion.div>
          <motion.div
            {...cards.container}
            className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
          >
            {recommendedCases.map((c) => (
              <motion.div
                key={c.id}
                {...cards.item}
                {...cardLift}
                className="flex"
              >
                <CaseCard data={c} lang={lang} />
              </motion.div>
            ))}
          </motion.div>
        </section>
      </div>

      {/* Recent feedback */}
      <section>
        <motion.div {...recentHead}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold tracking-tight text-fg">
              {t("home.recentHeading")}
            </h2>
          </div>
          <p className="mt-1 text-sm text-muted">{t("home.recentSub")}</p>
        </motion.div>
        {recentFeedback.length > 0 ? (
          <motion.ul
            {...recent.container}
            className="mt-3 flex flex-col gap-2.5"
          >
            {recentFeedback.map((item) => (
              <RecentRow key={item.id} item={item} />
            ))}
          </motion.ul>
        ) : (
          <Card padding="lg" className="mt-3 border-dashed text-center">
            <p className="text-sm font-medium text-fg">
              {t("home.empty.feedbackTitle")}
            </p>
            <p className="mt-1 text-sm text-muted">
              {t("home.empty.feedbackBody")}
            </p>
          </Card>
        )}
      </section>
    </PageContainer>
  );
}
