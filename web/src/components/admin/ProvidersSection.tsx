import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PencilSimple, Plus, Pulse, Trash } from "@phosphor-icons/react";
import {
  Badge,
  Button,
  Card,
  Select,
  Skeleton,
  StatusDot,
  Switch,
  Table,
  TableWrap,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from "@/components/ui";
import { PROVIDER_KINDS, type Provider, type ProviderKind } from "@/lib/adminApi";
import { formatMs, providerTone, sortProviders } from "@/lib/adminCharts";
import { ProviderDrawer } from "./ProviderDrawer";
import { relativeTime, useAdminQuery, useAdminSession, useLocaleTag } from "./adminSession";

type Notice = { tone: "normal" | "critical"; text: string } | null;

export function ProvidersSection() {
  const { t } = useTranslation();
  const locale = useLocaleTag();
  const { api } = useAdminSession();
  const [kind, setKind] = useState<ProviderKind | "">("");
  const list = useAdminQuery((a) => a.listProviders(kind || undefined), [kind]);
  const [drawer, setDrawer] = useState<{ open: boolean; provider: Provider | null }>({ open: false, provider: null });
  const [probing, setProbing] = useState<number | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [local, setLocal] = useState<Record<number, Provider>>({});

  const providers = useMemo(() => {
    const base = list.data?.providers ?? [];
    return sortProviders(base.map((p) => local[p.id] ?? p));
  }, [list.data, local]);

  function patchLocal(p: Provider) {
    setLocal((m) => ({ ...m, [p.id]: p }));
  }

  async function toggle(p: Provider, enabled: boolean) {
    patchLocal({ ...p, enabled });
    const r = await api.updateProvider(p.id, { enabled });
    if (r.ok) patchLocal(r.data);
    else {
      patchLocal(p);
      setNotice({ tone: "critical", text: t("admin.common.error", { code: r.error }) });
    }
  }

  async function probe(p: Provider) {
    setProbing(p.id);
    const r = await api.probeProvider(p.id);
    setProbing(null);
    if (!r.ok) {
      setNotice({ tone: "critical", text: t("admin.common.error", { code: r.error }) });
      return;
    }
    setNotice(
      r.data.ok
        ? { tone: "normal", text: t("admin.providers.probeOk", { name: p.name, latency: formatMs(r.data.latency_ms, locale) }) }
        : { tone: "critical", text: t("admin.providers.probeFail", { name: p.name, error: r.data.error ?? r.data.status ?? "" }) },
    );
    await list.reload();
    setLocal({});
  }

  async function remove(p: Provider) {
    if (!window.confirm(t("admin.providers.deleteConfirm", { name: p.name }))) return;
    const r = await api.deleteProvider(p.id);
    if (!r.ok) setNotice({ tone: "critical", text: t("admin.common.error", { code: r.error }) });
    await list.reload();
    setLocal({});
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl text-sm text-muted">{t("admin.providers.description")}</p>
        <div className="flex items-center gap-2">
          <div className="w-44">
            <Select aria-label={t("admin.providers.col.kind")} value={kind} onChange={(e) => setKind(e.target.value as ProviderKind | "")}>
              <option value="">{t("admin.providers.filterAll")}</option>
              {PROVIDER_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`admin.kinds.${k}`)}
                </option>
              ))}
            </Select>
          </div>
          <Button size="md" leadingIcon={<Plus weight="bold" className="h-4 w-4" />} onClick={() => setDrawer({ open: true, provider: null })}>
            {t("admin.providers.add")}
          </Button>
        </div>
      </div>

      {list.data && !list.data.secrets_configured ? (
        <Card padding="sm" className="border-[color:var(--state-caution)] text-sm text-fg">
          {t("admin.providers.secretsBanner")}
        </Card>
      ) : null}

      {list.data?.anthropic && !list.data.anthropic.usable ? (
        <Card padding="sm" role="status" className="border-[color:var(--state-caution)] text-sm text-fg">
          {list.data.anthropic.configured
            ? t("admin.providers.anthropicUnusable", { reason: list.data.anthropic.reason ?? "" })
            : t("admin.providers.anthropicNoKey")}
        </Card>
      ) : null}

      {notice ? (
        <p
          role="status"
          className="rounded-control border px-3 py-2 text-sm"
          style={{ borderColor: `var(--state-${notice.tone})` }}
        >
          {notice.text}
        </p>
      ) : null}

      {list.loading && !list.data ? (
        <Skeleton className="h-48" />
      ) : providers.length === 0 ? (
        <Card variant="inset" padding="lg" className="text-center text-sm text-muted">
          {t("admin.providers.empty")}
        </Card>
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <Th>{t("admin.providers.col.name")}</Th>
                <Th>{t("admin.providers.col.kind")}</Th>
                <Th>{t("admin.providers.col.endpoint")}</Th>
                <Th className="hidden md:table-cell">{t("admin.providers.col.model")}</Th>
                <Th numeric className="hidden sm:table-cell">{t("admin.providers.col.priority")}</Th>
                <Th className="hidden lg:table-cell">{t("admin.providers.col.key")}</Th>
                <Th>{t("admin.providers.col.probe")}</Th>
                <Th>{t("admin.providers.col.enabled")}</Th>
                <Th>{t("admin.providers.col.actions")}</Th>
              </tr>
            </THead>
            <TBody>
              {providers.map((p) => {
                const tone = providerTone(p);
                const statusKey = !p.enabled ? "disabled" : p.last_probe_ok === true ? "ok" : p.last_probe_ok === false ? "failed" : "unprobed";
                return (
                  <Tr key={p.id}>
                    <Td>
                      <StatusDot tone={tone} label={p.name} />
                    </Td>
                    <Td>
                      <Badge tone="brand" variant="outline">{t(`admin.kinds.${p.kind}`)}</Badge>
                    </Td>
                    <Td>
                      <span className="block max-w-[14rem] truncate font-mono text-xs text-muted" title={p.base_url}>
                        {p.base_url}
                      </span>
                    </Td>
                    <Td className="hidden md:table-cell">
                      <span className="block max-w-[12rem] truncate text-xs" title={p.model ?? ""}>
                        {p.model ?? t("admin.common.none")}
                      </span>
                    </Td>
                    <Td numeric className="hidden sm:table-cell">{p.priority}</Td>
                    <Td className="hidden lg:table-cell text-xs text-muted">
                      {p.has_key ? t("admin.providers.keyEndsIn", { last4: p.key_last4 ?? "" }) : t("admin.providers.noKey")}
                    </Td>
                    <Td>
                      <div className="flex flex-col gap-0.5 text-xs">
                        <span>{t(`admin.providers.status.${statusKey}`)}</span>
                        {p.last_probe_at ? (
                          <span className="text-subtle">
                            {p.last_probe_latency_ms != null ? `${formatMs(p.last_probe_latency_ms, locale)}, ` : ""}
                            {relativeTime(p.last_probe_at, locale)}
                          </span>
                        ) : null}
                      </div>
                    </Td>
                    <Td>
                      <Switch aria-label={t("admin.providers.toggleAria", { name: p.name })} checked={p.enabled} onCheckedChange={(v) => void toggle(p, v)} />
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="secondary" loading={probing === p.id} onClick={() => void probe(p)} leadingIcon={<Pulse weight="bold" className="h-4 w-4" />}>
                          {probing === p.id ? t("admin.providers.probing") : t("admin.providers.probe")}
                        </Button>
                        <Button size="sm" variant="ghost" aria-label={`${t("admin.common.edit")} ${p.name}`} onClick={() => setDrawer({ open: true, provider: p })}>
                          <PencilSimple weight="bold" className="h-4 w-4" aria-hidden />
                        </Button>
                        <Button size="sm" variant="ghost" aria-label={`${t("admin.common.delete")} ${p.name}`} onClick={() => void remove(p)}>
                          <Trash weight="bold" className="h-4 w-4" aria-hidden />
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        </TableWrap>
      )}

      <ProviderDrawer
        open={drawer.open}
        provider={drawer.provider}
        defaultKind={kind || "llm"}
        onClose={() => setDrawer((d) => ({ ...d, open: false }))}
        onSaved={() => {
          setLocal({});
          void list.reload();
        }}
      />
    </div>
  );
}
