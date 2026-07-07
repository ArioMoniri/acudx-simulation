import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Export,
  ShieldCheck,
  CheckCircle,
  Certificate,
} from "@phosphor-icons/react";
import { Card, Button, Switch, Badge } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useLang } from "@/lib/useLang";
import {
  accreditationFrameworks,
  exportScopeOptions,
  type AccreditationFramework,
} from "@/data/institution";

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

/** AccreditationExport — one-click, framework-tagged, de-identified export builder (IN-3). */
export function AccreditationExport() {
  const { t } = useTranslation();
  const [selectedFw, setSelectedFw] = useState<Set<string>>(
    () => new Set(["acgme", "epa", "tepdad"]),
  );
  const [scopes, setScopes] = useState<Set<string>>(
    () => new Set(exportScopeOptions.filter((o) => o.selected).map((o) => o.id)),
  );

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
  // Export is blocked unless the fairness artifact is in scope (spec 8.4 gate).
  const canExport = selectedFw.size > 0 && fairnessIncluded;

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
            <div
              key={opt.id}
              className="flex items-center justify-between gap-3"
            >
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

      <div className="flex flex-col gap-2">
        <Button
          disabled={!canExport}
          leadingIcon={<Export weight="bold" className="h-4.5 w-4.5" />}
        >
          {t("institution.export.generate")}
        </Button>
        {!canExport ? (
          <p role="status" className="text-xs text-[color:var(--state-caution)]">
            {t("institution.export.blocked")}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
