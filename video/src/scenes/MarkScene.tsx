import { useEffect, useState } from "react";
import {
  AbsoluteFill,
  cancelRender,
  continueRender,
  delayRender,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { Lottie, type LottieAnimationData } from "@remotion/lottie";
import { COLOR, EASE, FONT } from "../theme";
import { useSceneFade } from "../motion";

/**
 * Scene A: the mark draws itself in. Plays the brand Lottie file
 * (`web/public/brand/acudx-mark.lottie.json`, copied to public/brand) so the
 * film and the landing page share one animation; the wordmark then settles in
 * beside it on the canonical easing.
 *
 * `compact` keeps the whole lockup smaller (teaser).
 */
export function MarkScene({ compact = false }: { compact?: boolean }) {
  const frame = useCurrentFrame();
  const fade = useSceneFade();
  const [data, setData] = useState<LottieAnimationData | null>(null);
  const [handle] = useState(() => delayRender("Loading brand Lottie"));

  useEffect(() => {
    fetch(staticFile("brand/acudx-mark.lottie.json"))
      .then((r) => r.json())
      .then((json: LottieAnimationData) => {
        setData(json);
        continueRender(handle);
      })
      .catch((err: unknown) => cancelRender(err));
  }, [handle]);

  // The Lottie is 1.5 s; the name arrives as the apex lands.
  const nameStart = 42;
  const name = interpolate(frame, [nameStart, nameStart + 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });
  const size = compact ? 200 : 280;
  const fontSize = compact ? 150 : 210;

  return (
    <AbsoluteFill style={{ backgroundColor: COLOR.bg, opacity: fade }}>
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          flexDirection: "row",
          gap: size * 0.26,
        }}
      >
        <div style={{ width: size, height: size }}>
          {data ? <Lottie animationData={data} loop={false} style={{ width: size, height: size }} /> : null}
        </div>
        <div
          style={{
            fontFamily: FONT.display,
            fontWeight: 800,
            fontSize,
            letterSpacing: "-0.05em",
            lineHeight: 1,
            opacity: name,
            transform: `translateX(${(1 - name) * -16}px)`,
            display: "flex",
          }}
        >
          <span style={{ color: COLOR.fg }}>Acu</span>
          <span style={{ color: COLOR.brand }}>Dx</span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
