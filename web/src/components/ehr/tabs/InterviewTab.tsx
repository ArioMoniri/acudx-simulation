import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Stethoscope,
  BookOpen,
  PaperPlaneTilt,
  Compass,
  LockKey,
  ShieldWarning,
  Lifebuoy,
  Target,
  Broadcast,
  WifiSlash,
  X,
} from "@phosphor-icons/react";

import { EncounterChat } from "@/components/EncounterChat";
import { GuidanceCard } from "@/components/GuidanceCard";
import { Badge, Button, Switch } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  askQuestion,
  requestExam,
  logGuardOutcome,
  getOffTaskCount,
  useEncounterState,
} from "@/state/encounterStore";
import {
  classifyUtterance,
  inferQuestionIntent,
  type UtteranceClass,
} from "@/domain/scopeGuard";
import { expectedIntents } from "@/domain/case";
import type { QuestionIntent, ExamManeuver, CaseInstance } from "@/domain/case";
import { useLiveBackend } from "@/lib/liveBackend";
import {
  guard as backendGuard,
  patientTurn as backendPatientTurn,
  type PatientTurnRequest,
} from "@/lib/backend";
import type { Lang, TranscriptTurn } from "@/data/mock";
import { guidanceHints } from "@/data/mock";

export interface InterviewTabProps {
  caseInstance: CaseInstance;
  lang: Lang;
  affectLabel: string;
  guidanceOn: boolean;
  onGuidanceChange: (on: boolean) => void;
}

/** The non-advancing guard classes surfaced in the composer notice region. */
type GuardNoticeClass = Exclude<UtteranceClass, "in-scope">;

interface GuardNoticeState {
  cls: GuardNoticeClass;
  /** The learner's own words (echoed for off-topic / answer-seeking only). */
  utterance: string;
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
 *
 * Free-text questions run through the live Scope & Injection Guard
 * (src/domain/scopeGuard.ts, docs/architecture/13 §3) BEFORE anything reaches
 * the dialogue engine: in-scope questions route to askQuestion (state may
 * advance); off-topic gets an in-character reply without advancing; meta /
 * answer-seeking is declined in-character; injection is blocked deterministically
 * and never sent; unsafe breaks character with a support note.
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
  const live = useLiveBackend();

  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<GuardNoticeState | null>(null);
  const typingTimer = useRef<number | null>(null);

  // Live-backend transcript: doctor free text + REAL patient replies from the
  // pod gateway, kept separate from the mock reveal-graph turns and merged for
  // display. `fallbackNotice` flags a turn that silently fell back to the mock
  // path after a backend error.
  const [liveTurns, setLiveTurns] = useState<TranscriptTurn[]>([]);
  const [liveAffect, setLiveAffect] = useState<Record<string, string>>({});
  const [fallbackNotice, setFallbackNotice] = useState(false);
  const liveSeq = useRef(0);
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

  // Merge the mock reveal-graph turns with any live-backend exchanges for the
  // transcript. Live replies carry a "Live · pod" provenance caption.
  const allTurns = useMemo(
    () => [...turns, ...liveTurns],
    [turns, liveTurns],
  );
  const allAffect = useMemo(
    () => ({ ...affectByTurn, ...liveAffect }),
    [affectByTurn, liveAffect],
  );

  // A cited Socratic hint for the interview step (reuses the existing hints).
  const activeHint =
    guidanceHints.find((h) => h.stage === "history") ?? guidanceHints[0];

