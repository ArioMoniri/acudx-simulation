import { describe, expect, it, beforeAll } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import i18next, { type i18n as I18n } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";

import enBase from "@/i18n/locales/en.json";
import chatEn from "@/i18n/features/chat.en.json";
import { MessageActions } from "./MessageActions";
import { InterviewThread } from "./InterviewThread";
import type { ActionHandlers, OrderStatus, ThreadMessage } from "./types";
import type { ChatAction, OrderAction } from "@/lib/chatActions";

/**
 * Rendering of the generative components (docs/design/05-chat.md section 3.4):
 * every action kind from the reply renders as its own control, order chips
 * follow the order's live state, navigate buttons only render when the pane can
 * navigate, and the thread labels every line with its speaker.
 */

let i18n: I18n;

beforeAll(async () => {
  i18n = i18next.createInstance();
  await i18n.use(initReactI18next).init({
    lng: "en",
    resources: { en: { translation: { ...enBase, chat: chatEn.chat } } },
    interpolation: { escapeValue: false },
  });
});

function render(el: ReactElement): string {
  return renderToStaticMarkup(createElement(I18nextProvider, { i18n }, el));
}

function handlers(status: OrderStatus = { state: "none" }, navigate = true): ActionHandlers {
  return {
    placeOrder: () => {},
    ask: () => {},
    orderStatus: () => status,
    ...(navigate ? { navigate: () => {} } : {}),
  };
}

const ORDER: OrderAction = { kind: "order", code: "10839-9", system: "LOINC", label: "Troponin I" };
const ACTIONS: ChatAction[] = [
  ORDER,
  { kind: "navigate", target: "vitals" },
  { kind: "ask", text: "Did anything bring it on?" },
];

describe("MessageActions", () => {
  it("renders one control per action kind", () => {
    const html = render(createElement(MessageActions, { actions: ACTIONS, handlers: handlers() }));
    expect(html).toContain('aria-label="Order Troponin I"');
    expect(html).toContain('data-order-state="none"');
    expect(html).toContain("LOINC");
    expect(html).toContain("Open Vitals");
    expect(html).toContain("Did anything bring it on?");
    expect(html).toContain("Follow up");
    expect(html).toContain('role="group"');
  });

  it("shows the pending state with its ETA", () => {
    const html = render(
      createElement(MessageActions, { actions: [ORDER], handlers: handlers({ state: "pending", eta: "45 min", code: "10839-9" }) }),
    );
    expect(html).toContain('data-order-state="pending"');
    expect(html).toContain("Pending, 45 min");
    expect(html).not.toContain('aria-label="Order Troponin I"');
  });

  it("shows the resulted state with a View result jump", () => {
    const html = render(
      createElement(MessageActions, {
        actions: [ORDER],
        handlers: handlers({ state: "resulted", code: "10839-9", imaging: false }),
      }),
    );
    expect(html).toContain('data-order-state="resulted"');
    expect(html).toContain("Resulted");
    expect(html).toContain("View result");
  });

  it("hides navigate buttons when the pane cannot navigate", () => {
    const html = render(createElement(MessageActions, { actions: ACTIONS, handlers: handlers({ state: "none" }, false) }));
    expect(html).not.toContain("Open Vitals");
    expect(html).toContain("Order Troponin I");
  });

  it("renders nothing for an empty list", () => {
    expect(render(createElement(MessageActions, { actions: [], handlers: handlers() }))).toBe("");
  });
});

describe("InterviewThread", () => {
  const messages: ThreadMessage[] = [
    { id: "d1", speaker: "learner", text: "When did the pain start?", at: 65_000, seq: 1, intent: "Onset" },
    {
      id: "p1",
      speaker: "patient",
      text: "This morning.",
      at: 66_000,
      seq: 1,
      affect: "Anxious",
      actions: ACTIONS,
      guard: { label: "Off topic", note: "Back to the complaint." },
    },
    { id: "p2", speaker: "patient", text: "Around six.", at: 66_000, seq: 1 },
    { id: "r1", speaker: "nurse", text: "Troponin I has resulted.", at: 900_000, seq: 4, tone: "critical" },
    { id: "pending", speaker: "learner", text: "Any nausea?", at: 905_000, seq: 9, status: "sending" },
  ];

  it("labels every line with its speaker and sim time", () => {
    const html = render(
      createElement(InterviewThread, {
        messages,
        patientName: "Deniz Arslan",
        typing: true,
        handlers: handlers(),
        emptyTitle: "Start",
        emptyBody: "Ask",
      }),
    );
    expect(html).toContain('role="log"');
    expect(html).toContain('aria-label="Encounter transcript"');
    expect(html).toContain(">You<");
    expect(html).toContain(">Patient<");
    expect(html).toContain("Deniz Arslan");
    expect(html).toContain(">Nurse<");
    expect(html).toContain("T+01:05");
    expect(html).toContain('aria-label="Simulation time 01:05"');
    expect(html).toContain('data-initials="DA"');
    // The grouped second patient line carries an sr-only speaker label.
    expect(html).toMatch(/<span class="sr-only">Patient<\/span>/);
    expect(html).toContain("Sending");
    expect(html).toContain('data-testid="guard-note"');
    expect(html).toContain('data-testid="typing-indicator"');
    expect(html).toContain("Order Troponin I");
  });

  it("shows the empty state before the first line", () => {
    const html = render(
      createElement(InterviewThread, {
        messages: [],
        patientName: "Deniz Arslan",
        typing: false,
        handlers: handlers(),
        emptyTitle: "Start the interview",
        emptyBody: "Ask in your own words",
      }),
    );
    expect(html).toContain("Start the interview");
  });
});
