/**
 * AcuDx — lipsync: a lightweight, dependency-free lip-sync helper for the
 * procedural patient avatar.
 *
 * The problem it solves: when a student converses with the synthetic patient we
 * want the face to MOVE while the patient "speaks" a turn — plausibly forming
 * mouth shapes (visemes), not just flapping open/closed — WITHOUT any server GPU,
 * without real audio, and without shipping a heavy phoneme/TTS engine. So this
 * module approximates a viseme timeline straight from the text and drives an
 * animated jaw/mouth-shape signal over time.
 *
 *   textToVisemes(text)  — grapheme→mouth-shape heuristic (EN + Turkish aware),
 *                          with a per-viseme duration so a spoken turn animates
 *                          on a wall clock even with no audio track.
 *   useSpeech()          — a React hook that plays such a timeline: `jawOpen`
 *                          (0..1) and `mouthShape` evolve over time via rAF, are
 *                          THROTTLED so they never spike React, and collapse to a
 *                          simple low-frequency open/close under reduced motion.
 *                          If `SpeechSynthesis` is available AND opted in, it can
 *                          also voice the text and resync visemes to `onboundary`
 *                          word events — but audio is NEVER required.
 *
 * Air-gapped: no imports beyond React, no network. Education only. Synthetic
 * patient — this is a stylised approximation of speech, not a biometric model.
 */

import { useCallback, useEffect, useRef, useState } from "react";

/* -------------------------------------------------------------------------- */
/* Mouth-shape vocabulary + geometry                                           */
/* -------------------------------------------------------------------------- */

/**
 * A small, renderer-agnostic set of mouth shapes — enough to read as speech
 * without pretending to be ARKit-52. Each maps to a jaw opening and lip
 * spread/rounding via {@link mouthGeometry}, the single source of truth both the
 * timeline and the 3D head consume so they can never disagree.
 */
export type MouthShape =
  | "rest" // closed / neutral (silence, gaps)
  | "aa" // open wide — "a"
  | "e" // mid, spread — "e"
  | "i" // narrow, spread — "i" / "ı"
  | "o" // rounded, mid — "o" / "ö"
  | "u" // rounded, close — "u" / "ü" / "w"
  | "mbp" // lips pressed — bilabial m/b/p
  | "fv" // lip-to-teeth — labiodental f/v
  | "cons"; // generic consonant — t/d/n/s/k/g/l/r/…

/** Geometry for one mouth shape: how far the jaw drops, how wide/round the lips. */
export interface MouthGeometry {
  /** Jaw opening, 0 (closed) .. 1 (wide). */
  jaw: number;
  /** Horizontal lip spread as a scale factor (1 = neutral, >1 wide, <1 pucker). */
  width: number;
  /** Lip rounding / protrusion, 0 (flat) .. 1 (fully rounded). */
  round: number;
}

const MOUTH_GEOMETRY: Record<MouthShape, MouthGeometry> = {
  rest: { jaw: 0.05, width: 1.0, round: 0.0 },
  aa: { jaw: 1.0, width: 1.05, round: 0.1 },
  e: { jaw: 0.5, width: 1.18, round: 0.0 },
  i: { jaw: 0.24, width: 1.3, round: 0.0 },
  o: { jaw: 0.6, width: 0.78, round: 0.7 },
  u: { jaw: 0.3, width: 0.62, round: 1.0 },
  mbp: { jaw: 0.0, width: 0.95, round: 0.2 },
  fv: { jaw: 0.16, width: 1.0, round: 0.1 },
  cons: { jaw: 0.22, width: 1.0, round: 0.1 },
};

/** Geometry (jaw / width / round) for a mouth shape. Single source of truth. */
export function mouthGeometry(shape: MouthShape): MouthGeometry {
  return MOUTH_GEOMETRY[shape];
}

/* -------------------------------------------------------------------------- */
/* Viseme timeline                                                             */
/* -------------------------------------------------------------------------- */

