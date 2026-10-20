import { Composition, Still } from "remotion";
import { FPS } from "./theme";
import { Launch, LAUNCH_DURATION } from "./Launch";
import { LaunchTeaser, LAUNCH_TEASER_DURATION } from "./LaunchTeaser";
import { Poster } from "./Poster";
import { Walkthrough, WALKTHROUGH_DURATION } from "./Walkthrough";
import { Square, SQUARE_DURATION, Teaser, TEASER_DURATION } from "./Teaser";
import { PosterV2 } from "./PosterV2";
import "./fonts";

export function Root() {
  return (
    <>
      {/* The product walkthrough, cut from a real screen recording. */}
      <Composition id="Walkthrough" component={Walkthrough} durationInFrames={WALKTHROUGH_DURATION} fps={FPS} width={1920} height={1080} />
      <Composition id="Teaser" component={Teaser} durationInFrames={TEASER_DURATION} fps={FPS} width={1920} height={1080} />
      <Composition id="Square" component={Square} durationInFrames={SQUARE_DURATION} fps={FPS} width={1080} height={1080} />
      <Still id="PosterV2" component={PosterV2} width={1920} height={1080} />
      {/* The original launch film, built from still captures. */}
      <Composition id="Launch" component={Launch} durationInFrames={LAUNCH_DURATION} fps={FPS} width={1920} height={1080} />
      <Composition id="LaunchTeaser" component={LaunchTeaser} durationInFrames={LAUNCH_TEASER_DURATION} fps={FPS} width={1920} height={1080} />
      <Still id="Poster" component={Poster} width={1200} height={630} />
    </>
  );
}
