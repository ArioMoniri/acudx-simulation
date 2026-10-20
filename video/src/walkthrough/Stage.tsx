import { useMemo, type ReactNode } from "react";
import { AbsoluteFill, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { EASE, FONT } from "../theme";
import { buildCamera, cameraAt, chapterRanges, splitRuns, TIMELINE, type Segment } from "./timeline";

/** The recording, as rendered by Playwright (see scripts/record-walkthrough.mjs). */
export const RECORDING = "recording/walkthrough.mp4";
/**
 * The live patient video chapter, cut by scripts/encode-media.sh prepare from
 * the real capture in docs/media/live-avatar (LiveTalking + MuseTalk 1.5 on
 * the GPU worker, Kokoro voice): the transcript and call tile of the encounter
 * page while the patient answers,
 * and the lip-synced stream itself.
 */
export const CALL_PAGE = { src: "recording/call-page.mp4", w: 570, h: 475 };
export const CALL_FACE = { src: "recording/call-face.mp4", w: 566, h: 720 };
export const REC_W = TIMELINE.width;
export const REC_H = TIMELINE.height;
/** Timeline clock to video clock (seconds); measured from the first click ripple. */
export const SYNC_OFFSET = 0.0;

/** Film palette: a calm dark ground so the light product UI carries the frame. */
export const FILM = {
  ground: "#0d1217",
  groundTop: "#121a21",
  ink: "#f4f6f8",
  muted: "#9aa6b2",
  rule: "rgba(255,255,255,0.10)",
  accent: "#2dd4bf",
  accentInk: "#0d1217",
} as const;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Caption {
  chapter: string;
  /** Chapter label for the marker. */
  title: string;
  /** Lower-third line(s); a later entry replaces the first from `at` (output s, relative to the chapter start). */
  lines: Array<{ at?: number; text: string }>;
}

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** The framed screen recording with the zoom-to-focus camera applied. */
export function RecordingFrame({ segments, rect, maxScale = 1.8, radius = 18 }: { segments: Segment[]; rect: Rect; maxScale?: number; radius?: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const keys = useMemo(
    () => buildCamera(TIMELINE, segments, { width: REC_W, height: REC_H, maxScale, offset: SYNC_OFFSET }),
    [segments, maxScale],
  );
  const cam = cameraAt(keys, frame / fps);
  const fit = rect.w / REC_W;
  // Frame-accurate boundaries: each segment starts where the previous ended.
  const placed = useMemo(() => {
    let prev = 0;
    return segments.map((s) => {
      const from = prev;
      const to = Math.max(from + 1, Math.round(s.out1 * fps));
      prev = to;
      return { s, from, dur: to - from };
    });
  }, [segments, fps]);

  return (
    <div
      style={{
        position: "absolute",
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        borderRadius: radius,
        overflow: "hidden",
        backgroundColor: "#f4f5f6",
        boxShadow: "0 30px 80px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.08)",
      }}
    >
      <div style={{ width: REC_W, height: REC_H, transform: `scale(${fit})`, transformOrigin: "0 0" }}>
        <div
          style={{
            width: REC_W,
            height: REC_H,
            transformOrigin: "0 0",
            transform: `translate(${REC_W / 2 - cam.cx * cam.scale}px, ${REC_H / 2 - cam.cy * cam.scale}px) scale(${cam.scale})`,
          }}
        >
          {placed.map(({ s, from, dur }, i) => (
            <Sequence key={i} from={from} durationInFrames={dur} layout="none">
              <OffthreadVideo
                src={staticFile(RECORDING)}
                trimBefore={Math.round((s.src0 + SYNC_OFFSET) * fps)}
                playbackRate={s.rate}
                muted
                style={{ width: REC_W, height: REC_H, display: "block" }}
              />
            </Sequence>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Lower third: chapter number and title, then the caption line. Fades with the chapter. */
export function LowerThird({
  segments,
  captions,
  rect,
  size = 30,
  align = "left",
}: {
  segments: Segment[];
  captions: Caption[];
  rect: Rect;
  size?: number;
  align?: "left" | "center";
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const ranges = useMemo(() => chapterRanges(segments), [segments]);
  const idx = ranges.findIndex((r) => t >= r.out0 && t < r.out1);
  if (idx < 0) return null;
  const r = ranges[idx];
  const cap = captions.find((c) => c.chapter === r.chapter);
  if (!cap) return null;
  const local = t - r.out0;
  const lines = cap.lines.filter((l) => (l.at ?? 0) <= local);
  const line = lines[lines.length - 1] ?? cap.lines[0];
  const lineStart = line.at ?? 0;
  const inT = interpolate(local, [lineStart, lineStart + 0.35], [0, 1], { ...clamp, easing: EASE });
  const outT = interpolate(t, [r.out1 - 0.3, r.out1], [1, 0], { ...clamp, easing: EASE });
  const nextLine = cap.lines.find((l) => (l.at ?? 0) > local);
  const swapOut = nextLine ? interpolate(local, [(nextLine.at ?? 0) - 0.25, nextLine.at ?? 0], [1, 0], clamp) : 1;
  const opacity = Math.min(inT, outT, swapOut);
  const chipIn = interpolate(local, [0, 0.3], [0, 1], { ...clamp, easing: EASE });
  const number = String(captions.findIndex((c) => c.chapter === r.chapter) + 1).padStart(2, "0");

  return (
    <div
      style={{
        position: "absolute",
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        display: "flex",
        flexDirection: align === "center" ? "column" : "row",
        alignItems: "center",
        justifyContent: align === "center" ? "center" : "flex-start",
        gap: align === "center" ? 14 : 24,
        textAlign: align,
      }}
    >
      <div
        style={{
          opacity: Math.min(chipIn, outT),
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontFamily: FONT.mono,
          fontSize: size * 0.6,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: FILM.accent,
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        <span style={{ color: FILM.muted }}>{number}</span>
        <span>{cap.title}</span>
      </div>
      <div
        style={{
          opacity,
          transform: `translateY(${(1 - inT) * 6}px)`,
          fontFamily: FONT.body,
          fontWeight: 500,
          fontSize: size,
          lineHeight: 1.3,
          letterSpacing: "-0.01em",
          color: FILM.ink,
        }}
      >
        {line.text}
      </div>
    </div>
  );
}

/** Chapter markers: one hairline segment per chapter, the current one filling. */
export function ChapterBar({ segments, captions, rect, labels = true }: { segments: Segment[]; captions: Caption[]; rect: Rect; labels?: boolean }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const ranges = useMemo(() => chapterRanges(segments), [segments]);
  const total = ranges.length ? ranges[ranges.length - 1].out1 : 1;
  const gap = 6;
  return (
    <div style={{ position: "absolute", left: rect.x, top: rect.y, width: rect.w, height: rect.h, display: "flex", gap }}>
      {ranges.map((r) => {
        const width = ((r.out1 - r.out0) / total) * (rect.w - gap * (ranges.length - 1));
        const p = interpolate(t, [r.out0, r.out1], [0, 1], clamp);
        const active = t >= r.out0 && t < r.out1;
        const title = captions.find((c) => c.chapter === r.chapter)?.title ?? r.chapter;
        return (
          <div key={r.chapter} style={{ width, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ height: 3, borderRadius: 2, backgroundColor: FILM.rule, overflow: "hidden" }}>
              <div style={{ width: `${p * 100}%`, height: "100%", backgroundColor: active ? FILM.accent : "rgba(255,255,255,0.45)" }} />
            </div>
            {labels ? (
              <div
                style={{
                  fontFamily: FONT.body,
                  fontSize: 13,
                  fontWeight: active ? 600 : 400,
                  color: active ? FILM.ink : FILM.muted,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "clip",
                }}
              >
                {title}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** The dark film ground behind the frame. */
export function FilmGround({ children }: { children?: ReactNode }) {
  return (
    <AbsoluteFill style={{ background: `linear-gradient(180deg, ${FILM.groundTop} 0%, ${FILM.ground} 70%)` }}>{children}</AbsoluteFill>
  );
}

/**
 * The cut on screen: runs of the screen recording (zoom-to-focus camera) and
 * spliced inserts, in order. `insert: "call"` plays the live patient video.
 */
export function CutFrame({ segments, rect, maxScale, radius = 18 }: { segments: Segment[]; rect: Rect; maxScale?: number; radius?: number }) {
  const { fps } = useVideoConfig();
  const runs = useMemo(() => splitRuns(segments), [segments]);
  return (
    <>
      {runs.map((r, i) => {
        const from = Math.round(r.start * fps);
        const dur = Math.max(1, Math.round(r.end * fps) - from);
        return (
          <Sequence key={i} from={from} durationInFrames={dur} layout="none">
            {r.insert === "call" ? (
              <LiveCallInsert rect={rect} radius={radius} duration={dur} />
            ) : (
              <RecordingFrame segments={r.segments} rect={rect} maxScale={maxScale} radius={radius} />
            )}
          </Sequence>
        );
      })}
    </>
  );
}

/** Picture in picture: the encounter page of the live call, and the lip-synced patient stream in front of it. */
export function LiveCallInsert({ rect, radius = 18, duration }: { rect: Rect; radius?: number; duration: number }) {
  const frame = useCurrentFrame();
  const k = rect.w / 1632;
  const pageScale = rect.h / CALL_PAGE.h;
  const pageW = CALL_PAGE.w * pageScale;
  const push = interpolate(frame, [0, duration], [1, 1.04], clamp);
  const pipIn = interpolate(frame, [6, 24], [0, 1], { ...clamp, easing: EASE });
  const fadeIn = interpolate(frame, [0, 8], [0, 1], clamp);
  const pipH = 700 * k;
  const pipW = pipH * (CALL_FACE.w / CALL_FACE.h);
  return (
    <div
      style={{
        position: "absolute",
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        borderRadius: radius,
        overflow: "hidden",
        backgroundColor: FILM.groundTop,
        boxShadow: "0 30px 80px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.08)",
        opacity: fadeIn,
      }}
    >
      <div style={{ position: "absolute", left: 40 * k, top: 0, width: pageW, height: rect.h, transform: `scale(${push})`, transformOrigin: "50% 40%" }}>
        <OffthreadVideo src={staticFile(CALL_PAGE.src)} muted style={{ width: pageW, height: rect.h, display: "block" }} />
      </div>
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(13,18,23,0) 62%, rgba(13,18,23,0.7) 100%)" }} />
      <div
        style={{
          position: "absolute",
          right: 70 * k,
          top: (rect.h - pipH) / 2,
          width: pipW,
          height: pipH,
          borderRadius: 16 * k,
          overflow: "hidden",
          boxShadow: `0 24px 60px rgba(0,0,0,0.55), 0 0 0 ${Math.max(2, 3 * k)}px ${FILM.accent}`,
          opacity: pipIn,
          transform: `translateY(${(1 - pipIn) * 24 * k}px)`,
        }}
      >
        <OffthreadVideo src={staticFile(CALL_FACE.src)} muted style={{ width: pipW, height: pipH, display: "block", objectFit: "cover" }} />
        <div
          style={{
            position: "absolute",
            left: 14 * k,
            top: 14 * k,
            display: "flex",
            alignItems: "center",
            gap: 8 * k,
            padding: `${6 * k}px ${12 * k}px`,
            borderRadius: 999,
            backgroundColor: "rgba(13,18,23,0.78)",
            fontFamily: FONT.mono,
            fontSize: 18 * k,
            letterSpacing: "0.06em",
            color: FILM.ink,
          }}
        >
          <span style={{ width: 10 * k, height: 10 * k, borderRadius: 5 * k, backgroundColor: "#ef4444" }} />
          LIVE · MuseTalk
        </div>
      </div>
    </div>
  );
}
