/**
 * Dean panel widgets fed by GET /v1/dean/cohort (server-side aggregates over the
 * hash-chained encounter batches, see server/learning). Nothing here derives
 * from client-side state: the props ARE the server report. Bands are never
 * conveyed by colour alone (band word + fill level, see ./bandMeta).
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Certificate,
  DownloadSimple,
  LinkSimple,
  LinkBreak,
  Pulse,
  ShieldCheck,
  Target,
  Users,
  Warning,
} from "@phosphor-icons/react";

import { EvilAreaChart, EvilBarChart, type ChartConfig } from "@/components/charts";
import { Badge, Button, Card, Stat, Table, TableWrap, TBody, Td, Th, THead, Tr } from "@/components/ui";
import { SERIES_COLORS, themed } from "@/components/admin/ChartFrame";
import { cn } from "@/lib/cn";
import { useLang } from "@/lib/useLang";
import {
  BAND_NAMES,
  DOMAIN_KEYS,
  type BandName,
  type ChainStatus,
  type CohortLearner,
  type CohortReport,
  type CohortWindow,
  type DomainKey,
  type ExportReport,
} from "@/lib/panelsApi";
import { BAND_CELL_TEXT, BAND_CELL_TINT, BAND_RANK, bandCode } from "./bandMeta";

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

function pct(v: number | null | undefined, lang: string): string {
  if (v === null || v === undefined) return "n/a";
  return new Intl.NumberFormat(lang === "tr" ? "tr" : "en", { style: "percent", maximumFractionDigits: 0 }).format(v);
}

function shortDate(ts: number, lang: string): string {
  try {
    return new Intl.DateTimeFormat(lang === "tr" ? "tr" : "en", { day: "numeric", month: "short" }).format(new Date(ts * 1000));
  } catch {
    return "";
  }
}

/* -------------------------------------------------------------------------- */
/* Chain + verification badges                                                 */
/* -------------------------------------------------------------------------- */

export function ChainBadge({ chain }: { chain: ChainStatus }) {
  const { t } = useTranslation();
  return chain.ok ? (
    <Badge tone="normal" icon={<LinkSimple weight="bold" className="h-3.5 w-3.5" aria-hidden />} title={chain.head ?? undefined}>
      {t("panels.dean.chain.ok", { count: chain.length })}
    </Badge>
  ) : (
    <Badge tone="critical" icon={<LinkBreak weight="bold" className="h-3.5 w-3.5" aria-hidden />}>
      {t("panels.dean.chain.broken", { id: chain.broken_at ?? "?" })}
    </Badge>
  );
}

/* -------------------------------------------------------------------------- */
/* KPIs                                                                        */
/* -------------------------------------------------------------------------- */

