import { useTranslation } from "react-i18next";
import {
  Blueprint,
  Sparkle,
  ShieldCheck,
  ChartBar,
  RocketLaunch,
  Pulse,
  CheckCircle,
  DotsThreeCircle,
  Circle,
  ArrowRight,
  Robot,
  User,
  Gear,
  type Icon,
} from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import {
  pipelineStages,
  type PipelineStage,
  type StageState,
  type PipelineStageMeta,
} from "@/data/authoring";

const stageIcon: Record<PipelineStage, Icon> = {
  blueprint: Blueprint,
  draft: Sparkle,
  review: ShieldCheck,
  psychometric: ChartBar,
  publish: RocketLaunch,
  monitor: Pulse,
};

const stateIcon: Record<StageState, Icon> = {
  done: CheckCircle,
  active: DotsThreeCircle,
  pending: Circle,
};

const actorIcon: Record<PipelineStageMeta["actor"], Icon> = {
  ai: Robot,
  human: User,
  auto: Gear,
};

/**
 * PipelineRail — the six-stage authoring pipeline as a horizontal spine
 * (blueprint -> AI draft -> expert review & lock -> peer/psychometric ->
 * publish + version -> monitor). Each node carries an actor marker (AI drafts,
 * human authoritative, automated) so the "AI-drafts / human-authoritative"
 * contract is legible at a glance. State (done / active / pending) never relies
 * on colour alone: it carries an icon and a text label (WCAG 1.4.1).
 */
export function PipelineRail() {
  const { t } = useTranslation();

  return (
    <ol
      className="flex flex-col gap-2 md:flex-row md:items-stretch md:gap-0"
      aria-label={t("authoring.pipeline.aria")}
    >
      {pipelineStages.map((stage, i) => {
        const StageIcon = stageIcon[stage.key];
        const StateIcon = stateIcon[stage.state];
        const ActorIcon = actorIcon[stage.actor];
        const isActive = stage.state === "active";
        const isDone = stage.state === "done";
        const stateWord = t(`authoring.pipeline.state.${stage.state}`);

        return (
          <li key={stage.key} className="flex items-stretch md:flex-1">
            <div
              aria-current={isActive ? "step" : undefined}
              className={cn(
                "flex flex-1 flex-col gap-2 rounded-card border p-3.5",
                isActive
                  ? "border-brand bg-brand-tint"
                  : isDone
                    ? "border-border bg-surface"
                    : "border-dashed border-border bg-surface",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={cn(
                    "grid h-8 w-8 shrink-0 place-items-center rounded-control",
                    isActive
                      ? "bg-brand text-white"
                      : isDone
                        ? "bg-[color-mix(in_srgb,var(--state-normal)_14%,transparent)] text-[color:var(--state-normal)]"
                        : "bg-bg-subtle text-muted",
                  )}
                >
                  <StageIcon weight="bold" className="h-4 w-4" aria-hidden />
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
                  <ActorIcon weight="bold" className="h-3 w-3" aria-hidden />
                  {t(`authoring.pipeline.actor.${stage.actor}`)}
                </span>
              </div>
              <div>
                <p
                  className={cn(
                    "text-[11px] font-mono font-semibold",
                    isActive ? "text-brand" : "text-muted",
                  )}
                >
                  {String(i + 1).padStart(2, "0")}
                </p>
                <p className="text-sm font-semibold leading-snug text-fg">
                  {t(`authoring.pipeline.stage.${stage.key}.title`)}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {t(`authoring.pipeline.stage.${stage.key}.desc`)}
                </p>
              </div>
              <span
                className={cn(
                  "mt-auto inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                  isActive
                    ? "bg-brand text-white"
                    : isDone
                      ? "text-[color:var(--state-normal)] bg-[color-mix(in_srgb,var(--state-normal)_14%,transparent)]"
                      : "bg-bg-subtle text-muted",
                )}
              >
                <StateIcon
                  weight={stage.state === "pending" ? "regular" : "fill"}
                  className="h-3 w-3"
                  aria-hidden
                />
                {stateWord}
              </span>
            </div>
            {i < pipelineStages.length - 1 ? (
              <span
                className="hidden shrink-0 items-center px-1 text-border md:flex"
                aria-hidden
              >
                <ArrowRight weight="bold" className="h-4 w-4" />
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
