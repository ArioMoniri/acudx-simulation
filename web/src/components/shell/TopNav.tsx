import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { UserCircle } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { Wordmark } from "./Wordmark";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { ThemeToggle } from "./ThemeToggle";

const links = [
  { to: "/", key: "nav.home", end: true },
  { to: "/encounter", key: "nav.encounter", end: false },
  { to: "/feedback", key: "nav.feedback", end: false },
] as const;

/**
 * TopNav — single-line app header: gradient wordmark, primary nav,
 * language + theme controls, account. Height <= 72px.
 */
export function TopNav() {
  const { t } = useTranslation();

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/85 backdrop-blur-md">
      <nav
        aria-label={t("app.name")}
        className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6"
      >
        <NavLink
          to="/"
          className="shrink-0 rounded-control focus-visible:outline-none"
          aria-label={t("app.name")}
        >
          <Wordmark />
        </NavLink>

        <ul className="ml-2 hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <li key={l.to}>
              <NavLink
                to={l.to}
                end={l.end}
                className={({ isActive }) =>
                  cn(
                    "inline-flex min-h-9 items-center rounded-control px-3 text-sm font-medium",
                    "transition-colors duration-200 ease-out focus-visible:outline-none",
                    isActive
                      ? "bg-brand-tint text-brand"
                      : "text-muted hover:bg-bg-subtle hover:text-fg",
                  )
                }
              >
                {t(l.key)}
              </NavLink>
            </li>
          ))}
        </ul>

        <div className="ml-auto flex items-center gap-2">
          <LanguageSwitcher />
          <ThemeToggle />
          <button
            type="button"
            aria-label={t("nav.account")}
            className={cn(
              "grid h-9 w-9 place-items-center rounded-control border border-border",
              "bg-surface text-fg transition-colors duration-200 ease-out",
              "hover:bg-bg-subtle focus-visible:outline-none active:scale-[0.98]",
            )}
          >
            <UserCircle weight="bold" className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </nav>

      {/* Compact nav for small screens — kept on one row, scrolls if needed */}
      <ul className="flex items-center gap-1 overflow-x-auto border-t border-border px-4 py-1.5 md:hidden">
        {links.map((l) => (
          <li key={l.to} className="shrink-0">
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
    </header>
  );
}
