import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ShieldCheck,
  Timer,
  EyeSlash,
  ClipboardText,
  ArrowRight,
} from "@phosphor-icons/react";

import { Card, Button, SectionLabel } from "@/components/ui";
import { cn } from "@/lib/cn";
import { CHIEF_COMPLAINT_FAMILIES, type ChiefComplaintFamily } from "@/domain/caseGen";
import {
  EXAM_LENGTH_CHOICES,
  EXAM_TIME_CHOICES,
  EXAM_MIX_FAMILIES,
  type ExamConfig,
} from "@/domain/summative";

export interface ExamIntroProps {
  /** Seed the form (defaults + resume of the last chosen config). */
  initial: ExamConfig;
  onBegin: (config: ExamConfig) => void;
  /** Whether the live model backend is reachable (shown as a source note). */
  backendAvailable: boolean;
  /** Count of previously completed attempts (for the reassurance line). */
  attemptsCount: number;
}

// Derived from the generator's canonical family list (English label as the
// fallback for the `exam.family.*` i18n keys), so all families are covered.
const FAMILY_LABEL: Record<ChiefComplaintFamily, string> = Object.fromEntries(
  CHIEF_COMPLAINT_FAMILIES.map((f) => [f.id, f.label.en]),
) as Record<ChiefComplaintFamily, string>;

/** One segmented option button (shared by the length + time pickers). */
function ChoiceButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "inline-flex min-h-9 items-center rounded-control border px-3.5 text-sm font-medium",
        "transition-colors duration-150 ease-out focus-visible:outline-none",
        selected
          ? "border-brand bg-brand-tint text-brand"
          : "border-border bg-surface text-muted hover:bg-bg-subtle hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

/**
 * ExamIntro — the pre-exam brief + setup. Explains that the run is proctored,
 * timed, and has guidance switched off, then lets the learner choose the number
 * of cases, the per-case time budget, and the case mix before beginning.
 */
export function ExamIntro({
  initial,
  onBegin,
  backendAvailable,
  attemptsCount,
}: ExamIntroProps) {
  const { t } = useTranslation();

  const [length, setLength] = useState<number>(initial.length);
  const [perCaseSeconds, setPerCaseSeconds] = useState<number>(initial.perCaseSeconds);
  const [families, setFamilies] = useState<ChiefComplaintFamily[]>(
    initial.mix === "random" ? [] : [...initial.mix],
  );

  const toggleFamily = (fam: ChiefComplaintFamily) => {
    setFamilies((prev) =>
      prev.includes(fam) ? prev.filter((f) => f !== fam) : [...prev, fam],
    );
  };

  const config = useMemo<ExamConfig>(
    () => ({
      length,
      perCaseSeconds,
      mix: families.length > 0 ? families : "random",
    }),
    [length, perCaseSeconds, families],
  );

  const rules = [
    {
      icon: <ShieldCheck weight="bold" className="h-5 w-5" aria-hidden="true" />,
      title: t("exam.intro.rule.proctored.title", { defaultValue: "Proctored, one pass" }),
      body: t("exam.intro.rule.proctored.body", {
        defaultValue: "You work each case once. There is no retry within a case.",
      }),
    },
    {
      icon: <Timer weight="bold" className="h-5 w-5" aria-hidden="true" />,
      title: t("exam.intro.rule.timed.title", { defaultValue: "Timed per case" }),
      body: t("exam.intro.rule.timed.body", {
        defaultValue: "A countdown runs on every case; it auto-submits at zero.",
      }),
    },
    {
      icon: <EyeSlash weight="bold" className="h-5 w-5" aria-hidden="true" />,
      title: t("exam.intro.rule.noGuidance.title", { defaultValue: "Guidance is off" }),
      body: t("exam.intro.rule.noGuidance.body", {
        defaultValue: "Real-time hints and attending tips are disabled throughout.",
      }),
    },
    {
      icon: <ClipboardText weight="bold" className="h-5 w-5" aria-hidden="true" />,
      title: t("exam.intro.rule.scored.title", { defaultValue: "Scored report" }),
      body: t("exam.intro.rule.scored.body", {
        defaultValue:
          "You get a competency report at the end, saved to this device.",
      }),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* What the exam is */}
      <Card padding="lg">
        <SectionLabel>
          {t("exam.intro.howItWorks", { defaultValue: "How the exam works" })}
        </SectionLabel>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {rules.map((r) => (
            <div key={r.title} className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-chip bg-brand-tint text-brand">
                {r.icon}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-fg">{r.title}</p>
                <p className="mt-0.5 text-sm text-muted">{r.body}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Setup */}
      <Card padding="lg" className="flex flex-col gap-6">
        {/* Length */}
        <div className="flex flex-col gap-2">
          <SectionLabel>
            {t("exam.intro.lengthLabel", { defaultValue: "Number of cases" })}
          </SectionLabel>
          <div className="flex flex-wrap gap-2">
            {EXAM_LENGTH_CHOICES.map((n) => (
              <ChoiceButton key={n} selected={length === n} onClick={() => setLength(n)}>
                {t("exam.intro.caseCount", { defaultValue: "{{n}} cases", n })}
              </ChoiceButton>
            ))}
          </div>
        </div>

        {/* Per-case time */}
        <div className="flex flex-col gap-2">
          <SectionLabel>
            {t("exam.intro.timeLabel", { defaultValue: "Time per case" })}
          </SectionLabel>
          <div className="flex flex-wrap gap-2">
            {EXAM_TIME_CHOICES.map((s) => (
              <ChoiceButton
                key={s}
                selected={perCaseSeconds === s}
                onClick={() => setPerCaseSeconds(s)}
              >
                {t("exam.intro.minutes", { defaultValue: "{{n}} min", n: s / 60 })}
              </ChoiceButton>
            ))}
          </div>
        </div>

        {/* Mix */}
        <div className="flex flex-col gap-2">
          <SectionLabel>
            {t("exam.intro.mixLabel", { defaultValue: "Case mix" })}
          </SectionLabel>
          <p className="text-sm text-muted">
            {t("exam.intro.mixHint", {
              defaultValue:
                "Leave every family off to draw across all systems, or pick specific ones.",
            })}
          </p>
          <div className="mt-1 flex flex-wrap gap-2">
            <ChoiceButton selected={families.length === 0} onClick={() => setFamilies([])}>
              {t("exam.intro.allSystems", { defaultValue: "All systems" })}
            </ChoiceButton>
            {EXAM_MIX_FAMILIES.map((fam) => (
              <ChoiceButton
                key={fam}
                selected={families.includes(fam)}
                onClick={() => toggleFamily(fam)}
              >
                {t(`exam.family.${fam}`, { defaultValue: FAMILY_LABEL[fam] })}
              </ChoiceButton>
            ))}
          </div>
        </div>

        {/* Begin */}
        <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted">
            {backendAvailable
              ? t("exam.intro.sourceLive", {
                  defaultValue: "Cases are generated live for this exam.",
                })
              : t("exam.intro.sourceLocal", {
                  defaultValue: "Cases are generated on-device for this exam.",
                })}
            {attemptsCount > 0
              ? " " +
                t("exam.intro.priorAttempts", {
                  defaultValue: "{{n}} attempt(s) already saved.",
                  n: attemptsCount,
                })
              : ""}
          </p>
          <Button
            size="lg"
            onClick={() => onBegin(config)}
            trailingIcon={<ArrowRight weight="bold" />}
          >
            {t("exam.intro.begin", { defaultValue: "Begin exam" })}
          </Button>
        </div>
      </Card>
    </div>
  );
}