/** One entry in an approximate viseme timeline. */
export interface Viseme {
  /** Mouth shape to hold for this slice. */
  shape: MouthShape;
  /** Target jaw opening 0..1 (mirrors {@link mouthGeometry}.jaw). */
  jaw: number;
  /** How long to hold this shape, in milliseconds. */
  durationMs: number;
}

export interface TextToVisemesOptions {
  /** Speech-rate multiplier: >1 speaks faster (shorter holds). Default 1. */
  rate?: number;
}

/** Base hold per shape, ms — vowels linger, consonants are brief. */
const SHAPE_MS: Record<MouthShape, number> = {
  rest: 90,
  aa: 135,
  e: 120,
  i: 110,
  o: 130,
  u: 120,
  mbp: 68,
  fv: 74,
  cons: 70,
};

/** Pause inserted between words. */
const WORD_GAP_MS = 85;
/** Trailing silence so the mouth settles closed at the end of a turn. */
const TAIL_MS = 140;
/** Cap merged runs so a long consonant cluster never freezes the jaw. */
const MERGE_CAP_MS = 190;
/** Hard safety cap on timeline length (long paragraphs stay cheap). */
const MAX_VISEMES = 600;

/** Vowel graphemes → shape, covering EN plus Turkish (ı/ö/ü) and common accents. */
const VOWEL_SHAPE: Record<string, MouthShape> = {
  a: "aa",
  á: "aa",
  à: "aa",
  â: "aa",
  ä: "aa",
  e: "e",
  é: "e",
  è: "e",
  ê: "e",
  i: "i",
  í: "i",
  ì: "i",
  î: "i",
  ï: "i",
  ı: "i",
  o: "o",
  ó: "o",
  ò: "o",
  ô: "o",
  ö: "o",
  u: "u",
  ú: "u",
  ù: "u",
  û: "u",
  ü: "u",
};

/** Consonant graphemes with a distinctive lip posture. */
const CONSONANT_SHAPE: Record<string, MouthShape> = {
  m: "mbp",
  b: "mbp",
  p: "mbp",
  f: "fv",
  v: "fv",
  w: "u", // rounded glide
};

const LETTER_RE = /\p{L}/u;

/** Classify one grapheme into a mouth shape, or null for gaps (space/punct). */
function shapeForChar(ch: string): MouthShape | null {
  // Lenient lowercase: for lip shape, EN "I" and Turkish "ı"/"İ" all read as
  // the narrow "i" posture, so the classic Turkish dotted-I casing pitfall is
  // moot here — both cases land on the same shape.
  const lc = ch.toLowerCase();
  const vowel = VOWEL_SHAPE[lc];
  if (vowel) return vowel;
  const cons = CONSONANT_SHAPE[lc];
  if (cons) return cons;
  if (LETTER_RE.test(lc)) return "cons";
  return null; // whitespace, digits, punctuation → word gap / silence
}

/**
 * Approximate a viseme/jaw-open timeline from text. Pure and deterministic:
 * the same string always yields the same timeline, so a turn animates plausibly
 * with NO audio. Adjacent identical shapes are merged (capped) to damp jitter,
 * and word gaps are inserted as brief rests. EN + Turkish aware.
 */
export function textToVisemes(
  text: string,
  opts: TextToVisemesOptions = {},
): Viseme[] {
  const rate = opts.rate && opts.rate > 0 ? opts.rate : 1;
  const out: Viseme[] = [];
  if (!text) return out;

  const push = (shape: MouthShape, ms: number): void => {
    if (out.length >= MAX_VISEMES) return;
    const scaled = Math.max(24, Math.round(ms / rate));
    const last = out[out.length - 1];
    // Merge consecutive same-shape slices (up to a cap) so clusters don't freeze.
    if (last && last.shape === shape && last.durationMs < MERGE_CAP_MS) {
      last.durationMs = Math.min(MERGE_CAP_MS, last.durationMs + scaled);
      return;
    }
    out.push({ shape, jaw: MOUTH_GEOMETRY[shape].jaw, durationMs: scaled });
  };

  const chars = Array.from(text.trim()); // grapheme-ish; handles surrogate pairs
  let inGap = true; // suppress leading gaps
  for (const ch of chars) {
    if (out.length >= MAX_VISEMES) break;
    const shape = shapeForChar(ch);
    if (shape === null) {
      // A run of gap characters counts as a single word boundary.
      if (!inGap) {
        push("rest", WORD_GAP_MS);
        inGap = true;
      }
      continue;
    }
    inGap = false;
    push(shape, SHAPE_MS[shape]);
  }

  if (out.length > 0) out.push({ shape: "rest", jaw: MOUTH_GEOMETRY.rest.jaw, durationMs: TAIL_MS });
  return out;
}

