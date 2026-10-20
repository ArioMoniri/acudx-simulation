/**
 * The walkthrough edit, computed from the recorder's JSON timeline
 * (scripts/record-walkthrough.mjs). Three pure steps:
 *
 * 1. `buildCut`: which spans of the raw recording are kept and at what speed
 *    (skip spans dropped, idle gaps trimmed, each chapter fitted to a budget).
 * 2. `mapTime`: source seconds to output seconds through that cut.
 * 3. `buildCamera` / `cameraAt`: zoom-to-focus keyframes from the bounding
 *    boxes of the clicked or framed elements, chained when steps are close,
 *    eased back to the full frame when they are not.
 *
 * Nothing here draws; Walkthrough.tsx renders the result.
 */
import rawTimeline from "../../public/recording/walkthrough.json";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TimelineEvent {
  t: number;
  chapter: string;
  action: string;
  label?: string;
  text?: string;
  box?: Box | null;
  focus?: Box | null;
  zoom?: number;
  dy?: number;
}

export interface Timeline {
  width: number;
  height: number;
  duration: number;
  events: TimelineEvent[];
}

export const TIMELINE = rawTimeline as Timeline;

/** One kept span of the source, played at `rate`, placed at `out0` in the output. */
export interface Segment {
  chapter: string;
  src0: number;
  src1: number;
  rate: number;
  out0: number;
  out1: number;
  /** Set on a spliced clip that is not the screen recording (e.g. "call", the live patient video). */
  insert?: string;
}

export interface CutOptions {
  /** Output seconds per chapter; chapters not listed are dropped. */
  budgets: Record<string, number>;
  /** Maximum speed-up applied to fit a budget. */
  maxRate?: number;
  /** Idle gaps longer than this (source seconds) are trimmed. */
  idleGap?: number;
  /** Seconds kept after an event and before the next one when a gap is trimmed. */
  keepAfter?: number;
  keepBefore?: number;
  /** Shift applied to every timeline time to line it up with the video (seconds). */
  offset?: number;
  /** Source length of the recording (seconds). */
  sourceDuration?: number;
}

const ACTIONS = new Set(["click", "type", "select", "focus", "scroll", "drag"]);

/** Kept source spans for one chapter: skip spans removed, idle gaps trimmed. */
function chapterSpans(events: TimelineEvent[], start: number, end: number, o: Required<CutOptions>, keepTail = false): Array<[number, number]> {
  const inside = events.filter((e) => e.t >= start && e.t < end);
  // 1. drop skip-begin .. skip-end
  let spans: Array<[number, number]> = [[start, end]];
  let open: number | null = null;
  for (const e of inside) {
    if (e.action === "skip-begin") open = e.t;
    if (e.action === "skip-end" && open !== null) {
      const a = open;
      const b = e.t;
      spans = spans.flatMap(([s0, s1]) => {
        if (b <= s0 || a >= s1) return [[s0, s1]];
        const out: Array<[number, number]> = [];
        if (a > s0) out.push([s0, a]);
        if (b < s1) out.push([b, s1]);
        return out;
      });
      open = null;
    }
  }
  // 2. trim idle gaps between consecutive actions (and the chapter edges)
  const marks = [start, ...inside.filter((e) => ACTIONS.has(e.action)).map((e) => e.t), end];
  const idle: Array<[number, number]> = [];
  for (let i = 0; i < marks.length - 1; i++) {
    const a = marks[i];
    const b = marks[i + 1];
    // The final chapter keeps its tail: it is the last look before the end card.
    if (keepTail && i === marks.length - 2) continue;
    if (b - a > o.idleGap) idle.push([a + o.keepAfter, b - o.keepBefore]);
  }
  for (const [a, b] of idle) {
    spans = spans.flatMap(([s0, s1]) => {
      if (b <= s0 || a >= s1) return [[s0, s1]];
      const out: Array<[number, number]> = [];
      if (a > s0) out.push([s0, a]);
      if (b < s1) out.push([b, s1]);
      return out;
    });
  }
  return spans.filter(([a, b]) => b - a > 0.08);
}

