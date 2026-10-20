import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import {
  ArrowsClockwise,
  Certificate,
  GridNine,
  Lock,
  Pulse,
  ShieldCheck,
  ShieldWarning,
  Target,
  Warning,
  WifiSlash,
} from "@phosphor-icons/react";

import { PageContainer, PageHeader } from "@/components/shell";
import { Badge, Button, Card, SectionLabel, Skeleton } from "@/components/ui";
import {
  AccreditationExport,
  AggregateCalibration,
  CohortHeatmap,
  FairnessNote,
  KpiRow,
  RemediationLoop,
} from "@/components/institution";
import {
  ActivityChart,
  AtRiskList,
  BandDistributionChart,
  ChainBadge,
  CohortBandGrid,
  CohortCalibration,
  CohortKpis,
  ServerAccreditationExport,
} from "@/components/institution/CohortServerPanels";
import { useEntry } from "@/lib/useLang";
import {
  COHORT_WINDOWS,
  panelsApi,
  type CohortLearner,
  type CohortReport,
  type CohortWindow,
  type DomainKey,
  type PanelsErrorCode,
  type RosterEntry,
} from "@/lib/panelsApi";
import { useProfile } from "@/state/profileStore";

/* -------------------------------------------------------------------------- */
/* Section headers (same three tiers as the former InstitutionPage)             */
/* -------------------------------------------------------------------------- */

function SectionHeading({
  id,
  icon: Icon,
  title,
  subtitle,
  badge,
}: {
  id: string;
  icon: typeof GridNine;
  title: string;
  subtitle: string;
  badge?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-2">
          <Icon weight="bold" className="h-4.5 w-4.5 text-brand" aria-hidden />
          <h2 id={id} className="text-lg font-semibold tracking-tight text-fg">
            {title}
          </h2>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-muted">{subtitle}</p>
      </div>
      {badge ? <div className="shrink-0">{badge}</div> : null}
    </div>
  );
}

const WINDOW_KEY = "acudx-dean-window";

