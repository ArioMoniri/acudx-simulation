/**
 * Generative chat actions: the `actions` and `guard` a patient turn reply can
 * carry (POST /v1/patient/turn, built server-side in parallel), and the client
 * helpers that turn them into inline components in the interview thread.
 *
 * Wire contract (docs/design/05-chat.md section 4):
 *
 *   actions: Array<
 *     | { kind: "order"; code; system: "LOINC" | "RADLEX" | "local"; label }
 *     | { kind: "navigate"; target: "results" | "imaging" | "orders" | "vitals"
 *                                   | "notes" | "diagnosis" | "guide"; ref? }
 *     | { kind: "ask"; text }
 *   >
 *   guard: { label; note? }
 *
 * The parsers are defensive: an unknown kind, a missing field or a wrong type is
 * dropped rather than rendered, so a partial server rollout never breaks the
 * thread. parseChatGuard reads a display-shaped `{ label, note? }`; the server's
 * InterviewGuard (`{ label: GuardLabel, reason, note? }`) is mapped to it by the
 * send path with a localized label (lib/interviewSend.ts).
 *
 * Pure module: no React, no store.
 */

import { ORDERABLES, catalogCodeFor, type Orderable } from "@/domain/orderables";
import type { ExamManeuver, QuestionIntent } from "@/domain/case";
import type {
  InterviewAction as ChatAction,
  NavigateTarget,
  OrderAction,
  OrderCodeSystem,
} from "@/lib/api/interview";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

// The action types are the server contract's own (lib/api/interview.ts,
// docs/architecture/20-chat-contract.md section 5); re-exported here for the chat UI.
export type {
  OrderCodeSystem,
  NavigateTarget,
  OrderAction,
  NavigateAction,
  AskAction,
  InterviewAction as ChatAction,
} from "@/lib/api/interview";

/**
 * A guard note as the thread shows it: a display label (localized from the
 * server's GuardLabel) and the server's note in the reply locale.
 */
export interface ChatGuard {
  label: string;
  note?: string;
}

export const NAVIGATE_TARGETS: readonly NavigateTarget[] = [
  "results",
  "imaging",
  "orders",
  "vitals",
  "notes",
  "diagnosis",
  "guide",
];

const SYSTEMS: readonly OrderCodeSystem[] = ["LOINC", "RADLEX", "local"];

/** Upper bound on rendered actions per reply (a runaway model cannot flood the thread). */
export const MAX_ACTIONS = 8;

/* -------------------------------------------------------------------------- */
/* Parsing                                                                     */
/* -------------------------------------------------------------------------- */

function str(v: unknown, max = 200): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

/** One wire action, validated; null when it does not match the contract. */
export function parseChatAction(raw: unknown): ChatAction | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  switch (r.kind) {
    case "order": {
      const code = str(r.code, 64);
      const label = str(r.label, 120);
      const system = SYSTEMS.includes(r.system as OrderCodeSystem)
        ? (r.system as OrderCodeSystem)
        : "local";
      if (!code || !label) return null;
      return { kind: "order", code, system, label };
    }
    case "navigate": {
      if (!NAVIGATE_TARGETS.includes(r.target as NavigateTarget)) return null;
      const ref = str(r.ref, 64);
      return { kind: "navigate", target: r.target as NavigateTarget, ...(ref ? { ref } : {}) };
    }
    case "ask": {
      const text = str(r.text, 160);
      return text ? { kind: "ask", text } : null;
    }
    default:
      return null;
  }
}

/** The reply's `actions`, validated and de-duplicated, capped at MAX_ACTIONS. */
export function parseChatActions(raw: unknown): ChatAction[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatAction[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const a = parseChatAction(item);
    if (!a) continue;
    const key = actionKey(a);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
    if (out.length >= MAX_ACTIONS) break;
  }
  return out;
}

/** A stable identity for an action (React key, de-duplication). */
export function actionKey(a: ChatAction): string {
  switch (a.kind) {
    case "order":
      return `order:${a.system}:${a.code}`;
    case "navigate":
      return `navigate:${a.target}:${a.ref ?? ""}`;
    case "ask":
      return `ask:${a.text.toLowerCase()}`;
  }
}

/**
 * The reply's `guard`. The new contract is `{ label, note? }`; the gateway's
 * earlier verdict shape (`{ cls, score, rationale }`) carries no learner-facing
 * text, so it yields null (the client guard supplies the note for soft classes).
 */
