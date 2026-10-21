import { buildClips, sourceTimeOf, spliceInsert, TIMELINE, type Segment } from "./timeline";
import type { Caption } from "./Stage";

/**
 * Hand-picked spans of the same recording for the short cuts (Teaser, Square).
 * Each span is anchored on timeline labels, so a re-recording keeps the cut.
 * A pick with `insert` is a spliced clip (the live call) of `seconds` output seconds.
 */
interface Pick {
  chapter: string;
  title: string;
  text: string;
  from?: RegExp;
  before?: number;
  to?: RegExp;
  after?: number;
  rate?: number;
  insert?: string;
  seconds?: number;
}

const at = (label: RegExp) => sourceTimeOf(TIMELINE, label);

/** `target`: output seconds of the recorded spans; every rate is scaled by one factor to fit. Inserts keep their length. */
function cut(picks: Pick[], target?: number): { segments: Segment[]; captions: Caption[] } {
  const rec = picks.filter((p) => !p.insert);
  const spans = rec.map((p) => ({
    chapter: p.chapter,
    src0: at(p.from!) - (p.before ?? 0),
    src1: at(p.to ?? p.from!) + (p.after ?? 0),
    rate: p.rate ?? 1,
  }));
  const natural = spans.reduce((s, c) => s + (c.src1 - c.src0) / c.rate, 0);
  const k = target ? natural / target : 1;
  // An insert holds its place in the chapter order with a one-frame span, then is spliced in.
  const ordered = picks.map((p) => (p.insert ? { chapter: p.chapter, src0: 0, src1: 0.04, rate: 1 } : spans[rec.indexOf(p)]));
  let segments = buildClips(ordered.map((c, i) => (picks[i].insert ? c : { ...c, rate: c.rate * k })));
  for (const p of picks) if (p.insert) segments = spliceInsert(segments, p.chapter, p.insert, p.seconds ?? 4);
  const captions = picks.map((p) => ({ chapter: p.chapter, title: p.title, lines: [{ text: p.text }] }));
  return { segments, captions };
}

const GENERATE: Pick = {
  chapter: "generate",
  title: "Generate",
  text: "Every case is written by the model on request",
  from: /^Opening streams in$/,
  before: 0.2,
  to: /^Layers written for this patient$/,
  after: 2.2,
  rate: 1.6,
};
const CHART: Pick = {
  chapter: "chart",
  title: "Chart",
  text: "Model generated, inside a real EHR",
  from: /^Banner: model generated$/,
  before: 0.3,
  after: 1.6,
  rate: 1.1,
};
const INTERVIEW: Pick = {
  chapter: "interview",
  title: "Interview",
  text: "Type the question; the patient answers what you ask",
  from: /^Question 2$/,
  before: 0.2,
  after: 3.2,
  rate: 1.5,
};
const CHATORDER: Pick = {
  chapter: "chatorder",
  title: "Chat order",
  text: "Order from the chat, confirm inside the chip",
  from: /^Slash command: \/order lactate$/,
  before: 0.2,
  to: /^Place order$/,
  after: 0.8,
  rate: 1.6,
};
const CALL: Pick = { chapter: "call", title: "Video call", text: "Live patient video, lip-synced on the GPU worker", insert: "call", seconds: 4 };
const ORDERS: Pick = {
  chapter: "orders",
  title: "Orders",
  text: "Order labs, imaging and an ECG",
  from: /^Search blood culture$/,
  before: 0.2,
  to: /^Order chest x-ray$/,
  after: 0.7,
  rate: 2,
};
const TREAT: Pick = {
  chapter: "treat",
  title: "Treat",
  text: "Treat through the dose, route and indication form",
  from: /^Dose, route and indication form$/,
  before: 0.4,
  to: /^Confirm IV fluid bolus$/,
  after: 0.9,
  rate: 1.4,
};
const DIRECTOR: Pick = {
  chapter: "director",
  title: "Director",
  text: "The Clinical Director changes the patient in flight",
  from: /^Bedside monitor$/,
  before: 0.3,
  to: /^Trends with treatment markers$/,
  after: 1.6,
  rate: 1.4,
};
const RESULTS: Pick = {
  chapter: "results",
  title: "Results",
  text: "Results on clinical turnaround, called in on the chat",
  from: /^Nurse calls the results in$/,
  before: 0.3,
  to: /^Result summary$/,
  after: 1.2,
  rate: 1.4,
};
const FEEDBACK: Pick = {
  chapter: "feedback",
  title: "Feedback",
  text: "Calibrated feedback on every encounter",
  from: /^Calibration plot$/,
  before: 0.3,
  after: 1.6,
  rate: 1.1,
};
const ADMIN: Pick = {
  chapter: "admin",
  title: "Admin",
  text: "Telemetry for every gateway call",
  from: /^Telemetry headline$/,
  before: 0.3,
  to: /^Calls by route$/,
  after: 1.2,
  rate: 1.5,
};
const DEAN: Pick = {
  chapter: "dean",
  title: "Dean",
  text: "Dean panel from the hash-chained event log",
  from: /^Cohort headline metrics$/,
  before: 0.3,
  after: 1.6,
  rate: 1.2,
};

/** 15 s teaser: generation, the chat order, the live call, the results called in (10.6 s between the mark and the end card). */
export const TEASER_CUT = cut([GENERATE, CHATORDER, CALL, RESULTS], 6.6);

/** Square social cut: the whole loop in short beats. */
export const SQUARE_CUT = cut([GENERATE, CHART, INTERVIEW, CALL, CHATORDER, ORDERS, TREAT, DIRECTOR, RESULTS, FEEDBACK, ADMIN, DEAN], 24);
