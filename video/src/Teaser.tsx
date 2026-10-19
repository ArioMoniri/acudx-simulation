import { AbsoluteFill, Sequence } from "remotion";
import { COLOR } from "./theme";
import { MarkScene } from "./scenes/MarkScene";
import { PromiseScene } from "./scenes/PromiseScene";
import { ScreenScene, SHOTS } from "./scenes/ScreenScene";
import { EndScene } from "./scenes/EndScene";

/** 10 s teaser: mark, promise, one real EHR frame, end card. 300 frames. */
export const TEASER_DURATION = 300;

export function Teaser() {
  return (
    <AbsoluteFill style={{ backgroundColor: COLOR.bg }}>
      <Sequence from={0} durationInFrames={80} name="mark">
        <MarkScene compact />
      </Sequence>
      <Sequence from={70} durationInFrames={95} name="promise">
        <PromiseScene compact />
      </Sequence>
      <Sequence from={155} durationInFrames={95} name="ehr">
        <ScreenScene shot={SHOTS[0]} />
      </Sequence>
      <Sequence from={240} durationInFrames={60} name="end">
        <EndScene compact />
      </Sequence>
    </AbsoluteFill>
  );
}
