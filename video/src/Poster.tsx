import { AbsoluteFill, Img, staticFile } from "remotion";
import { COLOR, FONT, REPO_URL } from "./theme";
import { PROMISE } from "./scenes/PromiseScene";

/**
 * 1200 x 630 poster: the frame the landing page shows before the teaser
 * plays, and a social preview. Lockup, the promise in both languages, and a
 * real EHR capture leaning in from the right.
 */
export function Poster() {
  return (
    <AbsoluteFill style={{ backgroundColor: COLOR.bg, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 64, top: 56, right: 560, bottom: 56, display: "flex", flexDirection: "column" }}>
        <Img src={staticFile("brand/acudx-lockup-horizontal.svg")} style={{ width: 260, height: "auto" }} />
        <div
          style={{
            marginTop: 64,
            fontFamily: FONT.display,
            fontWeight: 700,
            fontSize: 54,
            letterSpacing: "-0.035em",
            lineHeight: 1.05,
            color: COLOR.fg,
          }}
        >
          {PROMISE.en.line}
        </div>
        <div lang="tr" style={{ marginTop: 18, fontFamily: FONT.display, fontWeight: 600, fontSize: 30, letterSpacing: "-0.025em", color: COLOR.brand }}>
          {PROMISE.tr.line}
        </div>
        <div style={{ marginTop: "auto", fontFamily: FONT.mono, fontSize: 18, color: COLOR.muted }}>{REPO_URL}</div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 700,
          top: 90,
          width: 960,
          height: 540,
          borderRadius: 14,
          overflow: "hidden",
          border: `1px solid ${COLOR.border}`,
          boxShadow: "0 24px 60px rgba(15, 23, 42, 0.14)",
          backgroundColor: COLOR.surface,
        }}
      >
        <Img src={staticFile("screens/encounter.png")} style={{ width: 1500, height: "auto", display: "block", marginLeft: -262, marginTop: -44 }} />
      </div>
    </AbsoluteFill>
  );
}
