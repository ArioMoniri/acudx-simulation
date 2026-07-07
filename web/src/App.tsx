import { Routes, Route, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion, useReducedMotion } from "motion/react";

import { AppFrame, PageContainer } from "@/components/shell";
import { Button } from "@/components/ui";
import {
  HomePage,
  LandingPage,
  AuthoringPage,
  StartPage,
  CasesPage,
  EncounterPage,
  FeedbackPage,
  ProgressPage,
  RoomPage,
  InstitutionPage,
} from "@/pages";

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
    </AppFrame>
  );
}
