import { useCallback, useMemo, useReducer, useState, type Dispatch } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import {
  PencilRuler,
  Cpu,
  User,
  Gear,
  Blueprint,
  FileText,
  ShieldCheck,
  ChartBar,
  RocketLaunch,
  Pulse,
  CheckCircle,
  ArrowRight,
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
  PencilLine,
  Eye,
  Trash,
  X,
  FolderOpen,
  SignIn,
  type Icon,
} from "@phosphor-icons/react";

import { PageContainer, PageHeader } from "@/components/shell";
import { SimBadge } from "@/components/ehr";
import {
  Card,
  Badge,
  Button,
  SectionLabel,
  StatusDot,
  Stat,
  DescriptionList,
  KeyValue,
  TableWrap,
  Table,
  THead,
  TBody,
  Tr,
  Th,
  Td,
  Field,
  Select,
  type StatusTone,
} from "@/components/ui";
import { CitationPill } from "@/components";
import { cn } from "@/lib/cn";
import { useLang, useEntry } from "@/lib/useLang";
import { useProfile } from "@/state/profileStore";
import { useProgressRecords } from "@/state/progressStore";
import { CHIEF_COMPLAINT_FAMILIES, type ChiefComplaintFamily } from "@/domain/caseGen";
import { complaintFamilyOf } from "@/data/caseLibrary";
import { generateCaseV2, v2SpecToCaseInstance } from "@/lib/caseGenV2";
import {
  pipelineStages,
  makeInitialAuthoringState,
  authoringReducer,
  publishBlockers,
  factsClear,
  lockedCount,
  caseFingerprint,
  rubricFingerprint,
  isFactLocked,
  stageDisplayState,
  reviewerFromProfile,
  isCredentialedRole,
  readinessSignals,
  publishCase,
  removePublishedCase,
  usePublishedCases,
  DIFFICULTY_BANDS,
  type AuthoringUIState,
  type AuthoringAction,
  type FactEditState,
  type DraftBundle,
  type ReviewerIdentity,
  type PipelineStage,
  type PipelineStageMeta,
  type StageState,
  type FactKind,
  type LockedFact,
  type RubricItem,
  type PublishedCase,
} from "@/data/authoring";

/* -------------------------------------------------------------------------- */
/* Icon maps                                                                   */
/* -------------------------------------------------------------------------- */

const stageIcon: Record<PipelineStage, Icon> = {
  blueprint: Blueprint,
  draft: FileText,
  review: ShieldCheck,
  psychometric: ChartBar,
  publish: RocketLaunch,
  monitor: Pulse,
};

const stateTone: Record<StageState, StatusTone> = {
  done: "normal",
  active: "brand",
  pending: "neutral",
};

