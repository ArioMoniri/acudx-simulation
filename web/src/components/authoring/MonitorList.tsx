import { useTranslation } from "react-i18next";
import {
  CheckCircle,
  WarningCircle,
  Hash,
  ArrowClockwise,
  ArrowRight,
} from "@phosphor-icons/react";
import { Card, Badge, Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useLang } from "@/lib/useLang";
import { publishedCases, type PublishedCase } from "@/data/authoring";

function StatusBadge({ status }: { status: PublishedCase["status"] }) {
  const { t } = useTranslation();
  if (status === "flagged") {
    return (
      <Badge tone="caution">
        <WarningCircle weight="fill" className="h-3 w-3" aria-hidden />
        {t("authoring.monitor.status.flagged")}
      </Badge>
    );
  }
  if (status === "en-only") {
    return (
      <Badge tone="neutral">
        {t("authoring.monitor.status.enOnly")}
      </Badge>
    );
  }
  return (
    <Badge tone="normal">
      <CheckCircle weight="fill" className="h-3 w-3" aria-hidden />
      {t("authoring.monitor.status.live")}
    </Badge>
  );
}

function MonitorRow({ pub }: { pub: PublishedCase }) {
  const { t } = useTranslation();
  const lang = useLang();
  const flagged = pub.status === "flagged";

  return (
    <li>
      <Card
        padding="md"
        className={cn(
          "flex flex-col gap-3",
          flagged ? "border-l-2 border-l-[color:var(--state-warning)]" : "",
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
                {t("authoring.monitor.lastReviewed", { date: pub.lastReviewed })}
              </span>
              <span aria-hidden>·</span>
              <span>
                {t("authoring.monitor.encounters", { count: pub.encounters })}
              </span>
            </div>
          </div>
          <StatusBadge status={pub.status} />
        </div>

        {/* Per-locale offer status */}
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

/**
 * MonitorList — the author's published + monitored cases (Screen 7.4). Each
 * carries its version hash, last-reviewed date, and per-locale offer status.
 * A guideline-drift flag links back to review; nothing auto-publishes and
 * nothing is auto-rewritten.
 */
export function MonitorList() {
  const lang = useLang();
  return (
    <ul className="grid gap-3 lg:grid-cols-3">
      {publishedCases.map((p) => (
        <MonitorRow key={p.id} pub={p} />
      ))}
      <li className="sr-only">{lang}</li>
    </ul>
  );
}
