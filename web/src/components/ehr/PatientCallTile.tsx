/**
 * PatientCallTile: the patient as a video-call participant beside the chat.
 *
 * Paths, chosen from the gateway's /v1/voice/capabilities (avatar block):
 *  - webrtc (live video, self-hosted): the GPU worker's LiveTalking + MuseTalk 1.5
 *    runner takes the case portrait as the reference face; the tile opens a
 *    receive-only WebRTC call through the gateway (TURN credentials, offer/answer)
 *    and each patient line is spoken by the gateway TTS INTO the runner, so the
 *    face's lips move with the patient voice on one synchronized stream
 *    (lib/avatarCall.ts measures first frame, speech start and audio-to-lip lag);
 *  - tavus (live video, hosted): a Tavus CVI conversation whose LLM is the gateway's
 *    patient endpoint, embedded as the conversation room;
 *  - realtime (LiveKit): an avatar row with LiveKit transport, joined with a room
 *    token (Simli / Anam renderers);
 *  - local (the default and the AIRGAPPED fallback): the talking-head clip and a
 *    viseme overlay are driven by the ACTUAL patient audio through a Web Audio
 *    AnalyserNode (audioLipsync.ts), so the clip plays exactly as long as the
 *    voice and the mouth follows loudness, not text timing. While the GPU worker
 *    boots the browser's speech synthesis voices the line (lib/tts.ts) and the clip
 *    plays until that speech ends. Voice off keeps the text-timed `useSpeech`
 *    timeline so the patient visibly talks.
 *
 * The GPU worker is strictly on demand: the call start (the voice turning on from a
 * click) wakes it (POST /v1/voice/warm, lib/workerWake.ts), never mounting the tile.
 * The tile then watches the capabilities until the live video can start or the
 * launch failed, saying so ("the GPU is waking up, about N min" / retry).
 *
 * Call controls: mute, hold, end / rejoin, captions (live transcript of the last
 * patient line and the learner's last line). Symptom overlays come from the live
 * vitals through the same `photoSignsFromVitals` / `SymptomSummary` the viewer
 * uses, so the face, the chips and the monitor never disagree.
 *
 * The local path is labelled "Animated portrait, not live video" on the picture, so
 * the learner never mistakes it for a live stream; while the live video connects the
 * status line says what is happening (preparing the face, connecting, worker starting).
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
import {
  browserSpeechAvailable,
  getTtsAudioElement,
  pauseTts,
  resumeTts,
  setTtsMuted,
  speakAsPatient,
  stopTts,
  type SpeechEngine,
} from "@/lib/tts";
import { voiceApi, type VoiceCapabilities } from "@/lib/voiceApi";
import { etaMinutes, wakeOnCallStart, watchWorker } from "@/lib/workerWake";
import { sessionBody, startAvatarCall, type AvatarCallHandle, type AvatarCallMetrics } from "@/lib/avatarCall";
import { consumeServerSpoken, registerLiveCall } from "@/lib/liveCallBus";
import { getEncounterSnapshot, getGeneration, useEncounterSelector } from "@/state/encounterStore";

export type CallState = "connecting" | "live" | "hold" | "ended";
export type CallMode = "realtime" | "webrtc" | "tavus" | "local";
/** What the live-video path is doing right now (shown while it is not live). */
export type LiveVideoPhase =
  | "preparing"
  | "connecting"
  | "workerStarting"
  | "waking"
  | "failed"
  | "unavailable"
  | null;

