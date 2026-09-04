/**
 * AcuDx — PatientHead3D: a stylized low-poly 3D patient head (R3F).
 *
 * The head is built entirely from procedural geometry + drei primitives (no
 * downloaded GLB, no external model URL) so it is fully air-gap friendly. It is
 * physiology-driven: breathing rate comes from RR, blink cadence from affect,
 * and the clinical-sign channel (pallor / cyanosis / diaphoresis / respiratory
 * distress / reduced LOC) shades the face and shapes the motion — the SAME sign
 * contract the 2D portrait consumes, so the two renderers never disagree.
 *
 * Accessibility ("never color/3D alone"): every sign is ALSO written out as text
 * — a visually-hidden list for assistive tech plus a small visible caption row —
 * so the meaning survives with the canvas hidden, colour-blind, or GPU-less.
 *
 * Performance + graceful degradation: devicePixelRatio is capped, drei's
 * AdaptiveDpr drops resolution under load, and the render loop is paused
 * (frameloop "demand") whenever the head is offscreen, the tab is hidden, or the
 * viewer prefers reduced motion — leaving a correct, static clinical pose.
 *
 * This module imports three / @react-three/fiber / @react-three/drei at the top
 * level ON PURPOSE: PatientAvatar3D lazy-loads it, so those libraries land in a
 * separate chunk and never bloat the main bundle. Education only. Synthetic
 * patient.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import { useReducedMotion } from "motion/react";
import { Pulse, SpeakerSimpleSlash, Waveform } from "@phosphor-icons/react";
import { Canvas, useFrame } from "@react-three/fiber";
import { AdaptiveDpr } from "@react-three/drei";
import { DoubleSide, type Group, type Mesh } from "three";

import {
  hashSeed,
  type PatientProfile,
  type SkinTone,
  type HairColor,
} from "@/domain/patientProfiles";
import { useSpeech, mouthGeometry, type MouthShape } from "@/lib/lipsync";
import type {
  AvatarAffect,
  ClinicalSignIntensity,
  ClinicalSignKind,
} from "@/components/ehr/PatientAvatar";

/* -------------------------------------------------------------------------- */
/* Props                                                                       */
/* -------------------------------------------------------------------------- */

export interface PatientHead3DProps {
  /** Character profile — drives skin tone, hair, headwear. */
  profile: PatientProfile;
  /** Clinical-sign intensities (0..1) shading the face. Same contract as 2D. */
  signs: ClinicalSignIntensity[];
  /** Affect (intensity scales idle-motion strength). */
  affect: AvatarAffect;
  /** Respiratory rate (breaths/min) — sets the breathing cadence. */
  rr: number;
  /**
   * True while the patient is speaking. Used on its own (no `utterance`) it
   * plays a generic mouth oscillation; with `utterance` the viseme timeline
   * drives it and this becomes a fallback/override.
   */
  speaking?: boolean;
  /**
   * The patient's current utterance. When set, its text drives an approximate
   * viseme timeline so the mouth forms shapes while "spoken" — no audio needed.
   * Changing the string starts a new turn; clearing it stops.
   */
  utterance?: string;
  /** Opt in to voicing the utterance via the Web Speech API (default silent). */
  voice?: boolean;
  className?: string;
}

/* -------------------------------------------------------------------------- */
/* Palettes + colour helpers (self-contained, mirrors the 2D portrait)         */
/* -------------------------------------------------------------------------- */

const SKIN: Record<SkinTone, string> = {
  1: "#f3d3c0",
  2: "#eec5a6",
  3: "#d7a878",
  4: "#b9865c",
  5: "#8d5a3c",
  6: "#5e3b28",
};

const HAIR: Record<HairColor, string> = {
  black: "#241f1c",
  brown: "#5a3d29",
  blonde: "#cf9f5b",
  gray: "#9aa0a6",
  red: "#a44a2a",
  white: "#dfe3e6",
};

