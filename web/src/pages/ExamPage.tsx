import { useState } from "react";
import { useTranslation } from "react-i18next";

import { PageContainer, PageHeader } from "@/components/shell";
import { ExamIntro, ExamRunner, ExamReport } from "@/components/exam";
import { useLiveBackend } from "@/lib/liveBackend";
import {
  DEFAULT_EXAM_CONFIG,
  useExamAttempts,
  type CaseResult,
  type ExamConfig,
} from "@/domain/summative";

type Phase = "intro" | "running" | "report";

/**
 * ExamPage — the summative EXAM mode (#108). A three-phase flow: an intro/setup
 * brief, a proctored + timed runner over N generated cases with guidance forced
 * off, and a scored competency report persisted locally. Distinct from free
 * practice by design. Self-contained: it does not require an authored profile
 * (attempts are stored on-device).
 */
export function ExamPage() {
  const { t } = useTranslation();
  const { available: backendAvailable } = useLiveBackend();
  const attempts = useExamAttempts();

  const [phase, setPhase] = useState<Phase>("intro");
  const [config, setConfig] = useState<ExamConfig>(DEFAULT_EXAM_CONFIG);
  const [results, setResults] = useState<CaseResult[]>([]);

  const header = {
    intro: {
      title: t("exam.header.introTitle", { defaultValue: "Summative exam" }),
      description: t("exam.header.introDesc", {
        defaultValue:
          "A proctored, timed run of generated cases with guidance switched off, ending in a scored competency report.",
      }),
    },
    running: {
      title: t("exam.header.runningTitle", { defaultValue: "Exam in progress" }),
      description: t("exam.header.runningDesc", {
        defaultValue: "Work each case on the clock. Guidance is disabled.",
      }),
    },
    report: {
      title: t("exam.header.reportTitle", { defaultValue: "Competency report" }),
      description: t("exam.header.reportDesc", {
        defaultValue: "Your scored results for this attempt, saved to this device.",
      }),
    },
  }[phase];

  return (
    <PageContainer width="wide" className="flex flex-col gap-6">
      <PageHeader
        eyebrow={t("exam.header.eyebrow", { defaultValue: "Assessment" })}
        title={header.title}
        description={header.description}
      />

      {phase === "intro" ? (
        <ExamIntro
          initial={config}
          backendAvailable={backendAvailable}
          attemptsCount={attempts.length}
          onBegin={(next) => {
            setConfig(next);
            setResults([]);
            setPhase("running");
          }}
        />
      ) : null}

      {phase === "running" ? (
        <ExamRunner
          config={config}
          onFinish={(next) => {
            setResults(next);
            setPhase("report");
          }}
        />
      ) : null}

      {phase === "report" ? (
        <ExamReport
          config={config}
          results={results}
          onRetake={() => setPhase("intro")}
        />
      ) : null}
    </PageContainer>
  );
}
