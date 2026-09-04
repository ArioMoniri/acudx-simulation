import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import {
  Sparkle,
  UsersThree,
  ChartLineUp,
  Buildings,
  ShieldCheck,
  CaretRight,
  type Icon,
} from "@phosphor-icons/react";

import { cn } from "@/lib/cn";
import { useStagger } from "@/lib/motion";

interface RailItem {
  key: "cases" | "rooms" | "progress" | "institution" | "sovereign";
  icon: Icon;
  to: string;
}

/** The platform story that surrounds the learner loop, each opening a screen. */
const ITEMS: readonly RailItem[] = [
  { key: "cases", icon: Sparkle, to: "/cases" },
  { key: "rooms", icon: UsersThree, to: "/rooms" },
  { key: "progress", icon: ChartLineUp, to: "/progress" },
  { key: "institution", icon: Buildings, to: "/institution" },
  { key: "sovereign", icon: ShieldCheck, to: "/authoring" },
];

/**
 * SupportingRail — the secondary "beyond the encounter" points as a compact,
 * hairline-divided list (deliberately not an equal-card grid). Each row is a
 * quiet link into the live demo, with a muted icon, a title, a one-line body,
 * and a trailing caret that nudges on hover.
 */
export function SupportingRail({ className }: { className?: string }) {
  const { t } = useTranslation();
  const stagger = useStagger();

  return (
    <motion.ul
      {...stagger.container}
      className={cn(
        "divide-y divide-border border-y border-border",
        className,
      )}
    >
      {ITEMS.map((item) => {
        const ItemIcon = item.icon;
        return (
          <motion.li key={item.key} {...stagger.item}>
            <Link
              to={item.to}
              className={cn(
                "group flex items-center gap-4 py-4",
                "transition-colors duration-200 ease-out hover:bg-bg-subtle",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                "-mx-2 rounded-control px-2",
              )}
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-control border border-border bg-surface text-muted transition-colors group-hover:text-brand">
                <ItemIcon weight="bold" className="h-4 w-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold tracking-tight text-fg">
                  {t(`landing2.platform.items.${item.key}.title`)}
                </span>
                <span className="mt-0.5 block text-sm leading-relaxed text-muted">
                  {t(`landing2.platform.items.${item.key}.body`)}
                </span>
              </span>
              <CaretRight
                weight="bold"
                className="h-4 w-4 shrink-0 text-subtle transition-transform duration-200 ease-out group-hover:translate-x-0.5 group-hover:text-brand"
                aria-hidden
              />
            </Link>
          </motion.li>
        );
      })}
    </motion.ul>
  );
}
