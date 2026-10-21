# 05 Interview chat, October 2026

**Status:** implemented in `web/` (HANDOFF at the end). Owner: product designer and frontend engineer for the patient chat. Tokens, theme and shell are unchanged; requests for them are listed in section 7.

## 1. What the owner asked for

- "better chat ui and in chat button generation for tests and redirection to needed parts like openai intelligent ui"
- "better chat ui use mobbin connector"
- "ui looks too ai generated"
- "the chat only answers if u click the question from question list not direct questions"

## 2. The defect: typed questions went unanswered

Three paths in the old `InterviewTab` dropped or deflected a typed message while a clicked catalogue question always answered:

1. **Live mode blocked soft classes on the client.** The client Scope Guard flagged a message `off-topic` or `answer-seeking` and showed a notice only. The message never reached `/v1/patient/turn`, even though the server is built to answer those classes in character with a directive. A misclassified clinical question (the client lexicon is stem based; "last night" hits the red-flag stem "night") produced no patient line at all.
2. **Offline off-topic and answer-seeking produced no transcript line.** The learner's words vanished; only a dismissible notice under the composer said why.
3. **A degraded gateway** (the 200 with the scripted deflection) fell back to the same offline path, so the learner saw (2).

Fix: one send path, `web/src/lib/interviewSend.ts` `routeMessage`, used by typed text, drawer suggestions, quick suggestions and follow-up chips alike.

- The learner's line appears at once with "Sending" (optimistic), so nothing typed disappears.
- Live: every soft class goes to the persona; only injection and unsafe stay deterministic in the browser. The reply's `actions` and `guard` ride along on the patient turn.
- Offline or degraded: in-scope with an intent is answered by the reveal graph, without an intent by a clarifying line; a greeting by a greeting; off-topic and answer-seeking by an in-character line plus an attending note (persisted in the transcript).
- A catalogue suggestion now sends a natural question ("Which medicines do you take?", EN and TR in `chat.questions.*`) with its intent, so it skips classification but takes exactly the same route.

`web/src/lib/interviewSend.test.ts` pins this: a typed question and a clicked one reach the same reveal call; off-topic always yields a line and a note; injection never reaches the persona; degraded and thrown calls fall back.

## 3. Design

### 3.1 References pulled from Mobbin

Platform web unless noted. Epic MyChart, Epic Haiku, Doximity and Perplexity follow-ups were searched; Epic and Doximity are not on Mobbin, so the clinical messaging references are the closest health products (Hims, Hers, Ro, Oura) and the enterprise messengers clinicians actually use (Microsoft Teams, Intercom inbox).

| # | Product and screen | Screen id | Taken |
|---|---|---|---|
| 1 | Microsoft Teams, 1:1 chat | `fefa27b5-4aa5-4273-ab00-0cf074e2a065` | Date and time separators, speaker grouping (one avatar per run), call and video entry points in the conversation header. |
| 2 | Microsoft Teams, chat with rich card | `e388d6c6-3b8e-4c4b-b495-06f86a188128` | Structured content inside a message (tables, cards) without leaving the thread. Basis for findings and order chips inline. |
| 3 | Intercom, inbox conversation | `263e8cd0-fe59-4845-b7db-b0b6e957d292` | A dense, work-tool transcript beside a details rail; composer with a shortcut hint line. The interview pane plus the patient call rail follows this split. |
| 4 | Intercom, workflow reply buttons | `7fd35892-7d87-465c-8ed2-cb2985254a0d` | Reply buttons attached to a bot message. Basis for ask chips under the reply that carried them. |
| 5 | ChatGPT, product widget in a reply | `740b0b9f-805d-46c6-86c1-de07d8b5907b` | A generated component inside the answer with its own two actions. Basis for the order chip's confirm step living inside the line. |
| 6 | ChatGPT, map widget in a reply | `8d4927c2-a6f0-4a5a-aed4-b90f85a2fc1a` | Widgets sit at the reading measure under the text, not full bleed. |
| 7 | Gumloop, agent asks for input | `a0c0e7b0-88bb-4a89-904a-d88ee892a8dd` | Inline confirm or reject inside the transcript; status shown in the same block after the choice. |
| 8 | Perplexity, question card | `fcdd9e2e-8b53-4f64-9597-cbefe3473b93` | Keyboard first choice list with numbered rows and a Continue shortcut. Basis for the slash menu's arrow and Enter behaviour. |
| 9 | Deputy, chat with slash command | `6d957f33-8758-4566-b33f-43f4b01193fb` | `/command` typed straight into the composer of a work messenger. |
| 10 | Mistral Le Chat, "/" quick access | `59fefe27-6645-4531-af2a-ee30c713fa45` | A compact command list anchored to the composer with icons and chevrons. |
| 11 | ClickUp, composer command menu | `13ed16fa-4223-44b0-a71e-ba5e15a58c7b` | Grouped command menu above the composer; small icon plus label rows. |
| 12 | Zapier chatbot, suggested messages | `f275f618-b9cf-47ce-8fee-e784a4cf9e45` | Suggested messages docked right above the composer. Basis for the quick suggestions row. |
| 13 | Oura (iOS), medical chat | `65bcdd03-2d10-4b33-9482-f0fc04263e27` | A health assistant line with a role caption ("Advisor") under the name, and a disclaimer near the composer. Basis for the role line in the speaker header. |
| 14 | Ro (iOS), clinician message | `3a5bdd3c-4e3c-41f3-a261-06c93b3ed47e` | A clinician message as a headed card (name, timestamp) rather than a bubble. Supports the transcript layout over bubbles. |
| 15 | Hers (iOS), care team thread | `10abe866-8ae0-4ddc-b370-1f78c2937fa1` | Plain care team messaging with timestamps; confirmed the calm, low-chrome tone. |

