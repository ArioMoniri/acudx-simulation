import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { UserCircle } from "@phosphor-icons/react";
import { prefetchRoute } from "@/App";
import { cn } from "@/lib/cn";
import { useViewAs, type ViewAsRole } from "@/lib/viewAs";
import { Wordmark } from "./Wordmark";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { ThemeToggle } from "./ThemeToggle";
import { RoleSwitcher } from "./RoleSwitcher";
import { GuidedTour } from "./GuidedTour";

interface NavItem {
  to: string;
  key: string;
  end?: boolean;
  /** English fallback for a key not yet in the locale bundles (e.g. nav.atlas). */
  defaultLabel?: string;
}

/**
 * Nav surfaces per PERMITTED vantage point (docs/design/01). The vantage is
 * permission-clamped upstream in `lib/viewAs` (see `permittedVantages`), so this
 * map is only ever indexed by a vantage the real profile role actually permits:
 *   learner  → the solo learning loop (Journeys 1-5), incl. formative feedback
 *   educator → the learner loop PLUS authoring (Journey 7)
 *   dean     → the institution dashboard (Journey 8)
 *
 * Every label resolves to a real, reachable route so the nav never dead-ends;
 * the encounter → feedback → progress path is reachable from the learner set.
 */
const NAV_BY_ROLE: Record<ViewAsRole, NavItem[]> = {
  learner: [
    { to: "/", key: "nav.home", end: true },
    { to: "/start", key: "nav.start" },
    { to: "/cases", key: "nav.cases" },
    { to: "/rooms", key: "nav.rooms" },
    { to: "/exam", key: "nav.exam" },
    { to: "/atlas", key: "nav.atlas", defaultLabel: "Atlas" },
    { to: "/feedback", key: "nav.feedback" },
    { to: "/progress", key: "nav.progress" },
  ],
  educator: [
    { to: "/", key: "nav.home", end: true },
    { to: "/cases", key: "nav.cases" },
    { to: "/authoring", key: "nav.authoring" },
    { to: "/atlas", key: "nav.atlas", defaultLabel: "Atlas" },
  ],
  dean: [
    { to: "/", key: "nav.home", end: true },
    { to: "/institution", key: "nav.institution" },
    { to: "/authoring", key: "nav.authoring" },
    { to: "/atlas", key: "nav.atlas", defaultLabel: "Atlas" },
  ],
  // The operator console is reachable only from the admin vantage, which only
  // the real `admin` profile role can select (see lib/viewAs permittedVantages).
  admin: [
    { to: "/", key: "nav.home", end: true },
    { to: "/admin", key: "nav.admin", defaultLabel: "Admin" },
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
  const { role } = useViewAs();
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

        <ul className="ms-1 hidden items-center gap-1 lg:flex">
          {links.map((l) => (
            <li key={l.key}>
              <NavLink
                to={l.to}
                end={l.end}
                onMouseEnter={() => prefetchRoute(l.to)}
                onFocus={() => prefetchRoute(l.to)}
                className={({ isActive }) => linkClasses(isActive)}
              >
                {t(l.key, { defaultValue: l.defaultLabel })}
              </NavLink>
            </li>
          ))}
        </ul>

        <div className="ms-auto flex items-center gap-2">
          <GuidedTour className="hidden lg:inline-flex" />
          {/* View-as: the full segmented control needs ~250px, which together
              with the other controls pushed a 768px page to 985px. Below lg it
              collapses into one labelled select; the segmented control returns
              at lg and up, where the inline nav links also appear. */}
          <RoleSwitcher variant="segmented" className="hidden lg:flex" />
          <RoleSwitcher variant="menu" className="hidden sm:inline-flex lg:hidden" />
          <LanguageSwitcher className="hidden sm:inline-flex" />
          <ThemeToggle />
          <NavLink
            to="/account"
            aria-label={t("nav.account")}
            onMouseEnter={() => prefetchRoute("/account")}
            onFocus={() => prefetchRoute("/account")}
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
      <div className="flex items-center gap-2 overflow-x-auto border-t border-border px-4 py-1.5 lg:hidden">
        <GuidedTour className="shrink-0" />
        <RoleSwitcher variant="menu" className="shrink-0 sm:hidden" />
        <ul className="flex items-center gap-1">
          {links.map((l) => (
            <li key={l.key} className="shrink-0">
              <NavLink
                to={l.to}
                end={l.end}
                onMouseEnter={() => prefetchRoute(l.to)}
                onFocus={() => prefetchRoute(l.to)}
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
                {t(l.key, { defaultValue: l.defaultLabel })}
              </NavLink>
            </li>
          ))}
        </ul>
      </div>
    </header>
  );
}
