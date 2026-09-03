import { useReducer, type Dispatch } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import {
  PencilRuler,
  Robot,
  User,
  Gear,
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
  ArrowClockwise,
  ArrowCounterClockwise,
  CaretLeft,
  CaretRight,
  LockSimple,
  LockSimpleOpen,
  PencilSimple,
  WarningCircle,
  ShieldWarning,
  Heartbeat,
  Stethoscope,
  Flask,
  Pill,
  ProhibitInset,
  Hash,
  GlobeHemisphereWest,
  Certificate,
  Signature,
  SealCheck,
  type Icon,
} from "@phosphor-icons/react";

import { PageContainer } from "@/components/shell";
import { SimBadge } from "@/components/ehr";
import { Card, Badge, Button } from "@/components/ui";
import { CitationPill } from "@/components";
import { BlueprintCard } from "@/components/authoring";
import { cn } from "@/lib/cn";
import { useLang, useEntry } from "@/lib/useLang";
import {
  pipelineStages,
  sampleBlueprint,
  lockedFacts,
  rubricItems,
  domainCoverage,
  peerReviewSignals,
  signOffClinician,
  versionHashes,
  publishedCases,
  makeInitialAuthoringState,
  authoringReducer,
  publishBlockers,
  factsClear,
  lockedCount,
  caseFingerprint,
  rubricFingerprint,
  isFactLocked,
  stageDisplayState,
  type AuthoringUIState,
  type AuthoringAction,
  type FactEditState,
  type PipelineStage,
  type PipelineStageMeta,
  type StageState,
  type FactKind,
  type LockedFact,
  type RubricItem,
  type PublishedCase,
  type ContentLocale,
} from "@/data/authoring";

/* -------------------------------------------------------------------------- */
/* Icon maps                                                                   */
/* -------------------------------------------------------------------------- */

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

const factIcon: Record<FactKind, Icon> = {
  persona: User,
  vitals: Heartbeat,
  finding: Stethoscope,
  result: Flask,
  medication: Pill,
  safety: ProhibitInset,
};

type Dispatcher = Dispatch<AuthoringAction>;

/* -------------------------------------------------------------------------- */
/* Pipeline stepper — the six-stage, steppable spine                           */
/* -------------------------------------------------------------------------- */

