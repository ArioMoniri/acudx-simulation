/**
 * AcuDx — PatientAvatar3D: the app-facing avatar wrapper.
 *
 * This is the component the app mounts. It:
 *   1. reads the live clinical course from the encounter store (current vitals +
 *      course status) and derives the SAME clinical-sign channel the 2D portrait
 *      uses, so the 3D head, the 2D fallback, and the monitor never disagree;
 *   2. lazy-loads the heavy R3F head (PatientHead3D) behind React.Suspense, so
 *      three / fiber / drei stay out of the main bundle;
 *   3. degrades gracefully — if WebGL is unavailable, the device asks for less
 *      data, or the 3D head throws at runtime, it renders the existing 2D
 *      `@/components/ehr/PatientAvatar` instead, with a visible note.
 *
 * The 2D component is also the Suspense fallback, so the very first paint is the
 * always-available portrait and the 3D head swaps in when its chunk arrives.
 *
 * Air-gapped, education only. Synthetic patient.
 */

import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

import {
  useEncounterState,
  getCurrentVitals,
  getCourseStatus,
} from "@/state/encounterStore";
import type { CourseStatus, CurrentVitals } from "@/domain/clinicalCourse";
import { pickProfile, type PatientProfile } from "@/domain/patientProfiles";
import {
  PatientAvatar,
  type AvatarAffect,
  type ClinicalSignIntensity,
} from "@/components/ehr/PatientAvatar";

import { isWebGLAvailable, prefersReducedData } from "./webgl";

/** Lazy so three/fiber/drei land in a separate chunk (main bundle stays lean). */
const PatientHead3D = lazy(() => import("./PatientHead3D"));

export interface PatientAvatar3DProps {
  /** Stable seed selecting the patient's presentation profile (e.g. case id). */
  profileSeed?: string | number;
  /** True while the patient is speaking (drives mouth movement on the 3D head). */
  speaking?: boolean;
  className?: string;
}

/* -------------------------------------------------------------------------- */
/* Sign + affect derivation (client analogue of the physiology engine)         */
/* -------------------------------------------------------------------------- */

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Derive clinical-sign intensities from the live vitals + coarse course status.
 * Pure and deterministic so the avatar never contradicts the monitor.
 */
function deriveSigns(
  v: CurrentVitals | null,
  status: CourseStatus | null,
): ClinicalSignIntensity[] {
  if (!v) return [];
  const out: ClinicalSignIntensity[] = [];

  const cyanosis = clamp01((94 - v.spo2) / 10);
  if (cyanosis > 0) out.push({ sign: "cyanosis", intensity: cyanosis });

  const distress = clamp01((v.rr - 20) / 15);
  if (distress > 0) out.push({ sign: "respiratory-distress", intensity: distress });

  const diaphoresis = clamp01((v.hr - 100) / 40);
  if (diaphoresis > 0) out.push({ sign: "diaphoresis", intensity: diaphoresis });

  // Pallor from poor perfusion (falling systolic pressure).
  const pallor = clamp01((105 - v.systolic) / 45);
  if (pallor > 0) out.push({ sign: "pallor", intensity: pallor });

  // Reduced LOC from severe hypoxia / hypotension, boosted when critical.
  const locBase = Math.max((88 - v.spo2) / 16, (85 - v.systolic) / 30);
  const loc = clamp01(locBase + (status === "critical" ? 0.3 : 0));
  if (loc > 0) out.push({ sign: "reduced-loc", intensity: loc });

  return out;
}

/** Affect intensity (idle-motion strength) from the coarse course status. */
function affectFor(status: CourseStatus | null): AvatarAffect {
  const intensity =
    status === "critical"
      ? 0.95
      : status === "deteriorating"
        ? 0.75
        : status === "improving"
          ? 0.4
          : 0.45;
  // Label left empty: the 2D portrait drives expression from the profile's
  // baseline affect, and an empty label keeps its caption sign-only.
  return { label: "", intensity };
}

/* -------------------------------------------------------------------------- */
/* Runtime error boundary (fall back to 2D if the R3F head throws)             */
/* -------------------------------------------------------------------------- */

class HeadErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

export function PatientAvatar3D({
  profileSeed,
  speaking = false,
  className,
}: PatientAvatar3DProps) {
  const { t, i18n } = useTranslation();

  // Read the whole (referentially-stable) store snapshot and call the live
  // getters as PURE functions — the codebase's safe pattern (see
  // LiveVitalsMonitor). `getCurrentVitals` builds a fresh object each call and
  // is time-derived, so it must NOT be a useSyncExternalStore selector.
  const state = useEncounterState();
  const hasCase = state.caseInstance != null;

  // Light re-read tick so signs track the evolving course (not per-frame). This
  // is data evolution, not animation, so it runs regardless of reduced-motion.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!hasCase || typeof window === "undefined") return;
    const id = window.setInterval(() => tick((n) => (n + 1) % 1_000_000), 2500);
    return () => window.clearInterval(id);
  }, [hasCase]);

  const vitals = getCurrentVitals(state);
  const status = getCourseStatus(state);

  // WebGL / data-saver probes are environment-stable — evaluate once.
  const [canWebGL] = useState(isWebGLAvailable);
  const [reducedData] = useState(prefersReducedData);

  const profile: PatientProfile = useMemo(
    () => pickProfile(profileSeed ?? "acudx-patient"),
    [profileSeed],
  );

  const signs = deriveSigns(vitals, status);
  const affect = affectFor(status);

  const name = i18n.language.startsWith("tr") ? profile.name.tr : profile.name.en;
  const rr = vitals?.rr ?? 16;

  const twoD = (note?: string): ReactNode => (
    <>
      <PatientAvatar affect={affect} clinicalSigns={signs} name={name} profile={profile} />
      {note && (
        <p className="mt-1 text-xs" style={{ color: "var(--monitor-dim)" }}>
          {note}
        </p>
      )}
    </>
  );

  // Can't (no WebGL) or shouldn't (data saver) render 3D → 2D + note.
  if (!canWebGL || reducedData) {
    return <div className={className}>{twoD(t("avatar3d.unavailable"))}</div>;
  }

  return (
    <div className={className}>
      <HeadErrorBoundary fallback={twoD(t("avatar3d.unavailable"))}>
        <Suspense fallback={twoD()}>
          <PatientHead3D
            profile={profile}
            signs={signs}
            affect={affect}
            rr={rr}
            speaking={speaking}
          />
        </Suspense>
      </HeadErrorBoundary>
    </div>
  );
}
