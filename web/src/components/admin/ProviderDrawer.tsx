import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { X } from "@phosphor-icons/react";
import { Button, Field, Select, Switch, Textarea, TextInput } from "@/components/ui";
import { PROVIDER_KINDS, type Provider, type ProviderInput, type ProviderKind } from "@/lib/adminApi";
import { cn } from "@/lib/cn";
import { useAdminSession } from "./adminSession";

interface DraftState {
  kind: ProviderKind;
  name: string;
  base_url: string;
  model: string;
  api_key: string;
  clearKey: boolean;
  region: string;
  priority: string;
  enabled: boolean;
  extra: string;
}

function draftFrom(p: Provider | null, kind: ProviderKind): DraftState {
  return {
    kind: p?.kind ?? kind,
    name: p?.name ?? "",
    base_url: p?.base_url ?? "",
    model: p?.model ?? "",
    api_key: "",
    clearKey: false,
    region: p?.region ?? "",
    priority: String(p?.priority ?? 100),
    enabled: p?.enabled ?? true,
    extra: JSON.stringify(p?.extra ?? {}, null, 2),
  };
}

/**
 * Anthropic API row: the gateway calls it through the native Messages API
 * (server/providers/anthropic_messages.py). The key typed below is sealed in the
 * registry on the server and never returned to the browser.
 */
const ANTHROPIC_PRESET = {
  name: "anthropic",
  base_url: "https://api.anthropic.com/v1",
  model: "claude-opus-5-5",
} as const;

function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return (u.protocol === "http:" || u.protocol === "https:") && !!u.host;
  } catch {
    return false;
  }
}

/**
 * Create / edit drawer for one provider. The key input is write-only: it starts
 * empty on edit, and the server never returns the stored key (only `has_key`
 * and the last four characters, which we show as a hint). Right-side panel on
 * tablet and up, full-screen sheet at phone width; motion collapses under
 * prefers-reduced-motion via `motion-reduce:transition-none`.
 */
