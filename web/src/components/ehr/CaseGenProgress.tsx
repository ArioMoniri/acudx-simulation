import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle, CircleNotch, Warning, ArrowClockwise, X } from "@phosphor-icons/react";

import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { CaseGenV2Event } from "@/lib/caseGenV2";

/* -------------------------------------------------------------------------- */
/* Progress of one on-request case (review 06a 4.6)                            */
/* -------------------------------------------------------------------------- */

/** What the learner sees while the opening of their case is being written. */
export type GenPhase = "requesting" | "writing" | "playable";

export interface GenProgress {
  phase: GenPhase;
  threadId: string | null;
  /** Wall-clock ms when the request was sent (for the elapsed timer). */
  startedAt: number | null;
  /** Server ETA for the opening, from the rolling stage medians. */
  etaMs: number | null;
  /** Opening fields streamed so far (opening.delta), by dotted path. */
  preview: Record<string, unknown>;
}

export const EMPTY_PROGRESS: GenProgress = {
  phase: "requesting",
  threadId: null,
  startedAt: null,
  etaMs: null,
  preview: {},
};

/** Fold one stream event into the progress record. Pure. */
export function foldProgress(prev: GenProgress, ev: CaseGenV2Event): GenProgress {
  switch (ev.event) {
    case "start":
      return { ...prev, threadId: ev.thread_id, etaMs: ev.eta_ms?.s1 ?? prev.etaMs };
    case "opening.delta":
      return { ...prev, phase: "writing", preview: { ...prev.preview, [ev.path]: ev.value } };
    case "node":
      return prev.phase === "requesting" ? { ...prev, phase: "writing" } : prev;
    case "opening.ready":
    case "done":
      return { ...prev, phase: "playable" };
    default:
      return prev;
  }
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
  /** Set when the request ended without a case: the error and Retry, nothing else. */
  failure?: GenFailure | null;
  busy: boolean;
  onRetry: () => void;
  onCancel?: () => void;
  className?: string;
}

function useElapsed(startedAt: number | null, running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [running]);
  return startedAt == null ? 0 : Math.max(0, now - startedAt);
}

const PREVIEW_ORDER: { path: string; key: string }[] = [
  { path: "chief_complaint", key: "oncase.preview.complaint" },
  { path: "demographics.age", key: "oncase.preview.age" },
  { path: "demographics.sex", key: "oncase.preview.sex" },
  { path: "triage_note", key: "oncase.preview.triage" },
];

/**
 * CaseGenProgress: the opening of a case being written for this learner, field by
 * field (complaint, age, triage note, vitals), with an elapsed timer and the server's
 * ETA. On failure the real error is shown and Retry is offered: a case is only ever
 * generated on request by the model, so no other case is offered in its place.
 */
export function CaseGenProgress({ progress, failure = null, busy, onRetry, onCancel, className }: CaseGenProgressProps) {
  const { t } = useTranslation();
  const elapsed = useElapsed(progress.startedAt, busy && !failure);
  const seconds = Math.round(elapsed / 1000);
  const eta = progress.etaMs != null ? Math.round(progress.etaMs / 1000) : null;
  const vitals = ["hr", "systolic", "diastolic", "rr", "spo2", "tempC"]
    .map((k) => [k, progress.preview[`triage_vitals.${k}`]] as const)
    .filter(([, v]) => typeof v === "number");

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
          <h2 className="text-sm font-semibold text-fg">
            {failure ? t("live2.gen.failedTitle") : t("live2.gen.title")}
          </h2>
          <p className="mt-0.5 text-xs text-muted">{failure ? t("live2.gen.failedHint") : t("live2.gen.hint")}</p>
        </div>
        {busy && onCancel ? (
          <Button size="sm" variant="ghost" onClick={onCancel} leadingIcon={<X weight="bold" className="h-3.5 w-3.5" aria-hidden />}>
            {t("livegen.cancel")}
          </Button>
        ) : null}
      </div>

      {!failure ? (
        <div className="mt-3 flex flex-col gap-2">
          <p className="flex items-center gap-2 text-xs text-muted" data-testid="casegen-timer">
            {progress.phase === "playable" ? (
              <CheckCircle weight="fill" className="h-3.5 w-3.5 text-[color:var(--state-normal)]" aria-hidden />
            ) : (
              <CircleNotch weight="bold" className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden />
            )}
            <span>{t(`oncase.phase.${progress.phase}`)}</span>
            <span className="font-mono">
              {eta != null ? t("oncase.elapsedEta", { seconds, eta }) : t("oncase.elapsed", { seconds })}
            </span>
          </p>
          {Object.keys(progress.preview).length > 0 ? (
            <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[auto_1fr]" aria-label={t("oncase.preview.label")}>
              {PREVIEW_ORDER.filter((p) => progress.preview[p.path] != null).map((p) => (
                <div key={p.path} className="contents">
                  <dt className="text-muted">{t(p.key)}</dt>
                  <dd className="text-fg">{String(progress.preview[p.path])}</dd>
                </div>
              ))}
              {vitals.length > 0 ? (
                <div className="contents">
                  <dt className="text-muted">{t("oncase.preview.vitals")}</dt>
                  <dd className="font-mono text-fg">{vitals.map(([k, v]) => `${k} ${String(v)}`).join("  ")}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
        </div>
      ) : (
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
            <Button size="sm" onClick={onRetry} leadingIcon={<ArrowClockwise weight="bold" className="h-3.5 w-3.5" aria-hidden />}>
              {t("live2.gen.retry")}
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-muted">{t("live2.gen.onRequestHint")}</p>
        </div>
      )}
    </section>
  );
}
