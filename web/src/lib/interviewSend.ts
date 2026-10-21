/**
 * The interview's ONE send path (docs/design/05-chat.md section 2).
 *
 * Typed text, a drawer suggestion, a quick suggestion and a follow-up chip all
 * go through `routeMessage`. A catalogue suggestion carries its intent and skips
 * classification; free text is classified by the client Scope Guard first.
 *
 *  Live (gateway reachable): every soft class (greeting, in-scope, off-topic,
 *  answer-seeking) is sent to /v1/patient/turn; the reply's `actions` and
 *  `guard` ride along on the patient turn. Injection and unsafe never leave the
 *  browser. A failed or degraded reply falls back to the offline route.
 *
 *  Offline: an in-scope question with an intent is answered by the reveal
 *  graph; one without an intent gets a clarifying reply; a greeting gets a
 *  greeting; off-topic and answer-seeking get an in-character reply with an
 *  attending note. Nothing typed is ever dropped without a visible answer.
 *
 * Pure orchestration over injected dependencies, so it is unit-tested without
 * React or the store (lib/interviewSend.test.ts).
 */

import type { QuestionIntent } from "@/domain/case";
import type { UtteranceClass } from "@/domain/scopeGuard";
import { parseChatActions, parseChatGuard, type ChatAction, type ChatGuard } from "@/lib/chatActions";

export type SoftGuardClass = Extract<UtteranceClass, "off-topic" | "answer-seeking">;
export type HardGuardClass = Extract<UtteranceClass, "injection" | "unsafe">;

export interface Bilingual {
  en: string;
  tr: string;
}

/** The parts of a /v1/patient/turn reply the route reads. */
export interface PatientReply {
  utterance: string;
  state_advance?: boolean;
  guard?: unknown;
  actions?: unknown;
  degraded: boolean;
}

export interface SendDeps {
  live: boolean;
  classify: (text: string) => { class: UtteranceClass; score: number; rationale: string };
  inferIntent: (text: string) => QuestionIntent | null;
  /** Reveal-graph question (offline answer, or the live persona's voiced reveal). */
  askQuestion: (intent: QuestionIntent, opts: { utterance: string; voiced?: boolean }) => void;
  /** Persist a learner line + patient reply (with actions and guard). */
  recordExchange: (input: {
    doctorText: string;
    patient: Bilingual;
    source: "live" | "offline";
    actions?: ChatAction[];
    guard?: ChatGuard;
  }) => void;
  logGuard: (cls: SoftGuardClass | HardGuardClass, text: string, score: number, rationale: string) => void;
  /** Call the persona; resolve null on any transport failure. */
  patientTurn: (text: string, intent: QuestionIntent | null) => Promise<PatientReply | null>;
  greeting: () => Bilingual;
  clarify: () => Bilingual;
  softReply: (cls: SoftGuardClass) => { patient: Bilingual; guard: ChatGuard };
}

/** How a message was answered (for tests and telemetry). */
export type RouteOutcome =
  | "reveal"
  | "greeting"
  | "clarify"
  | "soft-guard"
  | "hard-guard"
  | "live"
  | "empty";

function isSoft(c: UtteranceClass): c is SoftGuardClass {
  return c === "off-topic" || c === "answer-seeking";
}

/** The offline route (also the live fallback). */
export function routeOffline(text: string, deps: SendDeps, intentHint?: QuestionIntent): RouteOutcome {
  if (intentHint) {
    deps.askQuestion(intentHint, { utterance: text });
    return "reveal";
  }
  const v = deps.classify(text);
  switch (v.class) {
    case "greeting":
      deps.recordExchange({ doctorText: text, patient: deps.greeting(), source: "offline" });
      return "greeting";
    case "in-scope": {
      const intent = deps.inferIntent(text);
      if (intent) {
        deps.askQuestion(intent, { utterance: text });
        return "reveal";
      }
      deps.recordExchange({ doctorText: text, patient: deps.clarify(), source: "offline" });
      return "clarify";
    }
    case "off-topic":
    case "answer-seeking": {
      deps.logGuard(v.class, text, v.score, v.rationale);
      const r = deps.softReply(v.class);
      deps.recordExchange({ doctorText: text, patient: r.patient, source: "offline", guard: r.guard });
      return "soft-guard";
    }
    case "injection":
    case "unsafe":
      deps.logGuard(v.class, text, v.score, v.rationale);
      return "hard-guard";
  }
}

/** Route one learner message through the live or offline path. */
export async function routeMessage(
  raw: string,
  deps: SendDeps,
  opts: { intent?: QuestionIntent } = {},
): Promise<RouteOutcome> {
  const text = raw.trim();
  if (!text) return "empty";
  if (!deps.live) return routeOffline(text, deps, opts.intent);

  let cls: UtteranceClass = "in-scope";
  let softGuard: { patient: Bilingual; guard: ChatGuard } | null = null;
  if (!opts.intent) {
    const v = deps.classify(text);
    cls = v.class;
    if (cls === "injection" || cls === "unsafe") return routeOffline(text, deps);
    if (isSoft(cls)) {
      deps.logGuard(cls, text, v.score, v.rationale);
      softGuard = deps.softReply(cls);
    }
  }
  const intent = opts.intent ?? (cls === "in-scope" ? deps.inferIntent(text) : null);

  let reply: PatientReply | null = null;
  try {
    reply = await deps.patientTurn(text, intent);
  } catch {
    reply = null;
  }
  if (!reply || reply.degraded || !reply.utterance.trim()) {
    if (softGuard) {
      deps.recordExchange({ doctorText: text, patient: softGuard.patient, source: "offline", guard: softGuard.guard });
      return "soft-guard";
    }
    return routeOffline(text, deps, opts.intent);
  }

  const actions = parseChatActions(reply.actions);
  const guard = parseChatGuard(reply.guard) ?? softGuard?.guard;
  deps.recordExchange({
    doctorText: text,
    patient: { en: reply.utterance, tr: reply.utterance },
    source: "live",
    ...(actions.length ? { actions } : {}),
    ...(guard ? { guard } : {}),
  });
  // The question the persona answered is revealed and steps the Director
  // (voiced: the narrator's line is not added on top of the persona's reply).
  if (intent && reply.state_advance !== false) deps.askQuestion(intent, { utterance: text, voiced: true });
  return "live";
}
