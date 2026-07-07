import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import {
  GridNine,
  Warning,
  Target,
  Certificate,
  Scales,
  Buildings,
  Lock,
} from "@phosphor-icons/react";

import { PageContainer } from "@/components/shell";
import { useEntry } from "@/lib/useLang";
import {
  KpiRow,
  CohortHeatmap,
  RemediationLoop,
  AggregateCalibration,
  AccreditationExport,
  FairnessNote,
} from "@/components/institution";
import { remediationRecords } from "@/data/institution";

/* -------------------------------------------------------------------------- */
/* Section heading helper                                                      */
/* -------------------------------------------------------------------------- */

function SectionHeading({
  icon: Icon,
  title,
  subtitle,
  badge,
}: {
  icon: typeof GridNine;
  title: string;
  subtitle: string;
  badge?: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-2">
        <Icon weight="bold" className="h-5 w-5 text-brand" aria-hidden />
        <h2 className="text-lg font-semibold tracking-tight text-fg">{title}</h2>
        {badge}
      </div>
      <p className="mt-1 max-w-2xl text-sm text-muted">{subtitle}</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * InstitutionPage — the dean's-office dashboard (Journey 8, IN-1..IN-7).
 *
 * The institutional purchase-justifier: a cohort competency heatmap with
 * drill-down (IN-1), the at-risk to remediation closed loop (IN-2, the money
 * feature), aggregate calibration as a curriculum signal (IN-4), a one-click
 * accreditation export (IN-3), and a mandatory per-locale fairness audit (IN-7).
 * Role-gated: aggregate only, never a learner's private ego-data (INV-4).
 */
export function InstitutionPage() {
  const { t } = useTranslation();
  const header = useEntry();
  const kpis = useEntry(0.06);
  const heatmap = useEntry(0.1);
  const remediation = useEntry(0.14);
  const calibration = useEntry(0.18);
  const exportEntry = useEntry(0.22);
  const fairness = useEntry(0.26);

  const openRemediation = remediationRecords.filter(
    (r) => r.status.document !== "done",
  ).length;

  return (
    <PageContainer width="wide" className="flex flex-col gap-10">
      {/* Header */}
      <motion.header {...header} className="max-w-3xl">
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
          <Buildings weight="bold" className="h-3.5 w-3.5" aria-hidden />
          {t("institution.eyebrow")}
        </span>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
          {t("institution.title")}
        </h1>
        <p className="mt-3 max-w-2xl text-lg text-muted">
          {t("institution.subtitle")}
        </p>
        <p className="mt-3 inline-flex items-center gap-2 text-xs text-muted">
          <Lock weight="bold" className="h-3.5 w-3.5" aria-hidden />
          {t("institution.privacyBanner")}
        </p>
      </motion.header>

      {/* KPIs */}
      <motion.section {...kpis} aria-label={t("institution.kpi.sectionLabel")}>
        <KpiRow />
      </motion.section>

      {/* Cohort competency heatmap (IN-1) */}
      <motion.section {...heatmap} aria-labelledby="inst-heatmap">
        <SectionHeading
          icon={GridNine}
          title={t("institution.heatmap.heading")}
          subtitle={t("institution.heatmap.headingSub")}
        />
        <span id="inst-heatmap" className="sr-only">
          {t("institution.heatmap.heading")}
        </span>
        <CohortHeatmap />
      </motion.section>

      {/* At-risk and remediation loop (IN-2) */}
      <motion.section {...remediation} aria-labelledby="inst-remediation">
        <SectionHeading
          icon={Warning}
          title={t("institution.remediation.heading")}
          subtitle={t("institution.remediation.headingSub")}
          badge={
            openRemediation > 0 ? (
              <span
                className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold text-[color:var(--state-warning)]"
                style={{
                  backgroundColor:
                    "color-mix(in srgb, var(--state-warning) 16%, transparent)",
                }}
              >
                {t("institution.remediation.openCount", {
                  count: openRemediation,
                })}
              </span>
            ) : undefined
          }
        />
        <span id="inst-remediation" className="sr-only">
          {t("institution.remediation.heading")}
        </span>
        <RemediationLoop />
      </motion.section>

      {/* Aggregate calibration (IN-4) */}
      <motion.section {...calibration} aria-labelledby="inst-calibration">
        <SectionHeading
          icon={Target}
          title={t("institution.calibration.heading")}
          subtitle={t("institution.calibration.headingSub")}
        />
        <span id="inst-calibration" className="sr-only">
          {t("institution.calibration.heading")}
        </span>
        <AggregateCalibration />
      </motion.section>

      {/* Accreditation export (IN-3) + Fairness audit (IN-7) */}
      <div className="grid gap-6 lg:grid-cols-2">
        <motion.section {...exportEntry} aria-labelledby="inst-export">
          <SectionHeading
            icon={Certificate}
            title={t("institution.export.heading")}
            subtitle={t("institution.export.headingSub")}
          />
          <span id="inst-export" className="sr-only">
            {t("institution.export.heading")}
          </span>
          <AccreditationExport />
        </motion.section>

        <motion.section {...fairness} aria-labelledby="inst-fairness">
          <SectionHeading
            icon={Scales}
            title={t("institution.fairness.heading")}
            subtitle={t("institution.fairness.headingSub")}
          />
          <span id="inst-fairness" className="sr-only">
            {t("institution.fairness.heading")}
          </span>
          <FairnessNote />
        </motion.section>
      </div>
    </PageContainer>
  );
}
