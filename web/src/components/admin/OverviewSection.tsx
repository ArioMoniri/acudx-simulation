import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Cpu, Database, HardDrives, Key, Plugs } from "@phosphor-icons/react";
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  DescriptionList,
  KeyValue,
  Skeleton,
  Stat,
  StatusDot,
  Table,
  TableWrap,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from "@/components/ui";
import { EvilPieChart, type ChartConfig } from "@/components/charts";
import { formatBytes, formatInt, formatMs, formatPct, formatUsd, topShares } from "@/lib/adminCharts";
import type { HealthReport, TelemetrySummary } from "@/lib/adminApi";
import { ChartFrame, PIE_PALETTE, slugKey, themed } from "./ChartFrame";
import { formatDateTime, relativeTime, useAdminQuery, useAdminSession, useLocaleTag } from "./adminSession";

function HealthTile({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: typeof Database;
  label: string;
  value: string;
  hint?: string;
  tone: "normal" | "critical" | "caution" | "neutral";
}) {
  return (
    <Card padding="sm" className="flex items-start gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-control bg-brand-tint text-brand" aria-hidden>
        <Icon weight="bold" className="h-4.5 w-4.5" />
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="eyebrow">{label}</span>
        <StatusDot tone={tone} label={value} />
        {hint ? <span className="truncate text-xs text-muted">{hint}</span> : null}
      </div>
    </Card>
  );
}

function GpuCard({ health, onChanged }: { health: HealthReport; onChanged: () => void }) {
  const { t } = useTranslation();
  const locale = useLocaleTag();
  const { api } = useAdminSession();
  const [stopping, setStopping] = useState(false);
  const w = health.gpu.worker;

  async function stop() {
    setStopping(true);
    await api.gpuStop();
    setStopping(false);
    onChanged();
  }

  return (
    <Card padding="md">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Cpu weight="bold" className="h-4 w-4 text-brand" aria-hidden />
            {t("admin.overview.gpuTitle")}
          </CardTitle>
          {w ? (
            <CardDescription className="text-xs">
              {t("admin.overview.gpuSince", { time: formatDateTime(w.launched_at, locale) })}
            </CardDescription>
          ) : null}
        </div>
        {w ? (
          <Button variant="danger" size="sm" loading={stopping} onClick={stop}>
            {stopping ? t("admin.overview.gpuStopping") : t("admin.overview.gpuStop")}
          </Button>
        ) : null}
      </CardHeader>
      {w ? (
        <DescriptionList className="grid-cols-2 sm:grid-cols-4">
          <KeyValue label={t("admin.overview.gpuStatus")} value={<Badge tone={w.status === "ready" ? "normal" : "caution"} dot>{w.status}</Badge>} />
          <KeyValue label={t("admin.overview.gpuType")} value={<span className="font-mono text-xs">{w.instance_type}</span>} />
          <KeyValue label={t("admin.overview.gpuRegion")} value={w.region} />
          <KeyValue
            label={t("admin.overview.gpuRate")}
            value={`${formatUsd(w.price_cents_per_hour / 100, locale)}${t("admin.overview.perHour")}`}
          />
        </DescriptionList>
      ) : (
        <p className="text-sm text-muted">{t("admin.overview.gpuNone")}</p>
      )}
      <div className="mt-4 grid grid-cols-2 gap-4">
        <Stat size="sm" label={t("admin.overview.gpuSpent")} value={formatUsd(health.gpu.spent_today_usd, locale)} />
        <Stat
          size="sm"
          label={t("admin.overview.gpuBudget")}
          value={health.gpu.budget_remaining_usd == null ? t("admin.gpu.noCap", { defaultValue: "No cap" }) : formatUsd(health.gpu.budget_remaining_usd, locale)}
          hint={w ? t("admin.overview.gpuLastUsed", { time: relativeTime(w.last_used_at, locale) }) : undefined}
        />
      </div>
    </Card>
  );
}

