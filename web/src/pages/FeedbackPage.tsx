import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import {
  ShieldWarning,
  CheckCircle,
  ArrowClockwise,
  CalendarPlus,
  Info,
  Timer,
  Heartbeat,
} from "@phosphor-icons/react";

import { PageContainer } from "@/components/shell";
import { Card, Badge, Button, Stat } from "@/components/ui";
import {
  DomainBand,
  GapCard,
  CalibrationPlot,
  ProcessTimingCard,
  TreatmentChecklist,
  CitationPill,
} from "@/components";
import {
  feedbackReport,
  feedbackDomains,
  feedbackGaps,
  calibrationPoints,
  calibrationTrajectory,
  feedbackEncounterEvents,
  treatmentBehaviors,
} from "@/data/mock";
import { chestPainNstemiCase } from "@/data/seedCases";
import { expectedIntents } from "@/domain/case";
import {
  computeProcessMetrics,
  safetyCriticalMisses,
} from "@/domain/processMetrics";
import type { EncounterEvent } from "@/state/encounterStore";
import { useEntry, useLang } from "@/lib/useLang";

/** Whole minutes from ms for compact timing readouts. */
function toMin(ms: number): number {
  return Math.round(ms / 60_000);
}

/** FeedbackPage — the post-encounter formative report. */
export function FeedbackPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const header = useEntry();
  const bands = useEntry(0.06);
  const calib = useEntry(0.12);
  const process = useEntry(0.16);
  const gaps = useEntry(0.2);
  const remediation = useEntry(0.24);

  const clinicalDomains = feedbackDomains.filter((d) => d.axis === "clinical");
  const commDomains = feedbackDomains.filter((d) => d.axis === "communication");

  const safetyGap = feedbackGaps.find((g) => g.safetyCritical);
  const otherGaps = feedbackGaps.filter((g) => !g.safetyCritical);

  // Process metrics derived from a representative event log against the seed
  // NSTEMI case (docs/00-overview/04 §4). Pure + memoized on the static fixture.
  const metrics = useMemo(
    () =>
      computeProcessMetrics(
        feedbackEncounterEvents as unknown as EncounterEvent[],
        chestPainNstemiCase,
      ),
    [],
  );

  // Safety-critical process misses, surfaced separately and always (§4.2, AS-8):
  // a missed time-critical action OR an unmet critical safety behavior (e.g. the
  // allergy check before prescribing).
  const timingMisses = safetyCriticalMisses(metrics);
  const safetyBehaviorMisses = treatmentBehaviors.filter(
    (b) => b.critical && !b.met,
  );
  const hasProcessSafetyMiss =
    timingMisses.length > 0 || safetyBehaviorMisses.length > 0;

  const coveragePct = Math.round(metrics.historyCoveragePct * 100);
  const expectedCount = expectedIntents(chestPainNstemiCase).length;
  const coveredCount = Math.round(metrics.historyCoveragePct * expectedCount);

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

      {/* Process & timing (docs/00-overview/04 §4) */}
      <motion.section {...process} aria-label={t("feedback.process.heading")}>
        <div className="flex items-center gap-2">
          <Timer weight="bold" className="h-5 w-5 text-brand" aria-hidden />
          <h2 className="text-lg font-semibold tracking-tight text-fg">
            {t("feedback.process.heading")}
          </h2>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          {t("feedback.process.subtitle")}
        </p>

        {/* Safety-critical process miss — separate + always shown (AS-8) */}
        <div
          className="mt-4 flex items-start gap-2.5 rounded-card border p-4"
          style={
            hasProcessSafetyMiss
              ? {
                  borderColor:
                    "color-mix(in srgb, var(--state-critical) 45%, transparent)",
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
          {hasProcessSafetyMiss ? (
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
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-fg">
              {hasProcessSafetyMiss
                ? t("feedback.process.safety.missTitle")
                : t("feedback.process.safety.cleanTitle")}
            </p>
            {hasProcessSafetyMiss ? (
              <ul className="mt-2 flex flex-col gap-2">
                {safetyBehaviorMisses.map((b) => (
                  <li key={b.id} className="flex flex-col gap-1.5">
                    <span className="text-sm text-fg">{b.label[lang]}</span>
                    <span className="text-xs text-muted">{b.anchor[lang]}</span>
                    <span>
                      <CitationPill citationId={b.citationId} lang={lang} />
                    </span>
                  </li>
                ))}
                {timingMisses.map((a) => (
                  <li key={a.expectationId} className="flex flex-col gap-1.5">
                    <span className="text-sm text-fg">
                      {lang === "tr" ? a.labelTr : a.labelEn}
                    </span>
                    <span className="text-xs text-muted">
                      {t("feedback.process.timing.missedAnchor", {
                        target: toMin(a.idealWindowMs),
                      })}
                    </span>
                    <span>
                      <CitationPill citationId={a.citationId} lang={lang} />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-muted">
                {t("feedback.process.safety.cleanNote")}
              </p>
            )}
          </div>
        </div>

        {/* Coverage / efficiency / totals */}
        <Card padding="md" className="mt-4">
          <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
            <Stat
              label={t("feedback.process.coverage.label")}
              value={coveragePct}
              unit="%"
              hint={t("feedback.process.coverage.hint", {
                covered: coveredCount,
                expected: expectedCount,
              })}
            />
            <Stat
              label={t("feedback.process.redundant.label")}
              value={metrics.redundantQuestions}
              hint={t("feedback.process.redundant.hint", {
                count: metrics.irrelevantQuestions,
              })}
            />
            <Stat
              label={t("feedback.process.totalTime.label")}
              value={toMin(metrics.totalTimeMs)}
              unit={t("feedback.process.minUnit")}
              hint={t("feedback.process.totalTime.hint")}
            />
            <Stat
              label={t("feedback.process.timeToDx.label")}
              value={
                metrics.timeToDiagnosisMs == null
                  ? "—"
                  : toMin(metrics.timeToDiagnosisMs)
              }
              unit={metrics.timeToDiagnosisMs == null ? undefined : t("feedback.process.minUnit")}
              hint={
                metrics.diagnosisCorrect
                  ? t("feedback.process.timeToDx.correct")
                  : t("feedback.process.timeToDx.incorrect")
              }
            />
          </div>
        </Card>

        {/* Time-to-critical-action list (each cited) */}
        <div className="mt-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-fg">
            {t("feedback.process.criticalActions")}
          </h3>
          <p className="mt-1 text-xs text-muted">
            {t("feedback.process.criticalActionsNote")}
          </p>
          <div className="mt-3 grid gap-2.5 md:grid-cols-2">
            {metrics.timeToCriticalAction.map((a) => (
              <ProcessTimingCard key={a.expectationId} action={a} lang={lang} />
            ))}
          </div>
        </div>

        {/* How the patient was treated — communication + safety, cited */}
        <div className="mt-5">
          <div className="flex items-center gap-2">
            <Heartbeat weight="bold" className="h-4 w-4 text-brand" aria-hidden />
            <h3 className="text-sm font-semibold uppercase tracking-wide text-fg">
              {t("feedback.process.treatment.heading")}
            </h3>
          </div>
          <div className="mt-3">
            <TreatmentChecklist behaviors={treatmentBehaviors} lang={lang} />
          </div>
        </div>
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
