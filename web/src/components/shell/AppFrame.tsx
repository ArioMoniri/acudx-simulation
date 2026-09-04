import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { TopNav } from "./TopNav";
import { TooltipProvider } from "@/components/ui";

/**
 * AppFrame — the app shell. A calm, full-bleed clinical surface: sticky
 * TopNav, the content region on the app ground, and a persistent
 * education-only disclaimer (AI-Act / MDR education-side). The former neon
 * teal->pink app border is gone; the single brand gradient now lives only on
 * the logo mark, so the chrome reads as software, not a marketing template.
 */
export function AppFrame({ children }: { children: ReactNode }) {
  const { t } = useTranslation();

  return (
    <TooltipProvider delayDuration={200}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-brand focus:px-4 focus:py-2 focus:text-white"
      >
        {t("nav.skipToContent")}
      </a>

      <div className="flex min-h-[100dvh] flex-col bg-bg-subtle">
        <TopNav />
        <main id="main" className="flex-1">
          {children}
        </main>
        <footer className="border-t border-border bg-surface px-4 py-3 sm:px-6">
          <p className="mx-auto max-w-7xl text-center text-xs text-muted">
            {t("app.eduDisclaimer")}
          </p>
        </footer>
      </div>
    </TooltipProvider>
  );
}
