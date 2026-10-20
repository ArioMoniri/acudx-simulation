import type { ReactNode } from "react";
import { AbsoluteFill, interpolate, Sequence, useCurrentFrame } from "remotion";
import { EASE, FPS } from "./theme";
import { MarkScene } from "./scenes/MarkScene";
import { EndScene } from "./scenes/EndScene";
import { buildCut, cutDuration, TIMELINE, type Segment } from "./walkthrough/timeline";
import { ChapterBar, FilmGround, LowerThird, RecordingFrame, SYNC_OFFSET, type Caption } from "./walkthrough/Stage";

/**
 * Walkthrough: the product, recorded. A real Playwright screen recording of
 * one student encounter on a febrile case (then the dean panel, the admin
 * token gate and the 3D atlas), cut from its JSON timeline, with a
 * zoom-to-focus camera on every click, lower-third captions per chapter and
 * chapter markers. 3 s intro with the Lottie mark, 4 s end card.
 *
 * Source: public/recording/walkthrough.{mp4,json} from
 * scripts/record-walkthrough.mjs (see video/README.md).
 */

/** Output seconds per chapter: the cut trims idle time, then speeds a chapter up (at most 2.2x) to fit. */
export const BUDGETS: Record<string, number> = {
  profile: 5.5,
  case: 6,
  chart: 4,
  interview: 9,
  exam: 4,
  orders: 8,
  results: 9.5,
  guidance: 5,
  treat: 6,
  diagnose: 5.5,
  feedback: 7,
  dean: 6.5,
  admin: 3.5,
  atlas: 6,
};

export const CAPTIONS: Caption[] = [
  { chapter: "profile", title: "Profile", lines: [{ text: "Create a local profile: name, role, institution." }] },
  { chapter: "case", title: "Case", lines: [{ text: "Generate a synthetic case. Infectious: cough, fever and breathlessness." }] },
  { chapter: "chart", title: "Chart review", lines: [{ text: "An EHR chart: patient banner, vitals, allergies and code status." }] },
  {
    chapter: "interview",
    title: "Interview",
    lines: [{ text: "Ask in free text. The patient reveals only what you ask." }, { at: 6.2, text: "Each question is screened for scope and mapped to the history." }],
  },
  { chapter: "exam", title: "Exam", lines: [{ text: "Each exam manoeuvre writes its finding into the chart." }] },
  { chapter: "orders", title: "Orders", lines: [{ text: "Order CBC, CRP, lactate, blood cultures, chest X-ray and ECG." }] },
  {
    chapter: "results",
    title: "Results",
    lines: [
      { text: "Results arrive on turnaround timers. Every value is flagged and sourced." },
      { at: 5.6, text: "12-lead ECG: a labelled representative image offline, with its licence." },
    ],
  },
  { chapter: "guidance", title: "Guidance", lines: [{ text: "Attending tips coach the process. An unverified source shows as unavailable." }] },
  { chapter: "treat", title: "Treat", lines: [{ text: "Paracetamol through the dose, route and indication form." }] },
  { chapter: "diagnose", title: "Diagnose", lines: [{ text: "Commit a working diagnosis from the ICD-10 catalogue." }] },
  { chapter: "feedback", title: "Feedback", lines: [{ text: "Attending debrief, then calibration: confidence against measured performance." }] },
  {
    chapter: "dean",
    title: "Dean",
    lines: [{ text: "Local profiles pick a role. With OIDC, roles come from verified claims." }, { at: 2.6, text: "Dean panel: headline metrics and the competency heatmap." }],
  },
  { chapter: "admin", title: "Admin", lines: [{ text: "Admin console: providers and GPU policy behind a token gate." }] },
  { chapter: "atlas", title: "Atlas", lines: [{ text: "Anatomy atlas: 3D organs from TotalSegmentator, CC BY 4.0." }] },
];

export const WALKTHROUGH_CUT: Segment[] = buildCut(TIMELINE, { budgets: BUDGETS, offset: SYNC_OFFSET });

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
            <RecordingFrame segments={WALKTHROUGH_CUT} rect={LANDSCAPE.frame} />
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
