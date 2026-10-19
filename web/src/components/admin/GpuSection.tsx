import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Skeleton,
  Stat,
  Table,
  TableWrap,
  TBody,
  Td,
  Textarea,
  TextInput,
  Th,
  THead,
  Tr,
} from "@/components/ui";
import { EvilBarChart, type ChartConfig } from "@/components/charts";
import type { WorkerPolicy } from "@/lib/adminApi";
import { formatUsd, ledgerByDay } from "@/lib/adminCharts";
import { ChartFrame, SERIES_COLORS, themed } from "./ChartFrame";
import { formatDateTime, useAdminQuery, useAdminSession, useLocaleTag } from "./adminSession";

const lines = (v: string) => v.split("\n").map((s) => s.trim()).filter(Boolean);

function PolicyForm({ policy, onSaved }: { policy: WorkerPolicy; onSaved: (p: WorkerPolicy) => void }) {
  const { t } = useTranslation();
  const { api } = useAdminSession();
  const [idle, setIdle] = useState(String(policy.idle_minutes));
  const [budget, setBudget] = useState(String(policy.daily_budget_usd));
  const [allow, setAllow] = useState(policy.allowlist.join("\n"));
  const [model, setModel] = useState(policy.llm_model);
  const [regions, setRegions] = useState(policy.region_preference.join("\n"));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setIdle(String(policy.idle_minutes));
    setBudget(String(policy.daily_budget_usd));
    setAllow(policy.allowlist.join("\n"));
    setModel(policy.llm_model);
    setRegions(policy.region_preference.join("\n"));
  }, [policy]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const r = await api.putGpuPolicy({
      idle_minutes: Number.parseInt(idle, 10),
      daily_budget_usd: Number.parseFloat(budget),
      allowlist: lines(allow),
      llm_model: model.trim(),
      region_preference: lines(regions),
    });
    setBusy(false);
    if (r.ok) {
      onSaved(r.data);
      setMsg(t("admin.gpu.policySaved"));
    } else setMsg(t("admin.common.error", { code: r.error }));
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("admin.gpu.idleMinutes")}>
          {(aria) => <TextInput {...aria} type="number" inputMode="numeric" min={1} max={1440} value={idle} onChange={(e) => setIdle(e.target.value)} />}
        </Field>
        <Field label={t("admin.gpu.dailyBudget")}>
          {(aria) => <TextInput {...aria} type="number" inputMode="decimal" min={0} step="0.5" value={budget} onChange={(e) => setBudget(e.target.value)} />}
        </Field>
      </div>
      <Field label={t("admin.gpu.model")}>
        {(aria) => <TextInput {...aria} spellCheck={false} value={model} onChange={(e) => setModel(e.target.value)} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("admin.gpu.allowlist")} hint={t("admin.gpu.allowlistHint")}>
          {(aria) => <Textarea {...aria} rows={4} spellCheck={false} className="font-mono text-xs" value={allow} onChange={(e) => setAllow(e.target.value)} />}
        </Field>
        <Field label={t("admin.gpu.regions")} hint={t("admin.gpu.regionsHint")} optional>
          {(aria) => <Textarea {...aria} rows={4} spellCheck={false} className="font-mono text-xs" value={regions} onChange={(e) => setRegions(e.target.value)} />}
        </Field>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span role="status" className="text-xs text-muted">{msg}</span>
        <Button type="submit" loading={busy}>
          {t("admin.gpu.savePolicy")}
        </Button>
      </div>
    </form>
  );
}

