import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ShieldCheck } from "@phosphor-icons/react";
import { Button, Card, CardDescription, CardHeader, CardTitle, Field, TextInput } from "@/components/ui";
import type { AdminErrorCode } from "@/lib/adminApi";
import { useAdminSession } from "./adminSession";

function messageFor(code: AdminErrorCode, t: (k: string) => string): string {
  switch (code) {
    case "unauthorized":
      return t("admin.token.invalid");
    case "admin_disabled":
      return t("admin.token.disabled");
    case "network":
    case "timeout":
      return t("admin.token.network");
    default:
      return t("admin.token.invalid");
  }
}

/**
 * Admin sign-in: the operator types the gateway's ADMIN_TOKEN. It is stored in
 * sessionStorage only and verified with one GET /admin/health before the
 * console renders. The field is a password input so the token is never shown
 * on screen or in a screenshot.
 */
export function AdminTokenGate() {
  const { t } = useTranslation();
  const { signIn } = useAdminSession();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token.trim()) return;
    setBusy(true);
    setError(null);
    const code = await signIn(token);
    setBusy(false);
    if (code) setError(messageFor(code, t));
    setToken("");
  }

  return (
    <Card padding="lg" className="mx-auto mt-6 w-full max-w-md">
      <CardHeader>
        <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center text-brand" aria-hidden>
          <ShieldCheck weight="bold" className="h-5 w-5" />
        </span>
        <CardTitle>{t("admin.token.title")}</CardTitle>
        <CardDescription>{t("admin.token.body")}</CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field label={t("admin.token.label")} error={error}>
          {(aria) => (
            <TextInput
              {...aria}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
            />
          )}
        </Field>
        <Button type="submit" loading={busy} disabled={!token.trim()} fullWidth>
          {t("admin.token.submit")}
        </Button>
      </form>
    </Card>
  );
}
