import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Stethoscope, BookOpen } from "@phosphor-icons/react";

import { EncounterChat } from "@/components/EncounterChat";
import { GuidanceCard } from "@/components/GuidanceCard";
import { Switch } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  askQuestion,
  requestExam,
  useEncounterState,
} from "@/state/encounterStore";
import type { QuestionIntent, ExamManeuver, CaseInstance } from "@/domain/case";
import type { Lang, TranscriptTurn } from "@/data/mock";
import { guidanceHints } from "@/data/mock";

export interface InterviewTabProps {
  caseInstance: CaseInstance;
  lang: Lang;
  affectLabel: string;
  guidanceOn: boolean;
  onGuidanceChange: (on: boolean) => void;
}

/** Question-intent chips offered to the student (history extraction). */
const QUESTION_INTENTS: QuestionIntent[] = [
  "onset",
  "location",
  "character",
  "radiation",
  "severity",
  "timing",
  "aggravating",
  "relieving",
  "associated-symptoms",
  "red-flags",
  "past-medical-history",
  "medications",
  "allergies",
  "family-history",
  "social-history",
  "risk-factors",
  "ice",
];

/** Exam maneuver chips (exam extraction). */
const EXAM_MANEUVERS: ExamManeuver[] = [
  "general-inspection",
  "vitals-recheck",
  "cardiovascular",
  "respiratory",
  "abdominal",
  "neurological",
  "musculoskeletal",
  "skin",
  "ent",
  "focused-special",
];