export function ProviderDrawer({
  open,
  provider,
  defaultKind = "llm",
  onClose,
  onSaved,
}: {
  open: boolean;
  provider: Provider | null;
  defaultKind?: ProviderKind;
  onClose: () => void;
  onSaved: (p: Provider) => void;
}) {
  const { t } = useTranslation();
  const { api } = useAdminSession();
  const [draft, setDraft] = useState<DraftState>(() => draftFrom(provider, defaultKind));
  const [errors, setErrors] = useState<Partial<Record<keyof DraftState | "form", string>>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft(draftFrom(provider, defaultKind));
      setErrors({});
    }
  }, [open, provider, defaultKind]);

  const set = <K extends keyof DraftState>(k: K, v: DraftState[K]) => setDraft((d) => ({ ...d, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    if (!draft.name.trim()) next.name = t("admin.providers.drawer.required");
    if (!isHttpUrl(draft.base_url.trim())) next.base_url = t("admin.providers.drawer.invalidUrl");
    let extra: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(draft.extra || "{}") as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      extra = parsed as Record<string, unknown>;
    } catch {
      next.extra = t("admin.providers.drawer.extraInvalid");
    }
    const priority = Number.parseInt(draft.priority, 10);
    if (!Number.isFinite(priority) || priority < 0) next.priority = t("admin.providers.drawer.required");
    setErrors(next);
    if (Object.keys(next).length) return;

    const body: ProviderInput = {
      kind: draft.kind,
      name: draft.name.trim(),
      base_url: draft.base_url.trim(),
      model: draft.model.trim() || null,
      region: draft.region.trim() || null,
      priority,
      enabled: draft.enabled,
      extra,
    };
    if (draft.clearKey) body.api_key = "";
    else if (draft.api_key) body.api_key = draft.api_key;

    setBusy(true);
    const r = provider ? await api.updateProvider(provider.id, body) : await api.createProvider(body);
    setBusy(false);
    if (r.ok) {
      onSaved(r.data);
      onClose();
      return;
    }
    const detail = r.detail as { message?: string } | string | undefined;
    const message = typeof detail === "string" ? detail : detail?.message;
    setErrors({ form: message ?? t("admin.common.error", { code: r.error }) });
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-fg/40 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            "fixed inset-y-0 end-0 z-50 flex w-full flex-col bg-surface text-fg shadow-soft-md sm:max-w-md sm:border-s sm:border-border",
            "transition-transform duration-200 ease-out motion-reduce:transition-none",
            "focus-visible:outline-none",
          )}
        >
          <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
            <Dialog.Title className="text-base font-semibold tracking-tight">
              {provider ? t("admin.providers.drawer.editTitle") : t("admin.providers.drawer.createTitle")}
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="sm" aria-label={t("admin.common.close")}>
                <X weight="bold" className="h-4 w-4" aria-hidden />
              </Button>
            </Dialog.Close>
          </header>

          <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
              <Field label={t("admin.providers.drawer.kind")}>
                {(aria) => (
                  <Select {...aria} value={draft.kind} disabled={!!provider} onChange={(e) => set("kind", e.target.value as ProviderKind)}>
                    {PROVIDER_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {t(`admin.kinds.${k}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {!provider && draft.kind === "llm" ? (
                <div className="flex flex-col gap-2 rounded-control border border-border px-3 py-2.5">
                  <p className="text-xs text-muted">{t("admin.providers.drawer.presetHint")}</p>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        name: d.name || ANTHROPIC_PRESET.name,
                        base_url: ANTHROPIC_PRESET.base_url,
                        model: d.model || ANTHROPIC_PRESET.model,
                        priority: "0",
                      }))
                    }
                  >
                    {t("admin.providers.drawer.presetAnthropic")}
                  </Button>
                </div>
              ) : null}
              <Field label={t("admin.providers.drawer.name")} hint={t("admin.providers.drawer.nameHint")} error={errors.name}>
                {(aria) => <TextInput {...aria} value={draft.name} onChange={(e) => set("name", e.target.value)} required />}
              </Field>
              <Field label={t("admin.providers.drawer.baseUrl")} hint={t("admin.providers.drawer.baseUrlHint")} error={errors.base_url}>
                {(aria) => (
                  <TextInput {...aria} type="url" inputMode="url" spellCheck={false} value={draft.base_url} onChange={(e) => set("base_url", e.target.value)} required />
                )}
              </Field>
              <Field label={t("admin.providers.drawer.model")} hint={t("admin.providers.drawer.modelHint")} optional>
                {(aria) => <TextInput {...aria} spellCheck={false} value={draft.model} onChange={(e) => set("model", e.target.value)} />}
              </Field>
              <Field
                label={t("admin.providers.drawer.apiKey")}
                hint={
                  provider?.has_key
                    ? t("admin.providers.drawer.apiKeyKeep", { last4: provider.key_last4 ?? "" })
                    : t("admin.providers.drawer.apiKeyHint")
                }
                optional
              >
                {(aria) => (
                  <div className="flex flex-col gap-2">
                    <TextInput
                      {...aria}
                      type="password"
                      autoComplete="new-password"
                      spellCheck={false}
                      value={draft.api_key}
                      disabled={draft.clearKey}
                      onChange={(e) => set("api_key", e.target.value)}
                    />
                    {provider?.has_key ? (
                      <label className="flex items-center gap-2 text-xs text-muted">
                        <input type="checkbox" className="h-4 w-4 accent-[color:var(--brand-600)]" checked={draft.clearKey} onChange={(e) => set("clearKey", e.target.checked)} />
                        {t("admin.providers.drawer.apiKeyClear")}
                      </label>
                    ) : null}
                  </div>
                )}
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label={t("admin.providers.drawer.region")} optional>
                  {(aria) => <TextInput {...aria} value={draft.region} onChange={(e) => set("region", e.target.value)} />}
                </Field>
                <Field label={t("admin.providers.drawer.priority")} hint={t("admin.providers.drawer.priorityHint")} error={errors.priority}>
                  {(aria) => (
                    <TextInput {...aria} type="number" inputMode="numeric" min={0} max={10000} step={1} value={draft.priority} onChange={(e) => set("priority", e.target.value)} />
                  )}
                </Field>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-control border border-border px-3 py-2.5">
                <label htmlFor="provider-enabled" className="text-sm font-medium text-fg">
                  {t("admin.providers.drawer.enabled")}
                </label>
                <Switch id="provider-enabled" checked={draft.enabled} onCheckedChange={(v) => set("enabled", v)} />
              </div>
              <Field label={t("admin.providers.drawer.extra")} hint={t("admin.providers.drawer.extraHint")} error={errors.extra} optional>
                {(aria) => <Textarea {...aria} rows={4} spellCheck={false} className="font-mono text-xs" value={draft.extra} onChange={(e) => set("extra", e.target.value)} />}
              </Field>
              {errors.form ? (
                <p role="alert" className="rounded-control border border-[color:var(--state-critical)] px-3 py-2 text-sm text-[color:var(--state-critical)]">
                  {errors.form}
                </p>
              ) : null}
            </div>
            <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
              <Button type="button" variant="secondary" onClick={onClose}>
                {t("admin.common.cancel")}
              </Button>
              <Button type="submit" loading={busy}>
                {provider ? t("admin.common.save") : t("admin.providers.drawer.create")}
              </Button>
            </footer>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
