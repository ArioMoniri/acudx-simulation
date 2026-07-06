import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { SUPPORTED_LANGUAGES, type Language } from "@/i18n";

/**
 * LanguageSwitcher — compact EN/TR segmented control.
 * Persists via i18next language-detector (localStorage) and updates <html lang>.
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { i18n, t } = useTranslation();
  const current = (i18n.resolvedLanguage ?? "en").split("-")[0] as Language;

  return (
    <div
      role="group"
      aria-label={t("language.label")}
      className={cn(
        "inline-flex items-center rounded-control border border-border bg-bg-subtle p-0.5",
        className,
      )}
    >
      {SUPPORTED_LANGUAGES.map((lng) => {
        const active = current === lng;
        return (
          <button
            key={lng}
            type="button"
            onClick={() => void i18n.changeLanguage(lng)}
            aria-pressed={active}
            aria-label={t("language.switchTo", { lang: t(`language.${lng}`) })}
            className={cn(
              "min-h-8 rounded-[7px] px-2.5 text-xs font-semibold uppercase",
              "transition-colors duration-200 ease-out focus-visible:outline-none",
              active
                ? "bg-surface text-fg shadow-soft"
                : "text-muted hover:text-fg",
            )}
          >
            {lng}
          </button>
        );
      })}
    </div>
  );
}
