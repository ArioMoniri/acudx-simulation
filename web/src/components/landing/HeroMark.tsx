import { lazy, Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AcuDxMark } from "@/components/shell";
import { cn } from "@/lib/cn";

/**
 * HeroMark: the animated brand moment in the landing hero.
 *
 * - `BrandLottie` (and lottie-web behind it) is code-split and mounted only
 *   once the browser is idle, so the hero headline paints first and the
 *   animation never competes with LCP. Until then the static inline mark
 *   occupies the exact same box, so nothing shifts.
 * - Reduced motion is honoured inside BrandLottie (static mark, no fetch).
 */
const BrandLottie = lazy(() =>
  import("@/components/shell/BrandLottie").then((m) => ({ default: m.BrandLottie })),
);

export function HeroMark({ className }: { className?: string }) {
  const { t } = useTranslation();
  const ready = useIdle();
  const box = cn("h-[1.15em] w-[1.15em] shrink-0 text-axis-clinical", className);
  const fallback = <AcuDxMark className={box} />;

  if (!ready) return fallback;
  return (
    <Suspense fallback={fallback}>
      <span className={cn("inline-grid place-items-center", box)}>
        <BrandLottie size={32} className="h-full w-full" title={t("landing3.hero.markTitle")} />
      </span>
    </Suspense>
  );
}

/** True once the main thread has gone idle after mount (two frames at worst). */
function useIdle(): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => setIdle(true), { timeout: 1200 });
      return () => w.cancelIdleCallback?.(id);
    }
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setIdle(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, []);
  return idle;
}
