/**
 * AcuDx — avatar3d barrel.
 *
 * Exposes ONLY the app-facing wrapper (PatientAvatar3D), the WebGL probes, and
 * types. PatientHead3D is intentionally NOT re-exported as a value here: it pulls
 * in three / fiber / drei, and a static re-export would drag those into whatever
 * imports this barrel, defeating the lazy load. Consumers get the head solely
 * through PatientAvatar3D's internal `lazy(() => import("./PatientHead3D"))`.
 */

export { PatientAvatar3D } from "./PatientAvatar3D";
export type { PatientAvatar3DProps } from "./PatientAvatar3D";
export type { PatientHead3DProps } from "./PatientHead3D";
export { isWebGLAvailable, prefersReducedData } from "./webgl";
