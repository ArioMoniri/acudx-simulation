import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Hash,
  SealCheck,
  Signature,
  RocketLaunch,
  LockSimple,
  WarningCircle,
  CheckCircle,
  ChartBar,
  GlobeHemisphereWest,
  Certificate,
} from "@phosphor-icons/react";
import { Card, Button, Badge } from "@/components/ui";
import { CitationPill } from "@/components";
import { cn } from "@/lib/cn";
import { useLang } from "@/lib/useLang";
import {
  peerReviewSignals,
  signOffClinician,
  versionHashes,
  sampleBlueprint,
  lockedFacts,
  type ContentLocale,
} from "@/data/authoring";

/* -------------------------------------------------------------------------- */
/* Per-locale review status                                                    */
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

/* -------------------------------------------------------------------------- */
/* Peer / psychometric signals                                                 */
/* -------------------------------------------------------------------------- */

function PsychometricSignals() {
  const { t } = useTranslation();
  const lang = useLang();
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <ChartBar weight="bold" className="h-4 w-4 text-brand" aria-hidden />
        <h3 className="text-sm font-semibold tracking-tight text-fg">
          {t("authoring.psychometric.heading")}
        </h3>
      </div>
      <p className="mt-1 text-xs text-muted">
        {t("authoring.psychometric.sub")}
      </p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
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
                  "grid h-4 w-4 place-items-center rounded-full",
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
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* SignOffGate — the credentialed clinician co-sign gate (Screen 7.3)          */
/* -------------------------------------------------------------------------- */

/**
 * SignOffGate — the hard publish gate. Publish is disabled until:
 *   1. every clinical fact is grounded and locked (no flagged facts), and
 *   2. a credentialed clinician checks the co-sign box (identity + credential
 *      recorded).
 * On approval the case + rubric freeze with case_version_hash / rubric_version_
 * hash. The gate is enforced here in code, mirroring the production contract
 * (AU-1/AU-2); the co-sign is a real, keyboard-reachable checkbox, and the
 * "published" state shows the frozen version provenance.
 */
export function SignOffGate() {
  const { t } = useTranslation();
  const lang = useLang();
  const [cosigned, setCosigned] = useState(false);
  const [published, setPublished] = useState(false);

  // Any ungrounded/flagged fact hard-blocks publish (citation-or-refuse).
  const openBlockers = useMemo(
    () =>
      lockedFacts.filter(
        (f) => f.status === "flagged" || f.status === "open",
      ),
    [],
  );
  const factsClear = openBlockers.length === 0;
  const canPublish = cosigned && factsClear;

  return (
    <Card padding="lg" className="flex flex-col gap-5">
      {/* Summary line */}
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
        {published ? (
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

      {/* Psychometric pre-flight */}
      <PsychometricSignals />

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

      {/* Fact-lock blocker read-out */}
      <div
        className={cn(
          "flex items-start gap-2 rounded-control border p-3",
          factsClear
            ? "border-[color:var(--state-normal)] bg-[color-mix(in_srgb,var(--state-normal)_8%,transparent)]"
            : "border-[color:var(--state-warning)] bg-[color-mix(in_srgb,var(--state-warning)_10%,transparent)]",
        )}
      >
        <span
          className={cn(
            "mt-0.5 shrink-0",
            factsClear
              ? "text-[color:var(--state-normal)]"
              : "text-[color:var(--state-warning)]",
          )}
          aria-hidden
        >
          {factsClear ? (
            <LockSimple weight="fill" className="h-4 w-4" />
          ) : (
            <WarningCircle weight="fill" className="h-4 w-4" />
          )}
        </span>
        <p className="text-xs text-fg">
          {factsClear
            ? t("authoring.signoff.factsClear")
            : t("authoring.signoff.factsBlocked", {
                count: openBlockers.length,
              })}
        </p>
      </div>

      {/* Version hashes (frozen provenance on publish) */}
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
              {versionHashes.caseVersionHash}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-[11px] text-muted">
              {t("authoring.signoff.rubricHash")}
            </dt>
            <dd className="font-mono text-xs font-semibold text-fg">
              {versionHashes.rubricVersionHash}
            </dd>
          </div>
        </dl>
        <p className="mt-2 text-[11px] text-muted">
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

        {!published ? (
          <label
            className={cn(
              "mt-4 flex items-start gap-3 rounded-control border p-3",
              "cursor-pointer transition-colors",
              cosigned
                ? "border-brand bg-brand-tint"
                : "border-border bg-bg-subtle hover:bg-surface",
            )}
          >
            <input
              type="checkbox"
              checked={cosigned}
              onChange={(e) => setCosigned(e.target.checked)}
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

      {/* Provenance citations for the whole case */}
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
        {published ? (
          <Button
            variant="secondary"
            size="md"
            leadingIcon={<CheckCircle weight="fill" className="h-4 w-4" />}
            onClick={() => setPublished(false)}
          >
            {t("authoring.signoff.unpublish")}
          </Button>
        ) : (
          <Button
            size="md"
            disabled={!canPublish}
            onClick={() => setPublished(true)}
            leadingIcon={<RocketLaunch weight="fill" className="h-4 w-4" />}
          >
            {t("authoring.signoff.publish")}
          </Button>
        )}
      </div>
      {!canPublish && !published ? (
        <p
          role="status"
          className="text-[11px] text-[color:var(--state-warning)]"
        >
          {!factsClear
            ? t("authoring.signoff.blockedByFacts")
            : t("authoring.signoff.blockedByCosign")}
        </p>
      ) : null}
    </Card>
  );
}
