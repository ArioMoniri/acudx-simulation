import { lazy, Suspense } from "react";
import { Routes, Route, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion, useReducedMotion } from "motion/react";

import { AppFrame, PageContainer } from "@/components/shell";
import { RouteFallback } from "@/components/shell/RouteFallback";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Button } from "@/components/ui";

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
/* App                                                                         */
/* -------------------------------------------------------------------------- */

export default function App() {
  return (
    <AppFrame>
      <ErrorBoundary>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
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
            <Route path="/institution" element={<InstitutionPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </AppFrame>
  );
}
