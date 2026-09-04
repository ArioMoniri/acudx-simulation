import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  MagnifyingGlass,
  Stethoscope,
  ClipboardText,
  ArrowsClockwise,
  FileText,
  CheckCircle,
  Circle,
  DotsThreeCircle,
  Export,
  WarningCircle,
  ArrowRight,
  ArrowLeft,
  ArrowCounterClockwise,
} from "@phosphor-icons/react";
import {
  Card,
  Badge,
  Button,
  SectionLabel,
  StatusDot,
  TableWrap,
  Table,
  THead,
  TBody,
  Tr,
  Th,
  Td,
} from "@/components/ui";
import { CitationPill } from "@/components";
import { cn } from "@/lib/cn";
import { useLang } from "@/lib/useLang";
import {
  remediationRecords,
  REMEDIATION_STAGES,
  type RemediationRecord,
  type RemediationStage,
  type RemediationStageStatus,
} from "@/data/institution";

const stageIcon: Record<RemediationStage, typeof MagnifyingGlass> = {
  detect: MagnifyingGlass,
  diagnose: Stethoscope,
  prescribe: ClipboardText,
  reassess: ArrowsClockwise,
  document: FileText,
};

const statusIcon: Record<RemediationStageStatus, typeof CheckCircle> = {
  done: CheckCircle,
  active: DotsThreeCircle,
  pending: Circle,
};

const STAGE_COUNT = REMEDIATION_STAGES.length;
const REASSESS_INDEX = REMEDIATION_STAGES.indexOf("reassess");

/**
 * The loop is modelled by a single `step` cursor (0..STAGE_COUNT): every stage
 * before it is done, the stage at it is in progress, and `step === STAGE_COUNT`
 * means the loop is closed. The baseline step is read back from the seed data.
 */
function baselineStep(record: RemediationRecord): number {
  return REMEDIATION_STAGES.filter((s) => record.status[s] === "done").length;
}

function statusForIndex(i: number, step: number): RemediationStageStatus {
  if (i < step) return "done";
  if (i === step && step < STAGE_COUNT) return "active";
  return "pending";
}

