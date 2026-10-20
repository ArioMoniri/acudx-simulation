import { useEffect, useId, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { DotsThree, House, X } from "@phosphor-icons/react";
import { prefetchRoute } from "@/App";
import { cn } from "@/lib/cn";
import { primaryTabsFor } from "@/lib/navigation";
import { useViewAs } from "@/lib/viewAs";
import { NAV_ICON } from "./navIcons";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { RoleSwitcher } from "./RoleSwitcher";

/**
 * BottomTabBar: primary navigation on phone and tablet (below lg). A fixed
 * 56 px bar with up to four destinations and a "More" entry that opens a
 * sheet with the remaining destinations plus the language and vantage
 * controls that do not fit in the compact top bar.
 */
export function BottomTabBar() {
  const { t } = useTranslation();
  const { role } = useViewAs();
  const { primary, overflow } = primaryTabsFor(role);
  const location = useLocation();
  // The sheet is open only for the pathname it was opened on, so navigating
  // closes it without an effect.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === location.pathname;
  const setOpen = (next: boolean | ((prev: boolean) => boolean)) => {
    const value = typeof next === "function" ? next(open) : next;
    setOpenAt(value ? location.pathname : null);
  };
  const sheetId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  // Escape closes the sheet; focus moves to its close control on open.
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenAt(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const tabClass = (active: boolean) =>
    cn(
      "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1.5",
      "text-[0.6875rem] font-medium leading-3 transition-colors duration-[120ms]",
      active ? "text-brand" : "text-muted hover:text-fg",
    );

  return (
    <>
      <nav
        aria-label={t("nav.primary", { defaultValue: "Primary" })}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="flex h-14 items-stretch">
          {primary.map((item) => {
            const Glyph = NAV_ICON[item.to] ?? House;
            return (
              <li key={item.key} className="flex min-w-0 flex-1">
                <NavLink
                  to={item.to}
                  end={item.end}
                  onFocus={() => prefetchRoute(item.to)}
                  className={({ isActive }) => tabClass(isActive)}
                >
                  {({ isActive }) => (
                    <>
                      <Glyph weight={isActive ? "fill" : "regular"} className="h-5 w-5" aria-hidden />
                      <span className="max-w-full truncate">{t(item.key, { defaultValue: item.defaultLabel })}</span>
                    </>
                  )}
                </NavLink>
              </li>
            );
          })}
          {overflow.length > 0 ? (
            <li className="flex min-w-0 flex-1">
              <button
                type="button"
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-controls={open ? sheetId : undefined}
                onClick={() => setOpen((v) => !v)}
                className={tabClass(open || overflow.some((i) => location.pathname.startsWith(i.to)))}
              >
                <DotsThree weight="bold" className="h-5 w-5" aria-hidden />
                <span>{t("nav.more", { defaultValue: "More" })}</span>
              </button>
            </li>
          ) : null}
        </ul>
      </nav>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label={t("nav.more", { defaultValue: "More" })} id={sheetId}>
          <div className="absolute inset-0 bg-fg/30" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute inset-x-0 bottom-0 rounded-t-card border-t border-border bg-surface p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            <div className="flex items-center justify-between px-1 pb-2">
              <span className="eyebrow">{t("nav.more", { defaultValue: "More" })}</span>
              <button
                ref={closeRef}
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("actions.close")}
                className="grid h-8 w-8 place-items-center rounded-control text-muted hover:bg-bg-subtle hover:text-fg"
              >
                <X weight="bold" className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-border bg-border">
              {overflow.map((item) => {
                const Glyph = NAV_ICON[item.to] ?? House;
                return (
                  <li key={item.key} className="bg-surface">
                    <NavLink
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) =>
                        cn(
                          "flex h-11 items-center gap-2.5 px-3 text-[0.8125rem] font-medium",
                          isActive ? "text-brand" : "text-fg hover:bg-bg-subtle",
                        )
                      }
                    >
                      <Glyph className="h-4 w-4 text-subtle" aria-hidden />
                      {t(item.key, { defaultValue: item.defaultLabel })}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
            <div className="mt-3 flex flex-wrap items-center gap-2 px-1">
              <RoleSwitcher variant="menu" />
              <LanguageSwitcher />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
