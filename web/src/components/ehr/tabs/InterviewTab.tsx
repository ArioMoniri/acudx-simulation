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
  Check,
  X,
  SpeakerHigh,
  SpeakerSlash,
  Microphone,
} from "@phosphor-icons/react";

import { EncounterChat } from "@/components/EncounterChat";
import { GuidanceCard } from "@/components/GuidanceCard";
import { PatientAvatar3D } from "@/components/avatar3d/PatientAvatar3D";
import { PatientPhoto } from "@/components/PatientPhoto";
import {
  SymptomSummary,
  photoSignsFromVitals,
  type VitalsLike,
} from "@/components/PatientViewer";
import { resolvePatientVisual } from "@/domain/patientIdentity";
import { Badge, Button, Switch, TextInput } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  askQuestion,
  requestExam,
  logGuardOutcome,
  getOffTaskCount,
  getCurrentVitals,
  useEncounterState,
} from "@/state/encounterStore";
import {
  classifyUtterance,
  inferQuestionIntent,
  type UtteranceClass,
} from "@/domain/scopeGuard";
import type { QuestionIntent, ExamManeuver, CaseInstance } from "@/domain/case";
import { useLiveBackend } from "@/lib/liveBackend";
import { useSpeechInput } from "@/lib/speechInput";
import {
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

/**
 * The guard classes surfaced in the composer notice region. `in-scope` routes to
 * the patient; `greeting` gets a friendly in-character reply — neither shows a
 * notice, so both are excluded here.
 */
type GuardNoticeClass = Exclude<UtteranceClass, "in-scope" | "greeting">;

/**
 * In-character canned patient lines used offline (and as the live fallback), kept
 * bilingual so they render correctly in EN/TR just like the reveal-graph turns.
 * Varied so the patient never feels robotic. `greeting` answers a social opener;
 * `clarify` answers an in-scope utterance that maps to no specific datum — the
 * patient stays engaged and gently asks the learner to be more specific instead
 * of a hard "off-topic" penalty.
 */
const GREETING_REPLIES: ReadonlyArray<{ en: string; tr: string }> = [
  {
    en: "Hello, doctor. Thank you for seeing me today.",
    tr: "Merhaba doktor. Bugün beni gördüğünüz için teşekkür ederim.",
  },
  {
    en: "Hi, doctor — I'm glad you could see me. I've not been feeling right.",
    tr: "Merhaba doktor — beni görebildiğinize sevindim. Kendimi pek iyi hissetmiyorum.",
  },
  {
    en: "Good to meet you, doctor. I'm ready whenever you'd like to begin.",
    tr: "Sizinle tanışmak güzel doktor. Başlamak istediğinizde hazırım.",
  },
];

const CLARIFY_REPLIES: ReadonlyArray<{ en: string; tr: string }> = [
  {
    en: "I'm sorry, I'm not quite sure what you mean — could you ask that a different way?",
    tr: "Üzgünüm, tam olarak ne demek istediğinizi anlayamadım — biraz farklı sorabilir misiniz?",
  },
  {
    en: "Could you be a little more specific about what you'd like to know?",
    tr: "Neyi öğrenmek istediğiniz konusunda biraz daha açık olabilir misiniz?",
  },
  {
    en: "I didn't quite follow — what would you like to ask me about?",
    tr: "Tam takip edemedim — bana neyi sormak istersiniz?",
  },
];

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
  const { t, i18n } = useTranslation();
  const state = useEncounterState();
  const live = useLiveBackend();

  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");

  // Push-to-talk voice DICTATION (GitHub #107): the learner may speak a question
  // aloud and it fills the composer, where they can edit it before Send. Purely
  // client-side (browser Web Speech API), opt-in per press, and unrelated to the
  // air-gapped pod path — interim + final transcripts just feed `draft`. The mic
  // control renders only when the browser exposes the API (`micSupported`).
  const {
    supported: micSupported,
    listening: micListening,
    toggle: toggleMic,
  } = useSpeechInput({
    lang: i18n.language,
    onInterim: (text) => setDraft(text),
    onFinal: (text) => setDraft(text),
  });
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
  // Rotates the canned greeting/clarify lines so repeats don't feel robotic.
  const cannedSeq = useRef(0);
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
        // Off-target question: the patient has nothing specific for that, so
        // they stay in character and (varied, by seq) ask for more detail rather
        // than repeating one robotic "I'm not sure how to answer that" line.
        const patId = `p-${ev.seq}-miss`;
        const miss = CLARIFY_REPLIES[ev.seq % CLARIFY_REPLIES.length];
        turnsAcc.push({
          id: patId,
          role: "patient",
          stage: "history",
          en: miss.en,
          tr: miss.tr,
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

  // The patient's most recent spoken line (in the encounter's content language),
  // fed to the 3D avatar so its mouth lip-syncs the reply as it lands. Changing
  // the string starts a fresh spoken turn; an empty transcript leaves the face
  // at rest. This is what makes the patient visibly "talk" while you converse.
  const lastPatientUtterance = useMemo(() => {
    for (let i = allTurns.length - 1; i >= 0; i--) {
      if (allTurns[i].role === "patient") return allTurns[i][lang];
    }
    return "";
  }, [allTurns, lang]);

  // Opt-in spoken audio (Web Speech API) for the patient replies; OFF by default
  // so the encounter is silent in shared/clinical spaces — the lip-sync still
  // plays. Toggling it on takes effect on the NEXT reply.
  const [voiceOn, setVoiceOn] = useState(false);

  // Live vitals (same course the bedside monitor reads) drive the avatar's
  // clinical signs + the concise symptom line beneath it. Falls back to triage
  // before the encounter clock starts.
  const vitals = getCurrentVitals(state) ?? caseInstance.triageVitals;

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

  /** Append an in-character canned patient reply (greeting / clarify) offline. */
  function appendCannedReply(
    doctorText: string,
    pool: ReadonlyArray<{ en: string; tr: string }>,
  ) {
    const reply = pool[cannedSeq.current++ % pool.length];
    appendExchange(doctorText, reply, affectLabel);
  }

  /**
   * The offline path: the client-side Scope & Injection Guard, routed per class.
   * Runs when Live mode is off, and as the fallback when a backend call fails.
   *
   * `greeting` and an in-scope utterance that maps to no datum both get a brief
   * in-character reply with NO off-task penalty; only genuine chit-chat
   * (off-topic) and the hard-safety classes surface a notice.
   */
  function routeClientVerdict(text: string) {
    const verdict = classifyUtterance(text, caseInstance);
    switch (verdict.class) {
      case "greeting":
        // Social opener: the patient greets back in character. Not a lapse.
        setNotice(null);
        appendCannedReply(text, GREETING_REPLIES);
        break;
      case "in-scope": {
        // Normal flow: map to the closest intent and let state advance. When no
        // intent resolves, stay engaged and ask for specifics — no penalty.
        setNotice(null);
        const intent = inferQuestionIntent(text, caseInstance);
        if (intent) {
          handleAsk(intent);
        } else {
          appendCannedReply(text, CLARIFY_REPLIES);
        }
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

  /**
   * Append a doctor turn + a patient reply to the free-text transcript. `affect`
   * both labels the patient turn and, when it is the Live badge, marks the reply
   * as model-sourced ("Live · pod"); canned offline replies pass affectLabel.
   */
  function appendExchange(
    doctorText: string,
    patient: { en: string; tr: string },
    affect: string,
  ) {
    const n = liveSeq.current++;
    const patId = `live-${n}-p`;
    setLiveTurns((prev) => [
      ...prev,
      { id: `live-${n}-d`, role: "doctor", stage: "history", en: doctorText, tr: doctorText },
      { id: patId, role: "patient", stage: "history", en: patient.en, tr: patient.tr },
    ]);
    setLiveAffect((prev) => ({ ...prev, [patId]: affect }));
  }

  /** Any backend failure lands here: note it, then run the offline path. */
  function liveFallback(text: string) {
    setFallbackNotice(true);
    routeClientVerdict(text);
  }

  /**
   * Send an in-scope / greeting utterance to the pod persona and render the REAL
   * model reply as the patient turn. A "typing…" state shows while the model
   * responds (CPU inference can take a few seconds). ANY failure — not ok, empty
   * utterance, or a thrown error — degrades to the offline reveal-graph path.
   */
  async function sendToPatient(text: string) {
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    setTyping(true);
    try {
      const tres = await backendPatientTurn(buildPatientTurnRequest(text));
      if (!tres.ok || !tres.data.utterance) {
        liveFallback(text);
        return;
      }
      const reply = tres.data.utterance;
      appendExchange(text, { en: reply, tr: reply }, t("liveBackend.badge"));
    } catch {
      // Belt and suspenders: the client never throws, but never trust the wire.
      liveFallback(text);
    } finally {
      setTyping(false);
    }
  }

  /**
   * The live path. The deterministic client guard classifies first so the
   * hard-safety classes (injection / unsafe / answer-seeking) NEVER reach the
   * model and genuine chit-chat is redirected — everything the patient should
   * actually hear (a greeting or any in-scope question) is routed to
   * /v1/patient/turn for a dynamic, varied reply. This is what makes free-typed
   * questions get a real answer instead of a canned reveal-graph line, and it
   * stops well-formed questions from being over-flagged as "off-topic".
   */
  async function handleLiveSend(text: string) {
    setNotice(null);
    setFallbackNotice(false);
    const verdict = classifyUtterance(text, caseInstance);
    const { score, rationale } = verdict;
    switch (verdict.class) {
      case "greeting":
      case "in-scope":
        await sendToPatient(text);
        return;
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
    }
  }

  // Route the learner's free-text message. When Live mode is on, in-scope and
  // greeting turns go to the pod gateway for a dynamic reply; otherwise (and on
  // any backend failure) the offline reveal-graph path answers.
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
            <TextInput
              id="acudx-ask"
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t("scopeGuard.composer.placeholder")}
              autoComplete="off"
              className="min-w-0 flex-1"
            />
            {micSupported ? (
              <button
                type="button"
                onClick={toggleMic}
                aria-pressed={micListening}
                aria-label={
                  micListening
                    ? t("ehr.interview.voiceInput.stop", {
                        defaultValue: "Stop dictation",
                      })
                    : t("ehr.interview.voiceInput.mic", {
                        defaultValue: "Dictate",
                      })
                }
                title={
                  micListening
                    ? t("ehr.interview.voiceInput.stop", {
                        defaultValue: "Stop dictation",
                      })
                    : t("ehr.interview.voiceInput.hint", {
                        defaultValue: "Dictate your question, then edit before sending",
                      })
                }
                className={cn(
                  "relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-control border",
                  "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
                  micListening
                    ? "border-transparent bg-brand-tint text-brand"
                    : "border-border bg-surface text-muted hover:text-fg",
                )}
              >
                <Microphone weight="bold" className="h-4 w-4" aria-hidden />
                {micListening ? (
                  <span
                    className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-brand motion-safe:animate-pulse"
                    aria-hidden
                  />
                ) : null}
              </button>
            ) : null}
            <Button
              type="submit"
              size="md"
              variant="primary"
              disabled={draft.trim().length === 0}
              leadingIcon={<PaperPlaneTilt weight="bold" className="h-4 w-4" />}
            >
              {t("scopeGuard.composer.send")}
            </Button>
          </form>

          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="text-[11px] text-muted">
              {micListening ? (
                <span className="inline-flex items-center gap-1.5 text-brand">
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-brand motion-safe:animate-pulse"
                    aria-hidden
                  />
                  {t("ehr.interview.voiceInput.listening", {
                    defaultValue: "Listening…",
                  })}
                </span>
              ) : (
                t("scopeGuard.composer.hint")
              )}
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

      {/* Patient presence + ask / examine chips */}
      <div className="flex flex-col gap-4">
        <PatientPresence
          caseInstance={caseInstance}
          vitals={vitals}
          utterance={lastPatientUtterance}
          voiceOn={voiceOn}
          onToggleVoice={() => setVoiceOn((v) => !v)}
        />

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
/* Patient presence — the talking, symptom-aware avatar                        */
/* -------------------------------------------------------------------------- */

/**
 * PatientPresence — the person the learner is interviewing, shown beside the
 * dialogue. The symptom-aware 3D head lip-syncs each patient reply (`utterance`)
 * via the client-side viseme timeline — no audio, no server GPU — so the patient
 * visibly "talks" as you converse. A voice toggle opts into spoken audio (Web
 * Speech API) for the next reply. A concise live clinical-sign line sits beneath,
 * so the demographic-matched face is always tied to the current vitals.
 */
function PatientPresence({
  caseInstance,
  vitals,
  utterance,
  voiceOn,
  onToggleVoice,
}: {
  caseInstance: CaseInstance;
  vitals: VitalsLike;
  utterance: string;
  voiceOn: boolean;
  onToggleVoice: () => void;
}) {
  const { t } = useTranslation();
  // Unified identity + full physiology channel. The realistic photo LEADS (the
  // person the learner talks to, matched to the case name); a small lip-sync head
  // below carries the viseme animation + the optional spoken audio (voice toggle).
  const visual = resolvePatientVisual(caseInstance);
  const signs = photoSignsFromVitals(vitals);
  const speaking = Boolean(utterance && utterance.trim().length > 0);
  return (
    <section className="rounded-card border border-border bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          {t("ehr.interview.patient.heading", { defaultValue: "Patient" })}
        </h3>
        <button
          type="button"
          onClick={onToggleVoice}
          aria-pressed={voiceOn}
          title={t("ehr.interview.patient.voiceToggle", {
            defaultValue: "Toggle spoken audio for patient replies",
          })}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
            "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
            voiceOn
              ? "border-transparent bg-brand-tint text-brand"
              : "border-border bg-bg-subtle text-muted hover:text-fg",
          )}
        >
          {voiceOn ? (
            <SpeakerHigh weight="bold" className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <SpeakerSlash weight="bold" className="h-3.5 w-3.5" aria-hidden />
          )}
          {voiceOn
            ? t("ehr.interview.patient.voiceOn", { defaultValue: "Voice on" })
            : t("ehr.interview.patient.voiceOff", { defaultValue: "Voice off" })}
        </button>
      </div>

      {/* Primary: the realistic, symptom-tinted patient, matched to the case
          name; the speaking treatment plays as each reply lands. */}
      <div className="mt-2">
        <PatientPhoto
          sex={visual.sexAtBirth}
          age={visual.age}
          photoId={visual.photoId}
          signs={signs}
          rr={vitals.rr}
          speaking={speaking}
          utterance={utterance}
          alt={t("patientviewer.syntheticNote")}
          caption={caseInstance.patient.name}
          className="aspect-[4/5] w-full ring-1 ring-border"
        />
      </div>

      {/* Secondary: the small lip-sync head — CASE identity now — carries the
          viseme animation and the optional spoken audio (the voice toggle). */}
      <div className="mt-2">
        <PatientAvatar3D
          patient={caseInstance.patient}
          profileSeed={caseInstance.seed}
          utterance={utterance}
          voice={voiceOn}
          className="w-full"
        />
      </div>

      <SymptomSummary vitals={vitals} className="mt-2 text-muted" />
    </section>
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
        <Check weight="bold" className="h-3 w-3 text-brand" aria-hidden />
      ) : null}
      {label}
    </button>
  );
}