export function CohortKpis({ report }: { report: CohortReport }) {
  const { t } = useTranslation();
  const lang = useLang();
  const k = report.kpis;
  const items = [
    { id: "learners", icon: Users, label: t("panels.dean.kpi.learners"), value: String(report.learner_count), hint: t("panels.dean.kpi.learnersHint") },
    { id: "encounters", icon: Pulse, label: t("panels.dean.kpi.encounters"), value: String(report.encounters), hint: t("panels.dean.kpi.encountersHint") },
    { id: "dx", icon: Target, label: t("panels.dean.kpi.dxAccuracy"), value: pct(k.dx_accuracy, lang), hint: t("panels.dean.kpi.dxAccuracyHint") },
    { id: "safety", icon: ShieldCheck, label: t("panels.dean.kpi.safetyMiss"), value: pct(k.safety_miss_rate, lang), hint: t("panels.dean.kpi.safetyMissHint") },
    { id: "brier", icon: Target, label: t("panels.dean.kpi.brier"), value: k.mean_brier === null ? "n/a" : k.mean_brier.toFixed(3), hint: t("panels.dean.kpi.brierHint") },
    { id: "risk", icon: Warning, label: t("panels.dean.kpi.atRisk"), value: String(k.at_risk), hint: t("panels.dean.kpi.atRiskHint") },
  ];
  return (
    <ul aria-label={t("panels.dean.kpi.sectionLabel")} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {items.map(({ id, icon: Icon, label, value, hint }) => (
        <li key={id} className="h-full">
          <Card variant="surface" padding="md" className="h-full">
            <Stat label={label} value={value} hint={hint} icon={<Icon weight="bold" className="h-4 w-4" aria-hidden />} />
          </Card>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* Cohort band grid (learners x domains)                                       */
/* -------------------------------------------------------------------------- */

function GridCell({ band, competence, n, label }: { band: BandName | "withheld"; competence: number | null; n: number; label: string }) {
  const { t } = useTranslation();
  const word = t(`bands.${band}`);
  if (band === "withheld") {
    return (
      <td className="p-1">
        <div
          className="flex min-h-12 flex-col items-center justify-center rounded-control border border-dashed border-border bg-bg-subtle px-1 text-center"
          aria-label={`${label}: ${word}`}
        >
          <span className="text-[10px] font-medium leading-tight text-muted">{word}</span>
        </div>
      </td>
    );
  }
  const rank = BAND_RANK[band];
  return (
    <td className="p-1">
      <div
        className="flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-control px-1 text-center"
        style={{ background: BAND_CELL_TINT[band], color: BAND_CELL_TEXT[band] }}
        aria-label={`${label}: ${word}, ${n} ${t("panels.dean.grid.encounters")}`}
        title={`${word} · ${competence === null ? "" : competence.toFixed(2)} · n=${n}`}
      >
        <span className="text-xs font-semibold leading-none">{bandCode(band)}</span>
        <span className="flex gap-px" aria-hidden>
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className={cn("h-1 w-1.5 rounded-sm", i <= rank ? "bg-current opacity-90" : "bg-current opacity-20")} />
          ))}
        </span>
      </div>
    </td>
  );
}

export function CohortBandGrid({ learners }: { learners: CohortLearner[] }) {
  const { t } = useTranslation();
  const lang = useLang();
  if (learners.length === 0) {
    return (
      <Card padding="lg" variant="inset" className="text-center text-sm text-muted">
        {t("panels.dean.grid.empty")}
      </Card>
    );
  }
  return (
    <Card padding="sm">
      <TableWrap>
        <Table>
          <caption className="sr-only">{t("panels.dean.grid.caption")}</caption>
          <THead>
            <Tr>
              <Th scope="col">{t("panels.dean.grid.learner")}</Th>
              {DOMAIN_KEYS.map((d) => (
                <Th key={d} scope="col" className="text-center">
                  {t(`feedback.domains.${d}`)}
                </Th>
              ))}
              <Th scope="col" className="text-end">{t("panels.dean.grid.lastActive")}</Th>
            </Tr>
          </THead>
          <TBody>
            {learners.map((l) => (
              <Tr key={l.user_hash}>
                <Th scope="row" className="whitespace-nowrap font-mono text-xs">
                  <span className="inline-flex items-center gap-1.5">
                    {l.handle}
                    {l.at_risk ? (
                      <Warning weight="fill" className="h-3.5 w-3.5 text-[color:var(--state-warning)]" aria-label={t("panels.dean.risk.flag")} />
                    ) : null}
                  </span>
                </Th>
                {DOMAIN_KEYS.map((d) => {
                  const cell = l.domains[d];
                  return <GridCell key={d} band={cell.band} competence={cell.competence} n={cell.n} label={`${l.handle} ${t(`feedback.domains.${d}`)}`} />;
                })}
                <Td className="whitespace-nowrap text-end text-xs text-muted">{shortDate(l.last_at, lang)}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableWrap>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Band distribution (stacked bars per domain)                                 */
/* -------------------------------------------------------------------------- */

const BAND_SERIES: Record<BandName, string> = {
  emerging: SERIES_COLORS.subtle,
  developing: SERIES_COLORS.caution,
  proficient: SERIES_COLORS.blue,
  strong: SERIES_COLORS.brand,
  exemplary: SERIES_COLORS.normal,
};

export function BandDistributionChart({ bands }: { bands: CohortReport["bands_by_domain"] }) {
  const { t } = useTranslation();
  const data = useMemo(
    () =>
      DOMAIN_KEYS.map((d) => ({
        label: t(`feedback.domains.${d}`),
        ...Object.fromEntries(BAND_NAMES.map((b) => [b, bands[d]?.[b] ?? 0])),
      })) as Array<Record<string, unknown>>,
    [bands, t],
  );
  const config: ChartConfig = Object.fromEntries(
    BAND_NAMES.map((b) => [b, { label: t(`bands.${b}`), colors: themed(BAND_SERIES[b]) }]),
  );
  const total = DOMAIN_KEYS.reduce((acc, d) => acc + BAND_NAMES.reduce((a, b) => a + (bands[d]?.[b] ?? 0), 0), 0);
  return (
    <Card padding="lg" className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-fg">{t("panels.dean.bands.title")}</h3>
      <p className="text-xs text-muted">{t("panels.dean.bands.subtitle")}</p>
      {total === 0 ? (
        <p className="py-8 text-center text-sm text-muted">{t("panels.dean.bands.empty")}</p>
      ) : (
        <EvilBarChart data={data} config={config} stackType="stacked" xDataKey="label" barRadius={2} className="h-60 aspect-auto">
          <EvilBarChart.Grid />
          <EvilBarChart.XAxis dataKey="label" />
          <EvilBarChart.YAxis allowDecimals={false} />
          {BAND_NAMES.map((b) => (
            <EvilBarChart.Bar key={b} dataKey={b} />
          ))}
          <EvilBarChart.Tooltip />
          <EvilBarChart.Legend variant="circle" />
        </EvilBarChart>
      )}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Activity series                                                             */
/* -------------------------------------------------------------------------- */

export function ActivityChart({ activity, window }: { activity: CohortReport["activity"]; window: CohortWindow }) {
  const { t } = useTranslation();
  const lang = useLang();
  const data: Array<Record<string, unknown>> = activity.map((b) => ({ label: shortDate(b.bucket_start, lang), encounters: b.encounters, learners: b.learners }));
  const config: ChartConfig = {
    encounters: { label: t("panels.dean.activity.encounters"), colors: themed(SERIES_COLORS.brand) },
    learners: { label: t("panels.dean.activity.learners"), colors: themed(SERIES_COLORS.blue) },
  };
  const tickEvery = Math.max(1, Math.ceil(data.length / 8));
  return (
    <Card padding="lg" className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-fg">{t("panels.dean.activity.title", { window })}</h3>
      <EvilAreaChart data={data} config={config} xDataKey="label" curveType="monotone" className="h-56 aspect-auto">
        <EvilAreaChart.Grid />
        <EvilAreaChart.XAxis dataKey="label" interval={tickEvery - 1} />
        <EvilAreaChart.YAxis allowDecimals={false} />
        <EvilAreaChart.Area dataKey="encounters" variant="gradient" strokeWidth={1.5} />
        <EvilAreaChart.Area dataKey="learners" variant="gradient" strokeWidth={1.5} />
        <EvilAreaChart.Tooltip />
        <EvilAreaChart.Legend variant="circle" />
      </EvilAreaChart>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Calibration by domain                                                       */
/* -------------------------------------------------------------------------- */

export function CohortCalibration({ rows }: { rows: CohortReport["calibration"]["by_domain"] }) {
  const { t } = useTranslation();
  const scored = rows.filter((r) => r.n > 0);
  return (
    <Card padding="lg" className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-fg">{t("panels.dean.calibration.title")}</h3>
      <p className="text-xs text-muted">{t("panels.dean.calibration.subtitle")}</p>
      {scored.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">{t("panels.dean.calibration.empty")}</p>
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <Tr>
                <Th scope="col">{t("panels.dean.calibration.domain")}</Th>
                <Th scope="col" className="text-end">n</Th>
                <Th scope="col" className="text-end">{t("panels.dean.calibration.meanGap")}</Th>
                <Th scope="col" className="text-end">{t("institution.calibration.direction.over")}</Th>
                <Th scope="col" className="text-end">{t("institution.calibration.direction.well")}</Th>
                <Th scope="col" className="text-end">{t("institution.calibration.direction.under")}</Th>
              </Tr>
            </THead>
            <TBody>
              {scored.map((r) => (
                <Tr key={r.domain}>
                  <Th scope="row">{t(`feedback.domains.${r.domain}`)}</Th>
                  <Td className="text-end font-mono text-xs">{r.n}</Td>
                  <Td className="text-end font-mono text-xs">{r.mean_gap === null ? "n/a" : r.mean_gap.toFixed(2)}</Td>
                  <Td className="text-end font-mono text-xs">{r.over}</Td>
                  <Td className="text-end font-mono text-xs">{r.well}</Td>
                  <Td className="text-end font-mono text-xs">{r.under}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      )}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* At-risk list with remediation                                               */
/* -------------------------------------------------------------------------- */

export function AtRiskList({
  learners,
  onAssign,
  busyHandle,
}: {
  learners: CohortLearner[];
  /** Assign a remediation case to the learner (by their hash; the server maps it to the sub). */
  onAssign?: (learner: CohortLearner, domain: DomainKey | null) => void;
  busyHandle?: string | null;
}) {
  const { t } = useTranslation();
  const atRisk = learners.filter((l) => l.at_risk);
  if (atRisk.length === 0) {
    return (
      <Card padding="lg" variant="inset" className="flex items-center gap-2 text-sm text-muted">
        <ShieldCheck weight="fill" className="h-4 w-4 text-[color:var(--state-normal)]" aria-hidden />
        {t("panels.dean.risk.none")}
      </Card>
    );
  }
  return (
    <ul className="flex flex-col gap-3" aria-label={t("panels.dean.risk.listLabel")}>
      {atRisk.map((l) => (
        <li key={l.user_hash}>
          <Card padding="md" className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-sm font-semibold text-fg">{l.handle}</p>
              <p className="mt-0.5 text-xs text-muted">
                {t("panels.dean.risk.summary", {
                  encounters: l.encounters,
                  misses: l.safety_misses,
                  dx: Math.round(l.dx_accuracy * 100),
                })}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {l.reasons.map((r) => (
                  <Badge key={r} tone="warning" dot>
                    {t(`panels.dean.risk.reason.${r}`)}
                  </Badge>
                ))}
                {l.weakest_domain ? (
                  <Badge tone="neutral" variant="outline">
                    {t("panels.dean.risk.weakest", { domain: t(`feedback.domains.${l.weakest_domain}`) })}
                  </Badge>
                ) : null}
              </div>
            </div>
            {onAssign ? (
              <Button
                size="sm"
                variant="secondary"
                loading={busyHandle === l.user_hash}
                onClick={() => onAssign(l, l.weakest_domain)}
              >
                {t("panels.dean.risk.assign")}
              </Button>
            ) : null}
          </Card>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* Accreditation export (server rows, de-identified)                           */
/* -------------------------------------------------------------------------- */

export function ServerAccreditationExport({
  org,
  window,
  fetchExport,
}: {
  org: string;
  window: CohortWindow;
  fetchExport: () => Promise<ExportReport | null>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ rows: number; head: string | null } | null>(null);
  const [error, setError] = useState(false);

  async function download() {
    setBusy(true);
    setError(false);
    const report = await fetchExport();
    setBusy(false);
    if (!report) {
      setError(true);
      return;
    }
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `acudx-accreditation-${org}-${window}-${new Date(report.generated_at * 1000).toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    setDone({ rows: report.rows.length, head: report.chain.head });
  }

  return (
    <Card padding="lg" className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <Certificate weight="bold" className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
        <div>
          <h3 className="text-sm font-semibold text-fg">{t("panels.dean.export.title")}</h3>
          <p className="mt-1 text-xs text-muted">{t("panels.dean.export.subtitle")}</p>
        </div>
      </div>
      <Button onClick={download} loading={busy} leadingIcon={<DownloadSimple weight="bold" className="h-4 w-4" />} className="self-start">
        {t("panels.dean.export.cta", { window })}
      </Button>
      {done ? (
        <p className="text-xs text-muted" aria-live="polite">
          {t("panels.dean.export.done", { rows: done.rows })}{" "}
          {done.head ? <code className="font-mono">{done.head.slice(0, 12)}</code> : null}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-[color:var(--state-critical)]">
          {t("panels.dean.export.failed")}
        </p>
      ) : null}
    </Card>
  );
}
