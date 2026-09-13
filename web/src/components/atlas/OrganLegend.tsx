import { useTranslation } from "react-i18next";
import { Eye, EyeSlash } from "@phosphor-icons/react";

import { cn } from "@/lib/cn";
import { Card, SectionLabel } from "@/components/ui";
import type { AtlasOrgan } from "@/data/anatomyAtlas";

export interface OrganLegendProps {
  organs: readonly AtlasOrgan[];
  /** Organ ids whose overlay is switched on. */
  visibleOrgans: ReadonlySet<string>;
  /** Organ ids that actually appear on the slice currently on screen. */
  presentOrganIds: ReadonlySet<string>;
  /** Organ highlighted right now (hover or sticky selection). */
  activeOrgan: string | null;
  /** The sticky selection (drives the pressed state). */
  selectedOrgan: string | null;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  onShowAll: () => void;
  onHideAll: () => void;
  className?: string;
}

/**
 * OrganLegend — the color-keyed checklist beside the viewer. Each row toggles
 * that organ's overlay (a real checkbox, tinted in the organ's color) and, via
 * its label button, highlights the organ across the viewer. Organs that are not
 * on the current slice are dimmed so the learner can see, at a glance, what this
 * particular cut actually contains.
 */
export function OrganLegend({
  organs,
  visibleOrgans,
  presentOrganIds,
  activeOrgan,
  selectedOrgan,
  onToggle,
  onSelect,
  onHover,
  onShowAll,
  onHideAll,
  className,
}: OrganLegendProps) {
  const { t } = useTranslation();
  const presentCount = organs.filter((o) => presentOrganIds.has(o.id)).length;

  return (
    <Card padding="sm" className={cn("flex flex-col gap-3", className)}>
      <SectionLabel
        trailing={
          <span className="font-mono text-[11px] tabular-nums text-subtle">
            {t("atlas.legend.onSlice", {
              defaultValue: "{{count}} of {{total}} on slice",
              count: presentCount,
              total: organs.length,
            })}
          </span>
        }
      >
        {t("atlas.legend.title", { defaultValue: "Organs" })}
      </SectionLabel>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onShowAll}
          className="inline-flex items-center gap-1 rounded-control px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-bg-subtle hover:text-fg focus-visible:outline-none"
        >
          <Eye className="h-3.5 w-3.5" aria-hidden />
          {t("atlas.legend.showAll", { defaultValue: "Show all" })}
        </button>
        <button
          type="button"
          onClick={onHideAll}
          className="inline-flex items-center gap-1 rounded-control px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-bg-subtle hover:text-fg focus-visible:outline-none"
        >
          <EyeSlash className="h-3.5 w-3.5" aria-hidden />
          {t("atlas.legend.hideAll", { defaultValue: "Hide all" })}
        </button>
      </div>

      <ul className="flex flex-col gap-0.5">
        {organs.map((organ) => {
          const label = t(organ.labelKey, { defaultValue: organ.label });
          const visible = visibleOrgans.has(organ.id);
          const present = presentOrganIds.has(organ.id);
          const isActive = activeOrgan === organ.id;
          const selected = selectedOrgan === organ.id;
          return (
            <li key={organ.id}>
              <div
                className={cn(
                  "flex items-center gap-2 rounded-control px-2 py-1 transition-colors",
                  isActive ? "bg-brand-tint" : "hover:bg-bg-subtle",
                  !present && "opacity-45",
                )}
              >
                <input
                  type="checkbox"
                  checked={visible}
                  onChange={() => onToggle(organ.id)}
                  aria-label={t("atlas.legend.toggle", {
                    defaultValue: "Show {{organ}} overlay",
                    organ: label,
                  })}
                  className="h-4 w-4 shrink-0 cursor-pointer rounded focus-visible:outline-none"
                  style={{ accentColor: organ.color }}
                />
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onSelect(organ.id)}
                  onMouseEnter={() => onHover(organ.id)}
                  onMouseLeave={() => onHover(null)}
                  onFocus={() => onHover(organ.id)}
                  onBlur={() => onHover(null)}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-chip py-0.5 text-left focus-visible:outline-none"
                >
                  <span
                    aria-hidden
                    className="h-3 w-3 shrink-0 rounded-[3px] ring-1 ring-inset ring-black/15"
                    style={{ backgroundColor: organ.color }}
                  />
                  <span
                    className={cn(
                      "truncate text-sm",
                      isActive || selected
                        ? "font-medium text-fg"
                        : "text-muted",
                    )}
                  >
                    {label}
                  </span>
                  {present ? (
                    <span
                      aria-hidden
                      className="ms-auto h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--state-normal)]"
                    />
                  ) : null}
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="text-[11px] leading-snug text-subtle">
        {t("atlas.legend.hint", {
          defaultValue:
            "A green dot marks organs visible on the current slice. Tick to overlay; click a name to highlight it.",
        })}
      </p>
    </Card>
  );
}
