import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import {
  ArrowRight,
  ChatCircleText,
  Sparkle,
  Lightbulb,
  Target,
  UsersThree,
  ChartLineUp,
  Buildings,
  ShieldCheck,
  CheckCircle,
  Translate,
  Footprints,
  type Icon,
} from "@phosphor-icons/react";

import { PageContainer } from "@/components/shell";
import { Wordmark } from "@/components/shell";
import { SimBadge } from "@/components/ehr";
import { Button, Card } from "@/components/ui";
import { useEntry, useLang } from "@/lib/useLang";
import { cn } from "@/lib/cn";
import { landingPhases, landingTrust, type LandingPhase } from "@/data/landing";

/* -------------------------------------------------------------------------- */
/* Icon resolution                                                             */
/* -------------------------------------------------------------------------- */

const phaseIcon: Record<LandingPhase["icon"], Icon> = {
  chat: ChatCircleText,
  generate: Sparkle,
  guidance: Lightbulb,
  calibration: Target,
  multiplayer: UsersThree,
  progress: ChartLineUp,
  institution: Buildings,
  sovereign: ShieldCheck,
};

/* -------------------------------------------------------------------------- */
/* Phase card                                                                  */
/* -------------------------------------------------------------------------- */

function PhaseCard({ phase, delay }: { phase: LandingPhase; delay: number }) {
  const { t } = useTranslation();
  const entry = useEntry(delay);
  const Icon = phaseIcon[phase.icon];

  return (
    <motion.div {...entry} className="flex">
      <Link
        to={phase.to}
        className={cn(
          "group flex w-full flex-col gap-3 rounded-card border border-border bg-surface p-5 shadow-soft",
          "transition-colors duration-200 ease-out hover:bg-bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
        )}
      >
        <div className="flex items-center justify-between">
          <span className="grid h-10 w-10 place-items-center rounded-control bg-brand-tint text-brand">
            <Icon weight="bold" className="h-5 w-5" aria-hidden />
          </span>
          <ArrowRight
            weight="bold"
            className="h-4 w-4 text-muted transition-transform duration-200 ease-out group-hover:translate-x-0.5"
            aria-hidden
          />
        </div>
        <div>
          <h3 className="text-base font-semibold tracking-tight text-fg">
            {t(`landing.phases.${phase.key}.title`)}
          </h3>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            {t(`landing.phases.${phase.key}.body`)}
          </p>
        </div>
        <span className="mt-auto inline-flex items-center gap-1 text-sm font-medium text-brand">
          {t(`landing.phases.${phase.key}.link`)}
        </span>
      </Link>
    </motion.div>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * LandingPage — the product overview / demo entry (docs/design/01 Screen 1.1).
 *
 * The ONE marketing-styled surface, still medkit / clinical and premium-
 * restrained. An asymmetric hero that fits the viewport (value prop + a single
 * "Enter the demo" CTA into /start), a muted trust strip under it, the AcuDx
 * phases as a card grid that each link into the live demo screen, and a compact
 * "walk every phase" band. Light default + dark, one blue accent, restrained
 * motion honoring reduced-motion, zero em-dash. Nothing here is real patient
 * data; every case is synthetic and for education only.
 */
export function LandingPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const hero = useEntry();
  const trust = useEntry(0.08);
  const phasesHead = useEntry(0.04);
  const closing = useEntry(0.06);

  const trustIcon: Record<(typeof landingTrust)[number], Icon> = {
    formative: CheckCircle,
    synthetic: ShieldCheck,
    cited: Target,
    accessible: CheckCircle,
    bilingual: Translate,
  };

  return (
    <PageContainer width="wide" className="flex flex-col gap-14 sm:gap-16">
      {/* Hero — asymmetric split, fits the viewport */}
      <section className="grid items-center gap-8 pt-2 lg:grid-cols-[1.1fr_0.9fr] lg:gap-12 lg:pt-6">
        <motion.div {...hero}>
          <div className="flex flex-wrap items-center gap-3">
            <Wordmark />
            <SimBadge variant="chip" />
          </div>
          <h1 className="mt-6 text-4xl font-semibold leading-[1.08] tracking-tight text-fg sm:text-5xl">
            {t("landing.hero.title")}
          </h1>
          <p className="mt-4 max-w-xl text-lg leading-relaxed text-muted">
            {t("landing.hero.subtitle")}
          </p>
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

        {/* Hero panel — a calm clinical mark, not a fake screenshot */}
        <motion.div
          {...trust}
          className="relative hidden lg:block"
          aria-hidden="true"
        >
          <div className="gradient-frame rounded-card p-[1.5px] shadow-soft-md">
            <div className="flex flex-col gap-4 rounded-[calc(var(--r-card)-1.5px)] bg-surface p-6">
              <div className="flex items-center gap-2 text-brand">
                <span className="grid h-9 w-9 place-items-center rounded-control bg-brand-tint">
                  <ChatCircleText weight="bold" className="h-5 w-5" />
                </span>
                <span className="text-sm font-semibold text-fg">
                  {t("landing.hero.panelTitle")}
                </span>
              </div>
              <div className="flex flex-col gap-3">
                {(["chat", "generate", "calibration"] as const).map((k) => {
                  const Icon = phaseIcon[k];
                  return (
                    <div
                      key={k}
                      className="flex items-center gap-3 rounded-control border border-border bg-bg-subtle px-3 py-2.5"
                    >
                      <Icon
                        weight="bold"
                        className="h-4 w-4 shrink-0 text-brand"
                      />
                      <span className="text-sm text-fg">
                        {t(`landing.hero.panelRow.${k}`)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </motion.div>
      </section>

      {/* Trust strip — under the hero, muted */}
      <motion.ul
        {...trust}
        aria-label={t("landing.trust.label")}
        className="flex flex-wrap items-center gap-x-5 gap-y-2 border-y border-border py-4"
      >
        {landingTrust.map((k) => {
          const Icon = trustIcon[k];
          return (
            <li
              key={k}
              className="inline-flex items-center gap-1.5 text-sm text-muted"
            >
              <Icon
                weight="bold"
                className="h-4 w-4 shrink-0 text-[color:var(--state-normal)]"
                aria-hidden
              />
              {t(`landing.trust.${k}`)}
            </li>
          );
        })}
      </motion.ul>

      {/* Phases */}
      <section aria-labelledby="landing-phases">
        <motion.div {...phasesHead} className="max-w-2xl">
          <h2
            id="landing-phases"
            className="text-2xl font-semibold tracking-tight text-fg sm:text-3xl"
          >
            {t("landing.phases.heading")}
          </h2>
          <p className="mt-2 text-base text-muted">
            {t("landing.phases.headingSub")}
          </p>
        </motion.div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {landingPhases.map((p, i) => (
            <PhaseCard key={p.id} phase={p} delay={0.03 * i} />
          ))}
        </div>
      </section>

      {/* Closing band — walk the demo */}
      <motion.section {...closing}>
        <Card padding="lg" className="flex flex-col gap-5 bg-bg-subtle">
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
              trailingIcon={<ArrowRight weight="bold" className="h-4 w-4" />}
            >
              <Link to="/start">{t("landing.closing.primaryCta")}</Link>
            </Button>
            <Button asChild variant="ghost">
              <Link to="/authoring">{t("landing.closing.educatorCta")}</Link>
            </Button>
            <span className="ml-auto hidden text-xs text-muted sm:inline">
              {t("landing.closing.note", { lang: lang.toUpperCase() })}
            </span>
          </div>
        </Card>
      </motion.section>
    </PageContainer>
  );
}