const FABRIC = ["#6f7f9c", "#8a6f8e", "#5f8a82", "#a1856f", "#93766b", "#6d8a9c"];
const GOWN = "#4c5872";

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function hexToRgb(h: string): [number, number, number] {
  const s = h.replace("#", "");
  return [
    parseInt(s.slice(0, 2), 16),
    parseInt(s.slice(2, 4), 16),
    parseInt(s.slice(4, 6), 16),
  ];
}
function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}
function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const k = clamp01(t);
  return rgbToHex(ar + (br - ar) * k, ag + (bg - ag) * k, ab + (bb - ab) * k);
}

function sig(signs: ClinicalSignIntensity[], kind: ClinicalSignKind): number {
  const s = signs.find((x) => x.sign === kind);
  return s ? clamp01(s.intensity) : 0;
}

/* -------------------------------------------------------------------------- */
/* Derived look + motion (pure, from signs/affect/rr)                          */
/* -------------------------------------------------------------------------- */

interface HeadDrive {
  skin: string;
  hair: string;
  fabric: string;
  headwear: PatientProfile["appearance"]["headwear"];
  hairStyle: PatientProfile["appearance"]["hairStyle"];
  lip: string;
  periphery: string;
  roughness: number;
  metalness: number;
  sweat: number;
  breatheHz: number;
  breatheAmp: number;
  blinkInterval: number;
  lidDroop: number;
  mouthRest: number;
  browRaise: number;
}

function computeDrive(
  profile: PatientProfile,
  signs: ClinicalSignIntensity[],
  affect: AvatarAffect,
  rr: number,
): HeadDrive {
  const pallor = sig(signs, "pallor");
  const cyanosis = sig(signs, "cyanosis");
  const diaphoresis = sig(signs, "diaphoresis");
  const distress = sig(signs, "respiratory-distress");
  const loc = sig(signs, "reduced-loc");
  const ai = clamp01(affect.intensity);

  const baseSkin = SKIN[profile.appearance.skinTone];
  const skin = mix(baseSkin, "#eef2f5", pallor * 0.5);
  const lipBase = mix(baseSkin, "#7a3f36", 0.55);
  const lip = mix(lipBase, "#5566a8", cyanosis * 0.9);
  const periphery = mix(skin, "#8391c0", cyanosis * 0.35);

  // Breathing: RR breaths/min -> Hz. Distress deepens, reduced LOC shallows.
  const rrSafe = Math.max(6, Math.min(45, rr || 16));
  const breatheHz = rrSafe / 60;
  const breatheAmp = clamp01(0.55 + distress * 0.7 - loc * 0.35) || 0.2;

  // Blink: calm ~4.4s; anxious/distress quicker, reduced LOC slower + heavier.
  let blinkInterval = 4.4;
  if (distress > 0.2 || affect.label === "anxious") blinkInterval = 3.0;
  if (loc > 0.2) blinkInterval = 6.5;
  const lidDroop = clamp01(loc * 0.7);

  const mouthRest = clamp01(0.12 + distress * 0.5 + loc * 0.15);
  const browRaise = clamp01(distress * 0.7 + (affect.label === "distressed" ? 0.5 : 0) + ai * 0.15);

  return {
    skin,
    hair: HAIR[profile.appearance.hairColor],
    fabric: FABRIC[hashSeed(profile.id) % FABRIC.length],
    headwear: profile.appearance.headwear,
    hairStyle: profile.appearance.hairStyle,
    lip,
    periphery,
    roughness: clamp01(0.9 - diaphoresis * 0.55),
    metalness: diaphoresis * 0.14,
    sweat: diaphoresis,
    breatheHz,
    breatheAmp,
    blinkInterval,
    lidDroop,
    mouthRest,
    browRaise,
  };
}

/* -------------------------------------------------------------------------- */
/* Scene graph (inside the Canvas)                                             */
/* -------------------------------------------------------------------------- */

const EYE_Y = 0.14;
const EYE_X = 0.34;
const EYE_R = 0.15;
const EYE_Z = 0.8;
const LID_OPEN_Y = EYE_Y + EYE_R + 0.14;
const MOUTH_Z = 0.86;

