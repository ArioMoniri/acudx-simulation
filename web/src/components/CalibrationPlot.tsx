import { useId } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import type { CalibrationPoint, FeedbackDomainKey, Lang } from "@/data/mock";

export interface CalibrationPlotProps {
  points: CalibrationPoint[];
  /** Per-encounter calibration gap history (self-confidence minus competence). */
  trajectory?: number[];
  lang: Lang;
  /** Compact snapshot mode: no quadrant labels/legend, for the dashboard tile. */
  small?: boolean;
  className?: string;
}

/* Plot geometry (SVG user units). Data space is 0..100 on both axes. */
const W = 320;
const H = 320;
const M = { top: 16, right: 16, bottom: 40, left: 44 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;

/** Map a 0..100 value to an x pixel. */
const sx = (v: number) => M.left + (v / 100) * PLOT_W;
/** Map a 0..100 value to a y pixel (inverted: higher competence is higher up). */
const sy = (v: number) => M.top + PLOT_H - (v / 100) * PLOT_H;

const directionColor: Record<CalibrationPoint["direction"], string> = {
  over: "var(--calib-over)",
  under: "var(--calib-under)",
  well: "var(--calib-well)",
};

/** Two-letter domain glyph for the plotted marker. */
function domainGlyph(key: FeedbackDomainKey): string {
  const map: Record<FeedbackDomainKey, string> = {
    history: "Hx",
    exam: "Ex",
    reasoning: "Rx",
    communication: "Co",
    management: "Mx",
    professionalism: "Pr",
  };
  return map[key];
}

/**
 * CalibrationPlot — the signature scatter of self-rated confidence (x) against
 * measured competence (y). The dashed identity line is "perfectly calibrated";
 * points below-right are overconfident, above-left underconfident. A faint
 * arrow traces the recent trajectory toward the line. Fully accessible:
 * <title>/<desc>, per-point aria, and a visually-hidden data table.
 */
export function CalibrationPlot({
  points,
  trajectory,
  lang,
  small = false,
  className,
}: CalibrationPlotProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const descId = useId();

  if (points.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-border bg-bg-subtle p-6 text-center text-sm text-muted">
        {t("calibration.insufficient")}
      </div>
    );
  }

  // Build the trajectory arrow: gaps shrink toward the identity line.
  // Anchor each session near the diagonal, walking from a larger to a smaller
  // gap so the arrow visibly points at the "well-calibrated" band.
  let trajPath: string | null = null;
  let trajHead: { x: number; y: number; angle: number } | null = null;
  if (trajectory && trajectory.length >= 2) {
    const base = 62; // anchor confidence near mid-high
    const pts = trajectory.map((gap, i) => {
      const conf = base + i * 3;
      const comp = conf - gap * 100; // larger gap sits further below the line
      return { x: sx(conf), y: sy(comp) };
    });
    trajPath = pts
      .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(" ");
    const a = pts[pts.length - 2];
    const b = pts[pts.length - 1];
    trajHead = {
      x: b.x,
      y: b.y,
      angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
    };
  }

  const gridTicks = [0, 25, 50, 75, 100];

  return (
    <figure className={cn("flex flex-col", className)}>
      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full min-w-[280px]"
          role="img"
          aria-labelledby={`${titleId} ${descId}`}
        >
          <title id={titleId}>{t("calibration.title")}</title>
          <desc id={descId}>{t("calibration.explainer")}</desc>

          {/* Quadrant shading: under-confident (above-left), over-confident (below-right) */}
          <path
            d={`M${sx(0)} ${sy(0)} L${sx(100)} ${sy(100)} L${sx(0)} ${sy(100)} Z`}
            fill="color-mix(in srgb, var(--calib-under) 8%, transparent)"
          />
          <path
            d={`M${sx(0)} ${sy(0)} L${sx(100)} ${sy(100)} L${sx(100)} ${sy(0)} Z`}
            fill="color-mix(in srgb, var(--calib-over) 8%, transparent)"
          />

          {/* Grid */}
          {gridTicks.map((v) => (
            <g key={v}>
              <line
                x1={sx(v)}
                y1={M.top}
                x2={sx(v)}
                y2={M.top + PLOT_H}
                stroke="var(--border)"
                strokeWidth={1}
                opacity={v === 0 ? 0 : 0.5}
              />
              <line
                x1={M.left}
                y1={sy(v)}
                x2={M.left + PLOT_W}
                y2={sy(v)}
                stroke="var(--border)"
                strokeWidth={1}
                opacity={v === 0 ? 0 : 0.5}
              />
              <text
                x={sx(v)}
                y={M.top + PLOT_H + 14}
                textAnchor="middle"
                className="fill-[color:var(--fg-muted)] text-[9px]"
              >
                {v}
              </text>
              <text
                x={M.left - 6}
                y={sy(v) + 3}
                textAnchor="end"
                className="fill-[color:var(--fg-muted)] text-[9px]"
              >
                {v}
              </text>
            </g>
          ))}

          {/* Axis frame */}
          <line
            x1={M.left}
            y1={M.top}
            x2={M.left}
            y2={M.top + PLOT_H}
            stroke="var(--fg-muted)"
            strokeWidth={1}
          />
          <line
            x1={M.left}
            y1={M.top + PLOT_H}
            x2={M.left + PLOT_W}
            y2={M.top + PLOT_H}
            stroke="var(--fg-muted)"
            strokeWidth={1}
          />

          {/* Identity line: perfectly calibrated */}
          <line
            x1={sx(0)}
            y1={sy(0)}
            x2={sx(100)}
            y2={sy(100)}
            stroke="var(--calib-line)"
            strokeWidth={1.5}
            strokeDasharray="4 4"
          />

          {/* Quadrant labels (full mode only) */}
          {!small ? (
            <>
              <text
                x={sx(22)}
                y={sy(86)}
                textAnchor="middle"
                className="fill-[color:var(--calib-under)] text-[9px] font-medium"
              >
                {t("calibration.legend.under")}
              </text>
              <text
                x={sx(80)}
                y={sy(18)}
                textAnchor="middle"
                className="fill-[color:var(--calib-over)] text-[9px] font-medium"
              >
                {t("calibration.legend.over")}
              </text>
            </>
          ) : null}

          {/* Trajectory arrow */}
          {trajPath && trajHead ? (
            <g opacity={0.85}>
              <path
                d={trajPath}
                fill="none"
                stroke="var(--fg-muted)"
                strokeWidth={1.5}
                strokeDasharray="2 3"
                strokeLinecap="round"
              />
              <g
                transform={`translate(${trajHead.x} ${trajHead.y}) rotate(${trajHead.angle})`}
              >
                <path
                  d="M0 0 L-5 -2.5 L-5 2.5 Z"
                  fill="var(--fg-muted)"
                />
              </g>
            </g>
          ) : null}

          {/* Domain points */}
          {points.map((p) => {
            const cx = sx(p.confidence * 100);
            const cy = sy(p.competence * 100);
            const color = directionColor[p.direction];
            const domainName = t(`feedback.domains.${p.domain}`);
            const dirLabel = t(`calibration.direction.${p.direction}`);
            return (
              <g key={p.domain}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={small ? 4 : 6}
                  fill={color}
                  stroke="var(--surface)"
                  strokeWidth={2}
                >
                  <title>{`${domainName}: ${dirLabel}`}</title>
                </circle>
                {!small ? (
                  <text
                    x={cx}
                    y={cy - 9}
                    textAnchor="middle"
                    className="fill-[color:var(--fg)] text-[8px] font-semibold"
                  >
                    {domainGlyph(p.domain)}
                  </text>
                ) : null}
              </g>
            );
          })}

          {/* Axis titles (full mode) */}
          {!small ? (
            <>
              <text
                x={M.left + PLOT_W / 2}
                y={H - 4}
                textAnchor="middle"
                className="fill-[color:var(--fg-muted)] text-[10px] font-medium"
              >
                {t("calibration.axisConfidence")}
              </text>
              <text
                x={-(M.top + PLOT_H / 2)}
                y={12}
                textAnchor="middle"
                transform="rotate(-90)"
                className="fill-[color:var(--fg-muted)] text-[10px] font-medium"
              >
                {t("calibration.axisCompetence")}
              </text>
            </>
          ) : null}
        </svg>
      </div>

      {/* Legend (full mode) */}
      {!small ? (
        <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
          <li className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-3 w-4 rounded-sm border-t-2 border-dashed"
              style={{ borderColor: "var(--calib-line)" }}
            />
            {t("calibration.legend.identity")}
          </li>
          <li className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: "var(--calib-over)" }}
            />
            {t("calibration.legend.over")}
          </li>
          <li className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: "var(--calib-under)" }}
            />
            {t("calibration.legend.under")}
          </li>
          <li className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: "var(--calib-well)" }}
            />
            {t("calibration.identityLine")}
          </li>
          {trajPath ? (
            <li className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className="inline-block h-0 w-4 border-t border-dashed"
                style={{ borderColor: "var(--fg-muted)" }}
              />
              {t("calibration.legend.trajectory")}
            </li>
          ) : null}
        </ul>
      ) : null}

      {/* Visually-hidden data table equivalent */}
      <figcaption className="sr-only">
        <table>
          <caption>{t("calibration.table.caption")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("calibration.table.domain")}</th>
              <th scope="col">{t("calibration.table.confidence")}</th>
              <th scope="col">{t("calibration.table.competence")}</th>
              <th scope="col">{t("calibration.table.direction")}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.domain}>
                <th scope="row">{t(`feedback.domains.${p.domain}`)}</th>
                <td>{Math.round(p.confidence * 100)}%</td>
                <td>{Math.round(p.competence * 100)}%</td>
                <td>{t(`calibration.direction.${p.direction}`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          {t("calibration.trajectory")}:{" "}
          {(trajectory ?? []).map((g) => `${Math.round(g * 100)}%`).join(", ")}
          {lang === "tr" ? "" : ""}
        </p>
      </figcaption>
    </figure>
  );
}