/** A five-step closed-loop tracker: detect -> diagnose -> prescribe -> re-assess -> document. */
function LoopTracker({ step }: { step: number }) {
  const { t } = useTranslation();
  return (
    <ol
      className="flex flex-wrap items-stretch gap-1.5"
      aria-label={t("institution.remediation.loopAria")}
    >
      {REMEDIATION_STAGES.map((stage, i) => {
        const status = statusForIndex(i, step);
        const StageIcon = stageIcon[stage];
        const StatusIcon = statusIcon[status];
        const statusWord = t(`institution.remediation.status.${status}`);
        return (
          <li key={stage} className="flex items-center gap-1.5">
            <span
              aria-current={status === "active" ? "step" : undefined}
              className={cn(
                "flex items-center gap-1.5 rounded-control border px-2 py-1 transition-colors",
                status === "done"
                  ? "border-transparent bg-[color-mix(in_srgb,var(--state-normal)_12%,transparent)] text-[color:var(--state-normal)]"
                  : status === "active"
                    ? "border-brand bg-brand-tint text-brand"
                    : "border-dashed border-border bg-surface text-muted",
              )}
            >
              <StageIcon
                weight="bold"
                className="h-3.5 w-3.5 shrink-0"
                aria-hidden
              />
              <span className="text-[11px] font-semibold">
                {t(`institution.remediation.stage.${stage}`)}
              </span>
              <StatusIcon
                weight={status === "pending" ? "regular" : "fill"}
                className="h-3.5 w-3.5 shrink-0"
                aria-hidden
              />
              <span className="sr-only">{statusWord}</span>
            </span>
            {i < STAGE_COUNT - 1 ? (
              <ArrowRight
                weight="bold"
                className="h-3 w-3 shrink-0 text-border"
                aria-hidden
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function RemediationCard({
  record,
  step,
  onAdvance,
  onBack,
  onReset,
}: {
  record: RemediationRecord;
  step: number;
  onAdvance: () => void;
  onBack: () => void;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  const lang = useLang();
  const closed = step === STAGE_COUNT;
  const base = baselineStep(record);
  const activeStage = step < STAGE_COUNT ? REMEDIATION_STAGES[step] : null;
  const activeStageWord = activeStage
    ? t(`institution.remediation.stage.${activeStage}`)
    : "";
  const reassessDone = step > REASSESS_INDEX;

  const liveText = closed
    ? t("institution.remediation.step.liveClosed", {
        learner: record.learnerHandle,
      })
    : t("institution.remediation.step.live", {
        learner: record.learnerHandle,
        stage: activeStageWord,
      });

  return (
    <li>
      <Card
        padding="md"
        className={cn(
          "flex flex-col gap-3.5",
          closed ? "" : "border-l-2 border-l-[color:var(--state-warning)]",
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span
              className="grid h-9 w-9 shrink-0 place-items-center rounded-control transition-colors"
              style={{
                backgroundColor: closed
                  ? "color-mix(in srgb, var(--state-normal) 14%, transparent)"
                  : "color-mix(in srgb, var(--state-warning) 16%, transparent)",
                color: closed ? "var(--state-normal)" : "var(--state-warning)",
              }}
              aria-hidden
            >
              {closed ? (
                <CheckCircle weight="fill" className="h-4.5 w-4.5" />
              ) : (
                <WarningCircle weight="fill" className="h-4.5 w-4.5" />
              )}
            </span>
            <div>
              <p className="font-mono text-sm font-semibold text-fg">
                {record.learnerHandle}
              </p>
              <p className="text-xs text-muted">
                {t(`institution.section.${record.sectionKey}`)}
                {" · "}
                {t("institution.remediation.opened", {
                  days: record.openedDaysAgo,
                })}
              </p>
            </div>
          </div>
          {closed ? (
            <Badge tone="normal">
              <CheckCircle weight="fill" className="h-3 w-3" aria-hidden />
              {t("institution.remediation.closed")}
            </Badge>
          ) : (
            <Badge tone="warning">
              <WarningCircle weight="fill" className="h-3 w-3" aria-hidden />
              {t("institution.remediation.open")}
            </Badge>
          )}
        </div>

        {/* Trigger — why they surfaced */}
        <p className="text-sm text-fg">{t(record.triggerKey)}</p>

        {/* The closed-loop tracker (reflects the live step cursor) */}
        <LoopTracker step={step} />

        {/* Step progress read-out + controls */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted">
            {closed
              ? t("institution.remediation.step.closedLabel")
              : t("institution.remediation.step.progress", {
                  current: step + 1,
                  total: STAGE_COUNT,
                  stage: activeStageWord,
                })}
          </span>
          <span className="flex-1" />
          <Button
            size="sm"
            variant="ghost"
            onClick={onBack}
            disabled={step === 0}
            leadingIcon={<ArrowLeft weight="bold" className="h-4 w-4" />}
            aria-label={t("institution.remediation.step.backAria", {
              learner: record.learnerHandle,
            })}
          >
            {t("institution.remediation.step.back")}
          </Button>
          {closed ? null : (
            <Button
              size="sm"
              variant="primary"
              onClick={onAdvance}
              trailingIcon={<ArrowRight weight="bold" className="h-4 w-4" />}
              aria-label={t("institution.remediation.step.advanceAria", {
                learner: record.learnerHandle,
                stage: activeStageWord,
              })}
            >
              {step === STAGE_COUNT - 1
                ? t("institution.remediation.step.close")
                : t("institution.remediation.step.markComplete", {
                    stage: activeStageWord,
                  })}
            </Button>
          )}
          {step !== base ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={onReset}
              leadingIcon={
                <ArrowCounterClockwise weight="bold" className="h-4 w-4" />
              }
            >
              {t("institution.remediation.step.reset")}
            </Button>
          ) : null}
        </div>

        {/* Diagnose — the gaps */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            {t("institution.remediation.diagnosedGaps")}
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {record.gaps.map((gap, i) => (
              <li
                key={i}
                className="flex items-start gap-2 rounded-control bg-bg-subtle px-2.5 py-1.5"
              >
                <span
                  className="mt-1.5 h-2 w-2 shrink-0 rotate-45"
                  style={{
                    backgroundColor:
                      gap.domain === "communication" ||
                      gap.domain === "professionalism"
                        ? "var(--axis-communication)"
                        : "var(--axis-clinical)",
                    borderRadius:
                      gap.domain === "communication" ||
                      gap.domain === "professionalism"
                        ? "9999px"
                        : "0",
                  }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 text-xs text-fg">
                  {gap.detail[lang]}
                </span>
                <span className="shrink-0 text-[11px] font-medium text-muted">
                  {t("institution.remediation.recurrence", {
                    count: gap.recurrence,
                  })}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Prescribe */}
        <div className="rounded-control border border-border bg-surface p-3">
          <div className="flex items-center gap-1.5">
            <ClipboardText
              weight="bold"
              className="h-3.5 w-3.5 text-brand"
              aria-hidden
            />
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              {t("institution.remediation.prescribed")}
            </p>
          </div>
          <p className="mt-1.5 text-sm text-fg">{record.prescription[lang]}</p>
          <div className="mt-2">
            <CitationPill citationId={record.citationId} lang={lang} />
          </div>
        </div>

        {/* Re-assess outcome (revealed once the re-assess stage is complete) */}
        {reassessDone ? (
          <div className="flex items-start gap-2 rounded-control bg-[color-mix(in_srgb,var(--state-normal)_10%,transparent)] p-3">
            <ArrowsClockwise
              weight="bold"
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--state-normal)]"
              aria-hidden
            />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--state-normal)]">
                {t("institution.remediation.reassessed")}
              </p>
              <p className="mt-1 text-sm text-fg">
                {record.reassessOutcome
                  ? record.reassessOutcome[lang]
                  : t("institution.remediation.step.reassessLogged")}
              </p>
            </div>
          </div>
        ) : null}

        {/* Export record + live announcement */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            leadingIcon={<Export weight="bold" className="h-4 w-4" />}
          >
            {t("institution.remediation.exportRecord")}
          </Button>
        </div>
        <p className="sr-only" role="status" aria-live="polite">
          {liveText}
        </p>
      </Card>
    </li>
  );
}

/** RemediationLoop — the at-risk closed-loop list, the renewal-driving money feature (IN-2). */
export function RemediationLoop() {
  const { t } = useTranslation();
  const [steps, setSteps] = useState<Record<string, number>>(() =>
    Object.fromEntries(remediationRecords.map((r) => [r.id, baselineStep(r)])),
  );

  const setStep = (id: string, next: number) =>
    setSteps((prev) => ({
      ...prev,
      [id]: Math.max(0, Math.min(STAGE_COUNT, next)),
    }));

  const closedCount = remediationRecords.filter(
    (r) => (steps[r.id] ?? baselineStep(r)) === STAGE_COUNT,
  ).length;
  const total = remediationRecords.length;

  return (
    <div className="flex flex-col gap-4">
      {/* At-a-glance queue — the dense triage view above the actionable records */}
      <div className="flex flex-col gap-2">
        <SectionLabel
          trailing={
            <span className="text-xs font-medium normal-case tracking-normal text-muted">
              {t("institution.remediation.step.summary", {
                closed: closedCount,
                total,
              })}
            </span>
          }
        >
          {t("institution.remediation.queue.caption")}
        </SectionLabel>
        <TableWrap>
          <Table>
            <caption className="sr-only">
              {t("institution.remediation.queue.tableCaption")}
            </caption>
            <THead>
              <Tr>
                <Th>{t("institution.heatmap.learnerCol")}</Th>
                <Th>{t("institution.heatmap.sectionCol")}</Th>
                <Th numeric>{t("institution.remediation.queue.openedCol")}</Th>
                <Th>{t("institution.remediation.queue.stageCol")}</Th>
                <Th>{t("institution.remediation.queue.statusCol")}</Th>
              </Tr>
            </THead>
            <TBody>
              {remediationRecords.map((r) => {
                const step = steps[r.id] ?? baselineStep(r);
                const closed = step === STAGE_COUNT;
                const stageWord = closed
                  ? t("institution.remediation.closed")
                  : t(`institution.remediation.stage.${REMEDIATION_STAGES[step]}`);
                return (
                  <Tr key={r.id}>
                    <Td className="font-mono font-medium text-fg">
                      {r.learnerHandle}
                    </Td>
                    <Td className="text-muted">
                      {t(`institution.section.${r.sectionKey}`)}
                    </Td>
                    <Td numeric>
                      {t("institution.remediation.queue.days", {
                        count: r.openedDaysAgo,
                      })}
                    </Td>
                    <Td>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="tnum text-xs text-subtle">
                          {closed
                            ? `${STAGE_COUNT}/${STAGE_COUNT}`
                            : `${step + 1}/${STAGE_COUNT}`}
                        </span>
                        <span className="text-fg">{stageWord}</span>
                      </span>
                    </Td>
                    <Td>
                      <StatusDot
                        tone={closed ? "normal" : "warning"}
                        size="sm"
                        label={
                          closed
                            ? t("institution.remediation.closed")
                            : t("institution.remediation.open")
                        }
                      />
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        </TableWrap>
      </div>

      <ul className="flex flex-col gap-3" aria-label="remediation">
        {remediationRecords.map((r) => {
          const step = steps[r.id] ?? baselineStep(r);
          return (
            <RemediationCard
              key={r.id}
              record={r}
              step={step}
              onAdvance={() => setStep(r.id, step + 1)}
              onBack={() => setStep(r.id, step - 1)}
              onReset={() => setStep(r.id, baselineStep(r))}
            />
          );
        })}
      </ul>
    </div>
  );
}