/* -------------------------------------------------------------------------- */
/* Internal timeline model                                                     */
/* -------------------------------------------------------------------------- */

interface TimedViseme extends Viseme {
  /** Absolute start time in the utterance, ms. */
  startMs: number;
  /** Absolute end time in the utterance, ms. */
  endMs: number;
}

interface Timeline {
  frames: TimedViseme[];
  totalMs: number;
  /** For each source-char index, the utterance time at which it is spoken. */
  charStartMs: number[];
}

/** Build an absolute-timed timeline plus a char→time map for onboundary resync. */
function buildTimeline(text: string, rate: number): Timeline {
  // Re-derive per-char so we can map word-boundary char indices back to time.
  const scaledRate = rate > 0 ? rate : 1;
  const frames: TimedViseme[] = [];
  const charStartMs: number[] = [];
  const chars = Array.from(text);
  let t = 0;
  let inGap = true;

  const advance = (ms: number): void => {
    const dur = Math.max(24, Math.round(ms / scaledRate));
    frames.push({ shape: "rest", jaw: 0, durationMs: dur, startMs: t, endMs: t + dur });
    t += dur;
  };

  for (let i = 0; i < chars.length; i++) {
    charStartMs[i] = t;
    const shape = shapeForChar(chars[i]);
    if (shape === null) {
      if (!inGap) {
        advance(WORD_GAP_MS);
        inGap = true;
      }
      continue;
    }
    inGap = false;
    const dur = Math.max(24, Math.round(SHAPE_MS[shape] / scaledRate));
    frames.push({
      shape,
      jaw: MOUTH_GEOMETRY[shape].jaw,
      durationMs: dur,
      startMs: t,
      endMs: t + dur,
    });
    t += dur;
  }
  if (frames.length > 0) {
    const dur = Math.max(24, Math.round(TAIL_MS / scaledRate));
    frames.push({ shape: "rest", jaw: 0, durationMs: dur, startMs: t, endMs: t + dur });
    t += dur;
  }
  return { frames, totalMs: t, charStartMs };
}

/** Find the frame active at time `ms` (linear scan from a hint index). */
function frameIndexAt(frames: TimedViseme[], ms: number, hint: number): number {
  let i = Math.max(0, Math.min(hint, frames.length - 1));
  while (i < frames.length - 1 && ms >= frames[i].endMs) i++;
  while (i > 0 && ms < frames[i].startMs) i--;
  return i;
}

/* -------------------------------------------------------------------------- */
/* useSpeech hook                                                              */
/* -------------------------------------------------------------------------- */

export interface SpeakOptions {
  /** Opt in to voicing the text via the Web Speech API (default OFF, silent). */
  voice?: boolean;
  /** Speech-rate multiplier (>1 faster). Default 1. */
  rate?: number;
  /** BCP-47 language hint for the optional TTS voice, e.g. "tr" / "en". */
  lang?: string;
  /** Fired once when the utterance finishes (or is stopped). */
  onEnd?: () => void;
}

export interface UseSpeechOptions {
  /**
   * When false the animation clock is paused (e.g. the avatar is offscreen or
   * the tab is hidden) so we never burn frames the viewer can't see. Default
   * true. Playback resumes from where it paused.
   */
  active?: boolean;
}

