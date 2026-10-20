import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowSquareOut,
  FilmStrip,
  ImageSquare,
  Stack,
  Warning,
} from "@phosphor-icons/react";

import { cn } from "@/lib/cn";
import { ConditionImage } from "@/components/ehr/ConditionImage";
import {
  resolveStudyMedia,
  type CineMedia,
  type StackMedia,
  type StudyAttribution,
} from "@/data/studyMedia";
import {
  ecgStrip,
  type EcgSummary,
  type ImageProvenance,
  type ImageRef,
  type StructuredFinding,
} from "@/lib/resultsApi";

/**
 * A study resolved by the server results engine (Live mode): the structured
 * report with its matched, licence-clean image and provenance, or an ECG
 * summary whose tracing is fetched from POST /v1/results/ecg.
 */
export interface EngineStudy {
  status: "ok" | "unavailable";
  image?: ImageRef | null;
  provenance?: ImageProvenance | null;
  findings: StructuredFinding[];
  impression?: string;
  reason?: string | null;
  ecg?: EcgSummary | null;
}

export interface StudyViewerProps {
  /** Free-text study/finding to illustrate, e.g. "normal Echocardiogram (TTE)". */
  query: string;
  /** Short modality label, e.g. "US" / "CT" / "MRI". */
  modality?: string;
  /** Clinician-authored caption (shown when interpretation is allowed). */
  caption?: string;
  /** When false, suppress interpretive text (learner reads the study). */
  showInterpretation?: boolean;
  /** Server engine answer; when present it takes precedence over the bundle. */
  engine?: EngineStudy | null;
  className?: string;
}

/**
 * StudyViewer — the resulted-imaging viewer. It PREFERS a richer, real,
 * open-licensed rendering when one fits the study:
 *   - a looping **cine** for a dynamic study (echocardiogram), and
 *   - a scrollable multi-slice **stack** (a PACS-style "DICOM series") for a
 *     cross-sectional study (abdominal CT),
 * and otherwise falls back to the representative **still** (ConditionImage).
 *
 * Every rendering carries the same non-negotiable chrome as the still: a
 * permanent "representative — not this patient" banner and a license +
 * attribution + source footer. Nothing here is generated.
 */
