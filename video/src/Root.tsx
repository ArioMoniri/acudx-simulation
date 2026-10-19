import { Composition, Still } from "remotion";
import { FPS } from "./theme";
import { Launch, LAUNCH_DURATION } from "./Launch";
import { Teaser, TEASER_DURATION } from "./Teaser";
import { Poster } from "./Poster";
import "./fonts";

export function Root() {
  return (
    <>
      <Composition
        id="Launch"
        component={Launch}
        durationInFrames={LAUNCH_DURATION}
        fps={FPS}
        width={1920}
        height={1080}
      />
      <Composition
        id="Teaser"
        component={Teaser}
        durationInFrames={TEASER_DURATION}
        fps={FPS}
        width={1920}
        height={1080}
      />
      <Still id="Poster" component={Poster} width={1200} height={630} />
    </>
  );
}
