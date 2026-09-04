import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import {
  ArrowRight,
  ArrowUpRight,
  Fire,
  Target,
  Trophy,
} from "@phosphor-icons/react";

import { PageContainer, PageHeader } from "@/components/shell";
import { useDisplayName } from "@/state/profileStore";
import {
  Button,
  Card,
  SectionLabel,
  Stat,
  StatusDot,
  type StatTrend,
} from "@/components/ui";
import { CalibrationPlot } from "@/components";
import { CaseListRow } from "@/components/home/CaseListRow";
import { ActivityRow } from "@/components/home/ActivityRow";
import {
  calibrationPoints,
  calibrationTrajectory,
  dashboardStats,
  recentFeedback,
  recommendedCases,
  type DashboardStat,
} from "@/data/mock";
import { useLang } from "@/lib/useLang";
import { useReveal, useStagger } from "@/lib/motion";

const statIcon: Record<DashboardStat["key"], typeof Trophy> = {
  completed: Trophy,
  streak: Fire,
  gap: Target,
};

/** HomePage — the learner's clinical instrument panel. */
export function HomePage() {
  const { t } = useTranslation();
  const lang = useLang();
  const displayName = useDisplayName();
  const header = useReveal();
  const strip = useReveal(0.06);
  const body = useReveal(0.12);
  const cases = useStagger();
  const recent = useStagger();

  return (
    <PageContainer className="flex flex-col gap-8">
      {/* Zone 1 — greeting, the single primary action, and the term readout. */}
      <motion.div {...header}>
        <PageHeader
          eyebrow={t("home.greetingEyebrow")}
          title={
            displayName
              ? t("home.welcomeNamed", {
                  name: displayName,
                  defaultValue: "Welcome back, {{name}}",
                })
              : t("home.welcome")
          }
          description={t("home.welcomeSub")}
          actions={
            <Button
              asChild
              size="lg"
              trailingIcon={<ArrowRight weight="bold" className="h-4 w-4" />}
            >
              <Link to="/encounter">{t("home.primaryCtaContinue")}</Link>
            </Button>
          }
          meta={
            <>
              <StatusDot tone="brand" pulse label={t("home.resumeChip")} />
              <span className="hidden text-xs text-subtle sm:inline">
                {t("home.noPublicLeaderboard")}
              </span>
            </>
          }
        />
      </motion.div>

      <motion.section {...strip} aria-label={t("home.statsHeading")}>
        <Card padding="none" className="overflow-hidden">
          <div className="border-b border-border px-5 py-3">
            <SectionLabel>{t("home.statsHeading")}</SectionLabel>
          </div>
          <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {dashboardStats.map((s) => {
              const Icon = statIcon[s.key];
              const trend: StatTrend | undefined = s.trend
                ? {
                    value: t(
                      s.trend === "up"
                        ? "stats.trendingUp"
                        : "stats.trendingDown",
                    ),
                    dir: s.trend,
                    goodUp: s.upIsGood,
                  }
                : undefined;
              return (
                <div key={s.key} className="px-5 py-5">
                  <Stat
                    size="lg"
                    label={t(`stats.${s.key}`)}
                    value={s.value}
                    icon={<Icon weight="bold" className="h-3.5 w-3.5" />}
                    hint={s.caption[lang]}
                    trend={trend}
                  />
                </div>
              );
            })}
          </div>
        </Card>
      </motion.section>

      {/* Zone 2 — asymmetric body: recommended work (wide) + snapshot feed. */}
      <motion.div
        {...body}
        className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]"
      >
        {/* LEFT — recommended cases as an information-hierarchy list. */}
        <section className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-fg">
                {t("home.recommendedHeading")}
              </h2>
              <p className="mt-1 text-sm text-muted">
                {t("home.recommendedSub")}
              </p>
            </div>
            <Link
              to="/encounter"
              className="shrink-0 text-sm font-medium text-brand hover:underline focus-visible:outline-none"
            >
              {t("home.viewAllCases")}
            </Link>
          </div>
          <motion.ul {...cases.container} className="flex flex-col gap-3">
            {recommendedCases.map((c) => (
              <motion.li key={c.id} {...cases.item}>
                <CaseListRow data={c} lang={lang} />
              </motion.li>
            ))}
          </motion.ul>
        </section>

        {/* RIGHT — calibration snapshot + recent-feedback activity feed. */}
        <aside className="flex flex-col gap-6">
          <section>
            <Card padding="lg">
              <h2 className="text-sm font-semibold tracking-tight text-fg">
                {t("home.snapshotHeading")}
              </h2>
              <p className="mt-1 text-sm text-muted">{t("home.snapshotSub")}</p>
              <div className="mt-4">
                <CalibrationPlot
                  points={calibrationPoints}
                  trajectory={calibrationTrajectory}
                  lang={lang}
                  small
                />
              </div>
              <Link
                to="/feedback"
                className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline focus-visible:outline-none"
              >
                {t("calibration.title")}
                <ArrowUpRight weight="bold" className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </Card>
          </section>

          <section>
            <Card padding="none" className="overflow-hidden">
              <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold tracking-tight text-fg">
                  {t("home.recentHeading")}
                </h2>
                <Link
                  to="/feedback"
                  className="text-xs font-medium text-brand hover:underline focus-visible:outline-none"
                >
                  {t("recentFeedback.open")}
                </Link>
              </div>
              {recentFeedback.length > 0 ? (
                <motion.ul
                  {...recent.container}
                  className="divide-y divide-border"
                >
                  {recentFeedback.map((item) => (
                    <motion.li key={item.id} {...recent.item}>
                      <ActivityRow item={item} lang={lang} />
                    </motion.li>
                  ))}
                </motion.ul>
              ) : (
                <div className="px-4 py-8 text-center">
                  <p className="text-sm font-medium text-fg">
                    {t("home.empty.feedbackTitle")}
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    {t("home.empty.feedbackBody")}
                  </p>
                </div>
              )}
            </Card>
          </section>
        </aside>
      </motion.div>
    </PageContainer>
  );
}
