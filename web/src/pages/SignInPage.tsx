import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { ArrowRight, Buildings, ShieldCheck, ShieldWarning, WifiSlash } from "@phosphor-icons/react";

import { PageContainer, PageHeader } from "@/components/shell";
import { Badge, Button, Card } from "@/components/ui";
import { beginSignIn, useAuthSession } from "@/lib/auth";
import { useEntry } from "@/lib/useLang";
import { signIn, useIsSignedIn, useProfile } from "@/state/profileStore";
import { ProfileAvatar } from "./ProfilePage";

/**
 * SignInPage - the entry screen.
 *
 * Two paths, chosen by what the gateway reports at GET /v1/auth/config:
 *   - "Sign in with your institution" (OIDC Authorization Code + PKCE) whenever
 *     an identity provider is configured in the admin registry. The role the
 *     app gates on then comes from the server-verified token.
 *   - The LOCAL profile, only while the gateway runs AUTH_MODE=local (air-gapped
 *     demos). It carries a visible "local, unverified" badge: nothing here
 *     collects a password or fakes a credential.
 */
export function SignInPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const profile = useProfile();
  const signedIn = useIsSignedIn();
  const entry = useEntry();
  const auth = useAuthSession();
  const [starting, setStarting] = useState(false);
  const [ssoError, setSsoError] = useState<string | null>(null);

  const provider = auth.config?.provider ?? null;
  const ssoAvailable = provider !== null && auth.config?.discovery?.authorization_endpoint != null;
  const localAllowed = !auth.configLoaded || auth.mode === "local";
  const gatewayDown = auth.configLoaded && auth.config === null;

  // A saved-but-signed-out LOCAL account can be resumed without re-entering anything.
  const hasSavedLocal = profile?.onboarded === true && !signedIn && !profile.verified;

  async function handleSso() {
    if (!auth.config) return;
    setStarting(true);
    setSsoError(null);
    const url = await beginSignIn(auth.config, { returnTo: "/" });
    if (!url) {
      setStarting(false);
      setSsoError(t("identity.signIn.ssoUnavailable"));
    }
  }

  function handleContinueSaved() {
    signIn();
    navigate("/", { replace: true });
  }

  function handleCreate() {
    navigate("/profile");
  }

  return (
    <PageContainer width="prose">
      <motion.div {...entry} className="mx-auto flex max-w-md flex-col gap-6">
        <PageHeader
          eyebrow={t("profile.signIn.eyebrow")}
          title={t("profile.signIn.title")}
          description={t("profile.signIn.lede")}
        />

        {ssoAvailable ? (
          <Card padding="lg" className="flex flex-col gap-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold tracking-tight text-fg">
                  {t("identity.signIn.ssoHeading")}
                </h2>
                <p className="mt-1 text-xs text-muted">
                  {t("identity.signIn.ssoLede", { provider: provider?.name ?? "" })}
                </p>
              </div>
              <Badge tone="normal" icon={<ShieldCheck weight="fill" className="h-3.5 w-3.5" aria-hidden />}>
                {t("identity.badge.verified")}
              </Badge>
            </div>
            <Button
              fullWidth
              size="lg"
              onClick={handleSso}
              loading={starting}
              leadingIcon={<Buildings weight="bold" className="h-4 w-4" />}
              trailingIcon={<ArrowRight weight="bold" className="h-4 w-4" />}
            >
              {t("identity.signIn.ssoCta")}
            </Button>
            <p className="text-xs text-muted">{t("identity.signIn.ssoHint")}</p>
            {ssoError || auth.error ? (
              <p role="alert" className="text-xs text-[color:var(--state-critical)]">
                {ssoError ?? t("identity.signIn.callbackError", { reason: auth.error })}
              </p>
            ) : null}
          </Card>
        ) : null}

        {localAllowed ? (
          <Card padding="lg" className="flex flex-col gap-4">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-sm font-semibold tracking-tight text-fg">
                {t("profile.signIn.localHeading")}
              </h2>
              <Badge
                tone="caution"
                icon={<ShieldWarning weight="fill" className="h-3.5 w-3.5" aria-hidden />}
                title={t("identity.badge.localHint")}
              >
                {t("identity.badge.local")}
              </Badge>
            </div>
            {gatewayDown ? (
              <p className="inline-flex items-center gap-1.5 text-xs text-muted">
                <WifiSlash weight="bold" className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {t("identity.signIn.gatewayDown")}
              </p>
            ) : null}

            {hasSavedLocal && profile ? (
              <>
                <button
                  type="button"
                  onClick={handleContinueSaved}
                  className={
                    "flex w-full items-center gap-3 rounded-control border border-border-strong bg-surface " +
                    "px-4 py-3 text-start transition-colors duration-150 hover:bg-bg-subtle " +
                    "focus-visible:outline-none active:scale-[0.99]"
                  }
                >
                  <ProfileAvatar seed={profile.avatarSeed} name={profile.fullName} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-fg">
                      {t("profile.signIn.continueAs", { name: profile.fullName })}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {t(`profile.roles.${profile.role}`)}
                      {" · "}
                      {profile.institution}
                    </span>
                  </span>
                  <ArrowRight weight="bold" className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
                </button>
                <p className="text-xs text-muted">{t("profile.signIn.continueAsHint")}</p>
                <button
                  type="button"
                  onClick={handleCreate}
                  className="self-start text-xs font-medium text-brand hover:underline focus-visible:outline-none"
                >
                  {t("profile.signIn.switchProfile")}
                </button>
              </>
            ) : (
              <>
                <Button
                  fullWidth
                  size="lg"
                  variant={ssoAvailable ? "secondary" : "primary"}
                  onClick={handleCreate}
                  trailingIcon={<ArrowRight weight="bold" className="h-4 w-4" />}
                >
                  {t("profile.signIn.createCta")}
                </Button>
                <p className="text-xs text-muted">{t("profile.signIn.createHint")}</p>
              </>
            )}
            <p className="text-xs text-subtle">{t("identity.signIn.localNote")}</p>
          </Card>
        ) : null}

        {!ssoAvailable && !localAllowed ? (
          <Card padding="lg" variant="inset" className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-fg">{t("identity.signIn.ssoHeading")}</h2>
            <p className="text-xs text-muted">{t("identity.signIn.ssoNotConfigured")}</p>
          </Card>
        ) : null}

        <p className="text-center text-xs text-subtle">{t("profile.signIn.eduNote")}</p>
      </motion.div>
    </PageContainer>
  );
}
