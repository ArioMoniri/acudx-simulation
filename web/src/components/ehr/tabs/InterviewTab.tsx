import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen } from "@phosphor-icons/react";

import { GuidanceCard } from "@/components/GuidanceCard";
import { PatientCallTile, type PatientCallContext } from "@/components/ehr/PatientCallTile";
import { stopTts, unlockTts } from "@/lib/tts";
import { SymptomSummary, type VitalsLike } from "@/components/PatientViewer";
import { SectionLabel, Switch } from "@/components/ui";
import {
  AskChip,
  Composer,
  InterviewThread,
  OrderChip,
  SuggestionsDrawer,
  type ActionHandlers,
  type OrderStatus,
  type ThreadMessage,
} from "@/components/chat";
import {
  askQuestion,
  requestExam,
  recordDialogue,
  dedupePatientTurns,
  logGuardOutcome,
  getCurrentVitals,
  getEncounterClockMs,
  getPersonaLiveContext,
  placeOrder,
  useEncounterState,
} from "@/state/encounterStore";
import {
  computeCoverage,
  useLiveGrounding,
  type NextBestAction,
} from "@/lib/guidanceEngine";
import {
  classifyUtterance,
  inferQuestionIntent,
} from "@/domain/scopeGuard";
import type { QuestionIntent, ExamManeuver, CaseInstance } from "@/domain/case";
import { getOrderableByCode, type Orderable } from "@/domain/orderables";
import { useLiveBackend } from "@/lib/liveBackend";
import { personaFacts } from "@/lib/personaFacts";
import {
  questionKey,
  resolveOrderCode,
  type ChatGuard,
  type NavigateTarget,
  type OrderAction,
} from "@/lib/chatActions";
import { routeMessage, type SendDeps } from "@/lib/interviewSend";
import {
  sttSupported,
  startRecording,
  stopAndTranscribe,
  cancelRecording,
} from "@/lib/stt";
import {
  isDegradedPatientTurn,
  patientTurn as backendPatientTurn,
  type PatientTurnRequest,
} from "@/lib/backend";
import type { Lang, TranscriptTurn } from "@/data/schema";

export interface InterviewTabProps {
  caseInstance: CaseInstance;
  lang: Lang;
  affectLabel: string;
  guidanceOn: boolean;
  onGuidanceChange: (on: boolean) => void;
  /**
   * Open a chart section and highlight an item (chat navigate actions, /go).
   * Absent (e.g. a room without the chart strip): navigate buttons are hidden.
   */
  onNavigate?: (target: NavigateTarget, ref?: string) => void;
}

/**
 * In-character canned patient lines used offline (and as the live fallback), kept
 * bilingual so they render correctly in EN/TR just like the reveal-graph turns.
 * Varied so the patient never feels robotic. `greeting` answers a social opener;
 * `clarify` answers an in-scope utterance that maps to no specific datum: the
 * patient stays engaged and gently asks the learner to be more specific.
 */
const GREETING_REPLIES: ReadonlyArray<{ en: string; tr: string }> = [
  {
    en: "Hello, doctor. Thank you for seeing me today.",
    tr: "Merhaba doktor. Bugün beni gördüğünüz için teşekkür ederim.",
  },
  {
    en: "Hi, doctor. I'm glad you could see me. I've not been feeling right.",
    tr: "Merhaba doktor. Beni görebildiğinize sevindim. Kendimi pek iyi hissetmiyorum.",
  },
  {
    en: "Good to meet you, doctor. I'm ready whenever you'd like to begin.",
    tr: "Sizinle tanışmak güzel doktor. Başlamak istediğinizde hazırım.",
  },
];

