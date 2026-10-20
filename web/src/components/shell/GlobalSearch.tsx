import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { CommandPalette, type Command } from "@/components/ehr/CommandPalette";
import { cn } from "@/lib/cn";
import { navItemsFor } from "@/lib/navigation";
import { useHotkeys } from "@/lib/useHotkeys";
import { useViewAs } from "@/lib/viewAs";

/**
 * GlobalSearch: the top-bar entry to the command palette (Stripe, Linear).
 * The palette lists every destination the current vantage can reach plus the
 * encounter, feedback and account routes. Ctrl or Cmd K opens it everywhere
 * except inside the encounter, which owns that shortcut for its chart palette.
 */
export function GlobalSearch({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { role } = useViewAs();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const inEncounter = location.pathname.startsWith("/encounter");

  useHotkeys(
    [
      {
        combo: "mod+k",
        whenTyping: true,
        handler: (e) => {
          e.preventDefault();
          setOpen((o) => !o);
        },
      },
    ],
    !inEncounter,
  );

  const commands = useMemo<Command[]>(() => {
    const section = t("commandPalette.sectionNav", { defaultValue: "Navigate" });
    const extra = [
      { to: "/encounter", key: "nav.encounter" },
      { to: "/feedback", key: "nav.feedback" },
      { to: "/account", key: "nav.account" },
    ];
    const seen = new Set<string>();
    const all = [...navItemsFor(role), ...extra].filter((i) => {
      if (seen.has(i.to)) return false;
      seen.add(i.to);
      return true;
    });
    return all.map((item) => {
      const label = t(item.key, { defaultValue: "defaultLabel" in item ? item.defaultLabel : undefined });
      return {
        id: `go:${item.to}`,
        label,
        section,
        keywords: `go open ${item.to} ${label}`,
        run: () => navigate(item.to),
      };
    });
  }, [role, t, navigate]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("nav.search", { defaultValue: "Search" })}
        className={cn(
          "inline-flex h-8 items-center gap-2 rounded-control border border-border bg-bg-subtle px-2.5",
          "text-[0.8125rem] text-muted transition-colors duration-[120ms] hover:border-border-strong hover:text-fg",
          className,
        )}
      >
        <MagnifyingGlass weight="bold" className="h-4 w-4" aria-hidden />
        <span className="hidden md:inline">{t("nav.search", { defaultValue: "Search" })}</span>
        <kbd className="ms-1 hidden rounded-chip border border-border bg-surface px-1 font-mono text-[0.625rem] text-subtle md:inline">
          {"⌘"}K
        </kbd>
      </button>
      <CommandPalette open={open} onClose={() => setOpen(false)} commands={commands} />
    </>
  );
}