Not taken on purpose: gradient hero composers (Langdock, Sana), sparkle icons, purple brand bubbles (Hims, Teams self bubbles), emoji reactions.

### 3.2 Why it no longer reads as "AI generated"

The old pane was a generic chatbot: rounded bubbles left and right, the accent fill on every learner line, a chip cloud as the main input. The new pane reads as a clinical record:

- **Transcript, not bubbles.** Every line is left aligned under a header (avatar, name, role, sim time) at a 68 character measure. Learner lines sit on a faint inset band so questions scan down the left edge. Rules between speaker runs, 2 px corners, the Ward ink tokens only.
- **Roles that exist in a ward.** Patient (initials avatar, the patient's name as the role), You (stethoscope on cobalt), Nurse (result call-ins, with a jump to the result), Attending (scope notes, on ink). No assistant persona, no sparkle.
- **Sim time on every header** in Geist Mono, `T+mm:ss` from the encounter clock, with an accessible label.
- **Free text first.** The composer is the primary control; the catalogue is a drawer.

### 3.3 Composer and suggestions

- `Composer` (`web/src/components/chat/Composer.tsx`): growing textarea (the placeholder string is unchanged, so e2e suites and capture scripts keep working), Enter sends, Shift+Enter breaks the line. `/` opens a combobox listbox: `/order <test>` searches the order catalogue and stages an order draft above the composer in its confirm step; `/exam <manoeuvre>` performs it; `/go <section>` opens a chart tab; `/ask` opens the drawer. Arrow keys, Enter or Tab, Escape.
- Toolbar: Suggestions toggle (`aria-expanded`), dictation, the voice-call entry point (turns spoken replies on and brings the call tile into view) and Send.
- `SuggestionsDrawer`: history questions and examination manoeuvres with a filter, done state per item, Escape returns to the composer. Collapsed by default; the choice is remembered per viewer in localStorage (convenience only).
- Quick suggestions: two (phone) or three unasked questions above the composer, the guidance's next history step first when guidance is on. They send through the same path.

### 3.4 Generative components (`MessageActions`)

Rendered under the line whose reply carried them, only from validated `actions`:

- **Order chip.** One click opens an inline confirm ("Place Troponin I?" with Place order and Cancel; Escape cancels; focus moves to Place order). After placing, the chip follows the store: pending with the clinical ETA, then resulted with View result, which opens Results (or Imaging) on that test. Codes resolve to the case's own code, else to the catalogue code (`catalogCodeFor`, so LOINC 36643-5 and "chest X-ray" both become `cxr`).
- **Navigate button.** Opens Results, Imaging, Orders, Vitals (Flowsheets), Notes (Chart Review), Diagnosis (Problem List) or Guide, then scrolls to and flashes the item named by `ref` (`data-chart-ref` on Results panels, pending results and the Orders tracker; `web/src/lib/chartFocus.ts`, Web Animations, no timers). Hidden where the pane cannot navigate (Rooms).
- **Ask chip.** A follow-up question; sends through the send path.
- **Guard note.** An attending aside with a caution rule, never a red error box.

Nurse lines are derived from resolved results (normal, abnormal, critical tone) and carry a navigate action to that result. Examination lines list the revealed findings inline.

### 3.5 Streaming, typing, motion

The newest patient reply reveals word by word on animation frames (no timers); the full text is in the accessibility tree once so screen readers do not hear every frame. A typing row shows while a reply is in flight. Reduced motion renders text at once and jumps scrolls.

## 4. Contract (client side)

`web/src/lib/chatActions.ts` owns the types and validators; `PatientTurnResult` in `web/src/lib/backend.ts` gained `actions?: unknown` and a `guard` that is either the scope verdict or `{ label, note? }`.

```ts
actions: Array<
  | { kind: "order"; code: string; system: "LOINC" | "RADLEX" | "local"; label: string }
  | { kind: "navigate"; target: "results" | "imaging" | "orders" | "vitals" | "notes" | "diagnosis" | "guide"; ref?: string }
  | { kind: "ask"; text: string }
>
guard: { label: string; note?: string }
```

Unknown kinds, missing fields and wrong types are dropped; at most 8 actions render; duplicates collapse. The older verdict shape (`{ cls, score, rationale }`) yields no note. `DialogueTurn` in the encounter store carries `actions` and `guard` so they survive tab switches and remounts.

## 5. Accessibility

- The thread is `role="log"` (polite, additions), focusable for keyboard scrolling. Every message is a list item that starts with its speaker, visible or sr-only.
- Composer: `role="combobox"` with `aria-controls`, `aria-activedescendant`, `aria-expanded`; options are `role="option"` with `aria-selected`.
- Order confirm is a labelled group; focus moves to the confirm and back to the chip on cancel.
- Axe (WCAG 2.2 AA tags) on the transcript and composer has no serious or critical finding at 375, 768, 1024 and 1440 px.

## 6. Screens

`docs/design/chat-shots/` from `web/e2e/chat.spec.ts`: `offline-<w>.png` (typed questions, off-topic note, drawer, `/exam`), `live-confirm-<w>.png` (order confirm inside the line) and `live-<w>.png` (pending order, follow-up sent, guard note) for w in 375, 768, 1024, 1440.

## 7. Requests to the token and shell owner

- A `--motion-flash` duration token for highlight flashes (chartFocus uses 2400 ms inline).
- A shadow token for popovers anchored above inputs (the slash menu uses `--shadow-pop`, which works but carries a 1 px ring the menu border already draws).
- `scripts/design/capture-readme.mjs` and `capture-renewal.mjs` click "Recheck vitals" and "Auscultate lungs" directly; those now live in the Suggestions drawer (open it first). The acceptance specs under `web/e2e/acceptance/` need the same one-line change.

## 8. HANDOFF

See the HANDOFF block in the commit message and the session report; it is repeated here.

```
HANDOFF Designer + Frontend engineer (chat) -> Orchestrator
Goal: an Epic-grade interview pane with free text first, one send path, and inline generative components from the reply's actions.
Done: web/src/lib/chatActions.ts, chartFocus.ts, interviewSend.ts (+ tests); web/src/components/chat/* (InterviewThread, MessageActions, Composer, SuggestionsDrawer, StreamingText, chatRender.test.ts); web/src/components/ehr/tabs/InterviewTab.tsx rewritten on them; ActivityTabs passes onNavigate; data-chart-ref anchors in ResultsTab and OrdersTab; DialogueTurn actions and guard in encounterStore; PatientTurnResult actions and guard union in backend.ts; i18n chat.en.json and chat.tr.json; e2e/chat.spec.ts; encounter.spec.ts opens the drawer for exam buttons; docs/design/05-chat.md and chat-shots/.
Verified by: see the session report.
Open: server must send actions and guard { label, note? } on /v1/patient/turn; offline reveal graph still answers a question with no matching history item (for example allergies in an NKDA case) with a clarify line; client scope guard stems misread "last night" as a red flag.
Next: when the server contract lands, run e2e/chat.spec.ts against a live gateway and drop the route mocks in its live test.
```
