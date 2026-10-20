/**
 * PatientCallTile: the patient as a video-call participant beside the chat.
 *
 * Two paths, chosen from the gateway's /v1/voice/capabilities:
 *  - realtime: an avatar row of kind `avatar` (LiveKit transport) exists, so the
 *    tile joins the encounter's room with a short-lived token and renders the
 *    renderer participant's video track (Simli / Anam / self-hosted MuseTalk);
 *  - local (the default and the AIRGAPPED fallback): the talking-head clip and a
 *    viseme overlay are driven by the ACTUAL patient audio through a Web Audio
 *    AnalyserNode (audioLipsync.ts), so the clip plays exactly as long as the
 *    voice and the mouth follows loudness, not text timing. Without audio (voice
 *    off, or no TTS provider) the text-timed `useSpeech` timeline still animates
 *    so the patient visibly talks.
 *
 * Call controls: mute, hold, end / rejoin, captions (live transcript of the last
 * patient line and the learner's last line). Symptom overlays come from the live
 * vitals through the same `photoSignsFromVitals` / `SymptomSummary` the viewer
 * uses, so the face, the chips and the monitor never disagree.
 *
 * Reduced motion: the clip and overlay stay still (PatientPhoto already does
 * this); the status text carries the meaning. Education only, synthetic patient.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ClosedCaptioning,
  Microphone,
  MicrophoneSlash,
  Pause,
  PhoneDisconnect,
  PhoneIncoming,
  Play,
  SpeakerHigh,
  SpeakerSlash,
  VideoCamera,
  WifiSlash,
} from "@phosphor-icons/react";

import { PatientPhoto } from "@/components/PatientPhoto";
import { SymptomSummary, photoSignsFromVitals, type VitalsLike } from "@/components/PatientViewer";
import { resolvePatientVisual } from "@/domain/patientIdentity";
import type { CaseInstance } from "@/domain/case";
import { cn } from "@/lib/cn";
import { useSpeech, type MouthShape } from "@/lib/lipsync";
import { createAnalyserEnvelope, overlayGeometry, type AnalyserEnvelope } from "@/lib/audioLipsync";
import { getTtsAudioElement, pauseTts, resumeTts, setTtsMuted, speakAsPatient, stopTts, ttsMaybeAvailable } from "@/lib/tts";
import { voiceApi, type VoiceCapabilities } from "@/lib/voiceApi";

export type CallState = "connecting" | "live" | "hold" | "ended";
export type CallMode = "realtime" | "local";

export interface PatientCallTileProps {
  caseInstance: CaseInstance;
  vitals: VitalsLike;
  /** The patient's latest line (changing it starts a new spoken turn). */
  utterance: string;
  /** The learner's latest line, for captions. */
  learnerLine?: string;
  voiceOn: boolean;
  onToggleVoice: () => void;
  lang: "en" | "tr";
  /** Encounter id used for the LiveKit room name (opaque hash server-side). */
  encounterId?: string;
  className?: string;
}

/** Reduced-motion preference (SSR-safe). */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

interface LiveKitHandle {
  disconnect: () => void;
}

/**
 * Join the encounter room and attach the renderer participant's video + audio.
 * The renderer joins as an agent participant carrying `lk.publish_on_behalf`
 * (https://docs.livekit.io/agents/models/avatar/#avatar-workers); any agent
 * video track is accepted so a renderer that publishes directly also works.
 */
async function joinLiveKit(
  encounterId: string,
  videoEl: HTMLVideoElement,
  audioEl: HTMLAudioElement,
  onVideo: (hasVideo: boolean) => void,
): Promise<LiveKitHandle | null> {
  const token = await voiceApi.roomToken(encounterId);
  if (!token.ok) return null;
  const lk = await import("livekit-client");
  const room = new lk.Room({ adaptiveStream: true, dynacast: true });
  const attach = (track: { kind: string; attach: (el: HTMLMediaElement) => HTMLMediaElement }) => {
    if (track.kind === lk.Track.Kind.Video) {
      track.attach(videoEl);
      onVideo(true);
    } else if (track.kind === lk.Track.Kind.Audio) {
      track.attach(audioEl);
    }
  };
  room.on(lk.RoomEvent.TrackSubscribed, (track) => attach(track));
  room.on(lk.RoomEvent.TrackUnsubscribed, (track) => {
    track.detach();
    if (track.kind === lk.Track.Kind.Video) onVideo(false);
  });
  room.on(lk.RoomEvent.Disconnected, () => onVideo(false));
  await room.connect(token.data.url, token.data.token);
  // Publish the learner's microphone so the agent's STT hears the questions.
  try {
    await room.localParticipant.setMicrophoneEnabled(true);
  } catch {
    /* mic denied: the learner can still type */
  }
  return {
    disconnect: () => {
      void room.disconnect();
    },
  };
}

