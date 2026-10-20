import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { EyeSlash, ArrowRight, FlagCheckered } from "@phosphor-icons/react";

import { Card, Button, Badge } from "@/components/ui";
import { PatientBanner, ActivityTabs, signsFromVitals } from "@/components/ehr";
import { useReveal } from "@/lib/motion";
import { useLang } from "@/lib/useLang";
import { useLiveBackend } from "@/lib/liveBackend";
import { endCaseSession, requestCase } from "@/lib/caseSession";
import {
  resetEncounter,
  setLiveEnabled,
  useEncounterState,
} from "@/state/encounterStore";
import {
  constraintForCase,
  scoreCase,
  type CaseResult,
  type ExamConfig,
} from "@/domain/summative";
import { ExamTimer } from "./ExamTimer";

export interface ExamRunnerProps {
  config: ExamConfig;
  /** Called once when the final case is submitted, with every scored result. */
  onFinish: (results: CaseResult[]) => void;
}

/**
 * ExamRunner — drives the proctored, timed sequence of cases. Each station requests
 * its case from the model at the start of that station (POST
 * /v2/case/generate/stream, review 06a P13), starts the shared encounter store from
 * the opening as soon as it is playable, and renders the SAME EHR workspace as free practice but
 * with guidance FORCED OFF and a visible countdown. "Submit & next" grades the
 * case with `scoreCase`, resets the store, and advances; the countdown
 * auto-submits at zero. The tally is kept out of the store so a case reset never
 * loses earned results.
 */
