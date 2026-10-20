import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ShieldCheck, WarningCircle } from "@phosphor-icons/react";

import { PageContainer, PageHeader } from "@/components/shell";
import { Button, Card } from "@/components/ui";
import { completeSignIn } from "@/lib/auth";
import { retryEventSync } from "@/lib/eventSync";
import { applyVerifiedIdentity } from "@/state/profileStore";

/**
 * AuthCallbackPage - the OIDC redirect target (`/auth/callback`).
 *
 * Validates the state, exchanges the code with the PKCE verifier, loads the
 * server-verified principal and mirrors it into the profile store, then returns
 * the person to where they started. Any failure is shown with the IdP's reason
 * and a way back to the sign-in screen; nothing is retried silently.
 */
export function AuthCallbackPage() {
  const { t } = useTranslation();
  const { search } = useLocation();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    void completeSignIn(search).then((out) => {
      if ("error" in out) {
        setError(out.error);
        return;
      }
      applyVerifiedIdentity(out.principal);
      void retryEventSync();
      navigate(out.returnTo || "/", { replace: true });
    });
  }, [search, navigate]);

  return (
    <PageContainer width="prose">
      <div className="mx-auto flex max-w-md flex-col gap-6">
        <PageHeader
          eyebrow={t("identity.callback.eyebrow")}
          title={error ? t("identity.callback.failedTitle") : t("identity.callback.title")}
          description={error ? t("identity.callback.failedLede") : t("identity.callback.lede")}
        />
        <Card padding="lg" className="flex flex-col gap-4">
          {error ? (
            <>
              <p role="alert" className="inline-flex items-start gap-2 text-sm text-fg">
                <WarningCircle weight="fill" className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--state-critical)]" aria-hidden />
                <span>
                  {t("identity.callback.reason")} <code className="font-mono text-xs">{error}</code>
                </span>
              </p>
              <Button asChild variant="secondary">
                <Link to="/signin">{t("identity.callback.backToSignIn")}</Link>
              </Button>
            </>
          ) : (
            <p className="inline-flex items-center gap-2 text-sm text-muted" aria-live="polite">
              <ShieldCheck weight="fill" className="h-4 w-4 shrink-0 text-brand" aria-hidden />
              {t("identity.callback.working")}
            </p>
          )}
        </Card>
      </div>
    </PageContainer>
  );
}
