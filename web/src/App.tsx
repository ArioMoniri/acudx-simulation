import { lazy, Suspense, type ReactNode } from "react";
import { Routes, Route, Link, Navigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion, useReducedMotion } from "motion/react";

import { AppFrame, PageContainer } from "@/components/shell";
import { RouteFallback } from "@/components/shell/RouteFallback";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Button } from "@/components/ui";
import { useIsOnboarded, useIsSignedIn } from "@/state/profileStore";

/* -------------------------------------------------------------------------- */
/* Lazily-loaded route pages                                                   */
/* -------------------------------------------------------------------------- */
/* Each page is imported via its own module path so Vite emits a separate      */
/* chunk per route. Pages export named components, so we adapt each to the     */
/* default-export shape React.lazy expects.                                    */

const HomePage = lazy(() =>
  import("@/pages/HomePage").then((m) => ({ default: m.HomePage })),
);
const LandingPage = lazy(() =>
  import("@/pages/LandingPage").then((m) => ({ default: m.LandingPage })),
);
const AuthoringPage = lazy(() =>
  import("@/pages/AuthoringPage").then((m) => ({ default: m.AuthoringPage })),
);
const StartPage = lazy(() =>
  import("@/pages/StartPage").then((m) => ({ default: m.StartPage })),
);
const CasesPage = lazy(() =>
  import("@/pages/CasesPage").then((m) => ({ default: m.CasesPage })),
);
const EncounterPage = lazy(() =>
  import("@/pages/EncounterPage").then((m) => ({ default: m.EncounterPage })),
);
const FeedbackPage = lazy(() =>
  import("@/pages/FeedbackPage").then((m) => ({ default: m.FeedbackPage })),
);
const ProgressPage = lazy(() =>
  import("@/pages/ProgressPage").then((m) => ({ default: m.ProgressPage })),
);
const RoomPage = lazy(() =>
  import("@/pages/RoomPage").then((m) => ({ default: m.RoomPage })),
);
const InstitutionPage = lazy(() =>
  import("@/pages/InstitutionPage").then((m) => ({ default: m.InstitutionPage })),
);
const SignInPage = lazy(() =>
  import("@/pages/SignInPage").then((m) => ({ default: m.SignInPage })),
);
const ProfilePage = lazy(() =>
  import("@/pages/ProfilePage").then((m) => ({ default: m.ProfilePage })),
);
const ExamPage = lazy(() =>
  import("@/pages/ExamPage").then((m) => ({ default: m.ExamPage })),
);

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
        <h1 className="text-3xl font-semibold tracking-tight text-fg">404</h1>
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
/* Onboarding gate                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Gates the app on a REAL local profile. A first-time visitor is sent to the
 * sign-in screen and can only reach `/profile` to create their profile; once
 * signed in the whole app opens and the sign-in screen steps aside. This is
 * the onboarding gate — no seeded/demo user ever slips past it.
 */
function AuthGate({ children }: { children: ReactNode }) {
  const signedIn = useIsSignedIn();
  const onboarded = useIsOnboarded();
  const { pathname } = useLocation();

  if (signedIn) {
    // Already signed in — don't linger on the sign-in screen.
    if (pathname === "/signin") return <Navigate to="/" replace />;
    return <>{children}</>;
  }

  // Not signed in: the sign-in screen is always reachable, and the onboarding
  // form only for a genuine first-time user (no saved account yet). A signed-out
  // account resumes via "Continue as …" on the sign-in screen.
  const onboardingAllowed = !onboarded && pathname === "/profile";
  if (pathname === "/signin" || onboardingAllowed) return <>{children}</>;

  return <Navigate to="/signin" replace />;
}

/* -------------------------------------------------------------------------- */
/* App                                                                         */
/* -------------------------------------------------------------------------- */

export default function App() {
  return (
    <AppFrame>
      <ErrorBoundary>
        <Suspense fallback={<RouteFallback />}>
          <AuthGate>
            <Routes>
              <Route path="/signin" element={<SignInPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/account" element={<ProfilePage />} />
              <Route path="/" element={<HomePage />} />
              <Route path="/welcome" element={<LandingPage />} />
              <Route path="/authoring" element={<AuthoringPage />} />
              <Route path="/start" element={<StartPage />} />
              <Route path="/cases" element={<CasesPage />} />
              <Route path="/rooms" element={<RoomPage />} />
              <Route path="/rooms/:id" element={<RoomPage />} />
              <Route path="/encounter" element={<EncounterPage />} />
              <Route path="/feedback" element={<FeedbackPage />} />
              <Route path="/progress" element={<ProgressPage />} />
              <Route path="/exam" element={<ExamPage />} />
              <Route path="/institution" element={<InstitutionPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </AuthGate>
        </Suspense>
      </ErrorBoundary>
    </AppFrame>
  );
}
