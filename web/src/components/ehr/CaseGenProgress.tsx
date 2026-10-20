import { useTranslation } from "react-i18next";
import { CheckCircle, CircleNotch, Warning, ArrowClockwise, Stack, X } from "@phosphor-icons/react";

import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";

/* -------------------------------------------------------------------------- */
/* Pipeline stages                                                             */
/* -------------------------------------------------------------------------- */

/** Human stages of the v2 generator graph (docs/architecture/15, section 4). */
export type GenStage = "sampling" | "authoring" | "judging" | "repairing" | "grounding" | "finalizing";

export const GEN_STAGES: readonly GenStage[] = [
  "sampling",
  "authoring",
  "judging",
  "repairing",
  "grounding",
  "finalizing",
];

/** Map a graph node name (SSE `node` event) to its human stage. */
export function stageForNode(node: string): GenStage | null {
  switch (node) {
    case "sample_condition":
      return "sampling";
    case "author":
      return "authoring";
    case "clinical_consistency":
    case "safety_dosing":
    case "pedagogy":
    case "aggregate":
      return "judging";
    case "repair":
      return "repairing";
    case "ground":
      return "grounding";
    case "finalize":
      return "finalizing";
    default:
      return null;
  }
}

export interface GenProgress {
  /** Stages that have reported at least one node event, in order of arrival. */
  done: GenStage[];
  /** The stage currently running (the latest node seen). */
  active: GenStage | null;
  /** Repairs seen so far (the council sent the draft back). */
  repairs: number;
  threadId: string | null;
}

export const EMPTY_PROGRESS: GenProgress = { done: [], active: null, repairs: 0, threadId: null };

/** Fold one node event into the progress record. Pure. */
export function advanceProgress(prev: GenProgress, node: string): GenProgress {
  const stage = stageForNode(node);
  if (!stage) return prev;
  const done = prev.active && prev.active !== stage && !prev.done.includes(prev.active) ? [...prev.done, prev.active] : prev.done;
  return {
    ...prev,
    done,
    active: stage,
    repairs: node === "repair" ? prev.repairs + 1 : prev.repairs,
  };
}

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

export interface GenFailure {
  /** Server error code (model_unreachable, model_output_invalid, timeout, network ...). */
  code: string;
  status?: number;
  detail?: string;
}

export interface CaseGenProgressProps {
  progress: GenProgress;
  /** Set when the run ended without a case; shows the two labelled choices. */
  failure?: GenFailure | null;
  busy: boolean;
  onRetry: () => void;
  onUseTemplate: () => void;
  onCancel?: () => void;
  className?: string;
}

/**
 * CaseGenProgress: the live view of a v2 generator run (sampling, authoring,
 * council judging, repairing, grounding, finalizing). When the gateway answers
 * 503 (model unreachable) or the stream fails, the real error is shown and the
 * learner chooses explicitly between the deterministic template (labelled as
 * not model generated) and a retry. Nothing is picked silently.
 */
export function CaseGenProgress({
  progress,
  failure = null,
  busy,
  onRetry,
  onUseTemplate,
  onCancel,
  className,
}: CaseGenProgressProps) {
  const { t } = useTranslation();
  const visibleStages = GEN_STAGES.filter((s) => s !== "repairing" || progress.repairs > 0 || progress.active === "repairing");

  return (
    <section
      role="status"
      aria-live="polite"
      aria-busy={busy}
      aria-label={t("live2.gen.title")}
      className={cn("rounded-card border border-border bg-surface p-4 shadow-soft", className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[1.0625rem] text-fg">
            {failure ? t("live2.gen.failedTitle") : t("live2.gen.title")}
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            {failure ? t("live2.gen.failedHint") : t("live2.gen.hint")}
          </p>
        </div>
        {busy && onCancel ? (
          <Button size="sm" variant="ghost" onClick={onCancel} leadingIcon={<X weight="bold" className="h-3.5 w-3.5" aria-hidden />}>
            {t("livegen.cancel")}
          </Button>
        ) : null}
      </div>

      <ol className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-6" aria-label={t("live2.gen.stagesLabel")}>
        {visibleStages.map((stage) => {
          const isDone = progress.done.includes(stage) || (!busy && !failure && progress.active != null);
          const isActive = busy && progress.active === stage;
          return (
            <li
              key={stage}
              className={cn(
                "flex items-center gap-2 rounded-control border px-2.5 py-2 text-xs",
                isActive
                  ? "border-brand bg-brand-tint text-fg"
                  : isDone
                    ? "border-border bg-bg-subtle text-fg"
                    : "border-dashed border-border text-muted",
              )}
              aria-current={isActive ? "step" : undefined}
            >
              {isActive ? (
                <CircleNotch weight="bold" className="h-3.5 w-3.5 shrink-0 motion-safe:animate-spin" aria-hidden />
              ) : isDone ? (
                <CheckCircle weight="fill" className="h-3.5 w-3.5 shrink-0 text-[color:var(--state-normal)]" aria-hidden />
              ) : (
                <span aria-hidden className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-border" />
              )}
              <span className="truncate">
                {t(`live2.gen.stage.${stage}`)}
                {stage === "repairing" && progress.repairs > 0 ? ` ×${progress.repairs}` : ""}
              </span>
            </li>
          );
        })}
      </ol>

      {failure ? (
        <div
          className="mt-3 rounded-control border p-3"
          style={{
            borderColor: "color-mix(in srgb, var(--state-caution) 45%, var(--border))",
            backgroundColor: "color-mix(in srgb, var(--state-caution) 8%, transparent)",
          }}
        >
          <p className="flex items-start gap-2 text-sm text-fg">
            <Warning weight="fill" className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--state-caution)]" aria-hidden />
            <span>
              <span className="font-medium">
                {t(`live2.gen.error.${failure.code}`, {
                  defaultValue: t("live2.gen.error.unknown", { code: failure.code }),
                })}
              </span>
              {failure.status ? <span className="ms-1 font-mono text-xs text-muted">HTTP {failure.status}</span> : null}
              {failure.detail ? <span className="mt-1 block text-xs text-muted">{failure.detail}</span> : null}
            </span>
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Button
              size="sm"
              onClick={onRetry}
              leadingIcon={<ArrowClockwise weight="bold" className="h-3.5 w-3.5" aria-hidden />}
            >
              {t("live2.gen.retry")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={onUseTemplate}
              className="h-auto min-h-8 whitespace-normal py-1.5 text-start"
              leadingIcon={<Stack weight="bold" className="h-3.5 w-3.5 shrink-0" aria-hidden />}
            >
              {t("live2.gen.useTemplate")}
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-muted">{t("live2.gen.templateHint")}</p>
        </div>
      ) : null}
    </section>
  );
}