function lidYFor(closed: number): number {
  const coverY = EYE_Y - EYE_R * 0.15;
  return LID_OPEN_Y + (coverY - LID_OPEN_Y) * closed;
}

function HeadModel({
  drive,
  speaking,
  animate,
  jawOpen,
  mouthShape,
}: {
  drive: HeadDrive;
  speaking: boolean;
  animate: boolean;
  /** Viseme-driven jaw opening (0..1). Null → generic/no lip-sync source. */
  jawOpen: number | null;
  /** Viseme-driven mouth shape. Null → generic/no lip-sync source. */
  mouthShape: MouthShape | null;
}) {
  const rootRef = useRef<Group>(null);
  const lidLRef = useRef<Mesh>(null);
  const lidRRef = useRef<Mesh>(null);
  const mouthRef = useRef<Mesh>(null);

  useFrame((state) => {
    if (!animate) return;
    const t = state.clock.getElapsedTime();

    // Breathing — gentle bob + swell at the RR-derived cadence.
    const breath = Math.sin(t * drive.breatheHz * Math.PI * 2);
    if (rootRef.current) {
      rootRef.current.position.y = breath * 0.03 * drive.breatheAmp;
      const s = 1 + breath * 0.02 * drive.breatheAmp;
      rootRef.current.scale.set(s, s, s);
    }

    // Blink — quick close on each interval, resting on the LOC droop.
    const phase = t % drive.blinkInterval;
    let closed = drive.lidDroop;
    if (phase < 0.16) {
      closed = drive.lidDroop + (1 - drive.lidDroop) * Math.sin((phase / 0.16) * Math.PI);
    }
    const ly = lidYFor(closed);
    if (lidLRef.current) lidLRef.current.position.y = ly;
    if (lidRRef.current) lidRRef.current.position.y = ly;

    // Mouth — form visemes from the lip-sync signal while speaking. With a
    // viseme source we shape the lips (jaw + spread + rounding); with only a
    // boolean `speaking` we fall back to the generic open/close oscillation;
    // otherwise the mouth settles to its physiology-driven rest opening.
    if (mouthRef.current) {
      let targetY = drive.mouthRest;
      let targetX = 1;
      let targetZ = MOUTH_Z;
      if (speaking) {
        if (jawOpen != null && mouthShape != null) {
          const g = mouthGeometry(mouthShape);
          targetY = drive.mouthRest * 0.4 + jawOpen * 0.95;
          targetX = g.width;
          targetZ = MOUTH_Z + g.round * 0.05;
        } else {
          const env = Math.max(0, Math.sin(t * 10)) * (0.55 + 0.45 * Math.sin(t * 3.3 + 1));
          targetY = drive.mouthRest + env * 0.9;
        }
      }
      const m = mouthRef.current;
      m.scale.y += (targetY - m.scale.y) * 0.35;
      m.scale.x += (targetX - m.scale.x) * 0.3;
      m.position.z += (targetZ - m.position.z) * 0.3;
    }
  });

  const skinMat = (
    <meshStandardMaterial
      color={drive.skin}
      roughness={drive.roughness}
      metalness={drive.metalness}
      emissive="#ffffff"
      emissiveIntensity={drive.sweat * 0.06}
    />
  );

  const restLidY = lidYFor(drive.lidDroop);
  const showHair =
    drive.hairStyle !== "bald" && drive.headwear !== "hijab" && drive.headwear !== "headscarf";
  const showFabric = drive.headwear === "hijab" || drive.headwear === "headscarf";

  return (
    <group ref={rootRef}>
      {/* Neck + shoulders (gown) — anchor the breathing motion. */}
      <mesh position={[0, -1.25, 0]}>
        <cylinderGeometry args={[0.28, 0.34, 0.5, 20]} />
        <meshStandardMaterial color={drive.skin} roughness={0.9} />
      </mesh>
      <mesh position={[0, -1.75, 0]}>
        <sphereGeometry args={[0.95, 20, 16]} />
        <meshStandardMaterial color={GOWN} roughness={0.95} />
      </mesh>

      {/* Head */}
      <mesh scale={[0.92, 1.05, 0.9]}>
        <sphereGeometry args={[1, 32, 24]} />
        {skinMat}
      </mesh>

      {/* Ears (tinted by peripheral cyanosis) */}
      {!showFabric && (
        <>
          <mesh position={[-0.9, EYE_Y - 0.02, 0]} scale={[0.6, 1, 0.6]}>
            <sphereGeometry args={[0.2, 12, 10]} />
            <meshStandardMaterial color={drive.periphery} roughness={drive.roughness} />
          </mesh>
          <mesh position={[0.9, EYE_Y - 0.02, 0]} scale={[0.6, 1, 0.6]}>
            <sphereGeometry args={[0.2, 12, 10]} />
            <meshStandardMaterial color={drive.periphery} roughness={drive.roughness} />
          </mesh>
        </>
      )}

      {/* Eyes: white + iris + skin-tone lid that blinks/droops */}
      {[-1, 1].map((side) => (
        <group key={side} position={[side * EYE_X, EYE_Y, EYE_Z]}>
          <mesh>
            <sphereGeometry args={[EYE_R, 16, 12]} />
            <meshStandardMaterial color="#f4f6f8" roughness={0.4} />
          </mesh>
          <mesh position={[0, 0, EYE_R * 0.7]}>
            <sphereGeometry args={[EYE_R * 0.5, 12, 10]} />
            <meshStandardMaterial color="#2c2420" roughness={0.5} />
          </mesh>
        </group>
      ))}
      <mesh ref={lidLRef} position={[-EYE_X, restLidY, EYE_Z + 0.02]} scale={[1.25, 0.7, 1.1]}>
        <sphereGeometry args={[EYE_R, 14, 10]} />
        <meshStandardMaterial color={drive.skin} roughness={drive.roughness} metalness={drive.metalness} />
      </mesh>
      <mesh ref={lidRRef} position={[EYE_X, restLidY, EYE_Z + 0.02]} scale={[1.25, 0.7, 1.1]}>
        <sphereGeometry args={[EYE_R, 14, 10]} />
        <meshStandardMaterial color={drive.skin} roughness={drive.roughness} metalness={drive.metalness} />
      </mesh>

      {/* Brows — drawn up/in under distress */}
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          position={[side * EYE_X, EYE_Y + EYE_R + 0.14 + drive.browRaise * 0.06, EYE_Z]}
          rotation={[0, 0, side * (0.15 + drive.browRaise * 0.35)]}
        >
          <boxGeometry args={[0.26, 0.05, 0.08]} />
          <meshStandardMaterial color={mix(drive.hair, "#000000", 0.1)} roughness={0.8} />
        </mesh>
      ))}

      {/* Nose */}
      <mesh position={[0, -0.05, 0.92]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.11, 0.28, 12]} />
        <meshStandardMaterial color={drive.periphery} roughness={drive.roughness} />
      </mesh>

      {/* Mouth — lip-coloured; jaw + lip spread/round form visemes when speaking */}
      <mesh ref={mouthRef} position={[0, -0.45, MOUTH_Z]} scale={[1, drive.mouthRest, 1]}>
        <boxGeometry args={[0.34, 0.22, 0.06]} />
        <meshStandardMaterial color={mix(drive.lip, "#361f1c", 0.35)} roughness={0.6} />
      </mesh>

      {/* Hair cap or fabric head-covering (respectful, low-poly) */}
      {showHair && (
        <mesh position={[0, 0.34, -0.05]} scale={[1.04, 0.78, 1.02]}>
          <sphereGeometry args={[1, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.62]} />
          <meshStandardMaterial color={drive.hair} roughness={0.85} />
        </mesh>
      )}
      {showFabric && (
        <mesh position={[0, 0.14, -0.08]} scale={[1.16, 1.12, 1.1]}>
          <sphereGeometry args={[1, 24, 18, 0, Math.PI * 2, 0, Math.PI * 0.78]} />
          <meshStandardMaterial color={drive.fabric} roughness={0.95} side={DoubleSide} />
        </mesh>
      )}

      {/* Diaphoresis: shiny forehead beads (only when marked) */}
      {drive.sweat > 0.35 && (
        <>
          <mesh position={[-0.28, 0.52, 0.72]}>
            <sphereGeometry args={[0.05, 10, 8]} />
            <meshStandardMaterial color="#cfeafe" roughness={0.05} metalness={0.3} />
          </mesh>
          <mesh position={[0.24, 0.46, 0.76]}>
            <sphereGeometry args={[0.045, 10, 8]} />
            <meshStandardMaterial color="#cfeafe" roughness={0.05} metalness={0.3} />
          </mesh>
        </>
      )}
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/* Active-when-visible hook (pause offscreen / hidden tab)                     */
/* -------------------------------------------------------------------------- */

