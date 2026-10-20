import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { TopNav } from "./TopNav";
import { SideNav } from "./SideNav";
import { BottomTabBar } from "./BottomTabBar";
import { TooltipProvider } from "@/components/ui";

/**
 * AppFrame: the app shell. A left rail on lg+, a compact top bar, the content
 * region on the app ground, a bottom tab bar below lg, and the persistent
 * education-only line (AI-Act / MDR education-side). No gradients, no blur.
 */
export function AppFrame({ children }: { children: ReactNode }) {
  const { t } = useTranslation();

  return (
    <TooltipProvider delayDuration={200}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-brand focus:px-4 focus:py-2 focus:text-on-brand"
      >
        {t("nav.skipToContent")}
      </a>

      <div className="flex min-h-dvh bg-bg-subtle">
        <SideNav />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopNav />
          <main id="main" className="flex-1 pb-14 lg:pb-0">
            {children}
          </main>
          <footer className="border-t border-border bg-surface px-4 py-2 sm:px-6 lg:hidden">
            <p className="text-center text-[0.6875rem] leading-4 text-subtle">{t("app.eduDisclaimer")}</p>
          </footer>
        </div>
      </div>
      <BottomTabBar />
    </TooltipProvider>
  );
}