const CLARIFY_REPLIES: ReadonlyArray<{ en: string; tr: string }> = [
  {
    en: "I'm sorry, I'm not quite sure what you mean. Could you ask that a different way?",
    tr: "Üzgünüm, tam olarak ne demek istediğinizi anlayamadım. Biraz farklı sorabilir misiniz?",
  },
  {
    en: "Could you be a little more specific about what you'd like to know?",
    tr: "Neyi öğrenmek istediğiniz konusunda biraz daha açık olabilir misiniz?",
  },
  {
    en: "I didn't quite follow. What would you like to ask me about?",
    tr: "Tam takip edemedim. Bana neyi sormak istersiniz?",
  },
];

/**
 * A transcript turn carrying the encounter's monotonic event `seq`, so the
 * reveal-graph and free-text/live sources can be merged in true chronological
 * order rather than one source always before the other.
 */
type OrderedTurn = TranscriptTurn & {
  seq: number;
  /** Secondary tag: the intent a free-text question was classified to. */
  intent?: string;
  actions?: ThreadMessage["actions"];
  guard?: ChatGuard;
};

/** Question-intent suggestions offered in the drawer (history extraction). */
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

/** Examination suggestions (exam extraction). */
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

/** How many quick suggestions sit above the composer. */
const QUICK_COUNT = 3;

const DRAWER_KEY = "acudx-chat-suggestions-open";

