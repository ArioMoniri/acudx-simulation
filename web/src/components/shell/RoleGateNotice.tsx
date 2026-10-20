import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { LockKey } from "@phosphor-icons/react";

/**
 * Shown in place of a privileged page the current profile may not open.
 *
 * Acceptance 2026-10-20 D-21: /faculty, /dean and /admin as a student redirected
 * to Home with no message, so the learner could not tell a refusal from a bug.
 * This names the role the page needs and the two ways in (institution sign-in,
 * or the admin token in this tab while the gateway runs in local mode, D-15).
 */
export function RoleGateNotice({ required, current }: { required: string; current?: string }) {
  const { t } = useTranslation();
  return (
    <section
      role="alert"
      aria-labelledby="role-gate-title"
      className="mx-auto mt-10 flex max-w-lg flex-col gap-3 rounded-card border border-border bg-surface p-6"
    >
      <div className="flex items-center gap-2">
        <LockKey weight="bold" className="h-5 w-5 text-muted" aria-hidden />
        <h1 id="role-gate-title" className="text-base font-semibold text-fg">
          {t("identity.roleGate.title", { role: required })}
        </h1>
      </div>
      <p className="text-sm text-muted">
        {current ? t("identity.roleGate.current", { role: current }) : t("identity.roleGate.noProfile")}
      </p>
      <p className="text-sm text-muted">{t("identity.badge.localPrivileged")}</p>
      <div className="flex flex-wrap gap-3 text-sm">
        <Link className="underline" to="/signin">
          {t("identity.roleGate.signIn")}
        </Link>
        <Link className="underline" to="/account">
          {t("identity.roleGate.adminToken")}
        </Link>
        <Link className="underline" to="/">
          {t("identity.roleGate.home")}
        </Link>
      </div>
    </section>
  );
}
