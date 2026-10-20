import { NavLink, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { UserCircle } from "@phosphor-icons/react";
import { prefetchRoute } from "@/App";
import { cn } from "@/lib/cn";
import { breadcrumbsFor } from "@/lib/navigation";
import { useViewAs } from "@/lib/viewAs";
import { Wordmark } from "./Wordmark";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { ThemeToggle } from "./ThemeToggle";
import { RoleSwitcher } from "./RoleSwitcher";
import { GuidedTour } from "./GuidedTour";
import { GlobalSearch } from "./GlobalSearch";

/**
 * TopNav: the compact 48 px top bar. Below lg it carries the wordmark (the
 * rail is hidden there); on lg+ it carries the breadcrumb trail instead. The
 * right side holds global search, the guided tour, the vantage switcher,
 * language, theme and account. Primary navigation lives in SideNav and
 * BottomTabBar.
 */
export function TopNav() {
  const { t } = useTranslation();
  const { role } = useViewAs();
  const location = useLocation();
  const crumbs = breadcrumbsFor(location.pathname, role);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface">
      <nav aria-label={t("app.name")} className="flex h-12 items-center gap-2 px-4 sm:px-6">
        <NavLink to="/" className="shrink-0 rounded-control lg:hidden" aria-label={t("app.name")}>
          <Wordmark size="sm" />
        </NavLink>

        <ol className="hidden min-w-0 items-center gap-1 text-[0.8125rem] lg:flex" aria-label={t("nav.breadcrumbs", { defaultValue: "Breadcrumbs" })}>
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            const label = t(c.key, { defaultValue: c.defaultLabel });
            return (
              <li key={c.to} className="flex min-w-0 items-center gap-1">
                {i > 0 ? (
                  <span aria-hidden className="text-border-strong">
                    /
                  </span>
                ) : null}
                {last ? (
                  <span aria-current="page" className="truncate font-medium text-fg">
                    {label}
                  </span>
                ) : (
                  <NavLink to={c.to} end className="truncate text-muted hover:text-fg">
                    {label}
                  </NavLink>
                )}
              </li>
            );
          })}
        </ol>

        <div className="ms-auto flex items-center gap-1.5">
          <GlobalSearch />
          <GuidedTour className="hidden sm:block" />
          <RoleSwitcher variant="segmented" className="hidden xl:flex" />
          <RoleSwitcher variant="menu" className="hidden lg:inline-flex xl:hidden" />
          <LanguageSwitcher className="hidden lg:inline-flex" />
          <ThemeToggle />
          <NavLink
            to="/account"
            aria-label={t("nav.account")}
            onMouseEnter={() => prefetchRoute("/account")}
            onFocus={() => prefetchRoute("/account")}
            className={cn(
              "grid h-8 w-8 place-items-center rounded-control border border-border",
              "bg-surface text-fg transition-colors duration-[120ms] ease-out hover:bg-bg-subtle",
            )}
          >
            <UserCircle weight="regular" className="h-5 w-5" aria-hidden="true" />
          </NavLink>
        </div>
      </nav>
    </header>
  );
}
