import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import {
  GridNine,
  Warning,
  Target,
  Certificate,
  Scales,
  WarningCircle,
  Lock,
} from "@phosphor-icons/react";

import { PageContainer, PageHeader } from "@/components/shell";
import { Badge, SectionLabel } from "@/components/ui";
import { useEntry } from "@/lib/useLang";
import {
  KpiRow,
  CohortHeatmap,
  RemediationLoop,
  AggregateCalibration,
  AccreditationExport,
  FairnessNote,
} from "@/components/institution";
import { deriveRemediationSignals } from "@/data/institution";
import { useProgressRecords } from "@/state/progressStore";

/* -------------------------------------------------------------------------- */
/* Section header tiers                                                         */
/*                                                                             */
/* Hierarchy does the work: the money feature (remediation) leads with a       */
/* dominant header; the primary read-outs sit a step down; the compliance      */
/* surfaces close the page as compact, labelled panels. Three distinct scales  */
/* so the dashboard no longer reads as six identical stacked sections.         */
/* -------------------------------------------------------------------------- */

/** Tier 1 — the dominant, prime-position header for the money feature. */
function PrimaryHeader({
  id,
  icon: Icon,
  eyebrow,
  title,
  subtitle,
  badge,
}: {
  id: string;
  icon: typeof GridNine;
  eyebrow: string;
  title: string;
  subtitle: string;
  badge?: ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="flex items-start gap-3.5">
        <span
          className="grid h-11 w-11 shrink-0 place-items-center rounded-control bg-brand-tint text-brand"
          aria-hidden
        >
          <Icon weight="bold" className="h-5.5 w-5.5" />
        </span>
        <div className="flex flex-col gap-1">
          <span className="eyebrow text-brand">{eyebrow}</span>
          <h2
            id={id}
            className="text-2xl font-semibold tracking-tight text-fg"
          >
            {title}
          </h2>
          <p className="max-w-2xl text-sm text-muted">{subtitle}</p>
        </div>
      </div>
      {badge ? <div className="shrink-0">{badge}</div> : null}
    </header>
  );
}

/** Tier 2 — the standard header for primary read-outs. */
function SectionHeading({
  id,
  icon: Icon,
  title,
  subtitle,
}: {
  id: string;
  icon: typeof GridNine;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2">
        <Icon weight="bold" className="h-4.5 w-4.5 text-brand" aria-hidden />
        <h2 id={id} className="text-lg font-semibold tracking-tight text-fg">
          {title}
        </h2>
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
 * The institutional purchase-justifier. The at-risk to remediation closed loop
 * (IN-2) is the money feature, so it leads the page at the dominant scale; the
 * cohort competency heatmap (IN-1) and aggregate calibration (IN-4) are the
 * supporting read-outs; the one-click accreditation export (IN-3) and the
 * mandatory per-locale fairness audit (IN-7) close the page as compact
 * compliance panels. Role-gated: aggregate only, never a learner's private
 * ego-data (INV-4).
 */
export function InstitutionPage() {
  const { t } = useTranslation();
  const header = useEntry();
  const kpis = useEntry(0.06);
  const remediation = useEntry(0.1);
  const heatmap = useEntry(0.14);
  const calibration = useEntry(0.18);
  const compliance = useEntry(0.22);

  const records = useProgressRecords();
  const detectedSignals = deriveRemediationSignals(records).length;

  return (
    <PageContainer width="wide" className="flex flex-col gap-12">
      {/* Header */}
      <motion.div {...header}>
        <PageHeader
          tone="clinical"
          eyebrow={t("institution.ownEyebrow", {
            defaultValue: "Institution readiness",
          })}
          title={t("institution.ownTitle", {
            defaultValue: "Your competency dashboard",
          })}
          description={t("institution.ownSubtitle", {
            defaultValue:
              "Your own recorded encounters, banded by competency domain, with the evidence you would take to accreditation. Multi-learner cohort analytics need a connected institution data source.",
          })}
          meta={
            <span className="inline-flex items-center gap-1.5 text-xs text-muted">
              <Lock weight="bold" className="h-3.5 w-3.5" aria-hidden />
              {t("institution.ownPrivacyBanner", {
                defaultValue:
                  "Single-user, on-device view. Nothing here is uploaded or shared.",
              })}
            </span>
          }
        />
      </motion.div>

      {/* KPIs */}
      <motion.section
        {...kpis}
        aria-label={t("institution.kpi.ownSectionLabel", {
          defaultValue: "Your headline metrics",
        })}
      >
        <SectionLabel className="mb-3">
          {t("institution.kpi.ownSectionLabel", {
            defaultValue: "Your headline metrics",
          })}
        </SectionLabel>
        <KpiRow />
      </motion.section>

      {/* At-risk and remediation loop (IN-2) — the money feature, dominant + first */}
      <motion.section {...remediation} aria-labelledby="inst-remediation">
        <PrimaryHeader
          id="inst-remediation"
          icon={Warning}
          eyebrow={t("institution.remediation.priorityEyebrow")}
          title={t("institution.remediation.ownHeading", {
            defaultValue: "Detected gaps and remediation",
          })}
          subtitle={t("institution.remediation.ownHeadingSub", {
            defaultValue:
              "Recurring gaps detected from your own encounters. The closed remediation loop needs a connected institution data source.",
          })}
          badge={
            detectedSignals > 0 ? (
              <Badge tone="warning" dot>
                <WarningCircle weight="fill" className="h-3.5 w-3.5" aria-hidden />
                {t("institution.remediation.detectedBadge", {
                  count: detectedSignals,
                  defaultValue: "{{count}} detected",
                })}
              </Badge>
            ) : undefined
          }
        />
        <RemediationLoop />
      </motion.section>

      {/* Cohort competency heatmap (IN-1) */}
      <motion.section {...heatmap} aria-labelledby="inst-heatmap">
        <SectionHeading
          id="inst-heatmap"
          icon={GridNine}
          title={t("institution.heatmap.heading")}
          subtitle={t("institution.heatmap.headingSub")}
        />
        <CohortHeatmap />
      </motion.section>

      {/* Aggregate calibration (IN-4) */}
      <motion.section {...calibration} aria-labelledby="inst-calibration">
        <SectionHeading
          id="inst-calibration"
          icon={Target}
          title={t("institution.calibration.heading")}
          subtitle={t("institution.calibration.headingSub")}
        />
        <AggregateCalibration />
      </motion.section>

      {/* Accreditation export (IN-3) + Fairness audit (IN-7) — compact compliance panels */}
      <motion.section {...compliance} aria-labelledby="inst-compliance">
        <SectionLabel icon={<Certificate weight="bold" className="h-3.5 w-3.5" />}>
          {t("institution.compliance.sectionLabel")}
        </SectionLabel>
        <h2 id="inst-compliance" className="sr-only">
          {t("institution.compliance.sectionLabel")}
        </h2>
        <div className="mt-3 grid gap-6 lg:grid-cols-2">
          <div aria-labelledby="inst-export">
            <SectionLabel
              className="mb-2.5"
              icon={<Certificate weight="bold" className="h-3.5 w-3.5" />}
            >
              <span id="inst-export">{t("institution.export.heading")}</span>
            </SectionLabel>
            <AccreditationExport />
          </div>
          <div aria-labelledby="inst-fairness">
            <SectionLabel
              className="mb-2.5"
              icon={<Scales weight="bold" className="h-3.5 w-3.5" />}
            >
              <span id="inst-fairness">{t("institution.fairness.heading")}</span>
            </SectionLabel>
            <FairnessNote />
          </div>
        </div>
      </motion.section>
    </PageContainer>
  );
}