function readWindow(): CohortWindow {
  try {
    const v = sessionStorage.getItem(WINDOW_KEY);
    return (COHORT_WINDOWS as readonly string[]).includes(v ?? "") ? (v as CohortWindow) : "30d";
  } catch {
    return "30d";
  }
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * DeanPage (/dean, alias /institution) - the institutional dashboard fed by
 * server data: GET /v1/dean/cohort aggregates every learner's hash-chained
 * encounter batches for the dean's org. Aggregate only, learners appear as
 * masked handles (INV-4). When the gateway is unreachable the page falls back
 * to the on-device, single-user view and says so.
 */
export function DeanPage() {
  const { t } = useTranslation();
  const profile = useProfile();
  const header = useEntry();
  const body = useEntry(0.06);
  const [win, setWin] = useState<CohortWindow>(readWindow);
  const [report, setReport] = useState<CohortReport | null>(null);
  const [authMode, setAuthMode] = useState<"local" | "oidc">("local");
  const [error, setError] = useState<PanelsErrorCode | null>(null);
  const [loading, setLoading] = useState(true);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [assignBusy, setAssignBusy] = useState<string | null>(null);
  const [assignNote, setAssignNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [r, ro] = await Promise.all([panelsApi.cohort(win), panelsApi.roster()]);
    if (r.ok) {
      setReport(r.data);
      setAuthMode(r.authMode);
      setError(null);
    } else {
      setError(r.error);
    }
    if (ro.ok) setRoster(ro.data.roster);
    setLoading(false);
  }, [win]);

  useEffect(() => {
    void load();
  }, [load]);

  function refresh() {
    setLoading(true);
    void load();
  }

  useEffect(() => {
    try {
      sessionStorage.setItem(WINDOW_KEY, win);
    } catch {
      /* per-tab convenience only */
    }
  }, [win]);

  const subByHash = useMemo(() => new Map(roster.map((r) => [r.user_hash, r.sub])), [roster]);

  async function assignRemediation(learner: CohortLearner, domain: DomainKey | null) {
    const sub = subByHash.get(learner.user_hash);
    if (!sub) {
      setAssignNote(t("panels.dean.risk.noSub"));
      return;
    }
    setAssignBusy(learner.user_hash);
    const caseId = `remediation-${domain ?? "general"}`;
    const res = await panelsApi.assign({
      case_id: caseId,
      title: t("panels.dean.risk.assignTitle", { domain: domain ? t(`feedback.domains.${domain}`) : t("panels.dean.risk.general") }),
      assignees: [sub],
      reason: learner.reasons.join(","),
    });
    setAssignBusy(null);
    setAssignNote(res.ok ? t("panels.dean.risk.assigned", { handle: learner.handle }) : t("panels.dean.risk.assignFailed"));
  }

  const serverOk = report !== null && error === null;
  const unverified = authMode === "local" || report?.verified_identity === false;

  return (
    <PageContainer width="wide" className="flex flex-col gap-12">
      <motion.div {...header}>
        <PageHeader
          tone="clinical"
          eyebrow={t("panels.dean.eyebrow")}
          title={t("panels.dean.title")}
          description={t("panels.dean.lede")}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <div role="group" aria-label={t("panels.dean.window.label")} className="inline-flex rounded-control border border-border bg-bg-subtle p-0.5">
                {COHORT_WINDOWS.map((w) => (
                  <button
                    key={w}
                    type="button"
                    aria-pressed={win === w}
                    onClick={() => setWin(w)}
                    className={
                      "min-h-8 rounded-chip px-2.5 text-xs font-semibold transition-colors focus-visible:outline-none " +
                      (win === w ? "bg-surface text-fg shadow-soft" : "text-muted hover:text-fg")
                    }
                  >
                    {t(`panels.dean.window.${w}`)}
                  </button>
                ))}
              </div>
              <Button size="sm" variant="secondary" onClick={refresh} loading={loading} leadingIcon={<ArrowsClockwise weight="bold" className="h-4 w-4" />}>
                {t("panels.common.refresh")}
              </Button>
            </div>
          }
          meta={
            <div className="flex flex-wrap items-center gap-2">
              {serverOk ? <ChainBadge chain={report.chain} /> : null}
              {serverOk ? (
                unverified ? (
                  <Badge tone="caution" icon={<ShieldWarning weight="fill" className="h-3.5 w-3.5" aria-hidden />} title={t("identity.badge.localHint")}>
                    {t("identity.badge.local")}
                  </Badge>
                ) : (
                  <Badge tone="normal" icon={<ShieldCheck weight="fill" className="h-3.5 w-3.5" aria-hidden />}>
                    {t("identity.badge.verified")}
                  </Badge>
                )
              ) : null}
              {serverOk ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                  <Lock weight="bold" className="h-3.5 w-3.5" aria-hidden />
                  {t("panels.dean.privacy", { org: report.org })}
                </span>
              ) : null}
            </div>
          }
        />
      </motion.div>

      {loading && !report ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-control" />
          ))}
        </div>
      ) : null}

      {!loading && !serverOk ? (
        <motion.div {...body} className="flex flex-col gap-10">
          <Card padding="md" variant="inset" className="flex flex-wrap items-center gap-3">
            <WifiSlash weight="bold" className="h-5 w-5 shrink-0 text-muted" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-fg">{t("panels.dean.fallback.title")}</p>
              <p className="text-xs text-muted">
                {error === "forbidden" || error === "unauthenticated"
                  ? t("panels.dean.fallback.forbidden")
                  : t("panels.dean.fallback.body", { error: error ?? "unknown" })}
              </p>
            </div>
            <Button size="sm" variant="secondary" onClick={refresh}>
              {t("panels.common.retry")}
            </Button>
          </Card>
          <section aria-label={t("institution.kpi.ownSectionLabel", { defaultValue: "Your headline metrics" })}>
            <SectionLabel className="mb-3">{t("institution.kpi.ownSectionLabel", { defaultValue: "Your headline metrics" })}</SectionLabel>
            <KpiRow />
          </section>
          <section aria-labelledby="dean-own-remediation">
            <SectionHeading id="dean-own-remediation" icon={Warning} title={t("institution.remediation.ownHeading", { defaultValue: "Detected gaps and remediation" })} subtitle={t("institution.remediation.ownHeadingSub", { defaultValue: "" })} />
            <RemediationLoop />
          </section>
          <section aria-labelledby="dean-own-heatmap">
            <SectionHeading id="dean-own-heatmap" icon={GridNine} title={t("institution.heatmap.heading")} subtitle={t("institution.heatmap.headingSub")} />
            <CohortHeatmap />
          </section>
          <section aria-labelledby="dean-own-calibration">
            <SectionHeading id="dean-own-calibration" icon={Target} title={t("institution.calibration.heading")} subtitle={t("institution.calibration.headingSub")} />
            <AggregateCalibration />
          </section>
          <section className="grid gap-6 lg:grid-cols-2">
            <AccreditationExport />
            <FairnessNote />
          </section>
        </motion.div>
      ) : null}

      {serverOk ? (
        <motion.div {...body} className="flex flex-col gap-12">
          <section aria-label={t("panels.dean.kpi.sectionLabel")}>
            <SectionLabel className="mb-3">{t("panels.dean.kpi.sectionLabel")}</SectionLabel>
            <CohortKpis report={report} />
          </section>

          <section aria-labelledby="dean-risk">
            <SectionHeading
              id="dean-risk"
              icon={Warning}
              title={t("panels.dean.risk.title")}
              subtitle={t("panels.dean.risk.subtitle")}
              badge={
                report.kpis.at_risk > 0 ? (
                  <Badge tone="warning" dot>
                    {t("panels.dean.risk.count", { count: report.kpis.at_risk })}
                  </Badge>
                ) : undefined
              }
            />
            <AtRiskList learners={report.learners} onAssign={(l, d) => void assignRemediation(l, d)} busyHandle={assignBusy} />
            {assignNote ? (
              <p className="mt-3 text-xs text-muted" aria-live="polite">
                {assignNote}
              </p>
            ) : null}
            <p className="mt-3 text-xs text-subtle">{t("panels.dean.risk.loopNote")}</p>
          </section>

          <section aria-labelledby="dean-grid">
            <SectionHeading id="dean-grid" icon={GridNine} title={t("panels.dean.grid.title")} subtitle={t("panels.dean.grid.subtitle")} />
            <CohortBandGrid learners={report.learners} />
          </section>

          <section aria-labelledby="dean-charts" className="grid gap-6 lg:grid-cols-2">
            <h2 id="dean-charts" className="sr-only">
              {t("panels.dean.charts")}
            </h2>
            <BandDistributionChart bands={report.bands_by_domain} />
            <ActivityChart activity={report.activity} window={report.window} />
          </section>

          <section aria-labelledby="dean-calibration">
            <SectionHeading id="dean-calibration" icon={Target} title={t("panels.dean.calibration.heading")} subtitle={t("panels.dean.calibration.headingSub")} />
            <CohortCalibration rows={report.calibration.by_domain} />
          </section>

          <section aria-labelledby="dean-compliance">
            <SectionLabel icon={<Certificate weight="bold" className="h-3.5 w-3.5" />}>{t("institution.compliance.sectionLabel")}</SectionLabel>
            <h2 id="dean-compliance" className="sr-only">
              {t("institution.compliance.sectionLabel")}
            </h2>
            <div className="mt-3 grid gap-6 lg:grid-cols-2">
              <ServerAccreditationExport
                org={report.org}
                window={report.window}
                fetchExport={async () => {
                  const r = await panelsApi.exportReport(report.window);
                  return r.ok ? r.data : null;
                }}
              />
              <FairnessNote />
            </div>
          </section>

          <p className="inline-flex items-center gap-1.5 text-xs text-subtle">
            <Pulse weight="bold" className="h-3.5 w-3.5" aria-hidden />
            {t("panels.dean.footer", { name: profile?.fullName ?? "", org: report.org })}
          </p>
        </motion.div>
      ) : null}
    </PageContainer>
  );
}