function CallsByKind({ summary }: { summary: TelemetrySummary }) {
  const { t } = useTranslation();
  const locale = useLocaleTag();
  const shares = topShares(summary.by_kind, "calls", 5, t("admin.telemetry.other"));
  const rows = shares.map((s, i) => ({ slug: slugKey(s.key, i), label: t(`admin.kinds.${s.key}`, { defaultValue: s.key }), value: s.calls, share: s.share }));
  const config: ChartConfig = Object.fromEntries(
    rows.map((r, i) => [r.slug, { label: r.label, colors: themed(PIE_PALETTE[i % PIE_PALETTE.length]) }]),
  );
  return (
    <ChartFrame
      title={t("admin.overview.callsByKind")}
      isEmpty={rows.length === 0}
      empty={t("admin.telemetry.empty")}
      chart={
        <EvilPieChart data={rows} config={config} dataKey="value" nameKey="slug" className="h-56 aspect-auto">
          <EvilPieChart.Pie innerRadius="55%" outerRadius="85%" paddingAngle={2} cornerRadius={3} />
          <EvilPieChart.Tooltip />
          <EvilPieChart.Legend variant="circle" />
        </EvilPieChart>
      }
      table={
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <Th>{t("admin.telemetry.breakdownCol.key")}</Th>
                <Th numeric>{t("admin.telemetry.calls")}</Th>
                <Th numeric>{t("admin.telemetry.shareOfCalls")}</Th>
              </tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <Tr key={r.slug}>
                  <Td>{r.label}</Td>
                  <Td numeric>{formatInt(r.value, locale)}</Td>
                  <Td numeric>{formatPct(r.share, locale)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      }
    />
  );
}

export function OverviewSection() {
  const { t } = useTranslation();
  const locale = useLocaleTag();
  const health = useAdminQuery((api) => api.getHealth(), [], { pollMs: 30_000 });
  const summary = useAdminQuery((api) => api.getTelemetrySummary("24h"), [], { pollMs: 60_000 });
  const settings = useAdminQuery((api) => api.getSettings(), []);

  const budget = (settings.data?.settings.budgets as { llm_daily_usd?: number } | undefined)?.llm_daily_usd;
  const cost = summary.data?.cost_usd ?? 0;
  const overBudget = typeof budget === "number" && budget > 0 && cost > budget;

  if (health.loading && !health.data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-busy>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    );
  }
  if (!health.data) {
    return (
      <Card padding="md" className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted">{t("admin.common.error", { code: health.error ?? "unknown" })}</span>
        <Button size="sm" variant="secondary" onClick={() => void health.reload()}>
          {t("admin.common.retry")}
        </Button>
      </Card>
    );
  }
  const h = health.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={h.status === "ok" ? "normal" : "caution"} dot>
          {h.status === "ok" ? t("admin.common.ok") : t("admin.common.degraded")}
        </Badge>
        <Badge tone="neutral" variant="outline">
          {h.airgapped ? t("admin.common.airgapped") : t("admin.common.egress")}
        </Badge>
        {health.loadedAt ? (
          <span className="text-xs text-subtle">
            {t("admin.common.lastUpdated", { time: relativeTime(health.loadedAt / 1000, locale) })}
          </span>
        ) : null}
        <Button size="sm" variant="ghost" className="ms-auto" onClick={() => void Promise.all([health.reload(), summary.reload()])}>
          {t("admin.common.refresh")}
        </Button>
      </div>

      <section aria-label={t("admin.overview.health")} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <HealthTile
          icon={Database}
          label={t("admin.overview.db")}
          value={h.db.ok ? t("admin.common.ok") : t("admin.common.failed")}
          hint={h.db.size_bytes !== undefined ? t("admin.overview.dbHint", { size: formatBytes(h.db.size_bytes, locale) }) : h.db.error}
          tone={h.db.ok ? "normal" : "critical"}
        />
        <HealthTile
          icon={Plugs}
          label={t("admin.overview.providers")}
          value={formatInt(h.providers.total, locale)}
          hint={t("admin.overview.providersHint", { enabled: h.providers.enabled, failed: h.providers.probe_failed })}
          tone={h.providers.probe_failed > 0 ? "critical" : h.providers.enabled > 0 ? "normal" : "caution"}
        />
        <HealthTile
          icon={HardDrives}
          label={t("admin.overview.disk")}
          value={h.disk.used_pct != null ? formatPct(h.disk.used_pct / 100, locale) : t("admin.common.unknown")}
          hint={h.disk.free_bytes !== undefined ? t("admin.overview.diskHint", { free: formatBytes(h.disk.free_bytes, locale), total: formatBytes(h.disk.total_bytes, locale) }) : h.disk.error}
          tone={h.disk.used_pct != null && h.disk.used_pct > 90 ? "critical" : h.disk.used_pct != null && h.disk.used_pct > 75 ? "caution" : "normal"}
        />
        <HealthTile
          icon={Key}
          label={t("admin.overview.secrets")}
          value={h.secrets_configured ? t("admin.overview.secretsOn") : t("admin.overview.secretsOff")}
          tone={h.secrets_configured ? "normal" : "caution"}
        />
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card padding="sm">
          <Stat
            label={t("admin.overview.costToday")}
            value={formatUsd(cost, locale)}
            hint={overBudget ? `> ${formatUsd(budget, locale)}` : undefined}
            trend={overBudget ? { value: formatUsd(budget, locale), dir: "up", goodUp: false } : undefined}
          />
        </Card>
        <Card padding="sm">
          <Stat label={t("admin.overview.callsToday")} value={formatInt(summary.data?.calls, locale)} />
        </Card>
        <Card padding="sm">
          <Stat label={t("admin.overview.errorRate")} value={formatPct(summary.data?.error_rate, locale)} />
        </Card>
        <Card padding="sm">
          <Stat label={t("admin.overview.p95")} value={formatMs(summary.data?.latency_ms.p95, locale)} />
        </Card>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <GpuCard health={h} onChanged={() => void health.reload()} />
        {summary.data ? <CallsByKind summary={summary.data} /> : <Skeleton className="h-64" />}
      </div>
    </div>
  );
}
