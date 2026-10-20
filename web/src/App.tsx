import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { Routes, Route, Link, Navigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion, useReducedMotion } from "motion/react";

import { AppFrame, PageContainer } from "@/components/shell";
import { RouteFallback } from "@/components/shell/RouteFallback";
import { RoleGateNotice } from "@/components/shell/RoleGateNotice";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Button } from "@/components/ui";
import { bootstrapAuth, useAuthSession } from "@/lib/auth";
import { installEventSync } from "@/lib/eventSync";
import {
  applyVerifiedIdentity,
  useIsOnboarded,
  useIsSignedIn,
  useProfile,
  type ProfileRole,
} from "@/state/profileStore";

/* -------------------------------------------------------------------------- */
/* Lazily-loaded route pages                                                   */
/* -------------------------------------------------------------------------- */
/* Each page is imported via its own module path so Vite emits a separate      */
/* chunk per route. Pages export named components, so we adapt each to the     */
/* default-export shape React.lazy expects.                                    */

/* Per-route dynamic-import thunks — the single source of truth shared by both  */
/* React.lazy (below) and the hover/focus prefetch map (further down). `import()`*/
/* is idempotent: the module registry dedupes, so warming a chunk on hover and   */
/* then rendering its route never double-fetches or double-mounts.               */
const load = {
  home: () => import("@/pages/HomePage"),
  landing: () => import("@/pages/LandingPage"),
  authoring: () => import("@/pages/AuthoringPage"),
  start: () => import("@/pages/StartPage"),
  cases: () => import("@/pages/CasesPage"),
  encounter: () => import("@/pages/EncounterPage"),
  feedback: () => import("@/pages/FeedbackPage"),
  progress: () => import("@/pages/ProgressPage"),
  room: () => import("@/pages/RoomPage"),
  dean: () => import("@/pages/DeanPage"),
  faculty: () => import("@/pages/FacultyPage"),
  signin: () => import("@/pages/SignInPage"),
  authCallback: () => import("@/pages/AuthCallbackPage"),
  profile: () => import("@/pages/ProfilePage"),
  exam: () => import("@/pages/ExamPage"),
  atlas: () => import("@/pages/AtlasPage"),
  admin: () => import("@/pages/AdminPage"),
} as const;

const HomePage = lazy(() => load.home().then((m) => ({ default: m.HomePage })));
const LandingPage = lazy(() => load.landing().then((m) => ({ default: m.LandingPage })));
const AuthoringPage = lazy(() => load.authoring().then((m) => ({ default: m.AuthoringPage })));
const StartPage = lazy(() => load.start().then((m) => ({ default: m.StartPage })));
const CasesPage = lazy(() => load.cases().then((m) => ({ default: m.CasesPage })));
const EncounterPage = lazy(() => load.encounter().then((m) => ({ default: m.EncounterPage })));
const FeedbackPage = lazy(() => load.feedback().then((m) => ({ default: m.FeedbackPage })));
const ProgressPage = lazy(() => load.progress().then((m) => ({ default: m.ProgressPage })));
const RoomPage = lazy(() => load.room().then((m) => ({ default: m.RoomPage })));
const DeanPage = lazy(() => load.dean().then((m) => ({ default: m.DeanPage })));
const FacultyPage = lazy(() => load.faculty().then((m) => ({ default: m.FacultyPage })));
const SignInPage = lazy(() => load.signin().then((m) => ({ default: m.SignInPage })));
const AuthCallbackPage = lazy(() => load.authCallback().then((m) => ({ default: m.AuthCallbackPage })));
const ProfilePage = lazy(() => load.profile().then((m) => ({ default: m.ProfilePage })));
const ExamPage = lazy(() => load.exam().then((m) => ({ default: m.ExamPage })));
const AtlasPage = lazy(() => load.atlas().then((m) => ({ default: m.AtlasPage })));
const AdminPage = lazy(() => load.admin().then((m) => ({ default: m.AdminPage })));

/* -------------------------------------------------------------------------- */
/* Intent preload                                                              */
/* -------------------------------------------------------------------------- */
/* Nav destination path -> the thunk that warms its route chunk. TopNav wires  */
/* these to onMouseEnter / onFocus so the chunk is already downloading before   */
/* the click, removing the first-navigation "slow switch". Read at runtime      */
/* only (never at module eval), so the App <-> TopNav import cycle is safe.      */

const ROUTE_LOADERS: Record<string, () => Promise<unknown>> = {
  "/": load.home,
  "/start": load.start,
  "/cases": load.cases,
  "/rooms": load.room,
  "/exam": load.exam,
  "/atlas": load.atlas,
  "/feedback": load.feedback,
  "/progress": load.progress,
  "/authoring": load.authoring,
  "/institution": load.dean,
  "/dean": load.dean,
  "/faculty": load.faculty,
  "/account": load.profile,
  "/admin": load.admin,
};

/** Routes already warmed, so repeated hovers fire the import at most once. */
const warmedRoutes = new Set<string>();

/**
 * Warm the lazy chunk for a nav destination. Safe to call repeatedly (guarded +
 * `import()` dedupe) and on unknown paths (no-op). Failures are swallowed: a
 * preload is best-effort; the real navigation surfaces any load error.
 */
export function prefetchRoute(to: string): void {
  if (warmedRoutes.has(to)) return;
  const loader = ROUTE_LOADERS[to];
  if (!loader) return;
  warmedRoutes.add(to);
  void loader().catch(() => warmedRoutes.delete(to));
}

/* -------------------------------------------------------------------------- */
/* 404                                                                         */
/* -------------------------------------------------------------------------- */

