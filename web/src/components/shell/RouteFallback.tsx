import { useTranslation } from "react-i18next";

import { PageContainer } from "@/components/shell/PageContainer";
import { Skeleton } from "@/components/ui";
import { cn } from "@/lib/cn";

/**
 * RouteFallback — themed Suspense fallback for lazily-loaded route pages.
 *
 * Renders a layout-shaped skeleton inside the standard PageContainer so the
 * chrome never shifts when a chunk finishes loading. The Skeleton primitive
 * already collapses its shimmer to a static tint under `prefers-reduced-motion`,
 * so this stays reduced-motion safe with no extra work.
 *
 * Accessibility: the region is a polite live status with `aria-busy`, and a
 * visually-hidden label announces the load to assistive tech while the visual
 * placeholders are hidden from it (`aria-hidden` on the shaped blocks).
 */
export function RouteFallback() {
  const { t } = useTranslation();

  return (
    <PageContainer
      role="status"
      aria-busy="true"
      aria-live="polite"
      data-testid="route-fallback"
    >
      <span className="sr-only">{t("routeFallback.loading")}</span>

      <div aria-hidden="true">
        {/* Header block: eyebrow, title, supporting line */}
        <div className="space-y-3">
          <Skeleton className="h-4 w-28 rounded-control" />
          <Skeleton className="h-9 w-2/3 max-w-md rounded-control" />
          <Skeleton className="h-4 w-full max-w-xl rounded-control" />
        </div>

        {/* Content grid: card-shaped surfaces matching the medkit language */}
        <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <RouteFallbackCard key={i} />
          ))}
        </div>
      </div>
    </PageContainer>
  );
}

/** A single card-shaped placeholder surface. */
function RouteFallbackCard({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-card border border-border bg-surface p-5 shadow-soft",
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-control" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-2/3 rounded-control" />
          <Skeleton className="h-3 w-1/3 rounded-control" />
        </div>
      </div>
      <div className="mt-5 space-y-2.5">
        <Skeleton className="h-3 w-full rounded-control" />
        <Skeleton className="h-3 w-11/12 rounded-control" />
        <Skeleton className="h-3 w-4/5 rounded-control" />
      </div>
    </div>
  );
}

export default RouteFallback;