export function ExamRunner({ config, onFinish }: ExamRunnerProps) {
  const { t } = useTranslation();
  const lang = useLang();
  const top = useReveal();
  const body = useReveal(0.06);
  const { available: backendAvailable } = useLiveBackend();

  const state = useEncounterState();
  const [index, setIndex] = useState(0);
  const [generating, setGenerating] = useState(true);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  // The Director runs in an exam exactly as in practice: Live follows reachability.
  useEffect(() => {
    setLiveEnabled(backendAvailable);
  }, [backendAvailable]);

  // Refs so the stable submit handler always reads the freshest values and the
  // countdown/click cannot double-submit the same case.
  const stateRef = useRef(state);
  stateRef.current = state;
  const indexRef = useRef(0);
  const caseStartedAtRef = useRef(0);
  const resultsRef = useRef<CaseResult[]>([]);
  const submittedIndexRef = useRef(-1);
  const activeRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);

  const caseInstance = state.caseInstance;

  const startCase = useCallback(
    async (i: number) => {
      setGenerating(true);
      setFailure(null);
      setDeadline(null);
      // Per #108: clear the store (and its pending timers) between cases.
      abortRef.current?.abort();
      endCaseSession();
      resetEncounter();
      const controller = new AbortController();
      abortRef.current = controller;
      const constraint = constraintForCase(config, i);
      const res = await requestCase(
        { locale: lang, purpose: "exam", ...(constraint ? { complaint: constraint } : {}) },
        { signal: controller.signal },
      );
      if (!activeRef.current || controller.signal.aborted) return;
      if (!res.ok) {
        // No other case is substituted: the station waits for Retry.
        setFailure(res.error);
        setGenerating(false);
        return;
      }
      const now = Date.now();
      caseStartedAtRef.current = now;
      indexRef.current = i;
      submittedIndexRef.current = -1;
      setIndex(i);
      setDeadline(now + config.perCaseSeconds * 1000);
      setGenerating(false);
    },
    [config, lang],
  );

  // Kick off the first case on mount; clean up the store on unmount.
  useEffect(() => {
    activeRef.current = true;
    void startCase(0);
    return () => {
      activeRef.current = false;
      abortRef.current?.abort();
      endCaseSession();
      resetEncounter();
    };
    // Intentionally mount-only: the config is captured at arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = useCallback(
    (timedOut: boolean) => {
      const i = indexRef.current;
      if (submittedIndexRef.current === i) return; // guard double-submit
      const s = stateRef.current;
      const ci = s.caseInstance;
      if (!ci) return;
      submittedIndexRef.current = i;

      const elapsed = Date.now() - caseStartedAtRef.current;
      const score = scoreCase(s, ci, elapsed);
      const result: CaseResult = {
        ...score,
        index: i,
        caseId: ci.id,
        title: ci.chiefComplaint,
        timedOut,
      };
      const nextResults = [...resultsRef.current, result];
      resultsRef.current = nextResults;

      const nextIndex = i + 1;
      if (nextIndex >= config.length) {
        resetEncounter();
        onFinish(nextResults);
      } else {
        void startCase(nextIndex);
      }
    },
    [config.length, onFinish, startCase],
  );

  const affectLabel = useMemo(() => {
    if (!caseInstance) return t("encounter.affect.distress", { defaultValue: "Distress" });
    const signs = signsFromVitals(caseInstance.triageVitals);
    if (signs.length === 0) {
      return t("encounter.affect.relieved", { defaultValue: "Settled" });
    }
    return t("encounter.affect.distress", { defaultValue: "Distress" });
  }, [caseInstance, t]);

  const isLast = index + 1 >= config.length;
  const noop = useCallback(() => {}, []);

  if (failure && !generating) {
    return (
      <Card padding="lg" className="flex flex-col items-center gap-3 text-center" role="alert">
        <p className="text-sm font-medium text-fg">
          {t(`live2.gen.error.${failure}`, { defaultValue: t("live2.gen.error.unknown", { code: failure }) })}
        </p>
        <p className="text-xs text-muted">{t("live2.gen.onRequestHint")}</p>
        <Button onClick={() => void startCase(index)}>{t("live2.gen.retry")}</Button>
      </Card>
    );
  }

  // Preparing state — first case still generating, or the between-case gap.
  if (generating || !caseInstance || deadline == null) {
    return (
      <Card padding="lg" className="flex flex-col items-center gap-2 text-center">
        <span
          className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-brand"
          aria-hidden="true"
        />
        <p className="text-sm font-medium text-fg">
          {t("exam.runner.preparing", {
            defaultValue: "Preparing case {{n}} of {{total}}…",
            n: index + 1,
            total: config.length,
          })}
        </p>
        <p className="text-xs text-muted">
          {t("exam.runner.preparingHint", {
            defaultValue: "Generating a fresh, unseen case.",
          })}
        </p>
      </Card>
    );
  }

  const proctorBar = (
    <motion.div
      {...top}
      className="flex flex-col gap-3 rounded-card border border-border bg-surface p-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-fg">
          {t("exam.runner.caseProgress", {
            defaultValue: "Case {{n}} of {{total}}",
            n: index + 1,
            total: config.length,
          })}
        </span>
        <Badge tone="warning" icon={<EyeSlash weight="bold" className="h-3.5 w-3.5" />}>
          {t("exam.runner.guidanceOff", { defaultValue: "Guidance off" })}
        </Badge>
      </div>
      <div className="flex items-center gap-2">
        <ExamTimer
          key={index}
          deadline={deadline}
          onExpire={() => submit(true)}
        />
        <Button
          onClick={() => submit(false)}
          trailingIcon={
            isLast ? <FlagCheckered weight="bold" /> : <ArrowRight weight="bold" />
          }
        >
          {isLast
            ? t("exam.runner.finish", { defaultValue: "Submit & finish" })
            : t("exam.runner.submitNext", { defaultValue: "Submit & next" })}
        </Button>
      </div>
    </motion.div>
  );

  return (
    <div className="flex flex-col gap-4">
      {proctorBar}

      <motion.div {...top}>
        <PatientBanner caseInstance={caseInstance} lang={lang} />
      </motion.div>

      <motion.div {...body} className="min-w-0">
        <ActivityTabs
          caseInstance={caseInstance}
          lang={lang}
          affectLabel={affectLabel}
          guidanceOn={false}
          onGuidanceChange={noop}
        />
      </motion.div>
    </div>
  );
}
