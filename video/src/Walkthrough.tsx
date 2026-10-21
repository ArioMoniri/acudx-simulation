import type { ReactNode } from "react";
import { AbsoluteFill, interpolate, Sequence, useCurrentFrame } from "remotion";
import { EASE, FPS } from "./theme";
import { MarkScene } from "./scenes/MarkScene";
import { EndScene } from "./scenes/EndScene";
import { buildCut, cutDuration, spliceInsert, TIMELINE, type Segment } from "./walkthrough/timeline";
import { ChapterBar, CutFrame, FilmGround, LowerThird, SYNC_OFFSET, type Caption } from "./walkthrough/Stage";

/**
 * Walkthrough: the product, recorded. A real Playwright screen recording of
 * one student encounter on a case generated on request (a recorded live model
 * case replayed as the staged stream), the Clinical Director stepping the
 * patient after treatment, then the admin telemetry and the dean panel, cut
 * from its JSON timeline with a zoom-to-focus camera, lower-third captions and
 * chapter markers. The "call" chapter is spliced from the real live capture of
 * the patient video call (docs/media/live-avatar). 3 s intro, 4 s end card.
 *
 * Source: public/recording/walkthrough.{mp4,json} from
 * scripts/record-walkthrough.mjs (see video/README.md).
 */

/** Output seconds per chapter: the cut trims idle time, then speeds a chapter up (at most 2.2x) to fit. */
export const BUDGETS: Record<string, number> = {
  profile: 4.5,
  request: 4,
  generate: 8,
  chart: 4,
  interview: 7.5,
  call: 1,
  exam: 4,
  chatorder: 5.5,
  orders: 6,
  treat: 6.5,
  director: 9,
  results: 11,
  guidance: 4,
  diagnose: 5,
  feedback: 8,
  admin: 8,
  dean: 7,
  rooms: 6.5,
};

/** Output seconds of the spliced live call. */
export const CALL_SECONDS = 8;

export const CAPTIONS: Caption[] = [
  { chapter: "profile", title: "Profile", lines: [{ text: "Create a local profile: name, role, institution." }] },
  { chapter: "request", title: "Request", lines: [{ text: "Ask for a case: solo, as the doctor, presenting with fever." }] },
  {
    chapter: "generate",
    title: "Generate",
    lines: [
      { text: "The case is written on request. The opening streams in first." },
      { at: 3.6, text: "History, exam, treatments and results are written for this patient while you work." },
    ],
  },
  {
    chapter: "chart",
    title: "Chart",
    lines: [{ text: "Recorded live model case (Qwen3-14B, 2026-10-20). The banner says where it came from." }],
  },
  {
    chapter: "interview",
    title: "Interview",
    lines: [{ text: "Type the question. No model endpoint in this run, so the recorded case answers offline." }],
  },
  { chapter: "call", title: "Video call", lines: [{ text: "Live patient video, lip-synced on the GPU worker" }] },
  { chapter: "exam", title: "Exam", lines: [{ text: "Exam manoeuvres sit in the Suggestions drawer; the finding lands in the chat." }] },
  { chapter: "chatorder", title: "Chat order", lines: [{ text: "Order from the chat: /order lactate, then confirm inside the chip." }] },
  { chapter: "orders", title: "Orders", lines: [{ text: "Orders worklist: every test shows its clinical turnaround." }] },
  { chapter: "treat", title: "Treat", lines: [{ text: "Fluids, oxygen and an antibiotic through the dose, route and indication form." }] },
  {
    chapter: "director",
    title: "Director",
    lines: [
      { text: "The Clinical Director steps the patient after every action." },
      { at: 4, text: "The monitor follows the course engine." },
    ],
  },
  {
    chapter: "results",
    title: "Results",
    lines: [
      { text: "Results stay pending on clinical turnaround. Advance the sim clock to the next one." },
      { at: 5, text: "The nurse calls each result in on the chat, with a jump to it." },
    ],
  },
  { chapter: "guidance", title: "Guidance", lines: [{ text: "Attending tips cite verified guideline statements, or say none was found." }] },
  { chapter: "diagnose", title: "Diagnose", lines: [{ text: "Commit a working diagnosis from the ICD catalogue." }] },
  {
    chapter: "feedback",
    title: "Feedback",
    lines: [
      { text: "Debrief: every process check against a guideline target, cited." },
      { at: 4.5, text: "Calibration: confidence against measured performance." },
    ],
  },
  {
    chapter: "admin",
    title: "Admin",
    lines: [
      { text: "Admin console behind the token gate: providers, GPU policy and telemetry." },
      { at: 4, text: "One row per gateway call. No model endpoint here, so model calls show as errors." },
    ],
  },
  { chapter: "dean", title: "Dean", lines: [{ text: "Dean panel: this encounter in the cohort metrics, from the hash-chained event log." }] },
  { chapter: "rooms", title: "Rooms", lines: [{ text: "Team rooms: one case, a seat per role, AI-held seats labelled." }] },
];

export const WALKTHROUGH_CUT: Segment[] = spliceInsert(buildCut(TIMELINE, { budgets: BUDGETS, offset: SYNC_OFFSET }), "call", "call", CALL_SECONDS);

const INTRO = 3 * FPS;
const OUTRO = 4 * FPS;
const OVERLAP = 10;
const BODY = Math.ceil(cutDuration(WALKTHROUGH_CUT) * FPS);

export const WALKTHROUGH_DURATION = INTRO - OVERLAP + BODY + OUTRO - OVERLAP;

/** Fade the body in and out where it crosses the intro and the end card. */
function BodyFade({ children, duration }: { children: ReactNode; duration: number }) {
  const frame = useCurrentFrame();
  const o = Math.min(
    interpolate(frame, [0, OVERLAP + 4], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE }),
    interpolate(frame, [duration - OVERLAP - 4, duration], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE }),
  );
  return <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>;
}

export const LANDSCAPE = {
  frame: { x: 144, y: 40, w: 1632, h: 918 },
  caption: { x: 144, y: 968, w: 1632, h: 62 },
  bar: { x: 144, y: 1040, w: 1632, h: 30 },
};

export function Walkthrough() {
  const bodyFrom = INTRO - OVERLAP;
  return (
    <AbsoluteFill style={{ backgroundColor: "#ffffff" }}>
      <Sequence from={bodyFrom} durationInFrames={BODY} name="recording">
        <BodyFade duration={BODY}>
          <FilmGround>
            <CutFrame segments={WALKTHROUGH_CUT} rect={LANDSCAPE.frame} />
            <LowerThird segments={WALKTHROUGH_CUT} captions={CAPTIONS} rect={LANDSCAPE.caption} size={28} />
            <ChapterBar segments={WALKTHROUGH_CUT} captions={CAPTIONS} rect={LANDSCAPE.bar} labels={false} />
          </FilmGround>
        </BodyFade>
      </Sequence>
      <Sequence from={0} durationInFrames={INTRO} name="intro">
        <MarkScene compact />
      </Sequence>
      <Sequence from={bodyFrom + BODY - OVERLAP} durationInFrames={OUTRO} name="end">
        <EndScene compact />
      </Sequence>
    </AbsoluteFill>
  );
}
