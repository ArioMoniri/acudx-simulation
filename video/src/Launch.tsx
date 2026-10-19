import { AbsoluteFill, Sequence } from "remotion";
import { COLOR } from "./theme";
import { MarkScene } from "./scenes/MarkScene";
import { PromiseScene } from "./scenes/PromiseScene";
import { ScreenScene, SHOTS } from "./scenes/ScreenScene";
import { FeatureScene } from "./scenes/FeatureScene";
import { SovereignScene } from "./scenes/SovereignScene";
import { EndScene } from "./scenes/EndScene";

/**
 * Launch film timeline at 30 fps. Scenes overlap by 10 frames so the scene
 * fades cross rather than cut to white.
 *
 *   A mark        0 to 120    (4 s)
 *   B promise   110 to 330    (7.3 s)
 *   C screens   320 to 880    (18.7 s; four shots of 140 frames)
 *   D features  870 to 1230   (12 s)
 *   E sovereign 1220 to 1410  (6.3 s)
 *   F end card  1400 to 1560  (5.3 s)
 */
const OVERLAP = 10;
const A = 120;
const B = 220;
const SHOT = 140;
const D = 360;
const E = 190;
const F = 160;

export const LAUNCH_DURATION =
  A + B + SHOT * SHOTS.length + D + E + F - OVERLAP * (4 + SHOTS.length);

export function Launch() {
  let t = 0;
  const at = (len: number) => {
    const from = t;
    t += len - OVERLAP;
    return from;
  };
  const a = at(A);
  const b = at(B);
  const shots = SHOTS.map(() => at(SHOT));
  const d = at(D);
  const e = at(E);
  const f = at(F);

  return (
    <AbsoluteFill style={{ backgroundColor: COLOR.bg }}>
      <Sequence from={a} durationInFrames={A} name="A mark">
        <MarkScene />
      </Sequence>
      <Sequence from={b} durationInFrames={B} name="B promise">
        <PromiseScene />
      </Sequence>
      {SHOTS.map((shot, i) => (
        <Sequence key={shot.file} from={shots[i]} durationInFrames={SHOT} name={`C ${shot.file}`}>
          <ScreenScene shot={shot} />
        </Sequence>
      ))}
      <Sequence from={d} durationInFrames={D} name="D features">
        <FeatureScene />
      </Sequence>
      <Sequence from={e} durationInFrames={E} name="E sovereign">
        <SovereignScene />
      </Sequence>
      <Sequence from={f} durationInFrames={F} name="F end">
        <EndScene />
      </Sequence>
    </AbsoluteFill>
  );
}
