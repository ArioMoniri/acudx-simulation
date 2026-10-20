import { useTranslation } from "react-i18next";
import { Sun, Moon } from "@phosphor-icons/react";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/cn";

/** ThemeToggle — icon button that flips light <-> dark and persists. */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const { t } = useTranslation();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? t("theme.toLight") : t("theme.toDark")}
      title={isDark ? t("theme.toLight") : t("theme.toDark")}
      className={cn(
        "grid h-8 w-8 place-items-center rounded-control border border-border",
        "bg-surface text-fg transition-colors duration-[120ms] ease-out",
        "hover:bg-bg-subtle",
        className,
      )}
    >
      {isDark ? (
        <Moon weight="bold" className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Sun weight="bold" className="h-4 w-4" aria-hidden="true" />
      )}
    </button>
  );
}
