import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { House } from "@phosphor-icons/react";
import { prefetchRoute } from "@/App";
import { cn } from "@/lib/cn";
import { navItemsFor } from "@/lib/navigation";
import { useViewAs } from "@/lib/viewAs";
import { Wordmark } from "./Wordmark";
import { NAV_ICON } from "./navIcons";

/**
 * SideNav: the primary navigation rail on lg and up (Linear, Vercel, Heidi).
 * 220 px, wordmark at the top, role-scoped items from lib/navigation, a
 * 32 px row per item with a glyph and label, the active row filled.
 */
export function SideNav({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { role } = useViewAs();
  const items = navItemsFor(role);

  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-dvh w-[220px] shrink-0 flex-col border-e border-border bg-surface lg:flex",
        className,
      )}
    >
      <div className="flex h-12 items-center border-b border-border px-4">
        <NavLink to="/" aria-label={t("app.name")} className="rounded-control">
          <Wordmark size="sm" />
        </NavLink>
      </div>
      <nav aria-label={t("nav.primary", { defaultValue: "Primary" })} className="flex-1 overflow-y-auto px-2 py-3">
        <ul className="flex flex-col gap-px">
          {items.map((item) => {
            const Glyph = NAV_ICON[item.to] ?? House;
            return (
              <li key={item.key}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  onMouseEnter={() => prefetchRoute(item.to)}
                  onFocus={() => prefetchRoute(item.to)}
                  className={({ isActive }) =>
                    cn(
                      "flex h-8 items-center gap-2.5 rounded-control px-2.5 text-[0.8125rem] font-medium",
                      "transition-colors duration-[120ms] ease-out",
                      isActive
                        ? "bg-bg-inset text-fg"
                        : "text-muted hover:bg-bg-subtle hover:text-fg",
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Glyph
                        weight={isActive ? "fill" : "regular"}
                        className={cn("h-4 w-4 shrink-0", isActive ? "text-brand" : "text-subtle")}
                        aria-hidden
                      />
                      <span className="truncate">{t(item.key, { defaultValue: item.defaultLabel })}</span>
                    </>
                  )}
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="border-t border-border px-4 py-3">
        <p className="text-[0.6875rem] leading-4 text-subtle">{t("app.eduDisclaimer")}</p>
      </div>
    </aside>
  );
}
