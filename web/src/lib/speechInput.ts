// speechInput.ts — push-to-talk voice DICTATION for the learner's composer.
//
// Web Speech STT is BROWSER-PROVIDED (the engine may use the browser vendor's
// own cloud service, e.g. Chrome). It is strictly OPTIONAL and is gated behind
// an explicit user press — nothing here runs until the learner taps the mic.
// The air-gapped pod path is entirely unaffected: this feeds the local text
// composer only, never the backend. Firefox and other engines without the API
// simply report `supported: false` and the mic control is not rendered.
//
// Dependency-free: a minimal local typing of the vendor API (no @types), no
// globals assumed, every browser access typeof-guarded so import is SSR-safe.

import { useCallback, useEffect, useRef, useState } from "react";

/** Normalised failure kinds surfaced to callers (see `mapError`). */
export type SpeechInputError =
  | "unsupported"
  | "denied"
  | "no-speech"
  | "network"
  | "aborted"
  | "unknown";

export interface UseSpeechInputOptions {
  /** BCP-47 language tag, e.g. "en" | "tr" | "es". Set as the recogniser lang. */
  lang: string;
  /** Final (committed) transcript for the utterance. */
  onFinal: (text: string) => void;
  /** Live, not-yet-final transcript while the learner is still speaking. */
  onInterim?: (text: string) => void;
  /** Recognition/permission failures, already mapped to `SpeechInputError`. */
  onError?: (kind: SpeechInputError) => void;
}

export interface UseSpeechInputResult {
  /** Whether the Web Speech API exists in this browser. */
  supported: boolean;
  /** Whether the recogniser is currently capturing. */
  listening: boolean;
  start: () => void;
  stop: () => void;
  toggle: () => void;
}

/* -------------------------------------------------------------------------- */
/* Minimal local typing of the (non-standard) Web Speech Recognition API.      */
/* Only the surface we touch is modelled — no `any`, no @types dependency.     */
/* -------------------------------------------------------------------------- */

interface MinimalSpeechRecognitionAlternative {
  readonly transcript: string;
}

interface MinimalSpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: MinimalSpeechRecognitionAlternative;
}

interface MinimalSpeechRecognitionResultList {
  readonly length: number;
  readonly [index: number]: MinimalSpeechRecognitionResult;
}

interface MinimalSpeechRecognitionEvent {
  readonly resultIndex: number;
  readonly results: MinimalSpeechRecognitionResultList;
}

interface MinimalSpeechRecognitionErrorEvent {
  readonly error: string;
}

interface MinimalSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: MinimalSpeechRecognitionEvent) => void) | null;
  onerror: ((event: MinimalSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionCtor = new () => MinimalSpeechRecognition;

/** Feature-detect the vendor constructor (SSR-safe, never throws). */
function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Map the engine's `error` code onto our stable union. */
function mapError(code: string): SpeechInputError {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "denied";
    case "no-speech":
      return "no-speech";
    case "network":
      return "network";
    case "aborted":
      return "aborted";
    default:
      return "unknown";
  }
}

/**
 * useSpeechInput — a dependency-free React wrapper over the browser Speech
 * Recognition API for push-to-talk dictation. `continuous: false` +
 * `interimResults: true`: interim text streams via `onInterim`, and the first
 * final result auto-stops the recogniser (the engine ends the session, which we
 * observe via `onend`). Cleans up on `stop()` and on unmount, and never throws.
 */
export function useSpeechInput(
  opts: UseSpeechInputOptions,
): UseSpeechInputResult {
  // Latest-value refs so the live recogniser always calls current callbacks /
  // language without being rebuilt on every render.
  const onFinalRef = useRef(opts.onFinal);
  const onInterimRef = useRef(opts.onInterim);
  const onErrorRef = useRef(opts.onError);
  const langRef = useRef(opts.lang);
  onFinalRef.current = opts.onFinal;
  onInterimRef.current = opts.onInterim;
  onErrorRef.current = opts.onError;
  langRef.current = opts.lang;

  const [supported] = useState(() => getRecognitionCtor() !== null);
  const [listening, setListening] = useState(false);

  const recognitionRef = useRef<MinimalSpeechRecognition | null>(null);
  const mountedRef = useRef(true);

  /** Detach handlers and drop the instance (no state writes). */
  const detach = useCallback(() => {
    const rec = recognitionRef.current;
    if (rec) {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
    }
    recognitionRef.current = null;
  }, []);

  const stop = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
    try {
      // stop() flushes any pending final result, then fires onend (→ cleanup).
      rec.stop();
    } catch {
      // Belt and suspenders: force it down and settle state ourselves.
      try {
        rec.abort();
      } catch {
        /* ignore */
      }
      detach();
      if (mountedRef.current) setListening(false);
    }
  }, [detach]);

  const start = useCallback(() => {
    if (recognitionRef.current) return; // already capturing
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      onErrorRef.current?.("unsupported");
      return;
    }

    let rec: MinimalSpeechRecognition;
    try {
      rec = new Ctor();
    } catch {
      onErrorRef.current?.("unknown");
      return;
    }

    rec.lang = langRef.current;
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (event) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const alt = result[0];
        const transcript = alt ? alt.transcript : "";
        if (result.isFinal) final += transcript;
        else interim += transcript;
      }
      if (interim) onInterimRef.current?.(interim);
      if (final) onFinalRef.current(final.trim());
    };

    rec.onerror = (event) => {
      onErrorRef.current?.(mapError(event.error));
      // onend follows and performs cleanup.
    };

    rec.onend = () => {
      detach();
      if (mountedRef.current) setListening(false);
    };

    recognitionRef.current = rec;
    try {
      rec.start();
      if (mountedRef.current) setListening(true);
    } catch {
      // start() throws if invoked while already running — settle and report.
      detach();
      if (mountedRef.current) setListening(false);
      onErrorRef.current?.("unknown");
    }
  }, [detach]);

  const toggle = useCallback(() => {
    if (recognitionRef.current) stop();
    else start();
  }, [start, stop]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const rec = recognitionRef.current;
      if (rec) {
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        try {
          rec.abort();
        } catch {
          /* ignore */
        }
      }
      recognitionRef.current = null;
    };
  }, []);

  return { supported, listening, start, stop, toggle };
}