  function pulseTyping() {
    setTyping(true);
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => setTyping(false), 900);
  }

  function handleAsk(intent: QuestionIntent) {
    askQuestion(intent);
    pulseTyping();
  }

  /** Best-guess intent when free text is in-scope but maps to no clear intent. */
  function fallbackIntent(): QuestionIntent {
    const asked = new Set(
      state.events.filter((e) => e.type === "question").map((e) => e.ref),
    );
    return (
      expectedIntents(caseInstance).find((i) => !asked.has(i)) ??
      "associated-symptoms"
    );
  }

  /**
   * The offline path: the client-side Scope & Injection Guard, routed per class.
   * This is EXACTLY the pre-existing behavior and is what runs when Live mode is
   * off, and what a failed backend call falls back to.
   */
  function routeClientVerdict(text: string) {
    const verdict = classifyUtterance(text, caseInstance);
    switch (verdict.class) {
      case "in-scope": {
        // Normal flow: map to the closest intent and let state advance.
        setNotice(null);
        handleAsk(inferQuestionIntent(text, caseInstance) ?? fallbackIntent());
        break;
      }
      case "off-topic":
        logGuardOutcome({
          type: "offtopic",
          utterance: text,
          score: verdict.score,
          rationale: verdict.rationale,
        });
        setNotice({ cls: "off-topic", utterance: text });
        break;
      case "answer-seeking":
        logGuardOutcome({
          type: "answer-seeking",
          utterance: text,
          score: verdict.score,
          rationale: verdict.rationale,
        });
        setNotice({ cls: "answer-seeking", utterance: text });
        break;
      case "injection":
        // Blocked deterministically — never routed to the dialogue engine.
        logGuardOutcome({
          type: "injection",
          utterance: text,
          score: verdict.score,
          rationale: verdict.rationale,
        });
        setNotice({ cls: "injection", utterance: text });
        break;
      case "unsafe":
        logGuardOutcome({
          type: "unsafe",
          utterance: text,
          score: verdict.score,
          rationale: verdict.rationale,
        });
        setNotice({ cls: "unsafe", utterance: text });
        break;
    }
  }

  /**
   * Map the current case + transcript onto the gateway's /v1/patient/turn shape
   * (server/app.py). The persona knows its whole story (narrative), and the
   * qualitative answers are offered as sanctioned facts so the FactAssertionGate
   * does not strip legitimate replies. `history` mirrors the transcript so far.
   */
  function buildCaseContext(): Record<string, unknown> {
    const terms = new Set<string>();
    const push = (s?: string) => {
      const v = (s ?? "").trim();
      if (v) terms.add(v);
    };
    push(caseInstance.chiefComplaint.en);
    push(caseInstance.chiefComplaint.tr);
    const dx = caseInstance.correctDiagnosis?.code;
    push(dx?.text?.en);
    push(dx?.text?.tr);
    push(dx?.coding?.[0]?.display);
    for (const d of caseInstance.differentials ?? []) {
      push(d.code?.text?.en);
      push(d.code?.text?.tr);
      push(d.code?.coding?.[0]?.display);
    }
    for (const rf of caseInstance.redFlags ?? []) {
      push(rf.en);
      push(rf.tr);
    }
    for (const w of caseInstance.expectedWorkup ?? []) {
      push(w.label.en);
      push(w.label.tr);
    }
    return { scope_terms: Array.from(terms) };
  }

  function buildPatientTurnRequest(learnerMsg: string): PatientTurnRequest {
    const persona = {
      name: caseInstance.patient.name,
      age: caseInstance.patient.ageYears,
      affect_baseline: affectLabel,
    };
    const answers = caseInstance.groundTruth.history.map((h) => h.answer[lang]);
    const history = [...turns, ...liveTurns].slice(-8).map((tt) => ({
      role: tt.role === "doctor" ? "user" : "assistant",
      content: tt[lang],
    }));
    return {
      learner_msg: learnerMsg,
      case_state: {
        persona,
        narrative: [caseInstance.chiefComplaint[lang], ...answers],
        sanctioned_facts: answers,
      },
      persona,
      history,
      case_context: buildCaseContext(),
    };
  }

  /** Append a doctor turn + a backend-sourced patient reply (badged "Live · pod"). */
  function appendLiveExchange(doctorText: string, patientText: string) {
    const n = liveSeq.current++;
    const patId = `live-${n}-p`;
    setLiveTurns((prev) => [
      ...prev,
      { id: `live-${n}-d`, role: "doctor", stage: "history", en: doctorText, tr: doctorText },
      { id: patId, role: "patient", stage: "history", en: patientText, tr: patientText },
    ]);
    setLiveAffect((prev) => ({ ...prev, [patId]: t("liveBackend.badge") }));
  }

  /** Any backend failure lands here: note it, then run the offline path. */
  function liveFallback(text: string) {
    setFallbackNotice(true);
    routeClientVerdict(text);
  }

  /**
   * The live path: guard() on the pod first, then route by class exactly as the
   * offline guard does — in-scope calls patientTurn() and renders the REAL reply;
   * off-topic / answer-seeking / injection / unsafe reuse the existing notices.
   * ANY backend error falls back to the mock path (badge cleared).
   */
  async function handleLiveSend(text: string) {
    setNotice(null);
    setFallbackNotice(false);
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    setTyping(true);
    try {
      const gres = await backendGuard(text, buildCaseContext());
      if (!gres.ok) {
        liveFallback(text);
        return;
      }
      const verdict = gres.data;
      const score = typeof verdict.score === "number" ? verdict.score : 0;
      const rationale = verdict.rationale ?? "";

      switch (verdict.cls) {
        case "in-scope": {
          const tres = await backendPatientTurn(buildPatientTurnRequest(text));
          if (!tres.ok || !tres.data.utterance) {
            liveFallback(text);
            return;
          }
          appendLiveExchange(text, tres.data.utterance);
          return;
        }
        case "off-topic":
          logGuardOutcome({ type: "offtopic", utterance: text, score, rationale });
          setNotice({ cls: "off-topic", utterance: text });
          return;
        case "answer-seeking":
          logGuardOutcome({ type: "answer-seeking", utterance: text, score, rationale });
          setNotice({ cls: "answer-seeking", utterance: text });
          return;
        case "injection":
          logGuardOutcome({ type: "injection", utterance: text, score, rationale });
          setNotice({ cls: "injection", utterance: text });
          return;
        case "unsafe":
          logGuardOutcome({ type: "unsafe", utterance: text, score, rationale });
          setNotice({ cls: "unsafe", utterance: text });
          return;
        default:
          liveFallback(text);
          return;
      }
    } catch {
      // Belt and suspenders: the client never throws, but never trust the wire.
      liveFallback(text);
    } finally {
      setTyping(false);
    }
  }

  // Run the guard on the learner's free-text message, then route per class. When
  // Live mode is on, this goes to the pod gateway; otherwise it stays offline.
  function handleSend(e?: React.FormEvent) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    if (live.enabled) {
      void handleLiveSend(text);
    } else {
      routeClientVerdict(text);
    }
  }

  const askedIntents = new Set(
    state.events.filter((e) => e.type === "question").map((e) => e.ref),
  );
  const examinedManeuvers = new Set(
    state.events.filter((e) => e.type === "exam").map((e) => e.ref),
  );
  const offTask = getOffTaskCount(state);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_minmax(0,300px)]">
      {/* Dialogue column */}
      <div className="flex min-h-[420px] flex-col rounded-card border border-border bg-bg-subtle">
        {allTurns.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-8 text-center">
            <p className="max-w-xs text-sm text-muted">
              {t("ehr.interview.empty")}
            </p>
          </div>
        ) : (
          <EncounterChat
            turns={allTurns}
            lang={lang}
            patientTyping={typing}
            affectByTurn={allAffect}
            className="max-h-[46vh] flex-1 px-3 sm:px-4"
          />
        )}

        {/* Guard notice + free-text composer */}
        <div className="border-t border-border p-3 sm:p-4">
          <GuardNotice notice={notice} onDismiss={() => setNotice(null)} />
          {fallbackNotice ? (
            <LiveFallbackNotice onDismiss={() => setFallbackNotice(false)} />
          ) : null}

          <form onSubmit={handleSend} className="mt-2 flex items-center gap-2">
            <label htmlFor="acudx-ask" className="sr-only">
              {t("scopeGuard.composer.label")}
            </label>
            <input
              id="acudx-ask"
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t("scopeGuard.composer.placeholder")}
              autoComplete="off"
              className={cn(
                "min-w-0 flex-1 rounded-control border border-border bg-surface px-3 py-2",
                "text-sm text-fg placeholder:text-muted",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
              )}
            />
            <Button
              type="submit"
              size="sm"
              variant="primary"
              disabled={draft.trim().length === 0}
              leadingIcon={<PaperPlaneTilt weight="bold" className="h-4 w-4" />}
            >
              {t("scopeGuard.composer.send")}
            </Button>
          </form>

          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="text-[11px] text-muted">
              {t("scopeGuard.composer.hint")}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              {live.enabled ? (
                <Badge
                  tone="brand"
                  icon={<Broadcast weight="bold" className="h-3.5 w-3.5" />}
                  title={t("liveBackend.tooltip")}
                >
                  {t("liveBackend.badge")}
                </Badge>
              ) : null}
              <FocusIndicator offTask={offTask} />
            </div>
          </div>
        </div>

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
/* Scope & Injection Guard — notice + focus indicator                          */
/* -------------------------------------------------------------------------- */

