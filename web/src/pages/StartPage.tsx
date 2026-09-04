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
  Virus,
  Drop,
  Pulse,
  Warning,
  Baby,
  Bone,
  ChatCircle,
  ArrowRight,
  Check,
  Info,
  Lightbulb,
  Translate,
  type Icon,
} from "@phosphor-icons/react";

import { PageContainer, PageHeader, LanguageSwitcher } from "@/components/shell";
import {
  Button,
  Card,
  Badge,
  Switch,
  Divider,
  SectionLabel,
  DescriptionList,
  KeyValue,
} from "@/components/ui";
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
  Lungs: Wind, // no dedicated lungs glyph in this icon set
  Virus,
  Drop,
  Pulse,
  Warning,
  Baby,
  Bone,
  ChatCircle,
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
/* Selectable card — one radio, three densities so the steps never look alike  */
/* -------------------------------------------------------------------------- */

type ChoiceLayout = "stack" | "row" | "tile";

function SelectMark({
  selected,
  badge,
  size = "md",
}: {
  selected: boolean;
  badge?: string;
  size?: "sm" | "md";
}) {
  if (selected) {
    return (
      <span
        className={cn(
          "grid shrink-0 place-items-center rounded-full bg-brand text-white",
          size === "sm" ? "h-4 w-4" : "h-5 w-5",
        )}
        aria-hidden
      >
        <Check weight="bold" className={size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3"} />
      </span>
    );
  }
  if (badge) {
    return (
      <Badge tone="neutral" variant="outline" className="shrink-0">
        {badge}
      </Badge>
    );
  }
  return null;
}

function ChoiceCard({
  icon: IconCmp,
  title,
  body,
  selected,
  disabled,
  badge,
  onSelect,
  ariaLabel,
  layout,
}: {
  icon: Icon;
  title: string;
  body: string;
  selected: boolean;
  disabled?: boolean;
  badge?: string;
  onSelect: () => void;
  ariaLabel: string;
  layout: ChoiceLayout;
}) {
  const shell = cn(
    "group relative w-full rounded-card border text-left",
    "transition-[background-color,border-color] duration-150 ease-out",
    "focus-visible:outline-none",
    disabled
      ? "cursor-not-allowed border-border bg-bg-subtle opacity-70"
      : selected
        ? "border-brand bg-brand-tint"
        : "border-border bg-surface hover:border-border-strong hover:bg-bg-subtle",
  );

  const iconTone = selected ? "text-brand" : "text-subtle";

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        shell,
        layout === "stack" && "flex min-h-[7.75rem] flex-col gap-3 p-4",
        layout === "row" && "grid grid-cols-[auto_1fr_auto] items-start gap-3 p-3.5",
        layout === "tile" && "flex flex-col gap-1.5 p-3",
      )}
    >
      {layout === "stack" ? (
        <>
          <div className="flex items-start justify-between">
            <span
              className={cn(
                "grid h-10 w-10 place-items-center rounded-control border transition-colors duration-150",
                selected
                  ? "border-brand/40 bg-brand-tint text-brand"
                  : "border-border text-subtle group-hover:border-border-strong",
              )}
            >
              <IconCmp weight="bold" className="h-5 w-5" aria-hidden />
            </span>
            <SelectMark selected={selected} badge={badge} />
          </div>
          <div className="mt-auto flex flex-col gap-1">
            <span className="text-[0.9375rem] font-semibold text-fg">
              {title}
            </span>
            <span className="text-sm leading-relaxed text-muted">{body}</span>
          </div>
        </>
      ) : null}

      {layout === "row" ? (
        <>
          <IconCmp
            weight="bold"
            className={cn("mt-0.5 h-5 w-5 shrink-0", iconTone)}
            aria-hidden
          />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-semibold text-fg">{title}</span>
            <span className="text-xs leading-relaxed text-muted">{body}</span>
          </span>
          <SelectMark selected={selected} badge={badge} />
        </>
      ) : null}

      {layout === "tile" ? (
        <>
          <div className="flex items-center gap-2">
            <IconCmp
              weight="bold"
              className={cn("h-4 w-4 shrink-0", iconTone)}
              aria-hidden
            />
            <span className="text-sm font-semibold text-fg">{title}</span>
            <span className="ml-auto">
              <SelectMark selected={selected} badge={badge} size="sm" />
            </span>
          </div>
          <span className="text-xs leading-relaxed text-muted">{body}</span>
        </>
      ) : null}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Step heading — numbered step preserved, rendered through SectionLabel       */
/* -------------------------------------------------------------------------- */

