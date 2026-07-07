import { useTranslation } from "react-i18next";
import {
  LockSimple,
  PencilSimple,
  WarningCircle,
  ShieldWarning,
  User,
  Heartbeat,
  Stethoscope,
  Flask,
  Pill,
  ProhibitInset,
  CheckCircle,
  type Icon,
} from "@phosphor-icons/react";
import { Card, Badge } from "@/components/ui";
import { CitationPill } from "@/components";
import { cn } from "@/lib/cn";
import { useLang } from "@/lib/useLang";
import {
  lockedFacts,
  rubricItems,
  domainCoverage,
  type LockedFact,
  type FactKind,
  type FactStatus,
  type RubricItem,
} from "@/data/authoring";

/* -------------------------------------------------------------------------- */
/* Locked facts (left pane of the split editor)                                */
/* -------------------------------------------------------------------------- */

const factIcon: Record<FactKind, Icon> = {
  persona: User,
  vitals: Heartbeat,
  finding: Stethoscope,
  result: Flask,
  medication: Pill,
  safety: ProhibitInset,
};

/** Status affordance: icon + text (never colour alone), plus the lock control. */
function FactStatusChip({ status }: { status: FactStatus }) {
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
  // locked or edited-locked
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

function FactRow({ fact }: { fact: LockedFact }) {
  const { t } = useTranslation();
  const lang = useLang();
  const FactIcon = factIcon[fact.kind];
  const flagged = fact.status === "flagged";

  return (
    <li>
      <div
        className={cn(
          "flex flex-col gap-2.5 rounded-control border bg-surface p-3",
          flagged
            ? "border-[color:var(--state-warning)] border-l-2"
            : "border-border",
        )}
      >
        <div className="flex items-start gap-2.5">
          <span
            className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-control bg-bg-subtle text-muted"
            aria-hidden
          >
            <FactIcon weight="bold" className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
                {t(`authoring.editor.kind.${fact.kind}`)}
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
          <FactStatusChip status={fact.status} />
          {fact.humanEdited ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted">
              <PencilSimple weight="bold" className="h-3 w-3" aria-hidden />
              {t("authoring.editor.humanEdited")}
            </span>
          ) : null}
        </div>

        {flagged ? (
          <p className="ml-9 rounded-control bg-[color-mix(in_srgb,var(--state-warning)_10%,transparent)] px-2.5 py-1.5 text-[11px] text-fg">
            {t("authoring.editor.flaggedNote")}
          </p>
        ) : null}
      </div>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Rubric items (right pane)                                                   */
/* -------------------------------------------------------------------------- */

function AxisMark({ axis }: { axis: "clinical" | "communication" }) {
  // Locked axis marks: diamond = clinical, dot = communication (INV-3).
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

/* -------------------------------------------------------------------------- */
/* Domain coverage strip                                                       */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/* CaseEditor — the split review editor stub (Screen 7.2)                      */
/* -------------------------------------------------------------------------- */

/**
 * CaseEditor — the human-authoritative review surface: AI-drafted locked facts
 * with provenance on the left, the rubric + domain coverage on the right. Every
 * clinical claim carries a cited, versioned guideline reference and a lock
 * state; a flagged (ungrounded) fact cannot be locked and blocks publish. This
 * is the sample case being reviewed with cited guideline facts.
 */
export function CaseEditor() {
  const { t } = useTranslation();
  const flaggedCount = lockedFacts.filter((f) => f.status === "flagged").length;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Left: locked facts + provenance */}
      <Card padding="lg" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold tracking-tight text-fg">
            {t("authoring.editor.factsHeading")}
          </h3>
          {flaggedCount > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold text-[color:var(--state-warning)] bg-[color-mix(in_srgb,var(--state-warning)_16%,transparent)]">
              <WarningCircle weight="fill" className="h-3 w-3" aria-hidden />
              {t("authoring.editor.flaggedCount", { count: flaggedCount })}
            </span>
          ) : null}
        </div>
        <p className="text-xs text-muted">{t("authoring.editor.factsSub")}</p>
        <ul className="flex flex-col gap-2.5">
          {lockedFacts.map((f) => (
            <FactRow key={f.id} fact={f} />
          ))}
        </ul>
      </Card>

      {/* Right: rubric + coverage */}
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
  );
}