export function StudyViewer({
  query,
  modality,
  caption,
  showInterpretation = true,
  engine,
  className,
}: StudyViewerProps) {
  const media = useMemo(() => (engine ? null : resolveStudyMedia(query, modality)), [engine, query, modality]);

  if (engine) {
    if (engine.ecg) {
      return (
        <EcgStripViewer
          ecg={engine.ecg}
          findings={engine.findings}
          modality={modality}
          caption={caption}
          showInterpretation={showInterpretation}
          className={className}
        />
      );
    }
    return (
      <EngineImageViewer
        study={engine}
        modality={modality}
        caption={caption}
        showInterpretation={showInterpretation}
        className={className}
      />
    );
  }

  if (media?.kind === "cine") {
    return (
      <CineViewer
        media={media}
        modality={modality}
        caption={caption}
        showInterpretation={showInterpretation}
        className={className}
      />
    );
  }
  if (media?.kind === "stack") {
    return (
      <StackViewer
        media={media}
        modality={modality}
        caption={caption}
        showInterpretation={showInterpretation}
        className={className}
      />
    );
  }
  // No richer rendering fits — the representative still (with its own live
  // Commons fallback + attribution) is the right presentation.
  return (
    <ConditionImage
      query={query}
      modality={modality}
      caption={caption}
      showInterpretation={showInterpretation}
      className={className}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Shared chrome                                                               */
/* -------------------------------------------------------------------------- */

function ViewerFrame({
  modalityLabel,
  badge,
  badgeIcon,
  children,
  footer,
  className,
}: {
  modalityLabel: string;
  badge: string;
  badgeIcon?: React.ReactNode;
  children: React.ReactNode;
  footer: React.ReactNode;
  className?: string;
}) {
  return (
    <figure
      className={cn(
        "overflow-hidden rounded-card border bg-monitor-bg text-monitor-fg border-monitor-border shadow-soft-md",
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-monitor-border px-3 py-2">
        <ImageSquare weight="duotone" className="h-4 w-4 shrink-0 text-monitor-online" aria-hidden />
        <span className="truncate font-mono text-xs uppercase tracking-wide text-monitor-fg">
          {modalityLabel}
        </span>
        <span className="ms-auto inline-flex items-center gap-1 rounded-chip bg-[color-mix(in_srgb,var(--monitor-fg)_8%,transparent)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-monitor-dim">
          {badgeIcon}
          {badge}
        </span>
      </div>
      {children}
      <figcaption className="space-y-1.5 border-t border-monitor-border px-3 py-2">{footer}</figcaption>
    </figure>
  );
}

function SafetyBanner({ text }: { text: string }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-[color-mix(in_srgb,var(--monitor-bg)_82%,transparent)] px-3 py-1.5">
      <Warning weight="fill" className="h-3.5 w-3.5 shrink-0 text-monitor-online" aria-hidden />
      <p className="font-mono text-[11px] font-medium leading-tight text-monitor-fg">{text}</p>
    </div>
  );
}

function AttributionRow({ attribution }: { attribution: StudyAttribution }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-monitor-dim">
      <span>
        <span className="text-monitor-dim">{t("imaging2.license")}:</span>{" "}
        <span className="text-monitor-fg">{attribution.license}</span>
      </span>
      <span className="min-w-0 max-w-full truncate">
        <span className="text-monitor-dim">{t("imaging2.attribution")}:</span>{" "}
        <span className="text-monitor-fg">{attribution.author}</span>
      </span>
      <a
        href={attribution.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 rounded-chip text-monitor-online underline decoration-dotted underline-offset-2 hover:text-monitor-fg"
      >
        {t("imaging2.viewSource")}
        <ArrowSquareOut className="h-3 w-3" aria-hidden />
      </a>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Cine viewer                                                                 */
/* -------------------------------------------------------------------------- */

function CineViewer({
  media,
  modality,
  caption,
  showInterpretation,
  className,
}: {
  media: CineMedia;
  modality?: string;
  caption?: string;
  showInterpretation: boolean;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.toLowerCase().startsWith("tr") ? "tr" : "en";
  const modalityLabel = modality?.trim() || t("imaging2.disclaimerShort");

  return (
    <ViewerFrame
      className={className}
      modalityLabel={modalityLabel}
      badge={t("imaging2.cineBadge", { defaultValue: "Cine loop" })}
      badgeIcon={<FilmStrip weight="bold" className="h-3 w-3" aria-hidden />}
      footer={
        <>
          {showInterpretation && caption ? (
            <p className="text-xs leading-snug text-monitor-fg">{caption}</p>
          ) : null}
          {showInterpretation ? (
            <p className="font-mono text-[11px] leading-snug text-monitor-online">
              {media.caption[lang]}
            </p>
          ) : null}
          <AttributionRow attribution={media.attribution} />
        </>
      }
    >
      <div className="relative flex min-h-40 items-center justify-center bg-monitor-bg">
        {/* A clinical loop is essential content (like a video), so it plays; the
            source is a bundled, open-licensed cine. */}
        <img
          src={media.src}
          alt={t("imaging2.altNoModality", { query: media.caption[lang] })}
          decoding="async"
          className="max-h-[28rem] max-w-full object-contain"
        />
        <span className="pointer-events-none absolute left-2 top-2 inline-flex items-center gap-1 rounded-chip bg-[color-mix(in_srgb,var(--monitor-bg)_70%,transparent)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-monitor-online">
          <FilmStrip weight="fill" className="h-3 w-3" aria-hidden />
          {t("imaging2.cineLive", { defaultValue: "Live loop" })}
        </span>
        <SafetyBanner text={t("imaging2.disclaimer")} />
      </div>
    </ViewerFrame>
  );
}

/* -------------------------------------------------------------------------- */
/* Stack viewer (scrollable multi-slice series)                                */
/* -------------------------------------------------------------------------- */

function StackViewer({
  media,
  modality,
  caption,
  showInterpretation,
  className,
}: {
  media: StackMedia;
  modality?: string;
  caption?: string;
  showInterpretation: boolean;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.toLowerCase().startsWith("tr") ? "tr" : "en";
  const modalityLabel = modality?.trim() || t("imaging2.disclaimerShort");

  const [windowKey, setWindowKey] = useState(media.windows[0]?.key ?? "");
  const activeWindow =
    media.windows.find((w) => w.key === windowKey) ?? media.windows[0];
  const frames = activeWindow?.frames ?? [];
  const count = frames.length;
  const [idx, setIdx] = useState(() => Math.floor(count / 2));

  // Keep the index valid if the active window's frame count differs.
  useEffect(() => {
    setIdx((i) => Math.min(Math.max(0, i), Math.max(0, count - 1)));
  }, [count]);

  const clamp = (n: number) => Math.min(Math.max(0, n), Math.max(0, count - 1));
  const stageRef = useRef<HTMLDivElement | null>(null);

  // Scroll the mouse wheel over the stage to page through slices (a PACS
  // convention); preventDefault so the page doesn't scroll with it.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setIdx((i) => clamp(i + (e.deltaY > 0 ? 1 : -1)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);

  return (
    <ViewerFrame
      className={className}
      modalityLabel={modalityLabel}
      badge={t("imaging2.stackBadge", { defaultValue: "Series" })}
      badgeIcon={<Stack weight="bold" className="h-3 w-3" aria-hidden />}
      footer={
        <>
          {showInterpretation && caption ? (
            <p className="text-xs leading-snug text-monitor-fg">{caption}</p>
          ) : null}
          {showInterpretation ? (
            <p className="font-mono text-[11px] leading-snug text-monitor-online">
              {media.caption[lang]}
            </p>
          ) : null}
          <AttributionRow attribution={media.attribution} />
          {media.atlasLinked ? (
            <a
              href="/atlas"
              className="inline-flex items-center gap-1 rounded-chip font-mono text-[11px] text-monitor-online underline decoration-dotted underline-offset-2 hover:text-monitor-fg"
            >
              {t("imaging2.openAtlas", { defaultValue: "Explore this anatomy in the atlas" })}
              <ArrowSquareOut className="h-3 w-3" aria-hidden />
            </a>
          ) : null}
        </>
      }
    >
      <div
        ref={stageRef}
        className="relative flex min-h-40 items-center justify-center bg-monitor-bg"
        role="group"
        aria-label={t("imaging2.stackAria", {
          defaultValue: "Scrollable image series — use the slider or scroll to change slice",
        })}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
            e.preventDefault();
            setIdx((i) => clamp(i - 1));
          } else if (e.key === "ArrowDown" || e.key === "ArrowRight") {
            e.preventDefault();
            setIdx((i) => clamp(i + 1));
          }
        }}
      >
        {frames[idx] ? (
          <img
            src={frames[idx]}
            alt={t("imaging2.alt", { modality: modalityLabel, query: media.plane[lang] })}
            decoding="async"
            draggable={false}
            className="max-h-[28rem] max-w-full select-none object-contain"
          />
        ) : null}

        {/* Plane + slice counter (top-left), window presets (top-right). */}
        <span className="pointer-events-none absolute left-2 top-2 inline-flex items-center gap-1 rounded-chip bg-[color-mix(in_srgb,var(--monitor-bg)_70%,transparent)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-monitor-online">
          {media.plane[lang]} · {idx + 1}/{count}
        </span>
        {media.windows.length > 1 ? (
          <div className="absolute right-2 top-2 flex items-center gap-1">
            {media.windows.map((w) => (
              <button
                key={w.key}
                type="button"
                onClick={() => setWindowKey(w.key)}
                className={cn(
                  "rounded-chip px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide transition-colors",
                  w.key === activeWindow?.key
                    ? "bg-monitor-online text-monitor-bg"
                    : "bg-[color-mix(in_srgb,var(--monitor-fg)_10%,transparent)] text-monitor-dim hover:text-monitor-fg",
                )}
              >
                {w.label[lang]}
              </button>
            ))}
          </div>
        ) : null}

        <SafetyBanner text={t("imaging2.disclaimer")} />
      </div>

      {/* Slice scrubber. */}
      {count > 1 ? (
        <div className="flex items-center gap-2 border-t border-monitor-border px-3 py-2">
          <Stack weight="duotone" className="h-3.5 w-3.5 shrink-0 text-monitor-dim" aria-hidden />
          <input
            type="range"
            min={0}
            max={count - 1}
            value={idx}
            onChange={(e) => setIdx(clamp(Number(e.target.value)))}
            aria-label={t("imaging2.stackSlider", { defaultValue: "Slice" })}
            className="h-1 w-full cursor-pointer accent-monitor-online"
          />
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-monitor-dim">
            {idx + 1}/{count}
          </span>
        </div>
      ) : null}
    </ViewerFrame>
  );
}

/* -------------------------------------------------------------------------- */
/* Engine viewers (Live mode): server-selected image + provenance, ECG strip   */
/* -------------------------------------------------------------------------- */

/** Resolve a bank image source: the bundled local copy first, else the source URL. */
function engineImageSrc(image: ImageRef): string {
  const local = image.local_path ?? "";
  const idx = local.indexOf("web/public/");
  if (idx >= 0) return `${import.meta.env.BASE_URL}${local.slice(idx + "web/public/".length)}`;
  return image.url;
}

function FindingsList({ findings, impression }: { findings: StructuredFinding[]; impression?: string }) {
  const { t } = useTranslation();
  return (
    <div className="px-3 py-3">
      <p className="eyebrow text-monitor-dim">{t("live2.results.findings")}</p>
      <ul className="mt-1.5 flex flex-col gap-1">
        {findings.map((f, i) => (
          <li key={`${f.finding}-${i}`} className="flex items-start gap-2 font-mono text-xs text-monitor-fg">
            <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-monitor-online" />
            <span>
              {f.text}
              {f.laterality && f.laterality !== "none" ? (
                <span className="ms-1 text-monitor-dim">({f.laterality})</span>
              ) : null}
            </span>
          </li>
        ))}
        {findings.length === 0 ? (
          <li className="font-mono text-xs text-monitor-dim">{t("live2.results.noFindings")}</li>
        ) : null}
      </ul>
      {impression ? (
        <p className="mt-2 text-xs leading-snug text-monitor-fg">
          <span className="text-monitor-dim">{t("ehr.results.impression")}: </span>
          {impression}
        </p>
      ) : null}
    </div>
  );
}

function ProvenanceRow({ provenance }: { provenance: ImageProvenance }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-monitor-dim">
      <span>
        <span className="text-monitor-dim">{t("imaging2.license")}:</span>{" "}
        <a
          href={provenance.license_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-monitor-fg underline decoration-dotted underline-offset-2"
        >
          {provenance.license}
        </a>
      </span>
      <span className="min-w-0 max-w-full truncate">
        <span className="text-monitor-dim">{t("imaging2.attribution")}:</span>{" "}
        <span className="text-monitor-fg">{provenance.attribution_text || provenance.attribution}</span>
      </span>
      <a
        href={provenance.source_page}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 rounded-chip text-monitor-online underline decoration-dotted underline-offset-2 hover:text-monitor-fg"
      >
        {t("live2.results.viewSource", { bank: provenance.source_bank })}
        <ArrowSquareOut className="h-3 w-3" aria-hidden />
      </a>
      <span className="basis-full text-monitor-dim">
        {t("live2.results.representative")}
        {provenance.verified_at ? ` · ${t("live2.results.verified", { date: provenance.verified_at })}` : ""}
      </span>
    </div>
  );
}

function EngineImageViewer({
  study,
  modality,
  caption,
  showInterpretation,
  className,
}: {
  study: EngineStudy;
  modality?: string;
  caption?: string;
  showInterpretation: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const [broken, setBroken] = useState(false);
  const image = study.status === "ok" && study.image && !broken ? study.image : null;
  const modalityLabel = modality?.trim() || t("imaging2.disclaimerShort");

  return (
    <ViewerFrame
      className={className}
      modalityLabel={modalityLabel}
      badge={t("live2.results.engineBadge")}
      badgeIcon={<ImageSquare weight="bold" className="h-3 w-3" aria-hidden />}
      footer={
        <>
          {showInterpretation && caption ? (
            <p className="text-xs leading-snug text-monitor-fg">{caption}</p>
          ) : null}
          {image && study.provenance ? (
            <ProvenanceRow provenance={study.provenance} />
          ) : (
            <p className="flex items-center gap-1.5 font-mono text-[11px] text-monitor-dim">
              <Warning weight="fill" className="h-3 w-3 shrink-0" aria-hidden />
              {t("live2.results.unavailable")}
              {study.reason ? ` (${study.reason})` : ""}
            </p>
          )}
        </>
      }
    >
      {image ? (
        <div className="relative flex min-h-40 items-center justify-center bg-monitor-bg">
          <img
            src={engineImageSrc(image)}
            alt={t("imaging2.alt", { modality: modalityLabel, query: image.caption_en })}
            decoding="async"
            className="max-h-[28rem] max-w-full object-contain"
            onError={() => setBroken(true)}
          />
          <SafetyBanner text={t("imaging2.disclaimer")} />
        </div>
      ) : null}
      {showInterpretation ? (
        <FindingsList findings={study.findings} impression={study.impression} />
      ) : (
        <p className="px-3 py-3 text-xs italic text-monitor-dim">
          {t("ehr.results.interpretYourself", {
            defaultValue: "Interpret this study - enable Guidance for the read.",
          })}
        </p>
      )}
    </ViewerFrame>
  );
}

type EcgPhase = "loading" | "ready" | "failed";

/**
 * EcgStripViewer: the 12-lead printout synthesized server-side at 25 mm/s and
 * 10 mm/mV, rendered as an image (the SVG string never enters the DOM as
 * markup). The legend states the calibration and that the tracing is synthetic.
 */
function EcgStripViewer({
  ecg,
  findings,
  modality,
  caption,
  showInterpretation,
  className,
}: {
  ecg: EcgSummary;
  findings: StructuredFinding[];
  modality?: string;
  caption?: string;
  showInterpretation: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<EcgPhase>("loading");
  const [src, setSrc] = useState<string | null>(null);
  const [calibration, setCalibration] = useState<{ speed: number; gain: number }>({ speed: 25, gain: 10 });
  const req = ecg.request;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setPhase("loading");
    setSrc(null);
    void ecgStrip(
      {
        pattern: req.pattern as Parameters<typeof ecgStrip>[0]["pattern"],
        rate_bpm: req.rate_bpm,
        seed: req.seed,
        include_samples: false,
        include_svg: true,
      },
      { signal: controller.signal },
    ).then((res) => {
      if (!active) return;
      if (res.ok && res.data.svg) {
        setSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(res.data.svg)}`);
        setCalibration({
          speed: res.data.calibration?.paper_speed_mm_s ?? 25,
          gain: res.data.calibration?.gain_mm_mV ?? 10,
        });
        setPhase("ready");
      } else {
        setPhase("failed");
      }
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [req.pattern, req.rate_bpm, req.seed]);

  const m = ecg.measurements;
  const modalityLabel = modality?.trim() || "ECG";

  return (
    <ViewerFrame
      className={className}
      modalityLabel={modalityLabel}
      badge={t("live2.results.ecgBadge")}
      badgeIcon={<FilmStrip weight="bold" className="h-3 w-3" aria-hidden />}
      footer={
        <>
          {showInterpretation && caption ? (
            <p className="text-xs leading-snug text-monitor-fg">{caption}</p>
          ) : null}
          <p className="font-mono text-[11px] text-monitor-dim">
            {t("live2.results.ecgLegend", { speed: calibration.speed, gain: calibration.gain })}
          </p>
          <p className="font-mono text-[11px] text-monitor-dim">{t("live2.results.ecgSynthetic")}</p>
        </>
      }
    >
      <div className="relative flex min-h-40 items-center justify-center bg-white">
        {phase === "ready" && src ? (
          <img
            src={src}
            alt={t("live2.results.ecgAlt", { rate: m.rate_bpm, rhythm: m.rhythm })}
            decoding="async"
            className="max-h-[32rem] w-full object-contain"
          />
        ) : (
          <p className="px-4 py-10 text-center font-mono text-xs text-monitor-bg/80">
            {phase === "loading" ? t("live2.results.ecgLoading") : t("live2.results.ecgFailed")}
          </p>
        )}
      </div>
      {showInterpretation ? (
        <div className="border-t border-monitor-border">
          <dl className="grid grid-cols-3 gap-x-3 gap-y-1 px-3 py-2 font-mono text-[11px] sm:grid-cols-6">
            <div><dt className="text-monitor-dim">HR</dt><dd className="text-monitor-fg">{m.rate_bpm}</dd></div>
            <div><dt className="text-monitor-dim">PR</dt><dd className="text-monitor-fg">{m.pr_ms ?? "-"}</dd></div>
            <div><dt className="text-monitor-dim">QRS</dt><dd className="text-monitor-fg">{m.qrs_ms}</dd></div>
            <div><dt className="text-monitor-dim">QTc</dt><dd className="text-monitor-fg">{m.qtc_ms}</dd></div>
            <div><dt className="text-monitor-dim">{t("live2.results.axis")}</dt><dd className="text-monitor-fg">{m.axis_deg}</dd></div>
            <div><dt className="text-monitor-dim">{t("live2.results.rhythm")}</dt><dd className="truncate text-monitor-fg">{m.rhythm}</dd></div>
          </dl>
          <FindingsList findings={findings} impression={m.interpretation} />
        </div>
      ) : (
        <p className="px-3 py-3 text-xs italic text-monitor-dim">
          {t("ehr.results.interpretYourself", {
            defaultValue: "Interpret this study - enable Guidance for the read.",
          })}
        </p>
      )}
    </ViewerFrame>
  );
}