const actorIcon: Record<PipelineStageMeta["actor"], Icon> = {
  ai: Cpu,
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
  const clear = state.draft ? factsClear(state.draft.facts, state.edits) : false;
  const atStart = state.stageIndex === 0;
  const atEnd = state.stageIndex === pipelineStages.length - 1;

  return (
    <div className="flex flex-col gap-3">
      {/* A ruled step table instead of six look-alike cards: hairline cells that
          reflow 2, 3 then 6 across (never a horizontal scroll), a 2 px rule on
          top that turns cobalt once a stage is reached, the number in mono, the
          title, then who acts and the state as plain text. */}
      <ol
        className="grid grid-cols-2 gap-px overflow-hidden border border-border bg-border sm:grid-cols-3 xl:grid-cols-6"
        aria-label={t("authoring2.stepper.aria")}
      >
        {pipelineStages.map((stage, i) => {
          const StageIcon = stageIcon[stage.key];
          const display = stageDisplayState(i, state.stageIndex, state.published);
          const ActorIcon = actorIcon[stage.actor];
          const isActive = i === state.stageIndex;
          const isDone = display === "done";
          const title = t(`authoring.pipeline.stage.${stage.key}.title`);
          const blocked =
            stage.key === "publish" && !state.published && !!state.draft && !clear;

          return (
            <li key={stage.key} className="flex min-w-0">
              <button
                type="button"
                onClick={() => dispatch({ type: "setStage", index: i })}
                aria-current={isActive ? "step" : undefined}
                className={cn(
                  "relative flex min-w-0 flex-1 flex-col gap-1.5 px-3 pb-2.5 pt-3 text-start",
                  "before:absolute before:inset-x-0 before:top-0 before:h-0.5",
                  "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand",
                  isActive
                    ? "bg-brand-tint before:bg-brand"
                    : isDone
                      ? "bg-surface before:bg-brand hover:bg-bg-subtle"
                      : "bg-surface before:bg-transparent hover:bg-bg-subtle",
                )}
              >
                {/* The action + state lead the accessible name ("Go to the X
                    stage, Complete, ..."); the visible content follows so the
                    name contains the visible text (axe label-content-name). */}
                <span className="sr-only">
                  {t("authoring2.stepper.goTo", { title })}, {t(`authoring.pipeline.state.${display}`)},{" "}
                </span>
                <span className="flex items-baseline gap-2">
                  <span
                    className={cn(
                      "tnum font-mono text-[11px] font-semibold",
                      isActive ? "text-brand" : "text-subtle",
                    )}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <StageIcon
                    weight="bold"
                    className={cn("h-3.5 w-3.5 shrink-0 self-center", isActive ? "text-brand" : "text-subtle")}
                    aria-hidden
                  />
                </span>
                <span className="text-sm font-semibold leading-snug text-fg">{title}</span>
                <span className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
                  <span className="inline-flex items-center gap-1">
                    <ActorIcon weight="bold" className="h-3 w-3" aria-hidden />
                    {t(`authoring.pipeline.actor.${stage.actor}`)}
                  </span>
                  {blocked ? (
                    <span className="inline-flex items-center gap-1 font-medium text-[color:var(--state-warning)]">
                      <WarningCircle weight="fill" className="h-3 w-3" aria-hidden />
                      {t("authoring2.stepper.blocked")}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 font-medium">
                      <StatusDot tone={stateTone[display]} size="sm" aria-hidden="true" />
                      {t(`authoring.pipeline.state.${display}`)}
                    </span>
                  )}
                </span>
              </button>
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
    <div className="mb-4 flex flex-col gap-1.5">
      <SectionLabel icon={<ActorIcon weight="bold" className="h-3.5 w-3.5" aria-hidden />}>
        {t(`authoring.pipeline.actor.${stage.actor}`)}
      </SectionLabel>
      <div className="flex items-center gap-2">
        <StageIcon weight="bold" className="h-5 w-5 text-brand" aria-hidden />
        <h2 className="text-xl text-fg">
          {t(`authoring.pipeline.stage.${stage.key}.title`)}
        </h2>
      </div>
      <p className="max-w-2xl text-sm text-muted">
        {t(`authoring.pipeline.stage.${stage.key}.desc`)}
      </p>
    </div>
  );
}

/** Shared "generate a blueprint first" empty state for the downstream stages. */
function NeedsDraft({ dispatch }: { dispatch: Dispatcher }) {
  const { t } = useTranslation();
  return (
    <Card padding="lg" className="flex flex-col items-start gap-3">
      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center text-muted" aria-hidden>
        <Blueprint weight="bold" className="h-5 w-5" />
      </span>
      <div>
        <h3 className="text-sm font-semibold tracking-tight text-fg">
          {t("authoringP9.needsDraft.heading", { defaultValue: "No draft yet" })}
        </h3>
        <p className="mt-1 max-w-md text-xs text-muted">
          {t("authoringP9.needsDraft.sub", {
            defaultValue:
              "Generate a case blueprint first — the review, sign-off, and monitor stages all reflect that draft.",
          })}
        </p>
      </div>
      <Button
        size="sm"
        onClick={() => dispatch({ type: "setStage", index: 0 })}
        leadingIcon={<Blueprint weight="bold" className="h-4 w-4" />}
      >
        {t("authoringP9.needsDraft.cta", { defaultValue: "Go to the blueprint stage" })}
      </Button>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Blueprint stage — the REAL generator prompt + generated summary             */
/* -------------------------------------------------------------------------- */

function BlueprintPanel({
  state,
  dispatch,
}: {
  state: AuthoringUIState;
  dispatch: Dispatcher;
}) {
  const { t } = useTranslation();
  const lang = useLang();
  const [family, setFamily] = useState<ChiefComplaintFamily | "">("");
  const [difficulty, setDifficulty] = useState<1 | 2 | 3 | 4 | 5>(3);
  const [genBusy, setGenBusy] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  // Faculty content is a BLUEPRINT (presentation, difficulty, objectives) that goes
  // through the same model pipeline as every learner case; the draft is the model's
  // case for faculty review, never a fixed case served to learners (review 06a P16).
  const generate = useCallback(() => {
    const fam = family === "" ? null : family;
    setGenBusy(true);
    setGenError(null);
    void generateCaseV2({
      locale: lang,
      difficulty,
      purpose: "authoring",
      learner_id: null,
      ...(fam ? { complaint: fam } : {}),
      blueprint: { difficulty, objectives: [] },
    }).then((res) => {
      setGenBusy(false);
      if (!res.ok) {
        setGenError(res.error);
        return;
      }
      const caseInstance = v2SpecToCaseInstance(res.data.spec).case;
      dispatch({ type: "generate", caseInstance, family: fam });
    });
  }, [family, difficulty, lang, dispatch]);

  const draft = state.draft;

  return (
    <div className="flex flex-col gap-4">
      {/* Generator prompt */}
      <Card padding="lg" className="flex flex-col gap-4">
        <div>
          <div className="flex items-center gap-1.5">
            <PencilLine weight="bold" className="h-4 w-4 text-brand" aria-hidden />
            <h3 className="text-sm font-semibold tracking-tight text-fg">
              {t("authoringP9.blueprint.heading", { defaultValue: "Generate a case blueprint" })}
            </h3>
          </div>
          <p className="mt-1 max-w-xl text-xs text-muted">
            {t("authoringP9.blueprint.sub", {
              defaultValue:
                "Pick a presentation family or specialty and a difficulty. The model drafts the facts and rubric for a fresh, synthetic case; you stay authoritative from here.",
            })}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("authoringP9.blueprint.familyLabel", { defaultValue: "Presentation family or specialty" })}>
            {(aria) => (
              <Select
                {...aria}
                value={family}
                onChange={(e) => setFamily(e.target.value as ChiefComplaintFamily | "")}
              >
                <option value="">
                  {t("authoringP9.blueprint.familyAny", { defaultValue: "Any — surprise me" })}
                </option>
                {CHIEF_COMPLAINT_FAMILIES.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label[lang]}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label={t("authoringP9.blueprint.difficultyLabel", { defaultValue: "Difficulty" })}>
            {(aria) => (
              <Select
                {...aria}
                value={String(difficulty)}
                onChange={(e) =>
                  setDifficulty(Number(e.target.value) as 1 | 2 | 3 | 4 | 5)
                }
              >
                {([1, 2, 3, 4, 5] as const).map((d) => (
                  <option key={d} value={String(d)}>
                    {d} · {DIFFICULTY_BANDS[d][lang]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="md"
            onClick={generate}
            disabled={genBusy}
            aria-busy={genBusy}
            leadingIcon={<PencilLine weight="bold" className="h-4 w-4" />}
          >
            {draft
              ? t("authoringP9.blueprint.regenerate", { defaultValue: "Generate another draft" })
              : t("authoringP9.blueprint.generate", { defaultValue: "Generate draft" })}
          </Button>
          {genError ? (
            <p role="alert" className="text-xs text-[color:var(--state-caution)]">
              {t(`live2.gen.error.${genError}`, { defaultValue: t("live2.gen.error.unknown", { code: genError }) })}
            </p>
          ) : null}
          <p className="inline-flex items-center gap-1.5 text-[11px] text-muted">
            <Cpu weight="bold" className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {t("authoring2.draft.tierNote")}
          </p>
        </div>
      </Card>

      {/* Generated blueprint summary */}
      {draft ? (
        <Card padding="lg" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-base font-semibold tracking-tight text-fg">
                {draft.blueprint.title[lang]}
              </h3>
              <p className="mt-0.5 text-xs text-muted">{draft.blueprint.chiefComplaint[lang]}</p>
            </div>
            <Badge tone="brand" variant="outline" icon={<FileText weight="fill" className="h-3 w-3" aria-hidden />}>
              {t("authoringP9.blueprint.draftBadge", { defaultValue: "Draft generated" })}
            </Badge>
          </div>

          <DescriptionList divided>
            <KeyValue
              label={t("authoringP9.blueprint.diagnosis", { defaultValue: "Working diagnosis" })}
              value={draft.blueprint.diagnosis[lang]}
            />
            {draft.blueprint.codeLabel ? (
              <KeyValue
                label={t("authoringP9.blueprint.code", { defaultValue: "Diagnosis code" })}
                value={draft.blueprint.codeLabel}
                mono
              />
            ) : null}
            <KeyValue
              label={t("authoringP9.blueprint.family", { defaultValue: "Presentation / specialty" })}
              value={draft.blueprint.familyLabel[lang]}
            />
            <KeyValue
              label={t("authoring.blueprint.difficulty")}
              value={`${draft.blueprint.difficulty} · ${draft.blueprint.difficultyBand[lang]}`}
            />
          </DescriptionList>

          {/* Learning objectives */}
          <div>
            <p className="eyebrow">
              {t("authoring.blueprint.objectives")}
            </p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {draft.blueprint.objectives.map((o, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-fg">
                  <CheckCircle weight="bold" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />
                  {o[lang]}
                </li>
              ))}
            </ul>
          </div>

          {/* Red flags */}
          {draft.blueprint.redFlags.length > 0 ? (
            <div>
              <p className="eyebrow">
                {t("authoringP9.blueprint.redFlags", { defaultValue: "Can't-miss red flags" })}
              </p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {draft.blueprint.redFlags.map((rf, i) => (
                  <li key={i}>
                    <Badge tone="warning">
                      <ShieldWarning weight="fill" className="h-3 w-3" aria-hidden />
                      {rf[lang]}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

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
      ) : null}
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
  if (!state.draft) return <NeedsDraft dispatch={dispatch} />;
  const total = state.draft.facts.length;
  const pending = publishBlockers(state.draft.facts, state.edits).length;

  return (
    <Card padding="lg" className="flex flex-col gap-5">
      <div>
        <h3 className="text-sm font-semibold tracking-tight text-fg">
          {t("authoring2.draft.heading")}
        </h3>
        <p className="mt-1 max-w-xl text-xs text-muted">{t("authoring2.draft.sub")}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card variant="inset" padding="sm">
          <Stat
            label={t("authoring3.draft.factsLabel")}
            value={total}
            size="lg"
            icon={<FileText weight="bold" className="h-3.5 w-3.5" aria-hidden />}
            hint={t("authoring2.draft.factsDrafted", { count: total })}
          />
        </Card>
        <Card variant="inset" padding="sm">
          <Stat
            label={t("authoring3.draft.reviewLabel")}
            value={pending}
            size="lg"
            hint={
              <span className="inline-flex items-center gap-1.5">
                <StatusDot tone={pending > 0 ? "warning" : "normal"} size="sm" aria-hidden="true" />
                {pending > 0
                  ? t("authoring2.draft.needsReview", { count: pending })
                  : t("authoring2.draft.allLocked")}
              </span>
            }
          />
        </Card>
      </div>

      <p className="inline-flex items-start gap-2 text-xs text-muted">
        <Cpu weight="bold" className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
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
            className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center text-muted"
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
            <p className="mt-1 text-sm leading-relaxed text-fg">{fact.claim[lang]}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 ps-9">
          <CitationPill citationId={fact.citationId} lang={lang} section={fact.section} />
          <StatusChip status={status} />
          {edit.humanEdited ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted">
              <PencilSimple weight="bold" className="h-3 w-3" aria-hidden />
              {t("authoring.editor.humanEdited")}
            </span>
          ) : null}
        </div>

        {flagged ? (
          <p className="ms-9 rounded-control bg-[color-mix(in_srgb,var(--state-warning)_10%,transparent)] px-2.5 py-1.5 text-[11px] text-fg">
            {t("authoring2.editor.groundHint")}
          </p>
        ) : open ? (
          <p className="ms-9 text-[11px] text-muted">{t("authoring2.editor.openHint")}</p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 ps-9">
          {open ? (
            <>
              <Button
                size="sm"
                variant="secondary"
                aria-label={t("authoring2.editor.lockAria", { kind: kindLabel })}
                onClick={() => dispatch({ type: "lock", id: fact.id })}
                leadingIcon={<LockSimple weight="bold" className="h-4 w-4" />}
              >
                {t("authoring2.editor.lock")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={t("authoring2.editor.editLockAria", { kind: kindLabel })}
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
              aria-label={t("authoring2.editor.groundAria", { kind: kindLabel })}
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
              aria-label={t("authoring2.editor.unlockAria", { kind: kindLabel })}
              onClick={() => dispatch({ type: "unlock", id: fact.id })}
              leadingIcon={<LockSimpleOpen weight="bold" className="h-4 w-4" />}
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
      className={cn("h-2 w-2 shrink-0", axis === "clinical" ? "rotate-45" : "rounded-full")}
      style={{
        backgroundColor:
          axis === "clinical" ? "var(--axis-clinical)" : "var(--axis-communication)",
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
      <CitationPill citationId={item.citationId} lang={lang} section={item.section} />
    </li>
  );
}

function CoverageStrip({ draft }: { draft: DraftBundle }) {
  const { t } = useTranslation();
  const complete = draft.coveredDomains >= 6;
  return (
    <div className="rounded-control border border-border bg-bg-subtle p-3">
      <p className="eyebrow">
        {t("authoring.editor.coverage")}
      </p>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {draft.coverage.map((d) => (
          <li key={d.domain}>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
                d.items > 0
                  ? "border-border bg-surface text-fg"
                  : "border-dashed border-border text-muted",
              )}
            >
              <AxisMark axis={d.axis} />
              {t(`feedback.domains.${d.domain}`)}
              <span className="font-mono text-muted">{d.items}</span>
            </span>
          </li>
        ))}
      </ul>
      <p
        className={cn(
          "mt-2 inline-flex items-center gap-1 text-[11px]",
          complete ? "text-[color:var(--state-normal)]" : "text-muted",
        )}
      >
        <CheckCircle weight="fill" className="h-3 w-3" aria-hidden />
        {complete
          ? t("authoring.editor.coverageComplete")
          : t("authoringP9.editor.coveragePartial", {
              defaultValue: "{{count}} of 6 competency domains covered",
              count: draft.coveredDomains,
            })}
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
  if (!state.draft) return <NeedsDraft dispatch={dispatch} />;
  const draft = state.draft;
  const total = draft.facts.length;
  const locked = lockedCount(draft.facts, state.edits);
  const blockers = publishBlockers(draft.facts, state.edits).length;
  const clear = blockers === 0;
  const liveHash = caseFingerprint(draft.facts, state.edits);

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
            {draft.facts.map((f) => (
              <FactCard
                key={f.id}
                fact={f}
                edit={
                  state.edits[f.id] ?? { status: f.status, humanEdited: f.humanEdited }
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
            <p className="mt-1 text-xs text-muted">{t("authoring.editor.rubricSub")}</p>
          </div>
          <CoverageStrip draft={draft} />
          <ul className="flex flex-col gap-2.5">
            {draft.rubric.map((item) => (
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
            <p className="eyebrow">
              {t("authoring2.editor.liveHash")}
            </p>
            <p className="text-[11px] text-muted">{t("authoring2.editor.liveHashNote")}</p>
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
/* Psychometric stage — honest, draft-derived readiness signals                */
/* -------------------------------------------------------------------------- */

function PsychometricPanel({
  state,
  dispatch,
}: {
  state: AuthoringUIState;
  dispatch: Dispatcher;
}) {
  const { t } = useTranslation();
  const lang = useLang();
  if (!state.draft) return <NeedsDraft dispatch={dispatch} />;
  const signals = readinessSignals(state.draft);

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
          {t("authoringP9.psychometric.sub", {
            defaultValue:
              "Real, checkable properties of this draft the reviewer weighs before sign-off — not a public metric.",
          })}
        </p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {signals.map((s) => (
          <li key={s.id}>
            <Card variant="inset" padding="sm" className="relative h-full">
              <StatusDot
                tone={s.ok ? "normal" : "warning"}
                size="sm"
                aria-hidden="true"
                className="absolute right-3 top-3.5"
              />
              <Stat label={s.label[lang]} value={s.value} size="md" hint={s.note[lang]} />
            </Card>
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
/* Publish stage — the credentialed clinician sign-off gate (real identity)    */
/* -------------------------------------------------------------------------- */

function LocaleStatus({
  locale,
  reviewed,
  reviewerName,
}: {
  locale: "en" | "tr";
  reviewed: boolean;
  reviewerName: string;
}) {
  const { t } = useTranslation();
  return (
    <li className="flex items-center justify-between gap-2 rounded-control border border-border bg-surface px-3 py-2">
      <span className="inline-flex items-center gap-2">
        <span className="font-mono text-xs font-semibold uppercase text-fg">{locale}</span>
        <span className="text-sm text-muted">{t(`authoring.signoff.locale.${locale}`)}</span>
      </span>
      {reviewed ? (
        <Badge tone="normal">
          <CheckCircle weight="fill" className="h-3 w-3" aria-hidden />
          {t("authoring.signoff.localeReviewed", { name: reviewerName })}
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

function SignInToCoSign() {
  const { t } = useTranslation();
  return (
    <div className="rounded-control border border-dashed border-border bg-bg-subtle p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center text-muted" aria-hidden>
          <SignIn weight="bold" className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm font-semibold text-fg">
            {t("authoringP9.signoff.needIdentity", { defaultValue: "Sign in to co-sign" })}
          </p>
          <p className="mt-0.5 max-w-md text-xs text-muted">
            {t("authoringP9.signoff.needIdentitySub", {
              defaultValue:
                "The publish gate records the authenticated clinician's real name and role. Complete your profile to co-sign — no name is fabricated on your behalf.",
            })}
          </p>
        </div>
      </div>
    </div>
  );
}

function RoleNotCredentialed({ role }: { role: string }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-control border border-dashed border-[color:var(--state-warning)] bg-[color-mix(in_srgb,var(--state-warning)_8%,transparent)] p-4">
      <div className="flex items-start gap-3">
        <span
          className="grid h-10 w-10 shrink-0 place-items-center rounded-control bg-[color-mix(in_srgb,var(--state-warning)_16%,transparent)] text-[color:var(--state-warning)]"
          aria-hidden
        >
          <LockSimple weight="bold" className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm font-semibold text-fg">
            {t("authoringP9.signoff.needCredential", {
              defaultValue: "Co-signing needs a credentialed clinician",
            })}
          </p>
          <p className="mt-0.5 max-w-md text-xs text-muted">
            {t("authoringP9.signoff.needCredentialSub", {
              role,
              defaultValue:
                "Only an educator or dean can co-sign and publish a case for learners. Your account role ({{role}}) cannot sign off — ask a credentialed clinician to review and co-sign.",
            })}
          </p>
        </div>
      </div>
    </div>
  );
}

function SignOffPanel({
  state,
  dispatch,
  reviewer,
  onPublish,
}: {
  state: AuthoringUIState;
  dispatch: Dispatcher;
  reviewer: ReviewerIdentity | null;
  onPublish: () => void;
}) {
  const { t } = useTranslation();
  const lang = useLang();
  const profile = useProfile();
  if (!state.draft) return <NeedsDraft dispatch={dispatch} />;
  const draft = state.draft;

  // Onboarded, named, but lacking a credentialed teaching role (student /
  // resident): the co-sign box + publish stay disabled, with a clear note.
  const roleBlocked =
    !reviewer &&
    !!profile &&
    profile.onboarded &&
    profile.fullName.trim() !== "" &&
    !isCredentialedRole(profile.role);
  const roleLabel = profile ? profile.role : "";

  const blockers = publishBlockers(draft.facts, state.edits);
  const clear = blockers.length === 0;
  const canPublish = state.cosigned && clear && !!reviewer;
  const caseHash = state.frozen?.caseHash ?? caseFingerprint(draft.facts, state.edits);
  const rubricHash = state.frozen?.rubricHash ?? rubricFingerprint(draft.rubric);
  const otherLocale: "en" | "tr" = lang === "en" ? "tr" : "en";

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
          <p className="mt-1 max-w-xl text-xs text-muted">{t("authoring.signoff.sub")}</p>
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

      {/* Per-locale review status — attested by the real reviewer, in their locale */}
      <div>
        <div className="flex items-center gap-1.5">
          <GlobeHemisphereWest weight="bold" className="h-4 w-4 text-brand" aria-hidden />
          <h4 className="text-sm font-semibold tracking-tight text-fg">
            {t("authoring.signoff.localeHeading")}
          </h4>
        </div>
        <ul className="mt-2 flex flex-col gap-2">
          <LocaleStatus
            locale={lang}
            reviewed={state.published}
            reviewerName={reviewer?.name ?? ""}
          />
          <LocaleStatus locale={otherLocale} reviewed={false} reviewerName="" />
        </ul>
        <p className="mt-2 text-[11px] text-muted">{t("authoring.signoff.localeNote")}</p>
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
            clear ? "text-[color:var(--state-normal)]" : "text-[color:var(--state-warning)]",
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
          <p className="eyebrow">
            {t("authoring.signoff.versionHeading")}
          </p>
        </div>
        <DescriptionList divided className="mt-2">
          <KeyValue label={t("authoring.signoff.caseHash")} value={caseHash} mono />
          <KeyValue label={t("authoring.signoff.rubricHash")} value={rubricHash} mono />
        </DescriptionList>
        <p className="mt-2 text-[11px] text-muted">
          {state.published
            ? t("authoring2.signoff.frozenNote")
            : t("authoring2.signoff.liveHashNote")}
        </p>
        {draft.blueprint.guidelineSet ? (
          <p className="mt-1 text-[11px] text-muted">
            {t("authoring.signoff.guidelineSet")}: {draft.blueprint.guidelineSet}
          </p>
        ) : null}
      </div>

      {/* Credentialed clinician co-sign — the REAL authenticated identity */}
      {reviewer ? (
        <div className="rounded-control border border-border bg-surface p-4">
          <div className="flex items-start gap-3">
            <span
              className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center text-brand"
              aria-hidden
            >
              <Certificate weight="bold" className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-fg">{reviewer.name}</p>
              <p className="text-xs text-muted">
                {reviewer.role[lang]}
                {reviewer.specialty ? ` · ${reviewer.specialty}` : ""}
              </p>
              <p className="mt-0.5 text-[11px] text-muted">{reviewer.institution}</p>
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
                onChange={(e) => dispatch({ type: "cosign", value: e.target.checked })}
                className="mt-0.5 h-5 w-5 shrink-0 accent-brand"
              />
              <span className="flex items-center gap-1.5 text-sm text-fg">
                <Signature weight="bold" className="h-4 w-4 shrink-0 text-brand" aria-hidden />
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
                {t("authoring.signoff.signedConfirmation", { name: reviewer.name })}
              </p>
            </div>
          )}
        </div>
      ) : roleBlocked ? (
        <RoleNotCredentialed role={roleLabel} />
      ) : (
        <SignInToCoSign />
      )}

      {/* Provenance citations */}
      {draft.caseInstance.expectedWorkup.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
            {t("authoring.signoff.groundedOn")}
          </span>
          {Array.from(new Set(draft.facts.map((f) => f.citationId)))
            .slice(0, 4)
            .map((id) => (
              <CitationPill key={id} citationId={id} lang={lang} />
            ))}
        </div>
      ) : null}

      {/* Publish action — hard-gated */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-md text-xs text-muted">{t("authoring.signoff.modelProvenance")}</p>
        {state.published ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="md"
              onClick={() => dispatch({ type: "reset" })}
              leadingIcon={<ArrowCounterClockwise weight="bold" className="h-4 w-4" />}
            >
              {t("authoringP9.signoff.authorAnother", { defaultValue: "Author another case" })}
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
            onClick={onPublish}
            leadingIcon={<RocketLaunch weight="fill" className="h-4 w-4" />}
          >
            {t("authoring.signoff.publish")}
          </Button>
        )}
      </div>
      {!canPublish && !state.published ? (
        <p role="status" className="text-[11px] text-[color:var(--state-warning)]">
          {!reviewer
            ? roleBlocked
              ? t("authoringP9.signoff.blockedByRole", {
                  defaultValue:
                    "Publish is blocked: only a credentialed clinician (educator or dean) can co-sign.",
                })
              : t("authoringP9.signoff.blockedByIdentity", {
                  defaultValue: "Publish is blocked until an authenticated clinician can co-sign.",
                })
            : !clear
              ? t("authoring.signoff.blockedByFacts")
              : t("authoring.signoff.blockedByCosign")}
        </p>
      ) : null}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Monitor stage — reads the persisted store; Open/Review wired                */
/* -------------------------------------------------------------------------- */

function MonitorLocales({ pub }: { pub: PublishedCase }) {
  const { t } = useTranslation();
  return (
    <ul className="flex flex-wrap gap-1.5">
      {pub.locales.map((l) => (
        <li key={l.locale}>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-chip border px-2 py-0.5 text-[11px] font-medium",
              l.offered
                ? "border-transparent text-[color:var(--state-normal)] bg-[color-mix(in_srgb,var(--state-normal)_12%,transparent)]"
                : "border-dashed border-border text-muted",
            )}
            title={t(
              l.offered ? "authoring.monitor.localeOffered" : "authoring.monitor.localePending",
            )}
          >
            {l.offered ? (
              <CheckCircle weight="fill" className="h-3 w-3" aria-hidden />
            ) : (
              <WarningCircle weight="bold" className="h-3 w-3" aria-hidden />
            )}
            {l.locale.toUpperCase()}
          </span>
        </li>
      ))}
    </ul>
  );
}

function MonitorRow({
  pub,
  encounters,
  isNew,
  onOpen,
  onReview,
}: {
  pub: PublishedCase;
  encounters: number;
  isNew: boolean;
  onOpen: (pub: PublishedCase) => void;
  onReview: (pub: PublishedCase) => void;
}) {
  const { t } = useTranslation();
  const lang = useLang();

  return (
    <Tr className={isNew ? "bg-brand-tint" : undefined}>
      <Td>
        <div className="flex min-w-[13rem] flex-col gap-0.5">
          <span className="font-medium text-fg">{pub.title[lang]}</span>
          <span className="inline-flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
            <span className="inline-flex items-center gap-1 font-mono">
              <Hash weight="bold" className="h-3 w-3" aria-hidden />
              {pub.versionHash}
            </span>
            <span aria-hidden>·</span>
            <span>
              {isNew
                ? t("authoring2.monitor.justPublished")
                : t("authoring.monitor.lastReviewed", { date: pub.lastReviewed })}
            </span>
          </span>
        </div>
      </Td>
      <Td>
        <MonitorLocales pub={pub} />
      </Td>
      <Td numeric>{encounters}</Td>
      <Td>
        {isNew ? (
          <Badge tone="brand" icon={<FileText weight="fill" className="h-3 w-3" aria-hidden />}>
            {t("authoring2.monitor.newBadge")}
          </Badge>
        ) : (
          <Badge tone="normal" icon={<CheckCircle weight="fill" className="h-3 w-3" aria-hidden />}>
            {t("authoring.monitor.status.live")}
          </Badge>
        )}
      </Td>
      <Td className="text-end">
        <div className="inline-flex items-center justify-end gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onReview(pub)}
            leadingIcon={<Eye weight="bold" className="h-4 w-4" />}
          >
            {t("authoringP9.monitor.review", { defaultValue: "Review" })}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onOpen(pub)}
            trailingIcon={<ArrowRight weight="bold" className="h-4 w-4" />}
          >
            {t("authoring.monitor.open")}
          </Button>
        </div>
      </Td>
    </Tr>
  );
}

function CasePreview({
  pub,
  onOpen,
  onRemove,
  onClose,
}: {
  pub: PublishedCase;
  onOpen: (pub: PublishedCase) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const lang = useLang();
  return (
    <Card padding="lg" className="flex flex-col gap-4 border-brand">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <SectionLabel icon={<Eye weight="bold" className="h-3.5 w-3.5" aria-hidden />}>
            {t("authoringP9.preview.eyebrow", { defaultValue: "Published case detail" })}
          </SectionLabel>
          <h3 className="mt-1 text-base font-semibold tracking-tight text-fg">
            {pub.title[lang]}
          </h3>
          <p className="mt-0.5 text-xs text-muted">{pub.chiefComplaint[lang]}</p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={onClose}
          aria-label={t("authoringP9.preview.close", { defaultValue: "Close preview" })}
          leadingIcon={<X weight="bold" className="h-4 w-4" />}
        >
          {t("authoringP9.preview.close", { defaultValue: "Close preview" })}
        </Button>
      </div>

      <DescriptionList divided>
        <KeyValue
          label={t("authoringP9.blueprint.diagnosis", { defaultValue: "Working diagnosis" })}
          value={pub.diagnosis[lang]}
        />
        {pub.codeLabel ? (
          <KeyValue
            label={t("authoringP9.blueprint.code", { defaultValue: "Diagnosis code" })}
            value={pub.codeLabel}
            mono
          />
        ) : null}
        <KeyValue
          label={t("authoring.blueprint.difficulty")}
          value={`${pub.difficulty} · ${pub.difficultyBand[lang]}`}
        />
        <KeyValue label={t("authoring.signoff.caseHash")} value={pub.versionHash} mono />
        <KeyValue label={t("authoring.signoff.rubricHash")} value={pub.rubricHash} mono />
        <KeyValue
          label={t("authoringP9.preview.cosigner", { defaultValue: "Co-signed by" })}
          value={`${pub.reviewer.name} · ${pub.reviewer.role[lang]}`}
        />
        <KeyValue
          label={t("authoringP9.preview.publishedAt", { defaultValue: "Published" })}
          value={new Date(pub.publishedAt).toLocaleString()}
        />
        {pub.guidelineSet ? (
          <KeyValue label={t("authoring.signoff.guidelineSet")} value={pub.guidelineSet} />
        ) : null}
      </DescriptionList>

      <div className="grid grid-cols-3 gap-2">
        <Card variant="inset" padding="sm">
          <Stat label={t("authoring3.draft.factsLabel")} value={pub.factCount} size="sm" />
        </Card>
        <Card variant="inset" padding="sm">
          <Stat
            label={t("authoringP9.preview.rubricItems", { defaultValue: "Rubric items" })}
            value={pub.rubricItemCount}
            size="sm"
          />
        </Card>
        <Card variant="inset" padding="sm">
          <Stat
            label={t("authoring.editor.safetyCritical")}
            value={pub.safetyCriticalCount}
            size="sm"
          />
        </Card>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onRemove(pub.id)}
          leadingIcon={<Trash weight="bold" className="h-4 w-4" />}
        >
          {t("authoringP9.preview.remove", { defaultValue: "Remove from library" })}
        </Button>
        <Button
          size="md"
          onClick={() => onOpen(pub)}
          trailingIcon={<ArrowRight weight="bold" className="h-4 w-4" />}
        >
          {t("authoring.monitor.open")}
        </Button>
      </div>
    </Card>
  );
}

function MonitorPanel({ state }: { state: AuthoringUIState }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const cases = usePublishedCases();
  const records = useProgressRecords();
  const [previewId, setPreviewId] = useState<string | null>(null);

  const encountersFor = useCallback(
    (caseId: string) => records.filter((r) => r.caseId === caseId).length,
    [records],
  );

  // A published case is a faculty blueprint: "open" requests a NEW case with its
  // presentation and difficulty through the model pipeline, never the stored case.
  const openCase = useCallback(
    (pub: PublishedCase) => {
      navigate("/encounter", {
        state: {
          start: {
            mode: "solo",
            role: "doctor",
            guidance: true,
            chiefComplaint: complaintFamilyOf(pub.caseInstance),
            difficulty: pub.caseInstance.difficulty,
          },
        },
      });
    },
    [navigate],
  );

  const removeCase = useCallback((id: string) => {
    removePublishedCase(id);
    setPreviewId((cur) => (cur === id ? null : cur));
  }, []);

  const preview = previewId ? cases.find((c) => c.id === previewId) ?? null : null;

  if (cases.length === 0) {
    return (
      <Card padding="lg" className="flex flex-col items-start gap-3">
        <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center text-muted" aria-hidden>
          <FolderOpen weight="bold" className="h-5 w-5" />
        </span>
        <div>
          <h3 className="text-sm font-semibold tracking-tight text-fg">
            {t("authoringP9.monitor.emptyHeading", { defaultValue: "No cases published yet" })}
          </h3>
          <p className="mt-1 max-w-md text-xs text-muted">
            {t("authoringP9.monitor.emptySub", {
              defaultValue:
                "Generate a blueprint, lock every grounded fact, and co-sign to publish your first case. Your published library and its counts appear here.",
            })}
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <TableWrap>
        <Table aria-label={t("authoring3.monitor.tableLabel")}>
          <THead>
            <Tr>
              <Th>{t("authoring3.monitor.colCase")}</Th>
              <Th>{t("authoring3.monitor.colLocales")}</Th>
              <Th numeric>{t("authoring3.monitor.colEncounters")}</Th>
              <Th>{t("authoring3.monitor.colStatus")}</Th>
              <Th className="text-end">
                <span className="sr-only">{t("authoring3.monitor.colAction")}</span>
              </Th>
            </Tr>
          </THead>
          <TBody>
            {cases.map((p) => (
              <MonitorRow
                key={p.id}
                pub={p}
                encounters={encountersFor(p.caseInstance.id)}
                isNew={p.id === state.publishedId}
                onOpen={openCase}
                onReview={(pub) => setPreviewId(pub.id)}
              />
            ))}
          </TBody>
        </Table>
      </TableWrap>

      {preview ? (
        <CasePreview
          pub={preview}
          onOpen={openCase}
          onRemove={removeCase}
          onClose={() => setPreviewId(null)}
        />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Active-stage router                                                         */
/* -------------------------------------------------------------------------- */

function StagePanel({
  stageKey,
  state,
  dispatch,
  reviewer,
  onPublish,
}: {
  stageKey: PipelineStage;
  state: AuthoringUIState;
  dispatch: Dispatcher;
  reviewer: ReviewerIdentity | null;
  onPublish: () => void;
}) {
  switch (stageKey) {
    case "blueprint":
      return <BlueprintPanel state={state} dispatch={dispatch} />;
    case "draft":
      return <DraftPanel state={state} dispatch={dispatch} />;
    case "review":
      return <ReviewPanel state={state} dispatch={dispatch} />;
    case "psychometric":
      return <PsychometricPanel state={state} dispatch={dispatch} />;
    case "publish":
      return (
        <SignOffPanel
          state={state}
          dispatch={dispatch}
          reviewer={reviewer}
          onPublish={onPublish}
        />
      );
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
 * as a live, steppable pipeline over a REAL generated draft.
 *
 * The Blueprint stage takes a prompt (presentation family / specialty +
 * difficulty) and requests a fresh synthetic case from the model (v2 pipeline); every
 * downstream stage reflects that draft. Each AI-drafted fact must be grounded
 * and LOCKED before it can reach a learner, and publish stays disabled until
 * every fact is locked AND the AUTHENTICATED clinician (from profileStore, no
 * fabricated name) co-signs — enforced in the reducer, not in copy. On publish
 * the case + rubric freeze with version hashes and persist to a local store; the
 * monitor list + counts read from that store, with Open handing the real case to
 * the encounter workspace. Everything is SIM / synthetic and education only.
 */
export function AuthoringPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const profile = useProfile();
  const reviewer = useMemo(() => reviewerFromProfile(profile), [profile]);

  const [state, dispatch] = useReducer(
    authoringReducer,
    undefined,
    makeInitialAuthoringState,
  );
  const header = useEntry();
  const wizard = useEntry(0.06);
  const panelReveal = useEntry(0.04);
  const currentStage = pipelineStages[state.stageIndex];

  const handlePublish = useCallback(() => {
    const draft = state.draft;
    if (!draft || !reviewer) return;
    if (!(state.cosigned && factsClear(draft.facts, state.edits))) return;
    const caseHash = caseFingerprint(draft.facts, state.edits);
    const rubricHash = rubricFingerprint(draft.rubric);
    const saved = publishCase({
      draft,
      edits: state.edits,
      reviewer,
      reviewedLocale: lang,
      caseHash,
      rubricHash,
    });
    dispatch({
      type: "publish",
      publishedId: saved.id,
      caseHash,
      rubricHash,
      // A non-null reviewer already implies a credentialed role, but the
      // reducer re-checks so the gate holds independently of this call site.
      credentialed: reviewer !== null,
    });
  }, [state.draft, state.edits, state.cosigned, reviewer, lang]);

  return (
    <PageContainer width="wide" className="flex flex-col gap-8">
      {/* Header */}
      <motion.div {...header}>
        <PageHeader
          eyebrow={
            <span className="inline-flex items-center gap-1.5">
              <PencilRuler weight="bold" className="h-3.5 w-3.5" aria-hidden />
              {t("authoring.eyebrow")}
            </span>
          }
          title={t("authoring.title")}
          description={t("authoring.subtitle")}
          meta={
            <>
              <SimBadge variant="chip" />
              <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                <Cpu weight="bold" className="h-3.5 w-3.5" aria-hidden />
                {t("authoring.aiHumanNote")}
              </span>
            </>
          }
          actions={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => dispatch({ type: "reset" })}
              leadingIcon={<ArrowCounterClockwise weight="bold" className="h-4 w-4" />}
            >
              {t("authoring2.reset")}
            </Button>
          }
        />
      </motion.div>

      {/* Steppable pipeline + working panel */}
      <motion.section
        {...wizard}
        aria-labelledby="authoring-pipeline"
        className="flex flex-col gap-6"
      >
        <p id="authoring-pipeline" className="max-w-2xl text-sm text-muted">
          {t("authoring2.intro")}
        </p>

        <PipelineStepper state={state} dispatch={dispatch} />

        <motion.div key={currentStage.key} {...panelReveal}>
          <StageHeading stage={currentStage} />
          <StagePanel
            stageKey={currentStage.key}
            state={state}
            dispatch={dispatch}
            reviewer={reviewer}
            onPublish={handlePublish}
          />
        </motion.div>
      </motion.section>

      <p className="text-xs text-muted">{t("authoring.eduNote")}</p>
    </PageContainer>
  );
}
