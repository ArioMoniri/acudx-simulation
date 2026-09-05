import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { ArrowRight, Translate, Footprints } from "@phosphor-icons/react";

import { PageContainer, PageHeader, Wordmark } from "@/components/shell";
import { SimBadge } from "@/components/ehr";
import { Button, Card, SectionLabel } from "@/components/ui";
import { useLang } from "@/lib/useLang";
import { useReveal } from "@/lib/motion";
import {
  VitalsMonitorTile,
  CoreLoop,
  SupportingRail,
  CredibilityStrip,
} from "@/components/landing";

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * LandingPage — the ONE marketing surface (docs/design/01 Screen 1.1), rebuilt
 * as a clinical-instrument editorial page rather than a template feature grid.
 *
 * An asymmetric hero pairs a tight value proposition (PageHeader, marketing
 * tone) with a REAL artifact — a compact vitals monitor on the always-dark
 * `--monitor-*` palette — so the product shows itself instead of being blurbed.
 * A monochrome credibility strip cites the guideline bodies; the core learner
 * loop is a single dominant stepper; the surrounding platform is a compact
 * hairline-divided rail (not equal cards); a calm band closes with one CTA.
 *
 * One saturated primary button (the hero's "Enter the demo"); every other CTA
 * is secondary or a quiet link. Restrained, reduced-motion-safe entrances. Light
 * default and dark. Nothing here is real patient data; every case is synthetic
 * and for education only.
 */
export function LandingPage() {
  const { t } = useTranslation();
  const lang = useLang();

  const hero = useReveal();
  const heroArtifact = useReveal(0.08);
  const cred = useReveal(0.04);
  const loopHead = useReveal();
  const platformHead = useReveal();
  const closing = useReveal(0.04);

  return (
    <PageContainer width="wide" className="flex flex-col gap-16 sm:gap-20">
      {/* Hero — asymmetric editorial split */}
      <section className="grid items-center gap-10 pt-2 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14 lg:pt-6">
        <motion.div {...hero}>
          <div className="flex flex-wrap items-center gap-3">
            <Wordmark />
            <SimBadge variant="chip" />
          </div>

          <PageHeader
            tone="marketing"
            className="mt-7"
            eyebrow={t("landing2.hero.eyebrow")}
            title={t("landing.hero.title")}
            description={t("landing.hero.subtitle")}
          />

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button
              asChild
              size="lg"
              trailingIcon={<ArrowRight weight="bold" className="h-4 w-4" />}
            >
              <Link to="/start">{t("landing.hero.primaryCta")}</Link>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <Link to="/feedback">{t("landing.hero.secondaryCta")}</Link>
            </Button>
          </div>

          <p className="mt-5 inline-flex items-center gap-2 text-sm text-muted">
            <Translate weight="bold" className="h-4 w-4" aria-hidden />
            {t("landing.hero.bilingualNote")}
          </p>
        </motion.div>

        {/* Right column — a genuine instrument readout, not a fake screenshot */}
        <motion.div {...heroArtifact} className="lg:ps-2">
          <VitalsMonitorTile className="mx-auto w-full max-w-sm lg:max-w-none" />
        </motion.div>
      </section>

      {/* Credibility strip — monochrome, sourced */}
      <motion.div {...cred}>
        <CredibilityStrip />
      </motion.div>

      {/* Core loop — the dominant stepper */}
      <section aria-labelledby="landing-loop">
        <motion.div {...loopHead} className="max-w-2xl">
          <SectionLabel>{t("landing2.loop.eyebrow")}</SectionLabel>
          <h2
            id="landing-loop"
            className="mt-2 text-2xl font-semibold tracking-tight text-fg sm:text-3xl"
          >
            {t("landing2.loop.heading")}
          </h2>
          <p className="mt-2 text-base text-muted">{t("landing2.loop.sub")}</p>
        </motion.div>
        <div className="mt-6">
          <CoreLoop />
        </div>
      </section>

      {/* Platform — asymmetric 2-col: lead heading + compact hairline rail */}
      <section
        aria-labelledby="landing-platform"
        className="grid gap-8 lg:grid-cols-[0.82fr_1.18fr] lg:gap-14"
      >
        <motion.div {...platformHead} className="lg:pt-1">
          <SectionLabel>{t("landing2.platform.eyebrow")}</SectionLabel>
          <h2
            id="landing-platform"
            className="mt-2 text-2xl font-semibold tracking-tight text-fg sm:text-3xl"
          >
            {t("landing2.platform.heading")}
          </h2>
          <p className="mt-3 max-w-md text-base text-muted">
            {t("landing2.platform.sub")}
          </p>
        </motion.div>
        <SupportingRail />
      </section>

      {/* Closing band — one calm CTA */}
      <motion.section {...closing}>
        <Card variant="inset" padding="lg" className="flex flex-col gap-5">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-control bg-brand-tint text-brand">
              <Footprints weight="bold" className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-fg">
                {t("landing.closing.heading")}
              </h2>
              <p className="mt-1.5 max-w-2xl text-sm text-muted">
                {t("landing.closing.body")}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              asChild
              variant="secondary"
              trailingIcon={<ArrowRight weight="bold" className="h-4 w-4" />}
            >
              <Link to="/start">{t("landing.closing.primaryCta")}</Link>
            </Button>
            <span className="ms-auto hidden text-xs text-muted sm:inline">
              {t("landing.closing.note", { lang: lang.toUpperCase() })}
            </span>
          </div>
        </Card>
      </motion.section>
    </PageContainer>
  );
}
