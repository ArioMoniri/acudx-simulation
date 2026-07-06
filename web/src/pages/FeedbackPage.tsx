import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import {
  ShieldWarning,
  CheckCircle,
  ArrowClockwise,
  CalendarPlus,
  Info,
} from "@phosphor-icons/react";

import { PageContainer } from "@/components/shell";
import { Card, Badge, Button } from "@/components/ui";
import { DomainBand, GapCard, CalibrationPlot } from "@/components";
import {
  feedbackReport,
  feedbackDomains,
  feedbackGaps,
  calibrationPoints,
  calibrationTrajectory,
} from "@/data/mock";
import { useEntry, useLang } from "@/lib/useLang";

/** FeedbackPage — the post-encounter formative report. */
export function FeedbackPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const header = useEntry();
  const bands = useEntry(0.06);
  const calib = useEntry(0.12);
  const gaps = useEntry(0.16);
  const remediation = useEntry(0.2);

  const clinicalDomains = feedbackDomains.filter((d) => d.axis === "clinical");
  const commDomains = feedbackDomains.filter((d) => d.axis === "communication");

  const safetyGap = feedbackGaps.find((g) => g.safetyCritical);
  const otherGaps = feedbackGaps.filter((g) => !g.safetyCritical);

  return (
    <PageContainer className="flex flex-col gap-8">
      {/* Header */}
      <motion.header {...header}>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
            {t("feedback.encounterTitle")}
          </h1>
          <Badge tone="brand">{t("feedback.formativeBadge")}</Badge>
        </div>
        <p className="mt-2 max-w-2xl text-muted">{t("feedback.subtitle")}</p>

        {/* Safety strip — always shown; distinct when a miss exists */}
        <div
          className="mt-4 flex items-start gap-2.5 rounded-card border p-3.5"
          style={
            safetyGap
              ? {
                  borderColor: "color-mix(in srgb, var(--state-critical) 45%, transparent)",
                  backgroundColor:
                    "color-mix(in srgb, var(--state-critical) 8%, transparent)",
                }
              : {
                  borderColor:
                    "color-mix(in srgb, var(--state-normal) 40%, transparent)",
                  backgroundColor:
                    "color-mix(in srgb, var(--state-normal) 8%, transparent)",
                }
          }
        >
          {safetyGap ? (
            <ShieldWarning
              weight="fill"
              className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--state-critical)]"
              aria-hidden
            />
          ) : (
            <CheckCircle
              weight="fill"
              className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--state-normal)]"
              aria-hidden
            />
          )}
          <p className="text-sm font-medium text-fg">
            {safetyGap
              ? t("feedback.safetyStripTitle")
              : t("feedback.safetyStripClean")}
          </p>
        </div>
      </motion.header>

      {/* Dual-axis band scores */}
      <motion.section {...bands} aria-label={t("feedback.domainsHeading")}>
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold tracking-tight text-fg">
            {t("feedback.dualAxis.title")}
          </h2>
        </div>
        <p className="mt-1 text-sm text-muted">
          {t("feedback.dualAxis.orthogonalNote")}
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
              {clinicalDomains.map((d) => (
                <DomainBand
                  key={d.key}
                  domainKey={d.key}
                  band={d.band}
                  axis={d.axis}
                />
              ))}
            </div>
          </div>

          {/* Communication / professionalism group */}
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
              {commDomains.map((d) => (
                <DomainBand
                  key={d.key}
                  domainKey={d.key}
                  band={d.band}
                  axis={d.axis}
                />
              ))}
            </div>
          </div>
        </div>
      </motion.section>

      {/* THE SIGNATURE — calibration plot */}
      <motion.section {...calib}>
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold tracking-tight text-fg">
            {t("calibration.title")}
          </h2>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          {t("calibration.subtitle")}
        </p>
        <Card padding="lg" className="mt-3">
          <div className="grid items-center gap-6 lg:grid-cols-[minmax(0,360px)_1fr]">
            <CalibrationPlot
              points={calibrationPoints}
              trajectory={calibrationTrajectory}
              lang={lang}
            />
            <div className="flex flex-col gap-3">
              <p className="text-sm leading-relaxed text-fg">
                {t("calibration.explainer")}
              </p>
              <div className="flex items-start gap-2 rounded-control bg-bg-subtle p-3">
                <Info
                  weight="fill"
                  className="mt-0.5 h-4 w-4 shrink-0 text-muted"
                  aria-hidden
                />
                <p className="text-xs text-muted">
                  {t("calibration.trajectoryArrow")} ·{" "}
                  {t("home.noPublicLeaderboard")}
                </p>
              </div>
            </div>
          </div>
        </Card>
      </motion.section>

      {/* Gap analysis */}
      <motion.section {...gaps} aria-label={t("feedback.gapsHeading")}>
        <h2 className="text-lg font-semibold tracking-tight text-fg">
          {t("feedback.gapsHeading")}
        </h2>
        <div className="mt-3 flex flex-col gap-3">
          {safetyGap ? <GapCard gap={safetyGap} lang={lang} /> : null}
          {otherGaps.map((g) => (
            <GapCard key={g.id} gap={g} lang={lang} />
          ))}
        </div>
      </motion.section>

      {/* Remediation CTAs */}
      <motion.section
        {...remediation}
        className="rounded-card border border-border bg-surface p-5 sm:p-6"
      >
        <h2 className="text-lg font-semibold tracking-tight text-fg">
          {t("feedback.remediationHeading")}
        </h2>
        <div className="mt-3 flex flex-wrap gap-3">
          <Button
            leadingIcon={<CalendarPlus weight="bold" className="h-4 w-4" />}
          >
            {t("feedback.remediation.spacedRepetition")}
          </Button>
          <Button
            variant="secondary"
            leadingIcon={<ArrowClockwise weight="bold" className="h-4 w-4" />}
          >
            {t("feedback.remediation.harderVariant")}
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted">
          {t("feedback.remediation.note")} · {t("feedback.provenance.mode")}:{" "}
          {feedbackReport.mode[lang]} · {t("feedback.provenance.version")}:{" "}
          {feedbackReport.version}
        </p>
      </motion.section>
    </PageContainer>
  );
}