function NotFoundPage() {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  return (
    <PageContainer>
      <motion.div
        initial={reduce ? undefined : { opacity: 0, y: 12 }}
        animate={reduce ? undefined : { opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      >
        <h1 className="text-[2.25rem] text-fg">404</h1>
        <p className="mt-2 max-w-2xl text-muted">{t("common.empty")}</p>
        <div className="mt-8">
          <Button asChild>
            <Link to="/">{t("nav.home")}</Link>
          </Button>
        </div>
      </motion.div>
    </PageContainer>
  );
}

/* -------------------------------------------------------------------------- */
/* Identity bootstrap                                                          */
/* -------------------------------------------------------------------------- */

/**
 * On first mount: ask the gateway which identity mode it runs (GET
 * /v1/auth/config), silently restore an OIDC session from the tab-scoped
 * refresh token, and mirror the verified principal into the profile store.
 * Also wires the server event sync so finished encounters reach the dean and
 * faculty panels.
 */
function useIdentityBootstrap(): void {
  useEffect(() => {
    const off = installEventSync();
    let cancelled = false;
    void bootstrapAuth().then((principal) => {
      if (!cancelled && principal) applyVerifiedIdentity(principal);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);
}

/* -------------------------------------------------------------------------- */
/* Onboarding gate                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Gates the app on a signed-in profile. A first-time visitor is sent to the
 * sign-in screen; in LOCAL mode they may create a local profile at `/profile`,
 * in OIDC mode the only way in is the institution sign-in (`/auth/callback`
 * completes it). Once the server reports OIDC mode, a stale unverified local
 * profile no longer passes: it is sent back to sign in.
 */
function AuthGate({ children }: { children: ReactNode }) {
  const signedIn = useIsSignedIn();
  const onboarded = useIsOnboarded();
  const profile = useProfile();
  const auth = useAuthSession();
  const { pathname } = useLocation();

  const oidcOnly = auth.configLoaded && auth.mode === "oidc";
  const verifiedOk = !oidcOnly || profile?.verified === true;

  if (pathname === "/auth/callback") return <>{children}</>;

  if (signedIn && verifiedOk) {
    if (pathname === "/signin") return <Navigate to="/" replace />;
    return <>{children}</>;
  }

  // Not signed in: the sign-in screen is always reachable, and the onboarding
  // form only for a genuine first-time LOCAL user (no saved account yet).
  const onboardingAllowed = !oidcOnly && !onboarded && pathname === "/profile";
  if (pathname === "/signin" || onboardingAllowed) return <>{children}</>;

  return <Navigate to="/signin" replace />;
}

/* -------------------------------------------------------------------------- */
/* Role gate                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Real ROLE permission guard (not "View as"). Reads `profile.role`, which in
 * OIDC mode is derived from the server-verified principal and in local mode is
 * the self-declared, unverified role (the server still enforces every panel
 * API with the same precedence). Once the gateway reports OIDC mode, an
 * unverified profile is never admitted to a privileged route.
 */
function RoleGate({
  roles,
  children,
}: {
  roles: readonly ProfileRole[];
  children: ReactNode;
}) {
  const profile = useProfile();
  const auth = useAuthSession();
  const oidcOnly = auth.configLoaded && auth.mode === "oidc";
  if (!profile || !roles.includes(profile.role) || (oidcOnly && !profile.verified)) {
    // Acceptance 2026-10-20 D-21: say which role is needed instead of a silent redirect.
    return <RoleGateNotice required={roles[0]} current={profile?.role} />;
  }
  return <>{children}</>;
}

const DEAN_ROLES: readonly ProfileRole[] = ["dean", "admin", "super_admin"];
const FACULTY_ROLES: readonly ProfileRole[] = ["faculty", "dean", "admin", "super_admin"];
const ADMIN_ROLES: readonly ProfileRole[] = ["admin", "super_admin"];

/* -------------------------------------------------------------------------- */
/* App                                                                         */
/* -------------------------------------------------------------------------- */

export default function App() {
  useIdentityBootstrap();
  return (
    <AppFrame>
      <ErrorBoundary>
        <Suspense fallback={<RouteFallback />}>
          <AuthGate>
            <Routes>
              <Route path="/signin" element={<SignInPage />} />
              <Route path="/auth/callback" element={<AuthCallbackPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/account" element={<ProfilePage />} />
              <Route path="/" element={<HomePage />} />
              <Route path="/welcome" element={<LandingPage />} />
              <Route
                path="/authoring"
                element={
                  <RoleGate roles={FACULTY_ROLES}>
                    <AuthoringPage />
                  </RoleGate>
                }
              />
              <Route path="/start" element={<StartPage />} />
              <Route path="/cases" element={<CasesPage />} />
              <Route path="/rooms" element={<RoomPage />} />
              <Route path="/rooms/:id" element={<RoomPage />} />
              <Route path="/encounter" element={<EncounterPage />} />
              <Route path="/feedback" element={<FeedbackPage />} />
              <Route path="/progress" element={<ProgressPage />} />
              <Route path="/exam" element={<ExamPage />} />
              <Route path="/atlas" element={<AtlasPage />} />
              <Route
                path="/dean"
                element={
                  <RoleGate roles={DEAN_ROLES}>
                    <DeanPage />
                  </RoleGate>
                }
              />
              <Route path="/institution" element={<Navigate to="/dean" replace />} />
              <Route
                path="/faculty"
                element={
                  <RoleGate roles={FACULTY_ROLES}>
                    <FacultyPage />
                  </RoleGate>
                }
              />
              <Route
                path="/admin"
                element={
                  <RoleGate roles={ADMIN_ROLES}>
                    <AdminPage />
                  </RoleGate>
                }
              />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </AuthGate>
        </Suspense>
      </ErrorBoundary>
    </AppFrame>
  );
}
