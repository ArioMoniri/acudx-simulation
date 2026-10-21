import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { ArrowRight, Translate } from "@phosphor-icons/react";

import { PageContainer, PageHeader, Wordmark } from "@/components/shell";
import { SimBadge } from "@/components/ehr";
import { Button, SectionLabel } from "@/components/ui";
import { useLang } from "@/lib/useLang";
import { useReveal } from "@/lib/motion";
import { useTheme } from "@/lib/theme";
import {
  CoreLoop,
  SupportingRail,
  CredibilityStrip,
  HeroMark,
  LaunchTeaser,
} from "@/components/landing";

/** Real captures of the encounter workspace (web/public/media/screens). */
const HERO_SHOT = {
  light: "/media/screens/encounter-1280-light.png",
  dark: "/media/screens/encounter-1280-dark.png",
};

/**
 * LandingPage: the one marketing surface, as an editorial page rather than a
 * template. A left-aligned hero (display headline, one lede, one primary
 * action) next to a real capture of the encounter workspace; a plain sources
 * line; the loop as a numbered list; the platform as a hairline list; one
 * closing line. No tinted tiles, no gradients, no closing band.
 */
export function LandingPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const { theme } = useTheme();

  const hero = useReveal();
  const media = useReveal(0.04);
  const rest = useReveal(0.06);

  return (
    <PageContainer width="wide" className="flex flex-col gap-12 sm:gap-16">
      {/* Hero: text left, the product on the right */}
      <section className="grid items-center gap-8 pt-2 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12 lg:pt-6">
        <motion.div {...hero}>
          <div className="flex flex-wrap items-center gap-3">
            <Wordmark size="lg" mark={<HeroMark />} />
            <SimBadge variant="chip" />
          </div>

          <PageHeader
            tone="marketing"
            className="mt-6"
            eyebrow={t("landing2.hero.eyebrow")}
            title={t("renewal2.landing.title")}
            description={t("renewal2.landing.subtitle")}
          />

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Button asChild size="lg" trailingIcon={<ArrowRight weight="bold" className="h-4 w-4" />}>
              <Link to="/start">{t("landing.hero.primaryCta")}</Link>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <Link to="/feedback">{t("landing.hero.secondaryCta")}</Link>
            </Button>
          </div>

          <p className="mt-4 inline-flex items-center gap-2 text-[0.8125rem] text-muted">
            <Translate weight="bold" className="h-4 w-4" aria-hidden />
            {t("landing.hero.bilingualNote")}
          </p>
        </motion.div>

        <motion.figure {...media} className="m-0 min-w-0">
          <div className="overflow-hidden rounded-[6px] border border-ink-border bg-ink p-1.5 sm:p-2">
            <img
              src={theme === "dark" ? HERO_SHOT.dark : HERO_SHOT.light}
              width={1280}
              height={800}
              alt={t("landing3.hero.shotAlt", {
                defaultValue: "The encounter workspace: patient banner, storyboard rail and the chart tabs",
              })}
              className="block h-auto w-full rounded-[3px]"
              loading="eager"
              decoding="async"
            />
          </div>
          <figcaption className="mt-2 font-mono text-[0.6875rem] text-subtle">
            {t("landing3.hero.shotCaption", {
              defaultValue: "Encounter workspace, 1280 px, synthetic patient",
            })}
          </figcaption>
        </motion.figure>
      </section>

      <motion.div {...rest} className="flex flex-col gap-12 sm:gap-16">
        {/* Sources line */}
        <CredibilityStrip />

        {/* The loop: numbered list */}
        <section aria-labelledby="landing-loop" className="grid gap-6 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-12">
          <div>
            <SectionLabel>{t("landing2.loop.eyebrow")}</SectionLabel>
            <h2 id="landing-loop" className="mt-2 text-2xl text-fg sm:text-[2rem]">
              {t("landing2.loop.heading")}
            </h2>
            <p className="mt-2 max-w-md text-[0.9375rem] text-muted">{t("landing2.loop.sub")}</p>
          </div>
          <CoreLoop />
        </section>

        {/* Teaser film */}
        <LaunchTeaser />

        {/* Platform: hairline list */}
        <section aria-labelledby="landing-platform" className="grid gap-6 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-12">
          <div>
            <SectionLabel>{t("landing2.platform.eyebrow")}</SectionLabel>
            <h2 id="landing-platform" className="mt-2 text-2xl text-fg sm:text-[2rem]">
              {t("landing2.platform.heading")}
            </h2>
            <p className="mt-2 max-w-md text-[0.9375rem] text-muted">{t("landing2.platform.sub")}</p>
          </div>
          <SupportingRail />
        </section>

        {/* Closing line */}
        <section className="flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl text-fg">{t("landing.closing.heading")}</h2>
            <p className="mt-1 max-w-2xl text-[0.8125rem] text-muted">{t("landing.closing.body")}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-3">
            <Button asChild variant="secondary" trailingIcon={<ArrowRight weight="bold" className="h-4 w-4" />}>
              <Link to="/start">{t("landing.closing.primaryCta")}</Link>
            </Button>
            <span className="hidden text-xs text-subtle sm:inline">
              {t("landing.closing.note", { lang: lang.toUpperCase() })}
            </span>
          </div>
        </section>
      </motion.div>
    </PageContainer>
  );
}
