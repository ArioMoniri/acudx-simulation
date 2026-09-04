import { type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import {
  ArrowRight,
  Buildings,
  GraduationCap,
  Lock,
  ShieldCheck,
} from "@phosphor-icons/react";

import { PageContainer, PageHeader } from "@/components/shell";
import { Badge, Button, Card, Divider } from "@/components/ui";
import { useEntry } from "@/lib/useLang";
import { signIn, useIsSignedIn, useProfile } from "@/state/profileStore";
import { ProfileAvatar } from "./ProfilePage";

/** A single production auth method — presented as the real path, gated until the
 *  institution connects AcuDx (so the affordance never pretends to work). */
function SsoOption({
  icon,
  label,
  hint,
  badge,
}: {
  icon: ReactNode;
  label: string;
  hint: string;
  badge: string;
}) {
  return (
    <button
      type="button"
      disabled
      aria-disabled="true"
      className={
        "flex w-full items-center gap-3 rounded-control border border-border-strong bg-surface " +
        "px-4 py-3 text-left opacity-70 cursor-not-allowed"
      }
    >
      <span
        aria-hidden="true"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-control bg-brand-tint text-brand"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-fg">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
      <Badge tone="neutral" variant="outline" className="shrink-0">
        {badge}
      </Badge>
    </button>
  );
}

/**
 * SignInPage — the entry screen.
 *
 * The production sign-in path (institution SSO / LTI 1.3, per the build
 * roadmap) is presented first as the real path; it is gated until an
 * institution connects AcuDx, so nothing here collects a password or fakes a
 * credential. Below it, "Continue on this device" creates or resumes the
 * genuine LOCAL profile the person authors during onboarding.
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

        {/* Production path — institution-managed SSO / LTI. */}
        <Card padding="lg" className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <ShieldCheck
              weight="bold"
              className="h-4 w-4 text-brand"
              aria-hidden="true"
            />
            <h2 className="text-sm font-semibold tracking-tight text-fg">
              {t("profile.signIn.ssoHeading")}
            </h2>
          </div>
          <p className="text-xs text-muted">{t("profile.signIn.ssoNote")}</p>
          <div className="flex flex-col gap-2">
            <SsoOption
              icon={<Buildings weight="bold" className="h-5 w-5" />}
              label={t("profile.signIn.sso")}
              hint={t("profile.signIn.ssoHint")}
              badge={t("profile.signIn.productionBadge")}
            />
            <SsoOption
              icon={<GraduationCap weight="bold" className="h-5 w-5" />}
              label={t("profile.signIn.lti")}
              hint={t("profile.signIn.ltiHint")}
              badge={t("profile.signIn.productionBadge")}
            />
          </div>
          <p className="flex items-center gap-1.5 text-xs text-subtle">
            <Lock weight="bold" className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t("profile.signIn.unavailableNote")}
          </p>
        </Card>

        <Divider label={t("profile.signIn.or")} />

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
