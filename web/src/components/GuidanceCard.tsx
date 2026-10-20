import { useTranslation } from "react-i18next";
import {
  Lightbulb,
  BookOpen,
  ShieldCheck,
  Broadcast,
  CloudSlash,
} from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { CitationPill } from "@/components/CitationPill";
import type { GuidanceHint } from "@/lib/guidelinesApi";
import type { Lang } from "@/data/schema"; // watchdog: allow (shared schema hub, type only)

export interface GuidanceCardProps {
  /**
   * A verified guideline statement rendered as the Socratic hint, with its
   * citation payload from the API. `null` renders the "guidance unavailable"
   * state: the card never falls back to hard-coded text.
   */
  hint: GuidanceHint | null;
  lang: Lang;
  className?: string;
  /**
   * When the learner's step falls outside every grounded guideline (e.g. the
   * last move was flagged off-task), the card renders an abstain state instead
   * of a hint. Guidance holds back rather than guess.
   */
  abstained?: boolean;
  /**
   * True when the hint came from the live gateway. `undefined` hides the
   * indicator entirely.
   */
  live?: boolean;
}

/**
 * GuidanceCard — a Socratic hint shown above the composer when guidance is on.
 *
 * Every hint is education-only and IS a verified GuidelineStatement: the text,
 * the source body, title and edition, the verification date and the link to the
 * source all arrive in the API payload (src/lib/guidelinesApi.ts). Without a
 * verified statement the card says guidance is unavailable; it never invents.
 */
export function GuidanceCard({ hint, lang, className, abstained = false, live }: GuidanceCardProps) {
  const { t } = useTranslation();

  if (abstained || !hint) {
    const unavailable = !hint && !abstained;
    return (
      <div
        role="note"
        aria-label={t("encounter.guidance.title")}
        className={cn(
          "rounded-card border border-border bg-bg-subtle p-3.5",
          "motion-safe:animate-[fade-up_var(--dur-base)_var(--ease-out)]",
          className,
        )}
      >
        <div className="flex items-start gap-2.5">
          <span
            aria-hidden="true"
            className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-border/60 text-muted"
          >
            {unavailable ? (
              <CloudSlash weight="bold" className="h-3.5 w-3.5" />
            ) : (
              <ShieldCheck weight="fill" className="h-3.5 w-3.5" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-fg">
              {unavailable
                ? t("guidance3.unavailable.title", { defaultValue: "Guidance unavailable" })
                : t("encounter.guidance.abstained")}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              {unavailable
                ? t("guidance3.unavailable.body", {
                    defaultValue:
                      "No verified guideline statement could be served for this step. Nothing is shown rather than an unverified hint.",
                  })
                : t("encounter.guidance.abstain.emptyBody")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const c = hint.citation;
  const verified = c.verifiedAt ? c.verifiedAt.slice(0, 10) : "";

  return (
    <div
      role="note"
      aria-label={t("encounter.guidance.title")}
      className={cn(
        "rounded-card border border-brand/30 bg-brand-tint/60 p-3.5",
        "motion-safe:animate-[fade-up_var(--dur-base)_var(--ease-out)]",
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand/15 text-brand"
        >
          <Lightbulb weight="fill" className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-brand">
              {t("encounter.guidance.title")}
            </span>
            <span className="rounded-full bg-brand/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-brand">
              {t("encounter.guidance.educationOnly")}
            </span>
            {typeof live === "boolean" ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                  live ? "bg-brand/10 text-brand" : "bg-bg-subtle text-muted",
                )}
                title={t(live ? "guidance3.reference.live" : "guidance3.reference.offline")}
              >
                {live ? (
                  <Broadcast weight="bold" className="h-3 w-3" aria-hidden />
                ) : (
                  <CloudSlash weight="bold" className="h-3 w-3" aria-hidden />
                )}
                {t(live ? "encounter.guidance.reference.live" : "encounter.guidance.reference.offline", {
                  defaultValue: live ? "Live" : "Reference",
                })}
              </span>
            ) : null}
          </div>

          <p className="mt-1 text-sm leading-relaxed text-fg">{hint.text[lang] || hint.text.en}</p>

          {/* Provenance: body, title, edition, verification date, link. */}
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
            <CitationPill citationId={hint.statementId} citation={c} lang={lang} />
            <span className="text-xs text-muted">
              {c.body}
              {c.edition ? ` · ${c.edition}` : ""}
            </span>
          </div>
          <p className="mt-1 text-xs leading-snug text-muted">{c.title}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            {verified ? (
              <span>{t("guidance3.citation.verified", { defaultValue: "Verified {{date}}", date: verified })}</span>
            ) : null}
            {c.url ? (
              <a
                href={c.url}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  "inline-flex items-center gap-1.5 font-medium text-brand",
                  "underline decoration-brand/40 underline-offset-2 hover:decoration-brand",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded",
                )}
              >
                <BookOpen weight="bold" className="h-3 w-3" aria-hidden />
                {t("guidance3.sources.open")}
              </a>
            ) : null}
          </div>

          <div className="mt-3 flex items-start gap-1.5 border-t border-brand/15 pt-2.5">
            <ShieldCheck weight="fill" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand/70" aria-hidden />
            <p className="text-xs leading-relaxed text-muted">
              <span className="font-medium text-fg">{t("encounter.guidance.abstain.title")}.</span>{" "}
              {t("encounter.guidance.abstain.noteGeneric")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
