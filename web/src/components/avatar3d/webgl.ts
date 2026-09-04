/**
 * AcuDx — avatar3d/webgl: a tiny, dependency-free WebGL-availability probe.
 *
 * Used by PatientAvatar3D to decide whether the 3D head can render at all. On
 * any failure (no context, blocked GPU, SSR/no-DOM) it returns false so the
 * caller can fall back to the always-available 2D portrait. The probe creates a
 * throwaway <canvas>, asks for a context, and never keeps a reference to it.
 *
 * Air-gapped: no imports, no network. Education only.
 */

/**
 * True when a WebGL (2 or 1) rendering context can be created in this
 * environment. Swallows every error — a probe must never throw into render.
 */
export function isWebGLAvailable(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }
  // Some environments expose the constructor but not a usable GPU path.
  if (typeof WebGLRenderingContext === "undefined") return false;

  try {
    const canvas = document.createElement("canvas");
    const attrs: WebGLContextAttributes = { failIfMajorPerformanceCaveat: false };
    const ctx =
      canvas.getContext("webgl2", attrs) ||
      canvas.getContext("webgl", attrs) ||
      canvas.getContext("experimental-webgl", attrs);
    return (
      !!ctx &&
      typeof (ctx as WebGLRenderingContext).getParameter === "function"
    );
  } catch {
    return false;
  }
}

/**
 * True when the caller should prefer the cheaper 2D avatar even though WebGL is
 * available — e.g. the user has Data Saver on or the device reports very little
 * memory. Kept separate from `isWebGLAvailable` so the two reasons to fall back
 * (can't vs shouldn't) stay independent. Always safe; never throws.
 */
export function prefersReducedData(): boolean {
  if (typeof navigator === "undefined") return false;
  try {
    const nav = navigator as Navigator & {
      connection?: { saveData?: boolean };
      deviceMemory?: number;
    };
    if (nav.connection?.saveData === true) return true;
    if (typeof nav.deviceMemory === "number" && nav.deviceMemory > 0 && nav.deviceMemory < 1) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
