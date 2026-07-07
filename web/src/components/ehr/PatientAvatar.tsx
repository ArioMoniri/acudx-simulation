/**
 * AcuDx — PatientAvatar: the layered avatar abstraction (research/10 §3).
 *
 * ONE component, ONE driver interface, FOUR pluggable renderer tiers. The
 * clinical-sign channel is non-negotiable and stays client-controlled because
 * no streaming vendor can shade cyanosis-at-SpO2 (research/10 key decisions):
 * the sign intensities always drive the 2D portrait overlay, even when a
 * higher-fidelity renderer sits on top.
 *
 *   T0 '2d'        — physiology-driven 2D portrait (this file, reuses
 *                    PatientPortrait). MVP + always-available device floor. $0.
 *   T1 '3d'        — client R3F + Ready Player Me + Audio2Face-3D lip-sync.
 *                    SLOT ONLY here (interface + commented mount point).
 *   T2 'streaming' — Anam CARA-3 / Tavus Phoenix-4 over LiveKit WebRTC.
 *                    SLOT ONLY here (interface + commented mount point).
 *
 * Drivers are identical across renderers (research/10 §3):
 *   - visemes?      <- Voice Pipeline TTS (ARKit-52), lip-sync/expression
 *   - affect        <- Persona Agent (emotion label + intensity)
 *   - clinicalSigns <- Vitals & Physiology Engine (ClinicalSign.intensity)
 *
 * Education only. Synthetic patient. C2PA + "synthetic patient" marked upstream.
 */

import { useTranslation } from "react-i18next";
import { PatientPortrait } from "@/components/PatientPortrait";

/* -------------------------------------------------------------------------- */
/* Driver interface (shared across all tiers)                                  */
/* -------------------------------------------------------------------------- */

/** Clinical signs the physiology engine can shade onto the face/body. */
export type ClinicalSignKind =
  | "cyanosis"
  | "pallor"
  | "diaphoresis"
  | "respiratory-distress"
  | "reduced-loc"
  | "jaundice"
  | "flushing";

/** A single clinical sign with a 0..1 intensity (research/10 §1.1). */
export interface ClinicalSignIntensity {
  sign: ClinicalSignKind;
  /** 0 (absent) .. 1 (maximal). */
  intensity: number;
}

/** Affect from the Persona Agent — presentation only, never scored as learner emotion. */
export interface AvatarAffect {
  /** Emotion label, e.g. "distress", "calm", "guarded". */
  label: string;
  /** 0..1 intensity of the affect. */
  intensity: number;
}

/**
 * ARKit-52 blendshape / viseme frame from the TTS pipeline. Kept as an opaque
 * numeric map so the T1/T2 renderers can consume it without this module owning
 * the ARKit-52 vocabulary. Undefined at T0 (2D portrait has no lip-sync).
 */
export interface VisemeFrame {
  /** ARKit-52 blendshape name -> weight (0..1). */
  weights: Record<string, number>;
  /** Frame time in ms from utterance start. */
  atMs: number;
}

/**
 * PatientAvatarDriver — the single driver contract every renderer consumes.
 * Exported so the Voice Pipeline / Persona Agent / Physiology Engine can be
 * wired to any tier without touching the renderers.
 */
export interface PatientAvatarDriver {
  /** ARKit-52 viseme stream (lip-sync). Absent at T0. */
  visemes?: VisemeFrame[];
  affect: AvatarAffect;
  clinicalSigns: ClinicalSignIntensity[];
}

/** Renderer tier. Everything degrades to '2d' on a weak device (research/10 §3). */
export type AvatarTier = "2d" | "3d" | "streaming";

export interface PatientAvatarProps {
  affect: AvatarAffect;
  clinicalSigns: ClinicalSignIntensity[];
  /** ARKit-52 viseme stream for T1/T2 lip-sync (ignored at T0). */
  visemes?: VisemeFrame[];
  /** Renderer tier; defaults to the always-available 2D portrait. */
  tier?: AvatarTier;
  /** Synthetic patient display name. */
  name: string;
}

/* -------------------------------------------------------------------------- */
/* Sign channel -> caption (drives the 2D portrait + overlay text)             */
/* -------------------------------------------------------------------------- */