function StepHeading({
  id,
  step,
  eyebrow,
  title,
  hint,
}: {
  id: string;
  step: number;
  eyebrow: string;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <SectionLabel>
        <span className="tnum text-brand">{String(step).padStart(2, "0")}</span>
        <span aria-hidden className="mx-1 text-border-strong">
          /
        </span>
        <span>{eyebrow}</span>
      </SectionLabel>
      <div>
        <h2 id={id} className="text-lg font-semibold tracking-tight text-fg">
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
 * Four numbered steps choose the session mode, the participant role, a chief
 * complaint (or a random draw), and the calibration (difficulty, language,
 * guidance). Each step is deliberately a different density — hero mode cards,
 * a compact role list, small presentation tiles, and a real control panel — so
 * the wizard never reads as four identical grids. The chosen constraints ride
 * to /encounter via router state; the workspace generates a matching case.
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
  const modeLabel = MODE_OPTIONS.find((m) => m.id === mode)?.label[lang] ?? "";
  const roleLabel = ROLE_OPTIONS.find((r) => r.id === role)?.label[lang] ?? "";
  const complaintLabel =
    CHIEF_COMPLAINT_OPTIONS.find((c) => c.id === chiefComplaint)?.label[lang] ??
    CHIEF_COMPLAINT_OPTIONS[0].label[lang];

  function begin() {
    // Multiplayer and Observe route into the real Rooms surface rather than a
    // dead card; the observer arrives with an intent the lobby can honour. Solo
    // keeps the direct encounter flow with the assembled constraints.
    if (mode === "multiplayer") {
      navigate("/rooms");
      return;
    }
    if (mode === "observe") {
      navigate("/rooms", { state: { intent: "observe" } });
      return;
    }
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
    <PageContainer className="flex flex-col gap-10">
      {/* Header */}
      <motion.div {...header}>
        <PageHeader
          eyebrow={t("start.eyebrow")}
          title={t("start.title")}
          description={t("start.subtitle")}
        />
      </motion.div>

      {/* Step 1 — Mode (hero cards) */}
      <motion.section
        {...s1}
        aria-labelledby="start-mode-heading"
        className="flex flex-col gap-4"
      >
        <StepHeading
          id="start-mode-heading"
          step={1}
          eyebrow={t("select2.start.mode.eyebrow")}
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
              layout="stack"
              icon={MODE_ICON[m.icon]}
              title={m.label[lang]}
              body={m.description[lang]}
              selected={mode === m.id}
              onSelect={() => setMode(m.id)}
              ariaLabel={m.label[lang]}
            />
          ))}
        </div>
      </motion.section>

      {/* Step 2 — Role (compact list) */}
      <motion.section
        {...s2}
        aria-labelledby="start-role-heading"
        className="flex flex-col gap-4"
      >
        <StepHeading
          id="start-role-heading"
          step={2}
          eyebrow={t("select2.start.role.eyebrow")}
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
              layout="row"
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

      {/* Step 3 — Chief complaint (small tiles) */}
      <motion.section
        {...s3}
        aria-labelledby="start-cc-heading"
        className="flex flex-col gap-4"
      >
        <StepHeading
          id="start-cc-heading"
          step={3}
          eyebrow={t("select2.start.complaint.eyebrow")}
          title={t("start.complaint.heading")}
          hint={t("start.complaint.hint")}
        />
        <div
          role="radiogroup"
          aria-label={t("start.complaint.heading")}
          className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3"
        >
          {CHIEF_COMPLAINT_OPTIONS.map((c) => {
            const key = c.id ?? "random";
            return (
              <ChoiceCard
                key={key}
                layout="tile"
                icon={CC_ICON[c.icon] ?? Stethoscope}
                title={c.label[lang]}
                body={c.hint[lang]}
                selected={chiefComplaint === c.id}
                onSelect={() => setChiefComplaint(c.id)}
                ariaLabel={c.label[lang]}
              />
            );
          })}
        </div>
      </motion.section>

      {/* Step 4 — Calibration (real controls + a structured summary) */}
      <motion.section
        {...s4}
        aria-labelledby="start-tune-heading"
        className="flex flex-col gap-4"
      >
        <StepHeading
          id="start-tune-heading"
          step={4}
          eyebrow={t("select2.start.tune.eyebrow")}
          title={t("start.tune.heading")}
          hint={t("start.tune.hint")}
        />
        <div className="grid gap-4 lg:grid-cols-[1.35fr_minmax(0,1fr)]">
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
                <span className="tnum font-mono text-sm font-semibold text-fg">
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
            <p className="mt-1 flex items-start gap-1.5 border-t border-border pt-3 text-xs text-muted">
              <Info
                weight="bold"
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-subtle"
                aria-hidden
              />
              {t("start.difficulty.forgiveness")}
            </p>
          </Card>

          {/* Language + guidance — real controls, no icon-chip squares */}
          <Card padding="md" className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-3 py-1.5">
              <span className="flex min-w-0 items-start gap-2">
                <Translate
                  weight="bold"
                  className="mt-0.5 h-4 w-4 shrink-0 text-subtle"
                  aria-hidden
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-fg">
                    {t("start.language.label")}
                  </span>
                  <span className="block text-xs text-muted">
                    {t("start.language.hint")}
                  </span>
                </span>
              </span>
              <LanguageSwitcher />
            </div>

            <Divider />

            <div className="flex items-center justify-between gap-3 py-1.5">
              <span className="flex min-w-0 items-start gap-2">
                <Lightbulb
                  weight="bold"
                  className="mt-0.5 h-4 w-4 shrink-0 text-subtle"
                  aria-hidden
                />
                <span className="min-w-0">
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
            </div>
          </Card>
        </div>

        {/* Structured recap of the assembled session */}
        <Card padding="md">
          <SectionLabel>{t("select2.start.review.eyebrow")}</SectionLabel>
          <DescriptionList divided className="mt-2">
            <KeyValue label={t("select2.start.review.mode")} value={modeLabel} />
            <KeyValue label={t("select2.start.review.role")} value={roleLabel} />
            <KeyValue
              label={t("select2.start.review.presentation")}
              value={complaintLabel}
            />
            <KeyValue
              label={t("start.difficulty.label")}
              value={`${difficulty} · ${difficultyLabel}`}
            />
            <KeyValue
              label={t("start.language.label")}
              value={t(`select2.start.lang.${lang}`)}
            />
            <KeyValue
              label={t("start.guidance.label")}
              value={
                guidance
                  ? t("select2.start.review.on")
                  : t("select2.start.review.off")
              }
            />
          </DescriptionList>
        </Card>
      </motion.section>

      {/* Begin */}
      <motion.section
        {...footer}
        className="flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between"
      >
        <p className="text-sm text-muted">
          {t("start.summary", {
            role: roleLabel,
            complaint: complaintLabel,
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
