import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowSquareOut,
  ImageBroken,
  ImageSquare,
  Warning,
} from "@phosphor-icons/react";

import { cn } from "@/lib/cn";
import { Skeleton } from "@/components/ui";
import {
  resolveStudyImage,
  type ConditionImage as ConditionImageData,
} from "@/lib/openMedicalImages";

export interface ConditionImageProps {
  /** Free-text condition to illustrate, e.g. "pneumonia" or "pneumothorax". */
  query: string;
  /** Imaging modality, folded into the search + alt text, e.g. "CXR", "CT". */
  modality?: string;
  /** Optional caption shown under the image (clinician-authored context). */
  caption?: string;
  className?: string;
}

type Phase = "loading" | "loaded" | "empty";

/**
 * ConditionImage — a PACS-style dark viewer that shows a REAL, openly-licensed
 * representative image of a condition fetched from Wikimedia Commons.
 *
 * Safety + licensing are non-negotiable: a permanent, always-visible banner
 * states the picture is representative and NOT the simulated patient, and the
 * footer always carries the license, attribution, and a link back to the
 * Commons source page. Nothing here is tooltip-only.
 *
 * The frame stays dark in both themes via the `--monitor-*` tokens, metadata is
 * monospace like real imaging software, and the loading Skeleton collapses its
 * shimmer under `prefers-reduced-motion`.
 */
export function ConditionImage({
  query,
  modality,
  caption,
  className,
}: ConditionImageProps) {
  const { t, i18n } = useTranslation();
  const [phase, setPhase] = useState<Phase>("loading");
  const [image, setImage] = useState<ConditionImageData | null>(null);
  /** Bilingual teaching label from a curated match (null for live results). */
  const [curatedCaption, setCuratedCaption] = useState<string | null>(null);

  const searchText = [query, modality].filter(Boolean).join(" ").trim();

  useEffect(() => {
    if (!searchText) {
      setPhase("empty");
      setImage(null);
      setCuratedCaption(null);
      return;
    }

    const controller = new AbortController();
    let active = true;
    setPhase("loading");
    setImage(null);
    setCuratedCaption(null);

    const lang = i18n.language?.toLowerCase().startsWith("tr") ? "tr" : "en";
    // PREFER a curated, individually-verified image; only fall back to the
    // free-text live Commons lookup when nothing curated matches. Accuracy
    // matters for a teaching tool (see resolveStudyImage).
    void resolveStudyImage(query, modality, lang, controller.signal).then((result) => {
      if (!active) return;
      if (result) {
        setImage(result);
        setCuratedCaption(result.curated ? result.curatedCaption ?? null : null);
        setPhase("loaded");
      } else {
        setImage(null);
        setPhase("empty");
      }
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [searchText, query, modality, i18n.language]);

  const altText = modality
    ? t("imaging2.alt", { modality, query })
    : t("imaging2.altNoModality", { query });

  const modalityLabel = modality?.trim() || t("imaging2.disclaimerShort");

  return (
    <figure
      className={cn(
        "overflow-hidden rounded-card border bg-monitor-bg text-monitor-fg border-monitor-border shadow-soft-md",
        className,
      )}
    >
      {/* Viewer chrome header */}
      <div className="flex items-center gap-2 border-b border-monitor-border px-3 py-2">
        <ImageSquare
          weight="duotone"
          className="h-4 w-4 shrink-0 text-monitor-online"
          aria-hidden
        />
        <span className="truncate font-mono text-xs uppercase tracking-wide text-monitor-fg">
          {modalityLabel}
        </span>
        <span className="ms-auto inline-flex items-center gap-1 rounded-chip bg-[color-mix(in_srgb,var(--monitor-fg)_8%,transparent)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-monitor-dim">
          {t("imaging2.disclaimerShort")}
        </span>
      </div>

      {/* Image stage */}
      <div className="relative flex min-h-40 items-center justify-center bg-monitor-bg">
        {phase === "loading" ? (
          <div className="w-full p-3">
            <Skeleton className="aspect-video w-full" />
          </div>
        ) : phase === "loaded" && image ? (
          <>
            <img
              src={image.thumbUrl}
              alt={altText}
              loading="lazy"
              decoding="async"
              className="max-h-[28rem] max-w-full object-contain"
              onError={() => {
                setImage(null);
                setPhase("empty");
              }}
            />
            {/* MANDATORY disclaimer — real text, always visible (not a tooltip). */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-[color-mix(in_srgb,var(--monitor-bg)_82%,transparent)] px-3 py-1.5">
              <Warning
                weight="fill"
                className="h-3.5 w-3.5 shrink-0 text-monitor-online"
                aria-hidden
              />
              <p className="font-mono text-[11px] font-medium leading-tight text-monitor-fg">
                {t("imaging2.disclaimer")}
              </p>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <ImageBroken
              weight="duotone"
              className="h-8 w-8 text-monitor-dim"
              aria-hidden
            />
            <p className="font-mono text-xs text-monitor-fg">
              {t("imaging2.noImage")}
            </p>
            <p className="max-w-xs font-mono text-[11px] text-monitor-dim">
              {t("imaging2.noImageHint")}
            </p>
          </div>
        )}
      </div>

      {/* Metadata footer: caption, disclaimer (again as durable text), source */}
      <figcaption className="space-y-1.5 border-t border-monitor-border px-3 py-2">
        {caption ? (
          <p className="text-xs leading-snug text-monitor-fg">{caption}</p>
        ) : null}

        {/* Curated, verified teaching label — what this representative study
            actually depicts (only present for a bundled curated match). */}
        {phase === "loaded" && curatedCaption && curatedCaption !== caption ? (
          <p className="font-mono text-[11px] leading-snug text-monitor-online">
            {curatedCaption}
          </p>
        ) : null}

        {/* Durable, non-overlay copy of the disclaimer so it stays visible in
            the loading/empty phases where the on-image banner isn't rendered. */}
        {phase !== "loaded" ? (
          <p className="flex items-center gap-1.5 font-mono text-[11px] text-monitor-dim">
            <Warning weight="fill" className="h-3 w-3 shrink-0" aria-hidden />
            {t("imaging2.disclaimer")}
          </p>
        ) : null}

        {phase === "loaded" && image ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-monitor-dim">
            <span>
              <span className="text-monitor-dim">{t("imaging2.license")}:</span>{" "}
              <span className="text-monitor-fg">{image.license}</span>
            </span>
            <span className="min-w-0 max-w-full truncate">
              <span className="text-monitor-dim">
                {t("imaging2.attribution")}:
              </span>{" "}
              <span className="text-monitor-fg">{image.attribution}</span>
            </span>
            <a
              href={image.pageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-chip text-monitor-online underline decoration-dotted underline-offset-2 hover:text-monitor-fg"
            >
              {t("imaging2.viewSource")}
              <ArrowSquareOut className="h-3 w-3" aria-hidden />
            </a>
          </div>
        ) : null}
      </figcaption>
    </figure>
  );
}