export function buildCut(timeline: Timeline, options: CutOptions): Segment[] {
  const o: Required<CutOptions> = {
    maxRate: 2.2,
    idleGap: 2.6,
    keepAfter: 1.7,
    keepBefore: 0.7,
    offset: 0,
    sourceDuration: timeline.duration,
    ...options,
  };
  const events = timeline.events.map((e) => ({ ...e, t: e.t + o.offset }));
  const chapters = events.filter((e) => e.action === "chapter");
  const endEvent = events.find((e) => e.action === "end");
  const segments: Segment[] = [];
  let out = 0;
  chapters.forEach((c, i) => {
    const budget = o.budgets[c.chapter];
    if (budget === undefined) return;
    const start = c.t;
    const end = Math.min(chapters[i + 1]?.t ?? endEvent?.t ?? o.sourceDuration, o.sourceDuration - 0.05);
    const isLast = !chapters.slice(i + 1).some((n) => o.budgets[n.chapter] !== undefined);
    const spans = chapterSpans(events, start, end, o, isLast);
    const raw = spans.reduce((s, [a, b]) => s + (b - a), 0);
    const rate = Math.min(o.maxRate, Math.max(1, raw / budget));
    for (const [a, b] of spans) {
      const len = (b - a) / rate;
      segments.push({ chapter: c.chapter, src0: a, src1: b, rate, out0: out, out1: out + len });
      out += len;
    }
  });
  return segments;
}

/** Source seconds (timeline clock) to output seconds, or null when the moment was cut. */
export function mapTime(segments: Segment[], t: number, offset = 0): number | null {
  const s = t + offset;
  for (const seg of segments) {
    if (seg.insert) continue;
    if (s >= seg.src0 && s <= seg.src1) return seg.out0 + (s - seg.src0) / seg.rate;
  }
  return null;
}

export function cutDuration(segments: Segment[]): number {
  return segments.length ? segments[segments.length - 1].out1 : 0;
}

/** Chapter ranges in output seconds, in order. */
export function chapterRanges(segments: Segment[]): Array<{ chapter: string; out0: number; out1: number }> {
  const out: Array<{ chapter: string; out0: number; out1: number }> = [];
  for (const seg of segments) {
    const last = out[out.length - 1];
    if (last && last.chapter === seg.chapter) last.out1 = seg.out1;
    else out.push({ chapter: seg.chapter, out0: seg.out0, out1: seg.out1 });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Camera                                                                      */
/* -------------------------------------------------------------------------- */

export interface CameraState {
  scale: number;
  cx: number;
  cy: number;
}

export interface CameraKey {
  /** Output seconds at which the camera has arrived at `state`. */
  t: number;
  state: CameraState;
}

export interface CameraOptions {
  width: number;
  height: number;
  /** Seconds the zoom-in takes; it lands just before the action. */
  lead?: number;
  /** Seconds the zoom holds after the last action of a run. */
  hold?: number;
  /** Seconds the ease back out to the full frame takes. */
  release?: number;
  /** Steps closer than this (output seconds) stay zoomed and pan instead. */
  chain?: number;
  /** Scale cap. */
  maxScale?: number;
  offset?: number;
}

const FULL = (w: number, h: number): CameraState => ({ scale: 1, cx: w / 2, cy: h / 2 });

/** Fit a box: the requested scale, reduced until the box (with margin) fits; centre clamped in frame. */
function frameBox(box: Box, want: number, w: number, h: number, maxScale: number): CameraState {
  const fit = Math.min(w / (box.w * 1.18), h / (box.h * 1.22));
  const scale = Math.max(1, Math.min(want, fit, maxScale));
  const halfW = w / (2 * scale);
  const halfH = h / (2 * scale);
  const cx = Math.min(w - halfW, Math.max(halfW, box.x + box.w / 2));
  const cy = Math.min(h - halfH, Math.max(halfH, box.y + box.h / 2));
  return { scale, cx, cy };
}

export function buildCamera(timeline: Timeline, segments: Segment[], options: CameraOptions): CameraKey[] {
  const o = { lead: 0.55, hold: 1.1, release: 0.7, chain: 2.4, maxScale: 1.8, offset: 0, ...options };
  const full = FULL(o.width, o.height);
  const shots: Array<{ t: number; state: CameraState }> = [];
  for (const e of timeline.events) {
    if (!ACTIONS.has(e.action)) continue;
    const t = mapTime(segments, e.t, o.offset);
    if (t === null) continue;
    const zoom = e.zoom ?? 0;
    const box = e.focus ?? e.box;
    const state = zoom > 1 && box ? frameBox(box, zoom, o.width, o.height, o.maxScale) : full;
    shots.push({ t, state });
  }
  // A scroll moves the page under the camera: hold the full frame for it.
  const keys: CameraKey[] = [{ t: 0, state: full }];
  let current = full;
  let lastT = 0;
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i];
    const next = shots[i + 1];
    const arrive = Math.max(lastT + 0.05, s.t - 0.05);
    const depart = Math.max(lastT, arrive - o.lead);
    keys.push({ t: depart, state: current });
    keys.push({ t: arrive, state: s.state });
    current = s.state;
    lastT = arrive;
    const gap = next ? next.t - s.t : Infinity;
    if (s.state.scale > 1 && gap > o.chain) {
      const holdEnd = s.t + o.hold;
      const back = holdEnd + o.release;
      if (!next || back < next.t - o.lead) {
        keys.push({ t: holdEnd, state: s.state });
        keys.push({ t: back, state: full });
        current = full;
        lastT = back;
      }
    }
  }
  return keys;
}

