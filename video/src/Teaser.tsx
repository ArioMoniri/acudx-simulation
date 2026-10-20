import type { ReactNode } from "react";
import { AbsoluteFill, Img, interpolate, Sequence, staticFile, useCurrentFrame } from "remotion";
import { EASE, FONT, FPS, REPO_URL } from "./theme";
import { MarkScene } from "./scenes/MarkScene";
import { EndScene } from "./scenes/EndScene";
import { cutDuration } from "./walkthrough/timeline";
import { ChapterBar, FilmGround, FILM, LowerThird, RecordingFrame } from "./walkthrough/Stage";
import { SQUARE_CUT, TEASER_CUT } from "./walkthrough/highlights";
import { LANDSCAPE } from "./Walkthrough";

/**
 * Teaser (1920 x 1080, 15 s) and Square (1080 x 1080) social cut: the same
 * screen recording as the Walkthrough, cut to its strongest beats.
 */
const OVERLAP = 8;

function Fade({ children, duration }: { children: ReactNode; duration: number }) {
  const frame = useCurrentFrame();
  const o = Math.min(
    interpolate(frame, [0, OVERLAP + 4], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE }),
    interpolate(frame, [duration - OVERLAP - 4, duration], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE }),
  );
  return <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>;
}

/* ------------------------------------------------------------------ Teaser */

export const TEASER_DURATION = 15 * FPS;
const T_INTRO = 52;
const T_BODY = Math.ceil(cutDuration(TEASER_CUT.segments) * FPS);
const T_END = TEASER_DURATION - (T_INTRO - OVERLAP) - T_BODY + OVERLAP;

export function Teaser() {
  const from = T_INTRO - OVERLAP;
  return (
    <AbsoluteFill style={{ backgroundColor: "#ffffff" }}>
      <Sequence from={from} durationInFrames={T_BODY} name="beats">
        <Fade duration={T_BODY}>
          <FilmGround>
            <RecordingFrame segments={TEASER_CUT.segments} rect={LANDSCAPE.frame} />
            <LowerThird segments={TEASER_CUT.segments} captions={TEASER_CUT.captions} rect={LANDSCAPE.caption} size={32} />
            <ChapterBar segments={TEASER_CUT.segments} captions={TEASER_CUT.captions} rect={LANDSCAPE.bar} labels={false} />
          </FilmGround>
        </Fade>
      </Sequence>
      <Sequence from={0} durationInFrames={T_INTRO} name="mark">
        <MarkScene compact />
      </Sequence>
      <Sequence from={from + T_BODY - OVERLAP} durationInFrames={Math.max(60, T_END)} name="end">
        <EndScene compact />
      </Sequence>
    </AbsoluteFill>
  );
}

/* ------------------------------------------------------------------ Square */

const S_INTRO = 60;
const S_BODY = Math.ceil(cutDuration(SQUARE_CUT.segments) * FPS);
const S_END = 96;
export const SQUARE_DURATION = S_INTRO - OVERLAP + S_BODY + S_END - OVERLAP;

const SQUARE = {
  lockup: { x: 40, y: 44 },
  caption: { x: 40, y: 128, w: 1000, h: 132 },
  frame: { x: 40, y: 284, w: 1000, h: 562.5 },
  bar: { x: 40, y: 884, w: 1000, h: 36 },
};

export function Square() {
  const from = S_INTRO - OVERLAP;
  return (
    <AbsoluteFill style={{ backgroundColor: "#ffffff" }}>
      <Sequence from={from} durationInFrames={S_BODY} name="beats">
        <Fade duration={S_BODY}>
          <FilmGround>
            <Img
              src={staticFile("brand/acudx-lockup-horizontal-dark.svg")}
              style={{ position: "absolute", left: SQUARE.lockup.x, top: SQUARE.lockup.y, height: 44, width: "auto" }}
            />
            <div
              style={{
                position: "absolute",
                right: 40,
                top: SQUARE.lockup.y + 12,
                fontFamily: FONT.mono,
                fontSize: 18,
                color: FILM.muted,
              }}
            >
              Education only · synthetic patients
            </div>
            <LowerThird segments={SQUARE_CUT.segments} captions={SQUARE_CUT.captions} rect={SQUARE.caption} size={42} align="center" />
            <RecordingFrame segments={SQUARE_CUT.segments} rect={SQUARE.frame} maxScale={2.0} radius={14} />
            <ChapterBar segments={SQUARE_CUT.segments} captions={SQUARE_CUT.captions} rect={SQUARE.bar} />
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: 980,
                textAlign: "center",
                fontFamily: FONT.mono,
                fontSize: 24,
                color: FILM.ink,
              }}
            >
              {REPO_URL}
            </div>
          </FilmGround>
        </Fade>
      </Sequence>
      <Sequence from={0} durationInFrames={S_INTRO} name="mark">
        <MarkScene compact />
      </Sequence>
      <Sequence from={from + S_BODY - OVERLAP} durationInFrames={S_END} name="end">
        <EndScene compact />
      </Sequence>
    </AbsoluteFill>
  );
}
