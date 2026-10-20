import { useTranslation } from "react-i18next";
import { ArrowClockwise, BookOpen, CircleNotch, GraduationCap, Warning } from "@phosphor-icons/react";

import { Button, SectionLabel } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { DebriefAnchor, DebriefLayerData } from "@/lib/caseGenV2";
import { citationHref } from "@/lib/citations";
import { getDebrief, retryDebrief, useEncounterSelector } from "@/state/encounterStore";

function anchorText(a: DebriefAnchor, lang: "en" | "tr"): string {
  return (lang === "tr" ? a.statement_tr : "") || a.statement_en;
}

/**
 * CaseDebriefLayer: the model-written debrief of THIS encounter (the `debrief` layer of
 * the thread, requested when the diagnosis is committed). Teaching points, missed cues
 * and the verified guideline statements it cites, each with its source link. Shows a
 * progress state while it is written and Retry when it failed; renders nothing for an
 * encounter that has no on-request thread.
 */
export function CaseDebriefLayer({ className, headingLevel = 3 }: { className?: string; headingLevel?: 2 | 3 }) {
  const { t, i18n } = useTranslation();
  const debrief = useEncounterSelector(getDebrief);
  const lang: "en" | "tr" = i18n.language?.toLowerCase().startsWith("tr") ? "tr" : "en";
  if (debrief.status === "idle") return null;
  const Heading = headingLevel === 2 ? "h2" : "h3";

  if (debrief.status === "pending") {
    return (
      <section
        className={cn("rounded-card border border-dashed border-border px-4 py-3", className)}
        aria-busy="true"
        data-testid="case-debrief"
      >
        <p role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-muted">
          <CircleNotch weight="bold" className="h-4 w-4 motion-safe:animate-spin" aria-hidden />
          {t("oncase.debrief.writing")}
        </p>
      </section>
    );
  }
  if (debrief.status === "failed" || !debrief.data) {
    return (
      <section className={cn("rounded-card border border-border px-4 py-3", className)} data-testid="case-debrief">
        <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-fg">
          <Warning weight="fill" className="h-4 w-4 text-[color:var(--state-caution)]" aria-hidden />
          {t("oncase.debrief.failed")}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => retryDebrief()}
            leadingIcon={<ArrowClockwise weight="bold" className="h-3.5 w-3.5" aria-hidden />}
          >
            {t("oncase.layers.retry")}
          </Button>
        </p>
      </section>
    );
  }

  const shown: DebriefLayerData = (lang === "tr" && debrief.rendered.tr) || debrief.data;
  const anchors = debrief.data.anchors ?? [];
  return (
    <section className={cn("flex flex-col gap-3 rounded-card border border-border px-4 py-3", className)} data-testid="case-debrief">
      <Heading className="flex items-center gap-2 text-sm font-semibold text-fg">
        <GraduationCap weight="bold" className="h-4 w-4 text-muted" aria-hidden />
        {t("oncase.debrief.title")}
      </Heading>
      {lang === "tr" && debrief.rendered.tr ? <p className="text-[11px] text-subtle">{t("oncase.debrief.rendered")}</p> : null}
      <div>
        <SectionLabel className="mb-1">{t("oncase.debrief.teaching")}</SectionLabel>
        <ul className="list-disc space-y-1 ps-5 text-sm text-fg">
          {shown.teaching_points.map((p, i) => (
            <li key={`tp-${i}`}>{p}</li>
          ))}
        </ul>
      </div>
      {shown.missed_cues.length > 0 ? (
        <div>
          <SectionLabel className="mb-1">{t("oncase.debrief.missed")}</SectionLabel>
          <ul className="list-disc space-y-1 ps-5 text-sm text-fg">
            {shown.missed_cues.map((c, i) => (
              <li key={`mc-${i}`}>{c}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div>
        <SectionLabel className="mb-1" icon={<BookOpen weight="bold" className="h-4 w-4" aria-hidden />}>
          {t("oncase.debrief.sources")}
        </SectionLabel>
        {anchors.length === 0 ? (
          <p className="text-xs text-muted">{t("oncase.debrief.noSources")}</p>
        ) : (
          <ol className="flex flex-col gap-2 text-xs text-muted">
            {anchors.map((a) => {
              const href = citationHref(a.citation);
              return (
                <li key={a.statement_id} className="flex flex-col gap-0.5">
                  <span className="text-[0.8125rem] text-fg">{anchorText(a, lang)}</span>
                  <span>
                    {a.source}
                    {a.title ? `, ${a.title}` : ""}
                    {href ? (
                      <>
                        {" "}
                        <a href={href} target="_blank" rel="noreferrer" className="underline">
                          {a.citation}
                        </a>
                      </>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