/**
 * Live region for the guard verdict. The wrapper is always mounted so a change
 * is announced (aria-live); it stays empty on in-scope turns. Non-intrusive,
 * medkit-styled, and never echoes an injection payload as a patient reply.
 */
function GuardNotice({
  notice,
  onDismiss,
}: {
  notice: GuardNoticeState | null;
  onDismiss: () => void;
}) {
  return (
    <div aria-live="polite" role="status">
      {notice ? <GuardNoticeBody notice={notice} onDismiss={onDismiss} /> : null}
    </div>
  );
}

/**
 * Subtle notice shown when a live-backend turn could not reach the pod and the
 * offline simulation answered instead. Non-blocking; the encounter continues.
 */
function LiveFallbackNotice({ onDismiss }: { onDismiss: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      className="mt-2 flex items-start justify-between gap-2 rounded-control border border-border bg-bg-subtle p-2.5"
    >
      <div className="flex min-w-0 items-start gap-2">
        <WifiSlash
          weight="bold"
          className="mt-0.5 h-4 w-4 shrink-0 text-muted"
          aria-hidden
        />
        <p className="min-w-0 text-xs text-muted">{t("liveBackend.fallback")}</p>
      </div>
      <DismissButton onDismiss={onDismiss} />
    </div>
  );
}