function camel(s: string): string {
  return s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function readDrawerPref(): boolean {
  try {
    return window.localStorage.getItem(DRAWER_KEY) === "1";
  } catch {
    return false;
  }
}

function writeDrawerPref(open: boolean): void {
  try {
    window.localStorage.setItem(DRAWER_KEY, open ? "1" : "0");
  } catch {
    /* per-viewer convenience only */
  }
}

type TFunc = ReturnType<typeof useTranslation>["t"];

/**
 * A short, localized phrase for the single most useful next step (the coverage
 * layer's next-best-action). Feeds the grounding query so the guidance reacts to
 * what has been asked / is still missing, never the diagnosis.
 */
function nbaPhrase(nba: NextBestAction | null, lang: Lang, t: TFunc): string {
  if (!nba) return "";
  switch (nba.kind) {
    case "history":
      return nba.ref
        ? t(`ehr.intents.${camel(nba.ref)}`, { defaultValue: nba.ref })
        : "";
    case "exam":
      return nba.ref
        ? t(`ehr.maneuvers.${camel(nba.ref)}`, { defaultValue: nba.ref })
        : "";
    case "workup":
      return (lang === "tr" ? nba.labelTr : nba.labelEn) ?? nba.ref ?? "";
    case "redflag":
      return nba.ref ?? "";
    default:
      return "";
  }
}

/**
 * InterviewTab: where history and examination are EXTRACTED (docs section 2.2),
 * redesigned as an Epic-grade interview pane (docs/design/05-chat.md).
 *
 * ONE send path. Typed text, a drawer suggestion, a quick suggestion and a
 * follow-up chip all call `send(text, { intent? })`. The learner's line shows at
 * once (optimistic, "Sending"), then:
 *  - Live (gateway reachable): every soft class (greeting, in-scope, off-topic,
 *    answer-seeking) goes to /v1/patient/turn, which answers in character and may
 *    return generative `actions` and a `guard` note; injection and unsafe stay
 *    deterministic and never leave the browser. A failed or degraded reply falls
 *    back to the offline path.
 *  - Offline: the client Scope Guard classifies; an in-scope question maps to an
 *    intent and the reveal graph answers; off-topic and answer-seeking get an
 *    in-character reply plus an attending note, so a typed message is never
 *    silently dropped (the "only the question list answers" defect).
 * A catalogue suggestion carries its intent, so it skips classification.
 */
export function InterviewTab({
  caseInstance,
  lang,
  affectLabel,
  guidanceOn,
  onGuidanceChange,
  onNavigate,
}: InterviewTabProps) {
  const { t, i18n } = useTranslation();
  const state = useEncounterState();
  const live = useLiveBackend();
  const drawerId = useId();

  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<{ text: string; at: number } | null>(null);
  const [drafts, setDrafts] = useState<OrderAction[]>([]);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(readDrawerPref);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const callRef = useRef<HTMLDivElement | null>(null);

  // Push-to-talk dictation via the /stt proxy (key server-side): the transcript
  // fills the composer, where the learner edits before sending.
  const micSupported = sttSupported;
  const [micListening, setMicListening] = useState(false);
  const toggleMic = useCallback(async () => {
    if (micListening) {
      setMicListening(false);
      const text = await stopAndTranscribe(i18n.language?.startsWith("tr") ? "tr" : "en");
      if (text) setDraft((d) => (d.trim() ? `${d.trim()} ${text}` : text));
    } else {
      const ok = await startRecording();
      if (ok) setMicListening(true);
    }
  }, [micListening, i18n.language]);
  useEffect(() => () => cancelRecording(), []);

  const toggleDrawer = useCallback((open?: boolean) => {
    setDrawerOpen((o) => {
      const next = open ?? !o;
      writeDrawerPref(next);
      return next;
    });
  }, []);

  const intentLabel = useCallback((i: QuestionIntent) => t(`ehr.intents.${camel(i)}`), [t]);
  const maneuverLabel = useCallback((m: ExamManeuver) => t(`ehr.maneuvers.${camel(m)}`), [t]);

  /* ------------------------------------------------------------------------ */
  /* Transcript sources                                                        */
  /* ------------------------------------------------------------------------ */

  const atBySeq = useMemo(() => {
    const m = new Map<number, number>();
    for (const e of state.events) m.set(e.seq, e.at);
    for (const g of state.guardEvents) m.set(g.seq, g.at);
    return m;
  }, [state.events, state.guardEvents]);

  // Reveal-graph turns: each answered question event becomes a learner turn
  // plus the revealed answers. Only obtained data appears (progressive disclosure).
  const turns = useMemo(() => {
    const historyById = new Map(caseInstance.groundTruth.history.map((h) => [h.id, h]));
    const acc: OrderedTurn[] = [];
    // Free-text / voice / live exchanges render from the persisted dialogue log,
    // and a question the live persona already answered (meta.voiced) does too.
    const questionEvents = state.events
      .filter((e) => e.type === "question" && e.meta?.dialogue !== true && e.meta?.voiced !== true)
      .sort((a, b) => a.seq - b.seq);
    for (const ev of questionEvents) {
      const intentKey = t(`ehr.intents.${camel(ev.ref)}`, { defaultValue: ev.ref });
      const utterance = typeof ev.meta?.utterance === "string" ? ev.meta.utterance : "";
      acc.push({
        id: `d-${ev.seq}`,
        role: "doctor",
        stage: "history",
        en: utterance || intentKey,
        tr: utterance || intentKey,
        seq: ev.seq,
        ...(utterance ? { intent: intentKey } : {}),
      });
      const revealed = (ev.meta?.revealed as string[] | undefined) ?? [];
      const answers = revealed
        .map((id) => historyById.get(id))
        .filter((h): h is NonNullable<typeof h> => Boolean(h));
      if (ev.meta?.awaiting === true) {
        acc.push({ id: `p-${ev.seq}-wait`, role: "patient", stage: "history", en: "...", tr: "...", seq: ev.seq });
      } else if (answers.length > 0) {
        for (const a of answers) {
          acc.push({ id: `p-${ev.seq}-${a.id}`, role: "patient", stage: "history", en: a.answer.en, tr: a.answer.tr, seq: ev.seq });
        }
      } else {
        const miss = CLARIFY_REPLIES[ev.seq % CLARIFY_REPLIES.length];
        acc.push({ id: `p-${ev.seq}-miss`, role: "patient", stage: "history", en: miss.en, tr: miss.tr, seq: ev.seq });
      }
    }
    return acc;
  }, [state.events, caseInstance.groundTruth.history, t]);

  const dialogueTurns = useMemo<OrderedTurn[]>(
    () =>
      state.dialogue.map((d) => ({
        id: d.id,
        role: d.role,
        stage: "history",
        en: d.en,
        tr: d.tr,
        seq: d.seq,
        ...(d.actions ? { actions: d.actions } : {}),
        ...(d.guard ? { guard: d.guard } : {}),
      })),
    [state.dialogue],
  );
  const dialogueAffect = useMemo<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const d of state.dialogue) if (d.role === "patient" && d.affect) m[d.id] = d.affect;
    return m;
  }, [state.dialogue]);

  const allTurns = useMemo(
    () => dedupePatientTurns([...turns, ...dialogueTurns].sort((a, b) => a.seq - b.seq)),
    [turns, dialogueTurns],
  );

  // Ids present when the pane mounted never stream (a remount must not replay).
  const knownIds = useRef<Set<string> | null>(null);
  if (knownIds.current === null) knownIds.current = new Set(allTurns.map((x) => x.id));

  const messages = useMemo<ThreadMessage[]>(() => {
    const out: ThreadMessage[] = [];
    const lastPatientId = [...allTurns].reverse().find((x) => x.role === "patient")?.id;
    for (const turn of allTurns) {
      const isPatient = turn.role === "patient";
      out.push({
        id: turn.id,
        speaker: isPatient ? "patient" : "learner",
        text: turn[lang],
        at: atBySeq.get(turn.seq) ?? null,
        seq: turn.seq,
        ...(turn.intent ? { intent: turn.intent } : {}),
        ...(isPatient ? { affect: dialogueAffect[turn.id] ?? affectLabel } : {}),
        ...(turn.actions ? { actions: turn.actions } : {}),
        ...(turn.guard ? { guard: turn.guard } : {}),
        ...(isPatient && turn.id === lastPatientId && !knownIds.current!.has(turn.id) ? { stream: true } : {}),
      });
    }

    // Examination: the learner's manoeuvre with the findings it revealed.
    const examById = new Map(caseInstance.groundTruth.exam.map((f) => [f.id, f]));
    for (const ev of state.events) {
      if (ev.type !== "exam") continue;
      const ids = (ev.meta?.revealed as string[] | undefined) ?? [];
      out.push({
        id: `x-${ev.seq}`,
        speaker: "learner",
        text: t("chat.exam.performed", { maneuver: maneuverLabel(ev.ref as ExamManeuver) }),
        at: ev.at,
        seq: ev.seq,
        awaiting: ev.meta?.awaiting === true,
        findings: ids
          .map((id) => examById.get(id))
          .filter((f): f is NonNullable<typeof f> => Boolean(f))
          .map((f) => ({ id: f.id, system: f.system[lang], finding: f.finding[lang], abnormal: f.abnormal })),
      });
    }

    // Results: the nurse calls each one in, with a jump to it.
    const resultSeq = new Map<string, number>();
    for (const ev of state.events) {
      if (ev.type === "result" && typeof ev.meta?.orderId === "string") resultSeq.set(ev.meta.orderId, ev.seq);
    }
    for (const r of state.results) {
      const order = state.orders.find((o) => o.id === r.orderId);
      const label = order ? (lang === "tr" ? order.labelTr : order.labelEn) : r.code;
      const tone = r.engine?.critical ? "critical" : r.engine?.abnormal ? "abnormal" : "normal";
      const key = tone === "critical" ? "chat.nurse.resultBackCritical" : tone === "abnormal" ? "chat.nurse.resultBackAbnormal" : "chat.nurse.resultBack";
      out.push({
        id: `r-${r.orderId}`,
        speaker: "nurse",
        text: t(key, { label }),
        at: r.at,
        seq: resultSeq.get(r.orderId) ?? Number.MAX_SAFE_INTEGER - 1,
        tone,
        actions: [{ kind: "navigate", target: r.datumKind === "imaging" ? "imaging" : "results", ref: r.code }],
      });
    }

    // Hard guard outcomes: the attending speaks; the payload is never echoed.
    for (const g of state.guardEvents) {
      if (g.type !== "injection" && g.type !== "unsafe") continue;
      out.push({
        id: `g-${g.seq}`,
        speaker: "attending",
        text: t(`chat.guard.${g.type}.note`),
        at: g.at,
        seq: g.seq,
      });
    }

    out.sort((a, b) => a.seq - b.seq);
    if (pending) {
      out.push({ id: "pending", speaker: "learner", text: pending.text, at: pending.at, seq: Number.MAX_SAFE_INTEGER, status: "sending" });
    }
    return out;
  }, [allTurns, atBySeq, lang, dialogueAffect, affectLabel, caseInstance.groundTruth.exam, state.events, state.results, state.orders, state.guardEvents, pending, t, maneuverLabel]);

  // Keep the newest line in view as lines land, while typing, and while streaming.
  const scrollToEnd = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const reduce =
      typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: el.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }, []);
  useEffect(() => {
    scrollToEnd();
  }, [messages.length, busy, scrollToEnd]);

  const lastPatientUtterance = useMemo(() => {
    for (let i = allTurns.length - 1; i >= 0; i--) if (allTurns[i].role === "patient") return allTurns[i][lang];
    return "";
  }, [allTurns, lang]);
  const lastLearnerLine = useMemo(() => {
    for (let i = allTurns.length - 1; i >= 0; i--) if (allTurns[i].role === "doctor") return allTurns[i][lang];
    return "";
  }, [allTurns, lang]);

  // Opt-in spoken replies; OFF by default so shared spaces stay silent.
  const [voiceOn, setVoiceOn] = useState(false);
  const toggleVoice = useCallback(() => {
    setVoiceOn((v) => {
      const next = !v;
      // Unlock audio inside this click so the async replies can play.
      if (next) unlockTts();
      else stopTts();
      return next;
    });
  }, []);
  const callEntry = useCallback(() => {
    toggleVoice();
    const tile = callRef.current?.querySelector<HTMLElement>("section[data-call-state]");
    tile?.scrollIntoView?.({ block: "nearest" });
  }, [toggleVoice]);

  const vitals = getCurrentVitals(state) ?? caseInstance.triageVitals;

  // Reactive, grounded interview guidance (process only, never the diagnosis).
  const coverage = computeCoverage(state, caseInstance);
  const nba = coverage.nextBestAction;
  const guidanceQuery = guidanceOn
    ? [caseInstance.chiefComplaint[lang], nbaPhrase(nba, lang, t)].filter(Boolean).join(" · ")
    : "";
  const grounding = useLiveGrounding({ query: guidanceQuery, locale: lang });
  const leadPassage = grounding.passages[0];
  const lastGuard = state.guardEvents[state.guardEvents.length - 1];
  const lastClinicalSeq = [...state.events]
    .reverse()
    .find((e) => e.type === "question" || e.type === "exam" || e.type === "order")?.seq;
  const guidanceAbstained =
    !!lastGuard &&
    (lastGuard.type === "offtopic" || lastGuard.type === "answer-seeking") &&
    (lastClinicalSeq == null || lastGuard.seq > lastClinicalSeq);
  const activeHint = leadPassage?.hint ?? null;

  /* ------------------------------------------------------------------------ */
  /* The send path                                                             */
  /* ------------------------------------------------------------------------ */

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

  function buildPatientTurnRequest(learnerMsg: string, intent: QuestionIntent | null): PatientTurnRequest {
    const persona = {
      name: caseInstance.patient.name,
      age: caseInstance.patient.ageYears,
      affect_baseline: affectLabel,
    };
    // Only facts the learner's questions sanctioned, never the whole history.
    const facts = personaFacts(caseInstance, state.discovered, lang, intent);
    const history = allTurns.slice(-8).map((tt) => ({
      role: tt.role === "doctor" ? "user" : "assistant",
      content: tt[lang],
    }));
    const directorCtx = getPersonaLiveContext(state);
    return {
      learner_msg: learnerMsg,
      case_state: {
        persona,
        narrative: facts.narrative,
        sanctioned_facts: [...facts.sanctioned, ...directorCtx.sanctioned_facts],
        vitals: directorCtx.vitals,
        vitals_adjectives: directorCtx.vitals_adjectives,
        affect: directorCtx.affect,
        complications: directorCtx.complications,
      },
      persona,
      history,
      case_context: buildCaseContext(),
    };
  }

  const sendDeps: SendDeps = {
    live: live.enabled,
    classify: (text) => classifyUtterance(text, caseInstance),
    inferIntent: (text) => inferQuestionIntent(text, caseInstance),
    askQuestion: (intent, opts) => askQuestion(intent, opts),
    recordExchange: (input) => recordDialogue({ ...input, affect: affectLabel }),
    logGuard: (cls, utterance, score, rationale) =>
      logGuardOutcome({ type: cls === "off-topic" ? "offtopic" : cls, utterance, score, rationale }),
    patientTurn: async (text, intent) => {
      const res = await backendPatientTurn(buildPatientTurnRequest(text, intent));
      if (!res.ok) return null;
      return {
        utterance: res.data.utterance,
        state_advance: res.data.state_advance,
        guard: res.data.guard,
        actions: res.data.actions,
        degraded: isDegradedPatientTurn(res.data),
      };
    },
    // Rotate from how many exchanges are logged, so repeats stay varied.
    greeting: () => GREETING_REPLIES[Math.floor(state.dialogue.length / 2) % GREETING_REPLIES.length],
    clarify: () => CLARIFY_REPLIES[Math.floor(state.dialogue.length / 2) % CLARIFY_REPLIES.length],
    softReply: (cls) => {
      const key = cls === "off-topic" ? "offTopic" : "answerSeeking";
      return {
        patient: { en: i18n.getFixedT("en")(`scopeGuard.${key}.reply`), tr: i18n.getFixedT("tr")(`scopeGuard.${key}.reply`) },
        guard: { label: t(`chat.guard.${key}.label`), note: t(`chat.guard.${key}.note`) },
      };
    },
  };

  /** The one send path for typed text, suggestions and follow-up chips. */
  async function send(raw: string, opts: { intent?: QuestionIntent } = {}) {
    const text = raw.trim();
    if (!text || busy) return;
    setDraft("");
    setPending({ text, at: getEncounterClockMs(state) });
    setBusy(true);
    try {
      await routeMessage(text, sendDeps, opts);
    } finally {
      setPending(null);
      setBusy(false);
    }
  }

  const askIntent = (intent: QuestionIntent) => void send(t(questionKey(intent)), { intent });

  /* ------------------------------------------------------------------------ */
  /* Generative action handlers                                                */
  /* ------------------------------------------------------------------------ */

  const caseCodes = useMemo(
    () => caseInstance.expectedWorkup.map((w) => w.code.coding[0]?.code).filter((c): c is string => Boolean(c)),
    [caseInstance],
  );

  const handlers: ActionHandlers = {
    placeOrder: (action) => {
      const code = resolveOrderCode(action, caseCodes);
      const catalogued = getOrderableByCode(code);
      placeOrder(code, catalogued ? catalogued.label : { en: action.label, tr: action.label });
    },
    navigate: onNavigate,
    ask: (text) => void send(text),
    orderStatus: (action): OrderStatus => {
      const code = resolveOrderCode(action, caseCodes);
      const placed = state.orders.filter((o) => o.code === code);
      if (placed.length === 0) return { state: "none" };
      const open = placed.find((o) => !o.resolved);
      if (open) return { state: "pending", code, eta: lang === "tr" ? open.clinicalLabelTr : open.clinicalLabelEn };
      const imaging = state.results.some((r) => r.code === code && r.datumKind === "imaging");
      return { state: "resulted", code, imaging };
    },
  };

  const addOrderDraft = (o: Orderable) => {
    const action: OrderAction = { kind: "order", code: o.code, system: "local", label: lang === "tr" ? o.label.tr : o.label.en };
    setDrafts((d) => (d.some((x) => x.code === action.code) ? d : [...d, action]));
  };

  const askedIntents = useMemo(
    () => new Set(state.events.filter((e) => e.type === "question").map((e) => e.ref)),
    [state.events],
  );
  const examinedManeuvers = useMemo(
    () => new Set(state.events.filter((e) => e.type === "exam").map((e) => e.ref)),
    [state.events],
  );

  // Quick suggestions: the guidance's next history step first (when guidance is
  // on), then the catalogue's unasked questions in interview order.
  const quick = useMemo(() => {
    const out: QuestionIntent[] = [];
    if (guidanceOn && nba?.kind === "history" && nba.ref && !askedIntents.has(nba.ref)) out.push(nba.ref as QuestionIntent);
    for (const i of QUESTION_INTENTS) {
      if (out.length >= QUICK_COUNT) break;
      if (!askedIntents.has(i) && !out.includes(i)) out.push(i);
    }
    return out;
  }, [guidanceOn, nba, askedIntents]);
  const showQuick = !busy && draft.length === 0 && quick.length > 0 && !drawerOpen;

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,300px)]">
      <div className="flex min-w-0 flex-col gap-4">
        {/* Interview pane */}
        <section
          aria-label={t("ehr.tabs.interview")}
          className="flex h-[min(72dvh,46rem)] min-h-[30rem] min-w-0 flex-col overflow-hidden rounded-card border border-border bg-surface lg:h-[min(calc(100dvh-13rem),48rem)]"
        >
          <InterviewThread
            ref={scrollRef}
            messages={messages}
            patientName={caseInstance.patient.name}
            typing={busy}
            handlers={handlers}
            onStreamProgress={scrollToEnd}
            emptyTitle={t("chat.empty.title")}
            emptyBody={t("chat.empty.body")}
          />

          <SuggestionsDrawer
            id={drawerId}
            open={drawerOpen}
            onClose={() => {
              toggleDrawer(false);
              document.getElementById("acudx-ask")?.focus();
            }}
            intents={QUESTION_INTENTS}
            maneuvers={EXAM_MANEUVERS}
            intentLabel={intentLabel}
            maneuverLabel={maneuverLabel}
            asked={askedIntents}
            examined={examinedManeuvers}
            onAsk={askIntent}
            onExam={(m) => requestExam(m)}
          />

          <div className="border-t border-border bg-surface px-3 pb-3 pt-2.5 sm:px-5">
            {drafts.length > 0 ? (
              <div className="mb-2 flex flex-wrap gap-1.5" aria-label={t("chat.actions.draft")} role="group">
                {drafts.map((d) => (
                  <OrderChip
                    key={d.code}
                    action={d}
                    handlers={handlers}
                    startConfirming
                    onDismiss={() => setDrafts((all) => all.filter((x) => x.code !== d.code))}
                  />
                ))}
              </div>
            ) : null}

            {showQuick ? (
              <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label={t("chat.quick.label")}>
                {quick.map((i, n) => (
                  // Two suggestions below xl, three beside the call rail.
                  <span key={i} className={n >= 2 ? "contents max-xl:hidden" : "contents"}>
                    <AskChip text={t(questionKey(i))} onAsk={() => askIntent(i)} />
                  </span>
                ))}
              </div>
            ) : null}

            <Composer
              value={draft}
              onChange={setDraft}
              onSend={(text) => void send(text)}
              busy={busy}
              lang={lang === "tr" ? "tr" : "en"}
              maneuvers={EXAM_MANEUVERS}
              maneuverLabel={maneuverLabel}
              onSlashOrder={addOrderDraft}
              onSlashExam={(m) => requestExam(m)}
              onSlashGo={onNavigate ? (target) => onNavigate(target) : undefined}
              suggestionsOpen={drawerOpen}
              suggestionsId={drawerId}
              onToggleSuggestions={toggleDrawer}
              mic={{ supported: micSupported, listening: micListening, onToggle: () => void toggleMic() }}
              call={{ on: voiceOn, onToggle: callEntry }}
            />
          </div>
        </section>

        {/* Guidance toggle + cited hint */}
        <section className="rounded-card border border-border bg-surface p-3 sm:p-4">
          <label className="mb-2 inline-flex cursor-pointer items-center gap-2.5 rounded-full border border-border bg-surface px-3 py-1.5">
            <span className="text-sm font-medium text-fg">{t("encounter.guidance.toggle")}</span>
            <Switch checked={guidanceOn} onCheckedChange={onGuidanceChange} aria-label={t("encounter.guidance.toggle")} />
            <span className="text-xs text-muted">{t(guidanceOn ? "encounter.guidance.on" : "encounter.guidance.off")}</span>
          </label>
          {guidanceOn ? (
            <GuidanceCard hint={activeHint} lang={lang} abstained={guidanceAbstained} live={!grounding.unavailable} />
          ) : null}
          <p className="mt-2 flex items-center gap-1 text-[11px] text-muted">
            <BookOpen weight="bold" className="h-3 w-3" aria-hidden />
            {t("ehr.interview.extractionNote")}
          </p>
        </section>
      </div>

      {/* Patient presence: beside the pane from xl (pinned under the banner); below
          xl the chart rail takes the side, so it sits under the pane. */}
      <div
        ref={callRef}
        className="grid gap-4 md:grid-cols-2 xl:sticky xl:top-[10.5rem] xl:flex xl:max-h-[calc(100dvh-11.5rem)] xl:flex-col xl:overflow-y-auto xl:overscroll-contain xl:pe-1"
      >
        <PatientPresence
          caseInstance={caseInstance}
          vitals={vitals}
          utterance={lastPatientUtterance}
          learnerLine={lastLearnerLine}
          lang={lang}
          callContext={() => {
            // The live-video call answers from the same case state as the typed turn.
            const r = buildPatientTurnRequest("", null);
            return {
              case_state: r.case_state as Record<string, unknown>,
              persona: r.persona as Record<string, unknown> | undefined,
              case_context: r.case_context as Record<string, unknown> | undefined,
            };
          }}
          voiceOn={voiceOn}
          onToggleVoice={toggleVoice}
        />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Patient presence: the video-call tile beside the dialogue                    */
