import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import {
  User,
  UsersThree,
  Eye,
  Stethoscope,
  FirstAid,
  Ambulance,
  ClipboardText,
  Shuffle,
  Heartbeat,
  Brain,
  Flask,
  Wind,
  ArrowRight,
  Check,
  Info,
  Lightbulb,
  Translate,
  type Icon,
} from "@phosphor-icons/react";

import { PageContainer } from "@/components/shell";
import { Button, Card, Badge, Switch } from "@/components/ui";
import { LanguageSwitcher } from "@/components/shell";
import { useEntry, useLang } from "@/lib/useLang";
import { cn } from "@/lib/cn";
import {
  MODE_OPTIONS,
  ROLE_OPTIONS,
  CHIEF_COMPLAINT_OPTIONS,
  DIFFICULTY_LABELS,
  type SessionMode,
  type EncounterRole,
} from "@/data/startOptions";
import type { ChiefComplaintFamily } from "@/domain/caseGen";

/* -------------------------------------------------------------------------- */
/* Icon registries (data holds names; the page owns the components)            */
/* -------------------------------------------------------------------------- */

const MODE_ICON: Record<string, Icon> = { User, UsersThree, Eye };
const ROLE_ICON: Record<string, Icon> = {
  Stethoscope,
  FirstAid,
  Ambulance,
  ClipboardText,
};
const CC_ICON: Record<string, Icon> = {
  Shuffle,
  Heartbeat,
  Brain,
  Flask,
  Wind,
};

/** Constraints handed to the encounter workspace via router state. */
export interface StartSelection {
  mode: SessionMode;
  role: EncounterRole;
  chiefComplaint: ChiefComplaintFamily | null;
  difficulty: 1 | 2 | 3 | 4 | 5;
  guidance: boolean;
}

/* -------------------------------------------------------------------------- */
/* Selectable card                                                             */
/* -------------------------------------------------------------------------- */

function ChoiceCard({
  icon: IconCmp,
  title,
  body,
  selected,
  disabled,
  badge,
  onSelect,
  ariaLabel,
}: {
  icon: Icon;
  title: string;
  body: string;
  selected: boolean;
  disabled?: boolean;
  badge?: string;
  onSelect: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "group relative flex min-h-24 w-full flex-col gap-1.5 rounded-card border p-4 text-left",
        "transition-[background-color,border-color,box-shadow] duration-200 ease-out",
        "focus-visible:outline-none",
        disabled
          ? "cursor-not-allowed border-border bg-bg-subtle opacity-70"
          : selected
            ? "border-brand bg-brand-tint shadow-soft"
            : "border-border bg-surface hover:border-brand/40 hover:bg-bg-subtle",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-control transition-colors duration-200",
            selected
              ? "bg-brand text-white"
              : "bg-brand-tint text-brand group-hover:bg-brand/15",
          )}
        >
          <IconCmp weight="bold" className="h-5 w-5" aria-hidden />
        </span>
        {selected ? (
          <span
            className="grid h-5 w-5 place-items-center rounded-full bg-brand text-white"
            aria-hidden
          >
            <Check weight="bold" className="h-3 w-3" />
          </span>
        ) : badge ? (
          <Badge tone="neutral">{badge}</Badge>
        ) : null}
      </div>
      <span className="text-sm font-semibold text-fg">{title}</span>
      <span className="text-xs leading-relaxed text-muted">{body}</span>
    </button>
  );
}