export function GpuSection() {
  const { t } = useTranslation();
  const locale = useLocaleTag();
  const { api } = useAdminSession();
  const status = useAdminQuery((a) => a.gpuStatus(), [], { pollMs: 20_000 });
  const telemetry = useAdminQuery((a) => a.getGpuTelemetry(200), []);
  const [acting, setActing] = useState<"start" | "stop" | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  async function start() {
    setActing("start");
    setActionMsg(null);
    const r = await api.gpuStart();
    setActing(null);
    if (!r.ok) {
      const d = r.detail as { message?: string } | undefined;
      setActionMsg(t("admin.gpu.refusal", { message: d?.message ?? r.error }));
    }
    void Promise.all([status.reload(), telemetry.reload()]);
  }
  async function stop() {
    setActing("stop");
    setActionMsg(null);
    const r = await api.gpuStop();
    setActing(null);
    if (!r.ok) setActionMsg(t("admin.common.error", { code: r.error }));
    void Promise.all([status.reload(), telemetry.reload()]);
  }

  const s = status.data;
  const w = s?.worker ?? null;
  const now = Date.now() / 1000;
  const days = ledgerByDay(telemetry.data?.entries ?? [], now, locale, 14);
  const hasCost = days.some((d) => d.cost_usd > 0);
  const costConfig: ChartConfig = { cost_usd: { label: t("admin.telemetry.series.cost"), colors: themed(SERIES_COLORS.brand) } };

  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-3xl text-sm text-muted">{t("admin.gpu.description")}</p>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card padding="md" className="lg:col-span-2">
          <CardHeader className="flex-row items-start justify-between">
            <CardTitle className="text-sm">{t("admin.gpu.title")}</CardTitle>
            {s ? <Badge tone={w ? "normal" : "neutral"} dot>{w ? w.status : t("admin.common.none")}</Badge> : null}
          </CardHeader>
          {!s ? (
            <Skeleton className="h-28" />
          ) : (
            <div className="flex flex-col gap-4">
              {w ? (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <dt className="text-muted">{t("admin.gpu.ledgerCol.type")}</dt>
                  <dd className="font-mono text-xs">{w.instance_type}</dd>
                  <dt className="text-muted">{t("admin.gpu.ledgerCol.region")}</dt>
                  <dd>{w.region}</dd>
                  <dt className="text-muted">{t("admin.gpu.ledgerCol.rate")}</dt>
                  <dd className="font-mono tabular-nums">{formatUsd(w.price_cents_per_hour / 100, locale)}{t("admin.overview.perHour")}</dd>
                  <dt className="text-muted">{t("admin.gpu.ledgerCol.started")}</dt>
                  <dd>{formatDateTime(w.launched_at, locale)}</dd>
                </dl>
              ) : (
                <p className="text-sm text-muted">{t("admin.overview.gpuNone")}</p>
              )}
              {!s.configured ? <p className="text-xs text-[color:var(--state-caution)]">{t("admin.gpu.notConfigured")}</p> : null}
              {s.refusal ? <p className="text-xs text-[color:var(--state-caution)]">{t("admin.gpu.refusal", { message: s.refusal.message })}</p> : null}
              {actionMsg ? <p role="alert" className="text-xs text-[color:var(--state-critical)]">{actionMsg}</p> : null}
              <div className="flex flex-wrap gap-2">
                {w ? (
                  <Button variant="danger" loading={acting === "stop"} onClick={stop}>
                    {t("admin.gpu.stop")}
                  </Button>
                ) : (
                  <Button loading={acting === "start"} disabled={!s.can_launch} onClick={start}>
                    {acting === "start" ? t("admin.gpu.starting") : t("admin.gpu.start")}
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-3 gap-3 border-t border-border pt-4">
                <Stat size="sm" label={t("admin.gpu.spentToday")} value={formatUsd(s.spent_today_usd, locale)} />
                <Stat size="sm" label={t("admin.gpu.spent7d")} value={formatUsd(telemetry.data?.spent_7d_usd, locale)} />
                <Stat size="sm" label={t("admin.gpu.spent30d")} value={formatUsd(telemetry.data?.spent_30d_usd, locale)} />
              </div>
            </div>
          )}
        </Card>

        <Card padding="md" className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-sm">{t("admin.gpu.policy")}</CardTitle>
            <CardDescription className="text-xs">{t("admin.gpu.allowlistHint")}</CardDescription>
          </CardHeader>
          {s?.policy ? <PolicyForm policy={s.policy} onSaved={() => void status.reload()} /> : <Skeleton className="h-48" />}
        </Card>
      </div>

      <ChartFrame
        title={t("admin.gpu.costByDay")}
        isEmpty={!hasCost}
        empty={t("admin.gpu.ledgerEmpty")}
        chart={
          <EvilBarChart data={days} config={costConfig} xDataKey="label" className="h-56 aspect-auto" barRadius={3}>
            <EvilBarChart.Grid />
            <EvilBarChart.XAxis dataKey="label" />
            <EvilBarChart.YAxis tickFormatter={(v: number) => formatUsd(v, locale)} />
            <EvilBarChart.Bar dataKey="cost_usd" />
            <EvilBarChart.Tooltip />
          </EvilBarChart>
        }
        table={
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <Th>{t("admin.telemetry.tableCol.bucket")}</Th>
                  <Th numeric>{t("admin.gpu.ledgerCol.cost")}</Th>
                  <Th numeric>h</Th>
                </tr>
              </THead>
              <TBody>
                {days.map((d) => (
                  <Tr key={d.day}>
                    <Td>{d.label}</Td>
                    <Td numeric>{formatUsd(d.cost_usd, locale)}</Td>
                    <Td numeric>{d.hours}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        }
      />

      <Card padding="none">
        <CardHeader className="px-5 pt-5">
          <CardTitle className="text-sm">{t("admin.gpu.ledger")}</CardTitle>
        </CardHeader>
        {telemetry.loading && !telemetry.data ? (
          <Skeleton className="m-5 h-24" />
        ) : (telemetry.data?.entries.length ?? 0) === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted">{t("admin.gpu.ledgerEmpty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <tr>
                  <Th>{t("admin.gpu.ledgerCol.started")}</Th>
                  <Th>{t("admin.gpu.ledgerCol.ended")}</Th>
                  <Th>{t("admin.gpu.ledgerCol.type")}</Th>
                  <Th className="hidden sm:table-cell">{t("admin.gpu.ledgerCol.region")}</Th>
                  <Th numeric>{t("admin.gpu.ledgerCol.rate")}</Th>
                  <Th numeric>{t("admin.gpu.ledgerCol.cost")}</Th>
                  <Th className="hidden md:table-cell">{t("admin.gpu.ledgerCol.reason")}</Th>
                </tr>
              </THead>
              <TBody>
                {telemetry.data?.entries.map((e) => (
                  <Tr key={e.id}>
                    <Td className="whitespace-nowrap text-xs">{formatDateTime(e.started_at, locale)}</Td>
                    <Td className="whitespace-nowrap text-xs">{e.ended_at ? formatDateTime(e.ended_at, locale) : <Badge tone="normal" dot>{t("admin.gpu.running")}</Badge>}</Td>
                    <Td className="font-mono text-xs">{e.instance_type}</Td>
                    <Td className="hidden sm:table-cell">{e.region}</Td>
                    <Td numeric>{formatUsd(e.price_cents_per_hour / 100, locale)}</Td>
                    <Td numeric>{e.cost_usd != null ? formatUsd(e.cost_usd, locale) : formatUsd(((now - e.started_at) / 3600) * (e.price_cents_per_hour / 100), locale)}</Td>
                    <Td className="hidden md:table-cell text-xs text-muted">{e.reason ?? ""}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
