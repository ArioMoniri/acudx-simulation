import { useEffect, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
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
  Flask,
  Lock,
} from "@phosphor-icons/react";

import { PageContainer, PageHeader } from "@/components/shell";
import {
  Card,
  Badge,
  Button,
  Stat,
  SectionLabel,
  Divider,
  DescriptionList,
  KeyValue,
  type StatTrend,
} from "@/components/ui";
import {
  DomainBand,
  BAND_SCALE,
  GapCard,
  CalibrationPlot,
  ProcessTimingCard,
  TreatmentChecklist,
  CitationPill,
} from "@/components";
import { type Band, type FeedbackAxis } from "@/data/schema";
import { complaintFamilyOf } from "@/data/caseLibrary";
import { safetyCriticalMisses } from "@/domain/processMetrics";
import { useEncounterState } from "@/state/encounterStore";
import { CaseDebriefLayer } from "@/components/ehr/CaseDebriefLayer";
import {
  buildEncounterRecord,
  deriveFeedbackGaps,
  enqueueReview,
  deriveTreatmentBehaviors,
  hasMeaningfulProgress,
  recordEncounter,
  useCalibrationTrajectory,
  useLatestRecord,
  useProgressRecords,
} from "@/state/progressStore";
import { useEntry, useLang } from "@/lib/useLang";

/** Whole minutes from ms for compact timing readouts. */
function toMin(ms: number): number {
  return Math.round(ms / 60_000);
}

/** Rank of a scored band on the five-step scale (proficient = index 2). */
const PROFICIENT_INDEX = BAND_SCALE.indexOf("proficient");
function bandRank(b: Band): number {
  return b === "withheld"
    ? -1
    : BAND_SCALE.indexOf(b as Exclude<Band, "withheld">);
}

/** Small ◆ clinical / ● communication axis marker. */
function AxisMark({ axis }: { axis: FeedbackAxis }) {
  return (
    <span
      aria-hidden
      className={
        axis === "clinical"
          ? "inline-block h-2 w-2 rotate-45"
          : "inline-block h-2 w-2 rounded-full"
      }
      style={{
        backgroundColor:
          axis === "clinical"
            ? "var(--axis-clinical)"
            : "var(--axis-communication)",
      }}
    />
  );
}

/**
 * FeedbackPage — the post-encounter formative report.
 *
 * Everything here is derived from the learner's OWN completed encounter: if an
 * encounter is live it is scored from the real event log (`computeProcessMetrics`
 * runs over the store's EncounterEvent[]) and recorded; otherwise the most
 * recent recorded encounter is shown. With no history at all, an honest empty
 * state is shown — never a fabricated report.
 */