function SectionHeading({
  step,
  title,
  hint,
}: {
  step: number;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex items-baseline gap-2.5">
      <span
        className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-tint font-mono text-xs font-semibold text-brand"
        aria-hidden
      >
        {step}
      </span>
      <div>
        <h2 className="text-base font-semibold tracking-tight text-fg">
          {title}
        </h2>
        <p className="text-sm text-muted">{hint}</p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * StartPage — the onboarding / session setup (docs/design/01 Journey 1.3-1.5).
 * Choose the session mode, the participant role, a chief complaint (or a random
 * draw), the difficulty, and whether guidance starts on; then begin the
 * encounter. The chosen constraints ride to /encounter via router state and the
 * workspace generates a matching case (or the curated seed for a random draw).
 */
export function StartPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const header = useEntry();
  const s1 = useEntry(0.05);
  const s2 = useEntry(0.09);
  const s3 = useEntry(0.13);
  const s4 = useEntry(0.17);
  const footer = useEntry(0.21);

  // A "?mode=multiplayer" deep-link (from the Rooms nav) preselects the mode if
  // it is available; otherwise it falls back to the solo default.
  const initialMode: SessionMode = useMemo(() => {
    const q = params.get("mode");
    const match = MODE_OPTIONS.find((m) => m.id === q && m.available);
    return match ? match.id : "solo";
  }, [params]);

  const [mode, setMode] = useState<SessionMode>(initialMode);
  const [role, setRole] = useState<EncounterRole>("doctor");
  const [chiefComplaint, setChiefComplaint] = useState<
    ChiefComplaintFamily | null
  >(null);
  const [difficulty, setDifficulty] = useState<1 | 2 | 3 | 4 | 5>(3);
  const [guidance, setGuidance] = useState(true);

  const difficultyLabel = DIFFICULTY_LABELS[difficulty][lang];

  function begin() {
    const selection: StartSelection = {
      mode,
      role,
      chiefComplaint,
      difficulty,
      guidance,
    };
    navigate("/encounter", { state: { start: selection } });
  }

  return (
    <PageContainer className="flex flex-col gap-9">
      {/* Header */}
      <motion.header {...header} className="max-w-3xl">
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
          <span className="gradient-mark h-1.5 w-1.5 rounded-full" aria-hidden />
          {t("start.eyebrow")}
        </span>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
          {t("start.title")}
        </h1>
        <p className="mt-3 max-w-2xl text-lg text-muted">{t("start.subtitle")}</p>
      </motion.header>

      {/* Step 1 — Mode */}
      <motion.section
        {...s1}
        aria-labelledby="start-mode-heading"
        className="flex flex-col gap-4"
      >
        <SectionHeading
          step={1}
          title={t("start.mode.heading")}
          hint={t("start.mode.hint")}
        />
        <div
          role="radiogroup"
          aria-label={t("start.mode.heading")}
          className="grid gap-3 sm:grid-cols-3"
        >
          {MODE_OPTIONS.map((m) => (
            <ChoiceCard
              key={m.id}
              icon={MODE_ICON[m.icon]}
              title={m.label[lang]}
              body={m.description[lang]}
              selected={mode === m.id}
              disabled={!m.available}
              badge={m.badge?.[lang]}
              onSelect={() => m.available && setMode(m.id)}
              ariaLabel={m.label[lang]}
            />
          ))}
        </div>
      </motion.section>

      {/* Step 2 — Role */}
      <motion.section
        {...s2}
        aria-labelledby="start-role-heading"
        className="flex flex-col gap-4"
      >
        <SectionHeading
          step={2}
          title={t("start.role.heading")}
          hint={t("start.role.hint")}
        />
        <div
          role="radiogroup"
          aria-label={t("start.role.heading")}
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        >
          {ROLE_OPTIONS.map((r) => (
            <ChoiceCard
              key={r.id}
              icon={ROLE_ICON[r.icon]}
              title={r.label[lang]}
              body={r.scope[lang]}
              selected={role === r.id}
              disabled={!r.available}
              badge={r.badge?.[lang]}
              onSelect={() => r.available && setRole(r.id)}
              ariaLabel={r.label[lang]}
            />
          ))}
        </div>
      </motion.section>

      {/* Step 3 — Chief complaint */}
      <motion.section
        {...s3}
        aria-labelledby="start-cc-heading"
        className="flex flex-col gap-4"
      >
        <SectionHeading
          step={3}
          title={t("start.complaint.heading")}
          hint={t("start.complaint.hint")}
        />
        <div
          role="radiogroup"
          aria-label={t("start.complaint.heading")}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        >
          {CHIEF_COMPLAINT_OPTIONS.map((c) => {
            const key = c.id ?? "random";
            const selected = chiefComplaint === c.id;
            return (
              <ChoiceCard
                key={key}
                icon={CC_ICON[c.icon]}
                title={c.label[lang]}
                body={c.hint[lang]}
                selected={selected}
                onSelect={() => setChiefComplaint(c.id)}
                ariaLabel={c.label[lang]}
              />
            );
          })}
        </div>
      </motion.section>

      {/* Step 4 — Difficulty + language + guidance */}
      <motion.section
        {...s4}
        aria-labelledby="start-tune-heading"
        className="flex flex-col gap-4"
      >
        <SectionHeading
          step={4}
          title={t("start.tune.heading")}
          hint={t("start.tune.hint")}
        />
        <div className="grid gap-4 lg:grid-cols-[1fr_minmax(0,320px)]">
          {/* Difficulty dial */}
          <Card padding="lg" className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <label
                htmlFor="start-difficulty"
                className="text-sm font-medium text-fg"
              >
                {t("start.difficulty.label")}
              </label>
              <span className="inline-flex items-center gap-2">
                <span className="font-mono text-sm font-semibold text-fg">
                  {difficulty}
                </span>
                <Badge tone="brand">{difficultyLabel}</Badge>
              </span>
            </div>
            <input
              id="start-difficulty"
              type="range"
              min={1}
              max={5}
              step={1}
              value={difficulty}
              onChange={(e) =>
                setDifficulty(Number(e.target.value) as 1 | 2 | 3 | 4 | 5)
              }
              aria-valuetext={t("start.difficulty.valueText", {
                level: difficulty,
                label: difficultyLabel,
              })}
              className="w-full accent-[color:var(--brand-600)]"
            />
            <div className="flex justify-between text-[11px] text-muted">
              <span>{DIFFICULTY_LABELS[1][lang]}</span>
              <span>{DIFFICULTY_LABELS[5][lang]}</span>
            </div>
            <p className="mt-1 flex items-start gap-1.5 text-xs text-muted">
              <Info weight="bold" className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {t("start.difficulty.forgiveness")}
            </p>
          </Card>

          {/* Language + guidance */}
          <div className="flex flex-col gap-3">
            <Card padding="md" className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2.5">
                <span className="grid h-9 w-9 place-items-center rounded-control bg-brand-tint text-brand">
                  <Translate weight="bold" className="h-4.5 w-4.5" aria-hidden />
                </span>
                <span>
                  <span className="block text-sm font-medium text-fg">
                    {t("start.language.label")}
                  </span>
                  <span className="block text-xs text-muted">
                    {t("start.language.hint")}
                  </span>
                </span>
              </span>
              <LanguageSwitcher />
            </Card>

            <Card padding="md" className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2.5">
                <span className="grid h-9 w-9 place-items-center rounded-control bg-brand-tint text-brand">
                  <Lightbulb weight="bold" className="h-4.5 w-4.5" aria-hidden />
                </span>
                <span>
                  <label
                    htmlFor="start-guidance"
                    className="block text-sm font-medium text-fg"
                  >
                    {t("start.guidance.label")}
                  </label>
                  <span className="block text-xs text-muted">
                    {t("start.guidance.hint")}
                  </span>
                </span>
              </span>
              <Switch
                id="start-guidance"
                checked={guidance}
                onCheckedChange={setGuidance}
                aria-label={t("start.guidance.label")}
              />
            </Card>
          </div>
        </div>
      </motion.section>

      {/* Begin */}
      <motion.section
        {...footer}
        className="flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between"
      >
        <p className="text-sm text-muted">
          {t("start.summary", {
            role: ROLE_OPTIONS.find((r) => r.id === role)?.label[lang] ?? "",
            complaint:
              CHIEF_COMPLAINT_OPTIONS.find((c) => c.id === chiefComplaint)
                ?.label[lang] ?? CHIEF_COMPLAINT_OPTIONS[0].label[lang],
            difficulty: difficultyLabel,
          })}
        </p>
        <Button
          size="lg"
          onClick={begin}
          trailingIcon={<ArrowRight weight="bold" className="h-4 w-4" />}
        >
          {t("start.begin")}
        </Button>
      </motion.section>

      <p className="text-xs text-muted">{t("start.eduNote")}</p>
    </PageContainer>
  );
}