/* -------------------------------------------------------------------------- */

/**
 * PatientPresence: the person the learner is interviewing, as a call participant.
 * PatientCallTile owns the voice (gateway TTS through /api/v1/voice), the
 * audio-driven lip-sync or the realtime LiveKit video, the call controls and the
 * captions; the live clinical-sign chips sit beneath, tied to the current vitals.
 */
function PatientPresence({
  caseInstance,
  vitals,
  utterance,
  learnerLine,
  voiceOn,
  onToggleVoice,
  lang,
  callContext,
}: {
  caseInstance: CaseInstance;
  vitals: VitalsLike;
  utterance: string;
  learnerLine: string;
  voiceOn: boolean;
  onToggleVoice: () => void;
  lang: Lang;
  callContext?: () => PatientCallContext;
}) {
  const { t } = useTranslation();
  return (
    <>
      <PatientCallTile
        caseInstance={caseInstance}
        vitals={vitals}
        utterance={utterance}
        learnerLine={learnerLine}
        voiceOn={voiceOn}
        onToggleVoice={onToggleVoice}
        lang={lang}
        encounterId={caseInstance.id}
        callContext={callContext}
      />
      <section className="self-start rounded-card border border-border bg-surface p-3">
        <SectionLabel className="mb-1.5">
          {t("ehr.interview.patient.presentation", { defaultValue: "Presentation" })}
        </SectionLabel>
        <SymptomSummary vitals={vitals} variant="pills" />
      </section>
    </>
  );
}
