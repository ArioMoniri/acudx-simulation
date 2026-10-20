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
 * SideNav: the ink navigation rail on lg and up (v4 "Ward ink"). 232 px,
 * always dark in both themes: the Pulse seal lockup at the top, role-scoped
 * items from lib/navigation as 36 px rows, the active row marked by a lighter
 * ink fill and a 2 px cobalt bar on its leading edge. The ink scope re-points
 * the semantic tokens so focus rings and text stay AA on the dark ground.
 */
export function SideNav({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { role } = useViewAs();
  const items = navItemsFor(role);

  return (
    <aside
      className={cn(
        "ink-scope sticky top-0 hidden h-dvh w-[232px] shrink-0 flex-col border-e border-ink-border bg-ink lg:flex",
        className,
      )}
    >
      <div className="flex h-14 items-center px-5">
        <NavLink to="/" aria-label={t("app.name")} className="rounded-control">
          <Wordmark size="md" />
        </NavLink>
      </div>
      <nav aria-label={t("nav.primary", { defaultValue: "Primary" })} className="flex-1 overflow-y-auto px-3 pb-3 pt-2">
        <ul className="flex flex-col gap-0.5">
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
                      "relative flex h-9 items-center gap-3 rounded-control px-3 text-[0.8125rem] font-medium",
                      "transition-colors duration-[120ms] ease-out",
                      isActive
                        ? "bg-ink-3 text-ink-fg before:absolute before:inset-y-2 before:start-0 before:w-0.5 before:rounded-full before:bg-ink-accent"
                        : "text-ink-muted hover:bg-ink-2 hover:text-ink-fg",
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Glyph
                        weight={isActive ? "fill" : "regular"}
                        className={cn("h-[1.05rem] w-[1.05rem] shrink-0", isActive ? "text-ink-accent" : "text-ink-muted")}
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
      <div className="border-t border-ink-border px-5 py-4">
        <p className="text-[0.6875rem] leading-4 text-ink-muted">{t("app.eduDisclaimer")}</p>
      </div>
    </aside>
  );
}
