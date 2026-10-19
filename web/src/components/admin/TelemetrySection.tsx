import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Card,
  Skeleton,
  Stat,
  Table,
  TableWrap,
  Tabs,
  TabsList,
  TabsTrigger,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from "@/components/ui";
import { EvilAreaChart, EvilBarChart, EvilLineChart, EvilPieChart, type ChartConfig } from "@/components/charts";
import type { Breakdown, TelemetrySummary, TelemetryWindow } from "@/lib/adminApi";
import {
  breakdownBars,
  formatInt,
  formatMs,
  formatPct,
  formatUsd,
  seriesRows,
  topShares,
} from "@/lib/adminCharts";
import { ChartFrame, PIE_PALETTE, SERIES_COLORS, slugKey, themed } from "./ChartFrame";
import { useAdminQuery, useLocaleTag } from "./adminSession";

const WINDOWS: TelemetryWindow[] = ["24h", "7d", "30d"];

function BreakdownTable({ rows, locale }: { rows: Breakdown[]; locale: string }) {
  const { t } = useTranslation();
  return (
    <TableWrap>
      <Table>
        <THead>
          <tr>
            <Th>{t("admin.telemetry.breakdownCol.key")}</Th>
            <Th numeric>{t("admin.telemetry.breakdownCol.calls")}</Th>
            <Th numeric>{t("admin.telemetry.breakdownCol.errors")}</Th>
            <Th numeric>{t("admin.telemetry.breakdownCol.cost")}</Th>
            <Th numeric>{t("admin.telemetry.breakdownCol.p95")}</Th>
          </tr>
        </THead>
        <TBody>
          {rows.map((r) => (
            <Tr key={r.key}>
              <Td className="max-w-[16rem] truncate" title={r.key}>{r.key}</Td>
              <Td numeric>{formatInt(r.calls, locale)}</Td>
              <Td numeric>{formatInt(r.errors, locale)}</Td>
              <Td numeric>{formatUsd(r.cost_usd, locale)}</Td>
              <Td numeric>{formatMs(r.p95_ms, locale)}</Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </TableWrap>
  );
}

/** Horizontal bar breakdown (calls per provider / model / route) with table twin. */
function BreakdownChart({ title, rows, metric }: { title: string; rows: Breakdown[]; metric: "calls" | "cost_usd" }) {
  const { t } = useTranslation();
  const locale = useLocaleTag();
  const bars = useMemo(() => breakdownBars(rows, metric, 8), [rows, metric]);
  const data: Array<Record<string, unknown>> = bars.map((b) => ({
    ...b,
    label: b.key.length > 28 ? `${b.key.slice(0, 26)}..` : b.key,
  }));
  const config: ChartConfig = {
    [metric]: {
      label: metric === "calls" ? t("admin.telemetry.calls") : t("admin.telemetry.series.cost"),
      colors: themed(metric === "calls" ? SERIES_COLORS.blue : SERIES_COLORS.brand),
    },
  };
  return (
    <ChartFrame
      title={title}
      isEmpty={bars.length === 0}
      empty={t("admin.telemetry.empty")}
      chart={
        <div style={{ height: Math.max(160, 36 * data.length + 40) }}>
          <EvilBarChart data={data} config={config} layout="horizontal" xDataKey="label" barRadius={3} className="h-full aspect-auto">
            <EvilBarChart.Grid vertical horizontal={false} />
            <EvilBarChart.XAxis tickFormatter={(v: number) => (metric === "calls" ? formatInt(v, locale) : formatUsd(v, locale))} />
            <EvilBarChart.YAxis dataKey="label" width={140} />
            <EvilBarChart.Bar dataKey={metric} />
            <EvilBarChart.Tooltip />
          </EvilBarChart>
        </div>
      }
      table={<BreakdownTable rows={bars} locale={locale} />}
    />
  );
}

function SharePie({ title, rows, metric }: { title: string; rows: Breakdown[]; metric: "calls" | "cost_usd" }) {
  const { t } = useTranslation();
  const locale = useLocaleTag();
  const shares = topShares(rows, metric, 5, t("admin.telemetry.other"));
  const data = shares.map((s, i) => ({ slug: slugKey(s.key, i), label: s.key, value: metric === "calls" ? s.calls : Number(s.cost_usd.toFixed(6)), share: s.share }));
  const config: ChartConfig = Object.fromEntries(data.map((d, i) => [d.slug, { label: d.label, colors: themed(PIE_PALETTE[i % PIE_PALETTE.length]) }]));
  return (
    <ChartFrame
      title={title}
      isEmpty={data.length === 0}
      empty={t("admin.telemetry.empty")}
      chart={
        <EvilPieChart data={data} config={config} dataKey="value" nameKey="slug" className="h-56 aspect-auto">
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
                <Th numeric>{metric === "calls" ? t("admin.telemetry.calls") : t("admin.telemetry.cost")}</Th>
                <Th numeric>{metric === "calls" ? t("admin.telemetry.shareOfCalls") : t("admin.telemetry.shareOfCost")}</Th>
              </tr>
            </THead>
            <TBody>
              {data.map((d) => (
                <Tr key={d.slug}>
                  <Td className="max-w-[16rem] truncate" title={d.label}>{d.label}</Td>
                  <Td numeric>{metric === "calls" ? formatInt(d.value, locale) : formatUsd(d.value, locale)}</Td>
                  <Td numeric>{formatPct(d.share, locale)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      }
    />
  );
}

function SeriesTable({ summary, locale }: { summary: TelemetrySummary; locale: string }) {
  const { t } = useTranslation();
  const rows = seriesRows(summary, locale);
  return (
    <TableWrap className="max-h-72 overflow-y-auto">
      <Table>
        <THead>
          <tr>
            <Th>{t("admin.telemetry.tableCol.bucket")}</Th>
            <Th numeric>{t("admin.telemetry.tableCol.calls")}</Th>
            <Th numeric>{t("admin.telemetry.tableCol.errors")}</Th>
            <Th numeric>{t("admin.telemetry.tableCol.cost")}</Th>
            <Th numeric>{t("admin.telemetry.tableCol.p95")}</Th>
          </tr>
        </THead>
        <TBody>
          {rows.map((r) => (
            <Tr key={r.ts}>
              <Td>{r.label}</Td>
              <Td numeric>{formatInt(r.calls, locale)}</Td>
              <Td numeric>{formatInt(r.errors, locale)}</Td>
              <Td numeric>{formatUsd(r.cost_usd, locale)}</Td>
              <Td numeric>{r.p95_ms ? formatMs(r.p95_ms, locale) : "n/a"}</Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </TableWrap>
  );
}

export function TelemetrySection() {
  const { t } = useTranslation();
  const locale = useLocaleTag();
  const [window, setWindow] = useState<TelemetryWindow>("24h");
  const q = useAdminQuery((api) => api.getTelemetrySummary(window), [window], { pollMs: 60_000 });
  const s = q.data;
  const rows = useMemo(() => (s ? seriesRows(s, locale) : []), [s, locale]);
  const isEmpty = !s || s.calls === 0;

  const callsConfig: ChartConfig = {
    ok: { label: t("admin.telemetry.series.ok"), colors: themed(SERIES_COLORS.brand) },
    errors: { label: t("admin.telemetry.series.errors"), colors: themed(SERIES_COLORS.critical) },
  };
  const costConfig: ChartConfig = { cost_usd: { label: t("admin.telemetry.series.cost"), colors: themed(SERIES_COLORS.blue) } };
  const latencyConfig: ChartConfig = {
    p50_ms: { label: t("admin.telemetry.series.p50"), colors: themed(SERIES_COLORS.teal) },
    p95_ms: { label: t("admin.telemetry.series.p95"), colors: themed(SERIES_COLORS.pink) },
  };
  const tickEvery = window === "24h" ? 3 : window === "7d" ? 1 : 5;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl text-sm text-muted">{t("admin.telemetry.description", { version: s?.price_version ?? "" })}</p>
        <div className="flex items-center gap-2">
          <Tabs value={window} onValueChange={(v) => setWindow(v as TelemetryWindow)}>
            <TabsList aria-label={t("admin.telemetry.window")}>
              {WINDOWS.map((w) => (
                <TabsTrigger key={w} value={w}>
                  {t(`admin.telemetry.windows.${w}`)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Button size="sm" variant="ghost" onClick={() => void q.reload()}>
            {t("admin.common.refresh")}
          </Button>
        </div>
      </div>

      {!s ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-busy>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card padding="sm">
            <Stat label={t("admin.telemetry.calls")} value={formatInt(s.calls, locale)} hint={t("admin.telemetry.tokensHint", { in: formatInt(s.tokens_in, locale), out: formatInt(s.tokens_out, locale) })} />
          </Card>
          <Card padding="sm">
            <Stat label={t("admin.telemetry.cost")} value={formatUsd(s.cost_usd, locale)} />
          </Card>
          <Card padding="sm">
            <Stat label={t("admin.telemetry.errorRate")} value={formatPct(s.error_rate, locale)} hint={`${formatInt(s.errors, locale)} ${t("admin.telemetry.errors").toLowerCase()}`} />
          </Card>
          <Card padding="sm">
            <Stat label={t("admin.telemetry.p95")} value={formatMs(s.latency_ms.p95, locale)} hint={`${t("admin.telemetry.p50")}: ${formatMs(s.latency_ms.p50, locale)}`} />
          </Card>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartFrame
          title={t("admin.telemetry.callsOverTime")}
          isEmpty={isEmpty}
          empty={t("admin.telemetry.empty")}
          chart={
            <EvilBarChart data={rows} config={callsConfig} stackType="stacked" xDataKey="label" barRadius={2} className="h-60 aspect-auto">
              <EvilBarChart.Grid />
              <EvilBarChart.XAxis dataKey="label" interval={tickEvery - 1} />
              <EvilBarChart.YAxis allowDecimals={false} />
              <EvilBarChart.Bar dataKey="ok" />
              <EvilBarChart.Bar dataKey="errors" />
              <EvilBarChart.Tooltip />
              <EvilBarChart.Legend variant="circle" />
            </EvilBarChart>
          }
          table={s ? <SeriesTable summary={s} locale={locale} /> : null}
        />
        <ChartFrame
          title={t("admin.telemetry.costOverTime")}
          isEmpty={isEmpty}
          empty={t("admin.telemetry.empty")}
          chart={
            <EvilAreaChart data={rows} config={costConfig} xDataKey="label" curveType="monotone" className="h-60 aspect-auto">
              <EvilAreaChart.Grid />
              <EvilAreaChart.XAxis dataKey="label" interval={tickEvery - 1} />
              <EvilAreaChart.YAxis tickFormatter={(v: number) => formatUsd(v, locale)} />
              <EvilAreaChart.Area dataKey="cost_usd" variant="gradient" strokeWidth={1.5} />
              <EvilAreaChart.Tooltip />
            </EvilAreaChart>
          }
          table={s ? <SeriesTable summary={s} locale={locale} /> : null}
        />
        <ChartFrame
          title={t("admin.telemetry.latencyOverTime")}
          isEmpty={isEmpty}
          empty={t("admin.telemetry.empty")}
          chart={
            <EvilLineChart data={rows} config={latencyConfig} xDataKey="label" curveType="monotone" className="h-60 aspect-auto">
              <EvilLineChart.Grid />
              <EvilLineChart.XAxis dataKey="label" interval={tickEvery - 1} />
              <EvilLineChart.YAxis tickFormatter={(v: number) => formatMs(v, locale)} />
              <EvilLineChart.Line dataKey="p50_ms" strokeWidth={1.5} />
              <EvilLineChart.Line dataKey="p95_ms" strokeWidth={1.5} strokeVariant="dashed" />
              <EvilLineChart.Tooltip />
              <EvilLineChart.Legend variant="horizontal-bar" />
            </EvilLineChart>
          }
          table={s ? <SeriesTable summary={s} locale={locale} /> : null}
        />
        {s ? <SharePie title={t("admin.telemetry.shareOfCost")} rows={s.by_provider} metric="cost_usd" /> : null}
        {s ? <BreakdownChart title={t("admin.telemetry.byProvider")} rows={s.by_provider} metric="calls" /> : null}
        {s ? <BreakdownChart title={t("admin.telemetry.byModel")} rows={s.by_model} metric="calls" /> : null}
        {s ? <BreakdownChart title={t("admin.telemetry.byRoute")} rows={s.by_route} metric="calls" /> : null}
      </div>
    </div>
  );
}