export interface SpeechController {
  /** Begin animating a spoken turn from `text`. Replaces any in-flight turn. */
  speak: (text: string, opts?: SpeakOptions) => void;
  /** Stop immediately, settle the mouth closed, and clear `speaking`. */
  stop: () => void;
  /** True while a turn is animating. */
  speaking: boolean;
  /** Current jaw opening, 0 (closed) .. 1 (wide), smoothed + throttled. */
  jawOpen: number;
  /** Current mouth shape (drives lip spread/round in the renderer). */
  mouthShape: MouthShape;
}

/** Throttle React state emits to ~22fps; the renderer lerps between them. */
const EMIT_MS = 45;
/** Reduced-motion open/close cadence — deliberately slow + calm. */
const SIMPLE_STEP_MS = 200;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Drive an animated `jawOpen` / `mouthShape` signal from a patient utterance.
 *
 * Full path (motion allowed): a rAF clock walks the {@link textToVisemes}
 * timeline, emitting throttled state the renderer can lerp — so the mouth forms
 * shapes, never just flaps. Reduced-motion path: a slow, low-amplitude
 * open/close on a timer instead, so the intent ("this patient is talking")
 * still reads without vestibular motion. Audio is optional and never required.
 */
export function useSpeech(options: UseSpeechOptions = {}): SpeechController {
  const active = options.active ?? true;

  const [speaking, setSpeaking] = useState(false);
  const [jawOpen, setJawOpen] = useState(0);
  const [mouthShape, setMouthShape] = useState<MouthShape>("rest");

  // Live mirrors so the animation callbacks stay identity-stable.
  const activeRef = useRef(active);
  const reducedRef = useRef(prefersReducedMotion());
  const speakingRef = useRef(false);
  const shapeRef = useRef<MouthShape>("rest");
  const jawRef = useRef(0);

  const rafRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const lastEmitRef = useRef(0);
  const elapsedRef = useRef(0);
  const hintRef = useRef(0);
  const stepRef = useRef(0);

  const timelineRef = useRef<Timeline | null>(null);
  const onEndRef = useRef<(() => void) | undefined>(undefined);
  const endedRef = useRef(true);
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Keep the active flag current without re-creating callbacks.
  useEffect(() => {
    activeRef.current = active;
    if (active) lastTsRef.current = null; // avoid a huge dt on resume
  }, [active]);

  // Track reduced-motion preference live (used by the NEXT utterance).
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    let mql: MediaQueryList;
    try {
      mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    } catch {
      return;
    }
    const onChange = (): void => {
      reducedRef.current = mql.matches;
    };
    onChange();
    mql.addEventListener?.("change", onChange);
    return () => mql.removeEventListener?.("change", onChange);
  }, []);

  const emit = useCallback((jaw: number, shape: MouthShape, force: boolean): void => {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const shapeChanged = shape !== shapeRef.current;
    if (!force && !shapeChanged && now - lastEmitRef.current < EMIT_MS) return;
    lastEmitRef.current = now;
    if (Math.abs(jaw - jawRef.current) > 0.001 || force) {
      jawRef.current = jaw;
      setJawOpen(jaw);
    }
    if (shapeChanged) {
      shapeRef.current = shape;
      setMouthShape(shape);
    }
  }, []);

  const cancelLoops = useCallback((): void => {
    if (rafRef.current != null && typeof cancelAnimationFrame !== "undefined") {
      cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = null;
    if (intervalRef.current != null && typeof window !== "undefined") {
      window.clearInterval(intervalRef.current);
    }
    intervalRef.current = null;
    lastTsRef.current = null;
  }, []);

  const finish = useCallback((): void => {
    if (endedRef.current) return;
    endedRef.current = true;
    cancelLoops();
    speakingRef.current = false;
    setSpeaking(false);
    emit(0, "rest", true);
    if (typeof window !== "undefined" && window.speechSynthesis && utterRef.current) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* ignore */
      }
    }
    utterRef.current = null;
    const cb = onEndRef.current;
    onEndRef.current = undefined;
    cb?.();
  }, [cancelLoops, emit]);

  const stop = useCallback((): void => {
    finish();
  }, [finish]);

  // rAF viseme playback (motion allowed).
  const startVisemeLoop = useCallback((): void => {
    if (typeof requestAnimationFrame === "undefined") return;
    const tick = (ts: number): void => {
      rafRef.current = requestAnimationFrame(tick);
      if (!activeRef.current) {
        lastTsRef.current = ts; // paused: hold the clock
        return;
      }
      const last = lastTsRef.current ?? ts;
      lastTsRef.current = ts;
      let dt = ts - last;
      if (dt > 100) dt = 100; // clamp long stalls (tab switch)
      elapsedRef.current += dt;

      const tl = timelineRef.current;
      if (!tl || elapsedRef.current >= tl.totalMs) {
        finish();
        return;
      }
      const idx = frameIndexAt(tl.frames, elapsedRef.current, hintRef.current);
      hintRef.current = idx;
      const f = tl.frames[idx];
      emit(f.jaw, f.shape, false);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [emit, finish]);

  // Timer open/close (reduced motion): slow, calm, low-amplitude.
  const startSimpleLoop = useCallback((): void => {
    if (typeof window === "undefined") return;
    stepRef.current = 0;
    intervalRef.current = window.setInterval(() => {
      if (!activeRef.current) return; // paused offscreen/hidden
      elapsedRef.current += SIMPLE_STEP_MS;
      const tl = timelineRef.current;
      if (!tl || elapsedRef.current >= tl.totalMs) {
        finish();
        return;
      }
      stepRef.current += 1;
      const open = stepRef.current % 2 === 1;
      emit(open ? 0.28 : 0.06, open ? "aa" : "rest", true);
    }, SIMPLE_STEP_MS);
  }, [emit, finish]);

  // Optional Web Speech API voice, with onboundary → viseme resync.
  const startVoice = useCallback((text: string, opts: SpeakOptions): void => {
    if (
      typeof window === "undefined" ||
      !window.speechSynthesis ||
      typeof SpeechSynthesisUtterance === "undefined"
    ) {
      return;
    }
    try {
      const u = new SpeechSynthesisUtterance(text);
      if (opts.lang) u.lang = opts.lang;
      if (opts.rate && opts.rate > 0) u.rate = Math.max(0.5, Math.min(2, opts.rate));
      u.onboundary = (ev: SpeechSynthesisEvent): void => {
        const tl = timelineRef.current;
        if (!tl) return;
        const at = tl.charStartMs[ev.charIndex];
        if (typeof at === "number") {
          // Resync the visual clock to the word the voice just reached.
          elapsedRef.current = at;
          hintRef.current = 0;
        }
      };
      u.onend = (): void => finish();
      utterRef.current = u;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch {
      utterRef.current = null; // audio is a bonus, never a requirement
    }
  }, [finish]);

  const speak = useCallback(
    (text: string, opts: SpeakOptions = {}): void => {
      cancelLoops();
      const trimmed = (text ?? "").trim();
      if (!trimmed) {
        finish();
        return;
      }
      timelineRef.current = buildTimeline(trimmed, opts.rate ?? 1);
      elapsedRef.current = 0;
      hintRef.current = 0;
      lastTsRef.current = null;
      lastEmitRef.current = 0;
      onEndRef.current = opts.onEnd;
      endedRef.current = false;
      speakingRef.current = true;
      setSpeaking(true);
      emit(0, "rest", true);

      if (reducedRef.current) {
        startSimpleLoop();
      } else {
        startVisemeLoop();
      }
      if (opts.voice) startVoice(trimmed, opts);
    },
    [cancelLoops, emit, finish, startSimpleLoop, startVisemeLoop, startVoice],
  );

  // Tear down on unmount (finish is identity-stable).
  useEffect(() => {
    return () => finish();
  }, [finish]);

  return { speak, stop, speaking, jawOpen, mouthShape };
}
