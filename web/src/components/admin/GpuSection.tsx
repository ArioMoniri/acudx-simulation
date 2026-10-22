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
  Select,
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
import type { WorkerLlmMode, WorkerPolicy } from "@/lib/adminApi";
import { cooldownRows, formatUsd, ledgerByDay, poolRows } from "@/lib/adminCharts";
import { ChartFrame, SERIES_COLORS, themed } from "./ChartFrame";
import { formatDateTime, useAdminQuery, useAdminSession, useLocaleTag } from "./adminSession";

const lines = (v: string) => v.split("\n").map((s) => s.trim()).filter(Boolean);

function PolicyForm({ policy, onSaved }: { policy: WorkerPolicy; onSaved: (p: WorkerPolicy) => void }) {
  const { t } = useTranslation();
  const { api } = useAdminSession();
  const [idle, setIdle] = useState(String(policy.idle_minutes));
  const [budget, setBudget] = useState(policy.daily_budget_usd == null ? "" : String(policy.daily_budget_usd));
  const [allow, setAllow] = useState(policy.allowlist.join("\n"));
  const [model, setModel] = useState(policy.llm_model);
  const [regions, setRegions] = useState(policy.region_preference.join("\n"));
  const [maxWorkers, setMaxWorkers] = useState(String(policy.max_workers ?? 3));
  const [cooldown, setCooldown] = useState(String(policy.launch_cooldown_minutes ?? 60));
  const [workerLlm, setWorkerLlm] = useState(policy.worker_llm ?? "auto");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setIdle(String(policy.idle_minutes));
    setBudget(policy.daily_budget_usd == null ? "" : String(policy.daily_budget_usd));
    setAllow(policy.allowlist.join("\n"));
    setModel(policy.llm_model);
    setRegions(policy.region_preference.join("\n"));
    setMaxWorkers(String(policy.max_workers ?? 3));
    setCooldown(String(policy.launch_cooldown_minutes ?? 60));
    setWorkerLlm(policy.worker_llm ?? "auto");
  }, [policy]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const r = await api.putGpuPolicy({
      // Fields this form does not edit (card tiers, video types) keep their saved values.
      ...policy,
      idle_minutes: Number.parseInt(idle, 10),
      // Empty = no daily cap (the idle reaper still stops unused workers).
      daily_budget_usd: budget.trim() === "" ? null : Number.parseFloat(budget),
      allowlist: lines(allow),
      llm_model: model.trim(),
      region_preference: lines(regions),
      max_workers: Number.parseInt(maxWorkers, 10),
      launch_cooldown_minutes: Number.parseInt(cooldown, 10),
      worker_llm: workerLlm,
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
        <Field label={t("admin.gpu.maxWorkers")} hint={t("admin.gpu.maxWorkersHint")}>
          {(aria) => <TextInput {...aria} type="number" inputMode="numeric" min={1} max={64} value={maxWorkers} onChange={(e) => setMaxWorkers(e.target.value)} />}
        </Field>
        <Field label={t("admin.gpu.dailyBudget")}>
          {(aria) => <TextInput {...aria} type="number" inputMode="decimal" min={0} step="0.5" value={budget} placeholder={t("admin.gpu.noCap", { defaultValue: "No cap" })} onChange={(e) => setBudget(e.target.value)} />}
        </Field>
        <Field label={t("admin.gpu.cooldownMinutes")} hint={t("admin.gpu.cooldownMinutesHint")}>
          {(aria) => <TextInput {...aria} type="number" inputMode="numeric" min={0} max={10080} value={cooldown} onChange={(e) => setCooldown(e.target.value)} />}
        </Field>
        <Field label={t("admin.gpu.workerLlm")} hint={t("admin.gpu.workerLlmHint")}>
          {(aria) => (
            <Select {...aria} value={workerLlm} onChange={(e) => setWorkerLlm(e.target.value as WorkerLlmMode)}>
              <option value="auto">{t("admin.gpu.workerLlmAuto")}</option>
              <option value="on">{t("admin.gpu.workerLlmOn")}</option>
              <option value="off">{t("admin.gpu.workerLlmOff")}</option>
            </Select>
          )}
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
  const [acting, setActing] = useState<string | null>(null);
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
  async function scaleUp() {
    setActing("scale");
    setActionMsg(null);
    const r = await api.gpuScaleUp();
    setActing(null);
    if (!r.ok) {
      const d = r.detail as { message?: string } | undefined;
      setActionMsg(t("admin.gpu.refusal", { message: d?.message ?? r.error }));
    }
    void status.reload();
  }
  async function stopOne(id: number) {
    setActing(`stop-${id}`);
    setActionMsg(null);
    const r = await api.gpuStop(id);
    setActing(null);
    if (!r.ok) setActionMsg(t("admin.common.error", { code: r.error }));
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

  async function clearCooldowns() {
    setActing("cooldowns");
    setActionMsg(null);
    const r = await api.gpuClearCooldowns();
    setActing(null);
    if (!r.ok) setActionMsg(t("admin.common.error", { code: r.error }));
    void status.reload();
  }

  const s = status.data;
  const w = s?.worker ?? null;
  const pool = poolRows(s);
  const cap = s?.capacity;
  const now = Date.now() / 1000;
  const cooldowns = cooldownRows(s, now);
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

      <Card padding="none">
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 px-5 pt-5">
          <div>
            <CardTitle className="text-sm">{t("admin.gpu.pool")}</CardTitle>
            <CardDescription className="text-xs">
              {t("admin.gpu.poolSummary", {
                workers: cap?.workers ?? pool.length,
                max: cap?.max_workers ?? s?.policy?.max_workers ?? 3,
                gpus: cap?.gpus ?? pool.reduce((n, r) => n + r.gpus, 0),
              })}
              {cap?.scale_up_needed ? ` ${t("admin.gpu.scaleNeeded", { reason: cap.scale_up_needed })}` : ""}
            </CardDescription>
          </div>
          <Button
            variant="secondary"
            loading={acting === "scale"}
            disabled={!s?.can_launch || (cap ? cap.workers + cap.launching >= cap.max_workers : false)}
            onClick={scaleUp}
          >
            {t("admin.gpu.addWorker")}
          </Button>
        </CardHeader>
        {pool.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted">{t("admin.overview.gpuNone")}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <tr>
                  <Th>#</Th>
                  <Th>{t("admin.gpu.ledgerCol.type")}</Th>
                  <Th>{t("admin.gpu.card")}</Th>
                  <Th numeric>{t("admin.gpu.gpus")}</Th>
                  <Th className="hidden sm:table-cell">{t("admin.gpu.ledgerCol.region")}</Th>
                  <Th>{t("admin.gpu.status")}</Th>
                  <Th numeric>{t("admin.gpu.inflight")}</Th>
                  <Th numeric>{t("admin.gpu.calls")}</Th>
                  <Th numeric className="hidden md:table-cell">{t("admin.gpu.ledgerCol.rate")}</Th>
                  <Th className="hidden lg:table-cell">{t("admin.gpu.ledgerCol.started")}</Th>
                  <Th>
                    <span className="sr-only">{t("admin.gpu.stop")}</span>
                  </Th>
                </tr>
              </THead>
              <TBody>
                {pool.map((r) => (
                  <Tr key={r.id}>
                    <Td numeric>{r.id}</Td>
                    <Td className="font-mono text-xs">{r.instance_type}</Td>
                    <Td className="whitespace-nowrap text-xs">
                      {r.gpu_memory_gb ? t("admin.gpu.cardGb", { gb: r.gpu_memory_gb }) : t("admin.common.none")}
                      {r.fallback ? (
                        <Badge tone="caution" className="ml-2">{t("admin.gpu.fallback")}</Badge>
                      ) : null}
                    </Td>
                    <Td numeric>{r.gpus}</Td>
                    <Td className="hidden sm:table-cell">{r.region}</Td>
                    <Td>
                      <Badge tone={r.status === "ready" ? "normal" : "neutral"} dot>{r.status}</Badge>
                    </Td>
                    <Td numeric>{r.inflight}</Td>
                    <Td numeric>{r.calls}</Td>
                    <Td numeric className="hidden md:table-cell">{formatUsd(r.price_cents_per_hour / 100, locale)}</Td>
                    <Td className="hidden lg:table-cell whitespace-nowrap text-xs">{formatDateTime(r.launched_at, locale)}</Td>
                    <Td>
                      <Button size="sm" variant="ghost" loading={acting === `stop-${r.id}`} onClick={() => void stopOne(r.id)}>
                        {t("admin.gpu.stopOne")}
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            {pool.filter((r) => r.fallback).map((r) => (
              <p key={`fb-${r.id}`} className="px-5 pb-4 text-xs text-[color:var(--state-caution)]">
                {t("admin.gpu.fallbackNotice", {
                  id: r.id, gb: r.gpu_memory_gb ?? "?", pref: s?.policy?.preferred_gpu_memory_gb ?? 80,
                })}
              </p>
            ))}
          </div>
        )}
        {cooldowns.length > 0 ? (
          <div className="border-t border-[color:var(--border-subtle)] px-5 py-4" data-testid="gpu-cooldowns">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-medium">{t("admin.gpu.cooldowns")}</h3>
                <p className="text-xs text-muted">
                  {t("admin.gpu.cooldownsHint", { minutes: s?.policy?.launch_cooldown_minutes ?? 60 })}
                </p>
              </div>
              <Button size="sm" variant="ghost" loading={acting === "cooldowns"} onClick={() => void clearCooldowns()}>
                {t("admin.gpu.clearCooldowns")}
              </Button>
            </div>
            <ul className="mt-2 space-y-1">
              {cooldowns.map((c) => (
                <li key={c.key} className="break-words text-xs text-[color:var(--state-caution)]">
                  {t("admin.gpu.cooldownRow", {
                    type: c.instance_type, region: c.region,
                    reason: t(`admin.gpu.cooldownReason.${c.reason}`), minutes: c.minutes_left,
                  })}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

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
