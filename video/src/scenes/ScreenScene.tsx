import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { COLOR, EASE, FONT } from "../theme";
import { useFadeUp, useSceneFade } from "../motion";

export interface Shot {
  /** File under public/screens, captured with scripts/capture-screens.mjs. */
  file: string;
  caption: { en: string; tr: string };
  /** Zoom range: start and end scale of the 1920x1080 capture. */
  scale: [number, number];
  /** Pan origin as percentages of the capture (where the zoom anchors). */
  origin: [number, number];
}

export const SHOTS: Shot[] = [
  {
    file: "encounter.png",
    caption: { en: "Chart review in an Epic-like EHR workspace", tr: "Epic benzeri EHR çalışma alanında dosya incelemesi" },
    scale: [1.0, 1.14],
    origin: [30, 24],
  },
  {
    file: "encounter-orders.png",
    caption: { en: "Orders and results with physiology that moves", tr: "Hareket eden fizyolojiyle istemler ve sonuçlar" },
    scale: [1.16, 1.04],
    origin: [68, 40],
  },
  {
    file: "rooms.png",
    caption: { en: "Interprofessional rooms: doctor, nurse, paramedic", tr: "Meslekler arası odalar: hekim, hemşire, paramedik" },
    scale: [1.0, 1.12],
    origin: [50, 62],
  },
  {
    file: "atlas.png",
    caption: { en: "Atlas: anatomy and imaging with provenance", tr: "Atlas: kaynağı belli anatomi ve görüntüleme" },
    scale: [1.1, 1.0],
    origin: [50, 36],
  },
];

/**
 * Scene C: real screenshots of the running app inside a quiet browser frame,
 * with a slow pan and zoom on the canonical easing. Nothing is staged: the
 * frames come from Playwright against the dev server.
 */
export function ScreenScene({ shot, framed = true }: { shot: Shot; framed?: boolean }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const fade = useSceneFade();
  const scale = interpolate(frame, [0, durationInFrames], shot.scale, {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });
  const caption = useFadeUp(14);

  return (
    <AbsoluteFill style={{ backgroundColor: COLOR.bgSubtle, opacity: fade }}>
      <AbsoluteFill style={{ padding: framed ? "60px 120px 120px" : 0 }}>
        <div
          style={{
            width: "100%",
            height: "100%",
            borderRadius: framed ? 18 : 0,
            overflow: "hidden",
            border: framed ? `1px solid ${COLOR.border}` : "none",
            boxShadow: framed ? "0 24px 60px rgba(15, 23, 42, 0.10)" : "none",
            backgroundColor: COLOR.surface,
            position: "relative",
          }}
        >
          {framed ? (
            <div
              style={{
                height: 44,
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "0 18px",
                borderBottom: `1px solid ${COLOR.border}`,
                backgroundColor: COLOR.bgSubtle,
              }}
            >
              {[0, 1, 2].map((i) => (
                <span key={i} style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: COLOR.border }} />
              ))}
              <span
                style={{
                  marginLeft: 16,
                  fontFamily: FONT.mono,
                  fontSize: 15,
                  color: COLOR.muted,
                  padding: "4px 12px",
                  borderRadius: 6,
                  backgroundColor: COLOR.surface,
                  border: `1px solid ${COLOR.border}`,
                }}
              >
                acudx.local/{shot.file.replace(/-.*|\.png/g, "")}
              </span>
            </div>
          ) : null}
          <div style={{ position: "absolute", inset: framed ? "44px 0 0 0" : 0, overflow: "hidden" }}>
            <Img
              src={staticFile(`screens/${shot.file}`)}
              style={{
                width: "100%",
                height: "auto",
                display: "block",
                transform: `scale(${scale})`,
                transformOrigin: `${shot.origin[0]}% ${shot.origin[1]}%`,
              }}
            />
          </div>
        </div>
      </AbsoluteFill>
      {framed ? (
        <div
          style={{
            ...caption,
            position: "absolute",
            left: 120,
            bottom: 44,
            display: "flex",
            alignItems: "baseline",
            gap: 20,
          }}
        >
          <span style={{ fontFamily: FONT.display, fontWeight: 600, fontSize: 30, color: COLOR.fg, letterSpacing: "-0.01em" }}>
            {shot.caption.en}
          </span>
          <span lang="tr" style={{ fontFamily: FONT.body, fontSize: 22, color: COLOR.muted }}>
            {shot.caption.tr}
          </span>
        </div>
      ) : null}
    </AbsoluteFill>
  );
}