function PipelineStepper({
  state,
  dispatch,
}: {
  state: AuthoringUIState;
  dispatch: Dispatcher;
}) {
  const { t } = useTranslation();
  const clear = factsClear(state.facts);
  const atStart = state.stageIndex === 0;
  const atEnd = state.stageIndex === pipelineStages.length - 1;

  return (
    <div className="flex flex-col gap-3">
      <ol
        className="flex flex-col gap-2 md:flex-row md:items-stretch md:gap-0"
        aria-label={t("authoring2.stepper.aria")}
      >
        {pipelineStages.map((stage, i) => {
          const StageIcon = stageIcon[stage.key];
          const display = stageDisplayState(
            i,
            state.stageIndex,
            state.published,
          );
          const StateIcon = stateIcon[display];
          const ActorIcon = actorIcon[stage.actor];
          const isActive = i === state.stageIndex;
          const isDone = display === "done";
          const title = t(`authoring.pipeline.stage.${stage.key}.title`);
          const blocked =
            stage.key === "publish" && !state.published && !clear;

          return (
            <li key={stage.key} className="flex items-stretch md:flex-1">
              <button
                type="button"
                onClick={() => dispatch({ type: "setStage", index: i })}
                aria-current={isActive ? "step" : undefined}
                aria-label={`${t("authoring2.stepper.goTo", { title })}, ${t(
                  `authoring.pipeline.state.${display}`,
                )}`}
                className={cn(
                  "flex flex-1 flex-col gap-2 rounded-card border p-3.5 text-left",
                  "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                  isActive
                    ? "border-brand bg-brand-tint"
                    : isDone
                      ? "border-border bg-surface hover:bg-bg-subtle"
                      : "border-dashed border-border bg-surface hover:bg-bg-subtle",
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
                    {title}
                  </p>
                </div>
                <span
                  className={cn(
                    "mt-auto inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                    blocked
                      ? "text-[color:var(--state-warning)] bg-[color-mix(in_srgb,var(--state-warning)_16%,transparent)]"
                      : isActive
                        ? "bg-brand text-white"
                        : isDone
                          ? "text-[color:var(--state-normal)] bg-[color-mix(in_srgb,var(--state-normal)_14%,transparent)]"
                          : "bg-bg-subtle text-muted",
                  )}
                >
                  {blocked ? (
                    <WarningCircle
                      weight="fill"
                      className="h-3 w-3"
                      aria-hidden
                    />
                  ) : (
                    <StateIcon
                      weight={display === "pending" ? "regular" : "fill"}
                      className="h-3 w-3"
                      aria-hidden
                    />
                  )}
                  {blocked
                    ? t("authoring2.stepper.blocked")
                    : t(`authoring.pipeline.state.${display}`)}
                </span>
              </button>
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

      <div className="flex items-center justify-between gap-3">
        <Button
          variant="secondary"
          size="sm"
          disabled={atStart}
          onClick={() => dispatch({ type: "prev" })}
          leadingIcon={<CaretLeft weight="bold" className="h-4 w-4" />}
        >
          {t("authoring2.stepper.prev")}
        </Button>
        <p className="font-mono text-xs text-muted" aria-live="polite">
          {t("authoring2.stepper.stepOf", {
            current: state.stageIndex + 1,
            total: pipelineStages.length,
          })}
        </p>
        <Button
          variant="secondary"
          size="sm"
          disabled={atEnd}
          onClick={() => dispatch({ type: "next" })}
          trailingIcon={<CaretRight weight="bold" className="h-4 w-4" />}
        >
          {t("authoring2.stepper.next")}
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Stage heading                                                               */
/* -------------------------------------------------------------------------- */

function StageHeading({ stage }: { stage: PipelineStageMeta }) {
  const { t } = useTranslation();
  const StageIcon = stageIcon[stage.key];
  const ActorIcon = actorIcon[stage.actor];
  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-2">
        <StageIcon weight="bold" className="h-5 w-5 text-brand" aria-hidden />
        <h2 className="text-lg font-semibold tracking-tight text-fg">
          {t(`authoring.pipeline.stage.${stage.key}.title`)}
        </h2>
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
          <ActorIcon weight="bold" className="h-3 w-3" aria-hidden />
          {t(`authoring.pipeline.actor.${stage.actor}`)}
        </span>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        {t(`authoring.pipeline.stage.${stage.key}.desc`)}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Draft stage                                                                 */
/* -------------------------------------------------------------------------- */

function DraftPanel({
  state,
  dispatch,
}: {
  state: AuthoringUIState;
  dispatch: Dispatcher;
}) {
  const { t } = useTranslation();
  const total = lockedFacts.length;
  const pending = publishBlockers(state.facts).length;

  return (
    <Card padding="lg" className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <span
          className="grid h-10 w-10 shrink-0 place-items-center rounded-control bg-brand-tint text-brand"
          aria-hidden
        >
          <Sparkle weight="bold" className="h-5 w-5" />
        </span>
        <div>
          <h3 className="text-sm font-semibold tracking-tight text-fg">
            {t("authoring2.draft.heading")}
          </h3>
          <p className="mt-1 max-w-xl text-xs text-muted">
            {t("authoring2.draft.sub")}
          </p>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-control border border-border bg-bg-subtle p-3">
          <p className="font-mono text-lg font-semibold text-fg">{total}</p>
          <p className="text-xs text-muted">
            {t("authoring2.draft.factsDrafted", { count: total })}
          </p>
        </div>
        <div
          className={cn(
            "rounded-control border p-3",
            pending > 0
              ? "border-[color:var(--state-warning)] bg-[color-mix(in_srgb,var(--state-warning)_8%,transparent)]"
              : "border-[color:var(--state-normal)] bg-[color-mix(in_srgb,var(--state-normal)_8%,transparent)]",
          )}
        >
          <p className="font-mono text-lg font-semibold text-fg">{pending}</p>
          <p className="text-xs text-muted">
            {pending > 0
              ? t("authoring2.draft.needsReview", { count: pending })
              : t("authoring2.draft.allLocked")}
          </p>
        </div>
      </div>

      <p className="inline-flex items-start gap-2 text-xs text-muted">
        <Robot
          weight="bold"
          className="mt-0.5 h-3.5 w-3.5 shrink-0"
          aria-hidden
        />
        {t("authoring2.draft.tierNote")}
      </p>

      <div>
        <Button
          size="md"
          onClick={() => dispatch({ type: "next" })}
          trailingIcon={<ArrowRight weight="bold" className="h-4 w-4" />}
        >
          {t("authoring2.draft.toReview")}
        </Button>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Review stage — interactive locked-facts editor                             */
/* -------------------------------------------------------------------------- */

function StatusChip({ status }: { status: FactEditState["status"] }) {
  const { t } = useTranslation();
  if (status === "flagged") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold text-[color:var(--state-warning)] bg-[color-mix(in_srgb,var(--state-warning)_16%,transparent)]">
        <WarningCircle weight="fill" className="h-3 w-3" aria-hidden />
        {t("authoring.editor.status.flagged")}
      </span>
    );
  }
  if (status === "open") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] font-medium text-muted">
        <PencilSimple weight="bold" className="h-3 w-3" aria-hidden />
        {t("authoring.editor.status.open")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold text-[color:var(--state-normal)] bg-[color-mix(in_srgb,var(--state-normal)_14%,transparent)]">
      <LockSimple weight="fill" className="h-3 w-3" aria-hidden />
      {t(
        status === "edited-locked"
          ? "authoring.editor.status.editedLocked"
          : "authoring.editor.status.locked",
      )}
    </span>
  );
}

function FactCard({
  fact,
  edit,
  dispatch,
}: {
  fact: LockedFact;
  edit: FactEditState;
  dispatch: Dispatcher;
}) {
  const { t } = useTranslation();
  const lang = useLang();
  const FIcon = factIcon[fact.kind];
  const status = edit.status;
  const flagged = status === "flagged";
  const open = status === "open";
  const locked = isFactLocked(status);
  const kindLabel = t(`authoring.editor.kind.${fact.kind}`);

  return (
    <li>
      <div
        className={cn(
          "flex flex-col gap-2.5 rounded-control border bg-surface p-3",
          flagged
            ? "border-[color:var(--state-warning)] border-l-2"
            : locked
              ? "border-[color:var(--state-normal)] border-l-2"
              : "border-border",
        )}
      >
        <div className="flex items-start gap-2.5">
          <span
            className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-control bg-bg-subtle text-muted"
            aria-hidden
          >
            <FIcon weight="bold" className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
                {kindLabel}
              </span>
              {fact.safetyCritical ? (
                <Badge tone="warning">
                  <ShieldWarning weight="fill" className="h-3 w-3" aria-hidden />
                  {t("authoring.editor.safetyCritical")}
                </Badge>
              ) : null}
            </div>
            <p className="mt-1 text-sm leading-relaxed text-fg">
              {fact.claim[lang]}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pl-9">
          <CitationPill
            citationId={fact.citationId}
            lang={lang}
            section={fact.section}
          />
          <StatusChip status={status} />
          {edit.humanEdited ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted">
              <PencilSimple weight="bold" className="h-3 w-3" aria-hidden />
              {t("authoring.editor.humanEdited")}
            </span>
          ) : null}
        </div>

        {flagged ? (
          <p className="ml-9 rounded-control bg-[color-mix(in_srgb,var(--state-warning)_10%,transparent)] px-2.5 py-1.5 text-[11px] text-fg">
            {t("authoring2.editor.groundHint")}
          </p>
        ) : open ? (
          <p className="ml-9 text-[11px] text-muted">
            {t("authoring2.editor.openHint")}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 pl-9">
          {open ? (
            <>
              <Button
                size="sm"
                variant="secondary"
                aria-label={t("authoring2.editor.lockAria", {
                  kind: kindLabel,
                })}
                onClick={() => dispatch({ type: "lock", id: fact.id })}
                leadingIcon={<LockSimple weight="bold" className="h-4 w-4" />}
              >
                {t("authoring2.editor.lock")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={t("authoring2.editor.editLockAria", {
                  kind: kindLabel,
                })}
                onClick={() => dispatch({ type: "editLock", id: fact.id })}
                leadingIcon={<PencilSimple weight="bold" className="h-4 w-4" />}
              >
                {t("authoring2.editor.editLock")}
              </Button>
            </>
          ) : null}
          {flagged ? (
            <Button
              size="sm"
              variant="primary"
              aria-label={t("authoring2.editor.groundAria", {
                kind: kindLabel,
              })}
              onClick={() => dispatch({ type: "ground", id: fact.id })}
              leadingIcon={<ShieldCheck weight="bold" className="h-4 w-4" />}
            >
              {t("authoring2.editor.ground")}
            </Button>
          ) : null}
          {locked ? (
            <Button
              size="sm"
              variant="ghost"
              aria-label={t("authoring2.editor.unlockAria", {
                kind: kindLabel,
              })}
              onClick={() => dispatch({ type: "unlock", id: fact.id })}
              leadingIcon={
                <LockSimpleOpen weight="bold" className="h-4 w-4" />
              }
            >
              {t("authoring2.editor.unlock")}
            </Button>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function AxisMark({ axis }: { axis: "clinical" | "communication" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "h-2 w-2 shrink-0",
        axis === "clinical" ? "rotate-45" : "rounded-full",
      )}
      style={{
        backgroundColor:
          axis === "clinical"
            ? "var(--axis-clinical)"
            : "var(--axis-communication)",
      }}
    />
  );
}

function RubricRow({ item }: { item: RubricItem }) {
  const { t } = useTranslation();
  const lang = useLang();
  return (
    <li className="flex items-start gap-2.5 rounded-control border border-border bg-surface p-3">
      <span className="mt-1.5">
        <AxisMark axis={item.axis} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug text-fg">{item.behavior[lang]}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium text-muted">
            {t(`feedback.domains.${item.domain}`)}
          </span>
          <span className="text-border" aria-hidden>
            ·
          </span>
          <span className="font-mono text-[11px] text-muted">
            {t("authoring.editor.weight", { value: item.weight })}
          </span>
          {item.safetyCritical ? (
            <Badge tone="warning">
              <ShieldWarning weight="fill" className="h-3 w-3" aria-hidden />
              {t("authoring.editor.safetyCritical")}
            </Badge>
          ) : null}
          {!item.bilingualReady ? (
            <Badge tone="caution">
              <PencilSimple weight="bold" className="h-3 w-3" aria-hidden />
              {t("authoring.editor.trPending")}
            </Badge>
          ) : null}
        </div>
      </div>
      <CitationPill
        citationId={item.citationId}
        lang={lang}
        section={item.section}
      />
    </li>
  );
}

function CoverageStrip() {
  const { t } = useTranslation();
  return (
    <div className="rounded-control border border-border bg-bg-subtle p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
        {t("authoring.editor.coverage")}
      </p>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {domainCoverage.map((d) => (
          <li key={d.domain}>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] font-medium text-fg">
              <AxisMark axis={d.axis} />
              {t(`feedback.domains.${d.domain}`)}
              <span className="font-mono text-muted">{d.items}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-[color:var(--state-normal)]">
        <CheckCircle weight="fill" className="h-3 w-3" aria-hidden />
        {t("authoring.editor.coverageComplete")}
      </p>
    </div>
  );
}

function ReviewPanel({
  state,
  dispatch,
}: {
  state: AuthoringUIState;
  dispatch: Dispatcher;
}) {
  const { t } = useTranslation();
  const total = lockedFacts.length;
  const locked = lockedCount(state.facts);
  const blockers = publishBlockers(state.facts).length;
  const clear = blockers === 0;
  const liveHash = caseFingerprint(state.facts);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Left: interactive facts */}
        <Card padding="lg" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold tracking-tight text-fg">
              {t("authoring.editor.factsHeading")}
            </h3>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                clear
                  ? "text-[color:var(--state-normal)] bg-[color-mix(in_srgb,var(--state-normal)_14%,transparent)]"
                  : "text-[color:var(--state-warning)] bg-[color-mix(in_srgb,var(--state-warning)_16%,transparent)]",
              )}
            >
              {clear ? (
                <LockSimple weight="fill" className="h-3 w-3" aria-hidden />
              ) : (
                <WarningCircle weight="fill" className="h-3 w-3" aria-hidden />
              )}
              {t("authoring2.editor.progress", { locked, total })}
            </span>
          </div>
          <p className="text-xs text-muted">{t("authoring.editor.factsSub")}</p>
          <ul className="flex flex-col gap-2.5">
            {lockedFacts.map((f) => (
              <FactCard
                key={f.id}
                fact={f}
                edit={
                  state.facts[f.id] ?? {
                    status: f.status,
                    humanEdited: f.humanEdited,
                  }
                }
                dispatch={dispatch}
              />
            ))}
          </ul>
        </Card>

        {/* Right: rubric + coverage (read-only) */}
        <Card padding="lg" className="flex flex-col gap-3">
          <div>
            <h3 className="text-sm font-semibold tracking-tight text-fg">
              {t("authoring.editor.rubricHeading")}
            </h3>
            <p className="mt-1 text-xs text-muted">
              {t("authoring.editor.rubricSub")}
            </p>
          </div>
          <CoverageStrip />
          <ul className="flex flex-col gap-2.5">
            {rubricItems.map((item) => (
              <RubricRow key={item.id} item={item} />
            ))}
          </ul>
        </Card>
      </div>

      {/* Live fingerprint + progress + advance */}
      <Card padding="md" className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className="inline-flex items-center gap-1.5 rounded-control border border-border bg-bg-subtle px-2.5 py-1.5 font-mono text-xs font-semibold text-fg"
            aria-label={t("authoring2.editor.liveHash")}
          >
            <Hash weight="bold" className="h-3.5 w-3.5 text-muted" aria-hidden />
            {liveHash}
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              {t("authoring2.editor.liveHash")}
            </p>
            <p className="text-[11px] text-muted">
              {t("authoring2.editor.liveHashNote")}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <p
            role="status"
            className={cn(
              "text-[11px] font-medium",
              clear
                ? "text-[color:var(--state-normal)]"
                : "text-[color:var(--state-warning)]",
            )}
          >
            {clear
              ? t("authoring2.editor.ready")
              : t("authoring2.editor.stillBlocking", { count: blockers })}
          </p>
          <Button
            size="sm"
            variant={clear ? "primary" : "secondary"}
            onClick={() => dispatch({ type: "next" })}
            trailingIcon={<ArrowRight weight="bold" className="h-4 w-4" />}
          >
            {t("authoring2.editor.toPsychometric")}
          </Button>
        </div>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Psychometric stage                                                          */
/* -------------------------------------------------------------------------- */

function PsychometricPanel({ dispatch }: { dispatch: Dispatcher }) {
  const { t } = useTranslation();
  const lang = useLang();
  return (
    <Card padding="lg" className="flex flex-col gap-4">
      <div>
        <div className="flex items-center gap-1.5">
          <ChartBar weight="bold" className="h-4 w-4 text-brand" aria-hidden />
          <h3 className="text-sm font-semibold tracking-tight text-fg">
            {t("authoring.psychometric.heading")}
          </h3>
        </div>
        <p className="mt-1 max-w-xl text-xs text-muted">
          {t("authoring.psychometric.sub")}
        </p>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {peerReviewSignals.map((s) => (
          <li
            key={s.id}
            className="flex flex-col gap-1 rounded-control border border-border bg-bg-subtle p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted">
                {t(s.labelKey)}
              </span>
              <span
                className={cn(
                  s.ok
                    ? "text-[color:var(--state-normal)]"
                    : "text-[color:var(--state-warning)]",
                )}
                aria-hidden
              >
                {s.ok ? (
                  <CheckCircle weight="fill" className="h-4 w-4" />
                ) : (
                  <WarningCircle weight="fill" className="h-4 w-4" />
                )}
              </span>
            </div>
            <span className="font-mono text-lg font-semibold text-fg">
              {s.value}
            </span>
            <span className="text-[11px] leading-snug text-muted">
              {s.note[lang]}
            </span>
          </li>
        ))}
      </ul>
      <div>
        <Button
          size="md"
          onClick={() => dispatch({ type: "next" })}
          trailingIcon={<ArrowRight weight="bold" className="h-4 w-4" />}
        >
          {t("authoring2.psychometric.toSignoff")}
        </Button>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Publish stage — the credentialed clinician sign-off gate                    */
/* -------------------------------------------------------------------------- */

function LocaleStatus({ loc }: { loc: ContentLocale }) {
  const { t } = useTranslation();
  const reviewed = loc.status === "reviewed";
  return (
    <li className="flex items-center justify-between gap-2 rounded-control border border-border bg-surface px-3 py-2">
      <span className="inline-flex items-center gap-2">
        <span className="font-mono text-xs font-semibold uppercase text-fg">
          {loc.locale}
        </span>
        <span className="text-sm text-muted">
          {t(`authoring.signoff.locale.${loc.locale}`)}
        </span>
      </span>
      {reviewed ? (
        <Badge tone="normal">
          <CheckCircle weight="fill" className="h-3 w-3" aria-hidden />
          {t("authoring.signoff.localeReviewed", { name: loc.reviewer ?? "" })}
        </Badge>
      ) : (
        <Badge tone="caution">
          <WarningCircle weight="fill" className="h-3 w-3" aria-hidden />
          {t("authoring.signoff.localeInReview")}
        </Badge>
      )}
    </li>
  );
}

function SignOffPanel({
  state,
  dispatch,
}: {
  state: AuthoringUIState;
  dispatch: Dispatcher;
}) {
  const { t } = useTranslation();
  const lang = useLang();
  const blockers = publishBlockers(state.facts);
  const clear = blockers.length === 0;
  const canPublish = state.cosigned && clear;
  const caseHash = state.frozen?.caseHash ?? caseFingerprint(state.facts);
  const rubricHash = state.frozen?.rubricHash ?? rubricFingerprint();

  return (
    <Card padding="lg" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5">
            <SealCheck weight="bold" className="h-4 w-4 text-brand" aria-hidden />
            <h3 className="text-sm font-semibold tracking-tight text-fg">
              {t("authoring.signoff.heading")}
            </h3>
          </div>
          <p className="mt-1 max-w-xl text-xs text-muted">
            {t("authoring.signoff.sub")}
          </p>
        </div>
        {state.published ? (
          <Badge tone="normal">
            <RocketLaunch weight="fill" className="h-3 w-3" aria-hidden />
            {t("authoring.signoff.publishedBadge")}
          </Badge>
        ) : (
          <Badge tone="caution">
            <LockSimple weight="fill" className="h-3 w-3" aria-hidden />
            {t("authoring.signoff.gatedBadge")}
          </Badge>
        )}
      </div>

      {/* Per-locale review status */}
      <div>
        <div className="flex items-center gap-1.5">
          <GlobeHemisphereWest
            weight="bold"
            className="h-4 w-4 text-brand"
            aria-hidden
          />
          <h4 className="text-sm font-semibold tracking-tight text-fg">
            {t("authoring.signoff.localeHeading")}
          </h4>
        </div>
        <ul className="mt-2 flex flex-col gap-2">
          {sampleBlueprint.contentLocales.map((loc) => (
            <LocaleStatus key={loc.locale} loc={loc} />
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-muted">
          {t("authoring.signoff.localeNote")}
        </p>
      </div>

      {/* Live fact-lock read-out (reflects the review stage) */}
      <div
        className={cn(
          "flex items-start gap-2 rounded-control border p-3",
          clear
            ? "border-[color:var(--state-normal)] bg-[color-mix(in_srgb,var(--state-normal)_8%,transparent)]"
            : "border-[color:var(--state-warning)] bg-[color-mix(in_srgb,var(--state-warning)_10%,transparent)]",
        )}
      >
        <span
          className={cn(
            "mt-0.5 shrink-0",
            clear
              ? "text-[color:var(--state-normal)]"
              : "text-[color:var(--state-warning)]",
          )}
          aria-hidden
        >
          {clear ? (
            <LockSimple weight="fill" className="h-4 w-4" />
          ) : (
            <WarningCircle weight="fill" className="h-4 w-4" />
          )}
        </span>
        <p className="text-xs text-fg">
          {clear
            ? t("authoring.signoff.factsClear")
            : t("authoring.signoff.factsBlocked", { count: blockers.length })}
        </p>
      </div>

      {/* Version provenance (live, then frozen on publish) */}
      <div className="rounded-control border border-border bg-bg-subtle p-3">
        <div className="flex items-center gap-1.5">
          <Hash weight="bold" className="h-3.5 w-3.5 text-muted" aria-hidden />
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            {t("authoring.signoff.versionHeading")}
          </p>
        </div>
        <dl className="mt-2 grid gap-1.5 sm:grid-cols-2">
          <div className="flex items-center justify-between gap-2">
            <dt className="text-[11px] text-muted">
              {t("authoring.signoff.caseHash")}
            </dt>
            <dd className="font-mono text-xs font-semibold text-fg">
              {caseHash}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-[11px] text-muted">
              {t("authoring.signoff.rubricHash")}
            </dt>
            <dd className="font-mono text-xs font-semibold text-fg">
              {rubricHash}
            </dd>
          </div>
        </dl>
        <p className="mt-2 text-[11px] text-muted">
          {state.published
            ? t("authoring2.signoff.frozenNote")
            : t("authoring2.signoff.liveHashNote")}
        </p>
        <p className="mt-1 text-[11px] text-muted">
          {t("authoring.signoff.guidelineSet")}: {versionHashes.guidelineSet}
        </p>
      </div>

      {/* Credentialed clinician co-sign */}
      <div className="rounded-control border border-border bg-surface p-4">
        <div className="flex items-start gap-3">
          <span
            className="grid h-10 w-10 shrink-0 place-items-center rounded-control bg-brand-tint text-brand"
            aria-hidden
          >
            <Certificate weight="bold" className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-fg">
              {signOffClinician.name}
            </p>
            <p className="text-xs text-muted">
              {signOffClinician.credential[lang]}
            </p>
            <p className="mt-0.5 font-mono text-[11px] text-muted">
              {signOffClinician.registration}
              {" · "}
              {signOffClinician.role[lang]}
            </p>
          </div>
        </div>

        {!state.published ? (
          <label
            className={cn(
              "mt-4 flex items-start gap-3 rounded-control border p-3 cursor-pointer transition-colors",
              state.cosigned
                ? "border-brand bg-brand-tint"
                : "border-border bg-bg-subtle hover:bg-surface",
            )}
          >
            <input
              type="checkbox"
              checked={state.cosigned}
              onChange={(e) =>
                dispatch({ type: "cosign", value: e.target.checked })
              }
              className="mt-0.5 h-5 w-5 shrink-0 accent-[color:var(--brand-600)]"
            />
            <span className="flex items-center gap-1.5 text-sm text-fg">
              <Signature
                weight="bold"
                className="h-4 w-4 shrink-0 text-brand"
                aria-hidden
              />
              {t("authoring.signoff.cosignLabel")}
            </span>
          </label>
        ) : (
          <div className="mt-4 flex items-center gap-2 rounded-control border border-[color:var(--state-normal)] bg-[color-mix(in_srgb,var(--state-normal)_8%,transparent)] p-3">
            <SealCheck
              weight="fill"
              className="h-5 w-5 shrink-0 text-[color:var(--state-normal)]"
              aria-hidden
            />
            <p className="text-sm text-fg">
              {t("authoring.signoff.signedConfirmation", {
                name: signOffClinician.name,
              })}
            </p>
          </div>
        )}
      </div>

      {/* Provenance citations */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
          {t("authoring.signoff.groundedOn")}
        </span>
        <CitationPill citationId="esc-acs-2023" lang={lang} />
        <CitationPill citationId="nice-ng185" lang={lang} />
        <CitationPill citationId="tepdad-em" lang={lang} />
      </div>

      {/* Publish action — hard-gated */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-md text-xs text-muted">
          {t("authoring.signoff.modelProvenance")}
        </p>
        {state.published ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="md"
              onClick={() => dispatch({ type: "unpublish" })}
              leadingIcon={
                <ArrowCounterClockwise weight="bold" className="h-4 w-4" />
              }
            >
              {t("authoring.signoff.unpublish")}
            </Button>
            <Button
              size="md"
              onClick={() =>
                dispatch({
                  type: "setStage",
                  index: pipelineStages.findIndex((s) => s.key === "monitor"),
                })
              }
              trailingIcon={<ArrowRight weight="bold" className="h-4 w-4" />}
            >
              {t("authoring2.signoff.toMonitor")}
            </Button>
          </div>
        ) : (
          <Button
            size="md"
            disabled={!canPublish}
            onClick={() => dispatch({ type: "publish" })}
            leadingIcon={<RocketLaunch weight="fill" className="h-4 w-4" />}
          >
            {t("authoring.signoff.publish")}
          </Button>
        )}
      </div>
      {!canPublish && !state.published ? (
        <p role="status" className="text-[11px] text-[color:var(--state-warning)]">
          {!clear
            ? t("authoring.signoff.blockedByFacts")
            : t("authoring.signoff.blockedByCosign")}
        </p>
      ) : null}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Monitor stage                                                               */
/* -------------------------------------------------------------------------- */

function MonitorCard({
  pub,
  isNew = false,
}: {
  pub: PublishedCase;
  isNew?: boolean;
}) {
  const { t } = useTranslation();
  const lang = useLang();
  const flagged = pub.status === "flagged";

  return (
    <li>
      <Card
        padding="md"
        className={cn(
          "flex flex-col gap-3",
          isNew
            ? "border-l-2 border-l-brand"
            : flagged
              ? "border-l-2 border-l-[color:var(--state-warning)]"
              : "",
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-fg">{pub.title[lang]}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted">
              <span className="inline-flex items-center gap-1 font-mono">
                <Hash weight="bold" className="h-3 w-3" aria-hidden />
                {pub.versionHash}
              </span>
              <span aria-hidden>·</span>
              <span>
                {isNew
                  ? t("authoring2.monitor.justPublished")
                  : t("authoring.monitor.lastReviewed", {
                      date: pub.lastReviewed,
                    })}
              </span>
              <span aria-hidden>·</span>
              <span>
                {t("authoring.monitor.encounters", { count: pub.encounters })}
              </span>
            </div>
          </div>
          {isNew ? (
            <Badge tone="brand">
              <Sparkle weight="fill" className="h-3 w-3" aria-hidden />
              {t("authoring2.monitor.newBadge")}
            </Badge>
          ) : flagged ? (
            <Badge tone="caution">
              <WarningCircle weight="fill" className="h-3 w-3" aria-hidden />
              {t("authoring.monitor.status.flagged")}
            </Badge>
          ) : pub.status === "en-only" ? (
            <Badge tone="neutral">{t("authoring.monitor.status.enOnly")}</Badge>
          ) : (
            <Badge tone="normal">
              <CheckCircle weight="fill" className="h-3 w-3" aria-hidden />
              {t("authoring.monitor.status.live")}
            </Badge>
          )}
        </div>

        <ul className="flex flex-wrap gap-1.5">
          {pub.locales.map((l) => (
            <li key={l.locale}>
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                  l.offered
                    ? "border-transparent text-[color:var(--state-normal)] bg-[color-mix(in_srgb,var(--state-normal)_12%,transparent)]"
                    : "border-dashed border-border text-muted",
                )}
              >
                {l.offered ? (
                  <CheckCircle weight="fill" className="h-3 w-3" aria-hidden />
                ) : (
                  <WarningCircle weight="bold" className="h-3 w-3" aria-hidden />
                )}
                {l.locale.toUpperCase()}
                {" · "}
                {t(
                  l.offered
                    ? "authoring.monitor.localeOffered"
                    : "authoring.monitor.localePending",
                )}
              </span>
            </li>
          ))}
        </ul>

        {flagged && pub.flagReason ? (
          <div className="flex items-start gap-2 rounded-control bg-[color-mix(in_srgb,var(--state-warning)_10%,transparent)] p-2.5">
            <ArrowClockwise
              weight="bold"
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--state-warning)]"
              aria-hidden
            />
            <p className="text-xs text-fg">{pub.flagReason[lang]}</p>
          </div>
        ) : null}

        <div>
          <Button
            size="sm"
            variant={flagged ? "primary" : "secondary"}
            trailingIcon={<ArrowRight weight="bold" className="h-4 w-4" />}
          >
            {flagged
              ? t("authoring.monitor.review")
              : t("authoring.monitor.open")}
          </Button>
        </div>
      </Card>
    </li>
  );
}

function MonitorPanel({ state }: { state: AuthoringUIState }) {
  const justPublished: PublishedCase | null =
    state.published && state.frozen
      ? {
          id: "pub-session",
          title: sampleBlueprint.title,
          versionHash: state.frozen.caseHash,
          lastReviewed: "",
          locales: [
            { locale: "en", offered: true },
            { locale: "tr", offered: false },
          ],
          status: "en-only",
          flagReason: null,
          encounters: 0,
        }
      : null;

  return (
    <ul className="grid gap-3 lg:grid-cols-3">
      {justPublished ? <MonitorCard pub={justPublished} isNew /> : null}
      {publishedCases.map((p) => (
        <MonitorCard key={p.id} pub={p} />
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* Active-stage router                                                         */
/* -------------------------------------------------------------------------- */

function StagePanel({
  stageKey,
  state,
  dispatch,
}: {
  stageKey: PipelineStage;
  state: AuthoringUIState;
  dispatch: Dispatcher;
}) {
  switch (stageKey) {
    case "blueprint":
      return <BlueprintCard />;
    case "draft":
      return <DraftPanel state={state} dispatch={dispatch} />;
    case "review":
      return <ReviewPanel state={state} dispatch={dispatch} />;
    case "psychometric":
      return <PsychometricPanel dispatch={dispatch} />;
    case "publish":
      return <SignOffPanel state={state} dispatch={dispatch} />;
    case "monitor":
      return <MonitorPanel state={state} />;
    default:
      return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * AuthoringPage — the educator case-authoring surface (Journey 7, AU-1/AU-2)
 * as a live, steppable pipeline.
 *
 * The six-stage AI-drafts / human-authoritative pipeline is a real stepper: the
 * rail drives a single working panel. Blueprint and AI draft are read-only
 * context; the expert-review stage is the interactive core, where each
 * AI-drafted fact must be grounded and LOCKED before it can reach a learner and
 * an ungrounded (flagged) fact hard-blocks publish. A live case fingerprint
 * recomputes as facts change and freezes at sign-off. The publish stage is the
 * credentialed-clinician SIGN-OFF gate: publish stays disabled until every fact
 * is locked AND the clinician co-signs, enforced in the reducer, not in copy.
 * On publish the case + rubric freeze with version hashes and appear in the
 * monitor stage. Everything is SIM / synthetic and education only.
 */
export function AuthoringPage() {
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(
    authoringReducer,
    undefined,
    makeInitialAuthoringState,
  );
  const header = useEntry();
  const wizard = useEntry(0.06);
  const panelReveal = useEntry(0.04);
  const currentStage = pipelineStages[state.stageIndex];

  return (
    <PageContainer width="wide" className="flex flex-col gap-8">
      {/* Header */}
      <motion.header {...header} className="max-w-3xl">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
            <PencilRuler weight="bold" className="h-3.5 w-3.5" aria-hidden />
            {t("authoring.eyebrow")}
          </span>
          <SimBadge variant="chip" />
        </div>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
          {t("authoring.title")}
        </h1>
        <p className="mt-3 max-w-2xl text-lg text-muted">
          {t("authoring.subtitle")}
        </p>
        <p className="mt-3 inline-flex items-center gap-2 text-xs text-muted">
          <Robot weight="bold" className="h-3.5 w-3.5" aria-hidden />
          {t("authoring.aiHumanNote")}
        </p>
      </motion.header>

      {/* Steppable pipeline + working panel */}
      <motion.section
        {...wizard}
        aria-labelledby="authoring-pipeline"
        className="flex flex-col gap-6"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p id="authoring-pipeline" className="max-w-2xl text-sm text-muted">
            {t("authoring2.intro")}
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => dispatch({ type: "reset" })}
            leadingIcon={
              <ArrowCounterClockwise weight="bold" className="h-4 w-4" />
            }
          >
            {t("authoring2.reset")}
          </Button>
        </div>

        <PipelineStepper state={state} dispatch={dispatch} />

        <motion.div key={currentStage.key} {...panelReveal}>
          <StageHeading stage={currentStage} />
          <StagePanel
            stageKey={currentStage.key}
            state={state}
            dispatch={dispatch}
          />
        </motion.div>
      </motion.section>

      <p className="text-xs text-muted">{t("authoring.eduNote")}</p>
    </PageContainer>
  );
}