export interface PatientCallContext {
  case_state?: Record<string, unknown>;
  persona?: Record<string, unknown>;
  case_context?: Record<string, unknown>;
}

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
  /** Case state and persona for the live-video call (the same shapes as /v1/patient/turn). */
  callContext?: () => PatientCallContext;
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
  callContext,
  className,
}: PatientCallTileProps) {
  const { t } = useTranslation();
  const reduced = usePrefersReducedMotion();
  const visual = resolvePatientVisual(caseInstance);
  const signs = photoSignsFromVitals(vitals);
  const lookThreadId = useEncounterSelector((s) => getGeneration(s)?.threadId ?? null);

  const [caps, setCaps] = useState<VoiceCapabilities | null>(null);
  const [mode, setMode] = useState<CallMode>("local");
  const [state, setState] = useState<CallState>("connecting");
  const [hasVideo, setHasVideo] = useState(false);
  const [muted, setMuted] = useState(false);
  const [captions, setCaptions] = useState(true);
  const [firstAudioMs, setFirstAudioMs] = useState<number | null>(null);
  const [audioDriven, setAudioDriven] = useState(false);
  const [frame, setFrame] = useState<{ jaw: number; shape: MouthShape }>({ jaw: 0, shape: "rest" });
  const [livePhase, setLivePhase] = useState<LiveVideoPhase>(null);
  const [liveMetrics, setLiveMetrics] = useState<AvatarCallMetrics | null>(null);
  const [tavusUrl, setTavusUrl] = useState<string | null>(null);
  const [engine, setEngine] = useState<SpeechEngine | null>(null);
  const [etaMin, setEtaMin] = useState(() => etaMinutes(null));
  // The live video's start-up stage and progress (capabilities.avatar.wake), and why it failed.
  const [wakeStage, setWakeStage] = useState<{ stage: string | null; progress: number | null }>({ stage: null, progress: null });
  const [failReason, setFailReason] = useState<string | null>(null);
  // Bumped to (re)start watching the woken GPU worker; 0 = no wake this call.
  const [wakeSeq, setWakeSeq] = useState(0);
  const wokenRef = useRef(false);
  const sessionPendingRef = useRef(false);
  const modeRef = useRef<CallMode>("local");
  const prevVoiceRef = useRef(voiceOn);
  const avatarRef = useRef<AvatarCallHandle | null>(null);
  // Unregisters the live call from the interview composer (liveCallBus) when it ends.
  const unregisterCallRef = useRef<() => void>(() => {});
  const contextRef = useRef(callContext);

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
    contextRef.current = callContext;
    modeRef.current = mode;
  }, [state, voiceOn, speak, stop, callContext, mode]);

  /**
   * Self-hosted live video: prepare the portrait on the worker runner, then connect.
   * Resolves true when the first frame arrived; false (with a phase explaining why) to
   * keep the honest local fallback.
   */
  const startLiveVideoOnce = useCallback(
    async (isCancelled: () => boolean): Promise<boolean> => {
      if (!encounterId || !videoRef.current || !remoteAudioRef.current) return false;
      setLivePhase("preparing");
      const ses = await voiceApi.avatarSession(
        sessionBody({
          encounterId,
          photoId: visual.photoId,
          lang,
          sex: visual.sexAtBirth,
          age: visual.age,
          context: contextRef.current?.(),
          threadId: getEncounterSnapshot().generation?.threadId ?? null,
        }),
      );
      if (isCancelled()) return false;
      sessionPendingRef.current = false;
      if (!ses.ok) {
        const pending = "detail" in ses && !!ses.detail?.pending_launch;
        sessionPendingRef.current = pending;
        if (!pending) {
          const reasons = "detail" in ses ? ses.detail?.reasons : undefined;
          setFailReason(reasons?.[0] ?? ses.error);
        }
        setLivePhase(pending ? (wokenRef.current ? "waking" : "workerStarting") : "unavailable");
        return false;
      }
      if (ses.data.transport === "tavus" && ses.data.conversation_url) {
        setTavusUrl(ses.data.conversation_url);
        avatarRef.current = {
          session: ses.data,
          metrics: { prepareMs: null, answerMs: null, firstFrameMs: null, speechStartMs: null, lipLagMs: null, ttsMs: null, firstAudioMs: null, provider: "tavus" },
          samples: [],
          lastSpeak: null,
          speak: async () => false,
          track: () => {},
          lines: [],
          stats: async () => ({ audioPackets: 0, audioEnergy: 0, videoFrames: 0, videoFps: null, rttMs: null,
            audioJitterMs: null, videoJitterMs: null }),
          end: () => void voiceApi.avatarEnd(ses.data.session_id),
        };
        setMode("tavus");
        setLivePhase(null);
        return true;
      }
      setLivePhase("connecting");
      try {
        const handle = await startAvatarCall({
          api: voiceApi,
          session: ses.data,
          video: videoRef.current,
          audio: remoteAudioRef.current,
          onMetrics: (m) => {
            if (!isCancelled()) setLiveMetrics(m);
          },
          onState: (st) => {
            if (st === "failed" || st === "ended") unregisterCallRef.current();
            if (isCancelled()) return;
            if (st === "failed" || st === "ended") {
              setHasVideo(false);
              setMode("local");
            }
          },
        });
        if (isCancelled()) {
          handle.end();
          return false;
        }
        avatarRef.current = handle;
        // The interview composer now sends this call's id with each question, and the server speaks the
        // reply into the call while it is written (docs/architecture/18 6.3.9).
        const callThread = getEncounterSnapshot().generation?.threadId ?? null;
        unregisterCallRef.current();
        unregisterCallRef.current = callThread
          ? registerLiveCall({ threadId: callThread, sessionId: ses.data.session_id, voiceOn: () => voiceRef.current })
          : () => {};
        if (typeof window !== "undefined") (window as unknown as { __acudxAvatarCall?: AvatarCallHandle }).__acudxAvatarCall = handle;
        setLiveMetrics({ ...handle.metrics });
        setHasVideo(true);
        setMode("webrtc");
        setLivePhase(null);
        return true;
      } catch (err) {
        if (!isCancelled()) {
          // first_frame_timeout: TURN / WebRTC could not reach the worker from this network.
          setFailReason(err instanceof Error ? err.message : String(err));
          setLivePhase("unavailable");
        }
        return false;
      }
    },
    [encounterId, visual.photoId, visual.sexAtBirth, visual.age, lang],
  );
  // One live-video start at a time (the mount check and a call-start wake can both get there).
  const liveStartingRef = useRef(false);
  const startLiveVideo = useCallback(
    async (isCancelled: () => boolean): Promise<boolean> => {
      if (liveStartingRef.current || avatarRef.current) return false;
      liveStartingRef.current = true;
      try {
        return await startLiveVideoOnce(isCancelled);
      } finally {
        liveStartingRef.current = false;
      }
    },
    [startLiveVideoOnce],
  );

  // 1. Capabilities once; decide the path. Realtime needs an avatar row AND a room token.
  useEffect(() => {
    const ctl = new AbortController();
    let cancelled = false;
    (async () => {
      const res = await voiceApi.capabilities({ signal: ctl.signal, timeoutMs: 6000 });
      if (cancelled) return;
      if (res.ok) setCaps(res.data);
      const av = res.ok ? res.data.avatar : null;
      const liveTransport = av?.enabled && (av.transport === "webrtc" || av.transport === "tavus");
      if (liveTransport && encounterId) {
        setState("live");
        if (await startLiveVideo(() => cancelled)) return;
        if (cancelled) return;
        setMode("local");
        return;
      }
      if (av?.pending_launch) setLivePhase("workerStarting");
      const wantRealtime = !!av?.enabled && av.transport === "livekit" && !!encounterId;
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
      unregisterCallRef.current();
      avatarRef.current?.end();
      avatarRef.current = null;
    };
  }, [encounterId, startLiveVideo]);

  // Without a call start nothing launches the worker (opening a case must not), but one
  // another learner woke may come up: re-check every 30 s for a while and move to live video.
  useEffect(() => {
    if (livePhase !== "workerStarting" || mode !== "local" || wokenRef.current) return;
    let cancelled = false;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      if (tries > 40) {
        clearInterval(timer);
        return;
      }
      void voiceApi.capabilities({ timeoutMs: 6000 }).then(async (res) => {
        if (cancelled || !res.ok) return;
        setCaps(res.data);
        const av = res.data.avatar;
        if (av.enabled && (av.transport === "webrtc" || av.transport === "tavus") && stateRef.current === "live") {
          clearInterval(timer);
          await startLiveVideo(() => cancelled);
        }
      });
    }, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [livePhase, mode, startLiveVideo]);

  // The learner started the call (or turned the voice on): wake the on-demand GPU worker.
  // Only an explicit start (a false -> true change of `voiceOn`, i.e. a click) wakes it,
  // never mounting the tile or opening the case.
  const wakeWorker = useCallback(() => {
    if (modeRef.current !== "local") return;
    wokenRef.current = true;
    setLivePhase("waking");
    setEtaMin(etaMinutes(null));
    void wakeOnCallStart(voiceApi).then((st) => {
      if (!voiceRef.current) return;
      if (st.kind === "failed") {
        setLivePhase("failed");
        return;
      }
      setWakeSeq((n) => n + 1);
    });
  }, []);

  useEffect(() => {
    const was = prevVoiceRef.current;
    prevVoiceRef.current = voiceOn;
    if (voiceOn && !was) wakeWorker();
  }, [voiceOn, wakeWorker]);

  // While the woken worker boots: re-read the capabilities until the live video can start
  // or the launch failed. No try limit while the call is active; ending the call, turning
  // the voice off or unmounting stops it.
  useEffect(() => {
    if (wakeSeq === 0) return;
    let cancelled = false;
    const stopWatch = watchWorker({
      api: voiceApi,
      isActive: () => !cancelled && voiceRef.current && stateRef.current !== "ended" && modeRef.current === "local",
      onStatus: (st, data) => {
        if (cancelled) return;
        setCaps(data);
        if (st.kind === "waking") {
          setLivePhase("waking");
          setEtaMin(st.minutes);
          setWakeStage({ stage: st.stage ?? null, progress: st.progress ?? null });
          return;
        }
        if (st.kind === "failed") {
          setFailReason(st.detail);
          setLivePhase("failed");
          return;
        }
        if (!encounterId) {
          setLivePhase(null);
          return;
        }
        void startLiveVideo(() => cancelled).then((ok) => {
          // The worker answered ready but the call slot is still coming up: keep watching.
          if (!ok && !cancelled && sessionPendingRef.current) setWakeSeq((n) => n + 1);
        });
      },
    });
    return () => {
      cancelled = true;
      stopWatch();
    };
  }, [wakeSeq, encounterId, startLiveVideo]);

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
    if (!text || mode === "realtime" || mode === "tavus") return;
    if (stateRef.current !== "live") return;
    if (mode === "webrtc") {
      // Live video: the gateway speaks the line into the runner; voice and lips arrive
      // together on the WebRTC stream. Voice off keeps the face listening, captions on.
      // A reply the interview turn already streamed into the call is only measured, not spoken again.
      if (voiceRef.current) {
        const spoken = consumeServerSpoken(text);
        if (spoken) avatarRef.current?.track(text, spoken.sentAt);
        else void avatarRef.current?.speak(text);
      }
      return;
    }
    const textTimed = () => speakRef.current(text, { voice: false, lang });
    if (!voiceRef.current) {
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
      onStart: (durationMs, used) => {
        if (cancelled) return;
        began = true;
        setEngine(used);
        if (used === "browser") {
          // The browser voice (GPU worker still booting) is not on the shared <audio>, so the
          // analyser hears nothing: keep the talk clip playing until the speech's onend,
          // with a generous cap in case the browser never reports the end.
          speakRef.current(text, { voice: false, lang, durationMs: Math.round(durationMs * 1.5) + 2000 });
          return;
        }
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
      if (videoRef.current && (mode === "realtime" || mode === "webrtc")) void videoRef.current.play().catch(() => {});
      if (remoteAudioRef.current && mode === "webrtc") void remoteAudioRef.current.play().catch(() => {});
    } else if (state === "live") {
      setState("hold");
      pauseTts();
      if (videoRef.current && (mode === "realtime" || mode === "webrtc")) videoRef.current.pause();
      if (remoteAudioRef.current && mode === "webrtc") remoteAudioRef.current.pause();
    }
  };
  const endCall = () => {
    setState("ended");
    stopTts();
    stopLoop();
    stop();
    lkRef.current?.disconnect();
    lkRef.current = null;
    avatarRef.current?.end();
    avatarRef.current = null;
    setTavusUrl(null);
    setHasVideo(false);
  };
  const rejoin = () => {
    setState("live");
    if ((mode === "webrtc" || mode === "tavus" || caps?.avatar.live_video) && encounterId) {
      setMode("local");
      void startLiveVideo(() => false);
      return;
    }
    if (mode === "realtime" && encounterId && videoRef.current && remoteAudioRef.current) {
      void joinLiveKit(encounterId, videoRef.current, remoteAudioRef.current, setHasVideo).then((h) => {
        lkRef.current = h;
        if (!h) setMode("local");
      });
    }
  };

  // Derived labels ---------------------------------------------------------------
  const speaking = audioDriven ? frame.jaw > 0.02 || textSpeaking : textSpeaking;
  const showRealtimeVideo = (mode === "realtime" || mode === "webrtc") && hasVideo && state !== "ended";
  const showTavus = mode === "tavus" && !!tavusUrl && state !== "ended";
  const liveVideo = showRealtimeVideo || showTavus;
  const ttsEnabled = caps?.tts.enabled ?? true;
  const statusKey =
    state === "connecting"
      ? "connecting"
      : state === "hold"
        ? "hold"
        : state === "ended"
          ? "ended"
          : liveVideo
            ? "live"
            : livePhase === "preparing" || livePhase === "connecting"
              ? "videoConnecting"
              : audioDriven
              ? "audio"
              : "textTimed";
  const statusLabel = t(`voice2.tile.status.${statusKey}`);
  const geometry = useMemo(() => overlayGeometry(frame), [frame]);
  const showOverlay = audioDriven && !reduced && state === "live" && !liveVideo;
  const providerLabel = engine === "browser" ? null : caps?.tts.enabled ? caps.tts.provider : null;
  const retryVideo = () => {
    setLivePhase(null);
    setFailReason(null);
    wakeWorker();
  };
  // While the live call is not up, the portrait is never presented as the call: a panel over it says
  // what the start-up is doing (stage, progress, minutes left) or why it failed.
  const startingPhase = livePhase === "waking" || livePhase === "workerStarting" || livePhase === "preparing" || livePhase === "connecting";
  const failedPhase = livePhase === "failed" || livePhase === "unavailable";
  const showStartPanel = !liveVideo && state === "live" && voiceOn && (startingPhase || failedPhase);
  const stageKey =
    livePhase === "preparing" || livePhase === "connecting"
      ? livePhase
      : wakeStage.stage === "machine" || wakeStage.stage === "video_services"
        ? wakeStage.stage
        : "starting";
  const progressPct = Math.round(
    100 * (livePhase === "preparing" ? 0.96 : livePhase === "connecting" ? 0.98 : (wakeStage.progress ?? 0.05)),
  );

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
            {liveVideo ? (
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
            // Transparent (not display:none) while connecting: a hidden element never presents
            // frames, so requestVideoFrameCallback would not report the first frame.
            className={cn(
              "absolute inset-0 h-full w-full object-cover",
              !showRealtimeVideo && "pointer-events-none opacity-[0.01]",
            )}
            data-testid="patient-live-video"
            autoPlay
            playsInline
            muted
            aria-label={t("patientviewer.syntheticNote")}
          />
          <audio ref={remoteAudioRef} autoPlay className="hidden" />

          {/* Hosted live video (Tavus CVI conversation room) */}
          {showTavus ? (
            <iframe
              src={tavusUrl ?? undefined}
              title={t("voice2.tile.heading")}
              allow="camera; microphone; autoplay; fullscreen; display-capture"
              className="absolute inset-0 h-full w-full border-0"
            />
          ) : null}

          {/* Local talking head: clip + physiology, speaking tied to the audio */}
          {!liveVideo ? (
            <PatientPhoto
              sex={visual.sexAtBirth}
              age={visual.age}
              photoId={visual.photoId}
              signs={signs}
              rr={vitals.rr}
              lookThreadId={lookThreadId}
              speaking={state === "live" && speaking}
              alt={t("patientviewer.syntheticNote")}
              className="h-full w-full"
              bare
              preloadTalk
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

          {/* Top row: the clinical signs (left) and, for the fallback, the honest
              not-live label (right). One wrapping flex row, so on a narrow tile the
              label drops under the signs instead of painting over them. */}
          <div className="pointer-events-none absolute inset-x-2 top-2 flex flex-wrap items-start justify-between gap-1.5">
            <div className="max-w-full rounded-control bg-surface/85 px-2 py-1 shadow-soft">
              <SymptomSummary vitals={vitals} variant="inline" className="text-fg" />
            </div>
            {/* Honest label for the fallback: never mistaken for a live stream */}
            {!liveVideo && state !== "ended" ? (
              <div
                className="ms-auto rounded-control bg-black/60 px-2 py-1 text-[11px] font-medium text-white"
                data-testid="not-live-label"
              >
                {t("voice2.tile.notLive")}
              </div>
            ) : null}
          </div>

          {/* Live video start-up or failure, over the portrait (never mistaken for the call) */}
          {showStartPanel ? (
            <div
              className="absolute inset-x-2 bottom-10 rounded-control bg-black/75 px-3 py-2.5 text-white shadow-soft"
              data-testid="live-start-panel"
              data-stage={failedPhase ? "failed" : stageKey}
              role="status"
              aria-live="polite"
            >
              <p className="text-sm font-semibold">
                {failedPhase ? t("voice2.tile.liveVideo.failedTitle") : t("voice2.tile.liveVideo.title")}
              </p>
              {failedPhase ? (
                <p className="mt-0.5 text-xs text-white/85" data-testid="live-fail-reason">
                  {failReason ? t("voice2.tile.liveVideo.reason", { reason: failReason }) : t(`voice2.tile.liveVideo.${livePhase}`)}
                </p>
              ) : (
                <>
                  <p className="mt-0.5 text-xs text-white/85">{t(`voice2.tile.liveVideo.stage.${stageKey}`)}</p>
                  <div
                    className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/25"
                    role="progressbar"
                    aria-label={t("voice2.tile.liveVideo.progress")}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progressPct}
                  >
                    <div className="h-full rounded-full bg-white motion-safe:transition-[width] motion-safe:duration-700" style={{ width: `${progressPct}%` }} />
                  </div>
                  <p className="mt-1 flex flex-wrap justify-between gap-x-2 text-[11px] text-white/80">
                    {livePhase === "waking" ? <span className="tabular-nums">{t("voice2.tile.liveVideo.eta", { minutes: etaMin })}</span> : <span />}
                    <span>{t("voice2.tile.liveVideo.meanwhile")}</span>
                  </p>
                </>
              )}
            </div>
          ) : null}

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
        {caps && !ttsEnabled && !browserSpeechAvailable() ? <span>{t("voice2.tile.noVoice")}</span> : null}
        {caps && ttsEnabled && !voiceOn ? <span>{t("voice2.tile.voiceOff")}</span> : null}
        {caps && caps.avatar.enabled && !liveVideo && state === "live" && !livePhase ? <span>{t("voice2.tile.degraded")}</span> : null}
        {livePhase && !liveVideo && (voiceOn || (livePhase !== "waking" && livePhase !== "failed")) ? (
          <span data-testid="live-phase">{t(`voice2.tile.liveVideo.${livePhase}`, { minutes: etaMin })}</span>
        ) : null}
        {livePhase === "failed" && !liveVideo && voiceOn ? (
          <button
            type="button"
            onClick={retryVideo}
            className="rounded-full border border-border bg-surface px-2 py-0.5 font-medium text-fg hover:bg-bg-subtle"
            data-testid="retry-live-video"
          >
            {t("voice2.tile.controls.retryVideo")}
          </button>
        ) : null}
        {engine === "browser" && voiceOn && !liveVideo ? <span>{t("voice2.tile.provenance.browserVoice")}</span> : null}
        {providerLabel && voiceOn ? <span>{t("voice2.tile.provenance.voice", { provider: providerLabel })}</span> : null}
        {liveVideo && caps ? <span>{t("voice2.tile.provenance.renderer", { renderer: caps.avatar.renderer })}</span> : null}
        {showRealtimeVideo && liveMetrics?.firstFrameMs != null ? (
          <span className="font-mono tabular-nums" data-testid="first-frame-ms">
            {t("voice2.tile.provenance.firstFrame", { ms: liveMetrics.firstFrameMs })}
          </span>
        ) : null}
        {showRealtimeVideo && liveMetrics?.speechStartMs != null ? (
          <span className="font-mono tabular-nums" data-testid="speech-start-ms">
            {t("voice2.tile.provenance.speechStart", { ms: liveMetrics.speechStartMs })}
          </span>
        ) : null}
        {showRealtimeVideo && liveMetrics?.lipLagMs != null ? (
          <span className="font-mono tabular-nums" data-testid="lip-lag-ms">
            {t("voice2.tile.provenance.lipLag", { ms: liveMetrics.lipLagMs })}
          </span>
        ) : null}
        {firstAudioMs != null && voiceOn && !liveVideo ? (
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