function camel(s: string): string {
  return s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * InterviewTab — where history + exam are EXTRACTED (docs §2.2). The student
 * drives the dynamic patient dialogue with question-intent chips (askQuestion)
 * and requests exam maneuvers (requestExam); both reveal ground-truth data via
 * the store's reveal graph, and NOTHING is shown until obtained. A cited
 * GuidanceCard appears when the Guidance toggle is on (Socratic hints).
 */
export function InterviewTab({
  caseInstance,
  lang,
  affectLabel,
  guidanceOn,
  onGuidanceChange,
}: InterviewTabProps) {
  const { t } = useTranslation();
  const state = useEncounterState();

  const [typing, setTyping] = useState(false);
  const typingTimer = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (typingTimer.current) window.clearTimeout(typingTimer.current);
    };
  }, []);

  // Build the conversational transcript from question events, in causal order.
  // Each answered question becomes a doctor turn (the intent) + patient turn
  // (the revealed answer). Only obtained data appears — progressive disclosure.
  const { turns, affectByTurn } = useMemo(() => {
    const historyById = new Map(
      caseInstance.groundTruth.history.map((h) => [h.id, h]),
    );
    const turnsAcc: TranscriptTurn[] = [];
    const affect: Record<string, string> = {};

    const questionEvents = [...state.events]
      .filter((e) => e.type === "question")
      .sort((a, b) => a.seq - b.seq);

    for (const ev of questionEvents) {
      const intentKey = t(`ehr.intents.${camel(ev.ref)}`, {
        defaultValue: ev.ref,
      });
      const docId = `d-${ev.seq}`;
      turnsAcc.push({
        id: docId,
        role: "doctor",
        stage: "history",
        en: intentKey,
        tr: intentKey,
      });

      const revealed = (ev.meta?.revealed as string[] | undefined) ?? [];
      const answers = revealed
        .map((id) => historyById.get(id))
        .filter((h): h is NonNullable<typeof h> => Boolean(h));

      if (answers.length > 0) {
        for (const a of answers) {
          const patId = `p-${ev.seq}-${a.id}`;
          turnsAcc.push({
            id: patId,
            role: "patient",
            stage: "history",
            en: a.answer.en,
            tr: a.answer.tr,
          });
          affect[patId] = affectLabel;
        }
      } else {
        // Off-target question: the patient cannot help with that here.
        const patId = `p-${ev.seq}-miss`;
        const miss = t("ehr.interview.noInfo");
        turnsAcc.push({
          id: patId,
          role: "patient",
          stage: "history",
          en: miss,
          tr: miss,
        });
        affect[patId] = affectLabel;
      }
    }
    return { turns: turnsAcc, affectByTurn: affect };
  }, [state.events, caseInstance.groundTruth.history, affectLabel, t]);

  // A cited Socratic hint for the interview step (reuses the existing hints).
  const activeHint =
    guidanceHints.find((h) => h.stage === "history") ?? guidanceHints[0];

  function handleAsk(intent: QuestionIntent) {
    askQuestion(intent);
    setTyping(true);
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => setTyping(false), 900);
  }

  const askedIntents = new Set(
    state.events
      .filter((e) => e.type === "question")
      .map((e) => e.ref),
  );
  const examinedManeuvers = new Set(
    state.events.filter((e) => e.type === "exam").map((e) => e.ref),
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_minmax(0,300px)]">
      {/* Dialogue column */}
      <div className="flex min-h-[420px] flex-col rounded-card border border-border bg-bg-subtle">
        {turns.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-8 text-center">
            <p className="max-w-xs text-sm text-muted">
              {t("ehr.interview.empty")}
            </p>
          </div>
        ) : (
          <EncounterChat
            turns={turns}
            lang={lang}
            patientTyping={typing}
            affectByTurn={affectByTurn}
            className="max-h-[46vh] flex-1 px-3 sm:px-4"
          />
        )}

        {/* Guidance toggle + cited hint */}
        <div className="border-t border-border p-3 sm:p-4">
          <label className="mb-2 inline-flex cursor-pointer items-center gap-2.5 rounded-full border border-border bg-surface px-3 py-1.5">
            <span className="text-sm font-medium text-fg">
              {t("encounter.guidance.toggle")}
            </span>
            <Switch
              checked={guidanceOn}
              onCheckedChange={onGuidanceChange}
              aria-label={t("encounter.guidance.toggle")}
            />
            <span className="text-xs text-muted">
              {t(guidanceOn ? "encounter.guidance.on" : "encounter.guidance.off")}
            </span>
          </label>

          {guidanceOn && activeHint ? (
            <GuidanceCard hint={activeHint} lang={lang} />
          ) : null}

          <p className="mt-2 flex items-center gap-1 text-[11px] text-muted">
            <BookOpen weight="bold" className="h-3 w-3" aria-hidden />
            {t("ehr.interview.extractionNote")}
          </p>
        </div>
      </div>

      {/* Ask / examine chips */}
      <div className="flex flex-col gap-4">
        <ChipPanel
          title={t("ehr.interview.askHeading")}
          hint={t("ehr.interview.askHint")}
        >
          {QUESTION_INTENTS.map((intent) => (
            <Chip
              key={intent}
              label={t(`ehr.intents.${camel(intent)}`)}
              active={askedIntents.has(intent)}
              onClick={() => handleAsk(intent)}
            />
          ))}
        </ChipPanel>

        <ChipPanel
          title={t("ehr.interview.examHeading")}
          hint={t("ehr.interview.examHint")}
          icon={<Stethoscope weight="bold" className="h-3.5 w-3.5" aria-hidden />}
        >
          {EXAM_MANEUVERS.map((m) => (
            <Chip
              key={m}
              label={t(`ehr.maneuvers.${camel(m)}`)}
              active={examinedManeuvers.has(m)}
              onClick={() => requestExam(m)}
            />
          ))}
        </ChipPanel>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Chip primitives                                                             */
/* -------------------------------------------------------------------------- */

function ChipPanel({
  title,
  hint,
  icon,
  children,
}: {
  title: string;
  hint: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-card border border-border bg-surface p-3">
      <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
        {icon}
        {title}
      </h3>
      <p className="mt-0.5 text-[11px] text-muted">{hint}</p>
      <div className="mt-2.5 flex flex-wrap gap-1.5">{children}</div>
    </section>
  );
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium",
        "transition-colors duration-200 ease-out focus-visible:outline-none active:scale-[0.98]",
        active
          ? "border-transparent bg-brand-tint text-brand"
          : "border-border bg-bg-subtle text-fg hover:bg-surface",
      )}
    >
      {active ? (
        <span aria-hidden className="text-brand">
          ✓
        </span>
      ) : null}
      {label}
    </button>
  );
}
