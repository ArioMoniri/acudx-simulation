import { AbsoluteFill, Img, OffthreadVideo, staticFile, useVideoConfig } from "remotion";
import { FONT, REPO_URL } from "./theme";
import { PROMISE } from "./scenes/PromiseScene";
import { sourceTimeOf, TIMELINE } from "./walkthrough/timeline";
import { FILM, RECORDING, REC_H, REC_W, SYNC_OFFSET } from "./walkthrough/Stage";

/**
 * 1920 x 1080 poster for the walkthrough (`<video poster>`, README, social).
 * One real frame of the recording (the bedside monitor while the Director steps the patient) in
 * the film frame, the dark lockup, the promise and a play affordance.
 */
export function PosterV2() {
  const { fps } = useVideoConfig();
  const t = sourceTimeOf(TIMELINE, /^Bedside monitor$/) + 1.2 + SYNC_OFFSET;
  const frameW = 1180;
  const fit = frameW / REC_W;
  return (
    <AbsoluteFill style={{ background: `linear-gradient(180deg, ${FILM.groundTop} 0%, ${FILM.ground} 70%)`, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 96, top: 120, width: 560 }}>
        <Img src={staticFile("brand/acudx-lockup-horizontal-dark.svg")} style={{ height: 64, width: "auto" }} />
        <div style={{ marginTop: 72, fontFamily: FONT.display, fontWeight: 700, fontSize: 64, lineHeight: 1.05, letterSpacing: "-0.035em", color: FILM.ink }}>
          {PROMISE.en.line}
        </div>
        <div style={{ marginTop: 24, fontFamily: FONT.body, fontSize: 26, lineHeight: 1.45, color: FILM.muted }}>{PROMISE.en.sub}</div>
        <div style={{ marginTop: 56, display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 36,
              backgroundColor: FILM.accent,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden>
              <path d="M9 5.5v17l14-8.5z" fill={FILM.accentInk} />
            </svg>
          </div>
          <div style={{ fontFamily: FONT.body, fontWeight: 600, fontSize: 26, color: FILM.ink }}>Watch the walkthrough</div>
        </div>
        <div style={{ marginTop: 150, fontFamily: FONT.mono, fontSize: 22, color: FILM.muted }}>{REPO_URL}</div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 700,
          top: 210,
          width: frameW,
          height: frameW * (REC_H / REC_W),
          borderRadius: 16,
          overflow: "hidden",
          boxShadow: "0 30px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08)",
        }}
      >
        <div style={{ width: REC_W, height: REC_H, transform: `scale(${fit})`, transformOrigin: "0 0" }}>
          <OffthreadVideo src={staticFile(RECORDING)} trimBefore={Math.round(t * fps)} muted style={{ width: REC_W, height: REC_H, display: "block" }} />
        </div>
      </div>
    </AbsoluteFill>
  );
}
