import { useEffect, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { ArrowClockwise, House, Trophy, Timer } from "@phosphor-icons/react";

import {
  Card,
  Stat,
  Button,
  Badge,
  StatusDot,
  SectionLabel,
  TableWrap,
  Table,
  THead,
  TBody,
  Tr,
  Th,
  Td,
  type StatusTone,
} from "@/components/ui";
import { useReveal } from "@/lib/motion";
import { useLang } from "@/lib/useLang";
import {
  buildExamAttempt,
  saveAttempt,
  scoreAggregate,
  formatClock,
  useExamAttempts,
  type CaseResult,
  type DxVerdict,
  type ExamConfig,
} from "@/domain/summative";

export interface ExamReportProps {
  config: ExamConfig;
  results: CaseResult[];
  onRetake: () => void;
}

const VERDICT_TONE: Record<DxVerdict, StatusTone> = {
  correct: "normal",
  "near-miss": "caution",
  incorrect: "critical",
};

const pct = (x: number): string => `${Math.round(x * 100)}%`;

/**
 * ExamReport — the final competency report. Persists the attempt exactly once,
 * then renders the aggregate roll-up (accuracy, red-flag capture, work-up
 * appropriateness, mean time-to-diagnosis, total score) plus a per-case table.
 * Offers a retake and a link home.
 */
export function ExamReport({ config, results, onRetake }: ExamReportProps) {
  const { t } = useTranslation();
  const lang = useLang();
  const top = useReveal();
  const body = useReveal(0.06);

  const aggregate = useMemo(() => scoreAggregate(results), [results]);
  const attempts = useExamAttempts();

  // Persist the attempt once (stamps id + at at save time).
  const savedRef = useRef(false);
  useEffect(() => {
    if (savedRef.current) return;
    savedRef.current = true;
    saveAttempt(buildExamAttempt(config, results));
  }, [config, results]);

  const verdictLabel = (v: DxVerdict): string =>
    v === "correct"
      ? t("exam.verdict.correct", { defaultValue: "Correct" })
      : v === "near-miss"
        ? t("exam.verdict.nearMiss", { defaultValue: "Near miss" })
        : t("exam.verdict.incorrect", { defaultValue: "Incorrect" });

  return (
    <div className="flex flex-col gap-5">
      {/* Headline score + aggregate stats */}
      <motion.div {...top}>
        <Card padding="lg" className="flex flex-col gap-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-chip bg-brand-tint text-brand">
                <Trophy weight="bold" className="h-6 w-6" aria-hidden="true" />
              </span>
              <Stat
                size="xl"
                label={t("exam.report.totalScore", { defaultValue: "Total score" })}
                value={aggregate.points}
                unit={`/ ${aggregate.maxPoints}`}
                hint={t("exam.report.acrossCases", {
                  defaultValue: "across {{n}} cases",
                  n: aggregate.cases,
                })}
              />
            </div>
            <Badge tone="brand">
              {t("exam.report.completed", { defaultValue: "Exam complete" })}
            </Badge>
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-5 border-t border-border pt-5 lg:grid-cols-4">
            <Stat
              size="lg"
              label={t("exam.report.accuracy", { defaultValue: "Diagnostic accuracy" })}
              value={pct(aggregate.accuracy)}
              hint={t("exam.report.accuracyHint", {
                defaultValue: "{{correct}} of {{cases}} correct",
                correct: aggregate.correct,
                cases: aggregate.cases,
              })}
            />
            <Stat
              size="lg"
              label={t("exam.report.redFlags", { defaultValue: "Red-flag capture" })}
              value={pct(aggregate.redFlagCapturePct)}
              hint={t("exam.report.redFlagsHint", {
                defaultValue: "screened vs present",
              })}
            />
            <Stat
              size="lg"
              label={t("exam.report.workup", { defaultValue: "Workup appropriateness" })}
              value={pct(aggregate.workupAppropriateness)}
              hint={t("exam.report.workupHint", { defaultValue: "indicated vs over / under" })}
            />
            <Stat
              size="lg"
              mono
              icon={<Timer weight="bold" className="h-4 w-4" />}
              label={t("exam.report.ttd", { defaultValue: "Mean time to Dx" })}
              value={
                aggregate.meanTimeToDiagnosisMs == null
                  ? "—"
                  : formatClock(aggregate.meanTimeToDiagnosisMs)
              }
              hint={t("exam.report.ttdHint", { defaultValue: "committed cases" })}
            />
          </div>
        </Card>
      </motion.div>

      {/* Per-case breakdown */}
      <motion.div {...body} className="flex flex-col gap-2">
        <SectionLabel>
          {t("exam.report.perCase", { defaultValue: "Case-by-case" })}
        </SectionLabel>
        <TableWrap>
          <Table>
            <THead>
              <Tr>
                <Th>{t("exam.report.col.case", { defaultValue: "Case" })}</Th>
                <Th>{t("exam.report.col.diagnosis", { defaultValue: "Diagnosis" })}</Th>
                <Th numeric>{t("exam.report.col.redFlags", { defaultValue: "Red flags" })}</Th>
                <Th numeric>{t("exam.report.col.workup", { defaultValue: "Workup" })}</Th>
                <Th numeric>{t("exam.report.col.time", { defaultValue: "Time" })}</Th>
                <Th numeric>{t("exam.report.col.points", { defaultValue: "Points" })}</Th>
              </Tr>
            </THead>
            <TBody>
              {results.map((r) => {
                const w = r.workupAppropriateness;
                return (
                  <Tr key={r.index}>
                    <Td>
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-xs text-muted">{r.index + 1}</span>
                        <span className="min-w-0 truncate">{r.title[lang]}</span>
                        {r.timedOut ? (
                          <Badge tone="critical" className="shrink-0">
                            {t("exam.report.timedOut", { defaultValue: "Timed out" })}
                          </Badge>
                        ) : null}
                      </span>
                    </Td>
                    <Td>
                      <StatusDot
                        tone={VERDICT_TONE[r.dxVerdict]}
                        label={verdictLabel(r.dxVerdict)}
                      />
                    </Td>
                    <Td numeric>
                      {r.redFlagsCaught}/{r.redFlagsTotal}
                    </Td>
                    <Td numeric>
                      <span className="flex flex-col items-end">
                        <span>{pct(w.score)}</span>
                        {w.over > 0 || w.under > 0 ? (
                          <span className="text-[11px] font-normal text-muted">
                            {w.over > 0 ? `+${w.over} ` : ""}
                            {w.under > 0 ? `-${w.under}` : ""}
                          </span>
                        ) : null}
                      </span>
                    </Td>
                    <Td numeric>{formatClock(r.timeMs)}</Td>
                    <Td numeric>{r.points}</Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        </TableWrap>
        <p className="text-xs text-muted">
          {t("exam.report.savedNote", {
            defaultValue: "Saved to this device. {{n}} attempt(s) recorded.",
            n: attempts.length,
          })}
        </p>
      </motion.div>

      {/* Actions */}
      <motion.div {...body} className="flex flex-wrap items-center gap-3">
        <Button onClick={onRetake} leadingIcon={<ArrowClockwise weight="bold" />}>
          {t("exam.report.retake", { defaultValue: "Retake exam" })}
        </Button>
        <Button variant="secondary" asChild>
          <Link to="/">
            <House weight="bold" className="h-4 w-4" aria-hidden="true" />
            {t("exam.report.home", { defaultValue: "Back home" })}
          </Link>
        </Button>
      </motion.div>
    </div>
  );
}