export function FeedbackPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const lang = useLang();
  const header = useEntry();
  const hero = useEntry(0.06);
  const bands = useEntry(0.12);
  const process = useEntry(0.16);
  const gaps = useEntry(0.2);
  const remediation = useEntry(0.24);

  const enc = useEncounterState();
  const latest = useLatestRecord();
  const trajectory = useCalibrationTrajectory();
  const records = useProgressRecords();

  // Score a live/just-finished encounter from its REAL log, if one is present.
  const liveRecord = useMemo(() => {
    if (
      enc.caseInstance &&
      enc.startTs != null &&
      hasMeaningfulProgress(enc.events)
    ) {
      return buildEncounterRecord(enc.events, enc.caseInstance, enc.startTs);
    }
    return null;
  }, [enc]);

  // Persist the live encounter's outcome so the plots fill from earned data.
  useEffect(() => {
    if (liveRecord) recordEncounter(liveRecord);
  }, [liveRecord]);

  const rec = liveRecord ?? latest;

  // Honest empty state — nothing to report until an encounter is completed.
  if (!rec) {
    return (
      <PageContainer className="flex flex-col gap-8">
        <motion.div {...header}>
          <PageHeader
            eyebrow={t("feedback.title")}
            title={t("feedback.empty.title")}
            description={t("feedback.empty.body")}
          />
        </motion.div>
        <Card padding="lg">
          <div className="rounded-control border border-dashed border-border bg-bg-subtle p-8 text-center">
            <p className="text-sm font-medium text-fg">
              {t("common.emptyEncounters")}
            </p>
            <div className="mt-4">
              <Button asChild>
                <Link to="/encounter">{t("home.primaryCtaContinue")}</Link>
              </Button>
            </div>
          </div>
        </Card>
      </PageContainer>
    );
  }

  const metrics = rec.metrics;
  const clinicalDomains = rec.domainScores.filter((d) => d.axis === "clinical");
  const commDomains = rec.domainScores.filter((d) => d.axis === "communication");

  const gapList = deriveFeedbackGaps(rec);
  const safetyGap = gapList.find((g) => g.safetyCritical);
  const otherGaps = gapList.filter((g) => !g.safetyCritical);

  // Headline verdict, derived from the band evidence (no hidden numeric score):
  // how many scored competency bands sit at proficient-or-above, split by axis.
  const scored = rec.domainScores.filter((d) => d.scored);
  const withheldCount = rec.domainScores.length - scored.length;
  const proficientPlus = scored.filter(
    (d) => bandRank(d.band) >= PROFICIENT_INDEX,
  ).length;
  const axisSummary = (axis: FeedbackAxis) => {
    const ds = scored.filter((d) => d.axis === axis);
    const strong = ds.filter((d) => bandRank(d.band) >= PROFICIENT_INDEX).length;
    return { total: ds.length, strong };
  };
  const clinicalSummary = axisSummary("clinical");
  const commSummary = axisSummary("communication");

  // The calibration scatter + trajectory arrow for the plot. When the current
  // encounter has not been persisted yet, append its gap so the arrow includes it.
  const inHistory = records.some((r) => r.sourceKey === rec.sourceKey);
  const plotTrajectory = inHistory ? trajectory : [...trajectory, rec.overallGap];

  // Calibration headline: the latest self-vs-measured gap and how far it has
  // narrowed since the first tracked session (smaller is better).
  const latestGap = Math.round(rec.overallGap * 100);
  const firstGap =
    plotTrajectory.length > 0 ? Math.round(plotTrajectory[0] * 100) : latestGap;
  const gapNarrowed = firstGap - latestGap;
  const gapTrend: StatTrend | undefined =
    plotTrajectory.length > 1 && gapNarrowed !== 0
      ? {
          value: t("feedback3.verdict.gapTrend", { points: Math.abs(gapNarrowed) }),
          dir: gapNarrowed > 0 ? "down" : "up",
          goodUp: false,
        }
      : undefined;

  // Safety-critical process misses, surfaced separately and always (§4.2, AS-8):
  // a missed time-critical action OR an unmet critical safety behavior (e.g. the
  // allergy check before prescribing).
  const treatmentBehaviors = deriveTreatmentBehaviors(rec);
  const timingMisses = safetyCriticalMisses(metrics);
  const safetyBehaviorMisses = treatmentBehaviors.filter(
    (b) => b.critical && !b.met,
  );
  const hasProcessSafetyMiss =
    timingMisses.length > 0 || safetyBehaviorMisses.length > 0;

  const coveragePct = Math.round(metrics.historyCoveragePct * 100);
  const expectedCount = Math.max(1, rec.expectedIntentCount);
  const coveredCount = Math.round(metrics.historyCoveragePct * expectedCount);

  // On-time rate across the timed (non low-value) expected actions, for a
  // headline that frames the per-action list below it.
  const actionTotal = metrics.timeToCriticalAction.length;
  const onTimeCount = metrics.timeToCriticalAction.filter(
    (a) => a.status === "onTime",
  ).length;
  const allOnTime = actionTotal > 0 && onTimeCount === actionTotal;

  // Investigation stewardship (order appropriateness, §4). Low-value codes are
  // given a human label where known, falling back to the raw order code.
  const steward = metrics.orderAppropriateness;
  const lowValueLabels: Record<string, { en: string; tr: string }> = {
    "48065-7": { en: "D-dimer", tr: "D-dimer" },
  };
  const lowValueList = steward.lowValueCodes
    .map((c) => lowValueLabels[c]?.[lang] ?? c)
    .join(", ");

  // Post-encounter CTAs — both act on THIS encounter's real context.

  // "Schedule spaced repetition": persist this encounter's derived gaps into the
  // real FSRS review queue (progressStore.enqueueReview — idempotent, preserves
  // existing schedules), then land the learner in the spaced-repetition section.
  const handleScheduleSpacedRepetition = () => {
    enqueueReview(gapList);
    navigate("/progress#spaced-review");
  };

  // "Try a harder variant": a fresh case of the SAME presentation as the
  // just-finished encounter, one difficulty step higher (capped at 5). The
  // finished case supplies the chief-complaint family and difficulty; the new
  // case is REQUESTED from the model on /encounter (never built on the device).
  const handleHarderVariant = () => {
    const finished = enc.caseInstance;
    const family = finished ? complaintFamilyOf(finished) : null;
    const current = finished?.difficulty ?? 3;
    const harder = Math.min(5, current + 1) as 1 | 2 | 3 | 4 | 5;
    navigate("/encounter", {
      state: { start: { mode: "solo", role: "doctor", guidance: true, chiefComplaint: family, difficulty: harder } },
    });
  };

  return (
    <PageContainer className="flex flex-col gap-10">
      {/* Header */}
      <motion.div {...header}>
        <PageHeader
          eyebrow={t("feedback.title")}
          title={rec.title[lang]}
          description={t("feedback.subtitle")}
          meta={
            <>
              <Badge tone="brand" dot>
                {t("feedback.formativeBadge")}
              </Badge>
              <span className="text-xs text-subtle">
                {liveRecord ? t("feedback.live") : t("feedback.recorded")}
              </span>
            </>
          }
        />

        {/* Safety strip — always shown; distinct when a miss exists */}
        <div
          className="mt-5 flex items-center gap-2.5 rounded-card border p-3.5"
          style={
            safetyGap
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
          {safetyGap ? (
            <ShieldWarning
              weight="fill"
              className="h-5 w-5 shrink-0 text-[color:var(--state-critical)]"
              aria-hidden
            />
          ) : (
            <CheckCircle
              weight="fill"
              className="h-5 w-5 shrink-0 text-[color:var(--state-normal)]"
              aria-hidden
            />
          )}
          <p className="text-sm font-medium text-fg">
            {safetyGap
              ? t("feedback.safetyStripTitle")
              : t("feedback.safetyStripClean")}
          </p>
        </div>
      </motion.div>

      {/* The model-written debrief of the encounter just played (its thread's debrief layer). */}
      {liveRecord ? <CaseDebriefLayer headingLevel={2} /> : null}

      {/* HERO — the verdict + the signature calibration scatter, side by side. */}
      <motion.section {...hero} aria-label={t("feedback3.verdict.eyebrow")}>
        <Card padding="lg">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,320px)_1fr] lg:gap-10">
            {/* Verdict — a band-only read of the two orthogonal axes. */}
            <div className="flex flex-col gap-5">
              <SectionLabel>{t("feedback3.verdict.eyebrow")}</SectionLabel>

              <Stat
                size="xl"
                label={t("feedback3.verdict.bandsProficient")}
                value={`${proficientPlus}/${scored.length}`}
                hint={t("feedback3.verdict.overall", { total: scored.length })}
              />

              <Divider />

              <div>
                <SectionLabel className="mb-2">
                  {t("feedback3.verdict.byAxis")}
                </SectionLabel>
                <DescriptionList divided>
                  <KeyValue
                    label={
                      <span className="inline-flex items-center gap-2">
                        <AxisMark axis="clinical" />
                        {t("feedback.clinicalGroup")}
                      </span>
                    }
                    value={`${clinicalSummary.strong}/${clinicalSummary.total}`}
                    mono
                  />
                  <KeyValue
                    label={
                      <span className="inline-flex items-center gap-2">
                        <AxisMark axis="communication" />
                        {t("feedback.communicationGroup")}
                      </span>
                    }
                    value={`${commSummary.strong}/${commSummary.total}`}
                    mono
                  />
                </DescriptionList>
              </div>

              <Divider />

              <Stat
                label={t("feedback3.verdict.calibrationGap")}
                value={latestGap}
                unit="%"
                trend={gapTrend}
                hint={t("feedback3.verdict.gapHint")}
              />

              {withheldCount > 0 ? (
                <p className="inline-flex items-center gap-1.5 text-xs text-muted">
                  <Lock weight="bold" className="h-3.5 w-3.5" aria-hidden />
                  {t("feedback3.verdict.withheldNote", { count: withheldCount })}
                </p>
              ) : null}
            </div>

            {/* The signature calibration scatter. */}
            <div className="flex flex-col gap-3 lg:border-l lg:border-border lg:ps-10">
              <div>
                <h2 className="text-lg text-fg">
                  {t("calibration.title")}
                </h2>
                <p className="mt-1 text-sm text-muted">
                  {t("calibration.subtitle")}
                </p>
              </div>
              <CalibrationPlot
                points={rec.calibration}
                trajectory={plotTrajectory}
                lang={lang}
              />
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

      {/* Dual-axis band scores — the supporting detail behind the verdict. */}
      <motion.section {...bands} aria-label={t("feedback.domainsHeading")}>
        <div className="flex flex-col gap-1">
          <SectionLabel>{t("feedback3.section.bands")}</SectionLabel>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-xl text-fg">
              {t("feedback.dualAxis.title")}
            </h2>
            <p className="hidden text-sm text-muted sm:block">
              {t("feedback.dualAxis.orthogonalNote")}
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-6 md:grid-cols-2">
          {/* Clinical group */}
          <div>
            <div className="mb-2.5 flex items-center gap-2">
              <AxisMark axis="clinical" />
              <h3 className="eyebrow">{t("feedback.clinicalGroup")}</h3>
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
              <AxisMark axis="communication" />
              <h3 className="eyebrow">{t("feedback.communicationGroup")}</h3>
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

      {/* Process & timing (docs/00-overview/04 §4) */}
      <motion.section {...process} aria-label={t("feedback.process.heading")}>
        <div className="flex flex-col gap-1">
          <SectionLabel
            icon={<Timer weight="bold" className="h-3.5 w-3.5" />}
          >
            {t("feedback3.section.process")}
          </SectionLabel>
          <h2 className="text-xl text-fg">
            {t("feedback.process.heading")}
          </h2>
          <p className="max-w-2xl text-sm text-muted">
            {t("feedback.process.subtitle")}
          </p>
        </div>

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

        {/* Coverage / efficiency / totals — a dense instrument strip. */}
        <Card padding="none" className="mt-4 overflow-hidden">
          <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
            <div className="bg-surface p-5">
              <Stat
                label={t("feedback.process.coverage.label")}
                value={coveragePct}
                unit="%"
                hint={t("feedback.process.coverage.hint", {
                  covered: coveredCount,
                  expected: expectedCount,
                })}
              />
            </div>
            <div className="bg-surface p-5">
              <Stat
                label={t("feedback.process.redundant.label")}
                value={metrics.redundantQuestions}
                hint={t("feedback.process.redundant.hint", {
                  count: metrics.irrelevantQuestions,
                })}
              />
            </div>
            <div className="bg-surface p-5">
              <Stat
                label={t("feedback.process.totalTime.label")}
                value={toMin(metrics.totalTimeMs)}
                unit={t("feedback.process.minUnit")}
                hint={t("feedback.process.totalTime.hint")}
              />
            </div>
            <div className="bg-surface p-5">
              <Stat
                label={t("feedback.process.timeToDx.label")}
                value={
                  metrics.timeToDiagnosisMs == null
                    ? "-"
                    : toMin(metrics.timeToDiagnosisMs)
                }
                unit={
                  metrics.timeToDiagnosisMs == null
                    ? undefined
                    : t("feedback.process.minUnit")
                }
                hint={
                  metrics.diagnosisCorrect
                    ? t("feedback.process.timeToDx.correct")
                    : t("feedback.process.timeToDx.incorrect")
                }
              />
            </div>
          </div>
        </Card>

        {/* Time-to-critical-action list (each cited) */}
        <div className="mt-6">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
            <div className="min-w-0">
              <SectionLabel>{t("feedback.process.criticalActions")}</SectionLabel>
              <p className="mt-1 text-xs text-muted">
                {t("feedback.process.criticalActionsNote")}
              </p>
            </div>
            {actionTotal > 0 ? (
              <Badge tone={allOnTime ? "normal" : "caution"} dot>
                {allOnTime ? (
                  <CheckCircle weight="fill" className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <Timer weight="fill" className="h-3.5 w-3.5" aria-hidden />
                )}
                {t("feedback.process.onTimeSummary", {
                  onTime: onTimeCount,
                  total: actionTotal,
                })}
              </Badge>
            ) : null}
          </div>
          <div className="mt-3 grid gap-2.5 md:grid-cols-2">
            {metrics.timeToCriticalAction.map((a) => (
              <ProcessTimingCard key={a.expectationId} action={a} lang={lang} />
            ))}
          </div>
        </div>

        {/* Investigation stewardship — order appropriateness, cited (§4) */}
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div>
            <SectionLabel
              icon={<Flask weight="bold" className="h-3.5 w-3.5" />}
            >
              {t("feedback.process.stewardship.heading")}
            </SectionLabel>
            <p className="mt-1 text-xs text-muted">
              {t("feedback.process.stewardship.subtitle")}
            </p>
            <Card padding="md" className="mt-3">
              <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                <Stat
                  label={t("feedback.process.stewardship.indicated")}
                  value={steward.indicated}
                  hint={t("feedback.process.stewardship.indicatedHint")}
                />
                <Stat
                  label={t("feedback.process.stewardship.lowValue")}
                  value={steward.lowValue}
                  hint={t("feedback.process.stewardship.lowValueHint")}
                />
              </div>
              <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                {steward.lowValue > 0 ? (
                  <p className="flex items-start gap-2 text-xs text-fg">
                    <ShieldWarning
                      weight="fill"
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--state-caution)]"
                      aria-hidden
                    />
                    <span className="font-medium">
                      {t("feedback.process.stewardship.flagged", {
                        codes: lowValueList,
                      })}
                    </span>
                  </p>
                ) : (
                  <p className="flex items-start gap-2 text-xs text-muted">
                    <CheckCircle
                      weight="fill"
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--state-normal)]"
                      aria-hidden
                    />
                    {t("feedback.process.stewardship.cleanNote")}
                  </p>
                )}
                <p className="text-xs text-muted">
                  {t("feedback.process.stewardship.note")}
                </p>
                <span>
                  <CitationPill citationId="gs_nice_ng185_nstemi_assessment" lang={lang} />
                </span>
              </div>
            </Card>
          </div>

          {/* How the patient was treated — communication + safety, cited */}
          <div>
            <SectionLabel
              icon={<Heartbeat weight="bold" className="h-3.5 w-3.5" />}
            >
              {t("feedback.process.treatment.heading")}
            </SectionLabel>
            <div className="mt-3">
              <TreatmentChecklist behaviors={treatmentBehaviors} lang={lang} />
            </div>
          </div>
        </div>
      </motion.section>

      {/* Gap analysis */}
      <motion.section {...gaps} aria-label={t("feedback.gapsHeading")}>
        <div className="flex flex-col gap-1">
          <SectionLabel>{t("feedback3.section.gaps")}</SectionLabel>
          <h2 className="text-xl text-fg">
            {t("feedback.gapsHeading")}
          </h2>
        </div>
        {gapList.length > 0 ? (
          <div className="mt-3 flex flex-col gap-3">
            {safetyGap ? <GapCard gap={safetyGap} lang={lang} /> : null}
            {otherGaps.map((g) => (
              <GapCard key={g.id} gap={g} lang={lang} />
            ))}
          </div>
        ) : (
          <p className="mt-3 flex items-start gap-2 rounded-control border border-dashed border-border bg-bg-subtle p-4 text-sm text-muted">
            <CheckCircle
              weight="fill"
              className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--state-normal)]"
              aria-hidden
            />
            {t("feedback.process.safety.cleanNote")}
          </p>
        )}
      </motion.section>

      {/* Remediation CTAs */}
      <motion.section {...remediation} aria-label={t("feedback.remediationHeading")}>
        <Card variant="inset" padding="lg">
          <SectionLabel>{t("feedback3.section.steps")}</SectionLabel>
          <h2 className="mt-1.5 text-xl text-fg">
            {t("feedback.remediationHeading")}
          </h2>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              type="button"
              onClick={handleScheduleSpacedRepetition}
              leadingIcon={<CalendarPlus weight="bold" className="h-4 w-4" />}
            >
              {t("feedback.remediation.spacedRepetition")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={handleHarderVariant}
              leadingIcon={<ArrowClockwise weight="bold" className="h-4 w-4" />}
            >
              {t("feedback.remediation.harderVariant")}
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted">
            {t("feedback.remediation.note")}
          </p>
        </Card>
      </motion.section>
    </PageContainer>
  );
}