export function parseChatGuard(raw: unknown): ChatGuard | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const label = str(r.label, 80);
  if (!label) return null;
  const note = str(r.note, 400);
  return note ? { label, note } : { label };
}

/* -------------------------------------------------------------------------- */
/* Navigation                                                                  */
/* -------------------------------------------------------------------------- */

/** The chart tab (ActivityTabs key) each navigate target opens. */
export const NAVIGATE_TAB: Record<NavigateTarget, string> = {
  results: "results",
  imaging: "results",
  orders: "orders",
  vitals: "flowsheets",
  notes: "chart-review",
  diagnosis: "problem-list",
  guide: "guidance",
};

export function tabForTarget(target: NavigateTarget): string {
  return NAVIGATE_TAB[target];
}

/* -------------------------------------------------------------------------- */
/* Orders                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The code an order action is placed under: the case's own code when the case
 * authored it, else the catalogue code of the same test (LOINC 36643-5 and
 * "chest X-ray" both resolve to the catalogue "cxr"), else the code as sent.
 */
export function resolveOrderCode(action: Pick<OrderAction, "code" | "label">, caseCodes: Iterable<string> = []): string {
  for (const c of caseCodes) if (c === action.code) return c;
  return catalogCodeFor(action.code, action.label);
}

/** Catalogue orderables whose label or code matches the query (slash /order). */
export function searchOrderables(query: string, limit = 6, catalogue: readonly Orderable[] = ORDERABLES): Orderable[] {
  const q = query.trim().toLowerCase();
  if (!q) return catalogue.slice(0, limit);
  const starts: Orderable[] = [];
  const contains: Orderable[] = [];
  for (const o of catalogue) {
    const en = o.label.en.toLowerCase();
    const tr = o.label.tr.toLowerCase();
    const panel = (o.panel ?? "").toLowerCase();
    if (en.startsWith(q) || tr.startsWith(q) || panel.startsWith(q) || o.code.toLowerCase() === q) starts.push(o);
    else if (en.includes(q) || tr.includes(q) || panel.includes(q)) contains.push(o);
  }
  return [...starts, ...contains].slice(0, limit);
}

/* -------------------------------------------------------------------------- */
/* Slash commands                                                              */
/* -------------------------------------------------------------------------- */

export type SlashCommandName = "order" | "exam" | "go" | "ask";

export const SLASH_COMMANDS: readonly SlashCommandName[] = ["order", "exam", "go", "ask"];

export interface ParsedSlash {
  /** The command being typed; null while only "/" or an unknown prefix is typed. */
  command: SlashCommandName | null;
  /** Commands whose name starts with what was typed (the menu while no space yet). */
  candidates: SlashCommandName[];
  /** The text after "/command ". */
  arg: string;
  /** True once a space follows the command name (argument mode). */
  hasArg: boolean;
}

/** Parse the composer draft as a slash command; null when it is not one. */
export function parseSlash(draft: string): ParsedSlash | null {
  if (!draft.startsWith("/")) return null;
  const body = draft.slice(1);
  const space = body.search(/\s/);
  const name = (space < 0 ? body : body.slice(0, space)).toLowerCase();
  const arg = space < 0 ? "" : body.slice(space + 1);
  const exact = SLASH_COMMANDS.find((c) => c === name) ?? null;
  const candidates = SLASH_COMMANDS.filter((c) => c.startsWith(name));
  return { command: exact, candidates, arg, hasArg: space >= 0 };
}

/** Navigate targets whose (localized) label or key matches the query. */
export function matchTargets(query: string, labelOf: (t: NavigateTarget) => string): NavigateTarget[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...NAVIGATE_TARGETS];
  return NAVIGATE_TARGETS.filter((t) => t.startsWith(q) || labelOf(t).toLowerCase().includes(q));
}

/** Exam maneuvers whose localized label or key matches the query. */
export function matchManeuvers(
  query: string,
  maneuvers: readonly ExamManeuver[],
  labelOf: (m: ExamManeuver) => string,
): ExamManeuver[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...maneuvers];
  return maneuvers.filter((m) => m.includes(q) || labelOf(m).toLowerCase().includes(q));
}

/* -------------------------------------------------------------------------- */
/* Catalogue questions                                                         */
/* -------------------------------------------------------------------------- */

/** The i18n key of the natural question sent when a catalogue intent is picked. */
export function questionKey(intent: QuestionIntent): string {
  return `chat.questions.${intent.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())}`;
}