function DismissButton({ onDismiss }: { onDismiss: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onDismiss}
      aria-label={t("scopeGuard.dismiss")}
      className={cn(
        "-mr-1 -mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-muted",
        "transition-colors hover:bg-bg-subtle hover:text-fg",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
      )}
    >
      <X weight="bold" className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
}

function GuardNoticeBody({
  notice,
  onDismiss,
}: {
  notice: GuardNoticeState;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const { cls, utterance } = notice;

  // Injection: subtle security notice. The payload is NOT surfaced as if the
  // patient engaged with it — it never reached the dialogue engine.
  if (cls === "injection") {
    return (
      <div className="flex items-start justify-between gap-2 rounded-control border border-border bg-surface p-2.5">
        <div className="flex min-w-0 items-start gap-2">
          <ShieldWarning
            weight="bold"
            className="mt-0.5 h-4 w-4 shrink-0 text-muted"
            aria-hidden
          />
          <div className="min-w-0">
            <Badge
              tone="neutral"
              icon={<ShieldWarning weight="bold" className="h-3.5 w-3.5" />}
            >
              {t("scopeGuard.injection.chip")}
            </Badge>
            <p className="mt-1 text-xs text-muted">
              {t("scopeGuard.injection.note")}
            </p>
          </div>
        </div>
        <DismissButton onDismiss={onDismiss} />
      </div>
    );
  }

  // Unsafe: calm, supportive break-character note (RP-7).
  if (cls === "unsafe") {
    return (
      <div className="flex items-start justify-between gap-2 rounded-control border border-brand/30 bg-brand-tint/50 p-2.5">
        <div className="flex min-w-0 items-start gap-2">
          <Lifebuoy
            weight="bold"
            className="mt-0.5 h-4 w-4 shrink-0 text-brand"
            aria-hidden
          />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-fg">
              {t("scopeGuard.unsafe.title")}
            </p>
            <p className="mt-0.5 text-xs text-muted">
              {t("scopeGuard.unsafe.note")}
            </p>
          </div>
        </div>
        <DismissButton onDismiss={onDismiss} />
      </div>
    );
  }

  // Off-topic / answer-seeking: the patient replies in character, with a chip
  // making clear the clinical picture did not advance.
  const isOffTopic = cls === "off-topic";
  const chipLabel = t(
    isOffTopic ? "scopeGuard.offTopic.chip" : "scopeGuard.answerSeeking.chip",
  );
  const reply = t(
    isOffTopic ? "scopeGuard.offTopic.reply" : "scopeGuard.answerSeeking.reply",
  );
  const note = t(
    isOffTopic ? "scopeGuard.offTopic.note" : "scopeGuard.answerSeeking.note",
  );

  return (
    <div className="rounded-control border border-border bg-surface p-2.5">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-[11px] text-muted">
          <span className="font-medium">{t("scopeGuard.youAsked")}:</span>{" "}
          {utterance}
        </p>
        <DismissButton onDismiss={onDismiss} />
      </div>
      <p className="mt-1.5 text-sm text-fg">{reply}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <Badge
          tone={isOffTopic ? "caution" : "neutral"}
          icon={
            isOffTopic ? (
              <Compass weight="bold" className="h-3.5 w-3.5" />
            ) : (
              <LockKey weight="bold" className="h-3.5 w-3.5" />
            )
          }
        >
          {chipLabel}
        </Badge>
        <span className="text-[11px] text-muted">{note}</span>
      </div>
    </div>
  );
}

/** Persistent staying-on-task indicator, driven by the guard event log. */
function FocusIndicator({ offTask }: { offTask: number }) {
  const { t } = useTranslation();
  const clear = offTask === 0;
  const label = clear
    ? t("scopeGuard.focus.onTask")
    : t("scopeGuard.focus.offTaskCount", { count: offTask });
  return (
    <Badge
      tone={clear ? "neutral" : "caution"}
      icon={<Target weight="bold" className="h-3.5 w-3.5" />}
      title={t("scopeGuard.focus.tooltip")}
      aria-label={label}
    >
      {label}
    </Badge>
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
