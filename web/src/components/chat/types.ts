import type { ChatAction, ChatGuard, NavigateTarget, OrderAction } from "@/lib/chatActions";

/** Who speaks a thread line. The learner is "You"; nurse and attending are system roles. */
export type Speaker = "learner" | "patient" | "nurse" | "attending";

/** An examination finding shown under the learner's "Examined: ..." line. */
export interface ThreadFinding {
  id: string;
  system: string;
  finding: string;
  abnormal: boolean;
}

/** One line of the interview thread, already localized. */
export interface ThreadMessage {
  id: string;
  speaker: Speaker;
  text: string;
  /** Encounter-clock offset (sim ms) the line was logged at; null while sending. */
  at: number | null;
  /** Monotonic encounter sequence, for ordering. */
  seq: number;
  /** Learner lines only: the history intent a typed question was matched to. */
  intent?: string;
  /** Patient lines only: affect caption shown at the end of a patient group. */
  affect?: string;
  /** Generative components rendered under the line. */
  actions?: ChatAction[];
  /** Guard note carried by the reply (rendered as an attending note). */
  guard?: ChatGuard;
  /** The learner's line has not been answered yet. */
  status?: "sending";
  /** Reveal the text progressively (the newest patient reply). */
  stream?: boolean;
  /** Nurse result lines: clinical state of the result. */
  tone?: "normal" | "abnormal" | "critical";
  /** Learner examination lines: the findings the manoeuvre revealed. */
  findings?: ThreadFinding[];
  /** Learner examination lines: findings still being written. */
  awaiting?: boolean;
}

/** What the inline generative components can do, supplied by the interview pane. */
export interface ActionHandlers {
  /** Place an order (after the learner confirmed it). */
  placeOrder: (action: OrderAction) => void;
  /** Open a chart section and highlight `ref`. Absent: navigate buttons are hidden. */
  navigate?: (target: NavigateTarget, ref?: string) => void;
  /** Send a follow-up question through the composer's send path. */
  ask: (text: string) => void;
  /** Live order state for an order action (pending, resulted, ETA label). */
  orderStatus: (action: OrderAction) => OrderStatus;
}

export type OrderStatus =
  | { state: "none" }
  | { state: "pending"; eta: string; code: string }
  | { state: "resulted"; code: string; imaging: boolean };
