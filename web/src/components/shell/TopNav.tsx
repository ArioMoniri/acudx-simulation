import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { UserCircle, Broadcast, WifiSlash } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { useDemoRole, type DemoRole } from "@/lib/demoRole";
import { useLiveBackend } from "@/lib/liveBackend";
import { Switch, Tooltip } from "@/components/ui";
import { Wordmark } from "./Wordmark";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { ThemeToggle } from "./ThemeToggle";
import { RoleSwitcher } from "./RoleSwitcher";
import { GuidedTour } from "./GuidedTour";

interface NavItem {
  to: string;
  key: string;
  end?: boolean;
}

/**
 * Nav surfaces per demo vantage point (docs/design/01):
 *   learner  → the solo learning loop (Journeys 1-5)
 *   educator → the learner loop PLUS authoring + review (Journey 7)
 *   dean     → the institution dashboard (Journey 8)
 *
 * Every label resolves to a real, reachable route so the nav never dead-ends;
 * the existing Home / Encounter / Feedback screens stay reachable (Cases and
 * Progress are their learner-facing names).
 */
const NAV_BY_ROLE: Record<DemoRole, NavItem[]> = {
  learner: [
    { to: "/", key: "nav.home", end: true },
    { to: "/start", key: "nav.start" },
    { to: "/cases", key: "nav.cases" },
    { to: "/rooms", key: "nav.rooms" },
    { to: "/progress", key: "nav.progress" },
  ],
  educator: [
    { to: "/", key: "nav.home", end: true },
    { to: "/cases", key: "nav.cases" },
    { to: "/authoring", key: "nav.authoring" },
    { to: "/feedback", key: "nav.review" },
  ],
  dean: [
    { to: "/", key: "nav.home", end: true },
    { to: "/institution", key: "nav.institution" },
    { to: "/authoring", key: "nav.authoring" },
  ],
};

const linkClasses = (isActive: boolean) =>
  cn(
    "inline-flex min-h-9 items-center rounded-control px-3 text-sm font-medium",
    "transition-colors duration-200 ease-out focus-visible:outline-none",
    isActive
      ? "bg-brand-tint text-brand"
      : "text-muted hover:bg-bg-subtle hover:text-fg",
  );

/**
 * TopNav — single-line app header: gradient wordmark, role-scoped primary nav,
 * a "View as" role switcher, language + theme controls, account. Height <= 72px.
 */
export function TopNav() {
  const { t } = useTranslation();
  const { role } = useDemoRole();
  const links = NAV_BY_ROLE[role];

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/85 backdrop-blur-md">
      <nav
        aria-label={t("app.name")}
        className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6"
      >
        <NavLink
          to="/"
          className="shrink-0 rounded-control focus-visible:outline-none"
          aria-label={t("app.name")}
        >
          <Wordmark />
        </NavLink>

        <ul className="ml-1 hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <li key={l.key}>
              <NavLink
                to={l.to}
                end={l.end}
                className={({ isActive }) => linkClasses(isActive)}
              >
                {t(l.key)}
              </NavLink>
            </li>
          ))}
        </ul>

        <div className="ml-auto flex items-center gap-2">
          <GuidedTour className="hidden md:inline-flex" />
          <RoleSwitcher className="hidden sm:flex" />
          <LiveBackendToggle className="hidden sm:inline-flex" />
          <LanguageSwitcher className="hidden sm:inline-flex" />
          <ThemeToggle />
          <NavLink
            to="/account"
            aria-label={t("nav.account")}
            className={cn(
              "grid h-9 w-9 place-items-center rounded-control border border-border",
              "bg-surface text-fg transition-colors duration-200 ease-out",
              "hover:bg-bg-subtle focus-visible:outline-none active:scale-[0.98]",
            )}
          >
            <UserCircle weight="bold" className="h-5 w-5" aria-hidden="true" />
          </NavLink>
        </div>
      </nav>

      {/* Compact nav for small screens — kept on one row, scrolls if needed */}
      <div className="flex items-center gap-2 overflow-x-auto border-t border-border px-4 py-1.5 md:hidden">
        <GuidedTour className="shrink-0" />
        <RoleSwitcher className="shrink-0 sm:hidden" />
        <ul className="flex items-center gap-1">
          {links.map((l) => (
            <li key={l.key} className="shrink-0">
              <NavLink
                to={l.to}
                end={l.end}
                className={({ isActive }) =>
                  cn(
                    "inline-flex min-h-9 items-center rounded-control px-3 text-sm font-medium",
                    "focus-visible:outline-none",
                    isActive
                      ? "bg-brand-tint text-brand"
                      : "text-muted hover:text-fg",
                  )
                }
              >
                {t(l.key)}
              </NavLink>
            </li>
          ))}
        </ul>
      </div>
    </header>
  );
}

/**
 * LiveBackendToggle — opt into the live, open-model backend running on the pod.
 * Off by default. While the gateway is unreachable the Switch is disabled and a
 * visible "backend offline" note is shown, so the affordance never lies about
 * what is available. Accessible: the Switch carries an aria-label, a tooltip
 * explains the mode, and the offline note is real text (not tooltip-only).
 */
function LiveBackendToggle({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { enabled, setEnabled, available, checking } = useLiveBackend();
  const offline = !checking && !available;

  return (
    <Tooltip content={t("liveBackend.tooltip")}>
      <span
        className={cn(
          "inline-flex items-center gap-2 rounded-control border border-border bg-surface px-2.5 py-1.5",
          offline && "opacity-80",
          className,
        )}
      >
        {available ? (
          <Broadcast
            weight="bold"
            className={cn("h-4 w-4", enabled ? "text-brand" : "text-muted")}
            aria-hidden="true"
          />
        ) : (
          <WifiSlash
            weight="bold"
            className="h-4 w-4 text-muted"
            aria-hidden="true"
          />
        )}
        <span className="text-xs font-medium text-fg">
          {t("liveBackend.toggle")}
        </span>
        <Switch
          checked={enabled}
          onCheckedChange={setEnabled}
          disabled={checking || !available}
          aria-label={t("liveBackend.toggle")}
        />
        {offline ? (
          <span className="text-[11px] text-muted">
            {t("liveBackend.offline")}
          </span>
        ) : null}
      </span>
    </Tooltip>
  );
}
