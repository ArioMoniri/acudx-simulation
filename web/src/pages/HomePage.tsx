import { useCallback, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import {
  ArrowRight,
  ArrowUpRight,
  ArrowsClockwise,
  Fire,
  Target,
  Trophy,
} from "@phosphor-icons/react";

import { PageContainer, PageHeader } from "@/components/shell";
import { useDisplayName } from "@/state/profileStore";
import {
  Button,
  Card,
  SectionLabel,
  Stat,
  type StatTrend,
} from "@/components/ui";
import { CalibrationPlot } from "@/components";
import { CaseListRow } from "@/components/home/CaseListRow";
import { ActivityRow } from "@/components/home/ActivityRow";
import {
  difficultyToTier,
  recommendedCases,
  type Band,
  type DashboardStat,
  type FeedbackDomainKey,
  type Lang,
  type RecommendedCase,
} from "@/data/mock";
import {
  useCalibrationPoints,
  useCalibrationTrajectory,
  useDashboardStats,
  useMasteryDomains,
  useRecentActivity,
} from "@/state/progressStore";
import type { MasteryDomain } from "@/data/progress";
import {
  generateCase,
  CHIEF_COMPLAINT_FAMILIES,
  type ChiefComplaintFamily,
} from "@/domain/caseGen";
import type { CaseInstance } from "@/domain/case";
import {
  SPECIALTY_LABELS,
  specialtyOf,
  guidelineTagOf,
  languagesOf,
  estMinutesOf,
} from "@/data/caseLibrary";
import { useLang } from "@/lib/useLang";
import { useReveal, useStagger } from "@/lib/motion";

const statIcon: Record<DashboardStat["key"], typeof Trophy> = {
  completed: Trophy,
  streak: Fire,
  gap: Target,
};

/* -------------------------------------------------------------------------- */
/* Recommended rail — a fresh, personalized, non-repeating draw                */
/* -------------------------------------------------------------------------- */

/** How many fresh cases the rail shows. */
const RECOMMENDED_COUNT = 4;

// Every family the generator supports, so the recommended rail can draw across
// the whole catalogue (not just the original four).
const ALL_FAMILIES: ChiefComplaintFamily[] = CHIEF_COMPLAINT_FAMILIES.map(
  (f) => f.id,
);

/** Band → "how much this domain needs work" (lower band = weaker = pulled harder). */
const BAND_WEAKNESS: Record<Band, number> = {
  emerging: 5,
  developing: 4,
  proficient: 3,
  strong: 2,
  exemplary: 1,
  withheld: 0, // not enough evidence → contributes no personalization signal
};

const BAND_ORDER: Exclude<Band, "withheld">[] = [
  "emerging",
  "developing",
  "proficient",
  "strong",
  "exemplary",
];

/**
 * Which chief-complaint families most exercise each competency domain, so a weak
 * domain pulls in more of the cases that train it. professionalism is never
 * scored by an encounter, so it never actually contributes.
 */
const DOMAIN_FAMILIES: Record<FeedbackDomainKey, ChiefComplaintFamily[]> = {
  history: ["abdominal-pain", "headache"],
  exam: ["abdominal-pain", "dyspnea"],
  reasoning: ["chest-pain", "headache"],
  communication: ["headache", "chest-pain"],
  management: ["chest-pain", "dyspnea"],
  professionalism: ["abdominal-pain", "dyspnea"],
};

/** One rail entry: the display row + the live case to hand off (null = fallback). */
interface RecommendedRow {
  row: RecommendedCase;
  instance: CaseInstance | null;
}

/**
 * Per-family draw weights from real mastery. Every family starts at 1 (so the
 * set always spreads), and each scored-but-weak domain adds weight to the
 * families that train it. With no history all families stay at 1 → an even
 * spread.
 */
function familyWeights(mastery: MasteryDomain[]): Map<ChiefComplaintFamily, number> {
  const weights = new Map<ChiefComplaintFamily, number>(
    ALL_FAMILIES.map((f) => [f, 1]),
  );
  for (const m of mastery) {
    if (m.evidenceCount === 0) continue;
    const weak = BAND_WEAKNESS[m.band];
    if (weak <= 0) continue;
    for (const fam of DOMAIN_FAMILIES[m.key]) {
      weights.set(fam, (weights.get(fam) ?? 1) + weak);
    }
  }
  return weights;
}

/**
 * A focus difficulty from overall mastery: a struggling learner gets gentler
 * reps to rebuild weak areas, a strong one gets a stretch. No history → core.
 */
function focusDifficulty(mastery: MasteryDomain[]): 1 | 2 | 3 | 4 | 5 {
  const scored = mastery.filter(
    (m) => m.evidenceCount > 0 && m.band !== "withheld",
  );
  if (scored.length === 0) return 3;
  const meanBand =
    scored.reduce((sum, m) => sum + BAND_ORDER.indexOf(m.band as Exclude<Band, "withheld">), 0) /
    scored.length; // 0 (all emerging) .. 4 (all exemplary)
  if (meanBand < 1) return 2;
  if (meanBand < 2.5) return 3;
  return 4;
}

/** Draw N families, weighted, decaying each pick so the set spreads out. */
function drawFamilies(
  weights: Map<ChiefComplaintFamily, number>,
  n: number,
): ChiefComplaintFamily[] {
  const pool = new Map(weights);
  const out: ChiefComplaintFamily[] = [];
  for (let i = 0; i < n; i++) {
    const entries = [...pool.entries()];
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let r = Math.random() * total;
    let chosen = entries[0][0];
    for (const [fam, w] of entries) {
      r -= w;
      if (r <= 0) {
        chosen = fam;
        break;
      }
    }
    out.push(chosen);
    pool.set(chosen, (pool.get(chosen) ?? 1) * 0.35);
  }
  return out;
}

/** Nudge the difficulty ±1 around the focus so the rail is not monotone. */
function jitterDifficulty(base: 1 | 2 | 3 | 4 | 5): 1 | 2 | 3 | 4 | 5 {
  const delta = Math.floor(Math.random() * 3) - 1; // -1, 0, +1
  return Math.min(5, Math.max(1, base + delta)) as 1 | 2 | 3 | 4 | 5;
}

/** Map a generated CaseInstance onto the row shape the rail renders. */
function toRow(c: CaseInstance): RecommendedCase {
  const female = c.patient.gender === "female";
  return {
    id: c.id,
    // Title is the presenting complaint; the sub-line carries the specialty so
    // the two lines never read as the same text.
    title: c.chiefComplaint,
    chiefComplaint: SPECIALTY_LABELS[specialtyOf(c)],
    setting: { en: "Emergency", tr: "Acil" },
    ageSex: {
      en: `${c.patient.ageYears}${female ? "F" : "M"}`,
      tr: `${c.patient.ageYears}${female ? "K" : "E"}`,
    },
    difficulty: difficultyToTier(c.difficulty),
    guidelineTag: guidelineTagOf(c),
    estMinutes: estMinutesOf(c),
    languages: languagesOf(c),
  };
}

/**
 * Build the fresh rail: draw weighted families, generate a constrained case for
 * each, and map it to a row. On any generator failure fall back to the tiny
 * static list (which navigates to the default encounter, no live instance).
 */
function buildRecommended(mastery: MasteryDomain[], locale: Lang): RecommendedRow[] {
  try {
    const weights = familyWeights(mastery);
    const base = focusDifficulty(mastery);
    return drawFamilies(weights, RECOMMENDED_COUNT).map((chiefComplaint) => {
      const instance = generateCase({
        seedMode: "constrained",
        chiefComplaint,
        difficulty: jitterDifficulty(base),
        locale,
      });
      return { row: toRow(instance), instance };
    });
  } catch {
    return recommendedCases.map((row) => ({ row, instance: null }));
  }
}

/** HomePage — the learner's clinical instrument panel. */
export function HomePage() {
  const { t } = useTranslation();
  const lang = useLang();
  const navigate = useNavigate();
  const displayName = useDisplayName();
  // Real, earned session data (empty for a new user → honest empty states).
  const calibrationPoints = useCalibrationPoints();
  const calibrationTrajectory = useCalibrationTrajectory();
  const dashboardStats = useDashboardStats();
  const recentFeedback = useRecentActivity();
  // Mastery drives the weighted draw; the nonce lets "Show different cases"
  // regenerate a brand-new, non-repeating set on demand.
  const mastery = useMasteryDomains();
  const [refreshNonce, setRefreshNonce] = useState(0);
  const recommended = useMemo(
    () => buildRecommended(mastery, lang),
    // `refreshNonce` is a deliberate regenerate trigger; `mastery` is a stable
    // reference until real records change (progressStore caches it).
    [mastery, lang, refreshNonce],
  );
  const showDifferent = useCallback(() => setRefreshNonce((n) => n + 1), []);
  const openCase = useCallback(
    (instance: CaseInstance) => {
      // Hand THIS generated case to the workspace exactly like the Case Library.
      navigate("/encounter", { state: { caseInstance: instance } });
    },
    [navigate],
  );
  const header = useReveal();
  const strip = useReveal(0.06);
  const body = useReveal(0.12);
  const cases = useStagger();
  const recent = useStagger();

  return (
    <PageContainer width="wide" className="flex flex-col gap-6">
      {/* Zone 1 — greeting, the single primary action, and the term readout. */}
      <motion.div {...header}>
        <PageHeader
          eyebrow={t("home.greetingEyebrow")}
          title={
            displayName
              ? t("home.welcomeNamed", {
                  name: displayName,
                  defaultValue: "Welcome back, {{name}}",
                })
              : t("home.welcome")
          }
          description={t("home.welcomeSub")}
          actions={
            <Button
              asChild
              size="md"
              trailingIcon={<ArrowRight weight="bold" className="h-4 w-4" />}
            >
              <Link to="/encounter">{t("home.primaryCta")}</Link>
            </Button>
          }
          meta={
            <span className="hidden text-xs text-subtle sm:inline">
              {t("home.noPublicLeaderboard")}
            </span>
          }
        />
      </motion.div>

      <motion.section {...strip} aria-label={t("home.statsHeading")}>
        <SectionLabel className="mb-2">{t("home.statsHeading")}</SectionLabel>
        <Card padding="none" className="overflow-hidden">
          <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {dashboardStats.map((s) => {
              const Icon = statIcon[s.key];
              const trend: StatTrend | undefined = s.trend
                ? {
                    value: t(
                      s.trend === "up"
                        ? "stats.trendingUp"
                        : "stats.trendingDown",
                    ),
                    dir: s.trend,
                    goodUp: s.upIsGood,
                  }
                : undefined;
              return (
                <div key={s.key} className="px-4 py-3">
                  <Stat
                    size="md"
                    label={t(`stats.${s.key}`)}
                    value={s.value}
                    icon={<Icon weight="bold" className="h-3.5 w-3.5" />}
                    hint={s.caption[lang]}
                    trend={trend}
                  />
                </div>
              );
            })}
          </div>
        </Card>
      </motion.section>

      {/* Zone 2 — asymmetric body: recommended work (wide) + snapshot feed. */}
      <motion.div
        {...body}
        className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]"
      >
        {/* LEFT — recommended cases as an information-hierarchy list. */}
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2 border-b border-border pb-2">
            <div>
              <h2 className="text-[0.9375rem] font-semibold tracking-tight text-fg">
                {t("home.recommendedHeading")}
              </h2>
              <p className="mt-0.5 text-xs text-muted">
                {t("home.recommendedSub")}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <button
                type="button"
                onClick={showDifferent}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-fg"
              >
                <ArrowsClockwise
                  weight="bold"
                  className="h-3.5 w-3.5"
                  aria-hidden
                />
                {t("home.showDifferent", { defaultValue: "Show different cases" })}
              </button>
              <Link
                to="/cases"
                className="text-xs font-medium text-brand hover:underline"
              >
                {t("home.viewAllCases")}
              </Link>
            </div>
          </div>
          <motion.ul {...cases.container} className="-mt-2 divide-y divide-border rounded-card border border-border bg-surface">
            {recommended.map(({ row, instance }) => (
              <motion.li
                key={row.id}
                {...cases.item}
                onClickCapture={
                  instance
                    ? (e) => {
                        // Plain left-click hands the generated instance to the
                        // encounter via router state (a bare <Link> cannot carry
                        // it). Modifier / middle clicks fall through to the Link.
                        if (
                          e.defaultPrevented ||
                          e.button !== 0 ||
                          e.metaKey ||
                          e.ctrlKey ||
                          e.shiftKey ||
                          e.altKey
                        ) {
                          return;
                        }
                        e.preventDefault();
                        openCase(instance);
                      }
                    : undefined
                }
              >
                <CaseListRow data={row} lang={lang} />
              </motion.li>
            ))}
          </motion.ul>
        </section>

        {/* RIGHT — calibration snapshot + recent-feedback activity feed. */}
        <aside className="flex flex-col gap-6">
          <section>
            <Card padding="md">
              <h2 className="text-[0.8125rem] font-semibold tracking-tight text-fg">
                {t("home.snapshotHeading")}
              </h2>
              <p className="mt-0.5 text-xs text-muted">
                {calibrationPoints.length > 0
                  ? t("home.snapshotSub")
                  : t("home.snapshotEmpty")}
              </p>
              <div className="mt-4">
                <CalibrationPlot
                  points={calibrationPoints}
                  trajectory={calibrationTrajectory}
                  lang={lang}
                  small
                />
              </div>
              <Link
                to="/feedback"
                className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
              >
                {t("calibration.title")}
                <ArrowUpRight weight="bold" className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </Card>
          </section>

          <section>
            <Card padding="none" className="overflow-hidden">
              <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
                <h2 className="text-[0.8125rem] font-semibold tracking-tight text-fg">
                  {t("home.recentHeading")}
                </h2>
                <Link
                  to="/feedback"
                  className="text-xs font-medium text-brand hover:underline"
                >
                  {t("recentFeedback.open")}
                </Link>
              </div>
              {recentFeedback.length > 0 ? (
                <motion.ul
                  {...recent.container}
                  className="divide-y divide-border"
                >
                  {recentFeedback.map((item) => (
                    <motion.li key={item.id} {...recent.item}>
                      <ActivityRow item={item} lang={lang} />
                    </motion.li>
                  ))}
                </motion.ul>
              ) : (
                <div className="px-4 py-6 text-center">
                  <p className="text-[0.8125rem] font-medium text-fg">
                    {t("home.empty.feedbackTitle")}
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    {t("home.empty.feedbackBody")}
                  </p>
                </div>
              )}
            </Card>
          </section>
        </aside>
      </motion.div>
    </PageContainer>
  );
}