function useInView<T extends Element>(): [RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    let visible = document.visibilityState !== "hidden";
    let intersecting = true;
    const update = () => setInView(visible && intersecting);

    const io = new IntersectionObserver(
      (entries) => {
        intersecting = entries.some((e) => e.isIntersecting);
        update();
      },
      { threshold: 0.05 },
    );
    io.observe(el);

    const onVis = () => {
      visible = document.visibilityState !== "hidden";
      update();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return [ref, inView];
}

/* -------------------------------------------------------------------------- */
/* Text mirror (a11y — signs are never colour/3D-only)                         */
/* -------------------------------------------------------------------------- */

const TEXT_SIGNS: Array<{ kind: ClinicalSignKind; key: string }> = [
  { kind: "pallor", key: "pallor" },
  { kind: "cyanosis", key: "cyanosis" },
  { kind: "diaphoresis", key: "diaphoresis" },
  { kind: "respiratory-distress", key: "distress" },
  { kind: "reduced-loc", key: "reducedLoc" },
];

function levelKey(intensity: number): "mild" | "moderate" | "marked" {
  if (intensity < 0.4) return "mild";
  if (intensity < 0.7) return "moderate";
  return "marked";
}

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

export default function PatientHead3D({
  profile,
  signs,
  affect,
  rr,
  speaking = false,
  utterance,
  voice = false,
  className,
}: PatientHead3DProps) {
  const { t, i18n } = useTranslation();
  const reduceMotion = useReducedMotion();
  const [containerRef, inView] = useInView<HTMLDivElement>();

  const drive = useMemo(
    () => computeDrive(profile, signs, affect, rr),
    [profile, signs, affect, rr],
  );

  const animate = inView && !reduceMotion;
  const name = i18n.language.startsWith("tr") ? profile.name.tr : profile.name.en;

  // Lip-sync: text → animated jaw/mouth-shape. The clock is paused whenever the
  // head is offscreen or the tab is hidden (`active: inView`) so we never burn
  // frames the viewer can't see. Every string change is a fresh spoken turn.
  const speech = useSpeech({ active: inView });
  const { speak, stop } = speech;
  const trimmedUtterance = utterance?.trim() ?? "";
  const visemeDriven = trimmedUtterance.length > 0;
  const speechLang = i18n.language.startsWith("tr") ? "tr" : "en";

  useEffect(() => {
    if (trimmedUtterance) {
      speak(trimmedUtterance, { voice, lang: speechLang });
    } else {
      stop();
    }
    return () => stop();
  }, [trimmedUtterance, voice, speechLang, speak, stop]);

  // A turn is "speaking" when the viseme timeline is playing, or when the caller
  // passes the boolean directly (generic oscillation, no text). Under reduced
  // motion the head stays a static clinical pose, so the viseme signal is not
  // fed to the scene — the caption/pill still announce the turn.
  const effectiveSpeaking = visemeDriven ? speech.speaking : speaking;
  const feedVisemes = visemeDriven && animate;
  const muted = visemeDriven && !voice;

  // Present signs (above the 0.15 noise floor), strongest first.
  const present = TEXT_SIGNS.map((s) => ({ ...s, intensity: sig(signs, s.kind) }))
    .filter((s) => s.intensity > 0.15)
    .sort((a, b) => b.intensity - a.intensity);

  const dominant = present[0];
  const captionText = dominant
    ? t(`avatar3d.signs.${dominant.key}`)
    : t("avatar3d.signs.none");
  const stateText = present.map((s) => t(`avatar3d.signs.${s.key}`)).join(", ") || captionText;

  const canvasStyle: CSSProperties = { width: "100%", height: "100%", display: "block" };

  return (
    <figure
      className={`rounded-control border p-3 ${className ?? ""}`}
      style={{
        borderColor: "var(--monitor-border)",
        backgroundColor: "color-mix(in srgb, var(--monitor-fg) 4%, transparent)",
      }}
      aria-label={t("avatar3d.alt", { name, state: stateText })}
    >
      {/* Canvas — decorative; the meaning lives in the text below. */}
      <div
        ref={containerRef}
        aria-hidden="true"
        className="h-40 w-full overflow-hidden rounded-control"
        style={{
          background:
            "radial-gradient(120% 120% at 50% 20%, color-mix(in srgb, var(--monitor-fg) 8%, transparent), transparent)",
        }}
      >
        <Canvas
          style={canvasStyle}
          dpr={[1, 1.75]}
          frameloop={animate ? "always" : "demand"}
          gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
          camera={{ position: [0, 0, 3.1], fov: 32 }}
          performance={{ min: 0.5 }}
        >
          <AdaptiveDpr />
          <ambientLight intensity={0.75} />
          <directionalLight position={[2, 3, 4]} intensity={0.7} />
          <pointLight position={[-2, 1.5, 3]} intensity={0.35 + drive.sweat * 0.5} />
          <HeadModel
            drive={drive}
            speaking={effectiveSpeaking}
            animate={animate}
            jawOpen={feedVisemes ? speech.jawOpen : null}
            mouthShape={feedVisemes ? speech.mouthShape : null}
          />
        </Canvas>
      </div>

      {/* Visible caption row — dominant sign + speaking + synthetic label. */}
      <figcaption className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm font-medium" style={{ color: "var(--monitor-fg)" }}>
          {name}
        </span>
        <span className="inline-flex items-center gap-1 text-xs" style={{ color: "var(--monitor-dim)" }}>
          <Pulse size={13} weight="bold" aria-hidden="true" />
          <span className="italic">{captionText}</span>
        </span>
        {effectiveSpeaking && (
          <span
            className="inline-flex items-center gap-1 rounded-pill px-1.5 py-0.5 text-[10px] font-medium"
            style={{
              color: "var(--monitor-fg)",
              backgroundColor: "color-mix(in srgb, var(--monitor-online) 22%, transparent)",
            }}
          >
            <Waveform size={11} weight="bold" aria-hidden="true" />
            {t("avatar3d.speaking")}
          </span>
        )}
        {effectiveSpeaking && muted && (
          <span
            className="inline-flex items-center gap-1 text-[10px]"
            style={{ color: "var(--monitor-dim)" }}
            title={t("avatar3d.muted")}
          >
            <SpeakerSimpleSlash size={11} weight="bold" aria-hidden="true" />
            {t("avatar3d.muted")}
          </span>
        )}
        <span className="text-[10px] uppercase tracking-wide" style={{ color: "var(--monitor-dim)" }}>
          · {t("avatar3d.synthetic")}
        </span>
      </figcaption>

      {/* Visually-hidden, exhaustive sign list — text equivalent of the shading. */}
      <ul className="sr-only">
        <li>{t("avatar3d.signsLabel")}</li>
        {present.length === 0 ? (
          <li>{t("avatar3d.signs.none")}</li>
        ) : (
          present.map((s) => (
            <li key={s.kind}>
              {t("avatar3d.signItem", {
                sign: t(`avatar3d.signs.${s.key}`),
                level: t(`avatar3d.intensity.${levelKey(s.intensity)}`),
              })}
            </li>
          ))
        )}
      </ul>
    </figure>
  );
}