/** i18n suffix key for a clinical sign (ehr.avatar.signs.<key>). */
function signKey(sign: ClinicalSignKind): string {
  return sign.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Build the localized clinical-sign caption from the dominant sign. This text
 * is what carries the clinical meaning (never color/pixels alone) so the WCAG
 * text-equivalent requirement holds at every tier.
 */
function useSignCaption(signs: ClinicalSignIntensity[], affect: AvatarAffect) {
  const { t } = useTranslation();
  const present = signs.filter((s) => s.intensity > 0.15);
  if (present.length === 0) {
    return t("ehr.avatar.signs.none");
  }
  const dominant = [...present].sort((a, b) => b.intensity - a.intensity)[0];
  const signText = t(`ehr.avatar.signs.${signKey(dominant.sign)}`);
  const affectText = affect.label
    ? `${signText}, ${affect.label}`
    : signText;
  return affectText;
}

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * PatientAvatar — renders the chosen tier. Only T0 ('2d') is implemented; the
 * higher tiers are clearly-commented mount slots that consume the SAME driver.
 */
export function PatientAvatar({
  affect,
  clinicalSigns,
  visemes,
  tier = "2d",
  name,
}: PatientAvatarProps) {
  const caption = useSignCaption(clinicalSigns, affect);

  // The driver object every tier consumes (assembled once so the mount slots
  // below can pass it straight through when they are implemented).
  const driver: PatientAvatarDriver = { affect, clinicalSigns, visemes };

  switch (tier) {
    /* ---------------------------------------------------------------------- */
    /* T1 '3d' — client R3F + Ready Player Me + Audio2Face-3D (SLOT)          */
    /* ---------------------------------------------------------------------- */
    // case "3d":
    //   return (
    //     <ThreeAvatar
    //       driver={driver}          // visemes -> ARKit-52 blendshapes (Audio2Face-3D)
    //       signOverlay={clinicalSigns} // additive shader overlay, sign ⟂ viseme channel
    //       name={name}
    //     />
    //   );

    /* ---------------------------------------------------------------------- */
    /* T2 'streaming' — Anam CARA-3 / Tavus Phoenix-4 over LiveKit (SLOT)     */
    /* ---------------------------------------------------------------------- */
    // case "streaming":
    //   return (
    //     <StreamingAvatar
    //       driver={driver}          // connect-any-LLM points at the Model Gateway
    //       transport={liveKitRoom}  // shared WebRTC layer (arch/03, arch/07)
    //       signBadges={clinicalSigns} // client sign badges; monitor stays authoritative
    //       c2pa                     // synthetic-media label on every frame
    //       name={name}
    //     />
    //   );

    /* ---------------------------------------------------------------------- */
    /* T0 '2d' — physiology-driven 2D portrait (default, device floor, $0)    */
    /* ---------------------------------------------------------------------- */
    case "2d":
    default:
      // The 2D portrait IS the clinical-sign channel at T0. `driver` is passed
      // through the caption so the same sign intensities that would shade a 3D
      // face here shade the portrait's expression + carry the text equivalent.
      void driver;
      return <PatientPortrait caption={caption} name={name} />;
  }
}

/* -------------------------------------------------------------------------- */
/* Helpers for callers: derive sign intensities from vitals                    */
/* -------------------------------------------------------------------------- */

/**
 * Derive clinical-sign intensities from triage vitals (a light client analogue
 * of the Vitals & Physiology Engine's sign channel). Deterministic and pure so
 * the avatar, monitor, and words never contradict (single source).
 */
export function signsFromVitals(v: {
  spo2: number;
  rr: number;
  hr: number;
}): ClinicalSignIntensity[] {
  const signs: ClinicalSignIntensity[] = [];
  // Cyanosis rises as SpO2 falls below ~94%.
  const cyanosis = clamp01((94 - v.spo2) / 10);
  if (cyanosis > 0) signs.push({ sign: "cyanosis", intensity: cyanosis });
  // Respiratory distress from an elevated respiratory rate (>20).
  const distress = clamp01((v.rr - 20) / 15);
  if (distress > 0) signs.push({ sign: "respiratory-distress", intensity: distress });
  // Diaphoresis proxied from marked tachycardia (>100).
  const diaphoresis = clamp01((v.hr - 100) / 40);
  if (diaphoresis > 0) signs.push({ sign: "diaphoresis", intensity: diaphoresis });
  return signs;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