export function PatientCallTile({
  caseInstance,
  vitals,
  utterance,
  learnerLine,
  voiceOn,
  onToggleVoice,
  lang,
  encounterId,
  className,
}: PatientCallTileProps) {
  const { t } = useTranslation();
  const reduced = usePrefersReducedMotion();
  const visual = resolvePatientVisual(caseInstance);
  const signs = photoSignsFromVitals(vitals);

  const [caps, setCaps] = useState<VoiceCapabilities | null>(null);
  const [mode, setMode] = useState<CallMode>("local");
  const [state, setState] = useState<CallState>("connecting");
  const [hasVideo, setHasVideo] = useState(false);
  const [muted, setMuted] = useState(false);
  const [captions, setCaptions] = useState(true);
  const [firstAudioMs, setFirstAudioMs] = useState<number | null>(null);
  const [audioDriven, setAudioDriven] = useState(false);
  const [frame, setFrame] = useState<{ jaw: number; shape: MouthShape }>({ jaw: 0, shape: "rest" });

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const lkRef = useRef<LiveKitHandle | null>(null);
  const envelopeRef = useRef<AnalyserEnvelope | null>(null);
  const rafRef = useRef<number | null>(null);
  const stateRef = useRef<CallState>("connecting");
  const voiceRef = useRef(voiceOn);

  // Text-timed fallback animation (no audio available).
  const { speak, stop, speaking: textSpeaking } = useSpeech({ active: state === "live" });
  const speakRef = useRef(speak);
  const stopRef = useRef(stop);
  // Mirror the latest values into refs outside render so the per-utterance effect
  // fires once per new line (a mid-reply toggle applies to the next reply).
  useEffect(() => {
    stateRef.current = state;
    voiceRef.current = voiceOn;
    speakRef.current = speak;
    stopRef.current = stop;
  }, [state, voiceOn, speak, stop]);

  // 1. Capabilities once; decide the path. Realtime needs an avatar row AND a room token.
  useEffect(() => {
    const ctl = new AbortController();
    let cancelled = false;
    (async () => {
      const res = await voiceApi.capabilities({ signal: ctl.signal, timeoutMs: 6000 });
      if (cancelled) return;
      if (res.ok) setCaps(res.data);
      const wantRealtime = res.ok && res.data.avatar.enabled && !!encounterId;
      if (wantRealtime && videoRef.current && remoteAudioRef.current) {
        try {
          const handle = await joinLiveKit(encounterId!, videoRef.current, remoteAudioRef.current, (v) => {
            if (!cancelled) setHasVideo(v);
          });
          if (cancelled) {
            handle?.disconnect();
            return;
          }
          if (handle) {
            lkRef.current = handle;
            setMode("realtime");
            setState("live");
            return;
          }
        } catch {
          /* fall through to the local path */
        }
      }
      setMode("local");
      setState("live");
    })();
    return () => {
      cancelled = true;
      ctl.abort();
      lkRef.current?.disconnect();
      lkRef.current = null;
    };
  }, [encounterId]);

  // 2. Analyser loop: sample the shared patient <audio> while it plays.
  const stopLoop = useCallback(() => {
    if (rafRef.current != null && typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    envelopeRef.current?.reset();
    setFrame({ jaw: 0, shape: "rest" });
    setAudioDriven(false);
  }, []);

  const startLoop = useCallback(() => {
    const el = getTtsAudioElement();
    if (!el || typeof requestAnimationFrame === "undefined") return false;
    if (!envelopeRef.current) envelopeRef.current = createAnalyserEnvelope(el);
    const env = envelopeRef.current;
    if (!env.supported) return false;
    env.start();
    setAudioDriven(true);
    let last = 0;
    const tick = (ts: number) => {
      rafRef.current = requestAnimationFrame(tick);
      if (ts - last < 40) return; // ~25 fps is plenty for a mouth
      last = ts;
      const f = env.read();
      setFrame((prev) => (Math.abs(prev.jaw - f.jaw) > 0.01 || prev.shape !== f.shape ? { jaw: f.jaw, shape: f.shape } : prev));
    };
    rafRef.current = requestAnimationFrame(tick);
    return true;
  }, []);

  // 3. Each new patient line: speak it (local mode) and animate for exactly the audio.
  useEffect(() => {
    const text = utterance?.trim();
    if (!text || mode === "realtime") return;
    if (stateRef.current !== "live") return;
    const textTimed = () => speakRef.current(text, { voice: false, lang });
    if (!voiceRef.current || !ttsMaybeAvailable()) {
      textTimed();
      return () => stopRef.current();
    }
    let cancelled = false;
    let began = false;
    void speakAsPatient(text, {
      sex: visual.sexAtBirth,
      age: visual.age,
      lang,
      onFirstAudio: (ms) => {
        if (cancelled) return;
        setFirstAudioMs(ms);
      },
      onStart: (durationMs) => {
        if (cancelled) return;
        began = true;
        const live = startLoop();
        // Keep the "speaking" flag (clip playback) tied to the audio: the
        // text-timed hook only fills in when the analyser cannot run.
        if (!live) speakRef.current(text, { voice: false, lang, durationMs: durationMs > 0 ? durationMs : undefined });
        else speakRef.current(text, { voice: false, lang, durationMs: durationMs > 0 ? durationMs : 60_000 });
      },
      onEnded: () => {
        if (cancelled) return;
        stopLoop();
        stopRef.current();
      },
    }).then((ok) => {
      if (!ok && !cancelled && !began) textTimed();
    });
    return () => {
      cancelled = true;
      stopTts();
      stopLoop();
      stopRef.current();
    };
  }, [utterance, lang, mode, visual.sexAtBirth, visual.age, startLoop, stopLoop]);

  // Voice off stops any audio immediately.
  useEffect(() => {
    if (!voiceOn) {
      stopTts();
      stopLoop();
    }
  }, [voiceOn, stopLoop]);

  useEffect(() => () => stopLoop(), [stopLoop]);

  // Controls -------------------------------------------------------------------
  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    setTtsMuted(next);
    if (remoteAudioRef.current) remoteAudioRef.current.muted = next;
  };
  const toggleHold = () => {
    if (state === "hold") {
      setState("live");
      resumeTts();
      if (videoRef.current && mode === "realtime") void videoRef.current.play().catch(() => {});
    } else if (state === "live") {
      setState("hold");
      pauseTts();
      if (videoRef.current && mode === "realtime") videoRef.current.pause();
    }
  };
  const endCall = () => {
    setState("ended");
    stopTts();
    stopLoop();
    stop();
    lkRef.current?.disconnect();
    lkRef.current = null;
    setHasVideo(false);
  };
  const rejoin = () => {
    setState("live");
    if (mode === "realtime" && encounterId && videoRef.current && remoteAudioRef.current) {
      void joinLiveKit(encounterId, videoRef.current, remoteAudioRef.current, setHasVideo).then((h) => {
        lkRef.current = h;
        if (!h) setMode("local");
      });
    }
  };

  // Derived labels ---------------------------------------------------------------
  const speaking = audioDriven ? frame.jaw > 0.02 || textSpeaking : textSpeaking;
  const showRealtimeVideo = mode === "realtime" && hasVideo && state !== "ended";
  const ttsEnabled = caps?.tts.enabled ?? true;
  const statusKey =
    state === "connecting"
      ? "connecting"
      : state === "hold"
        ? "hold"
        : state === "ended"
          ? "ended"
          : showRealtimeVideo
            ? "live"
            : audioDriven
              ? "audio"
              : "textTimed";
  const statusLabel = t(`voice2.tile.status.${statusKey}`);
  const geometry = useMemo(() => overlayGeometry(frame), [frame]);
  const showOverlay = audioDriven && !reduced && state === "live" && !showRealtimeVideo;
  const providerLabel = caps?.tts.enabled ? caps.tts.provider : null;

  return (
    <section
      className={cn("flex flex-col gap-3 rounded-card border border-border bg-surface p-3 sm:p-4", className)}
      aria-label={t("voice2.tile.heading")}
      data-call-state={state}
      data-call-mode={mode}
    >
      {/* Header: heading, status, voice toggle */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="eyebrow">{t("voice2.tile.heading")}</h3>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-pill border px-2 py-0.5 text-[11px] font-medium",
              state === "live"
                ? "border-transparent bg-brand-tint text-brand"
                : "border-border bg-bg-subtle text-muted",
            )}
            role="status"
          >
            {showRealtimeVideo ? (
              <VideoCamera weight="bold" className="h-3 w-3" aria-hidden />
            ) : state === "ended" ? (
              <WifiSlash weight="bold" className="h-3 w-3" aria-hidden />
            ) : null}
            {statusLabel}
          </span>
        </div>
        <button
          type="button"
          onClick={onToggleVoice}
          aria-pressed={voiceOn}
          title={t("ehr.interview.patient.voiceToggle", { defaultValue: "Toggle spoken audio for patient replies" })}
          className={cn(
            "inline-flex min-h-8 items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
            voiceOn ? "border-transparent bg-brand-tint text-brand" : "border-border bg-bg-subtle text-muted hover:text-fg",
          )}
        >
          {voiceOn ? (
            <SpeakerHigh weight="bold" className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <SpeakerSlash weight="bold" className="h-3.5 w-3.5" aria-hidden />
          )}
          {voiceOn ? t("voice2.tile.controls.voiceOn") : t("voice2.tile.controls.voiceOff")}
        </button>
      </div>

      {/* Video area */}
      <div className="relative overflow-hidden rounded-card border border-border bg-bg-subtle">
        <div className={cn("relative aspect-[4/5] w-full sm:aspect-video lg:aspect-[4/5]", state === "ended" && "opacity-60")}>
          {/* Realtime renderer track (hidden until a video track arrives) */}
          <video
            ref={videoRef}
            className={cn("absolute inset-0 h-full w-full object-cover", !showRealtimeVideo && "hidden")}
            autoPlay
            playsInline
            muted
            aria-label={t("patientviewer.syntheticNote")}
          />
          <audio ref={remoteAudioRef} autoPlay className="hidden" />

          {/* Local talking head: clip + physiology, speaking tied to the audio */}
          {!showRealtimeVideo ? (
            <PatientPhoto
              sex={visual.sexAtBirth}
              age={visual.age}
              photoId={visual.photoId}
              signs={signs}
              rr={vitals.rr}
              speaking={state === "live" && speaking}
              alt={t("patientviewer.syntheticNote")}
              className="h-full w-full"
            />
          ) : null}

          {/* Viseme overlay driven by the amplitude envelope */}
          {showOverlay ? (
            <div
              aria-hidden
              data-testid="viseme-overlay"
              data-shape={frame.shape}
              className="pointer-events-none absolute left-1/2 top-[66%] -translate-x-1/2 rounded-[50%] bg-black/55 mix-blend-multiply blur-[1.5px]"
              style={{
                width: `${(9 * geometry.width).toFixed(2)}%`,
                height: `${(1.2 + 6.5 * geometry.height).toFixed(2)}%`,
                borderRadius: `${50 - 20 * geometry.round}% / 50%`,
                opacity: 0.35 + 0.45 * geometry.height,
                transition: "width 60ms linear, height 60ms linear, opacity 60ms linear",
              }}
            />
          ) : null}

          {/* Symptom overlay: top-left clinical signs */}
          <div className="absolute left-2 top-2 max-w-[80%] rounded-control bg-surface/85 px-2 py-1 shadow-soft backdrop-blur-sm">
            <SymptomSummary vitals={vitals} variant="inline" className="text-fg" />
          </div>

          {/* Name plate */}
          <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-control bg-black/60 px-2 py-1 text-[11px] font-medium text-white">
            <span className="truncate">{caseInstance.patient.name}</span>
            <span className="text-white/70">{t("voice2.tile.synthetic")}</span>
          </div>

          {/* Hold / ended scrims */}
          {state === "hold" ? (
            <div className="absolute inset-0 grid place-items-center bg-black/45 text-sm font-medium text-white">
              {t("voice2.tile.status.hold")}
            </div>
          ) : null}
          {state === "ended" ? (
            <div className="absolute inset-0 grid place-items-center bg-black/45 px-4 text-center text-sm text-white">
              {t("voice2.tile.endedNote")}
            </div>
          ) : null}
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label={t("voice2.tile.heading")}>
        <CallButton
          onClick={toggleMute}
          pressed={muted}
          label={muted ? t("voice2.tile.controls.unmute") : t("voice2.tile.controls.mute")}
          icon={muted ? <MicrophoneSlash weight="bold" className="h-4 w-4" aria-hidden /> : <Microphone weight="bold" className="h-4 w-4" aria-hidden />}
          disabled={state === "ended"}
        />
        <CallButton
          onClick={toggleHold}
          pressed={state === "hold"}
          label={state === "hold" ? t("voice2.tile.controls.resume") : t("voice2.tile.controls.hold")}
          icon={state === "hold" ? <Play weight="bold" className="h-4 w-4" aria-hidden /> : <Pause weight="bold" className="h-4 w-4" aria-hidden />}
          disabled={state === "ended" || state === "connecting"}
        />
        <CallButton
          onClick={() => setCaptions((c) => !c)}
          pressed={captions}
          label={captions ? t("voice2.tile.controls.captionsOn") : t("voice2.tile.controls.captionsOff")}
          icon={<ClosedCaptioning weight="bold" className="h-4 w-4" aria-hidden />}
        />
        {state === "ended" ? (
          <CallButton
            onClick={rejoin}
            label={t("voice2.tile.controls.rejoin")}
            icon={<PhoneIncoming weight="bold" className="h-4 w-4" aria-hidden />}
            tone="brand"
          />
        ) : (
          <CallButton
            onClick={endCall}
            label={t("voice2.tile.controls.end")}
            icon={<PhoneDisconnect weight="bold" className="h-4 w-4" aria-hidden />}
            tone="danger"
            disabled={state === "connecting"}
          />
        )}
      </div>

      {/* Captions */}
      {captions ? (
        <div
          className="rounded-control border border-border bg-bg-subtle px-3 py-2 text-sm"
          role="log"
          aria-live="polite"
          aria-label={t("voice2.tile.captions.label")}
        >
          {learnerLine ? (
            <p className="text-muted">
              <span className="me-1 font-semibold text-fg">{t("voice2.tile.captions.you")}:</span>
              {learnerLine}
            </p>
          ) : null}
          {utterance ? (
            <p className="mt-0.5 text-fg">
              <span className="me-1 font-semibold">{t("voice2.tile.captions.patient")}:</span>
              {utterance}
            </p>
          ) : (
            <p className="text-muted">{t("voice2.tile.captions.empty")}</p>
          )}
        </div>
      ) : null}

      {/* Degraded / provenance line (text carries the meaning, never color alone) */}
      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
        {caps && !ttsEnabled ? <span>{t("voice2.tile.noVoice")}</span> : null}
        {caps && ttsEnabled && !voiceOn ? <span>{t("voice2.tile.voiceOff")}</span> : null}
        {caps && caps.avatar.enabled && !showRealtimeVideo && state === "live" ? <span>{t("voice2.tile.degraded")}</span> : null}
        {providerLabel && voiceOn ? <span>{t("voice2.tile.provenance.voice", { provider: providerLabel })}</span> : null}
        {showRealtimeVideo && caps ? <span>{t("voice2.tile.provenance.renderer", { renderer: caps.avatar.renderer })}</span> : null}
        {firstAudioMs != null && voiceOn ? (
          <span className="font-mono tabular-nums">{t("voice2.tile.provenance.firstAudio", { ms: firstAudioMs })}</span>
        ) : null}
      </p>
    </section>
  );
}

function CallButton({
  onClick,
  label,
  icon,
  pressed,
  disabled,
  tone = "default",
}: {
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
  pressed?: boolean;
  disabled?: boolean;
  tone?: "default" | "danger" | "brand";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      disabled={disabled}
      className={cn(
        "inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-full border px-3 text-xs font-medium",
        "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50",
        tone === "danger" && "border-transparent bg-[color:var(--state-critical)] text-white hover:brightness-95",
        tone === "brand" && "border-transparent bg-brand text-on-brand hover:bg-brand-hover",
        tone === "default" && (pressed ? "border-transparent bg-brand-tint text-brand" : "border-border bg-surface text-fg hover:bg-bg-subtle"),
      )}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
