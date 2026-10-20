import { buildClips, sourceTimeOf, TIMELINE, type Segment } from "./timeline";
import type { Caption } from "./Stage";

/**
 * Hand-picked spans of the same recording for the short cuts (Teaser, Square).
 * Each span is anchored on timeline labels, so a re-recording keeps the cut.
 */
interface Pick {
  chapter: string;
  title: string;
  text: string;
  from: RegExp;
  before: number;
  to?: RegExp;
  after: number;
  rate: number;
}

const at = (label: RegExp) => sourceTimeOf(TIMELINE, label);

/** `target`: output seconds the whole cut should last; every rate is scaled by one factor to fit. */
function cut(picks: Pick[], target?: number): { segments: Segment[]; captions: Caption[] } {
  const spans = picks.map((p) => ({ chapter: p.chapter, src0: at(p.from) - p.before, src1: at(p.to ?? p.from) + p.after, rate: p.rate }));
  const natural = spans.reduce((s, c) => s + (c.src1 - c.src0) / c.rate, 0);
  const k = target ? natural / target : 1;
  const segments = buildClips(spans.map((c) => ({ ...c, rate: c.rate * k })));
  const captions = picks.map((p) => ({ chapter: p.chapter, title: p.title, lines: [{ text: p.text }] }));
  return { segments, captions };
}

const CASE: Pick = {
  chapter: "case",
  title: "Case",
  text: "Generate a synthetic febrile case",
  from: /^Generated case/,
  before: 0.6,
  to: /^Start$/,
  after: 0.9,
  rate: 1.3,
};
const INTERVIEW: Pick = {
  chapter: "interview",
  title: "Interview",
  text: "Interview the patient in free text",
  from: /^Question 3$/,
  before: 0.2,
  after: 3.4,
  rate: 1.5,
};
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
const RESULTS: Pick = {
  chapter: "results",
  title: "Results",
  text: "Results with provenance and the 12-lead ECG",
  from: /^Provenance chips$/,
  before: 0.3,
  to: /^12-lead ECG strip$/,
  after: 1.6,
  rate: 1.4,
};
const TREAT: Pick = {
  chapter: "treat",
  title: "Treat",
  text: "Give paracetamol through the dose form",
  from: /^Dose, route and indication form$/,
  before: 0.4,
  to: /^Confirm and administer$/,
  after: 0.9,
  rate: 1.4,
};
const DIAGNOSE: Pick = {
  chapter: "diagnose",
  title: "Diagnose",
  text: "Commit a working diagnosis",
  from: /^Add /,
  before: 0.3,
  to: /^Verdict$/,
  after: 1.0,
  rate: 1.4,
};
const FEEDBACK: Pick = {
  chapter: "feedback",
  title: "Feedback",
  text: "Calibrated feedback on every encounter",
  from: /^Calibration plot$/,
  before: 0.3,
  to: /^A domain on the plot$/,
  after: 1.3,
  rate: 1.1,
};
const DEAN: Pick = {
  chapter: "dean",
  title: "Dean",
  text: "Dean panel and competency heatmap",
  from: /^Headline metrics$/,
  before: 0.3,
  to: /^Competency heatmap$/,
  after: 1.2,
  rate: 1.5,
};
const ATLAS: Pick = {
  chapter: "atlas",
  title: "Atlas",
  text: "3D anatomy atlas",
  from: /^3D organs from TotalSegmentator$/,
  before: 0.2,
  after: 2.4,
  rate: 1,
};

/** 15 s teaser: four beats in 10.6 s between the mark and the end card. */
export const TEASER_CUT = cut([INTERVIEW, ORDERS, RESULTS, FEEDBACK], 10.6);

/** Square social cut: the whole loop in short beats. */
export const SQUARE_CUT = cut([CASE, INTERVIEW, ORDERS, RESULTS, TREAT, DIAGNOSE, FEEDBACK, DEAN, ATLAS], 26);
