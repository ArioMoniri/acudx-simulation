import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { GithubLogo, SpeakerSlash } from "@phosphor-icons/react";

import { Card, SectionLabel } from "@/components/ui";
import { cn } from "@/lib/cn";

/** Rendered by video/ (Remotion) and copied into web/public/media. */
const TEASER_SRC = "/media/teaser.mp4";
const POSTER_SRC = "/media/launch-poster.png";
const REPO_URL = "https://github.com/ArioMoniri/acudx-simulation";

/**
 * LaunchTeaser: the ten-second film as an optional inline video.
 *
 * - Lazy: the <video> (and its poster request) is only mounted once the
 *   section scrolls near the viewport, so the landing page's first paint
 *   carries no media bytes. `preload="none"` keeps it to the poster until
 *   the person presses play.
 * - Native controls, no autoplay, no sound track (the film is silent and
 *   carries its captions in the frame, in EN and TR).
 */
export function LaunchTeaser({ className }: { className?: string }) {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el || near) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: "320px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  return (
    <section aria-labelledby="landing-film" className={cn("grid gap-6 lg:grid-cols-[0.82fr_1.18fr] lg:gap-14", className)}>
      <div className="lg:pt-1">
        <SectionLabel>{t("landing3.film.eyebrow")}</SectionLabel>
        <h2 id="landing-film" className="mt-2 text-[1.75rem] text-fg sm:text-3xl">
          {t("landing3.film.heading")}
        </h2>
        <p className="mt-3 max-w-md text-base text-muted">{t("landing3.film.sub")}</p>
        <p className="mt-4 inline-flex items-center gap-2 text-sm text-muted">
          <SpeakerSlash weight="bold" className="h-4 w-4 shrink-0" aria-hidden />
          {t("landing3.film.muteNote")}
        </p>
        <a
          href={REPO_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-4 inline-flex min-h-9 items-center gap-2 rounded-control text-sm font-medium text-brand underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <GithubLogo weight="bold" className="h-4 w-4" aria-hidden />
          {t("landing3.film.repo")}
        </a>
      </div>

      <Card padding="none" variant="inset" className="overflow-hidden">
        <div ref={host} className="aspect-video w-full bg-bg-subtle">
          {near ? (
            <video
              className="block h-full w-full object-cover"
              controls
              playsInline
              preload="none"
              poster={POSTER_SRC}
              aria-label={t("landing3.film.label")}
              width={1920}
              height={1080}
            >
              <source src={TEASER_SRC} type="video/mp4" />
              {t("landing3.film.unsupported")}
            </video>
          ) : (
            <span className="sr-only">{t("landing3.film.posterAlt")}</span>
          )}
        </div>
      </Card>
    </section>
  );
}