/** Ease used between camera keys: a critically damped spring, sampled. */
function springEase(p: number): number {
  // 1 - (1 + k p) e^(-k p), normalised so f(1) = 1. k = 7 gives a soft arrival.
  const k = 7;
  const f = (x: number) => 1 - (1 + k * x) * Math.exp(-k * x);
  return f(Math.min(1, Math.max(0, p))) / f(1);
}

export function cameraAt(keys: CameraKey[], t: number): CameraState {
  if (keys.length === 0) return { scale: 1, cx: 0, cy: 0 };
  if (t <= keys[0].t) return keys[0].state;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t;
      const p = span <= 0 ? 1 : springEase((t - a.t) / span);
      // Interpolate in log-scale so zooming feels even, and the centre linearly.
      const scale = Math.exp(Math.log(a.state.scale) + (Math.log(b.state.scale) - Math.log(a.state.scale)) * p);
      return {
        scale,
        cx: a.state.cx + (b.state.cx - a.state.cx) * p,
        cy: a.state.cy + (b.state.cy - a.state.cy) * p,
      };
    }
  }
  return keys[keys.length - 1].state;
}

/** Output time of the first event in the cut whose label matches. */
export function findEvent(timeline: Timeline, segments: Segment[], label: RegExp, offset = 0): number | null {
  for (const e of timeline.events) {
    if (e.label && label.test(e.label)) {
      const t = mapTime(segments, e.t, offset);
      if (t !== null) return t;
    }
  }
  return null;
}

/** Source time of the first event whose label matches (timeline clock). */
export function sourceTimeOf(timeline: Timeline, label: RegExp): number {
  const e = timeline.events.find((ev) => ev.label && label.test(ev.label));
  if (!e) throw new Error(`no timeline event matches ${label}`);
  return e.t;
}

/** A hand-picked cut: explicit source spans, each with its own speed. */
export function buildClips(clips: Array<{ chapter: string; src0: number; src1: number; rate?: number }>): Segment[] {
  let out = 0;
  return clips.map((c) => {
    const rate = c.rate ?? 1;
    const len = (c.src1 - c.src0) / rate;
    const seg = { chapter: c.chapter, src0: c.src0, src1: c.src1, rate, out0: out, out1: out + len };
    out += len;
    return seg;
  });
}

/**
 * Replace the recording of one chapter with a spliced clip of `duration`
 * output seconds (the chapter keeps its place, caption and marker); later
 * segments shift by the difference.
 */
export function spliceInsert(segments: Segment[], chapter: string, insert: string, duration: number): Segment[] {
  const first = segments.findIndex((s) => s.chapter === chapter);
  if (first < 0) return segments;
  const own = segments.filter((s) => s.chapter === chapter);
  const start = own[0].out0;
  const shift = duration - (own[own.length - 1].out1 - start);
  const out: Segment[] = [];
  for (const s of segments) {
    if (s.chapter === chapter) {
      if (s === own[0]) out.push({ chapter, src0: -1, src1: -1, rate: 1, out0: start, out1: start + duration, insert });
      continue;
    }
    out.push(s.out0 >= start ? { ...s, out0: s.out0 + shift, out1: s.out1 + shift } : s);
  }
  return out;
}

/** Consecutive runs of recording segments and inserts, each rebased to its own start. */
export function splitRuns(segments: Segment[]): Array<{ start: number; end: number; insert?: string; segments: Segment[] }> {
  const runs: Array<{ start: number; end: number; insert?: string; segments: Segment[] }> = [];
  for (const s of segments) {
    const last = runs[runs.length - 1];
    if (!s.insert && last && !last.insert) {
      last.segments.push(s);
      last.end = s.out1;
    } else {
      runs.push({ start: s.out0, end: s.out1, insert: s.insert, segments: [s] });
    }
  }
  return runs.map((r) => ({ ...r, segments: r.segments.map((s) => ({ ...s, out0: s.out0 - r.start, out1: s.out1 - r.start })) }));
}
