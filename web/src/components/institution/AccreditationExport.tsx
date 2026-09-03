import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import {
  Export,
  ShieldCheck,
  CheckCircle,
  Certificate,
  Eye,
  X,
} from "@phosphor-icons/react";
import { Card, Button, Switch, Badge } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useLang } from "@/lib/useLang";
import { useReveal } from "@/lib/motion";
import {
  accreditationFrameworks,
  exportScopeOptions,
  cohortLearners,
  HEATMAP_DOMAINS,
  FRAMEWORK_DOMAIN_TAG,
  type AccreditationFramework,
} from "@/data/institution";

const SAMPLE_ROWS = 4;

function FrameworkChip({
  fw,
  selected,
  onToggle,
}: {
  fw: AccreditationFramework;
  selected: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const lang = useLang();
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      className={cn(
        "flex min-h-11 flex-col items-start gap-0.5 rounded-control border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
        selected
          ? "border-brand bg-brand-tint"
          : "border-border bg-surface hover:bg-bg-subtle",
      )}
    >
      <span className="flex w-full items-center justify-between gap-2">
        <span
          className={cn(
            "text-sm font-semibold",
            selected ? "text-brand" : "text-fg",
          )}
        >
          {fw.label}
        </span>
        {selected ? (
          <CheckCircle
            weight="fill"
            className="h-4 w-4 shrink-0 text-brand"
            aria-hidden
          />
        ) : null}
      </span>
      <span className="text-[11px] text-muted">{fw.name[lang]}</span>
      <span className="mt-0.5 font-mono text-[10px] text-muted">
        {t("institution.export.mapped", {
          mapped: fw.mappedElements,
          total: fw.totalElements,
        })}
        {" · "}
        {fw.crosswalkVersion}
      </span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Preview panel                                                               */
/* -------------------------------------------------------------------------- */

function PreviewPanel({
  selectedFrameworks,
  selectedScopes,
  deidentified,
  fairnessIncluded,
  onClose,
}: {
  selectedFrameworks: AccreditationFramework[];
  selectedScopes: string[];
  deidentified: boolean;
  fairnessIncluded: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const lang = useLang();
  const reveal = useReveal();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const crosswalkFw = selectedFrameworks[0];
  const sample = cohortLearners.slice(0, SAMPLE_ROWS);
  const moreCount = cohortLearners.length - sample.length;

  return (
    <motion.div
      {...reveal}
      role="region"
      aria-label={t("institution.export.preview.regionLabel")}
      className="flex flex-col gap-4 rounded-control border border-border bg-bg-subtle p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h4
            ref={headingRef}
            tabIndex={-1}
            className="text-sm font-semibold text-fg outline-none"
          >
            {t("institution.export.preview.heading")}
          </h4>
          <p className="mt-0.5 text-[11px] text-muted">
            {crosswalkFw
              ? t("institution.export.preview.generatedNote", {
                  version: crosswalkFw.crosswalkVersion,
                })
              : null}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-muted transition-colors hover:bg-surface hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          aria-label={t("institution.export.preview.close")}
        >
          <X weight="bold" className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {/* Guarantee stamps */}
      <div className="flex flex-wrap gap-2">
        <Badge tone={deidentified ? "normal" : "warning"}>
          <ShieldCheck weight="fill" className="h-3 w-3" aria-hidden />
          {deidentified
            ? t("institution.export.preview.deidStamp")
            : t("institution.export.preview.reidWarn")}
        </Badge>
        {fairnessIncluded ? (
          <Badge tone="normal">
            <ShieldCheck weight="fill" className="h-3 w-3" aria-hidden />
            {t("institution.export.preview.fairnessAppended")}
          </Badge>
        ) : null}
      </div>

      {/* Tagged frameworks */}
      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
          {t("institution.export.preview.frameworksHeading")}
        </p>
        <ul className="flex flex-col gap-1.5">
          {selectedFrameworks.map((fw) => (
            <li
              key={fw.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-border bg-surface px-3 py-1.5"
            >
              <span className="flex items-center gap-2">
                <span className="inline-flex items-center rounded-full border border-brand bg-brand-tint px-2 py-0.5 text-[11px] font-semibold text-brand">
                  {fw.label}
                </span>
                <span className="text-xs text-fg">{fw.name[lang]}</span>
              </span>
              <span className="font-mono text-[10px] text-muted">
                {t("institution.export.mapped", {
                  mapped: fw.mappedElements,
                  total: fw.totalElements,
                })}
                {" · "}
                {fw.crosswalkVersion}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Scope */}
      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
          {t("institution.export.preview.scopeHeading")}
        </p>
        <ul className="flex flex-wrap gap-1.5">
          {selectedScopes.map((id) => {
            const opt = exportScopeOptions.find((o) => o.id === id);
            if (!opt) return null;
            return (
              <li
                key={id}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-0.5 text-[11px] text-muted"
              >
                <CheckCircle
                  weight="fill"
                  className="h-3 w-3 text-[color:var(--state-normal)]"
                  aria-hidden
                />
                {t(opt.labelKey)}
              </li>
            );
          })}
        </ul>
      </div>

      {/* De-identified sample rows */}
      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
          {t("institution.export.preview.sampleHeading")}
        </p>
        <div className="overflow-x-auto rounded-control border border-border bg-surface" tabIndex={0}>
          <table className="w-full text-left text-xs">
            <caption className="sr-only">
              {t("institution.export.preview.sampleCaption")}
            </caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="px-2.5 py-1.5 font-semibold text-fg">
                  {t("institution.heatmap.learnerCol")}
                </th>
                <th scope="col" className="px-2.5 py-1.5 font-semibold text-fg">
                  {t("institution.heatmap.sectionCol")}
                </th>
                {HEATMAP_DOMAINS.map((d) => (
                  <th
                    key={d.key}
                    scope="col"
                    className="px-2.5 py-1.5 font-semibold text-fg"
                  >
                    {t(`feedback.domains.${d.key}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sample.map((learner) => (
                <tr key={learner.id} className="border-b border-border/60">
                  <th
                    scope="row"
                    className="px-2.5 py-1.5 font-mono font-medium text-fg"
                  >
                    {learner.handle}
                  </th>
                  <td className="px-2.5 py-1.5 text-muted">
                    {t(`institution.section.${learner.sectionKey}`)}
                  </td>
                  {HEATMAP_DOMAINS.map((d) => (
                    <td key={d.key} className="px-2.5 py-1.5 text-fg">
                      {t(`bands.${learner.cells[d.key].band}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-[11px] text-muted">
          {t("institution.export.preview.sampleCaption")}
          {moreCount > 0 ? (
            <>
              {" "}
              {t("institution.export.preview.andMore", { count: moreCount })}
            </>
          ) : null}
        </p>
      </div>

      {/* Domain crosswalk for the first selected framework */}
      {crosswalkFw ? (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
            {t("institution.export.preview.crosswalkHeading", {
              framework: crosswalkFw.label,
            })}
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {HEATMAP_DOMAINS.map((d) => (
              <li
                key={d.key}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-0.5 text-[11px]"
              >
                <span className="text-muted">{t(`feedback.domains.${d.key}`)}</span>
                <span className="font-mono font-semibold text-fg">
                  {FRAMEWORK_DOMAIN_TAG[crosswalkFw.id]?.[d.key] ?? "-"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Download (demonstration only) */}
      <div className="flex flex-col gap-1.5">
        <Button
          disabled={!fairnessIncluded}
          leadingIcon={<Export weight="bold" className="h-4.5 w-4.5" />}
        >
          {t("institution.export.preview.download")}
        </Button>
        {fairnessIncluded ? (
          <p className="text-[11px] text-muted">
            {t("institution.export.preview.downloadNote")}
          </p>
        ) : (
          <p role="status" className="text-[11px] text-[color:var(--state-caution)]">
            {t("institution.export.blocked")}
          </p>
        )}
      </div>
    </motion.div>
  );
}

/* -------------------------------------------------------------------------- */
/* Section                                                                     */
/* -------------------------------------------------------------------------- */

/** AccreditationExport — framework-tagged, de-identified, previewable export builder (IN-3). */
export function AccreditationExport() {
  const { t } = useTranslation();
  const [selectedFw, setSelectedFw] = useState<Set<string>>(
    () => new Set(["acgme", "epa", "tepdad"]),
  );
  const [scopes, setScopes] = useState<Set<string>>(
    () => new Set(exportScopeOptions.filter((o) => o.selected).map((o) => o.id)),
  );
  const [previewing, setPreviewing] = useState(false);
  const previewButtonRef = useRef<HTMLButtonElement>(null);

  function toggleFw(id: string) {
    setSelectedFw((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleScope(id: string) {
    setScopes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const deidentified = scopes.has("deidentified");
  const fairnessIncluded = scopes.has("fairness");
  const canPreview = selectedFw.size > 0;

  const selectedFrameworks = accreditationFrameworks.filter((f) =>
    selectedFw.has(f.id),
  );
  const selectedScopes = exportScopeOptions
    .filter((o) => scopes.has(o.id))
    .map((o) => o.id);

  function closePreview() {
    setPreviewing(false);
    // return focus to the trigger for keyboard users
    previewButtonRef.current?.focus();
  }

  return (
    <Card padding="lg" className="flex flex-col gap-4">
      <div className="flex items-start gap-2.5">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-control bg-brand-tint text-brand"
          aria-hidden
        >
          <Certificate weight="bold" className="h-4.5 w-4.5" />
        </span>
        <div>
          <h3 className="text-lg font-semibold tracking-tight text-fg">
            {t("institution.export.title")}
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            {t("institution.export.subtitle")}
          </p>
        </div>
      </div>

      {/* Framework selection */}
      <fieldset>
        <legend className="text-xs font-semibold uppercase tracking-wide text-muted">
          {t("institution.export.frameworks")}
        </legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {accreditationFrameworks.map((fw) => (
            <FrameworkChip
              key={fw.id}
              fw={fw}
              selected={selectedFw.has(fw.id)}
              onToggle={() => toggleFw(fw.id)}
            />
          ))}
        </div>
      </fieldset>

      {/* Scope toggles */}
      <div className="flex flex-col gap-2 rounded-control bg-bg-subtle p-3">
        {exportScopeOptions.map((opt) => {
          const on = scopes.has(opt.id);
          const locked = opt.id === "deidentified" || opt.id === "fairness";
          return (
            <div key={opt.id} className="flex items-center justify-between gap-3">
              <label
                htmlFor={`scope-${opt.id}`}
                className="flex items-center gap-2 text-sm text-fg"
              >
                {locked ? (
                  <ShieldCheck
                    weight="bold"
                    className="h-3.5 w-3.5 shrink-0 text-brand"
                    aria-hidden
                  />
                ) : null}
                {t(opt.labelKey)}
              </label>
              <Switch
                id={`scope-${opt.id}`}
                checked={on}
                onCheckedChange={() => toggleScope(opt.id)}
                aria-label={t(opt.labelKey)}
              />
            </div>
          );
        })}
      </div>

      {/* De-identification + fairness guarantees */}
      <div className="flex flex-wrap gap-2">
        <Badge tone={deidentified ? "normal" : "warning"}>
          <ShieldCheck weight="fill" className="h-3 w-3" aria-hidden />
          {deidentified
            ? t("institution.export.deidentifiedOn")
            : t("institution.export.deidentifiedOff")}
        </Badge>
        <Badge tone={fairnessIncluded ? "normal" : "caution"}>
          <ShieldCheck weight="fill" className="h-3 w-3" aria-hidden />
          {fairnessIncluded
            ? t("institution.export.fairnessOn")
            : t("institution.export.fairnessOff")}
        </Badge>
      </div>

      {/* Preview trigger */}
      <div className="flex flex-col gap-2">
        <Button
          ref={previewButtonRef}
          disabled={!canPreview}
          aria-expanded={previewing}
          onClick={() => setPreviewing((v) => !v)}
          leadingIcon={<Eye weight="bold" className="h-4.5 w-4.5" />}
        >
          {previewing
            ? t("institution.export.preview.close")
            : t("institution.export.preview.open")}
        </Button>
        {!canPreview ? (
          <p role="status" className="text-xs text-[color:var(--state-caution)]">
            {t("institution.export.preview.selectFrameworks")}
          </p>
        ) : null}
      </div>

      {previewing && canPreview ? (
        <PreviewPanel
          selectedFrameworks={selectedFrameworks}
          selectedScopes={selectedScopes}
          deidentified={deidentified}
          fairnessIncluded={fairnessIncluded}
          onClose={closePreview}
        />
      ) : null}
    </Card>
  );
}
