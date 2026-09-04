import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { ArrowRight } from "@phosphor-icons/react";

import { PageContainer, PageHeader } from "@/components/shell";
import { Button, Card } from "@/components/ui";
import { useEntry } from "@/lib/useLang";
import { signIn, useIsSignedIn, useProfile } from "@/state/profileStore";
import { ProfileAvatar } from "./ProfilePage";

/**
 * SignInPage — the entry screen.
 *
 * AcuDx runs air-gapped with no identity backend, so the only real path is the
 * self-authored LOCAL profile: "Continue on this device" resumes a saved
 * profile, or the person creates one during onboarding. Nothing here collects a
 * password or fakes a credential.
 */
export function SignInPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const profile = useProfile();
  const signedIn = useIsSignedIn();
  const entry = useEntry();

  // A saved-but-signed-out account can be resumed without re-entering anything.
  const hasSavedAccount = profile?.onboarded === true && !signedIn;

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

        {/* Local path — create or resume the real, self-authored profile. */}
        <Card padding="lg" className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold tracking-tight text-fg">
            {t("profile.signIn.localHeading")}
          </h2>

          {hasSavedAccount && profile ? (
            <>
              <button
                type="button"
                onClick={handleContinueSaved}
                className={
                  "flex w-full items-center gap-3 rounded-control border border-border-strong bg-surface " +
                  "px-4 py-3 text-left transition-colors duration-150 hover:bg-bg-subtle " +
                  "focus-visible:outline-none active:scale-[0.99]"
                }
              >
                <ProfileAvatar
                  seed={profile.avatarSeed}
                  name={profile.fullName}
                  size={40}
                />
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
                <ArrowRight
                  weight="bold"
                  className="h-4 w-4 shrink-0 text-brand"
                  aria-hidden="true"
                />
              </button>
              <p className="text-xs text-muted">
                {t("profile.signIn.continueAsHint")}
              </p>
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
                onClick={handleCreate}
                trailingIcon={<ArrowRight weight="bold" className="h-4 w-4" />}
              >
                {t("profile.signIn.createCta")}
              </Button>
              <p className="text-xs text-muted">
                {t("profile.signIn.createHint")}
              </p>
            </>
          )}
        </Card>

        <p className="text-center text-xs text-subtle">
          {t("profile.signIn.eduNote")}
        </p>
      </motion.div>
    </PageContainer>
  );
}
