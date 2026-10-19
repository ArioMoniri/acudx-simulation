import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, CardDescription, CardHeader, CardTitle, Field, Select, Skeleton, Textarea, TextInput } from "@/components/ui";
import { SUPPORTED_LANGUAGES, LANGUAGE_META } from "@/i18n";
import { useAdminQuery, useAdminSession } from "./adminSession";

type SettingsObj = Record<string, unknown>;

function num(v: unknown): string {
  return typeof v === "number" ? String(v) : "";
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * Operator settings: a small typed form for the keys the app reads
 * (budgets, retention, locale, contact) plus a raw JSON editor for anything
 * else. Saves merge server-side (PUT /admin/settings upserts per key).
 */
export function SettingsSection() {
  const { t } = useTranslation();
  const { api } = useAdminSession();
  const q = useAdminQuery((a) => a.getSettings(), []);
  const [llmBudget, setLlmBudget] = useState("");
  const [retention, setRetention] = useState("");
  const [locale, setLocale] = useState("en");
  const [contact, setContact] = useState("");
  const [raw, setRaw] = useState("{}");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const s = q.data?.settings;
    if (!s) return;
    const budgets = (s.budgets as SettingsObj | undefined) ?? {};
    const telemetry = (s.telemetry as SettingsObj | undefined) ?? {};
    const loc = (s.locale as SettingsObj | undefined) ?? {};
    const op = (s.operator as SettingsObj | undefined) ?? {};
    setLlmBudget(num(budgets.llm_daily_usd));
    setRetention(num(telemetry.retention_days));
    setLocale(str(loc.default) || "en");
    setContact(str(op.contact));
    setRaw(JSON.stringify(s, null, 2));
  }, [q.data]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    setErr(null);
    let base: SettingsObj;
    try {
      const parsed = JSON.parse(raw || "{}") as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      base = parsed as SettingsObj;
    } catch {
      setErr(t("admin.settings.invalidJson"));
      return;
    }
    const next: SettingsObj = {
      ...base,
      budgets: { ...((base.budgets as SettingsObj | undefined) ?? {}), llm_daily_usd: llmBudget ? Number.parseFloat(llmBudget) : null },
      telemetry: { ...((base.telemetry as SettingsObj | undefined) ?? {}), retention_days: retention ? Number.parseInt(retention, 10) : null },
      locale: { ...((base.locale as SettingsObj | undefined) ?? {}), default: locale },
      operator: { ...((base.operator as SettingsObj | undefined) ?? {}), contact: contact.trim() || null },
    };
    setBusy(true);
    const r = await api.putSettings(next);
    setBusy(false);
    if (r.ok) {
      setMsg(t("admin.settings.saved"));
      void q.reload();
    } else setErr(t("admin.common.error", { code: r.error }));
  }

  if (q.loading && !q.data) return <Skeleton className="h-64" />;

  return (
    <form onSubmit={submit} className="grid gap-4 lg:grid-cols-5" noValidate>
      <Card padding="md" className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-sm">{t("admin.settings.title")}</CardTitle>
          <CardDescription className="text-xs">{t("admin.settings.description")}</CardDescription>
        </CardHeader>
        <div className="flex flex-col gap-4">
          <Field label={t("admin.settings.llmBudget")} hint={t("admin.settings.llmBudgetHint")} optional>
            {(aria) => <TextInput {...aria} type="number" inputMode="decimal" min={0} step="0.5" value={llmBudget} onChange={(e) => setLlmBudget(e.target.value)} />}
          </Field>
          <Field label={t("admin.settings.retention")} hint={t("admin.settings.retentionHint")} optional>
            {(aria) => <TextInput {...aria} type="number" inputMode="numeric" min={1} value={retention} onChange={(e) => setRetention(e.target.value)} />}
          </Field>
          <Field label={t("admin.settings.defaultLocale")}>
            {(aria) => (
              <Select {...aria} value={locale} onChange={(e) => setLocale(e.target.value)}>
                {SUPPORTED_LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {LANGUAGE_META[l].nativeName}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t("admin.settings.contact")} hint={t("admin.settings.contactHint")} optional>
            {(aria) => <TextInput {...aria} type="email" inputMode="email" value={contact} onChange={(e) => setContact(e.target.value)} />}
          </Field>
        </div>
      </Card>
      <Card padding="md" className="flex flex-col lg:col-span-3">
        <Field label={t("admin.settings.raw")} hint={t("admin.settings.rawHint")} error={err} className="flex-1">
          {(aria) => <Textarea {...aria} rows={14} spellCheck={false} className="min-h-64 font-mono text-xs" value={raw} onChange={(e) => setRaw(e.target.value)} />}
        </Field>
        <div className="mt-4 flex items-center justify-between gap-3">
          <span role="status" className="text-xs text-muted">{msg}</span>
          <Button type="submit" loading={busy}>
            {t("admin.common.save")}
          </Button>
        </div>
      </Card>
    </form>
  );
}
